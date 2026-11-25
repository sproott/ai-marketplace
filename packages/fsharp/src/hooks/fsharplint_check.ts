import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { block, emit, failure, read, WRITE_TOOLS } from '../../../_shared/hook-io/hook-io.ts'

const EXTENSIONS = new Set(['.fs', '.fsx'])
// All subprocesses share a budget below the host's 60 s timeout.
const BUDGET_MS = 50_000
const MAX_LISTED = 30
const FINDING = /^.+\((\d+),\d+,\d+,\d+\):FSharpLint (?:warning|error) (FL\d+): (.*)$/
const UNRESTORED = 'dotnet tool restore'

type Finding = { line: number; detail: string }

function hasFsharplint(manifest: string): boolean {
  try {
    const data: unknown = JSON.parse(readFileSync(manifest, 'utf8'))

    return (
      typeof data === 'object' &&
      data !== null &&
      'tools' in data &&
      typeof data.tools === 'object' &&
      data.tools !== null &&
      Object.hasOwn(data.tools, 'dotnet-fsharplint')
    )
  } catch {
    return false
  }
}

function manifestRoot(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    for (const candidate of [join(dir, '.config', 'dotnet-tools.json'), join(dir, 'dotnet-tools.json')]) {
      try {
        if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
          return hasFsharplint(candidate) ? dir : undefined
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOTDIR')) throw error
      }
    }

    if (dir === dirname(dir)) return
  }
}

function resolveFile(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    // An edit payload can name a missing file; still resolve symlinks in its ancestors.
    const parent = dirname(path)
    return path === parent ? path : join(resolveFile(parent), basename(path))
  }
}

const OUT_OF_TIME = 'FSharpLint hook ran out of time; some edited F# files were not linted.'

function dotnet(args: string[], cwd: string, deadline: number, warnings: Set<string>) {
  const remaining = Math.floor(deadline - performance.now())
  if (remaining <= 0) {
    warnings.add(OUT_OF_TIME)
    return
  }

  const result = spawnSync('dotnet', args, {
    cwd,
    encoding: 'utf8',
    timeout: remaining,
    killSignal: 'SIGKILL',
    maxBuffer: Infinity,
  })

  if (!result.error) return result

  const code = 'code' in result.error ? result.error.code : undefined
  warnings.add(
    code === 'ENOENT'
      ? 'FSharpLint hook: `dotnet` is not on PATH; edited F# files were not linted.'
      : code === 'ETIMEDOUT'
        ? OUT_OF_TIME
        : `FSharpLint hook: \`dotnet ${args.join(' ')}\` failed: ${result.error.message}`,
  )
}

function lint(file: string, root: string, deadline: number, restored: Set<string>, warnings: Set<string>) {
  // FSharpLint treats --format as a global option.
  const command = ['fsharplint', '--format', 'msbuild', 'lint', file]
  const result = dotnet(command, root, deadline, warnings)
  if (!result?.stderr.includes(UNRESTORED) || restored.has(root)) return result

  restored.add(root)
  const restore = dotnet(['tool', 'restore'], root, deadline, warnings)
  if (restore?.status === 0) return dotnet(command, root, deadline, warnings)

  if (restore)
    warnings.add(
      `FSharpLint hook: \`dotnet tool restore\` failed in ${root} (exit ${restore.status}); F# files there were not linted.`,
    )
}

function findingsIn(output: string): Finding[] {
  const findings: Finding[] = []

  for (const text of output.split(/\r\n|[\r\n]/)) {
    const match = FINDING.exec(text)
    if (!match) continue

    const [, line, rule, message] = match
    findings.push({ line: Number(line), detail: `${rule} ${message}` })
  }

  return findings.sort((a, b) => a.line - b.line || (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0))
}

function report(path: string, findings: Finding[]): string {
  const lines = findings.slice(0, MAX_LISTED).map(({ line, detail }) => `${path}:${line} ${detail}`)

  if (findings.length > MAX_LISTED) lines.push(`… +${findings.length - MAX_LISTED} more`)

  return `FSharpLint: ${findings.length} finding(s) in ${path}. Fix them before moving on.\n\n${lines.join('\n')}`
}

function main(): void {
  const hook = read('PostToolUse')

  if (!WRITE_TOOLS.has(hook.tool)) return

  const paths = new Set(
    hook.changes.map((change) => change.path).filter((path) => EXTENSIONS.has(extname(path).toLowerCase())),
  )
  if (!paths.size) return

  const deadline = performance.now() + BUDGET_MS
  const restored = new Set<string>()
  const reports: string[] = []
  const warnings = new Set<string>()

  for (const path of paths) {
    const file = resolveFile(resolve(path))
    const root = manifestRoot(dirname(file))
    if (!root) continue

    const result = lint(file, root, deadline, restored, warnings)
    if (!result) continue

    const findings = findingsIn(result.stdout)
    if (findings.length) reports.push(report(path, findings))
    else if (result.status !== 0) {
      const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).at(-1)
      warnings.add(
        `FSharpLint hook: \`dotnet fsharplint\` exited ${result.status} on ${path} without findings${detail ? `: ${detail}` : ''}`,
      )
    }
  }

  emit(reports.length ? block(hook, reports.join('\n\n')) : null, warnings)
}

try {
  main()
} catch (error) {
  // A broken toolchain must never block an edit, only warn the user.
  emit(null, [failure('FSharpLint', error)])
}
