import { BunServices } from '@effect/platform-bun'
import { describe, expect, it, vi } from '@effect/vitest'
import { Array, Config, Effect, FileSystem, Path, Record, Result, String } from 'effect'
import { parse } from 'yaml'
import {
  fallow,
  buildIndex,
  deriveMcpEntry,
  githubAnchor,
  remapCliLinks,
  rewriteManifest,
  splitTopLevelSections,
  stripDuplicateTaskMap,
} from '../src/packages/fallow.ts'

const pathDelimiter = process.platform === 'win32' ? ';' : ':'

it.layer(BunServices.layer)('Fallow package builder', (it) => {
  it.effect('should remove the isolated scratch directory when the pinned installer exits with an error', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const out = yield* fs.makeTempDirectoryScoped()
      const received = path.join(out, 'installer-args')
      const originalPath = yield* Config.String('PATH').pipe(Config.withDefault(''))

      yield* fs.writeFileString(path.join(out, 'apm.yml'), 'version: "1.2.3"\ndependencies:\n  mcp: []\n')
      yield* fs.writeFileString(path.join(out, 'bunx'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$RECEIVED"\nexit 17\n')
      yield* fs.chmod(path.join(out, 'bunx'), 0o755)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          vi.stubEnv('PATH', `${out}${pathDelimiter}${originalPath}`)
          vi.stubEnv('RECEIVED', received)
        }),
        () => Effect.sync(() => vi.unstubAllEnvs()),
      )

      const error = yield* Effect.flip(fallow.build(out))

      const receivedArgs = yield* fs.readFileString(received)
      const args = String.split(String.trimEnd(receivedArgs), '\n')
      const scratch = args[4] ?? ''

      expect(error, 'the subprocess error should identify the invocation and exit status').toMatchObject({
        _tag: 'SubprocessExited',
        command: 'bunx',
        args,
        status: 17,
      })
      expect(scratch, 'the installer should receive an isolated scratch path').not.toBe('')
      expect(args, 'the installer should receive the exact pin and Claude harness options').toEqual([
        'fallow@1.2.3',
        'agent',
        'install',
        '--root',
        scratch,
        '--harness',
        'claude',
        '--approve',
      ])

      const scratchExists = yield* fs.exists(scratch)

      expect(scratchExists, 'the temporary scratch directory should be gone after failure').toBe(false)
    }),
  )

  it.effect('should preserve the descriptor and instruction bytes when the installer emits the expected files', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const out = yield* fs.makeTempDirectoryScoped()
      const originalPath = yield* Config.String('PATH').pipe(Config.withDefault(''))
      const installer = `#!/bin/sh
set -eu
root="$5"
mkdir -p "$root/.claude/skills/fallow/references" "$root/.claude/hooks"
printf '## Flags\n' > "$root/.claude/skills/fallow/references/cli-reference.md"
: > "$root/.claude/hooks/fallow-gate.sh"
cat > "$root/AGENTS.md" <<'EOF'
# Fixture

## Fallow

| Task | Command |

## Other

<!-- fallow:setup-hooks:start -->
See the task map below.

## Fallow task map

| Task | Command |
<!-- fallow:setup-hooks:end -->
EOF
printf '%s\n' '{"mcpServers":{"fallow":{"type":"stdio","command":"fallow-mcp"}}}' > "$root/.mcp.json"
`

      yield* fs.writeFileString(path.join(out, 'apm.yml'), 'version: "1.2.3"\ndependencies:\n  mcp: []\n')
      yield* fs.writeFileString(path.join(out, 'bunx'), installer)
      yield* fs.chmod(path.join(out, 'bunx'), 0o755)
      yield* Effect.acquireRelease(
        Effect.sync(() => vi.stubEnv('PATH', `${out}${pathDelimiter}${originalPath}`)),
        () => Effect.sync(() => vi.unstubAllEnvs()),
      )

      yield* fallow.build(out)

      const descriptor = yield* fs.readFileString(path.join(out, '.apm/hooks/fallow-gate.json'))
      expect(descriptor, 'the JSON descriptor should retain two-space indentation and the trailing newline').toBe(`{
  "PreToolUse": [
    {
      "matcher": "Bash|bash",
      "hooks": [
        {
          "type": "command",
          "command": "./fallow-gate-io.sh"
        }
      ]
    }
  ]
}
`)
      const instruction = yield* fs.readFileString(path.join(out, '.apm/instructions/fallow-task-map.instructions.md'))
      expect(instruction, 'the instruction should retain its quoted description and rewritten task map').toBe(`---
description: "Standing rule for fallow: the task-command map (which fallow command to run before a given edit/commit/PR action) and the local pre-commit/pre-push audit gate."
---

## Fallow

| Task | Command |

<!-- fallow:setup-hooks:start -->
See the task map above.

<!-- fallow:setup-hooks:end -->
`)
    }),
  )
})

describe('Fallow task map', () => {
  it.each([
    { source: 'the task map below', error: { _tag: 'MissingTaskMapHeading' } },
    { source: 'See the map.\n## Fallow task map\n', error: { _tag: 'UnexpectedTaskMapDirectionCount', count: 0 } },
    {
      source: 'the task map below; the task map below\n## Fallow task map\n',
      error: { _tag: 'UnexpectedTaskMapDirectionCount', count: 2 },
    },
  ])('should return $error._tag error when the task map input is $source', ({ source, error }) => {
    const result = stripDuplicateTaskMap(source)

    expect(result, 'the error should identify the upstream file and task map mismatch').toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: 'FallowBuildError',
          reason: expect.objectContaining({ ...error, file: 'AGENTS.md' }),
        }),
      ),
    )
  })

  it('should point to the earlier table when the task map direction appears once', () => {
    const source =
      '<!-- fallow:setup-hooks:start -->\nSee the task map below.\n## Fallow task map\n| Duplicate |\n<!-- fallow:setup-hooks:end -->'

    const result = stripDuplicateTaskMap(source)

    expect(result, 'the gate prose should reference the first table and drop the duplicate').toEqual(
      Result.succeed('<!-- fallow:setup-hooks:start -->\nSee the task map above.\n\n<!-- fallow:setup-hooks:end -->'),
    )
  })
})

describe('Fallow MCP dependency', () => {
  it.each([{ names: [] }, { names: ['first', 'second'] }])(
    'should return UnexpectedMcpServerCount error when the server names are $names',
    ({ names }) => {
      const mcpServers = Record.fromEntries(
        Array.map(names, (name) => [name, { type: 'stdio', command: 'fallow-mcp' }] as const),
      )

      const result = deriveMcpEntry({ mcpServers })

      expect(result, 'the error should identify the upstream file and number of servers').toEqual(
        Result.fail(
          expect.objectContaining({
            _tag: 'FallowBuildError',
            reason: { _tag: 'UnexpectedMcpServerCount', file: '.mcp.json', count: names.length },
          }),
        ),
      )
    },
  )

  it.effect.each([
    {
      manifest: 'dependencies: [',
      error: { _tag: 'InvalidManifestYaml', parseError: expect.objectContaining({ code: 'BAD_INDENT' }) },
    },
    { manifest: 'dependencies: {mcp: old}', error: { _tag: 'InvalidManifestMcpSequence', found: 'non-sequence' } },
    { manifest: 'dependencies: {}', error: { _tag: 'InvalidManifestMcpSequence', found: 'missing' } },
  ])('should return $error._tag error when the manifest is $manifest', ({ manifest, error: expected }) =>
    Effect.gen(function* () {
      const entry = yield* Effect.fromResult(
        deriveMcpEntry({ mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp' } } }),
      )

      const error = yield* Effect.flip(rewriteManifest(manifest, 'fixture/apm.yml', entry))

      expect(error, 'the error should identify the manifest and structural mismatch').toMatchObject({
        _tag: 'FallowBuildError',
        reason: { ...expected, file: 'fixture/apm.yml' },
      })
    }),
  )

  it.effect.each([
    { label: 'an empty flow sequence', manifest: 'dependencies: {mcp: [], apm: []} # keep\n', original: '[]' },
    {
      label: 'a populated flow sequence',
      manifest: 'dependencies: {mcp: [{name: old}], apm: []} # keep\n',
      original: '[{name: old}]',
    },
    {
      label: 'a flow sequence with a trailing comment',
      manifest: 'dependencies:\n  mcp: [] # keep\n  apm: []\n',
      original: '[]',
    },
  ])('should replace only the MCP sequence when the manifest uses $label', ({ manifest, original }) =>
    Effect.gen(function* () {
      const entry = yield* Effect.fromResult(
        deriveMcpEntry({
          mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp', args: ['a, b', 'false', 'a\nb'] } },
        }),
      )
      const start = yield* Effect.fromOption(String.indexOf(original)(manifest))
      const prefix = String.slice(0, start)(manifest)
      const suffix = String.slice(start + original.length)(manifest)

      const output = yield* rewriteManifest(manifest, 'fixture/apm.yml', entry)

      expect(parse(output), 'the output should parse as the new MCP entry and unchanged APM dependencies').toEqual({
        dependencies: { mcp: [entry], apm: [] },
      })
      expect(
        String.startsWith(`${prefix}[`)(output),
        'the prefix should be unchanged and the sequence should stay in flow style',
      ).toBe(true)
      expect(String.endsWith(`]${suffix}`)(output), 'the suffix should stay byte-for-byte identical').toBe(true)
    }),
  )

  it.effect('should retain the default manifest bytes when the upstream server is unchanged', () =>
    Effect.gen(function* () {
      const manifest = Array.join(
        [
          'name: fallow',
          'version: 3.25.0',
          'dependencies:',
          '  apm: []',
          '  # keep',
          '  mcp:',
          '    - name: fallow',
          '      registry: false',
          '      transport: stdio',
          '      command: fallow-mcp',
          'includes: auto',
          '',
        ],
        '\n',
      )
      const entry = yield* Effect.fromResult(
        deriveMcpEntry({ mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp' } } }),
      )

      const output = yield* rewriteManifest(manifest, 'fixture/apm.yml', entry)

      expect(output, 'the default manifest should be byte-for-byte unchanged').toBe(manifest)
    }),
  )

  it.effect('should retain indentation and line endings when the MCP sequence uses indentless CRLF YAML', () =>
    Effect.gen(function* () {
      const manifest = 'dependencies:\r\n  mcp:\r\n  - name: old\r\n  apm: []\r\n'
      const entry = yield* Effect.fromResult(
        deriveMcpEntry({ mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp' } } }),
      )

      const output = yield* rewriteManifest(manifest, 'fixture/apm.yml', entry)

      expect(output, 'the new entry should use the existing indentation and CRLF line endings').toBe(
        'dependencies:\r\n  mcp:\r\n  - name: fallow\r\n    registry: false\r\n    transport: stdio\r\n    command: fallow-mcp\r\n  apm: []\r\n',
      )
    }),
  )

  it.each([
    { args: [], expected: {} },
    { args: ['--foo'], expected: { args: ['--foo'] } },
  ])('should preserve only nonempty args when the upstream server has args $args', ({ args, expected }) => {
    const upstream = { mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp', args } } }

    const entry = deriveMcpEntry(upstream)

    expect(entry, 'the dependency should match the APM MCP server shape').toEqual(
      Result.succeed({
        name: 'fallow',
        registry: false,
        transport: 'stdio',
        command: 'fallow-mcp',
        ...expected,
      }),
    )
  })
})

describe('Fallow CLI reference', () => {
  it('should drop punctuation when slugging a command heading', () => {
    const heading = '`dead-code`: Dead Code Analysis'

    const anchor = githubAnchor(heading)

    expect(anchor, 'the anchor should match GitHub heading links').toBe('dead-code-dead-code-analysis')
  })

  it('should retain the introductory block when splitting the sections', () => {
    const source = '# Fallow CLI Reference\n\nIntro line.\n\n## Global Flags\n\nFlag prose.'

    const { preamble } = splitTopLevelSections(source)

    expect(preamble, 'the title and introduction should remain together').toBe('# Fallow CLI Reference\n\nIntro line.')
  })

  it('should split only real section headings when a code fence contains heading syntax', () => {
    const source = '## `dead-code`: Dead Code Analysis\n\n```bash\n## Not a heading\n```\n\n## Global Flags\n'

    const { sections } = splitTopLevelSections(source)

    expect(
      Array.map(sections, (section) => section.file),
      'only the command and prose headings should own part files',
    ).toEqual(['dead-code.md', 'global-flags.md'])
    expect(sections[0]?.body, 'the fenced heading should stay in the command part').toBe(
      '```bash\n## Not a heading\n```',
    )
  })

  it.each([
    { link: '#global-flags', prefix: '', bare: true, expected: 'global-flags.md' },
    { link: 'cli-reference.md#global-flags', prefix: 'cli/', bare: false, expected: 'cli/global-flags.md' },
    {
      link: 'references/cli-reference.md',
      prefix: 'references/cli/',
      bare: false,
      expected: 'references/cli-reference.md',
    },
    { link: 'cli-reference.md#nope', prefix: 'cli/', bare: false, expected: 'cli-reference.md#nope' },
  ])('should target $expected when rewriting $link', ({ link, prefix, bare, expected }) => {
    const { sections } = splitTopLevelSections('## Global Flags\n\nFlag prose.')

    const result = remapCliLinks(`See [flags](${link}).`, sections, prefix, bare)

    expect(result, 'the link should point to the owning part or retain its original destination').toBe(
      `See [flags](${expected}).`,
    )
  })

  it('should group commands and reference topics when building the index', () => {
    const { preamble, sections } = splitTopLevelSections(
      '# CLI\n\n## `dead-code`: Dead Code Analysis\n\n## Global Flags',
    )

    const index = buildIndex(preamble, sections)

    expect(index, 'the index should link each part under its category').toBe(
      Array.join(
        [
          '# CLI',
          '',
          '## Commands',
          '',
          '- [`dead-code`: Dead Code Analysis](cli/dead-code.md)',
          '',
          '## Reference',
          '',
          '- [Global Flags](cli/global-flags.md)',
          '',
        ],
        '\n',
      ),
    )
  })
})
