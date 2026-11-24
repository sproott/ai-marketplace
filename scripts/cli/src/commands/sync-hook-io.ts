import { Array as Arr, Console, Effect, FileSystem, Path, Predicate, Schema } from 'effect';
import { Command, Flag } from 'effect/cli';
import { reportFailures, withCommandContext } from '../shared/command-failure.ts';

class HookIoDrift extends Schema.TaggedError<HookIoDrift, { readonly brand: unique symbol }>()('HookIoDrift', { paths: Schema.Array(Schema.String) }) {
  format(): string {
    return 'Hook I/O drift: run sync-hook-io without --check to refresh the copies.';
  }
}

export const syncHookIo = Effect.fn('syncHookIo')(function* (root: string, check: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* fs.glob('packages/*/.apm/hooks/*.py', { root });
  const consumers = new Set<string>();

  for (const file of files) {
    const dir = path.dirname(file);
    if (consumers.has(dir)) continue;

    const source = path.join(root, file);
    if ((yield* fs.stat(source)).type !== 'File') continue;

    const content = yield* fs.readFileString(source);
    if (/^import hook_io/m.test(content)) consumers.add(dir);
  }

  if (consumers.size === 0) return;

  const canonical = path.join(root, 'scripts/assets/hook-io/hook_io.py');
  const copies = Arr.map([...consumers].sort(), (dir) => `${dir}/hook_io.py`);

  if (!check) {
    for (const file of copies) {
      yield* fs.copyFile(canonical, path.join(root, file));
      yield* Console.log(`synced ${file}`);
    }
    return;
  }

  const expected = yield* fs.readFile(canonical);
  const mismatches = yield* Effect.filter(copies, (file) => fs.readFile(path.join(root, file)).pipe(
    Effect.catchIf((error) => Predicate.isTagged(error.reason, 'NotFound'), () => Effect.undefined),
    Effect.map((actual) => actual?.length !== expected.length || expected.some((byte, index) => byte !== actual[index])),
  ));

  yield* Effect.forEach(mismatches, (file) => Console.error(`drift: ${file}`), { discard: true, concurrency: 1 });
  if (mismatches.length > 0) {
    return yield* HookIoDrift.make({ paths: mismatches });
  }
});

export const syncHookIoCommand = Command.make('sync-hook-io', {
  check: Flag.Boolean('check').pipe(Flag.withDefault(false), Flag.withDescription('Report drift without writing files')),
}, ({ check }) => syncHookIo(process.cwd(), check).pipe(
  withCommandContext('sync-hook-io'),
  reportFailures('HookIoDrift', 'CommandOperationFailed'),
)).pipe(
  Command.withDescription('Copy the canonical hook_io.py to its package consumers'),
);
