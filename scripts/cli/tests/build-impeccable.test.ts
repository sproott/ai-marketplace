import assert from 'node:assert/strict';
import { BunServices } from '@effect/platform-bun';
import { expect, layer } from '@effect/vitest';
import { Effect, FileSystem, Path, Record, Schema, type PlatformError } from 'effect';
import { buildImpeccable } from '../src/packages/impeccable/index.ts';

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeUmbrella = Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({
  dependencies: Schema.Struct({ apm: Schema.Array(Schema.Struct({ path: Schema.String, alias: Schema.String })) }),
})));
const decodeChild = Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({
  name: Schema.String,
  targets: Schema.Array(Schema.String),
})));
const encodeString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));
const repo = process.cwd();

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectoryScoped();
  const vendor = path.join(cwd, 'vendor/impeccable');
  yield* fs.makeDirectory(path.join(vendor, 'scripts'), { recursive: true });
  yield* fs.writeFileString(path.join(vendor, 'package.json'), '{"version":"1.0.0","author":"Fixture","license":"MIT"}');
  for (const file of ['LICENSE', 'NOTICE.md']) {
    yield* fs.writeFileString(path.join(vendor, file), `${file} fixture\n`);
  }
  yield* fs.copy(path.join(repo, 'scripts/assets/impeccable'), path.join(cwd, 'scripts/assets/impeccable'));

  return { cwd, vendor };
});

const stageUpstream = (fs: FileSystem.FileSystem, vendor: string, mutate = '') => Effect.gen(function* () {
  const path = yield* Path.Path;
  const effectImport = yield* encodeString(import.meta.resolve('effect'));
  const claude = 'dist/claude-code/.claude';
  const copilot = 'dist/github/.github';
  const skill = `${claude}/skills/impeccable`;
  const nativeCommand = 'sh "./impeccable" hook';
  const files = {
    [`${claude}/settings.json`]: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))({
      hooks: {
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: nativeCommand, timeout: 5 }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: nativeCommand, timeout: 5, statusMessage: 'Preparing build session' }] }],
      },
    }),
    [`${copilot}/hooks/impeccable.json`]: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))({
      hooks: { postToolUse: [{ type: 'command', bash: nativeCommand, timeoutSec: 5 }] },
    }),
    [`${claude}/agents/producer.md`]: 'Read .claude/skills/impeccable/SKILL.md.\n',
    [`${copilot}/agents/producer.agent.md`]: 'Read .github/skills/impeccable/SKILL.md.\n',
    [`${skill}/SKILL.md`]: '# Fixture\n\n**Pin / Unpin:** Use native pins.\n\n**Hooks:** Set up native hooks.\n',
    [`${skill}/reference/doctor.md`]: '- **Tool version.** Update the tool.\n- **`auto`** automatically fixes findings.\n',
    [`${skill}/reference/hooks.md`]: 'Supported harnesses:\n\n## Triage findings\n\nPer-developer overrides, including the install consent decision (`hook.consent`) the CLI records, live here.\nWorks (in the Copilot cloud agent too, once `.github/hooks/impeccable.json` is committed).\n- The hook is bundled here.\nNote (A Cursor project still needs migration).\n',
    [`${skill}/reference/live.md`]: '## Prerequisites\n\nUse the launcher.\n',
    [`${skill}/reference/generate.md`]: '## Step 1: Parse the request\n\nRead the brief.\n',
    [`${skill}/scripts/impeccable`]: '#!/bin/sh\nexit 0\n',
    [`${skill}/scripts/impeccable.cmd`]: 'setlocal\r\nexit /b 0\r\n',
  };

  for (const [file, contents] of Record.toEntries(files)) {
    const target = path.join(vendor, file);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, contents);
  }

  yield* fs.writeFileString(path.join(vendor, 'scripts/build.js'), `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { Schema } from ${effectImport};
    if (process.argv[2] !== '--skip-root-sync') {
      console.error('missing --skip-root-sync');
      process.exit(1);
    }

    ${mutate}
  `);
});

const changeClaudeSettings = (mutation: string) => `
  const path = 'dist/claude-code/.claude/settings.json';
  const settings = Schema.decodeSync(Schema.fromJsonString(Schema.Json))(readFileSync(path, 'utf8'));
  ${mutation};
  writeFileSync(path, Schema.encodeSync(Schema.fromJsonString(Schema.Json))(settings));
`;

function snapshot(fs: FileSystem.FileSystem, path: Path.Path, dir: string): Effect.Effect<unknown, PlatformError.PlatformError> {
  return Effect.gen(function* () {
    const names = (yield* fs.readDirectory(dir)).sort();

    return yield* Effect.forEach(names, name => Effect.gen(function* () {
      const file = path.join(dir, name);
      const info = yield* fs.stat(file);
      const contents = yield* info.type === 'Directory' ? snapshot(fs, path, file) : fs.readFile(file);

      return [name, contents];
    }), { concurrency: 1 });
  });
}

layer(BunServices.layer, { buildPerTest: true, concurrent: true })('Impeccable builder', (it) => {
  it.effect('should regenerate identical nested packages when built twice into a relative packages parent', () => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { cwd, vendor } = yield* fixture;
    const umbrella = path.join(cwd, 'out/impeccable');
    const deployed = path.join(umbrella, 'copilot/.github/marker');
    const stale = path.join(umbrella, 'copilot/.apm/obsolete');
    yield* fs.makeDirectory(path.join(umbrella, 'copilot/.github'), { recursive: true });
    yield* fs.makeDirectory(path.join(umbrella, 'copilot/.apm'), { recursive: true });
    yield* fs.writeFileString(deployed, 'preserved');
    yield* fs.writeFileString(stale, 'obsolete');
    yield* stageUpstream(fs, vendor);

    yield* buildImpeccable(cwd, 'out');
    const first = yield* snapshot(fs, path, umbrella);

    yield* buildImpeccable(cwd, 'out');
    const second = yield* snapshot(fs, path, umbrella);

    expect(second, 'all generated bytes should match after rebuilding').toEqual(first);
    const packages = yield* fs.readDirectory(path.join(cwd, 'out'));
    const deployment = yield* fs.readFileString(deployed);
    const staleExists = yield* fs.exists(stale);

    expect(packages, 'the selected packages parent should contain only the umbrella').toEqual(['impeccable']);
    expect(deployment, 'the deployed child output should survive').toBe('preserved');
    expect(staleExists, 'stale child primitives should be removed').toBe(false);

    const manifestBody = yield* fs.readFileString(path.join(umbrella, 'apm.yml'));
    const manifest = yield* decodeUmbrella(manifestBody);

    assert.deepEqual(manifest.dependencies.apm, [
      { path: './claude', alias: 'impeccable-claude' },
      { path: './copilot', alias: 'impeccable-copilot' },
    ], 'nested dependencies must preserve their deployed identities');
    for (const target of ['claude', 'copilot']) {
      const childBody = yield* fs.readFileString(path.join(umbrella, target, 'apm.yml'));
      const child = yield* decodeChild(childBody);

      assert.equal(child.name, `impeccable-${target}`, 'child package identity must remain stable');
      assert.deepEqual(child.targets, [target], 'child primitives must be restricted to their native harness');
    }
    const hasInstructions = yield* fs.exists(path.join(umbrella, '.apm/instructions'));

    assert.equal(hasInstructions, false, 'no always-on instruction may ship');
    for (const file of ['impeccable', 'impeccable.cmd']) {
      const launcher = yield* fs.readFileString(path.join(umbrella, '.apm/skills/impeccable/scripts', file));

      assert.match(launcher, /IMPECCABLE_NO_UPDATE_CHECK=1/, 'launchers must disable native update recommendations');
    }

    for (const target of ['claude', 'copilot']) {
      const agent = yield* fs.readFileString(path.join(umbrella, target, '.apm/agents/producer.agent.md'));
      expect(agent, `${target} should preserve the agent and normalize its link`).toBe('Read <skill-base-dir>/SKILL.md.\n');
    }

    const skillDir = path.join(umbrella, '.apm/skills/impeccable');
    const skill = yield* fs.readFileString(path.join(skillDir, 'SKILL.md'));
    const doctor = yield* fs.readFileString(path.join(skillDir, 'reference/doctor.md'));
    const live = yield* fs.readFileString(path.join(skillDir, 'reference/live.md'));

    expect(skill, 'APM guidance should remove native pin administration').not.toContain('Pin / Unpin');
    expect(doctor, 'doctor should direct updates through APM').toMatch(/apm update.*apm install/);
    expect(live, 'live guidance should set chat mode').toContain('IMPECCABLE_LIVE_COPY_AGENT=chat');
  }));

  it.effect('should render Claude and Copilot hooks when upstream uses distinct manifest formats', () => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { cwd, vendor } = yield* fixture;
    const umbrella = path.join(cwd, 'out/impeccable');
    yield* stageUpstream(fs, vendor, changeClaudeSettings(`
      settings.unrelated = { value: true };
      settings.hooks.SessionStart[0].unrelated = 123;
      settings.hooks.SessionStart[0].hooks[0].unrelated = ['field'];
    `));

    yield* buildImpeccable(cwd, 'out');

    const claudeBody = yield* fs.readFileString(path.join(umbrella, 'claude/.apm/hooks/impeccable.json'));
    const claude = yield* decodeJson(claudeBody);
    const copilotBody = yield* fs.readFileString(path.join(umbrella, 'copilot/.apm/hooks/impeccable.json'));
    const copilot = yield* decodeJson(copilotBody);
    const launcher = 'sh ./skills/impeccable/scripts/impeccable hook';

    expect(claude, 'Claude should preserve its matcher and nested command').toMatchObject({
      PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ command: `${launcher} claude PostToolUse`, timeout: 5 }] }],
    });
    expect(copilot, 'Copilot should wrap its Bash handler and reuse Claude SessionStart').toEqual({
      PostToolUse: [{ hooks: [{ type: 'command', command: `${launcher} copilot PostToolUse`, timeout: 5 }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: `${launcher} copilot SessionStart`, timeout: 5, statusMessage: 'Preparing build session' }] }],
    });
  }));

  for (const [shape, mutation] of [
    ['missing', 'delete settings.hooks.SessionStart'],
    ['empty', 'settings.hooks.SessionStart = []'],
    ['a group with no handlers', 'settings.hooks.SessionStart.push({ hooks: [] })'],
    ['a flat handler list', 'settings.hooks.SessionStart = settings.hooks.SessionStart[0].hooks'],
    ['a handler with an empty command', 'settings.hooks.SessionStart[0].hooks[0].command = ""'],
    ['a non-command handler', 'settings.hooks.SessionStart[0].hooks[0].type = "prompt"'],
  ] as const) {
    it.effect(`should return ImpeccableBuildError with InvalidClaudeHookManifest when Claude SessionStart is ${shape}`, () => Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { cwd, vendor } = yield* fixture;
      yield* stageUpstream(fs, vendor, changeClaudeSettings(mutation));

      const result = yield* Effect.flip(buildImpeccable(cwd, 'out'));

      assert.ok(result._tag === 'ImpeccableBuildError', 'the failure should come from the Impeccable builder');
      const { reason } = result;

      assert.ok(reason._tag === 'InvalidClaudeHookManifest', 'the failure should carry the manifest fields');
      assert.equal(reason.file, 'dist/claude-code/.claude/settings.json', 'the manifest path should identify the upstream source');
      assert.equal(reason.cause._tag, 'SchemaError', 'the original schema failure should be preserved');
    }));
  }

  for (const [file, contents, tag] of [
    ['package.json', '{"version":123}', 'InvalidPackageMetadata'],
    ['dist/github/.github/hooks/impeccable.json', '{"hooks":{"postToolUse":[{"type":"command","bash":""}]}}', 'InvalidCopilotHookManifest'],
  ] as const) {
    it.effect(`should return ImpeccableBuildError with ${tag} when ${file} fails schema validation`, () => Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { cwd, vendor } = yield* fixture;
      yield* stageUpstream(fs, vendor);
      yield* fs.writeFileString(path.join(vendor, file), contents);

      const result = yield* Effect.flip(buildImpeccable(cwd, 'out'));

      assert.ok(result._tag === 'ImpeccableBuildError', 'the failure should come from the Impeccable builder');
      const { reason } = result;

      assert.ok(reason._tag === tag, 'the error should identify the input that failed validation');
      assert.equal(reason.file, file, 'the error should identify the upstream file');
      assert.equal(reason.cause._tag, 'SchemaError', 'the original schema failure should be preserved');
    }));
  }

  for (const file of ['package.json', 'dist/claude-code/.claude/settings.json', 'dist/github/.github/hooks/impeccable.json']) {
    it.effect(`should return ImpeccableBuildError with UnreadableUpstreamInput when ${file} is missing`, () => Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { cwd, vendor } = yield* fixture;
      yield* stageUpstream(fs, vendor);
      yield* fs.remove(path.join(vendor, file));

      const result = yield* Effect.flip(buildImpeccable(cwd, 'out'));

      assert.ok(result._tag === 'ImpeccableBuildError', 'the failure should come from the Impeccable builder');
      const { reason } = result;

      assert.ok(reason._tag === 'UnreadableUpstreamInput', 'the error should identify an input read failure');
      assert.equal(reason.file, file, 'the error should identify the missing upstream file');
      assert.equal(reason.cause._tag, 'PlatformError', 'the original platform failure should be preserved');
    }));
  }

  it.effect('should return ImpeccableBuildError with MissingLauncherVerb when a Copilot handler omits its launcher verb', () => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { cwd, vendor } = yield* fixture;
    const file = 'dist/github/.github/hooks/impeccable.json';
    const command = 'sh "./impeccable"';
    const manifest = yield* encodeString(file);
    yield* stageUpstream(fs, vendor, `
      const path = ${manifest};
      writeFileSync(path, readFileSync(path, 'utf8').replace(' hook', ''));
    `);

    const result = yield* Effect.flip(buildImpeccable(cwd, 'out'));

    assert.ok(result._tag === 'ImpeccableBuildError', 'the failure should come from the Impeccable builder');
    const { reason } = result;

    assert.ok(reason._tag === 'MissingLauncherVerb', 'the failure should identify a missing launcher verb');
    assert.equal(reason.file, file, 'the error should name the Copilot hook manifest');
    assert.equal(reason.event, 'PostToolUse', 'the error should identify the malformed hook event');
    assert.equal(reason.command, command, 'the error should preserve the malformed command');
  }));

  for (const [file, marker, assumption] of [
    ['impeccable', '#!/bin/sh\n', 'POSIX shebang'],
    ['impeccable.cmd', 'setlocal\r\n', 'Windows setlocal'],
  ] as const) {
    for (const count of [0, 2]) {
      it.effect(`should return ImpeccableBuildError with UnexpectedAnchorCount when ${file} has ${count} launcher markers`, () => Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { cwd, vendor } = yield* fixture;
        const path = `dist/claude-code/.claude/skills/impeccable/scripts/${file}`;
        const pathLiteral = yield* encodeString(path);
        const markerLiteral = yield* encodeString(marker);
        yield* stageUpstream(fs, vendor, `
          const path = ${pathLiteral};
          const marker = ${markerLiteral};
          writeFileSync(path, readFileSync(path, 'utf8').replace(marker, marker.repeat(${count})));
        `);

        const result = yield* Effect.flip(buildImpeccable(cwd, 'out'));

        assert.ok(result._tag === 'ImpeccableBuildError', 'the failure should come from the Impeccable builder');
        const { reason } = result;

        assert.ok(reason._tag === 'UnexpectedAnchorCount', 'the failure should identify an anchor count mismatch');
        assert.equal(reason.file, path, 'the error should identify the upstream launcher');
        assert.equal(reason.anchor, assumption, 'the error should identify the expected launcher anchor');
        assert.equal(reason.count, count, 'the error should carry the actual number of matches');
      }));
    }
  }

  it.effect('should return SubprocessExited error and preserve existing output when the vendor build fails', () => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { cwd, vendor } = yield* fixture;
    const apm = path.join(cwd, 'out/impeccable/.apm');
    const marker = path.join(apm, 'marker');
    yield* fs.makeDirectory(apm, { recursive: true });
    yield* fs.writeFileString(marker, 'previous build');
    yield* fs.writeFileString(path.join(vendor, 'scripts/build.js'), 'process.exit(47);');

    const result = yield* Effect.flip(buildImpeccable(cwd, 'out'));
    const contents = yield* fs.readFileString(marker);

    assert.ok(result._tag === 'SubprocessExited', 'the failure should identify a nonzero subprocess exit');
    assert.equal(result.command, 'bun', 'the error should name the vendor build executable');
    assert.deepEqual(result.args, ['scripts/build.js', '--skip-root-sync'], 'the error should identify the vendor build arguments');
    assert.equal(result.status, 47, 'the error should carry the vendor exit status');
    expect(contents, 'the existing primitives should survive the failed build').toBe('previous build');
  }));
});
