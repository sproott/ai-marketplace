import { Array, Effect, Path } from 'effect'
import { Command, Flag } from 'effect/cli'
import { bundleHook } from '../shared/build-hook-bundle.ts'
import { reportFailures, withCommandContext } from '../shared/command-failure.ts'
import { packageDir } from '../package-model/define.ts'

const authoredHookPackage = (name: string, hook: string) => {
  const invoke = (check = false) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const root = path.resolve(packageDir(name))

      yield* bundleHook(path.join(root, `src/hooks/${hook}.ts`), path.join(root, `.apm/hooks/${hook}.cjs`), check)
    }).pipe(withCommandContext(name), reportFailures('CommandFailure', 'CommandOperationFailed', 'SubprocessExited'))

  const command = Command.make(name, { check: Flag.Boolean('check').pipe(Flag.withDefault(false)) }, ({ check }) =>
    invoke(check),
  ).pipe(Command.withDescription('Bundle this package’s authored hook'))

  return { command, invoke }
}

export const authoredHookPackages = [
  authoredHookPackage('fsharp', 'fsharplint_check'),
  authoredHookPackage('oxlint', 'oxlint_check'),
  authoredHookPackage('personal', 'comment_style_check'),
  authoredHookPackage('rules-on-create', 'rules_on_create'),
] as const

export const authoredHookCommands = Array.map(authoredHookPackages, ({ command }) => command)
