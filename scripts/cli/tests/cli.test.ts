import { BunServices } from '@effect/platform-bun'
import { expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const cli = Effect.fn('cli')(function* (args: readonly string[], cwd?: string) {
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const entry = yield* path.fromFileUrl(new URL('../src/cli.ts', import.meta.url))

  const child = yield* spawner.spawn(ChildProcess.make('bun', [entry, ...args], { cwd }))
  const [stdout, stderr, status] = yield* Effect.all(
    [
      child.stdout.pipe(Stream.decodeText, Stream.mkString),
      child.stderr.pipe(Stream.decodeText, Stream.mkString),
      child.exitCode,
    ],
    { concurrency: 'unbounded' },
  )

  return { stdout, stderr, status }
}, Effect.scoped)

it.layer(BunServices.layer)('marketplace CLI', (it) => {
  it.effect('should list maintainer commands when root help is requested', () =>
    Effect.gen(function* () {
      const args = ['--help']

      const result = yield* cli(args)

      expect(result.status, result.stderr).toBe(0)

      for (const command of ['build', 'weigh', 'update']) {
        expect(result.stdout, `help lists ${command}`).toContain(command)
      }
    }),
  )

  it.effect('should reject an unknown builder when a package is supplied', () =>
    Effect.gen(function* () {
      const args = ['build', 'unknown']

      const result = yield* cli(args)

      expect(result.status, 'unknown package exits with failure').toBe(1)
      expect(result.stderr, 'failure identifies the invalid package').toContain('unknown')
    }),
  )

  it.effect('should reject the destination when the output flag is empty', () =>
    Effect.gen(function* () {
      const args = ['build', 'caveman', '--out', '']

      const result = yield* cli(args)

      expect(result.status, 'empty destination exits with failure').toBe(1)
      expect(result.stderr, 'failure identifies the empty destination').toContain('--out cannot be empty')
    }),
  )

  it.effect('should protect repository instructions when a builder targets the root', () =>
    Effect.gen(function* () {
      const args = ['build', 'playwright-cli', '--out', '.']

      const result = yield* cli(args)

      expect(result.status, 'repository-root destination exits with failure').toBe(1)
      expect(result.stderr, 'failure identifies the protected root').toContain('--out must not be the repository root')
    }),
  )

  it.effect('should report a stale authored hook without rewriting it when checking a package', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped()
      const source = path.join(root, 'packages/fsharp/src/hooks')
      const hooks = path.join(root, 'packages/fsharp/.apm/hooks')
      const bundle = path.join(hooks, 'fsharplint_check.cjs')
      yield* fs.makeDirectory(source, { recursive: true })
      yield* fs.makeDirectory(hooks, { recursive: true })
      yield* fs.writeFileString(path.join(root, 'apm.yml'), 'name: fixture\n')
      yield* fs.writeFileString(path.join(source, 'fsharplint_check.ts'), 'console.log("new hook");\n')
      yield* fs.writeFileString(bundle, '// stale\n')

      const result = yield* cli(['build', 'fsharp', '--check'], root)
      const contents = yield* fs.readFileString(bundle)

      expect(result.status, 'stale hook check fails').toBe(1)
      expect(result.stdout + result.stderr, 'error identifies the stale bundle').toContain('Stale hook bundle')
      expect(contents, 'check leaves the existing bundle intact').toBe('// stale\n')
    }),
  )

  it.effect('should leave generated output intact when the Playwright CLI submodule is missing', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'marketplace-cli-' })
      const apm = path.join(root, 'packages/playwright-cli/.apm')
      const marker = path.join(apm, 'existing.md')

      yield* fs.makeDirectory(apm, { recursive: true })
      yield* fs.writeFileString(path.join(root, 'apm.yml'), 'name: fixture\n')
      yield* fs.writeFileString(marker, 'existing skill')

      const result = yield* cli(['build', 'playwright-cli'], root)

      const contents = yield* fs.readFileString(marker)

      expect(result.status, 'missing source exits with failure').toBe(1)
      expect(contents, 'existing output survives').toBe('existing skill')
    }),
  )

  it.effect('should run only Playwright CLI when its subcommand and destination are supplied', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'marketplace-cli-' })
      const source = path.join(root, 'vendor/playwright-cli/skills/playwright-cli')
      const destination = path.join(root, 'package output')
      const stale = path.join(destination, '.apm/obsolete.md')
      const authored = path.join(destination, 'README.md')

      yield* fs.makeDirectory(source, { recursive: true })
      yield* fs.makeDirectory(path.join(root, 'packages'))
      yield* fs.writeFileString(path.join(root, 'apm.yml'), 'name: fixture\n')
      yield* fs.makeDirectory(path.dirname(stale), { recursive: true })
      yield* fs.writeFileString(path.join(source, 'SKILL.md'), 'Playwright skill')
      yield* fs.writeFileString(stale, 'old generated file')
      yield* fs.writeFileString(authored, 'authored readme')

      const result = yield* cli(['build', 'playwright-cli', '--out', destination], root)

      expect(result.status, result.stderr || result.stdout).toBe(0)

      const skill = yield* fs.readFileString(path.join(destination, '.apm/skills/playwright-cli/SKILL.md'))

      expect(skill, 'only the requested builder needs upstream inputs').toBe('Playwright skill')
      expect(yield* fs.exists(stale), 'stale primitives should be removed').toBe(false)
      expect(yield* fs.readFileString(authored), 'authored files should survive').toBe('authored readme')
    }),
  )

  it.effect('should report the builder name when the output path is a file', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped()
      const source = path.join(root, 'vendor/playwright-cli/skills/playwright-cli')
      const destination = path.join(root, 'blocked-output')
      yield* fs.makeDirectory(source, { recursive: true })
      yield* fs.makeDirectory(path.join(root, 'packages'))
      yield* fs.writeFileString(path.join(root, 'apm.yml'), 'name: fixture\n')
      yield* fs.writeFileString(path.join(source, 'SKILL.md'), 'Playwright skill')
      yield* fs.writeFileString(destination, 'not a directory')

      const result = yield* cli(['build', 'playwright-cli', '--out', destination], root)

      expect(result.status, 'a filesystem failure must exit nonzero').toBe(1)
      expect(result.stdout + result.stderr, 'the diagnostic should include the command context').toContain(
        'CommandFailure: playwright-cli:',
      )
    }),
  )

  it.effect('should describe the output flag when Caveman help is requested', () =>
    Effect.gen(function* () {
      const args = ['build', 'caveman', '--help']

      const result = yield* cli(args)

      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout, 'Caveman help exposes --out').toContain('--out')
    }),
  )
})
