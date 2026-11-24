import { Array as Arr, Effect } from 'effect';
import { Command } from 'effect/cli';
import { type BuildEffect, packages } from '../package-model/registry.ts';

export const buildCommand = Command.make('build', {}, () =>
  Effect.forEach(packages, ({ invoke }): BuildEffect => invoke(), { discard: true, concurrency: 'unbounded' }),
).pipe(
  Command.withDescription('Regenerate packages from upstream inputs'),
  Command.withSubcommands(Arr.map(packages, ({ command }) => command)),
);
