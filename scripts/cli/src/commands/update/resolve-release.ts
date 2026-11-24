import { Effect, FileSystem, Option, Schema, String as Str } from 'effect';
import { Toml } from 'effect/encoding';
import type { packageNames } from '../../package-model/registry.ts';
import { vendorDir } from '../../package-model/define.ts';
import { capture, run } from '../../shared/process.ts';
import { ReleaseSource } from '../../package-model/release-source.ts';
import { UpdateError, UpdateReason } from './errors.ts';
import { StableVersion } from './pins.ts';

type PackageName = (typeof packageNames)[number];

const Release = Schema.Struct({ version: Schema.Unknown });
const Cargo = Schema.Struct({ package: Release });
const JsonRelease = Schema.fromJsonString(Release);

const manifestVersion = {
  'package.json': (text: string) => Schema.decodeEffect(JsonRelease)(text).pipe(Effect.map(release => release.version)),
  'Cargo.toml': (text: string) => Effect.fromResult(Toml.parse(text)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Cargo)),
    Effect.map(cargo => cargo.package.version),
  ),
};

const upstreamVersion = (name: PackageName, source: ReleaseSource) => {
  const vendor = vendorDir(name);
  const checkoutLatest = run('git', ['submodule', 'update', '--init', '--remote', '--', vendor]);

  return ReleaseSource.match(source, {
    NpmLatest: ({ npmPackage }) => capture('npm', ['view', npmPackage, 'version']).pipe(Effect.map(Str.trimEnd)),
    SubmoduleTag: () => checkoutLatest.pipe(
      Effect.andThen(capture('git', ['-C', vendor, 'describe', '--tags', '--abbrev=0'])),
      Effect.map(tag => Str.replace(/^v/, '')(Str.trimEnd(tag))),
    ),
    SubmoduleManifest: ({ file }) => Effect.gen(function* () {
      yield* checkoutLatest;
      const path = `${vendor}/${file}`;
      const text = yield* (yield* FileSystem.FileSystem).readFileString(path);
      return yield* manifestVersion[file](text).pipe(Effect.mapError(error => UpdateError.make({
        reason: UpdateReason.cases.InvalidReleaseMetadata.make({ packageName: name, file: path, detail: error.message }),
      })));
    }),
  });
};

export const resolveRelease = Effect.fn('resolveRelease')(function* (name: PackageName, source: ReleaseSource) {
  const upstream = yield* upstreamVersion(name, source);
  const stable = Schema.decodeUnknownOption(StableVersion)(upstream);

  if (Option.isNone(stable)) {
    return yield* UpdateError.make({ reason: UpdateReason.cases.UnstableReleaseVersion.make({ packageName: name, version: upstream }) });
  }

  return stable.value;
});
