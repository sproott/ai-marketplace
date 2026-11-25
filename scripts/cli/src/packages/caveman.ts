import { Array, Console, Effect, FileSystem, Path, Record, Schema, String } from 'effect'
import { isDeepStrictEqual } from 'node:util'
import { isMap, isScalar, isSeq, parseDocument, YAMLParseError } from 'yaml'
import { copyDir, copyFile } from '../shared/files.ts'
import { run } from '../shared/process.ts'
import { bundleHook } from '../shared/build-hook-bundle.ts'
import { reportFailures } from '../shared/command-failure.ts'
import { defineBuilder, packageDir, vendorDir } from '../package-model/define.ts'
import { ReleaseSource } from '../package-model/release-source.ts'

const CavemanBuildReason = Schema.TaggedUnion({
  MissingSkillFrontmatter: { file: Schema.String },
  InvalidSkillFrontmatter: {
    file: Schema.String,
    parseError: Schema.instanceOf(YAMLParseError),
  },
  InvalidSkillDescription: {
    file: Schema.String,
    found: Schema.Literals([
      'mapping',
      'sequence',
      'missing',
      'null',
      'empty string',
      'number',
      'boolean',
      'bigint',
      'undefined',
      'object',
      'symbol',
      'function',
    ]),
  },
  UnexpectedSkillRewrite: { file: Schema.String },
  MissingUpstreamSkills: { names: Schema.Array(Schema.String) },
  UnexpectedStatuslineAnchorCount: {
    file: Schema.String,
    anchor: Schema.Literals(['statusline setup nudge', 'statusline setup summary', 'settings path declaration']),
    count: Schema.Int,
  },
  MissingCavemanSource: { path: Schema.String },
})

class CavemanBuildError extends Schema.TaggedError<CavemanBuildError, { readonly brand: unique symbol }>()(
  'CavemanBuildError',
  { reason: CavemanBuildReason },
) {
  format(): string {
    return CavemanBuildReason.match(this.reason, {
      MissingSkillFrontmatter: ({ file }) => `caveman: ${file}: SKILL.md has no frontmatter block to rewrite`,
      InvalidSkillFrontmatter: ({ file, parseError }) => `caveman: ${file}: ${parseError.message}`,
      InvalidSkillDescription: ({ file, found }) =>
        `caveman: ${file}: expected description to be a nonempty YAML string; found ${found}`,
      UnexpectedSkillRewrite: ({ file }) => `caveman: ${file}: SKILL.md rewrite must change only the description`,
      MissingUpstreamSkills: ({ names }) =>
        `SKILL_DESCRIPTIONS names skills upstream no longer ships: ${Array.join(names, ', ')} — drop the entry or update it to the new name`,
      UnexpectedStatuslineAnchorCount: ({ file, anchor, count }) =>
        `caveman: ${file}: expected exactly one ${anchor}; found ${count}`,
      MissingCavemanSource: ({ path }) => `${path} not found — run "git submodule update --init"`,
    })
  }
}

const quote = Schema.encodeEffect(Schema.fromJsonString(Schema.String))
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json, { space: 2 }))

// ---- skills: skills/<name>/ -> .apm/skills/<name>/ ----
//
// Every skill's description sits in the agent's context for the whole session, whether or
// not the skill ever runs — seven caveman skills cost ~600 tokens of listing before a
// single one fires. Upstream writes them as prose paragraphs; these rewrites keep the
// trigger phrases a model matches on and drop the restatement around them.

const SKILL_DESCRIPTIONS: Record<string, string> = {
  caveman:
    'Ultra-compressed response mode, ~65% fewer output tokens, full technical accuracy. Levels: lite, full, ultra, wenyan. Triggers: caveman mode, talk like caveman, /caveman, be brief, fewer tokens.',
  cavecrew:
    'When to delegate to a caveman subagent instead of working inline: investigator (locate code), builder (1-2 file edit), reviewer (diff review). Their output is compressed, so main context lasts longer. Triggers: use cavecrew, spawn investigator/builder/reviewer, save context.',
  'caveman-commit':
    'Conventional Commits message, subject under 50 chars, body only when the why is not obvious. Triggers: write a commit, commit message, /caveman-commit.',
  'caveman-compress':
    'Compress a memory file (CLAUDE.md, todos, preferences) into caveman format, preserving code and structure; the original is kept as FILE.original.md. Trigger: /caveman-compress <path>.',
  'caveman-help': 'Reference card for caveman modes, skills, and commands. Trigger: /caveman-help.',
  'caveman-review':
    'Ultra-compressed PR review comments, one line each: location, problem, fix. Triggers: review this PR, code review, /caveman-review.',
  'caveman-stats': 'Real token usage and savings for this session, read from the session log. Trigger: /caveman-stats.',
}

export const rewriteSkillDescription = Effect.fnUntraced(function* (
  skillMd: string,
  description: string,
  file = 'SKILL.md',
) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skillMd)
  const source = frontmatter?.[1]

  if (frontmatter === null || source === undefined)
    return yield* CavemanBuildError.make({ reason: CavemanBuildReason.cases.MissingSkillFrontmatter.make({ file }) })

  const document = parseDocument(source)
  const [error] = document.errors

  if (error !== undefined)
    return yield* CavemanBuildError.make({
      reason: CavemanBuildReason.cases.InvalidSkillFrontmatter.make({ file, parseError: error }),
    })

  const field = document.get('description', true)
  const value: unknown = isScalar(field) ? field.value : undefined

  if (!isScalar(field) || field.range == null || typeof value !== 'string' || String.trim(value) === '') {
    const kind = typeof value
    const found = isMap(field)
      ? 'mapping'
      : isSeq(field)
        ? 'sequence'
        : field === undefined
          ? 'missing'
          : value === null
            ? 'null'
            : kind === 'string'
              ? 'empty string'
              : kind

    return yield* CavemanBuildError.make({
      reason: CavemanBuildReason.cases.InvalidSkillDescription.make({ file, found }),
    })
  }

  const [start, end] = field.range
  const separator = source[end - 1] === '\n' && end < source.length ? '\n' : ''

  const quotedDescription = yield* quote(description).pipe(Effect.orDie)
  const rewritten = String.slice(0, start)(source) + quotedDescription + separator + String.slice(end)(source)
  const checked = parseDocument(rewritten)
  document.set('description', description)

  if (checked.errors.length > 0 || !isDeepStrictEqual(checked.toJS(), document.toJS())) {
    return yield* CavemanBuildError.make({ reason: CavemanBuildReason.cases.UnexpectedSkillRewrite.make({ file }) })
  }

  return `---\n${rewritten}\n---${String.slice(frontmatter[0].length)(skillMd)}`
})

const generateSkills = Effect.fn('caveman.generateSkills')(function* (cavemanRoot: string, apmDir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const srcRoot = path.join(cavemanRoot, 'skills')
  const destRoot = path.join(apmDir, 'skills')
  const rewritten = new Set<string>()

  for (const name of yield* fs.readDirectory(srcRoot)) {
    const srcSkillDir = path.join(srcRoot, name)

    if ((yield* fs.stat(srcSkillDir)).type !== 'Directory') continue

    const destSkillDir = path.join(destRoot, name)
    yield* copyDir(srcSkillDir, destSkillDir, ['README.md', 'SECURITY.md'])

    const description = SKILL_DESCRIPTIONS[name]

    if (description === undefined || description === '') continue

    const skillMd = path.join(destSkillDir, 'SKILL.md')
    const markdown = yield* fs.readFileString(skillMd)
    const updated = yield* rewriteSkillDescription(markdown, description, `skills/${name}/SKILL.md`)
    yield* fs.writeFileString(skillMd, updated)
    rewritten.add(name)
  }

  const missing = Array.filter(Record.keys(SKILL_DESCRIPTIONS), (name) => !rewritten.has(name))

  if (missing.length > 0) {
    return yield* CavemanBuildError.make({
      reason: CavemanBuildReason.cases.MissingUpstreamSkills.make({ names: missing }),
    })
  }
})

// ---- agents: agents/cavecrew-*.md -> .apm/agents/cavecrew-*.agent.md ----

const generateAgents = Effect.fn('caveman.generateAgents')(function* (cavemanRoot: string, apmDir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const srcDir = path.join(cavemanRoot, 'agents')
  const destDir = path.join(apmDir, 'agents')

  for (const file of yield* fs.readDirectory(srcDir)) {
    if (!String.startsWith('cavecrew-')(file) || !String.endsWith('.md')(file)) continue

    const name = String.slice(0, -'.md'.length)(file)
    yield* copyFile(path.join(srcDir, file), path.join(destDir, `${name}.agent.md`))
  }
})

// ---- instructions: src/rules/caveman-activate.md -> .apm/instructions/caveman-activate.instructions.md ----

const INSTRUCTION_DESCRIPTION =
  'Always-on caveman-style compressed response rule: terse fragments, dropped filler, full technical accuracy preserved.'

const generateInstructions = Effect.fn('caveman.generateInstructions')(function* (cavemanRoot: string, apmDir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const src = path.join(cavemanRoot, 'src', 'rules', 'caveman-activate.md')
  const body = yield* fs.readFileString(src)
  const dest = path.join(apmDir, 'instructions', 'caveman-activate.instructions.md')

  yield* fs.makeDirectory(path.dirname(dest), { recursive: true })
  const description = yield* quote(INSTRUCTION_DESCRIPTION).pipe(Effect.orDie)

  yield* fs.writeFileString(dest, `---\ndescription: ${description}\n---\n\n${body}`)
})

// ---- hooks: src/hooks/*.js, caveman-statusline.{sh,ps1} -> .apm/hooks/*, plus caveman.json descriptor ----
//
// Hook scripts are copied flat alongside the descriptor so APM's hook
// integrator resolves sibling require()s (see docs/producer/author-primitives/
// hooks-and-commands.md: referencing a script inside a package hook
// directory deploys the whole hook bundle). Commands use relative `./`
// paths, not ${CLAUDE_PLUGIN_ROOT}, since the scripts sit next to the
// descriptor — that resolves against the hook file's own directory.
//
// Every command runs through caveman-hook-io.cjs (bundled from packages/caveman/src/hooks/), which
// translates Copilot CLI's payload and response schema around the vendored scripts, since
// those speak only Claude Code's. The hook script is passed as a bare name the adapter
// resolves against its own directory.
//
// The descriptor commands invoke `node` because that's the runtime deployed
// consumers run the hooks under (Claude Code's own hook execution), not this
// build script's runtime.

export const removeStatuslineSetupNudge = Effect.fnUntraced(function* (hook: string) {
  const nudge =
    /\/\/ 3\. Detect missing statusline config — nudge Claude to help set it up\n[\s\S]*?\} catch \(e\) \{\n  \/\/ Silent fail — don't block session start over statusline detection\n\}\n\n/g
  const edits = [
    ['statusline setup nudge', nudge],
    ['statusline setup summary', /^\/\/   3\. Detects missing statusline config and emits setup nudge\n/gm],
    ['settings path declaration', /^const settingsPath = path\.join\(claudeDir, 'settings\.json'\);\n/gm],
  ] as const

  let text = hook

  for (const [anchor, pattern] of edits) {
    const count = [...String.matchAll(pattern)(text)].length

    if (count !== 1) {
      return yield* CavemanBuildError.make({
        reason: CavemanBuildReason.cases.UnexpectedStatuslineAnchorCount.make({
          file: 'src/hooks/caveman-activate.js',
          anchor,
          count,
        }),
      })
    }

    text = String.replace(pattern, '')(text)
  }

  return text
})

const generateHooks = Effect.fn('caveman.generateHooks')(function* (
  cavemanRoot: string,
  apmDir: string,
  authoredHooks: string,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const srcDir = path.join(cavemanRoot, 'src', 'hooks')
  const destDir = path.join(apmDir, 'hooks')

  for (const file of yield* fs.readDirectory(srcDir)) {
    if (String.endsWith('.js')(file) || file === 'caveman-statusline.sh' || file === 'caveman-statusline.ps1') {
      yield* copyFile(path.join(srcDir, file), path.join(destDir, file))
    }
  }

  const activateHook = path.join(destDir, 'caveman-activate.js')
  const hook = yield* fs.readFileString(activateHook)
  const updated = yield* removeStatuslineSetupNudge(hook)
  yield* fs.writeFileString(activateHook, updated)
  yield* bundleHook(path.join(authoredHooks, 'caveman-hook-io.ts'), path.join(destDir, 'caveman-hook-io.cjs'))

  const descriptor = {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node ./caveman-hook-io.cjs caveman-activate.js',
            timeout: 5,
            statusMessage: 'Loading caveman mode...',
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node ./caveman-hook-io.cjs caveman-mode-tracker.js',
            timeout: 5,
            statusMessage: 'Tracking caveman mode...',
          },
        ],
      },
    ],
  }

  yield* fs.makeDirectory(destDir, { recursive: true })
  const json = yield* encodeJson(descriptor).pipe(Effect.orDie)

  yield* fs.writeFileString(path.join(destDir, 'caveman.json'), `${json}\n`)
})

// ---- prompts: commands/<name>.md -> .apm/prompts/<name>.prompt.md ----
//
// caveman-init is excluded: it downloads and runs caveman's own standalone
// installer script from GitHub, which doesn't apply here (this repo deploys
// caveman via the vendored submodule + apm, not caveman's own installer).

const PROMPT_NAMES = ['caveman', 'caveman-commit', 'caveman-review', 'caveman-stats']

const generatePrompts = Effect.fn('caveman.generatePrompts')(function* (cavemanRoot: string, apmDir: string) {
  const path = yield* Path.Path

  const srcDir = path.join(cavemanRoot, 'commands')
  const destDir = path.join(apmDir, 'prompts')

  for (const name of PROMPT_NAMES) {
    yield* copyFile(path.join(srcDir, `${name}.md`), path.join(destDir, `${name}.prompt.md`))
  }
})

export const caveman = defineBuilder(
  'caveman',
  Effect.fn('buildCaveman')(function* (out: string | undefined, validate: boolean) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const root = process.cwd()
    const source = path.join(root, vendorDir('caveman'))
    const destination = path.resolve(root, out ?? packageDir('caveman'))
    const apm = path.join(destination, '.apm')

    if (!(yield* fs.exists(source)) || (yield* fs.readDirectory(source)).length === 0) {
      return yield* CavemanBuildError.make({
        reason: CavemanBuildReason.cases.MissingCavemanSource.make({ path: source }),
      })
    }

    yield* fs.remove(apm, { recursive: true, force: true })
    yield* fs.makeDirectory(apm, { recursive: true })

    yield* generateSkills(source, apm)
    yield* generateAgents(source, apm)
    yield* generateInstructions(source, apm)
    yield* generateHooks(source, apm, path.join(root, 'packages/caveman/src/hooks'))
    yield* generatePrompts(source, apm)

    yield* Console.log(`Generated ${path.relative(root, apm)}`)

    if (validate) yield* run('apm', ['compile', '--validate'], destination)
  }),
  reportFailures('CavemanBuildError', 'SubprocessExited', 'CommandOperationFailed', 'CommandFailure'),
  // Release tags version the skills independently of the npm package.
  { release: ReleaseSource.cases.SubmoduleTag.make({}), validate: true },
)
