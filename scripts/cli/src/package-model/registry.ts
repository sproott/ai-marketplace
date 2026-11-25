import { Array as Arr, Effect, Option } from 'effect'
import { caveman } from '../packages/caveman.ts'
import { fallow } from '../packages/fallow.ts'
import { impeccable } from '../packages/impeccable/index.ts'
import { playwrightCli } from '../packages/playwright-cli.ts'
import { rtk } from '../packages/rtk.ts'

export const packages = [caveman, fallow, impeccable, playwrightCli, rtk] as const
type PackageBuild = ReturnType<(typeof packages)[number]['invoke']>
export type BuildEffect = Effect.Effect<void, Effect.Error<PackageBuild>, Effect.Services<PackageBuild>>
type PackageName = (typeof packages)[number]['command']['name']
export const packageNames = Arr.map(packages, ({ command }) => command.name)

const definition = (name: PackageName) => Arr.findFirst(packages, ({ command }) => command.name === name)

export const buildPackage = (name: PackageName): BuildEffect =>
  Option.match(definition(name), {
    onNone: () => Effect.die(`Unregistered builder: ${name}`),
    onSome: ({ invoke }) => invoke(),
  })

export const releaseSource = (name: PackageName) =>
  Option.match(definition(name), {
    onNone: () => Effect.die(`Unregistered builder: ${name}`),
    onSome: ({ release }) => Effect.succeed(release),
  })
