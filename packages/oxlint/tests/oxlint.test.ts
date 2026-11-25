import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

const hook = fileURLToPath(new URL('../.apm/hooks/oxlint_check.cjs', import.meta.url))
const editedFile = 'packages/app/src dir/a.ts'

type HookResponse = {
  decision?: string
  reason?: string
  additionalContext?: string
  hookSpecificOutput?: { additionalContext?: string }
}

function setupProject(manager = 'npm', exitCode = 1) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'oxlint-hook-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))

  const bin = join(root, 'bin')
  const log = join(root, 'calls')
  mkdirSync(bin)
  writeFileSync(log, '')
  writeFileSync(
    join(bin, manager),
    `#!/bin/sh
printf '%s\\0' "$PWD" "\${0##*/}" "$@" >> "$CALLS"
printf '%s\\n' 'unused variable'
exit ${exitCode}
`,
    { mode: 0o755 },
  )

  function write(path: string, content = '') {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  write(editedFile)

  return {
    root,
    write,
    manifest(value: object, path = 'package.json') {
      write(path, JSON.stringify(value))
    },
    calls: () => readFileSync(log, 'utf8').split('\0').slice(0, -1),
    run(payload: object) {
      return execFileSync(process.execPath, [hook], {
        cwd: root,
        env: { ...process.env, PATH: bin, CALLS: log },
        input: JSON.stringify(payload),
        encoding: 'utf8',
        timeout: 5_000,
      })
    },
  }
}

function edit(path = editedFile) {
  return { tool_name: 'Edit', tool_input: { file_path: path } }
}

function vscodeEdit() {
  return { timestamp: 1, tool_name: 'replace_string_in_file', tool_input: { filePath: editedFile } }
}

function copilotPatch() {
  return { toolName: 'apply_patch', toolArgs: `*** Begin Patch\n*** Update File: ${editedFile}\n*** End Patch` }
}

function response(stdout: string): HookResponse {
  return JSON.parse(stdout)
}

describe('Oxlint hook', () => {
  describe('script execution', () => {
    it('should lint only the edited file when an npm script opts in', () => {
      const project = setupProject()
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint --deny-warnings' } })
      project.write('packages/app/src dir/other.ts')

      project.run(edit())

      expect(project.calls(), 'npm should receive only the edited file after its separator').toEqual([
        project.root,
        'npm',
        'run',
        'lint:oxlint',
        '--',
        '--fix',
        `./${editedFile}`,
      ])
    })

    it('should run the root script once when a patch edits different workspaces', () => {
      const project = setupProject('pnpm')
      const secondFile = 'packages/other/b.ts'
      project.write(secondFile)
      project.manifest({
        packageManager: 'pnpm@10.0.0',
        scripts: { 'lint:oxlint': 'effect-tsgo oxlint --type-aware' },
      })
      project.manifest(
        { packageManager: 'npm@11.0.0', scripts: { 'lint:oxlint': 'oxlint' } },
        'packages/app/package.json',
      )
      const toolArgs = `*** Begin Patch\n*** Update File: ${editedFile}\n*** Update File: ${secondFile}\n*** End Patch`

      project.run({ toolName: 'apply_patch', toolArgs })

      expect(project.calls(), 'the root package manager receives both repo-relative paths in one run').toEqual([
        project.root,
        'pnpm',
        'run',
        'lint:oxlint',
        '--fix',
        `./${editedFile}`,
        `./${secondFile}`,
      ])
    })

    it('should select the manager from the lockfile when no manager is declared', () => {
      const project = setupProject('bun')
      project.write('bun.lock')
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint' } })

      project.run(copilotPatch())

      expect(project.calls(), 'The Bun lockfile should select bun for the file from the patch').toEqual([
        project.root,
        'bun',
        'run',
        'lint:oxlint',
        '--fix',
        `./${editedFile}`,
      ])
    })

    it('should format after linting when both scripts are configured', () => {
      const project = setupProject()
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint', 'format:oxfmt': 'oxfmt' } })

      project.run(edit())

      expect(project.calls(), 'npm should run the formatter on the edited file after linting').toEqual([
        project.root,
        'npm',
        'run',
        'lint:oxlint',
        '--',
        '--fix',
        `./${editedFile}`,
        project.root,
        'npm',
        'run',
        'format:oxfmt',
        '--',
        `./${editedFile}`,
      ])
    })

    it('should escape glob characters when formatting a literal edited path', () => {
      const project = setupProject()
      project.write('app/[id]/a.ts')
      project.write('app/i/a.ts')
      project.manifest({ scripts: { 'format:oxfmt': 'oxfmt' } })

      project.run(edit('app/[id]/a.ts'))

      expect(project.calls(), 'The formatter should receive an escaped pattern for the literal brackets').toEqual([
        project.root,
        'npm',
        'run',
        'format:oxfmt',
        '--',
        './app/[[]id]/a.ts',
      ])
    })

    it('should pass a file as one literal operand when its name starts with a dash and contains shell punctuation', () => {
      const project = setupProject()
      const file = "--flag; 'two words'.ts"
      project.write(file)
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint' } })

      project.run(edit(file))

      expect(project.calls(), 'The edited filename should be one unchanged argument prefixed with ./').toEqual([
        project.root,
        'npm',
        'run',
        'lint:oxlint',
        '--',
        '--fix',
        `./${file}`,
      ])
    })
  })

  describe('host responses', () => {
    it('should block with lint findings when Claude Code reports the edit', () => {
      const project = setupProject()
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint' } })

      const out = response(project.run(edit()))

      expect(out, 'Claude Code should receive a block whose reason includes the lint finding').toMatchObject({
        decision: 'block',
        reason: expect.stringContaining('unused variable'),
      })
    })

    it('should put lint findings in hook context when VS Code reports the edit', () => {
      const project = setupProject()
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint' } })

      const out = response(project.run(vscodeEdit()))

      expect(
        out.hookSpecificOutput?.additionalContext,
        'VS Code hook context should include the lint finding',
      ).toContain('unused variable')
    })

    it('should report non-blocking findings when Copilot CLI reports a patch', () => {
      const project = setupProject()
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint' } })

      const out = response(project.run(copilotPatch()))

      expect(out, 'Copilot CLI should receive no blocking decision').not.toHaveProperty('decision')
      expect(out.additionalContext, 'Copilot CLI top-level context should include the lint finding').toContain(
        'unused variable',
      )
    })
  })

  describe('setup and skip behavior', () => {
    it('should warn without running lint when only the generic script exists', () => {
      const project = setupProject()
      project.manifest({ scripts: { lint: 'oxlint .' } })

      const out = response(project.run(edit()))

      expect(project.calls(), 'The generic lint script should not run').toEqual([])
      expect(out, 'Setup warnings should not block the edit').not.toHaveProperty('decision')
      const context = out.hookSpecificOutput?.additionalContext
      expect(context, 'The warning should explain how to opt in to linting').toContain('lint:oxlint')
      expect(context, 'The warning should explain how to opt in to formatting').toContain('format:oxfmt')
      expect(context, 'The warning should mention the type-aware Effect lint command').toContain(
        'effect-tsgo oxlint --type-aware',
      )
    })

    it('should warn about only the formatter when lint succeeds and the formatter is missing', () => {
      const project = setupProject('npm', 0)
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint' } })

      const out = response(project.run(edit()))

      expect(project.calls(), 'The configured lint script should still run on the edited file').toEqual([
        project.root,
        'npm',
        'run',
        'lint:oxlint',
        '--',
        '--fix',
        `./${editedFile}`,
      ])
      expect(out, 'A missing formatter should not block the edit').not.toHaveProperty('decision')
      const context = out.hookSpecificOutput?.additionalContext
      expect(context, 'The warning should name the missing formatter script').toContain('format:oxfmt')
      expect(context, 'The warning should not name the configured lint script').not.toContain('lint:oxlint')
    })

    it('should warn the user without blocking when the configured package manager is missing', () => {
      const project = setupProject()
      project.manifest({
        packageManager: 'pnpm@10.0.0',
        scripts: { 'lint:oxlint': 'oxlint', 'format:oxfmt': 'oxfmt' },
      })

      const out = JSON.parse(project.run(edit()))

      expect(out, 'a missing executable must only warn the user').toEqual({
        systemMessage:
          'Oxlint hook: `pnpm` is not on PATH; lint:oxlint did not run.\nOxlint hook: `pnpm` is not on PATH; format:oxfmt did not run.',
      })
    })

    it('should stay silent when the tool does not write', () => {
      const project = setupProject()
      project.manifest({ scripts: { 'lint:oxlint': 'oxlint' } })
      const payload = { tool_name: 'Read', tool_input: { file_path: editedFile } }

      const out = project.run(payload)

      expect(out, 'A Read should not produce hook output').toBe('')
      expect(project.calls(), 'A Read should not run lint').toEqual([])
    })
  })
})
