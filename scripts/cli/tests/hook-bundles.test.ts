import { BunServices } from '@effect/platform-bun'
import { expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { bundleHook } from '../src/shared/build-hook-bundle.ts'

it.layer(BunServices.layer)('built hook bundles', (it) => {
  it.effect.each([
    ['caveman', 'caveman-hook-io', 'caveman'],
    ['impeccable', 'hook', 'impeccable/claude'],
    ['impeccable', 'hook', 'impeccable/copilot'],
  ] as const)('should match a relocated build when checking %s/%s for %s', ([name, hook, target]) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const temp = yield* fs.makeTempDirectoryScoped()
      const root = path.join(temp, 'nested', 'checkout')
      const sources = path.join('packages', name, 'src/hooks')
      const shared = 'packages/_shared/hook-io'
      yield* fs.makeDirectory(path.dirname(path.join(root, sources)), { recursive: true })
      yield* fs.makeDirectory(path.dirname(path.join(root, shared)), { recursive: true })
      yield* fs.copy(sources, path.join(root, sources))
      yield* fs.copy(shared, path.join(root, shared))
      yield* fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'))

      const result = yield* Effect.result(
        bundleHook(
          path.join(root, sources, `${hook}.ts`),
          path.resolve('packages', target, '.apm/hooks', `${hook}.cjs`),
          true,
        ),
      )

      expect(result, 'committed bundle matches a rebuild from another checkout path').toMatchObject({
        _tag: 'Success',
      })
    }),
  )
})
