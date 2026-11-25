import { BunServices } from '@effect/platform-bun'
import { describe, expect, it, layer } from '@effect/vitest'
import { vi } from 'vitest'
import { Array as Arr, Effect, FileSystem, Layer, Schema, String as Str } from 'effect'
import { Command } from 'effect/cli'
import { TestConsole } from 'effect/testing'
import { decodeFrontmatter } from '../src/commands/weigh/frontmatter.ts'
import { classify, estimateTokens, listingLine, makeWeighCommand } from '../src/commands/weigh/weigh.ts'

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const run = Command.runWith(makeWeighCommand(), { version: '0.0.0', renderErrors: false })

vi.mock('@anthropic-ai/sdk', () => ({
  APIError: class extends Error {},
  default: class {
    messages = { countTokens: () => Promise.resolve({ input_tokens: 7 }) }
  },
}))

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = yield* fs.makeTempDirectoryScoped()
  yield* fs.makeDirectory(`${root}/packages/demo/.apm/instructions`, { recursive: true })
  yield* fs.writeFileString(`${root}/packages/demo/.apm/instructions/example.md`, 'the')
  yield* Effect.acquireRelease(
    Effect.sync(() => vi.spyOn(process, 'cwd').mockReturnValue(root)),
    (spy) =>
      Effect.sync(() => {
        spy.mockRestore()
      }),
  )
  return { fs, root }
})

describe('weigh', () => {
  describe('classification', () => {
    it.each([
      ['instructions/sdd.instructions.md', 'instruction'],
      ['skills/specify/SKILL.md', 'skill'],
      ['skills/fallow/references/mcp.md', 'reference'],
      ['skills/apm-install-deps/scripts/install-all.sh', null],
      ['skills/x/scripts/notes.md', null],
      ['hooks/hooks.json', null],
    ])('should classify %s when its expected kind is %s', (file, kind) => {
      const result = classify(file)

      expect(result, 'Path should determine whether and how the primitive is counted').toBe(kind)
    })
  })

  describe('frontmatter', () => {
    it.effect.each([
      [
        'fields',
        '---\nname: specify\ndescription: Writes a spec.\n---\n\nBody.',
        { name: 'specify', description: 'Writes a spec.' },
        'single-line fields are present',
      ],
      [
        'fields',
        '---\nname: caveman\ndescription: >\n  First line\n  second line.\nother: x\n---\nBody.',
        { name: 'caveman', description: 'First line second line.', other: 'x' },
        'a folded scalar is present',
      ],
      [
        'fields',
        '---\ndescription: |\n  First line\n  second line.\n---\nBody.',
        { description: 'First line\nsecond line.' },
        'a literal scalar is present',
      ],
      ['fields', '---\napplyTo: "**/*.ts"\n---\nBody.', { applyTo: '**/*.ts' }, 'a value is quoted'],
      ['body', '---\nname: x\n---\n\nBody text.\n', 'Body text.', 'frontmatter is present'],
      ['body', 'Body only.', 'Body only.', 'frontmatter is absent'],
    ] as const)('should return the expected %s for %j as %j when %s', ([part, text, expected]) =>
      Effect.gen(function* () {
        const parsed = yield* decodeFrontmatter('fixture.md', text)

        expect(parsed[part], 'Frontmatter should preserve scalar semantics and separate the body').toEqual(expected)
      }),
    )
  })

  it('should use the skill directory name when frontmatter has no name', () => {
    const fields = { description: 'Does a thing.' }

    const line = listingLine('my-skill', fields)

    expect(line, 'Listing should use the directory and keep the description').toBe('- my-skill: Does a thing.')
  })

  describe('estimation', () => {
    it.each([
      ['', 0],
      ['the', 1],
    ] as const)('should count text %j when the expected count is %s', (text, expected) => {
      const tokens = estimateTokens(text)

      expect(tokens, 'Estimator should count the exact number of tokens for this input').toBe(expected)
    })

    it('should stay within 25% of one token per four characters when estimating English prose', () => {
      const prose = Str.repeat(20)('The quick brown fox jumps over the lazy dog near the river bank every morning. ')

      const ratio = estimateTokens(prose) / (prose.length / 4)

      expect(Math.abs(ratio - 1), 'Estimate should be within the tolerance for ordinary prose').toBeLessThan(0.25)
    })

    it('should increase when more words are appended', () => {
      const text = 'one two three'

      const tokens = estimateTokens(`${text} four five`)

      expect(tokens, 'Longer text should have more estimated tokens').toBeGreaterThan(estimateTokens(text))
    })
  })

  layer(Layer.merge(BunServices.layer, TestConsole.layer), { buildPerTest: true })((it) => {
    it.effect('should emit only the JSON report when --json selects an estimated package', () =>
      Effect.gen(function* () {
        const { root } = yield* fixture

        yield* run(['--json', '--package', 'other, demo', '--window', '100'])

        const expected = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json, { space: 2 }))({
          counter: { mode: 'estimate' },
          window: 100,
          packages: [
            {
              name: 'packages/demo',
              dir: `${root}/packages/demo`,
              files: [
                {
                  file: 'instructions/example.md',
                  kind: 'instruction',
                  scoped: false,
                  alwaysOn: 1,
                  startup: 0,
                  onDemand: 0,
                },
              ],
              alwaysOn: 1,
              startup: 0,
              onDemand: 0,
            },
          ],
          totals: { alwaysOn: 1, startup: 0, onDemand: 0 },
        })
        const lines = yield* TestConsole.logLines

        expect(lines, 'Stdout should be one JSON report with no extra text').toEqual([expected])
      }),
    )

    it.effect('should count a reference verbatim when its opening block is not valid YAML', () =>
      Effect.gen(function* () {
        const { fs, root } = yield* fixture
        const file = 'skills/demo/reference/example.md'
        const text = '---\ndescription: [unterminated\n---\n\nReference body.\n'

        yield* fs.makeDirectory(`${root}/packages/demo/.apm/skills/demo/reference`, { recursive: true })
        yield* fs.writeFileString(`${root}/packages/demo/.apm/${file}`, text)

        yield* run(['--json'])

        const [line] = yield* TestConsole.logLines
        const report = yield* decodeJson(line)

        expect(report, 'The full reference text should count only as on-demand context').toMatchObject({
          packages: [
            {
              files: expect.arrayContaining([
                { file, kind: 'reference', scoped: false, alwaysOn: 0, startup: 0, onDemand: estimateTokens(text) },
              ]),
            },
          ],
        })
      }),
    )

    it.effect('should keep the report readable when a skill has an unquoted colon', () =>
      Effect.gen(function* () {
        const { fs, root } = yield* fixture
        const skill = `${root}/packages/demo/.apm/skills/demo`

        yield* fs.makeDirectory(skill, { recursive: true })
        yield* fs.writeFileString(
          `${skill}/SKILL.md`,
          '---\ndescription: Use when: the user asks\n---\n\nSkill body.\n',
        )

        yield* run(['--json'])

        const [line] = yield* TestConsole.logLines
        const report = yield* decodeJson(String(line))
        const warnings = yield* TestConsole.errorLines
        expect(report, 'JSON stdout still contains the valid package').toMatchObject({
          packages: [expect.objectContaining({ name: 'packages/demo' })],
        })
        expect(warnings, 'stderr identifies the skipped skill').toEqual([expect.stringContaining(`${skill}/SKILL.md`)])
      }),
    )

    it.effect('should render the original summary when --summary is passed', () =>
      Effect.gen(function* () {
        yield* fixture

        yield* run(['--summary'])

        const lines = yield* TestConsole.logLines

        expect(lines, 'Summary should show totals, window usage and the legend').toEqual([
          Arr.join(
            [
              'package          always  startup  on-demand      total',
              'packages/demo         1        ·          ·          1',
              'TOTAL                 1        ·          ·          1',
              '',
              'resident every request: 1 tokens — 0.0% of a 200,000-token window',
              '',
              'always    instruction bodies compiled into CLAUDE.md / AGENTS.md',
              'startup   the skill listing line (name + description)',
              'on-demand SKILL.md body and references/, paid only when the skill runs',
              'counts are estimates (±15%); run with --exact --model claude-opus-5 for real numbers',
            ],
            '\n',
          ),
        ])
      }),
    )

    it.effect('should emit and cache the mocked count when --exact selects a custom model', () =>
      Effect.gen(function* () {
        const { fs, root } = yield* fixture

        yield* run(['--json', '--exact', '--model', 'fixture-model'])

        const [line] = yield* TestConsole.logLines
        const report = yield* decodeJson(line)
        const cached = yield* fs.readFileString(`${root}/.cache/context-weight-tokens.json`)
        const cache = yield* decodeJson(cached)

        expect(report, 'Exact report should identify the model and use the transport count').toMatchObject({
          counter: { mode: 'exact', model: 'fixture-model' },
          totals: { alwaysOn: 7, startup: 0, onDemand: 0 },
        })
        expect(cache, 'Cache should key the exact result by model and SHA-256').toEqual({
          'fixture-model:b9776d7ddf459c9ad5b0e1d6ac61e27befb5e99fd62446677600d7cacef544d0': 7,
        })
      }),
    )
  })
})
