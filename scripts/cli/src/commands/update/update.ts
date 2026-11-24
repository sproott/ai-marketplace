import { Console, Effect } from 'effect';
import { Argument, Command } from 'effect/cli';
import { buildPackage, packageNames, releaseSource } from '../../package-model/registry.ts';
import { reportFailures, withCommandContext } from '../../shared/command-failure.ts';
import { run } from '../../shared/process.ts';
import { resolveRelease } from './resolve-release.ts';
import { pinRelease } from './pins.ts';

type PackageName = (typeof packageNames)[number];

const selection = Argument.Literals('package', ['all', ...packageNames] as const).pipe(
  Argument.withDefault('all'),
);

const update = Effect.fn('update')(function* <E, R>(
  selection: PackageName | 'all',
  build: (name: PackageName) => Effect.Effect<void, E, R>,
) {
  for (const name of selection === 'all' ? packageNames : [selection]) {
    const source = yield* releaseSource(name);
    const version = yield* resolveRelease(name, source);
    const pins = yield* pinRelease(name, version);

    yield* Console.log(`${name}: ${pins.oldManifestVersion} -> ${version} (marketplace: ${pins.oldMarketplaceVersion} -> ${version})`);
    yield* build(name);
  }

  for (const stage of ['test', 'install']) yield* run('just', [stage]);
  // APM audit fails routinely, including on pre-existing issues; report it without failing the update.
  yield* run('just', ['audit']).pipe(Effect.catchTag('SubprocessExited', error => Console.error(`Audit failed (not blocking): ${error.format()}`)));
});

const updateBase = Command.make('update', { selection }).pipe(
  Command.withDescription('Update upstream releases, rebuild packages, and verify the marketplace'),
);

export const makeUpdateCommand = <E, R>(build: (name: PackageName) => Effect.Effect<void, E, R>) =>
  updateBase.pipe(Command.withHandler(({ selection }) => update(selection, build)));

export const updateCommand = updateBase.pipe(
  Command.withHandler(({ selection }) => update(selection, buildPackage).pipe(
    withCommandContext('update'),
    reportFailures('UpdateError', 'SubprocessExited', 'CommandFailure', 'CommandOperationFailed'),
  )),
);
