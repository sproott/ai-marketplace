import { BunServices } from '@effect/platform-bun';
import { expect, it } from '@effect/vitest';
import { Effect, FileSystem, Path, Stream, String } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { removeStatuslineSetupNudge, rewriteSkillDescription } from '../src/packages/caveman.ts';
import { copyDir } from '../src/shared/files.ts';

const check = <E>(name: string, transform: () => Effect.Effect<string, E>, expected: string) => {
  it.effect(name, () => Effect.gen(function* () {
    const actual = yield* transform();

    expect(actual, name).toBe(expected);
  }));
};

const rejects = <E>(name: string, transform: () => Effect.Effect<string, E>, expected: { _tag: string; file: string; anchor?: string; count?: number }) => {
  it.effect(name, () => Effect.gen(function* () {
    const error = yield* Effect.flip(transform());

    expect(error, name).toMatchObject({ _tag: 'CavemanBuildError', reason: expected });
  }));
};

it.layer(BunServices.layer)('Caveman generator', (it) => {
  check(
    'should replace the description when it occupies one line',
    () => rewriteSkillDescription('---\nname: x\ndescription: old text\n---\n\nBody.\n', 'new'),
    '---\nname: x\ndescription: "new"\n---\n\nBody.\n'
  );

  check(
    'should replace the description when it is quoted',
    () => rewriteSkillDescription("---\ndescription: 'old text'\n---\nBody.\n", 'new'),
    '---\ndescription: "new"\n---\nBody.\n',
  );

  it.effect.each([
    { field: 'description:', kind: 'null' },
    { field: 'description: ""', kind: 'empty string' },
    { field: 'description: "  "', kind: 'empty string' },
    { field: 'description: 42', kind: 'number' },
    { field: 'description: [text]', kind: 'sequence' },
    { field: 'other: text', kind: 'missing' },
  ])('should return InvalidSkillDescription error when $field is present', ({ field, kind }) => Effect.gen(function* () {
    const input = `---\nname: x\n${field}\n---\nBody.\n`;
    const file = 'skills/caveman/SKILL.md';

    const error = yield* Effect.flip(rewriteSkillDescription(input, 'new', file));

    expect(error, 'the error should identify the skill file and description type').toMatchObject({
      _tag: 'CavemanBuildError', reason: { _tag: 'InvalidSkillDescription', file, found: kind },
    });
  }));

  check(
    'should consume continuation lines when the description wraps',
    () => rewriteSkillDescription(
      '---\nname: x\ndescription: old text\n  wrapped on\n  three lines\nallowed-tools: Read\n---\n\nBody.\n',
      'new'
    ),
    '---\nname: x\ndescription: "new"\nallowed-tools: Read\n---\n\nBody.\n'
  );

  check(
    'should preserve the next key when the description is a folded scalar',
    () => rewriteSkillDescription(
      '---\nname: x\ndescription: >-\n  old text\n  wrapped once\nallowed-tools: Read\n---\n\nBody.\n',
      'new'
    ),
    '---\nname: x\ndescription: "new"\nallowed-tools: Read\n---\n\nBody.\n'
  );

  check(
    'should consume continuation lines when the description is the last key',
    () => rewriteSkillDescription('---\nname: x\ndescription: old\n  more old\n---\n\nBody.\n', 'new'),
    '---\nname: x\ndescription: "new"\n---\n\nBody.\n'
  );

  check(
    'should leave the body untouched when it contains a horizontal rule',
    () => rewriteSkillDescription('---\ndescription: old\n---\n\nIntro\n\n---\n\nMore.\n', 'new'),
    '---\ndescription: "new"\n---\n\nIntro\n\n---\n\nMore.\n'
  );

  rejects(
    'should return MissingSkillFrontmatter error when frontmatter is absent',
    () => rewriteSkillDescription('# Just a heading\n', 'new'),
    { _tag: 'MissingSkillFrontmatter', file: 'SKILL.md' },
  );

  check(
    'should preserve hook output when removing the statusline setup nudge',
    () => removeStatuslineSetupNudge(
      '//   3. Detects missing statusline config and emits setup nudge\nconst settingsPath = path.join(claudeDir, \'settings.json\');\noutput = "rules";\n// 3. Detect missing statusline config — nudge Claude to help set it up\ntry {\n  output += "STATUSLINE SETUP NEEDED";\n} catch (e) {\n  // Silent fail — don\'t block session start over statusline detection\n}\n\noutput += "future hook behavior";\nprocess.stdout.write(output);\n'
    ),
    'output = "rules";\noutput += "future hook behavior";\nprocess.stdout.write(output);\n'
  );

  rejects(
    'should return UnexpectedStatuslineAnchorCount error when the setup nudge is missing',
    () => removeStatuslineSetupNudge('process.stdout.write(output);\n'),
    { _tag: 'UnexpectedStatuslineAnchorCount', file: 'src/hooks/caveman-activate.js', anchor: 'statusline setup nudge', count: 0 },
  );

  it.effect('should return UnexpectedStatuslineAnchorCount error when the setup nudge occurs twice', () => Effect.gen(function* () {
    const nudge = "// 3. Detect missing statusline config — nudge Claude to help set it up\ntry {\n} catch (e) {\n  // Silent fail — don't block session start over statusline detection\n}\n\n";

    const error = yield* Effect.flip(removeStatuslineSetupNudge(String.repeat(2)(nudge)));

    expect(error, 'the error should identify the hook and duplicated anchor').toMatchObject({
      _tag: 'CavemanBuildError',
      reason: { _tag: 'UnexpectedStatuslineAnchorCount', file: 'src/hooks/caveman-activate.js', anchor: 'statusline setup nudge', count: 2 },
    });
  }));

  it.effect('should skip only root matches when a skill contains nested files with the same name', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* fs.makeTempDirectoryScoped();
      const source = path.join(temp, 'source');
      const destination = path.join(temp, 'destination');

      yield* fs.makeDirectory(path.join(source, 'references'), { recursive: true });
      yield* fs.writeFileString(path.join(source, 'README.md'), 'Root readme');
      yield* fs.writeFileString(path.join(source, 'references', 'README.md'), 'Reference readme');

      yield* copyDir(source, destination, ['README.md']);

      const rootReadmeExists = yield* fs.exists(path.join(destination, 'README.md'));
      const reference = yield* fs.readFileString(path.join(destination, 'references', 'README.md'));

      expect(rootReadmeExists, 'the root readme should be omitted').toBe(false);
      expect(reference, 'the nested readme should be preserved').toBe('Reference readme');
    }),
  );

  it.effect('should run the bundled activation wrapper when launched by native Node', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const config = yield* fs.makeTempDirectoryScoped();
      const hooks = path.join(process.cwd(), 'packages/caveman/.apm/hooks');

      const child = yield* spawner.spawn(ChildProcess.make('node', ['./caveman-hook-io.js', 'caveman-activate.js'], {
        cwd: hooks,
        extendEnv: true,
        env: { CLAUDE_CONFIG_DIR: config, CAVEMAN_DEFAULT_MODE: 'off' },
        stdin: Stream.make('{"session_id":"test"}').pipe(Stream.encodeText),
        stderr: 'inherit',
      }));
      const [output, status] = yield* Effect.all([
        child.stdout.pipe(Stream.decodeText, Stream.mkString),
        child.exitCode,
      ], { concurrency: 'unbounded' });

      expect(status, 'the activation hook should exit successfully').toBe(0);
      expect(output, 'the activation hook should report that it ran with Caveman off').toBe('OK');
    }),
    5000,
  );
});
