import { BunServices } from '@effect/platform-bun';
import { expect, it } from '@effect/vitest';
import { Effect, FileSystem, Path } from 'effect';
import { rtk } from '../src/packages/rtk.ts';

it.layer(BunServices.layer)('RTK package builder', (it) => {
  it.effect('should replace only the generated tree when the destination already exists', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const out = yield* fs.makeTempDirectoryScoped();
      const apm = path.join(out, '.apm');
      const readme = path.join(out, 'README.md');

      yield* fs.makeDirectory(apm);
      yield* fs.writeFileString(path.join(apm, 'stale'), 'obsolete');
      yield* fs.writeFileString(readme, 'authored');

      yield* rtk.build(out);

      const entries = yield* fs.readDirectory(apm);
      const contents = yield* fs.readFileString(readme);

      expect(entries, 'only the generated hooks directory should remain').toEqual(['hooks']);
      expect(contents, 'authored README should survive').toBe('authored');
    }),
  );

  it.effect('should preserve hook modes when copying the authored scripts', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const out = yield* fs.makeTempDirectoryScoped();
      const hook = 'rtk-hook-wrapper.sh';
      const source = yield* fs.stat(path.join('scripts/assets/rtk', hook));

      yield* rtk.build(out);

      const built = yield* fs.stat(path.join(out, '.apm', 'hooks', hook));

      expect(built.mode & 0o777, 'wrapper permissions should match the source').toBe(source.mode & 0o777);
    }),
  );
});
