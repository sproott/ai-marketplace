import { BunServices } from '@effect/platform-bun';
import { expect, it } from '@effect/vitest';
import { Effect, FileSystem } from 'effect';
import { TestConsole } from 'effect/testing';
import { syncHookIo } from '../src/commands/sync-hook-io.ts';

const helper = 'packages/with spaces/.apm/hooks/hook_io.py';

const fixture = (copy: string) => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();

  yield* fs.makeDirectory(`${root}/scripts/assets/hook-io`, { recursive: true });
  yield* fs.makeDirectory(`${root}/packages/with spaces/.apm/hooks`, { recursive: true });
  yield* fs.writeFileString(`${root}/scripts/assets/hook-io/hook_io.py`, 'canonical\n');
  yield* fs.writeFileString(`${root}/packages/with spaces/.apm/hooks/consumer.py`, 'import hook_io\n');
  yield* fs.writeFileString(`${root}/${helper}`, copy);

  return { fs, root };
});

it.layer(BunServices.layer, { buildPerTest: true })('sync-hook-io', (it) => {
  it.effect('should copy canonical bytes when a consumer has a stale helper', () => Effect.gen(function* () {
    const { fs, root } = yield* fixture('stale\n');

    yield* syncHookIo(root, false);

    const contents = yield* fs.readFileString(`${root}/${helper}`);
    const logs = yield* TestConsole.logLines;

    expect(contents, 'Consumer should have the canonical contents').toBe('canonical\n');
    expect(logs, 'Copy should report the consumer path').toEqual([`synced ${helper}`]);
  }));

  it.effect('should report no drift when the consumer matches', () => Effect.gen(function* () {
    const { root } = yield* fixture('canonical\n');

    yield* syncHookIo(root, true);

    const diagnostics = yield* TestConsole.errorLines;

    expect(diagnostics, 'Matching copy should not produce a diagnostic').toEqual([]);
  }));

  it.effect('should return a drift error without writing when a consumer differs', () => Effect.gen(function* () {
    const { fs, root } = yield* fixture('stale\n');

    const error = yield* Effect.flip(syncHookIo(root, true));

    const diagnostics = yield* TestConsole.errorLines;
    const contents = yield* fs.readFileString(`${root}/${helper}`);

    expect(error, 'Check should return a hook I/O drift error').toMatchObject({ _tag: 'HookIoDrift', paths: [helper] });
    expect(diagnostics, 'Diagnostic should name the drifting copy').toEqual([`drift: ${helper}`]);
    expect(contents, 'Check should not overwrite the stale copy').toBe('stale\n');
  }));
});
