import { BunServices } from '@effect/platform-bun';
import { layer } from '@effect/vitest';
import { Effect, FileSystem, Path, Record, Schema, Stream, String } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeClaudeContext = Schema.decodeEffect(Schema.fromJsonString(Schema.StructWithRest(Schema.Struct({
  hookSpecificOutput: Schema.Struct({ additionalContext: Schema.String }),
}), [Schema.Record(Schema.String, Schema.Unknown)])));
const decodeCopilotContext = Schema.decodeEffect(Schema.fromJsonString(Schema.StructWithRest(Schema.Struct({
  additionalContext: Schema.String,
}), [Schema.Record(Schema.String, Schema.Unknown)])));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const hookBundle = `${repoRoot}/packages/impeccable/claude/.apm/hooks/hook.cjs`;

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

const runProcess = ([command, ...args]: [string, ...string[]], options: { cwd?: string; stdin?: Stream.Stream<Uint8Array>; env?: Record.ReadonlyRecord<string, string> } = {}) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(command, args, { extendEnv: true, ...options }));
    const read = (stream: typeof child.stdout) => Stream.runFold(Stream.decodeText(stream), () => '', (text, chunk) => text + chunk);

    return yield* Effect.all({ status: child.exitCode, stdout: read(child.stdout), stderr: read(child.stderr) }, { concurrency: 'unbounded' });
  }).pipe(Effect.scoped);

const inputStream = (input: Schema.Json) => Effect.map(encodeJson(input), text => Stream.make(new TextEncoder().encode(text)));

for (const [target, payload, harness] of [
  ['claude', { tool_name: 'Write', tool_input: { file_path: 'a.css', content: 'body{}' }, sessionId: 'mixed' }, 'claude'],
  ['copilot', { toolName: 'edit', toolArgs: '{"path":"a.css"}' }, 'github'],
  ['copilot', { tool_name: 'multi_replace_string_in_file', tool_input: { replacements: [{ filePath: 'a.css' }] } }, 'vscode'],
] as const) {
  for (const scope of ['project', 'global', 'user', 'next to wrapper']) {
    test(`should preserve complete payload when ${harness} runs from nested cwd with ${scope} skills`, (dir, fs, path) => Effect.gen(function* () {
      const project = path.join(dir, 'project');
      const cwd = path.join(project, 'src/nested');
      const home = path.join(dir, 'home');
      const wrapperRoot = scope === 'next to wrapper' ? path.join(dir, 'deployed') : scope === 'global' ? home : project;
      const installRoot = scope === 'next to wrapper' ? wrapperRoot : scope === 'project' ? project : home;
      const config = target === 'claude' ? '.claude' : '.github';
      const wrapper = path.join(wrapperRoot, config, target === 'claude' ? 'hooks/impeccable-claude/hook.cjs' : 'hooks/scripts/impeccable-copilot/hook.cjs');
      const launcher = path.join(installRoot, config, 'skills/impeccable/scripts/impeccable');
      yield* fs.makeDirectory(cwd, { recursive: true });
      yield* fs.makeDirectory(path.dirname(wrapper), { recursive: true });
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.copyFile(hookBundle, wrapper);
      const adapter = path.join(path.dirname(wrapper), 'skills/impeccable/scripts/impeccable');
      yield* fs.makeDirectory(path.dirname(adapter), { recursive: true });
      yield* fs.copyFile(path.join(repoRoot, 'packages/impeccable/src/hooks/launcher.sh'), adapter);
      yield* fs.writeFileString(launcher, '#!/bin/sh\nprintf "%s\\n" "$IMPECCABLE_HOOK_HARNESS" "$IMPECCABLE_LIVE_COPY_AGENT" "$1" "$PWD"\ncat\n', { mode: 0o644 });
      const input = { ...payload, cwd, session_id: 'fixture', timestamp: 123, tool_response: { success: true } };

      const stdin = yield* inputStream(input);
      const result = yield* runProcess(['sh', adapter, 'hook', target, 'PostToolUse'], {
        stdin,
        env: { HOME: home },
      });
      const [actualHarness, live, command, actualCwd, body] = String.split('\n')(String.trim(result.stdout));

      assert.equal(result.status, 0, `stub must run without downloads: ${result.stderr}`);
      assert.equal(actualHarness, harness, 'engine must receive explicit harness');
      assert.equal(live, 'chat', 'live fallback must remain chat-only');
      assert.equal(command, 'hook', 'native verb must survive');
      assert.equal(actualCwd, cwd, 'engine must keep payload project cwd');
      const forwarded = yield* decodeJson(body ?? '');

      assert.deepEqual(forwarded, { ...input, hook_event_name: 'PostToolUse' }, 'all payload metadata must survive');
    }));
  }
}

for (const target of ['claude', 'copilot']) {
  test(`should emit setup guidance once when ${target} receives SessionStart`, (dir, fs, path) => Effect.gen(function* () {
    const launcher = path.join(dir, target === 'claude' ? '.claude' : '.github', 'skills/impeccable/scripts/impeccable');
    yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
    yield* fs.writeFileString(launcher, '#!/bin/sh\nexit 99\n', { mode: 0o755 });

    const hookDir = path.join(dir, target === 'claude' ? '.claude/hooks/impeccable-claude' : '.github/hooks/scripts/impeccable-copilot');
    const adapter = path.join(hookDir, 'skills/impeccable/scripts/impeccable');
    yield* fs.makeDirectory(path.dirname(adapter), { recursive: true });
    yield* fs.copyFile(path.join(repoRoot, 'packages/impeccable/src/hooks/launcher.sh'), adapter);
    yield* fs.copyFile(hookBundle, path.join(hookDir, 'hook.cjs'));

    const result = yield* runProcess(['sh', adapter, 'hook', target, 'SessionStart'], { stdin: yield* inputStream({ cwd: dir }) });

    assert.equal(result.status, 0, `SessionStart must succeed: ${result.stderr}`);
    const output = yield* decodeClaudeContext(result.stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /once per session/, 'setup must not request context on every tool call');
    assert.equal(output.other, undefined, 'bootstrap must not execute the engine or depend on its availability');
  }));
}

test('should preserve session identity without launching the engine when Claude starts', (dir, fs, path) => Effect.gen(function* () {
  const launcher = path.join(dir, '.claude/skills/impeccable/scripts/impeccable');
  const envFile = path.join(dir, 'session.env');
  yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
  yield* fs.writeFileString(launcher, '#!/bin/sh\nexit 99\n');
  const bundle = path.join(dir, 'hook.cjs');
  yield* fs.copyFile(hookBundle, bundle);

  const run = (session: string) => Effect.flatMap(inputStream({ cwd: dir, session_id: session }), stdin => runProcess(['node', bundle, 'claude', 'SessionStart', 'hook'], {
    stdin,
    env: { CLAUDE_ENV_FILE: envFile },
  }));

  assert.equal((yield* run('session-123')).status, 0, 'startup must not depend on the engine');
  assert.equal((yield* run('session-123')).status, 0, 'resume must succeed');
  const identity = yield* fs.readFileString(envFile);

  assert.equal(identity, "export IMPECCABLE_SESSION_ID='session-123'\n", 'identity must be exported only once');
  assert.equal((yield* run("bad'; touch injected")).status, 0, 'unsafe identity must not stop setup guidance');
  const safeIdentity = yield* fs.readFileString(envFile);

  assert.equal(safeIdentity, "export IMPECCABLE_SESSION_ID='session-123'\n", 'unsafe identity must never reach the shell environment');
}));

test('should render top-level context when Copilot CLI starts a session', (dir, fs, path) => Effect.gen(function* () {
  const launcher = path.join(dir, '.github/skills/impeccable/scripts/impeccable');
  yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
  yield* fs.writeFileString(launcher, '#!/bin/sh\nexit 99\n', { mode: 0o755 });

  const bundle = path.join(dir, 'hook.cjs');
  yield* fs.copyFile(hookBundle, bundle);

  const result = yield* runProcess(['node', bundle, 'copilot', 'SessionStart', 'hook'], { stdin: yield* inputStream({ cwd: dir, sessionId: 'cli' }) });

  assert.equal(result.status, 0, 'CLI bootstrap must not invoke the native scan');
  const output = yield* decodeCopilotContext(result.stdout);
  assert.match(output.additionalContext, /once per session/, 'CLI must receive top-level context');
  assert.equal(output.hookSpecificOutput, undefined, 'CLI must not receive the VS Code envelope');
}));

for (const installed of [true, false]) {
  test(`should respect explicit Claude account when custom runtime is ${installed ? 'present' : 'missing'}`, (dir, fs, path) => Effect.gen(function* () {
    const home = path.join(dir, 'home');
    const project = path.join(dir, 'project');
    const account = path.join(home, 'work-account');
    const launcher = path.join(account, 'skills/impeccable/scripts/impeccable');
    const decoy = path.join(home, '.claude/skills/impeccable/scripts/impeccable');
    yield* fs.makeDirectory(project, { recursive: true });
    yield* fs.makeDirectory(path.dirname(decoy), { recursive: true });
    yield* fs.writeFileString(decoy, '#!/bin/sh\nprintf wrong-account\n', { mode: 0o755 });
    if (installed) {
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, '#!/bin/sh\nprintf custom-account\n', { mode: 0o755 });
    }

    const bundle = path.join(project, '.claude/hooks/impeccable-claude/hook.cjs');
    yield* fs.makeDirectory(path.dirname(bundle), { recursive: true });
    yield* fs.copyFile(hookBundle, bundle);

    const stdin = yield* inputStream({ cwd: project });
    const result = yield* runProcess(['node', bundle, 'claude', 'PostToolUse', 'hook'], {
      stdin,
      env: { HOME: home, CLAUDE_CONFIG_DIR: account },
    });

    assert.equal(result.status, installed ? 0 : 1, 'explicit account must succeed only with its own runtime');
    assert.equal(result.stdout, installed ? 'custom-account' : '', 'default account must never substitute for the selected account');
  }));
}
