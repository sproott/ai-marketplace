import { BunServices } from '@effect/platform-bun';
import { layer } from '@effect/vitest';
import { Effect, FileSystem, Option, Path, Record, Schema, String } from 'effect';
import { type ChildProcessSpawner } from 'effect/process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { adaptGuidance } from '../src/packages/impeccable/guidance.ts';

const decodeDescriptor = Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Array(Schema.Struct({
  hooks: Schema.Array(Schema.Struct({ command: Schema.String })),
})))));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
function test<E>(name: string, run: (dir: string, fs: FileSystem.FileSystem, path: Path.Path) => Effect.Effect<void, E, ChildProcessSpawner.ChildProcessSpawner | Path.Path | FileSystem.FileSystem>) {
  layer(BunServices.layer, { buildPerTest: true })((it) => {
    it.effect(name, () => Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'impeccable-test-' });

      yield* run(dir, fs, path);
    }), 60_000);
  });
}

for (const [file, assumption] of [
  ['SKILL.md', 'pin route'],
  ['reference/doctor.md', 'doctor update'],
  ['reference/hooks.md', 'supported harnesses'],
  ['reference/live.md', 'live policy'],
  ['reference/generate.md', 'live policy'],
] as const) {
  test(`should return ImpeccableBuildError with UnexpectedAnchorCount when ${file} drops the ${assumption}`, () => Effect.gen(function* () {
    const error = yield* Effect.flip(adaptGuidance(file, '# Upstream changed'));

    assert.equal(error._tag, 'ImpeccableBuildError', 'the failure should come from the Impeccable builder');
    const { reason } = error;

    assert.ok(reason._tag === 'UnexpectedAnchorCount', 'the failure should identify an anchor count mismatch');
    assert.equal(reason.file, `dist/claude-code/.claude/skills/impeccable/${file}`, 'the error should name the upstream guidance file');
    assert.equal(reason.anchor, assumption, 'the error should identify the expected guidance anchor');
    assert.equal(reason.count, 0, 'the error should carry the actual number of matches');
  }));
}

for (const [file, body, assumption] of [
  ['reference/live.md', '## Prerequisites\n\n## Prerequisites\n\n', 'live policy'],
  ['reference/hooks.md', 'Supported harnesses:\nSupported harnesses:\n## Triage findings\n', 'supported harnesses'],
  ['reference/hooks.md', 'Supported harnesses:\n## Triage findings\n## Triage findings\n', 'triage findings'],
] as const) {
  test(`should return ImpeccableBuildError with UnexpectedAnchorCount when ${file} repeats the ${assumption}`, () => Effect.gen(function* () {
    const error = yield* Effect.flip(adaptGuidance(file, body));

    assert.equal(error._tag, 'ImpeccableBuildError', 'the failure should come from the Impeccable builder');
    const { reason } = error;

    assert.ok(reason._tag === 'UnexpectedAnchorCount', 'the failure should identify an anchor count mismatch');
    assert.equal(reason.file, `dist/claude-code/.claude/skills/impeccable/${file}`, 'the error should name the upstream guidance file');
    assert.equal(reason.anchor, assumption, 'the error should identify the expected guidance anchor');
    assert.equal(reason.count, 2, 'the error should carry the actual number of matches');
  }));
}

test('should expose the executed adapter when native hook discovery reads descriptors', (_dir, fs, path) => Effect.gen(function* () {
  for (const target of ['claude', 'copilot']) {
    const hookDir = path.join(repoRoot, `packages/impeccable/${target}/.apm/hooks`);
    const descriptorBody = yield* fs.readFileString(path.join(hookDir, 'impeccable.json'));
    const descriptor = yield* decodeDescriptor(descriptorBody);

    for (const groups of Record.values(descriptor)) {
      for (const group of groups) {
        for (const handler of group.hooks) {
          const match = Option.getOrUndefined(String.match(/^sh \.\/(skills\/impeccable\/scripts\/impeccable) hook(?:-before-edit)? /)(handler.command));
          assert.ok(match?.[1], 'descriptor must execute a native-recognizable launcher, not merely contain a marker');
          const exists = yield* fs.exists(path.join(hookDir, match[1]));

          assert.ok(exists, 'recognized adapter must exist for native doctor checks');
        }
      }
    }
  }
}));
