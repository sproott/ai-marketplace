import { BunServices } from '@effect/platform-bun';
import { describe, expect, it } from '@effect/vitest';
import { Array as Arr, Effect, FileSystem, Option, PlatformError, Record, Sink, Stream, String as Str } from 'effect';
import { Command } from 'effect/cli';
import { ChildProcessSpawner } from 'effect/process';
import { TestConsole } from 'effect/testing';
import { packageNames, packages } from '../src/package-model/registry.ts';
import { ReleaseSource } from '../src/package-model/release-source.ts';
import { run } from '../src/shared/process.ts';
import { makeUpdateCommand } from '../src/commands/update/update.ts';

type Package = (typeof packageNames)[number];
const names = packageNames;
const releaseOf = (name: Package) => Arr.findFirst(packages, ({ command }) => command.name === name).pipe(
  Option.match({ onNone: () => expect.fail(`${name} should be registered`), onSome: ({ release }) => release }),
);
const versions = Record.fromEntries(Arr.map(names, (name, index) => [name, `${index + 2}.0.0`] as const)) as Record<Package, string>;
const manifest = (name: Package) => `packages/${name}/apm.yml`;
const entry = (name: Package, version = '1.0.0') => `    - name: ${name}\n      version: ${version}\n`;
const marketplace = '# retain me\nversion: 9.0.0 # unrelated\nmarketplace:\n  packages:\n' + Arr.join(Arr.map(names, name => entry(name)), '');
const pinStyles: Partial<Record<Package, (version: string) => string>> = {
  fallow: version => `# package comment\nname: fallow\nversion: "${version}" # pinned release\n`,
  impeccable: version => `{"name":"impeccable","version":"${version}","description":"keep me"}\n`,
};
const packagePin = (name: Package, version = '1.0.0') => pinStyles[name]?.(version) ?? `name: ${name}\nversion: ${version}\n`;

const npmLine = (npmPackage: string) => `npm view ${npmPackage} version`;
const git = (name: Package) => `git -C vendor/${name}`;
const tagLine = `${git('caveman')} describe --tags --match v[0-9]* --abbrev=0 FETCH_HEAD`;
const initialize = (name: Package) => `git submodule update --init --checkout -- vendor/${name}`;
const upstream = (name: Package, tags = '--no-tags') => `${git(name)} fetch ${tags} origin HEAD`;
const show = (name: Package, file = 'package.json') => `${git(name)} show FETCH_HEAD:${file}`;
const fetchTag = (name: Package, prefix: string) => `${git(name)} fetch --no-tags origin refs/tags/${prefix}${versions[name]}`;
const checkout = (name: Package) => `${git(name)} checkout --detach FETCH_HEAD`;
const checks = ['just test', 'just install', 'just audit'];
const stepsFor = (name: Package) => [
  ...ReleaseSource.match(releaseOf(name), {
    NpmLatest: ({ npmPackage }) => [npmLine(npmPackage)],
    SubmoduleTag: () => [initialize(name), upstream(name, '--tags'), tagLine, fetchTag(name, 'v'), checkout(name)],
    SubmoduleManifest: ({ tagPrefix }) => [initialize(name), upstream(name), show(name), fetchTag(name, tagPrefix), show(name), checkout(name)],
    RtkDefaultBranch: () => [initialize(name), upstream(name), show(name, 'Cargo.toml'), checkout(name)],
  }),
  `fixture-build ${name}`,
];
const npm = npmLine('fallow');
const impeccableSteps = [...stepsFor('impeccable'), ...checks];
const cavemanSteps = stepsFor('caveman');
const allSteps = [...Arr.flatMap(names, stepsFor), ...checks];

const fixture = ({ fail, latest, output = {}, tagVersion, initialized = false }: { fail?: string; latest?: string; output?: Record<string, string>; tagVersion?: string; initialized?: boolean } = {}) => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped();
  const read = (path: string) => fs.readFileString(`${root}/${path}`);
  const write = (path: string, text: string) => fs.writeFileString(`${root}/${path}`, text);
  const outputs = new Map<string, string>();

  yield* write('apm.yml', marketplace);
  for (const name of names) {
    yield* fs.makeDirectory(`${root}/packages/${name}`, { recursive: true });
    yield* write(manifest(name), packagePin(name));

    const version = versions[name];
    ReleaseSource.match(releaseOf(name), {
      NpmLatest: ({ npmPackage }) => outputs.set(npmLine(npmPackage), `${latest ?? version}\n`),
      SubmoduleTag: () => outputs.set(tagLine, `v${version}\n`),
      SubmoduleManifest: () => outputs.set(show(name), `{"version":"${version}"}`),
      RtkDefaultBranch: () => outputs.set(show(name, 'Cargo.toml'), `[package]\nversion = "${version}"\nlicense = "Apache 2.0"\n`),
    });
  }

  const log: string[] = [];
  const unsupportedCommand = (description: string) => PlatformError.badArgument({
    module: 'ChildProcessSpawner', method: 'spawn', description,
  });
  const spawner = ChildProcessSpawner.make(command => Effect.gen(function* () {
    if (command._tag !== 'StandardCommand') {
      return yield* unsupportedCommand('Fixture expects a single subprocess');
    }

    const { args } = command;

    if (!Arr.every(args, arg => typeof arg === 'string')) {
      return yield* unsupportedCommand('Fixture expects plain string arguments');
    }

    const line = Arr.join([command.command, ...args], ' ');
    const taggedManifest = tagVersion !== undefined && line === show('impeccable') && log.includes(fetchTag('impeccable', 'skill-v'));
    const stdout = taggedManifest ? `{"version":"${tagVersion}"}` : output[line] ?? outputs.get(line) ?? '';

    log.push(line);

    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(1),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(line === fail ? 42 : 0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: stdout.length > 0 ? Stream.make(new TextEncoder().encode(stdout)) : Stream.empty,
      stderr: Stream.empty,
      all: Stream.empty,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });
  }));

  const cli = Command.make('fixture').pipe(Command.withSubcommands([
    makeUpdateCommand(name => run('fixture-build', [name])),
  ]));
  const parse = Command.runWith(cli, { version: '0.0.0', renderErrors: false });
  const update = (...args: string[]) => parse(['update', ...args]).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({ readFileString: read, writeFileString: write, exists: () => Effect.succeed(initialized) })),
  );

  return { read, write, update, log };
});

const withPlatform = Effect.provide(BunServices.layer);
const withConsole = Effect.provide(TestConsole.layer);

describe('update', () => {
  it.effect.each([
    { name: 'caveman', prefix: 'v' },
    { name: 'impeccable', prefix: 'skill-v' },
    { name: 'playwright-cli', prefix: 'v' },
  ] as const)('should checkout the exact release before building when updating $name', ({ name, prefix }) => Effect.gen(function* () {
    const { update, log } = yield* fixture();

    yield* update(name);

    const tag = `${prefix}${versions[name]}`;
    const manifestCheck = name === 'caveman' ? [] : [show(name)];
    expect(log.slice(-6 - manifestCheck.length), 'The exact upstream tag should be fetched and its commit should be checked out before building').toEqual([
      `${git(name)} fetch --no-tags origin refs/tags/${tag}`,
      ...manifestCheck,
      checkout(name),
      `fixture-build ${name}`, ...checks,
    ]);
  }).pipe(withPlatform, withConsole));

  it.effect('should preserve pins with InvalidReleaseMetadata when the exact tag declares a different version', () => Effect.gen(function* () {
    const { read, update, log } = yield* fixture({ tagVersion: '19.0.0' });

    const error = yield* Effect.flip(update('impeccable'));

    expect(error, 'A mismatched tagged manifest should identify the release file').toMatchObject({
      _tag: 'UpdateError', reason: { _tag: 'InvalidReleaseMetadata', packageName: 'impeccable', file: 'vendor/impeccable/package.json' },
    });
    expect(log, 'The mismatched tag should not be checked out or built').toEqual([
      initialize('impeccable'), upstream('impeccable'), show('impeccable'), fetchTag('impeccable', 'skill-v'), show('impeccable'),
    ]);
    expect(yield* read('apm.yml'), 'The marketplace pin should remain unchanged').toBe(marketplace);
    expect(yield* read(manifest('impeccable')), 'The package pin should remain unchanged').toBe(packagePin('impeccable'));
  }).pipe(withPlatform, withConsole));

  it.effect.each([
    { candidate: 'a mixed-license workspace', header: '[workspace]\nmembers = [".", "engine"]\n', license: 'Apache-2.0', workspace: true },
    { candidate: 'under BUSL-1.1', header: '', license: 'BUSL-1.1', workspace: false },
    { candidate: 'missing a license', header: '', license: undefined, workspace: false },
  ])('should preserve pins with UnsupportedRtkLicense when the candidate is $candidate', ({ header, license, workspace }) => Effect.gen(function* () {
    const file = 'Cargo.toml';
    const licenseField = license === undefined ? '' : `license = "${license}"\n`;
    const cargo = `${header}[package]\nversion = "6.0.0"\n${licenseField}`;
    const { read, update, log } = yield* fixture({ initialized: true, output: { [show('rtk', file)]: cargo } });

    const error = yield* Effect.flip(update('rtk'));

    expect(error, 'The candidate should require manual license review').toMatchObject({
      _tag: 'UpdateError', reason: { _tag: 'UnsupportedRtkLicense', file: `vendor/rtk/${file}`, license, workspace },
    });
    expect(log, 'The candidate should not be checked out or built').toEqual([upstream('rtk'), show('rtk', file)]);
    expect(yield* read('apm.yml'), 'The marketplace pin should remain unchanged').toBe(marketplace);
    expect(yield* read(manifest('rtk')), 'The package pin should remain unchanged').toBe(packagePin('rtk'));
  }).pipe(withPlatform, withConsole));

  it.effect('should update only the selected pins when the package manifest is JSON', () => Effect.gen(function* () {
    const { read, update, log } = yield* fixture();

    yield* update('impeccable');

    expect(log, 'Only the selected package should update before the shared checks').toEqual(impeccableSteps);
    const marketplaceAfter = yield* read('apm.yml');
    expect(marketplaceAfter, 'Only the selected marketplace pin should change').toBe(
      Str.replace(entry('impeccable'), entry('impeccable', versions.impeccable))(marketplace),
    );
    for (const name of names) {
      const version = name === 'impeccable' ? versions.impeccable : '1.0.0';
      const packageAfter = yield* read(manifest(name));
      expect(packageAfter, `${name} should retain every byte outside the selected version`).toBe(packagePin(name, version));
    }
  }).pipe(withPlatform, withConsole));

  it.effect.each([{ args: [], selection: 'omitted' }, { args: ['all'], selection: 'explicitly all' }])(
    'should rebuild all packages and run shared checks when the selection is $selection',
    ({ args }) => Effect.gen(function* () {
      const { read, update, log } = yield* fixture();
      const expectedMarketplace = Arr.reduce(names, marketplace, (text, name) => Str.replace(entry(name), entry(name, versions[name]))(text));

      yield* update(...args);

      expect(log, 'Every package should update in order before the shared checks').toEqual(allSteps);
      const marketplaceAfter = yield* read('apm.yml');
      expect(marketplaceAfter, 'Marketplace pins should use all five release sources').toBe(expectedMarketplace);
      for (const name of names) {
        const packageAfter = yield* read(manifest(name));
        expect(packageAfter, `${name} manifest should use its release source`).toBe(packagePin(name, versions[name]));
      }
    }).pipe(withPlatform, withConsole),
  );

  it.effect.each([
    { args: ['unknown'], tag: 'InvalidValue' },
    { args: ['impeccable', 'rtk'], tag: 'UnexpectedArgument' },
  ])('should reject the selection before any updates when arguments are $args', ({ args, tag }) => Effect.gen(function* () {
    const { read, update, log } = yield* fixture();

    const error = yield* Effect.flip(update(...args));

    expect(error, 'Parser should reject the invalid selection').toMatchObject({
      _tag: 'ShowHelp',
      errors: expect.arrayContaining([expect.objectContaining({ _tag: tag })]),
    });
    expect(log, 'Invalid selection should run no subprocesses').toEqual([]);
    const marketplaceAfter = yield* read('apm.yml');
    expect(marketplaceAfter, 'Invalid selection should leave marketplace pins unchanged').toBe(marketplace);
    for (const name of names) {
      const packageAfter = yield* read(manifest(name));
      expect(packageAfter, `Invalid selection should leave ${name} unchanged`).toBe(packagePin(name));
    }
  }).pipe(withPlatform, withConsole));

  it.effect('should complete the update when just audit fails', () => Effect.gen(function* () {
    const { read, update, log } = yield* fixture({ fail: 'just audit' });

    yield* update('impeccable');

    expect(log, 'Every step including the audit should run').toEqual(impeccableSteps);
    const marketplaceAfter = yield* read('apm.yml');
    expect(marketplaceAfter, 'The updated pin should be kept despite the audit failure').toBe(
      Str.replace(entry('impeccable'), entry('impeccable', versions.impeccable))(marketplace),
    );
  }).pipe(withPlatform, withConsole));

  it.effect.each(Arr.map(Arr.dedupe(Arr.dropRight(impeccableSteps, 1)), fail => ({ fail, steps: impeccableSteps.slice(0, impeccableSteps.indexOf(fail) + 1) })))(
    'should stop with SubprocessExited error when $fail fails',
    ({ fail, steps }) => Effect.gen(function* () {
      const { update, log } = yield* fixture({ fail });

      const error = yield* Effect.flip(update('impeccable'));

      const [command, ...args] = Str.split(fail, ' ');
      expect(error, 'Failure should identify the subprocess and its exit status').toMatchObject({
        _tag: 'SubprocessExited', command, args, status: 42,
      });
      expect(log, 'No steps should run after the failure').toEqual(steps);
    }).pipe(withPlatform, withConsole),
  );

  it.effect('should stop with SubprocessExited error before rebuilding when npm fails', () => Effect.gen(function* () {
    const { update, log } = yield* fixture({ fail: npm });

    const error = yield* Effect.flip(update('fallow'));

    expect(error, 'Failure should identify the npm invocation and its exit status').toMatchObject({
      _tag: 'SubprocessExited', command: 'npm', args: ['view', 'fallow', 'version'], status: 42,
    });
    expect(log, 'Only the npm lookup should run').toEqual([npm]);
  }).pipe(withPlatform, withConsole));

  it.effect('should stop with SubprocessExited error before later packages when the first build fails', () => Effect.gen(function* () {
    const fail = 'fixture-build caveman';
    const { update, log } = yield* fixture({ fail });

    const error = yield* Effect.flip(update('all'));

    expect(error, 'Failure should identify the first build and its exit status').toMatchObject({
      _tag: 'SubprocessExited', command: 'fixture-build', args: ['caveman'], status: 42,
    });
    expect(log, 'Only the first package should run before the failure').toEqual(cavemanSteps);
  }).pipe(withPlatform, withConsole));

  it.effect('should return InvalidReleaseMetadata when the upstream version field is missing', () => Effect.gen(function* () {
    const { update, log } = yield* fixture({ output: { [show('impeccable')]: '{}' } });
    const file = 'vendor/impeccable/package.json';

    const error = yield* Effect.flip(update('impeccable'));

    expect(error, 'the domain failure identifies the upstream release file').toMatchObject({
      _tag: 'UpdateError',
      reason: { _tag: 'InvalidReleaseMetadata', packageName: 'impeccable', file },
    });
    expect(log, 'invalid metadata prevents the build and later checks').toEqual([initialize('impeccable'), upstream('impeccable'), show('impeccable')]);
  }).pipe(withPlatform, withConsole));

  it.effect('should preserve pins with UnstableReleaseVersion error when npm returns a prerelease version', () => Effect.gen(function* () {
    const { read, update, log } = yield* fixture({ latest: '6.0.0-beta.1' });

    const error = yield* Effect.flip(update('fallow'));

    expect(error, 'Prerelease should produce a stable-version validation error').toMatchObject({
      _tag: 'UpdateError',
      reason: { _tag: 'UnstableReleaseVersion', packageName: 'fallow', version: '6.0.0-beta.1' },
    });
    expect(log, 'Only the npm lookup should run').toEqual([npm]);
    const marketplaceAfter = yield* read('apm.yml');
    expect(marketplaceAfter, 'Prerelease should leave the marketplace pin unchanged').toBe(marketplace);
    const packageAfter = yield* read(manifest('fallow'));
    expect(packageAfter, 'Prerelease should leave the package pin unchanged').toBe(packagePin('fallow'));
  }).pipe(withPlatform, withConsole));

  it.effect('should preserve formatting and unrelated entries when updating a quoted pin and an unrelated entry has no version', () => Effect.gen(function* () {
    const { read, write, update } = yield* fixture();
    const rootText = marketplace + '    - name: unrelated # intentionally unpinned\n      source: packages/unrelated\n';
    const manifestText = '{name: fallow, version: "1.0.0"} # pinned release\n';
    yield* write('apm.yml', rootText);
    yield* write(manifest('fallow'), manifestText);

    yield* update('fallow');

    const marketplaceAfter = yield* read('apm.yml');
    expect(marketplaceAfter, 'Marketplace should retain all bytes outside the selected version').toBe(
      Str.replace(entry('fallow'), entry('fallow', versions.fallow))(rootText),
    );
    const packageAfter = yield* read(manifest('fallow'));
    expect(packageAfter, 'Package should retain its flow mapping, quotes, and comment').toBe(Str.replace('1.0.0', versions.fallow)(manifestText));
  }).pipe(withPlatform, withConsole));

  it.effect('should preserve unrelated recursive YAML when updating a pin', () => Effect.gen(function* () {
    const { read, write, update } = yield* fixture();
    const rootText = marketplace + 'metadata: &metadata\n  self: *metadata\n';
    yield* write('apm.yml', rootText);

    yield* update('fallow');

    const marketplaceAfter = yield* read('apm.yml');
    expect(marketplaceAfter, 'The recursive YAML should retain every byte outside the selected version').toBe(
      Str.replace(entry('fallow'), entry('fallow', versions.fallow))(rootText),
    );
  }).pipe(withPlatform, withConsole));

  it.effect.each([
    {
      reason: 'the marketplace pin is missing',
      rootText: Str.replace(entry('fallow'), '    - name: fallow\n')(marketplace),
      expected: {
        _tag: 'ManifestSchemaMismatch',
        target: 'marketplace-entry',
        cause: { issue: { issues: [{ path: ['version'], issue: { _tag: 'MissingKey' } }] } },
      },
    },
    {
      reason: 'the marketplace pin is a number',
      rootText: Str.replace(entry('fallow'), entry('fallow', '123'))(marketplace),
      expected: {
        _tag: 'ManifestSchemaMismatch',
        target: 'marketplace-entry',
        cause: { issue: { issues: [{ path: ['version'], issue: { _tag: 'InvalidType' } }] } },
      },
    },
    {
      reason: 'the package name does not match',
      manifestText: 'name: not-fallow\nversion: 1.0.0\n',
      expected: { _tag: 'ManifestNameMismatch', packageName: 'fallow', manifestName: 'not-fallow' },
    },
    {
      reason: 'the marketplace entry is absent',
      rootText: Str.replace(entry('fallow'), '')(marketplace),
      expected: { _tag: 'MarketplaceEntryCountMismatch', packageName: 'fallow', count: 0 },
    },
    {
      reason: 'the marketplace entry appears twice',
      rootText: marketplace + entry('fallow'),
      expected: { _tag: 'MarketplaceEntryCountMismatch', packageName: 'fallow', count: 2 },
    },
    {
      reason: 'the package pin is a block scalar',
      manifestText: 'name: fallow\nversion: |-\n  1.0.0\n',
      expected: { _tag: 'UnsupportedVersionScalar', target: 'package' },
    },
    {
      reason: 'another value aliases the marketplace pin',
      rootText: Str.replace(entry('fallow'), entry('fallow', '&pin 1.0.0'))(marketplace) + 'metadata: *pin\n',
      expected: { _tag: 'VersionRewriteChangedOtherValues', packageName: 'fallow', target: 'marketplace' },
    },
    {
      reason: 'a YAML alias is unresolved',
      manifestText: packagePin('fallow') + 'metadata: *missing\n',
      expected: { _tag: 'ManifestYamlReadFailed', target: 'package', operation: 'resolve', cause: expect.any(ReferenceError) },
    },
    {
      reason: 'the package pin appears twice',
      manifestText: packagePin('fallow') + 'version: 1.0.0\n',
      expected: { _tag: 'ManifestYamlReadFailed', target: 'package', operation: 'parse', cause: { code: 'DUPLICATE_KEY' } },
    },
  ])('should preserve both pins with $expected._tag error when $reason', ({ rootText = marketplace, manifestText = packagePin('fallow'), expected }) => Effect.gen(function* () {
    const { read, write, update, log } = yield* fixture();
    yield* write('apm.yml', rootText);
    yield* write(manifest('fallow'), manifestText);

    const error = yield* Effect.flip(update('fallow'));

    expect(error, 'Invalid pin data should identify the failed guard and both manifest paths').toMatchObject({
      _tag: 'UpdateError',
      reason: { ...expected, manifestPath: manifest('fallow'), marketplacePath: 'apm.yml' },
    });
    expect(log, 'Invalid pin data should stop the update after the npm lookup').toEqual([npm]);
    const marketplaceAfter = yield* read('apm.yml');
    expect(marketplaceAfter, 'Invalid pin data should leave the marketplace unchanged').toBe(rootText);
    const packageAfter = yield* read(manifest('fallow'));
    expect(packageAfter, 'Invalid pin data should leave the package manifest unchanged').toBe(manifestText);
  }).pipe(withPlatform, withConsole));
});
