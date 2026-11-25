import { Array as Arr, Effect, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export class SubprocessExited extends Schema.TaggedError<SubprocessExited, { readonly brand: unique symbol }>()(
  'SubprocessExited',
  {
    command: Schema.String,
    args: Schema.Array(Schema.String),
    status: Schema.Finite,
  },
) {
  format(): string {
    return `${Arr.join([this.command, ...this.args], ' ')} exited with status ${this.status}`
  }
}

export const run = Effect.fn('run')(function* (command: string, args: readonly string[], cwd?: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      cwd,
      detached: false,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      extendEnv: true,
    }),
  )

  const status = yield* child.exitCode
  if (status !== 0) return yield* SubprocessExited.make({ command, args, status })
}, Effect.scoped)

export const capture = Effect.fn('capture')(function* (command: string, args: readonly string[], cwd?: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      cwd,
      stdout: 'pipe',
      stderr: 'inherit',
      extendEnv: true,
    }),
  )

  const output = yield* Stream.runFold(
    Stream.decodeText(child.stdout),
    () => '',
    (text, chunk) => text + chunk,
  )
  const status = yield* child.exitCode
  if (status !== 0) return yield* SubprocessExited.make({ command, args, status })

  return output
}, Effect.scoped)
