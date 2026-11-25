import { BunServices } from '@effect/platform-bun'
import { expect, layer } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'
import { Digest } from 'effect/crypto'
import { vi } from 'vitest'
import { exactCounter } from '../src/commands/weigh/exact.ts'

vi.mock('@anthropic-ai/sdk', () => {
  class APIError {
    readonly status = 429

    constructor(readonly message: string) {}
  }

  return {
    APIError,
    default: class {
      readonly messages = {
        countTokens: () => Promise.reject(new APIError('sensitive response body')),
      }
    },
  }
})

layer(Layer.merge(BunServices.layer, Digest.layerWebCrypto))('exact counting', (it) => {
  it.effect('should expose only safe diagnostics when the SDK rejects the request', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped()
      const exact = yield* exactCounter(root, 'fixture-model')

      const error = yield* Effect.flip(exact.count('private fixture text'))

      expect(error, 'API failure exposes the safe HTTP status').toMatchObject({
        _tag: 'ExactCountFailed',
        reason: { _tag: 'TokenRequestFailed', status: 429 },
      })
      expect(error, 'typed failure should not retain the raw SDK response').not.toHaveProperty('reason.cause')
    }),
  )
})
