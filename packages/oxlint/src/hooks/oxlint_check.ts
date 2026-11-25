import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fallback, object, optional, safeParse, string } from 'valibot'
import { block, context, emit, failure, read, WRITE_TOOLS } from '../../../_shared/hook-io/hook-io.ts'

const LINT = 'lint:oxlint'
const FORMAT = 'format:oxfmt'
const SETUP = {
  [LINT]:
    '"lint:oxlint": "oxlint --format=agent --deny-warnings --no-error-on-unmatched-pattern". ' +
    'If the repo uses Effect linting, use `effect-tsgo oxlint --type-aware` in place of `oxlint`. ' +
    'Keep project flags, omit file/directory arguments and --fix, and install missing tools locally.',
  [FORMAT]:
    '"format:oxfmt": "oxfmt --no-error-on-unmatched-pattern". ' +
    'Keep project flags, omit file/directory arguments and --check, and install oxfmt locally if needed.',
}
const scripts = [LINT, FORMAT] as const
type Script = (typeof scripts)[number]

const lintExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.vue',
  '.svelte',
  '.astro',
])
const lockfiles = {
  bun: ['bun.lock', 'bun.lockb'],
  pnpm: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  yarn: ['yarn.lock', '.pnp.cjs'],
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
}
type Manager = keyof typeof lockfiles
const isManager = (value: string): value is Manager => Object.hasOwn(lockfiles, value)

const text = fallback(optional(string()), undefined)
const manifestSchema = object({
  packageManager: text,
  scripts: fallback(optional(object({ [LINT]: text, [FORMAT]: text })), undefined),
})

function readManifest(directory: string) {
  try {
    const parsed = safeParse(manifestSchema, JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')))
    return parsed.success ? parsed.output : undefined
  } catch {
    return undefined
  }
}

function editedFile(root: string, path: string): string | undefined {
  try {
    const file = realpathSync(resolve(root, path))
    const local = relative(root, file)
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) return undefined

    return statSync(file).isFile() ? `./${local.split(sep).join('/')}` : undefined
  } catch {
    return undefined
  }
}

function runScript(
  directory: string,
  manager: Manager,
  script: Script,
  files: string[],
  timeout: number,
  failures: string[],
): string | undefined {
  const separator = manager === 'npm' ? ['--'] : []
  // Oxfmt interprets existing file paths as glob patterns.
  const args = script === LINT ? ['--fix', ...files] : files.map((file) => file.replace(/[[*?{}]/g, '[$&]'))
  const result = spawnSync(manager, ['run', script, ...separator, ...args], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
  })

  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    failures.push(`Oxlint hook: \`${manager}\` is not on PATH; ${script} did not run.`)
    return undefined
  }
  if (result.error || result.status === null) {
    failures.push(`Oxlint hook: ${script} did not finish (${result.error?.message ?? `killed by ${result.signal}`}).`)
    return undefined
  }
  if (result.status === 0) return undefined

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(-4000)
  return `${script} exited with status ${result.status}:\n${output}`
}

function main(): void {
  const deadline = performance.now() + 50_000
  const hook = read('PostToolUse')
  if (!WRITE_TOOLS.has(hook.tool)) return

  const root = realpathSync(process.cwd())
  const files = [...new Set(hook.changes.map(({ path }) => editedFile(root, path)))].filter(
    (file) => file !== undefined,
  )
  if (!files.length) return

  const manifest = readManifest(root)
  const detected = Object.entries(lockfiles).find(([, locks]) => locks.some((lock) => existsSync(join(root, lock))))
  const manager = manifest?.packageManager?.split('@')[0] || detected?.[0] || 'npm'
  if (!isManager(manager)) {
    emit(context(hook, `Oxlint hook: unsupported package manager '${manager}' in the root package.json.`))
    return
  }

  const warnings: string[] = []
  const findings: string[] = []
  const failures: string[] = []
  for (const script of scripts) {
    if (!manifest?.scripts?.[script]?.trim()) {
      warnings.push(`Oxlint hook: in the root package.json scripts, add ${SETUP[script]}`)
      continue
    }

    const paths = script === LINT ? files.filter((file) => lintExtensions.has(extname(file))) : files
    if (!paths.length) continue

    const remaining = Math.floor(deadline - performance.now())
    if (remaining <= 0) {
      warnings.push('Oxlint hook ran out of time; some edited files were not checked.')
      break
    }

    const finding = runScript(root, manager, script, paths, Math.min(20_000, remaining), failures)
    if (finding) findings.push(finding)
  }

  const response = findings.length
    ? block(hook, [...findings, ...warnings].join('\n\n'))
    : warnings.length
      ? context(hook, warnings.join('\n'))
      : null
  emit(response, failures)
}

try {
  main()
} catch (error) {
  // Unexpected hook failures must not block edits, only warn the user.
  emit(null, [failure('Oxlint', error)])
}
