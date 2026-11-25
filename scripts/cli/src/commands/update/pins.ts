import { Array as Arr, Effect, FileSystem, Schema, String as Str } from 'effect'
import { isDeepStrictEqual } from 'node:util'
import { isScalar, parseDocument } from 'yaml'
import { packageDir } from '../../package-model/define.ts'
import {
  type ManifestPaths,
  type ManifestSchemaTarget,
  type ManifestTarget,
  UpdateError,
  UpdateReason,
} from './errors.ts'

export const StableVersion = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)),
  Schema.brand('StableVersion'),
)
export type StableVersion = typeof StableVersion.Type

const extras = Schema.Record(Schema.String, Schema.Unknown)
const Pin = Schema.StructWithRest(Schema.Struct({ name: Schema.String, version: Schema.String }), [extras])
const PackageEntry = Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [extras])
const Marketplace = Schema.StructWithRest(
  Schema.Struct({
    marketplace: Schema.StructWithRest(Schema.Struct({ packages: Schema.Array(PackageEntry) }), [extras]),
  }),
  [extras],
)

const readPin = Schema.decodeUnknownEffect(Pin)
const readMarketplace = Schema.decodeUnknownEffect(Marketplace)

type DocumentContext = ManifestPaths & { readonly target: ManifestTarget }

const readDocument = Effect.fnUntraced(function* (text: string, context: DocumentContext) {
  const yamlError = (cause: unknown) =>
    UpdateError.make({
      reason: UpdateReason.cases.ManifestYamlReadFailed.make({ ...context, operation: 'parse', cause }),
    })
  const document = yield* Effect.try({ try: () => parseDocument(text), catch: yamlError })
  const [error] = document.errors

  if (error !== undefined) return yield* yamlError(error)

  return document
})

function decodeManifest<T>(
  value: unknown,
  decode: (value: unknown) => Effect.Effect<T, Schema.SchemaError>,
  context: ManifestPaths & { readonly target: ManifestSchemaTarget },
) {
  return decode(value).pipe(
    Effect.mapError((cause) =>
      UpdateError.make({ reason: UpdateReason.cases.ManifestSchemaMismatch.make({ ...context, cause }) }),
    ),
  )
}

function decodeDocument<T>(
  document: ReturnType<typeof parseDocument>,
  decode: (value: unknown) => Effect.Effect<T, Schema.SchemaError>,
  context: DocumentContext,
) {
  return Effect.try({
    try: () => document.toJS(),
    catch: (cause) =>
      UpdateError.make({
        reason: UpdateReason.cases.ManifestYamlReadFailed.make({ ...context, operation: 'resolve', cause }),
      }),
  }).pipe(Effect.flatMap((value) => decodeManifest(value, decode, context)))
}

function replaceYamlVersion(text: string, node: unknown, version: StableVersion, context: DocumentContext) {
  if (
    !isScalar(node) ||
    node.range == null ||
    typeof node.value !== 'string' ||
    (node.type !== 'PLAIN' && node.type !== 'QUOTE_DOUBLE' && node.type !== 'QUOTE_SINGLE')
  ) {
    return Effect.fail(UpdateError.make({ reason: UpdateReason.cases.UnsupportedVersionScalar.make({ ...context }) }))
  }

  const quote = node.type === 'QUOTE_DOUBLE' ? '"' : node.type === 'QUOTE_SINGLE' ? "'" : ''
  const [start, end] = node.range

  return Effect.succeed(Str.slice(0, start)(text) + quote + version + quote + Str.slice(end)(text))
}

export const updatePins = Effect.fnUntraced(function* (
  name: string,
  version: StableVersion,
  manifestText: string,
  rootText: string,
  paths: ManifestPaths,
) {
  const packageContext = { ...paths, target: 'package' } as const
  const marketplaceContext = { ...paths, target: 'marketplace' } as const

  const manifestDoc = yield* readDocument(manifestText, packageContext)
  const rootDoc = yield* readDocument(rootText, marketplaceContext)
  const manifest = yield* decodeDocument(manifestDoc, readPin, packageContext)
  const root = yield* decodeDocument(rootDoc, readMarketplace, marketplaceContext)

  const entries = Arr.filter(root.marketplace.packages, (entry) => entry.name === name)
  const [entry] = entries

  if (manifest.name !== name) {
    return yield* UpdateError.make({
      reason: UpdateReason.cases.ManifestNameMismatch.make({
        ...paths,
        packageName: name,
        manifestName: manifest.name,
      }),
    })
  }

  if (entries.length !== 1 || entry === undefined) {
    return yield* UpdateError.make({
      reason: UpdateReason.cases.MarketplaceEntryCountMismatch.make({
        ...paths,
        packageName: name,
        count: entries.length,
      }),
    })
  }

  const selected = yield* decodeManifest(entry, readPin, { ...paths, target: 'marketplace-entry' })
  const manifestOutput = yield* replaceYamlVersion(
    manifestText,
    manifestDoc.get('version', true),
    version,
    packageContext,
  )
  const index = root.marketplace.packages.indexOf(entry)
  const rootOutput = yield* replaceYamlVersion(
    rootText,
    rootDoc.getIn(['marketplace', 'packages', index, 'version'], true),
    version,
    marketplaceContext,
  )

  const expectedRoot = {
    ...root,
    marketplace: {
      ...root.marketplace,
      packages: Arr.map(root.marketplace.packages, (pin) => (pin === entry ? { ...pin, version } : pin)),
    },
  }
  const updatedRootDoc = yield* readDocument(rootOutput, marketplaceContext)
  const updatedRoot = yield* decodeDocument(updatedRootDoc, readMarketplace, marketplaceContext)

  if (!isDeepStrictEqual(updatedRoot, expectedRoot)) {
    return yield* UpdateError.make({
      reason: UpdateReason.cases.VersionRewriteChangedOtherValues.make({ ...marketplaceContext, packageName: name }),
    })
  }

  const updatedManifestDoc = yield* readDocument(manifestOutput, packageContext)
  const updatedManifest = yield* decodeDocument(updatedManifestDoc, readPin, packageContext)

  if (!isDeepStrictEqual(updatedManifest, { ...manifest, version })) {
    return yield* UpdateError.make({
      reason: UpdateReason.cases.VersionRewriteChangedOtherValues.make({ ...packageContext, packageName: name }),
    })
  }

  return { oldManifestVersion: manifest.version, oldMarketplaceVersion: selected.version, manifestOutput, rootOutput }
})

export const pinRelease = Effect.fn('pinRelease')(function* (name: string, version: StableVersion) {
  const fs = yield* FileSystem.FileSystem
  const paths = { manifestPath: `${packageDir(name)}/apm.yml`, marketplacePath: 'apm.yml' }
  const manifestText = yield* fs.readFileString(paths.manifestPath)
  const rootText = yield* fs.readFileString(paths.marketplacePath)
  const pins = yield* updatePins(name, version, manifestText, rootText, paths)

  if (pins.oldManifestVersion !== version) yield* fs.writeFileString(paths.manifestPath, pins.manifestOutput)
  if (pins.oldMarketplaceVersion !== version) yield* fs.writeFileString(paths.marketplacePath, pins.rootOutput)

  return pins
})
