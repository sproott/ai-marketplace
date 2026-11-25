import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, onTestFinished } from 'vitest'

const bundle = new URL('../.apm/hooks/caveman-hook-io.cjs', import.meta.url)

function run(input: string) {
  const root = mkdtempSync(join(tmpdir(), 'caveman-hook-io-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))

  const wrapper = join(root, 'caveman-hook-io.cjs')
  copyFileSync(bundle, wrapper)
  writeFileSync(
    join(root, 'child.cjs'),
    String.raw`
    const input = require('node:fs').readFileSync(0, 'utf8');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: input } }));
    process.stderr.write('child diagnostic\n');
    process.exitCode = 2;
  `,
  )

  return spawnSync(process.execPath, [wrapper, 'child.cjs'], { input, encoding: 'utf8', timeout: 5000 })
}

describe('caveman hook I/O', () => {
  it('should return non-blocking Copilot context when only the camelCase session key is present', () => {
    const input = JSON.stringify({ sessionId: 'copilot' })

    const { stdout, stderr, status } = run(input)

    assert.deepEqual(
      { stdout, stderr, status },
      {
        stdout: JSON.stringify({ additionalContext: JSON.stringify({ session_id: 'copilot' }) }),
        stderr: '',
        status: 0,
      },
      'Copilot must receive context using its session ID without the child’s diagnostic or blocking status',
    )
  })

  it.each([
    { name: 'only a snake_case session key is present', input: '{ "session_id": "claude" }\n' },
    { name: 'both session key spellings are present', input: '{ "session_id": "claude", "sessionId": "mixed" }\n' },
    {
      name: 'camelCase tool keys appear without a camelCase session',
      input: '{ "session_id": "claude", "toolName": "edit", "toolArgs": "{}" }\n',
    },
  ])('should forward raw input, output and exit status when $name', ({ input }) => {
    const { stdout, stderr, status } = run(input)

    assert.deepEqual(
      { stdout, stderr, status },
      {
        stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: input } }),
        stderr: 'child diagnostic\n',
        status: 2,
      },
      'Claude-shaped envelopes must be passed through without translation',
    )
  })
})
