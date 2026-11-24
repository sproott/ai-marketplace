import { Array, Effect, PlatformError, Predicate, Schema } from 'effect';

export class CommandFailure extends Schema.TaggedError<CommandFailure, { readonly brand: unique symbol }>()('CommandFailure', {
  message: Schema.String,
}) {}

class CommandOperationFailed extends Schema.TaggedError<CommandOperationFailed, { readonly brand: unique symbol }>()('CommandOperationFailed', {
  command: Schema.String,
  cause: Schema.instanceOf(PlatformError.PlatformError),
}) {
  format(): string {
    return `${this.command}: ${this.cause.message}`;
  }
}

export type ContextualError<E> = Exclude<E, E & PlatformError.PlatformError> | CommandOperationFailed;

export const withCommandContext = (command: string) => <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(Effect.catchIf(
    (error): error is E & PlatformError.PlatformError => PlatformError.isPlatformError(error),
    (cause) => Effect.fail(CommandOperationFailed.make({ command, cause })),
  ));

type Reportable = CommandFailure | { format(): string };

const renderFailure = (message: string) => Effect.fail(CommandFailure.make({ message }));

export const reportFailure = (error: Reportable) =>
  Schema.is(CommandFailure)(error)
    ? Effect.fail(error)
    : renderFailure(error.format());

export const reportFailures = <const Tags extends readonly string[]>(...tags: Tags) =>
  <A, E extends Reportable & { readonly _tag: Tags[number] }, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.catch((error) =>
      Array.some(tags, tag => Predicate.isTagged(error, tag)) ? reportFailure(error) : Effect.die(error),
    ));
