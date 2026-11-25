import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { claudeContext, copilotContext, detectHost, Host, WRITE_TOOLS } from '../../../_shared/hook-io/hook-io.ts';

const [, bundle, target, event, command] = process.argv;
if (!bundle || (target !== 'claude' && target !== 'copilot') || !event || !command) process.exit(1);

const input: unknown = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
if (typeof input !== 'object' || input === null || Array.isArray(input)) process.exit(1);

const payload = input as Record<string, unknown>;
const tool = payload.tool_name ?? payload.toolName;
// VS Code may invoke this adapter even when the descriptor matcher does not match.
if (target === 'copilot' && event === 'PostToolUse' && typeof tool === 'string' && !WRITE_TOOLS.has(tool.toLowerCase())) {
  process.exit(0);
}

const projectCwd = (typeof payload.cwd === 'string' && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const wrapperDir = path.dirname(bundle);
const harnessDir = target === 'claude' ? '.claude' : '.github';
const deployedRoot = path.resolve(wrapperDir, target === 'claude' ? '../..' : '../../..');
const candidates = [
  path.join(deployedRoot, 'skills'),
  path.join(path.dirname(deployedRoot), '.agents/skills'),
];

for (let dir = path.resolve(projectCwd); ; dir = path.dirname(dir)) {
  candidates.push(path.join(dir, harnessDir, 'skills'), path.join(dir, '.agents/skills'));
  if (path.dirname(dir) === dir) break;
}

const customClaudeDir = target === 'claude' && process.env.CLAUDE_CONFIG_DIR;
if (customClaudeDir) {
  const defaultAccount = path.join(os.homedir(), '.claude');
  const defaultSharedSkills = path.join(os.homedir(), '.agents/skills');

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index] === path.join(defaultAccount, 'skills') || candidates[index] === defaultSharedSkills) {
      candidates.splice(index, 1);
    }
  }

  candidates.push(path.resolve(projectCwd, customClaudeDir, 'skills'));
} else {
  candidates.push(path.join(os.homedir(), harnessDir, 'skills'), path.join(os.homedir(), '.agents/skills'));
}

const launcher = candidates
  .map(dir => path.join(dir, 'impeccable/scripts/impeccable'))
  .find(file => fs.existsSync(file));

if (!launcher) {
  console.error('Impeccable launcher missing: install the umbrella impeccable package.');
  process.exit(1);
}

const harness = target === 'claude' ? 'claude' : detectHost(payload) === Host.COPILOT ? 'github' : 'vscode';
if (event === 'SessionStart') {
  const session = payload.session_id;
  if (target === 'claude' && process.env.CLAUDE_ENV_FILE && typeof session === 'string' && /^[A-Za-z0-9_:.-]{1,200}$/.test(session)) {
    const file = process.env.CLAUDE_ENV_FILE;
    const line = `export IMPECCABLE_SESSION_ID='${session}'`;

    try {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const effective = current.split('\n').filter(value => value.startsWith('export IMPECCABLE_SESSION_ID=')).at(-1);

      if (effective !== line) fs.appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
    } catch (error) {
      console.error(`Impeccable session identity unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const additionalContext = `Before design work, read the impeccable skill and initialize its runtime once per session: "${launcher}" context. Keep cwd in the project; follow the skill's launcher-unavailable procedure if initialization fails.`;
  const output = harness === 'github'
    ? copilotContext(null, additionalContext)
    : claudeContext(event, additionalContext);

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

const result = spawnSync('sh', [launcher, command], {
  cwd: projectCwd,
  input: JSON.stringify({ ...payload, hook_event_name: event }),
  env: { ...process.env, IMPECCABLE_HOOK_HARNESS: harness, IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
  encoding: 'utf8',
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);

process.exit(result.status ?? 1);
