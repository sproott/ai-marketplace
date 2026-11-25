import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CREATE_TOOLS, deny, emit, failure, read } from '../../../_shared/hook-io/hook-io.ts'
import { loadRules, match } from './rules_on_create_match.ts'

const markerRoot = '/tmp/claude-rules-on-create'

function markUnseen(directory: string, name: string): boolean {
  try {
    writeFileSync(join(directory, name), '', { flag: 'wx' })
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false
    throw error
  }
}

function main(): void {
  const hook = read('PreToolUse')
  if (!CREATE_TOOLS.has(hook.tool)) return

  // Existing files surface their path rules on the prior read.
  const newFiles = hook.changes.filter(({ path }) => !existsSync(path))
  if (!newFiles.length) return

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const rules = loadRules(projectRoot)
  const matched = new Map(
    newFiles.flatMap(({ path }) => match(path, projectRoot, rules).map((rule) => [rule.name, { path, rule }] as const)),
  )
  if (!matched.size) return

  const session = hook.session_id || 'nosession'
  if (session === '.' || session === '..' || /[/\\\0]/.test(session)) return

  const markerDir = join(markerRoot, session)
  mkdirSync(markerDir, { recursive: true })

  const unseen = [...matched.values()].filter(({ rule }) => markUnseen(markerDir, rule.name))
  if (!unseen.length) return

  const paths = [...new Set(unseen.map(({ path }) => `\`${path}\``))].join(', ')
  const blocks = unseen.map(({ rule }) => `### \`${rule.name}\`\n\n${rule.body}`).join('\n\n')

  // PreToolUse surfaces the rule body through the deny reason.
  emit(
    deny(
      hook,
      `Path-scoped rule(s) govern the new file(s) ${paths}. Read them, then re-issue the write to comply — this block clears once per session.\n\n${blocks}`,
    ),
  )
}

try {
  main()
} catch (error) {
  // Rule lookup is advisory and must not prevent a write when the hook fails, only warn the user.
  emit(null, [failure('rules-on-create', error)])
}
