import { Effect, FileSystem, Path, type PlatformError } from 'effect';

export const copyFile = Effect.fn('copyFile')(function* (src: string, dest: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* fs.makeDirectory(path.dirname(dest), { recursive: true });
  yield* fs.copyFile(src, dest);

  const { mode } = yield* fs.stat(src);
  yield* fs.chmod(dest, mode & 0o7777);
});

export const copyDir = (src: string, dest: string, skipAtRoot: readonly string[] = []): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    for (const entry of yield* fs.readDirectoryEntries(src)) {
      if (skipAtRoot.includes(entry.name)) continue;

      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);

      if (entry.type === 'Directory') yield* copyDir(from, to);
      else if (entry.type === 'File') yield* copyFile(from, to);
    }
  });
