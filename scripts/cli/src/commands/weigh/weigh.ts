import { Array as Arr, Console, Effect, FileSystem, Option, Path, Schema, String as Str } from 'effect'
import { Command, Flag } from 'effect/cli'
import { Digest } from 'effect/crypto'
import { reportFailures, withCommandContext } from '../../shared/command-failure.ts'
import { decodeFrontmatter } from './frontmatter.ts'
import { exactCounter } from './exact.ts'

export type Bucket = 'alwaysOn' | 'startup' | 'onDemand'
export type Kind = 'instruction' | 'skill' | 'reference' | 'prompt' | 'agent'

export interface Entry {
  file: string
  kind: Kind
  scoped: boolean
  alwaysOn: number
  startup: number
  onDemand: number
}

export interface PackageWeight {
  name: string
  dir: string
  files: Entry[]
  alwaysOn: number
  startup: number
  onDemand: number
}

const SKIP_DIRS = new Set(['apm_modules', 'vendor', 'node_modules', '.git', '.jj', 'build'])
const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_WINDOW = 200_000

function weightOfPiece(piece: string): number {
  const body = Str.trimStart(piece)
  const length = body.length

  if (length === 0) return Math.max(1, Math.round(piece.length / 4))
  if (/^[A-Za-z]/.test(body)) return Math.max(1, Math.round(length / 4.7))
  if (/^\d/.test(body)) return Math.ceil(length / 3)
  return length
}

export function estimateTokens(text: string): number {
  const pieces = Option.getOrElse(Str.match(/\s?[A-Za-z]+|\s?\d+|\s?[^\sA-Za-z\d]+|\s+/g)(text), () => [])

  return Arr.reduce(pieces, 0, (total, piece) => total + weightOfPiece(piece))
}

export function classify(relPath: string): Kind | null {
  if (!Str.endsWith('.md')(relPath)) return null

  const segments = Str.split('/')(relPath)
  const top = segments[0]

  if (top === 'instructions') return 'instruction'
  if (top === 'prompts') return 'prompt'
  if (top === 'agents') return 'agent'
  if (top === 'skills') {
    if (segments.includes('scripts')) return null
    return segments.at(-1) === 'SKILL.md' ? 'skill' : 'reference'
  }

  return null
}

/** The line a skill or agent contributes to the listing an agent sees before it picks one. */
export function listingLine(fallbackName: string, fields: Record<string, string>): string {
  const name = fields.name ?? fallbackName
  const description = fields.description ?? ''

  return `- ${name}: ${description}`
}

const findPackageDirs = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const found: string[] = []

  const walk = (dir: string): Effect.Effect<void, import('effect/PlatformError').PlatformError> =>
    Effect.gen(function* () {
      if (yield* fs.exists(path.join(dir, '.apm'))) found.push(dir)

      for (const child of yield* fs.readDirectoryEntries(dir)) {
        if (child.type !== 'Directory' || Str.startsWith('.')(child.name) || SKIP_DIRS.has(child.name)) continue

        yield* walk(path.join(dir, child.name))
      }
    })

  yield* walk(root)

  return found.sort()
})

const listFiles = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const found: string[] = []

  const walk = (current: string): Effect.Effect<void, import('effect/PlatformError').PlatformError> =>
    Effect.gen(function* () {
      for (const child of yield* fs.readDirectoryEntries(current)) {
        const full = path.join(current, child.name)
        if (child.type === 'Directory') yield* walk(full)
        else if (child.type === 'File') found.push(path.relative(dir, full))
      }
    })

  yield* walk(dir)

  return found.sort()
})

const weighEntry = Effect.fnUntraced(function* <E>(
  apmDir: string,
  file: string,
  kind: Kind,
  count: (text: string) => Effect.Effect<number, E>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fullPath = path.join(apmDir, file)
  const text = yield* fs.readFileString(fullPath)

  if (kind === 'reference') {
    const onDemand = yield* count(text)
    return Option.some({ file, kind, scoped: false, alwaysOn: 0, startup: 0, onDemand } satisfies Entry)
  }

  const frontmatter = yield* decodeFrontmatter(fullPath, text).pipe(
    Effect.asSome,
    Effect.catchTag('InvalidFrontmatter', (error) =>
      Console.error(`Skipping ${file}: ${error.format()}`).pipe(Effect.as(Option.none())),
    ),
  )
  if (Option.isNone(frontmatter)) return Option.none()

  const { fields, body } = frontmatter.value
  if (kind === 'instruction') {
    const alwaysOn = yield* count(body)
    return Option.some({ file, kind, scoped: 'applyTo' in fields, alwaysOn, startup: 0, onDemand: 0 } satisfies Entry)
  }

  const fallbackName = path.basename(path.dirname(file))
  const startup = yield* count(listingLine(fallbackName, fields))
  const onDemand = yield* count(body)
  return Option.some({ file, kind, scoped: false, alwaysOn: 0, startup, onDemand } satisfies Entry)
})

const weighPackage = Effect.fnUntraced(function* <E>(
  root: string,
  dir: string,
  count: (text: string) => Effect.Effect<number, E>,
  includeAll: boolean,
) {
  const path = yield* Path.Path
  const apmDir = path.join(dir, '.apm')
  const paths = yield* listFiles(apmDir)
  const selected = Arr.flatMap(paths, (file) => {
    const kind = classify(file)
    if (kind === null || (!includeAll && (kind === 'prompt' || kind === 'agent'))) return []
    return [{ file, kind }]
  })

  const entries = yield* Effect.forEach(selected, ({ file, kind }) => weighEntry(apmDir, file, kind, count), {
    concurrency: 1,
  })
  const files = Arr.getSomes(entries)

  return {
    name: path.relative(root, dir) || path.basename(dir),
    dir,
    files,
    alwaysOn: sum(files, 'alwaysOn'),
    startup: sum(files, 'startup'),
    onDemand: sum(files, 'onDemand'),
  } satisfies PackageWeight
})

function sum(entries: readonly { alwaysOn: number; startup: number; onDemand: number }[], bucket: Bucket): number {
  return Arr.reduce(entries, 0, (acc, entry) => acc + entry[bucket])
}

const NUM = new Intl.NumberFormat('en-US')

function cell(value: number, width: number): string {
  return Str.padStart(width)(value === 0 ? '·' : NUM.format(value))
}

function renderPackage(pkg: PackageWeight, sortBy: Bucket | 'name'): string[] {
  const lines = [`${pkg.name}  (${pkg.files.length} files)`]
  const ordered = [...pkg.files].sort((a, b) => {
    if (sortBy !== 'name') {
      const byWeight = b[sortBy] - a[sortBy]

      if (byWeight !== 0 && !Number.isNaN(byWeight)) return byWeight
    }

    return Str.localeCompare(b.file)(a.file)
  })

  lines.push(`  ${Str.padStart(9)('always')} ${Str.padStart(8)('startup')} ${Str.padStart(10)('on-demand')}  file`)
  for (const entry of ordered) {
    const mark = entry.scoped ? ' *' : ''
    lines.push(
      `  ${cell(entry.alwaysOn, 9)} ${cell(entry.startup, 8)} ${cell(entry.onDemand, 10)}  ${entry.file}${mark}`,
    )
  }
  lines.push(`  ${cell(pkg.alwaysOn, 9)} ${cell(pkg.startup, 8)} ${cell(pkg.onDemand, 10)}  subtotal`)

  return lines
}

function renderSummary(packages: PackageWeight[], window: number): string[] {
  const nameWidth = Math.max(7, ...Arr.map(packages, (pkg) => pkg.name.length))
  const lines = [
    `${Str.padEnd(nameWidth)('package')} ${Str.padStart(9)('always')} ${Str.padStart(8)('startup')} ${Str.padStart(10)('on-demand')} ${Str.padStart(10)('total')}`,
  ]

  for (const pkg of packages) {
    const total = pkg.alwaysOn + pkg.startup + pkg.onDemand
    lines.push(
      `${Str.padEnd(nameWidth)(pkg.name)} ${cell(pkg.alwaysOn, 9)} ${cell(pkg.startup, 8)} ${cell(pkg.onDemand, 10)} ${cell(total, 10)}`,
    )
  }

  const alwaysOn = sum(packages, 'alwaysOn')
  const startup = sum(packages, 'startup')
  const onDemand = sum(packages, 'onDemand')
  const resident = alwaysOn + startup

  lines.push(
    `${Str.padEnd(nameWidth)('TOTAL')} ${cell(alwaysOn, 9)} ${cell(startup, 8)} ${cell(onDemand, 10)} ${cell(alwaysOn + startup + onDemand, 10)}`,
  )
  lines.push('')
  lines.push(
    `resident every request: ${NUM.format(resident)} tokens — ${((resident / window) * 100).toFixed(1)}% of a ${NUM.format(window)}-token window`,
  )

  return lines
}

const flags = {
  exact: Flag.Boolean('exact').pipe(
    Flag.withDefault(false),
    Flag.withDescription('Count with the Anthropic API (requires credentials)'),
  ),
  model: Flag.String('model').pipe(
    Flag.withDefault(DEFAULT_MODEL),
    Flag.withDescription('Model whose tokenizer to use for exact counts'),
  ),
  package: Flag.String('package').pipe(
    Flag.withDefault(''),
    Flag.withDescription('Comma-separated package names to include'),
  ),
  all: Flag.Boolean('all').pipe(Flag.withDefault(false), Flag.withDescription('Include prompts and agents')),
  summary: Flag.Boolean('summary').pipe(Flag.withDefault(false), Flag.withDescription('Show per-package totals only')),
  sort: Flag.Literals('sort', ['alwaysOn', 'startup', 'onDemand', 'name']).pipe(Flag.withDefault('onDemand')),
  window: Flag.Finite('window').pipe(
    Flag.withDefault(DEFAULT_WINDOW),
    Flag.withDescription('Context window used to calculate resident percentage'),
  ),
  json: Flag.Boolean('json').pipe(Flag.withDefault(false), Flag.withDescription('Emit a machine-readable report')),
}

type WeighOptions = Command.Command.Config.Infer<typeof flags>

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(Schema.Json, { space: 2 }))

const renderReport = Effect.fnUntraced(function* (packages: PackageWeight[], options: WeighOptions) {
  const { exact, model, window, sort: sortBy } = options
  if (options.json) {
    return yield* encodeReport({
      counter: exact ? { mode: 'exact', model } : { mode: 'estimate' },
      window,
      packages: Arr.map(packages, (pkg) => ({ ...pkg, files: Arr.map(pkg.files, (entry) => ({ ...entry })) })),
      totals: {
        alwaysOn: sum(packages, 'alwaysOn'),
        startup: sum(packages, 'startup'),
        onDemand: sum(packages, 'onDemand'),
      },
    }).pipe(Effect.orDie)
  }

  const out: string[] = []
  if (!options.summary) {
    for (const pkg of packages) {
      out.push(...renderPackage(pkg, sortBy), '')
    }
  }
  out.push(...renderSummary(packages, window))
  out.push('')
  out.push('always    instruction bodies compiled into CLAUDE.md / AGENTS.md')
  out.push('startup   the skill listing line (name + description)')
  out.push('on-demand SKILL.md body and references/, paid only when the skill runs')
  if (Arr.some(packages, (pkg) => Arr.some(pkg.files, (entry) => entry.scoped))) {
    out.push('*         instruction has applyTo — scoped to matching files on harnesses that honor rules files')
  }
  if (!exact) out.push(`counts are estimates (±15%); run with --exact --model ${model} for real numbers`)

  return Arr.join(out, '\n')
})

const weigh = Effect.fn('weigh')(function* (options: WeighOptions) {
  const path = yield* Path.Path
  const root = process.cwd()

  const only = new Set(Arr.filter(Arr.map(Str.split(',')(options.package), Str.trim), Str.isNonEmpty))

  const collect = Effect.fnUntraced(function* <E>(count: (text: string) => Effect.Effect<number, E>) {
    const dirs = yield* findPackageDirs(root)
    const selected = Arr.filter(
      dirs,
      (dir) => only.size === 0 || only.has(path.relative(root, dir)) || only.has(path.basename(dir)),
    )
    const packages = yield* Effect.forEach(selected, (dir) => weighPackage(root, dir, count, options.all), {
      concurrency: 1,
    })

    return Arr.filter(packages, (pkg) => pkg.files.length > 0).sort(
      (a, b) => b.alwaysOn + b.startup + b.onDemand - (a.alwaysOn + a.startup + a.onDemand),
    )
  })

  const packages = yield* options.exact
    ? exactCounter(root, options.model).pipe(
        Effect.flatMap(({ count, flush }) => collect(count).pipe(Effect.onExit(() => flush))),
      )
    : collect((text) => Effect.succeed(estimateTokens(text)))

  const report = yield* renderReport(packages, options)

  yield* Console.log(report)
})

const weighBase = Command.make('weigh', flags).pipe(
  Command.withDescription('Measure the context weight of authored APM primitives'),
)

export const makeWeighCommand = () => weighBase.pipe(Command.withHandler(weigh), Command.provide(Digest.layerWebCrypto))

export const weighCommand = weighBase.pipe(
  Command.withHandler((options) =>
    weigh(options).pipe(withCommandContext('weigh'), reportFailures('ExactCountFailed', 'CommandOperationFailed')),
  ),
  Command.provide(Digest.layerWebCrypto),
)
