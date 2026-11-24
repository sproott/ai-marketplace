import { Schema } from 'effect';

export const ReleaseSource = Schema.TaggedUnion({
  NpmLatest: { npmPackage: Schema.String },
  SubmoduleTag: {},
  SubmoduleManifest: { file: Schema.Literals(['package.json', 'Cargo.toml']) },
});
export type ReleaseSource = typeof ReleaseSource.Type;
