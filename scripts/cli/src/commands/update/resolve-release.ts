import { Effect, FileSystem, Schema, String as Str } from 'effect';
import { Toml } from 'effect/encoding';
import type { packageNames } from '../../package-model/registry.ts';
import { vendorDir } from '../../package-model/define.ts';
import { capture, run } from '../../shared/process.ts';
import { ReleaseSource } from '../../package-model/release-source.ts';
import { UpdateError, UpdateReason } from './errors.ts';
import { StableVersion } from './pins.ts';

type PackageName = (typeof packageNames)[number];

const Release = Schema.Struct({ version: Schema.Unknown });
const JsonRelease = Schema.fromJsonString(Release);
const Cargo = Schema.Struct({
  package: Schema.Struct({ version: Schema.Unknown, license: Schema.optionalKey(Schema.Unknown) }),
  workspace: Schema.optionalKey(Schema.Unknown),
});

const stableVersion = (name: PackageName, version: unknown) => Effect.fromOption(
  Schema.decodeUnknownOption(StableVersion)(version),
  () => UpdateError.make({ reason: UpdateReason.cases.UnstableReleaseVersion.make({ packageName: name, version }) }),
);

export const resolveRelease = Effect.fn('resolveRelease')(function* (name: PackageName, source: ReleaseSource) {
  if (ReleaseSource.guards.NpmLatest(source)) {
    const version = yield* capture('npm', ['view', source.npmPackage, 'version']);
    return yield* stableVersion(name, Str.trimEnd(version));
  }

  const vendor = vendorDir(name);
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(`${vendor}/.git`))) {
    yield* run('git', ['submodule', 'update', '--init', '--checkout', '--', vendor]);
  }

  const fetch = (ref: string, tags = '--no-tags') => run('git', ['-C', vendor, 'fetch', tags, 'origin', ref]);
  const show = (file: string) => capture('git', ['-C', vendor, 'show', `FETCH_HEAD:${file}`]);
  const invalidMetadata = (file: string, detail: string) => UpdateError.make({
    reason: UpdateReason.cases.InvalidReleaseMetadata.make({ packageName: name, file: `${vendor}/${file}`, detail }),
  });
  const packageVersion = Effect.fnUntraced(function* () {
    const file = 'package.json';
    const text = yield* show(file);
    const release = yield* Schema.decodeEffect(JsonRelease)(text).pipe(Effect.mapError(error => invalidMetadata(file, error.message)));
    return yield* stableVersion(name, release.version);
  });

  const fromTag = ReleaseSource.guards.SubmoduleTag(source);
  yield* fetch('HEAD', fromTag ? '--tags' : '--no-tags');

  let version: StableVersion;

  if (fromTag) {
    const tag = yield* capture('git', ['-C', vendor, 'describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0', 'FETCH_HEAD']);
    version = yield* stableVersion(name, Str.replace(/^v/, '')(Str.trimEnd(tag)));
    yield* fetch(`refs/tags/v${version}`);
  } else if (ReleaseSource.guards.SubmoduleManifest(source)) {
    version = yield* packageVersion();
    const tag = `${source.tagPrefix}${version}`;
    yield* fetch(`refs/tags/${tag}`);
    const taggedVersion = yield* packageVersion();

    if (taggedVersion !== version) {
      return yield* invalidMetadata('package.json', `tag ${tag} declares version ${taggedVersion}, expected ${version}`);
    }
  } else {
    const file = 'Cargo.toml';
    const text = yield* show(file);
    const cargo = yield* Effect.fromResult(Toml.parse(text)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Cargo)),
      Effect.mapError(error => invalidMetadata(file, error.message)),
    );
    const { license } = cargo.package;
    const workspace = cargo.workspace !== undefined;

    // RTK's Apache-licensed CLI can link BUSL-licensed workspace members by default.
    if (workspace || (license !== 'Apache-2.0' && license !== 'Apache 2.0')) {
      return yield* UpdateError.make({
        reason: UpdateReason.cases.UnsupportedRtkLicense.make({ file: `${vendor}/${file}`, license, workspace }),
      });
    }

    version = yield* stableVersion(name, cargo.package.version);
  }

  yield* run('git', ['-C', vendor, 'checkout', '--detach', 'FETCH_HEAD']);

  return version;
});
