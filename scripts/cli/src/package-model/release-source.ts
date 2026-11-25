import { Schema } from 'effect'

export const ReleaseSource = Schema.TaggedUnion({
  NpmLatest: { npmPackage: Schema.String },
  SubmoduleTag: {},
  SubmoduleManifest: { tagPrefix: Schema.Literals(['v', 'skill-v']) },
  RtkDefaultBranch: {},
})
export type ReleaseSource = typeof ReleaseSource.Type
