import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';
import { Command } from 'effect/cli';
import { buildCommand } from './commands/build.ts';
import { reportFailures, withCommandContext } from './shared/command-failure.ts';
import { syncHookIoCommand } from './commands/sync-hook-io.ts';
import { updateCommand } from './commands/update/update.ts';
import { weighCommand } from './commands/weigh/weigh.ts';

const cli = Command.make('cli').pipe(
  Command.withDescription('Maintain the AI marketplace'),
  Command.withSubcommands([buildCommand, weighCommand, updateCommand, syncHookIoCommand]),
);

class NotMarketplaceRoot extends Schema.TaggedError<NotMarketplaceRoot, { readonly brand: unique symbol }>()('NotMarketplaceRoot', {}) {
  format(): string {
    return 'Run the marketplace CLI from the repository root (expected apm.yml and packages/).';
  }
}

const checkRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const manifestExists = yield* fs.exists('apm.yml');
  const packagesExist = yield* fs.exists('packages');
  if (!manifestExists || !packagesExist) {
    return yield* NotMarketplaceRoot.make({});
  }
}).pipe(
  withCommandContext('cli'),
  reportFailures('NotMarketplaceRoot', 'CommandOperationFailed'),
);

checkRoot.pipe(
  Effect.andThen(Command.run(cli, { version: '1.0.0' })),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
