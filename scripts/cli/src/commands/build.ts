import { Array as Arr, Effect } from 'effect';
import { Command } from 'effect/cli';
import { type BuildEffect, packages } from '../package-model/registry.ts';
import { authoredHookCommands, authoredHookPackages } from '../packages/authored-hooks.ts';

export const buildCommand = Command.make('build', {}, () =>
  Effect.all([
    Effect.forEach(packages, ({ invoke }): BuildEffect => invoke(), { discard: true, concurrency: 'unbounded' }),
    Effect.forEach(authoredHookPackages, ({ invoke }) => invoke(), { discard: true, concurrency: 'unbounded' }),
  ], { discard: true, concurrency: 'unbounded' }),
).pipe(
  Command.withDescription('Regenerate marketplace packages and authored hook bundles'),
  Command.withSubcommands([...Arr.map(packages, ({ command }) => command), ...authoredHookCommands]),
);
