import { Effect, Option, Path, String } from 'effect';
import { CliError, Command, Flag } from 'effect/cli';
import { withCommandContext, type CommandFailure, type ContextualError } from '../shared/command-failure.ts';
import type { ReleaseSource } from './release-source.ts';

export const vendorDir = (name: string) => `vendor/${name}`;
export const packageDir = (name: string) => `packages/${name}`;

const destination = Flag.String('out').pipe(
  Flag.filter((value) => String.trim(value).length > 0, () => '--out cannot be empty'),
);

const packageDestination = destination.pipe(
  Flag.mapEffect(Effect.fnUntraced(function* (value) {
    const path = yield* Path.Path;

    if (path.resolve(value) === process.cwd()) {
      return yield* CliError.InvalidValue.make({
        option: 'out',
        value,
        expected: '--out must not be the repository root',
        kind: 'flag',
      });
    }

    return value;
  })),
  Flag.optional,
  Flag.withDescription('Package destination directory'),
);

const packagesParent = destination.pipe(
  Flag.optional,
  Flag.withDescription('Parent directory for the generated packages'),
);

const defaultValidation = false;
const validate = Flag.Boolean('validate').pipe(
  Flag.withDefault(defaultValidation),
  Flag.withDescription('Run APM validation after building'),
);

export function defineBuilder<const Name extends string, E, R>(
  name: Name,
  generate: (out: string | undefined, validate: boolean) => Effect.Effect<void, E, R>,
  handle: (effect: Effect.Effect<void, NoInfer<ContextualError<E>>, NoInfer<R>>) => Effect.Effect<void, CommandFailure, R>,
  options: { release: ReleaseSource; parent?: true; validate?: true },
) {
  const out = options.parent === true ? packagesParent : packageDestination;
  const build = (destination?: string, validation = defaultValidation) => generate(destination, validation);

  const invoke = (destination?: string, validation?: boolean) => handle(build(destination, validation).pipe(withCommandContext(name)));

  const command = options.validate === true
    ? Command.make(name, { out, validate }, (flags) => invoke(Option.getOrUndefined(flags.out), flags.validate))
    : Command.make(name, { out }, (flags) => flags.out.pipe(Option.getOrUndefined, invoke));

  return { command, build, invoke, release: options.release };
}
