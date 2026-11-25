import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test as base } from 'vitest';

const hooks = fileURLToPath(new URL('../.apm/hooks/', import.meta.url));
const bundle = join(hooks, 'fsharplint_check.cjs');
const realPath = process.env.PATH;

const dotnetStub = `#!/usr/bin/env bash
echo "$PWD $*" >> "$STUB_LOG"
if [ "$1 $2" = "tool restore" ]; then
  code="\${STUB_RESTORE_EXIT:-0}"
  [ "$code" = 0 ] && : > "$STUB_LOG.restored"
  exit "$code"
fi
if [ "\${STUB_UNRESTORED:-}" = always ] || { [ -n "\${STUB_UNRESTORED:-}" ] && [ ! -f "$STUB_LOG.restored" ]; }; then
  echo 'Run "dotnet tool restore" to make the "dotnet-fsharplint" command available.' >&2
  exit 1
fi
printf '%s' "\${STUB_LINT_OUT:-}"
exit "\${STUB_LINT_EXIT:-0}"
`;

function fixture(root: string) {
  const bin = join(root, 'bin');
  const log = join(root, 'dotnet.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'dotnet'), dotnetStub, { mode: 0o755 });
  writeFileSync(log, '');

  return {
    root,
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    run(payload: object, env: NodeJS.ProcessEnv = {}, args: string[] = []) {
      return execFileSync(process.execPath, [bundle, ...args], {
        cwd: root,
        encoding: 'utf8',
        input: JSON.stringify(payload),
        env: {
          ...process.env,
          PATH: [bin, realPath].filter(Boolean).join(delimiter),
          STUB_LOG: log,
          STUB_UNRESTORED: '',
          STUB_RESTORE_EXIT: '0',
          STUB_LINT_EXIT: '0',
          STUB_LINT_OUT: '',
          ...env,
        },
        timeout: 55_000,
      });
    },
  };
}

const test = base.extend<{ project: ReturnType<typeof fixture> }>({
  project: async ({}, use) => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'fsharplint-hook-'));

    try {
      await use(fixture(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
});

function manifest(root: string, file = '.config/dotnet-tools.json', tool = 'dotnet-fsharplint') {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    version: 1,
    isRoot: true,
    tools: { [tool]: { version: '0.27.0', commands: ['dotnet-fsharplint'] } },
  }));
}

function finding(file: string, line: number, rule: string, message: string) {
  return `${file}(${line},1,${line},10):FSharpLint warning ${rule}: ${message}`;
}

function lintOutput(output: string) {
  return { STUB_LINT_OUT: output, STUB_LINT_EXIT: '255' };
}

function claudeWrite(path: string) {
  return { tool_name: 'Write', tool_input: { file_path: path, content: 'x' } };
}

function claudeEdit(path: string) {
  return { tool_name: 'Edit', tool_input: { file_path: path } };
}

function lintCall(root: string, file: string) {
  return `${root} fsharplint --format msbuild lint ${file}`;
}

describe('FSharpLint hook: silent gates', () => {
  test('should skip linting when the edited file is not F#', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'a.cs');

    const out = project.run(claudeWrite(file), lintOutput(finding(file, 1, 'FL0001', 'm')));

    expect(out, 'A non-F# edit must produce no output').toBe('');
    expect(project.calls(), 'A non-F# edit must not spawn dotnet').toEqual([]);
  });

  test('should skip linting when the edited file is an F# signature', ({ project }) => {
    manifest(project.root);

    const out = project.run(claudeWrite(join(project.root, 'A.fsi')));

    expect(out, 'A .fsi edit must produce no output').toBe('');
    expect(project.calls(), 'A .fsi edit must not spawn dotnet').toEqual([]);
  });

  test('should skip linting when the tool does not edit', ({ project }) => {
    manifest(project.root);
    const payload = { tool_name: 'Read', tool_input: { file_path: join(project.root, 'A.fs') } };

    const out = project.run(payload);

    expect(out, 'A Read must produce no output').toBe('');
    expect(project.calls(), 'A Read must not spawn dotnet').toEqual([]);
  });

  test('should skip linting when the payload has no path', ({ project }) => {
    const payload = { tool_name: 'Write', tool_input: { content: 'x' } };

    const out = project.run(payload);

    expect(out, 'A payload without a path must produce no output').toBe('');
    expect(project.calls(), 'A payload without a path must not spawn dotnet').toEqual([]);
  });

  test('should skip linting when there is no tool manifest', ({ project }) => {
    const src = join(project.root, 'src');
    mkdirSync(src);

    const out = project.run(claudeWrite(join(src, 'A.fs')));

    expect(out, 'No manifest must mean no output').toBe('');
    expect(project.calls(), 'No manifest must mean dotnet is not spawned').toEqual([]);
  });

  test('should skip linting when the manifest lacks FSharpLint', ({ project }) => {
    manifest(project.root, '.config/dotnet-tools.json', 'fantomas');

    const out = project.run(claudeWrite(join(project.root, 'A.fs')));

    expect(out, 'A manifest without FSharpLint must produce no output').toBe('');
    expect(project.calls(), 'A manifest without FSharpLint must not spawn dotnet').toEqual([]);
  });

  test('should skip linting when the manifest is invalid JSON', ({ project }) => {
    const config = join(project.root, '.config');
    mkdirSync(config);
    writeFileSync(join(config, 'dotnet-tools.json'), '{not json');

    const out = project.run(claudeWrite(join(project.root, 'A.fs')));

    expect(out, 'An invalid manifest must produce no output').toBe('');
    expect(project.calls(), 'An invalid manifest must not spawn dotnet').toEqual([]);
  });
});

type HookResponse = {
  decision?: string;
  reason?: string;
  hookSpecificOutput?: { additionalContext: string };
  additionalContext?: string;
  modifiedResult?: { textResultForLlm: string };
};

function response(out: string): HookResponse {
  return JSON.parse(out);
}

describe('FSharpLint hook: manifest lookup', () => {
  test('should lint from the manifest root when an ancestor has a .config manifest', ({ project }) => {
    const repo = join(project.root, 'repo');
    const src = join(repo, 'src', 'Lib');
    const file = join(src, 'A.fs');
    manifest(repo);
    mkdirSync(src, { recursive: true });

    project.run(claudeWrite(file));

    expect(project.calls(), 'Lint must run once from the manifest root on the absolute path')
      .toEqual([lintCall(repo, file)]);
  });

  test('should lint from the manifest root when an ancestor has a bare manifest', ({ project }) => {
    const repo = join(project.root, 'repo');
    const src = join(repo, 'src');
    const file = join(src, 'A.fsx');
    manifest(repo, 'dotnet-tools.json');
    mkdirSync(src);

    project.run(claudeWrite(file));

    expect(project.calls(), 'A bare dotnet-tools.json must count as a manifest and set cwd')
      .toEqual([lintCall(repo, file)]);
  });

  test('should follow the nearest manifest when only an outer manifest lists FSharpLint', ({ project }) => {
    const outer = join(project.root, 'outer');
    const inner = join(outer, 'inner');
    const src = join(inner, 'src');
    manifest(outer);
    manifest(inner, '.config/dotnet-tools.json', 'fantomas');
    mkdirSync(src);

    const out = project.run(claudeWrite(join(src, 'A.fs')));

    expect(out, 'The nearest manifest controls whether the hook reports findings').toBe('');
    expect(project.calls(), 'The nearest manifest lacks FSharpLint, so dotnet must not run').toEqual([]);
  });

  test('should lint the absolute path when the edit uses a relative path', ({ project }) => {
    manifest(project.root);
    mkdirSync(join(project.root, 'src'));

    project.run(claudeEdit('src/A.fs'));

    expect(project.calls(), 'A relative path must be resolved against the hook working directory')
      .toEqual([lintCall(project.root, join(project.root, 'src', 'A.fs'))]);
  });
});

describe('FSharpLint hook: findings', () => {
  test('should emit a block decision with sorted findings when lint reports warnings', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const env = lintOutput([
      'Running FSharpLint',
      finding(file, 7, 'FL0065', 'late one'),
      finding(file, 3, 'FL0001', 'early one'),
      'Finished: 2 warnings',
    ].join('\n'));

    const { decision, reason, hookSpecificOutput } = response(project.run(claudeWrite(file), env));

    expect(decision, 'Findings must block').toBe('block');
    expect(reason, 'The header must name the file and count').toContain(`2 finding(s) in ${file}`);
    expect(reason, 'Findings must be listed as path:line RuleId message, sorted by line')
      .toContain(`${file}:3 FL0001 early one\n${file}:7 FL0065 late one`);
    expect(reason, 'Non-finding lines must not leak into the report').not.toContain('Finished');
    expect(hookSpecificOutput?.additionalContext, 'Claude Code additionalContext must carry the same text')
      .toBe(reason);
  });

  test('should report the path as given when the edit uses a relative path', ({ project }) => {
    manifest(project.root);
    const src = join(project.root, 'src');
    mkdirSync(src);
    const env = lintOutput(finding(join(src, 'A.fs'), 2, 'FL0001', 'm'));

    const { reason } = response(project.run(claudeEdit('src/A.fs'), env));

    expect(reason, 'Finding lines must use the path the agent used').toContain('src/A.fs:2 FL0001 m');
  });

  test('should cap the list and report the remainder when there are more than 30 findings', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const lines = Array.from({ length: 35 }, (_, i) => finding(file, i + 1, 'FL0001', 'm'));

    const { reason } = response(project.run(claudeWrite(file), lintOutput(lines.join('\n'))));

    expect(reason, 'The header must count every finding').toContain('35 finding(s)');
    expect(reason, 'The 30th finding must be listed').toContain('A.fs:30 FL0001');
    expect(reason, 'The 31st finding must not be listed').not.toContain('A.fs:31 FL0001');
    expect(reason, 'The remainder must be reported').toContain('+5 more');
  });

  test('should emit nothing when lint output has zero findings', ({ project }) => {
    manifest(project.root);
    const env = { STUB_LINT_OUT: 'Running FSharpLint\nFinished: 0 warnings' };

    const out = project.run(claudeWrite(join(project.root, 'A.fs')), env);

    expect(out, 'A clean lint must produce no output').toBe('');
  });

  test('should warn the user without blocking when dotnet fails with unparseable output', ({ project }) => {
    manifest(project.root);
    const env = { STUB_LINT_EXIT: '1', STUB_LINT_OUT: 'Unhandled exception. System.Exception: boom' };

    const out = JSON.parse(project.run(claudeWrite(join(project.root, 'A.fs')), env));

    expect(out, 'A tool failure must only warn the user').toEqual({
      systemMessage: 'FSharpLint hook: `dotnet fsharplint` exited 1 on ' + join(project.root, 'A.fs') +
        ' without findings: Unhandled exception. System.Exception: boom',
    });
  });

  test('should warn the user without blocking when dotnet is absent', ({ project }) => {
    manifest(project.root);
    const empty = join(project.root, 'empty');
    mkdirSync(empty);

    const out = JSON.parse(project.run(claudeWrite(join(project.root, 'A.fs')), { PATH: empty }));

    expect(out, 'A missing dotnet must only warn the user').toEqual({
      systemMessage: 'FSharpLint hook: `dotnet` is not on PATH; edited F# files were not linted.',
    });
  });
});

describe('FSharpLint hook: tool restore', () => {
  test('should restore and retry when the tool is not restored', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const env = { STUB_UNRESTORED: '1', ...lintOutput(finding(file, 4, 'FL0001', 'm')) };

    const { reason } = response(project.run(claudeWrite(file), env));

    expect(project.calls(), 'Lint, restore, and lint must run in that order from the manifest root')
      .toEqual([lintCall(project.root, file), `${project.root} tool restore`, lintCall(project.root, file)]);
    expect(reason, 'Findings from the retry must be emitted').toContain('A.fs:4 FL0001 m');
  });

  test('should warn the user without retrying when restore fails', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const env = { STUB_UNRESTORED: '1', STUB_RESTORE_EXIT: '1' };

    const out = JSON.parse(project.run(claudeWrite(file), env));

    expect(out, 'A failed restore must only warn the user').toEqual({
      systemMessage: `FSharpLint hook: \`dotnet tool restore\` failed in ${project.root} (exit 1); F# files there were not linted.`,
    });
    expect(project.calls(), 'The first lint and failed restore must be the only calls')
      .toEqual([lintCall(project.root, file), `${project.root} tool restore`]);
  });

  test('should restore at most once when the retry still reports an unrestored tool', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');

    const out = JSON.parse(project.run(claudeWrite(file), { STUB_UNRESTORED: 'always' }));

    expect(out, 'A still-unrestored retry must only warn the user').toEqual({ systemMessage: expect.stringContaining('dotnet tool restore') });
    expect(project.calls().filter((call) => call.endsWith(' tool restore')), 'Restore must run at most once')
      .toEqual([`${project.root} tool restore`]);
  });
});

describe('FSharpLint hook: Copilot payloads', () => {
  test('should append findings when create sends JSON-encoded tool arguments', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const payload = {
      toolName: 'create',
      toolArgs: JSON.stringify({ path: file, file_text: 'x' }),
      toolResult: { resultType: 'success', textResultForLlm: 'Created file.' },
    };

    const { additionalContext, modifiedResult } = response(project.run(payload, lintOutput(finding(file, 2, 'FL0001', 'm'))));

    expect(additionalContext, 'String-encoded toolArgs must be decoded and linted').toContain('A.fs:2 FL0001 m');
    expect(modifiedResult?.textResultForLlm, 'The original tool result must be kept').toContain('Created file.');
    expect(modifiedResult?.textResultForLlm, 'Findings must be appended to the tool result').toContain('A.fs:2 FL0001 m');
  });

  test('should lint every added or updated F# file when apply_patch changes several files', ({ project }) => {
    manifest(project.root);
    const updated = join(project.root, 'A.fs');
    const added = join(project.root, 'B.fsx');
    const payload = {
      toolName: 'apply_patch',
      toolArgs: `*** Begin Patch
*** Update File: ${updated}
@@
-let a = 1
+let a = 2
*** Add File: ${added}
+let b = 1
*** Update File: ${join(project.root, 'C.cs')}
+int c;
*** Delete File: ${join(project.root, 'D.fs')}
*** End Patch`,
      toolResult: { resultType: 'success', textResultForLlm: 'Done.' },
    };

    const { additionalContext, modifiedResult, decision } = response(project.run(payload, lintOutput(finding('x', 2, 'FL0001', 'm'))));

    expect(project.calls(), 'Only the updated and added F# files must be linted, once each')
      .toEqual([lintCall(project.root, updated), lintCall(project.root, added)]);
    expect(additionalContext, 'The report must name the updated file').toContain(`in ${updated}`);
    expect(additionalContext, 'The report must name the added file').toContain(`in ${added}`);
    expect(modifiedResult?.textResultForLlm, 'The original tool result must be kept').toContain('Done.');
    expect(decision ?? null, 'Copilot has no post-tool block decision').toBeNull();
  });

  test('should restore only once when apply_patch touches several F# files under the same root', ({ project }) => {
    manifest(project.root);
    const payload = {
      toolName: 'apply_patch',
      toolArgs: `*** Begin Patch
*** Add File: ${join(project.root, 'A.fs')}
+let a = 1
*** Add File: ${join(project.root, 'B.fs')}
+let b = 1
*** End Patch`,
    };

    project.run(payload, { STUB_UNRESTORED: 'always' });

    expect(project.calls().filter((call) => call.endsWith(' tool restore')), 'Restore must run at most once per manifest root')
      .toEqual([`${project.root} tool restore`]);
  });
});

describe('FSharpLint hook: scoped handlers', () => {
  test('should block on findings when a scoped handler receives a Claude edit', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const env = lintOutput(finding(file, 2, 'FL0001', 'm'));

    const { decision } = response(project.run(claudeWrite(file), env, ['--scoped']));

    expect(decision, 'A scoped handler must lint a Claude Code edit').toBe('block');
  });

  test('should skip linting when a scoped handler receives a Copilot edit', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const env = lintOutput(finding(file, 2, 'FL0001', 'm'));
    const payload = { toolName: 'edit', toolArgs: JSON.stringify({ path: file }) };

    const out = project.run(payload, env, ['--scoped']);

    expect(out, 'A scoped handler must not duplicate the Copilot report').toBe('');
    expect(project.calls(), 'A scoped handler must not spawn dotnet for Copilot').toEqual([]);
  });

  test('should skip linting when a scoped handler receives a VS Code create', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const env = lintOutput(finding(file, 2, 'FL0001', 'm'));
    const payload = {
      timestamp: '2026-01-01T00:00:00Z',
      tool_name: 'create_file',
      tool_input: { filePath: file, content: 'x' },
    };

    const out = project.run(payload, env, ['--scoped']);

    expect(out, 'A scoped handler must not duplicate the VS Code report').toBe('');
    expect(project.calls(), 'A scoped handler must not spawn dotnet for VS Code').toEqual([]);
  });

  test('should block on findings when an unscoped handler receives a VS Code edit', ({ project }) => {
    manifest(project.root);
    const file = join(project.root, 'A.fs');
    const env = lintOutput(finding(file, 2, 'FL0001', 'm'));
    const payload = {
      timestamp: '2026-01-01T00:00:00Z',
      tool_name: 'replace_string_in_file',
      tool_input: { filePath: file, oldString: 'a', newString: 'b' },
    };

    const { decision } = response(project.run(payload, env));

    expect(decision, 'An unscoped handler must lint a VS Code edit').toBe('block');
  });

  test('should scope only the Claude handlers when registered for both Claude and Copilot', () => {
    const path = join(hooks, 'fsharplint.json');
    const config: {
      PostToolUse: { matcher: string; hooks: { if?: string; command: string }[] }[];
    } = JSON.parse(readFileSync(path, 'utf8'));

    const claude = config.PostToolUse.filter(({ matcher }) => /^(Edit|Write)$/.test(matcher));
    const copilot = config.PostToolUse.filter(({ matcher }) => matcher.includes('apply_patch'));

    expect(claude.map(({ matcher }) => matcher).sort(), 'Both Claude handlers must be registered')
      .toEqual(['Edit', 'Write']);
    for (const { matcher, hooks } of claude) {
      expect(hooks.length, `Claude ${matcher} must register a command`).toBeGreaterThan(0);
      for (const hook of hooks) {
        expect(hook.if, `Claude ${matcher} must filter to F# files`).toMatch(/^(Edit|Write)\(\*\.fsx?\)$/);
        expect(hook.command, `Claude ${matcher} must pass --scoped`).toMatch(/ --scoped'$/);
      }
    }
    expect(copilot.flatMap(({ hooks }) => hooks.map((hook) => Object.hasOwn(hook, 'if'))),
      'The Copilot handler must be single and unscoped').toEqual([false]);
  });
});

describe('FSharpLint hook: real tool', () => {
  test('should report only enabled rules when a real project provides its own config', { timeout: 70_000 }, ({ project, skip }) => {
    const repo = join(project.root, 'repo');
    const file = join(repo, 'Bad.fs');
    manifest(repo, 'dotnet-tools.json');
    const version = spawnSync('dotnet', ['fsharplint', '--version'], { cwd: repo, timeout: 10_000 });
    if (version.status !== 0) skip('dotnet-fsharplint 0.27.0 is unavailable');

    writeFileSync(join(repo, 'fsharplint.json'), '{"redundantNewKeyword":{"enabled":true}}');
    writeFileSync(file, 'module Bad\n\nlet f a = if a then true else false\n\nlet g () = new System.Object()\n');

    const { reason } = response(project.run(claudeWrite(file), { PATH: realPath }));

    expect(reason, 'An enabled rule must be reported with its line number')
      .toContain('Bad.fs:5 FL0014 Usage of `new` keyword here is redundant.');
    expect(reason, 'A default rule omitted by the project config must not fire').not.toContain('FL0065');
  });
});
