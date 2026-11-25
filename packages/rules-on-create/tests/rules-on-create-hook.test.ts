import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { match } from '../src/hooks/rules_on_create_match.ts'

const hook = fileURLToPath(new URL('../.apm/hooks/rules_on_create.cjs', import.meta.url))

function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'rules-on-create-'))
  const session = `test-${basename(root)}`
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(join('/tmp/claude-rules-on-create', session), { recursive: true, force: true })
  })

  const project = join(root, 'project')
  const home = join(root, 'home')
  const rules = join(project, '.claude', 'rules')
  mkdirSync(rules, { recursive: true })
  mkdirSync(home)
  writeFileSync(
    join(rules, 'style.md'),
    `---
paths:
  - 'src/*/test[0-9].{ts,tsx}'
---
Use the project test style.
`,
  )

  function runHook(payload: object): string {
    return execFileSync('node', [hook], {
      cwd: project,
      env: { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: home },
      input: JSON.stringify(payload),
      encoding: 'utf8',
    })
  }

  return { project, session, runHook }
}

describe('rules on create', () => {
  describe('recursive path rules', () => {
    it.each(['src/a.ts', 'src/lib/nested/a.ts'])('should match when %s is under src', (path) => {
      const { project } = setupProject()
      const rules = [{ name: 'typescript', globs: ['src/**/*.ts'], body: 'Use the TypeScript style.' }]

      const matched = match(join(project, path), project, rules)

      expect(matched, 'A TypeScript rule should match at any depth under src').toEqual(rules)
    })

    it('should not match when a TypeScript file is under a sibling directory', () => {
      const { project } = setupProject()
      const rules = [{ name: 'typescript', globs: ['src/**/*.ts'], body: 'Use the TypeScript style.' }]

      const matched = match(join(project, 'src-other/a.ts'), project, rules)

      expect(matched, 'The rule should require the src directory').toEqual([])
    })
  })

  it('should deny once per session when a Claude write creates a matching path', () => {
    const { session, runHook } = setupProject()
    const payload = {
      session_id: session,
      tool_name: 'Write',
      tool_input: { file_path: 'src/nested/sub/test1.tsx', content: 'x' },
    }

    const first = JSON.parse(runHook(payload))
    const second = runHook(payload)

    expect(first.hookSpecificOutput.permissionDecisionReason, 'The denial should include the matching rule').toContain(
      'Use the project test style.',
    )
    expect(second, 'The same session should receive no second denial').toBe('')
  })

  it('should include the added path when a Copilot patch matches a rule', () => {
    const { session, runHook } = setupProject()
    const payload = {
      sessionId: session,
      toolName: 'apply_patch',
      toolArgs: '*** Begin Patch\n*** Add File: src/nested/test2.ts\n+x\n*** End Patch',
    }

    const output = JSON.parse(runHook(payload))

    expect(output.permissionDecisionReason, 'The denial should name the added file').toContain('`src/nested/test2.ts`')
  })

  it('should deny when a VS Code create_file call targets a matching path', () => {
    const { session, runHook } = setupProject()
    const payload = {
      session_id: session,
      timestamp: 1,
      tool_name: 'create_file',
      tool_input: { filePath: 'src/nested/test3.ts', content: 'x' },
    }

    const output = JSON.parse(runHook(payload))

    expect(output.hookSpecificOutput?.permissionDecision, 'VS Code should receive a denial').toBe('deny')
  })

  it('should stay silent when a matching path already exists', () => {
    const { project, session, runHook } = setupProject()
    const file = 'src/nested/test4.ts'
    mkdirSync(join(project, 'src', 'nested'), { recursive: true })
    writeFileSync(join(project, file), '')
    const payload = { session_id: session, tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }

    const output = runHook(payload)

    expect(output, 'Writing an existing file should produce no output').toBe('')
  })

  it('should stay silent when a Read call targets a matching path', () => {
    const { session, runHook } = setupProject()
    const payload = { session_id: session, tool_name: 'Read', tool_input: { file_path: 'src/nested/test5.ts' } }

    const output = runHook(payload)

    expect(output, 'Reading a matching path should produce no output').toBe('')
  })
})
