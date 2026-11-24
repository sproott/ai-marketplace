import { Console, Effect, FileSystem, Path, Schema } from 'effect';
import { run } from '../shared/process.ts';
import { copyFile } from '../shared/files.ts';
import { reportFailures } from '../shared/command-failure.ts';
import { defineBuilder, packageDir, vendorDir } from '../package-model/define.ts';
import { ReleaseSource } from '../package-model/release-source.ts';

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json, { space: 2 }));

class MissingRtkSource extends Schema.TaggedError<MissingRtkSource, { readonly brand: unique symbol }>()('MissingRtkSource', { vendor: Schema.String }) {
  format(): string {
    return `${this.vendor} not found — run "git submodule update --init"`;
  }
}

export const rtk = defineBuilder(
  'rtk',
  Effect.fn('buildRtk')(function* (out: string | undefined, validate: boolean) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = process.cwd();
    const vendor = path.join(root, vendorDir('rtk'));
    const authored = path.join(root, 'scripts/assets/rtk');
    const destination = path.resolve(root, out ?? packageDir('rtk'));
    const apm = path.join(destination, '.apm');
    const hooks = path.join(apm, 'hooks');

    if (!(yield* fs.exists(vendor)) || (yield* fs.readDirectory(vendor)).length === 0) {
      return yield* MissingRtkSource.make({ vendor });
    }

    yield* fs.remove(apm, { recursive: true, force: true });

    for (const hook of ['rtk-hook-io', 'rtk-rewrite-extra', 'rtk-hook-wrapper', 'rtk-shim-install', 'rtk-shim-gate']) {
      yield* copyFile(path.join(authored, `${hook}.sh`), path.join(hooks, `${hook}.sh`));
    }

    for (const [name, command] of [
      ['rtk-rewrite-extra', './rtk-rewrite-extra.sh'],
      ['rtk-hook', './rtk-hook-wrapper.sh hook auto'],
      ['rtk-shim-gate', './rtk-shim-gate.sh'],
    ] as const) {
      const descriptor = {
        PreToolUse: [{ matcher: 'Bash|bash|powershell', hooks: [{ type: 'command', command }] }],
      };
      const json = yield* encodeJson(descriptor).pipe(Effect.orDie);

      yield* fs.writeFileString(path.join(hooks, `${name}.json`), `${json}\n`);
    }

    const shimInstall = {
      SessionStart: [{
        hooks: [{
          type: 'command',
          command: './rtk-shim-install.sh',
          timeout: 5,
          statusMessage: 'Installing rtk PATH shim...',
        }],
      }],
    };
    const shimJson = yield* encodeJson(shimInstall).pipe(Effect.orDie);

    yield* fs.writeFileString(path.join(hooks, 'rtk-shim-install.json'), `${shimJson}\n`);

    yield* Console.log(`Generated ${path.relative(root, apm)}`);

    if (validate) yield* run('apm', ['compile', '--validate'], destination);
  }),
  reportFailures('MissingRtkSource', 'SubprocessExited', 'CommandOperationFailed'),
  { release: ReleaseSource.cases.SubmoduleManifest.make({ file: 'Cargo.toml' }), validate: true },
);
