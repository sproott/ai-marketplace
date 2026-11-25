import { Array, Effect, FileSystem, Option, Path, Record, Schema } from 'effect'
import { isBuiltin } from 'node:module'
import { CommandFailure } from './command-failure.ts'
import { run } from './process.ts'

const importsByModule = Schema.Record(
  Schema.String,
  Schema.Struct({
    imports: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        external: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  }),
)
const metadata = Schema.fromJsonString(Schema.Struct({ inputs: importsByModule, outputs: importsByModule }))

export const bundleHook = Effect.fn('bundleHook')(function* (
  entrypoint: string,
  destination: string,
  check: boolean = false,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const scratch = yield* fs.makeTempDirectoryScoped()
  const artifact = path.join(scratch, 'hook.cjs')
  const metafile = path.join(scratch, 'meta.json')
  const buildFailure = (cause: string) => CommandFailure.make({ message: `Cannot bundle ${entrypoint}: ${cause}` })

  yield* run('bun', [
    'build',
    entrypoint,
    '--target=node',
    '--format=cjs',
    '--minify-whitespace',
    `--outfile=${artifact}`,
    `--metafile=${metafile}`,
    '--banner=// Generated hook bundle.',
  ])
  const json = yield* fs.readFileString(metafile)
  const graph = yield* Schema.decodeEffect(metadata)(json).pipe(Effect.mapError((cause) => buildFailure(cause.message)))
  const outputs = Record.values(graph.outputs)
  if (outputs.length !== 1) return yield* buildFailure('expected one self-contained bundle')

  const inputImports = Array.flatMap(Record.values(graph.inputs), ({ imports }) =>
    Array.filter(imports, (dependency) => dependency.external === true),
  )
  const outputImports = Array.flatMap(outputs, ({ imports }) => imports)
  const external = Array.findFirst([...inputImports, ...outputImports], ({ path }) => !isBuiltin(path))
  if (Option.isSome(external)) return yield* buildFailure(`external import ${external.value.path}`)

  if (check === false) {
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
    return yield* fs.copyFile(artifact, destination)
  }

  const contents = yield* fs.readFileString(artifact)
  const existing = yield* fs.readFileString(destination).pipe(Effect.option)
  if (Option.getOrUndefined(existing) !== contents) {
    return yield* CommandFailure.make({ message: `Stale hook bundle: ${destination}; run just build <package>` })
  }
}, Effect.scoped)
