#!/usr/bin/env bun
// Usage: bun scripts/build-impeccable-package.ts [--out <packages-directory>]
import fs from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';
import { adaptGuidance } from './impeccable/guidance.ts';

const repoRoot = path.resolve(import.meta.dir, '..');
const vendorRoot = path.join(repoRoot, 'vendor/impeccable');
const outIndex = process.argv.indexOf('--out');
const outputRoot = outIndex < 0 ? path.join(repoRoot, 'packages') : path.resolve(process.argv[outIndex + 1]);
const metadata = JSON.parse(fs.readFileSync(path.join(vendorRoot, 'package.json'), 'utf8'));
await $`bun scripts/build.js --skip-root-sync`.cwd(vendorRoot).quiet();
const description = 'Design skills, native agents, and design-check hooks for Claude Code and GitHub Copilot.';

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copy(src: string, packageDir: string) {
  fs.mkdirSync(path.dirname(packageDir), { recursive: true });
  fs.cpSync(src, packageDir, { recursive: true });
}

function normalize(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      normalize(file);
    } else if (entry.name.endsWith('.md')) {
      const body = fs.readFileSync(file, 'utf8')
        .replaceAll('.claude/skills/impeccable/', '<skill-base-dir>/')
        .replaceAll('.github/skills/impeccable/', '<skill-base-dir>/');
      write(file, body);
    }
  }
}

for (const target of ['', '-claude', '-copilot']) {
  const name = `impeccable${target}`;
  const packageDir = path.join(outputRoot, 'impeccable', target.slice(1));
  fs.rmSync(path.join(packageDir, '.apm'), { recursive: true, force: true });
  const dependencies = target ? [] : [
    { path: './claude', alias: 'impeccable-claude' },
    { path: './copilot', alias: 'impeccable-copilot' },
  ];

  write(path.join(packageDir, 'apm.yml'), JSON.stringify({
    name,
    version: metadata.version,
    description,
    author: metadata.author,
    license: metadata.license,
    type: 'hybrid',
    targets: target ? [target.slice(1)] : ['claude', 'copilot'],
    dependencies: { apm: dependencies, mcp: [] },
  }, null, 2) + '\n');

  for (const file of ['LICENSE', 'NOTICE.md']) {
    copy(path.join(vendorRoot, file), path.join(packageDir, file));
  }

  if (!target) {
    copy(path.join(vendorRoot, 'dist/claude-code/.claude/skills/impeccable'), path.join(packageDir, '.apm/skills/impeccable'));
    normalize(path.join(packageDir, '.apm/skills/impeccable'));
    const skillDir = path.join(packageDir, '.apm/skills/impeccable');

    // APM owns updates; suppress the engine's native-installer recommendations.
    for (const [file, marker, setting] of [
      ['impeccable', '#!/bin/sh\n', 'export IMPECCABLE_NO_UPDATE_CHECK=1\n'],
      ['impeccable.cmd', 'setlocal\r\n', 'set "IMPECCABLE_NO_UPDATE_CHECK=1"\r\n'],
    ]) {
      const launcherPath = path.join(skillDir, 'scripts', file);
      const launcher = fs.readFileSync(launcherPath, 'utf8');
      if (!launcher.includes(marker)) throw new Error(`Upstream launcher anchor changed: ${file}`);
      write(launcherPath, launcher.replace(marker, marker + setting));
    }

    for (const file of ['SKILL.md', 'reference/doctor.md', 'reference/hooks.md', 'reference/live.md', 'reference/generate.md']) {
      const filePath = path.join(skillDir, file);
      write(filePath, adaptGuidance(file, fs.readFileSync(filePath, 'utf8')));
    }
    continue;
  }

  const nativeDir = target === '-claude' ? 'dist/claude-code/.claude' : 'dist/github/.github';
  for (const file of fs.readdirSync(path.join(vendorRoot, nativeDir, 'agents'))) {
    const name = file.replace(/(?:\.agent)?\.md$/, '.agent.md');
    copy(path.join(vendorRoot, nativeDir, 'agents', file), path.join(packageDir, '.apm/agents', name));
  }
  normalize(path.join(packageDir, '.apm/agents'));
  copy(path.join(repoRoot, 'scripts/impeccable/hook.cjs'), path.join(packageDir, '.apm/hooks/hook.cjs'));
  copy(path.join(repoRoot, 'scripts/impeccable/launcher.sh'), path.join(packageDir, '.apm/hooks/skills/impeccable/scripts/impeccable'));
  const config = JSON.parse(fs.readFileSync(path.join(vendorRoot, nativeDir, target === '-claude' ? 'settings.json' : 'hooks/impeccable.json'), 'utf8'));
  if (target === '-copilot') {
    const claudeConfig = JSON.parse(fs.readFileSync(path.join(vendorRoot, 'dist/claude-code/.claude/settings.json'), 'utf8'));
    config.hooks.SessionStart = claudeConfig.hooks.SessionStart;
  }

  const hooks: Record<string, unknown> = {};
  for (const [key, groups] of Object.entries(config.hooks) as [string, any[]][]) {
    const event = key[0].toUpperCase() + key.slice(1);
    hooks[event] = groups.map(group => ({
      ...(target === '-claude' && group.matcher ? { matcher: group.matcher } : {}),
      hooks: (group.hooks || [group]).map((handler: any) => {
        const command = (handler.command ?? handler.bash).match(/" ([a-z][a-z-]*)$/)?.[1];
        if (!command) {
          throw new Error(`Unrecognized upstream launcher command for ${target} ${event}`);
        }

        return {
          type: handler.type,
          command: `sh ./skills/impeccable/scripts/impeccable ${command} ${target.slice(1)} ${event}`,
          timeout: handler.timeout ?? handler.timeoutSec,
          ...(handler.statusMessage ? { statusMessage: handler.statusMessage } : {}),
        };
      }),
    }));
  }
  write(path.join(packageDir, '.apm/hooks/impeccable.json'), JSON.stringify(hooks, null, 2) + '\n');
}
