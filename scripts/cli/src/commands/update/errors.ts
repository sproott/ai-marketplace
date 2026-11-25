import { Formatter, Schema } from 'effect';
import { packageNames } from '../../package-model/registry.ts';

const ManifestPaths = Schema.Struct({ manifestPath: Schema.String, marketplacePath: Schema.String });
export type ManifestPaths = typeof ManifestPaths.Type;
const ManifestTarget = Schema.Literals(['package', 'marketplace']);
export type ManifestTarget = typeof ManifestTarget.Type;
const ManifestSchemaTarget = Schema.Literals(['package', 'marketplace', 'marketplace-entry']);
export type ManifestSchemaTarget = typeof ManifestSchemaTarget.Type;

export const UpdateReason = Schema.TaggedUnion({
  InvalidReleaseMetadata: { packageName: Schema.Literals(packageNames), file: Schema.String, detail: Schema.String },
  UnsupportedRtkLicense: { file: Schema.String, license: Schema.Unknown, workspace: Schema.Boolean },
  UnstableReleaseVersion: { packageName: Schema.Literals(packageNames), version: Schema.Unknown },
  ManifestYamlReadFailed: {
    ...ManifestPaths.fields,
    target: ManifestTarget,
    operation: Schema.Literals(['parse', 'resolve']),
    cause: Schema.Unknown,
  },
  ManifestSchemaMismatch: {
    ...ManifestPaths.fields,
    target: ManifestSchemaTarget,
    cause: Schema.instanceOf(Schema.SchemaError),
  },
  ManifestNameMismatch: { ...ManifestPaths.fields, packageName: Schema.String, manifestName: Schema.String },
  MarketplaceEntryCountMismatch: { ...ManifestPaths.fields, packageName: Schema.String, count: Schema.Int },
  UnsupportedVersionScalar: { ...ManifestPaths.fields, target: ManifestTarget },
  VersionRewriteChangedOtherValues: { ...ManifestPaths.fields, packageName: Schema.String, target: ManifestTarget },
});

function formatManifestError(paths: ManifestPaths, detail: string): string {
  return `${paths.manifestPath} and ${paths.marketplacePath}: ${detail}`;
}

export class UpdateError extends Schema.TaggedError<UpdateError, { readonly brand: unique symbol }>()('UpdateError', {
  reason: UpdateReason,
}) {
  format(): string {
    return UpdateReason.match(this.reason, {
      InvalidReleaseMetadata: ({ packageName, file, detail }) => `update ${packageName}: ${file}: invalid release metadata: ${detail}`,
      UnsupportedRtkLicense: ({ file, license, workspace }) =>
        `update rtk: ${file}: expected a standalone Apache-2.0 release, got license ${Formatter.format(license)} (workspace: ${workspace}); review upstream licensing before updating`,
      UnstableReleaseVersion: ({ packageName, version }) =>
        `Expected a stable release version for ${packageName}, got ${Formatter.format(version)}`,
      ManifestYamlReadFailed: reason => formatManifestError(
        reason,
        reason.cause instanceof Error ? reason.cause.message : Formatter.format(reason.cause),
      ),
      ManifestSchemaMismatch: reason => formatManifestError(reason, reason.cause.message),
      ManifestNameMismatch: reason => formatManifestError(reason, `Expected unique matching manifests for ${reason.packageName}`),
      MarketplaceEntryCountMismatch: reason => formatManifestError(reason, `Expected unique matching manifests for ${reason.packageName}`),
      UnsupportedVersionScalar: reason => formatManifestError(reason, 'Expected a YAML version scalar'),
      VersionRewriteChangedOtherValues: reason => formatManifestError(
        reason,
        `Expected only the ${reason.target} version for ${reason.packageName} to change`,
      ),
    });
  }
}
