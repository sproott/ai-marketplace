import { Effect, FileSystem, Path, Schema } from 'effect';
import { reportFailures } from '../shared/command-failure.ts';
import { defineBuilder, packageDir, vendorDir } from '../package-model/define.ts';
import { ReleaseSource } from '../package-model/release-source.ts';

class MissingPlaywrightSkill extends Schema.TaggedError<MissingPlaywrightSkill, { readonly brand: unique symbol }>()('MissingPlaywrightSkill', { source: Schema.String }) {
  format(): string {
    return `No skill at ${this.source}; run git submodule update --init ${vendorDir('playwright-cli')}`;
  }
}

export const playwrightCli = defineBuilder(
  'playwright-cli',
  Effect.fn('buildPlaywrightCli')(function* (out: string | undefined) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = process.cwd();
    const source = path.join(root, vendorDir('playwright-cli'), 'skills/playwright-cli');
    const apm = path.join(path.resolve(root, out ?? packageDir('playwright-cli')), '.apm');

    if (!(yield* fs.exists(path.join(source, 'SKILL.md')))) {
      return yield* MissingPlaywrightSkill.make({ source });
    }

    yield* fs.remove(apm, { recursive: true, force: true });
    yield* fs.makeDirectory(path.join(apm, 'skills'), { recursive: true });
    yield* fs.copy(source, path.join(apm, 'skills/playwright-cli'));
  }),
  reportFailures('MissingPlaywrightSkill', 'CommandOperationFailed'),
  { release: ReleaseSource.cases.SubmoduleManifest.make({ tagPrefix: 'v' }) },
);
