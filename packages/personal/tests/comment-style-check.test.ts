import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

const hook = fileURLToPath(new URL('../.apm/hooks/comment_style_check.cjs', import.meta.url))
const hookSource = fileURLToPath(new URL('../src/hooks/comment_style_check.ts', import.meta.url))

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'comment-style-check-'))
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))

  return cwd
}

function runHook(payload: object, cwd = fixture(), entry = hook): string {
  return execFileSync('node', [entry], { cwd, input: JSON.stringify(payload), encoding: 'utf8', stdio: 'pipe' })
}

const editArgs = { path: 'x.py', old_str: 'a = 1', new_str: 'a = 1\n# previously b' } as const
const successResult = { resultType: 'success', textResultForLlm: 'File updated.' } as const

describe('comment-style check', () => {
  describe('tool arguments', () => {
    it('should warn in hookSpecificOutput when a Claude edit adds a history comment', () => {
      const payload = { tool_name: 'Edit', tool_input: editArgs }

      const output = JSON.parse(runHook(payload))

      expect(output.hookSpecificOutput?.additionalContext, 'Claude should receive a history warning').toContain(
        'narrates history',
      )
    })

    it('should warn when a Copilot edit has JSON-encoded toolArgs', () => {
      const payload = { toolName: 'edit', toolArgs: JSON.stringify(editArgs) }

      const output = JSON.parse(runHook(payload))

      expect(output.additionalContext, 'Copilot should receive a history warning').toContain('narrates history')
    })

    it.each([
      ['cannot be parsed', '{not json'],
      ['decode to an array', '[1,2]'],
    ])('should stay silent when Copilot toolArgs %s', (_condition, toolArgs) => {
      const payload = { toolName: 'edit', toolArgs }

      const output = runHook(payload)

      expect(output, 'Invalid toolArgs should produce no output').toBe('')
    })

    it('should warn only about added comments when a Copilot patch includes context lines', () => {
      const patch = `*** Begin Patch
*** Update File: x.py
@@
 # previously kept context
-a = 1
+a = 2
+# no longer used
*** End Patch`
      const payload = { toolName: 'apply_patch', toolArgs: patch }

      const output = JSON.parse(runHook(payload))

      expect(output.additionalContext, 'The warning should flag the added comment').toContain('no longer')
      expect(output.additionalContext, 'The warning should omit the unchanged comment').not.toContain('previously kept')
    })
  })

  it('should warn only about new comments when a write names a symlink', () => {
    const cwd = fixture()
    const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
    const before = '# previously kept\na = 1\n'
    const content = `${before}# no longer used\n`
    git('init', '--quiet')
    writeFileSync(join(cwd, 'target.py'), before)
    git('add', 'target.py')
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '-m',
      'fixture',
    )
    symlinkSync('target.py', join(cwd, 'alias.py'))
    writeFileSync(join(cwd, 'alias.py'), content)

    const output = JSON.parse(runHook({ tool_name: 'Write', tool_input: { file_path: 'alias.py', content } }, cwd))

    expect(output.hookSpecificOutput?.additionalContext, 'new comment should be flagged').toContain('no longer used')
    expect(output.hookSpecificOutput?.additionalContext, 'tracked comment should be ignored').not.toContain(
      'previously kept',
    )
  })

  describe('Lua comments', () => {
    it('should warn when a history comment appears inside a Lua block', () => {
      const content = '--[[\npreviously used\n]]'
      const payload = { tool_name: 'Write', tool_input: { file_path: 'x.lua', content } }

      const output = runHook(payload, fixture(), hookSource)

      expect(output, 'The warning should include the Lua block comment').toContain('previously used')
    })

    it('should stay silent when a history phrase appears in code after a Lua block', () => {
      const content = '--[[ Wait for input. ]] print("previously used")'
      const payload = { tool_name: 'Write', tool_input: { file_path: 'x.lua', content } }

      const output = runHook(payload, fixture(), hookSource)

      expect(output, 'Code after the block should not be treated as a comment').toBe('')
    })
  })

  describe('tool result', () => {
    it.each([
      ['an object', successResult],
      ['a JSON string', JSON.stringify(successResult)],
    ])('should append the warning when Copilot toolResult is %s', (_shape, toolResult) => {
      const payload = { toolName: 'edit', toolArgs: JSON.stringify(editArgs), toolResult }

      const output = JSON.parse(runHook(payload))

      expect(
        output.modifiedResult?.textResultForLlm,
        'The modified result should preserve the original text',
      ).toContain('File updated.')
      expect(
        output.modifiedResult?.textResultForLlm,
        'The modified result should include the history warning',
      ).toContain('narrates history')
    })
  })
})
