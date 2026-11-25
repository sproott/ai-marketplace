import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { block, emit, Host, read, WRITE_TOOLS } from "../../../_shared/hook-io/hook-io.ts";

const EXTENSIONS = new Set([".fs", ".fsx"]);
// All subprocesses share a budget below the host's 60 s timeout.
const BUDGET_MS = 50_000;
const MAX_LISTED = 30;
const FINDING = /^.+\((\d+),\d+,\d+,\d+\):FSharpLint (?:warning|error) (FL\d+): (.*)$/;
const UNRESTORED = "dotnet tool restore";

type Finding = { line: number; detail: string };

function hasFsharplint(manifest: string): boolean {
  try {
    const data: unknown = JSON.parse(readFileSync(manifest, "utf8"));

    return typeof data === "object" && data !== null && "tools" in data &&
      typeof data.tools === "object" && data.tools !== null &&
      Object.hasOwn(data.tools, "dotnet-fsharplint");
  } catch {
    return false;
  }
}

function manifestRoot(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    for (const candidate of [join(dir, ".config", "dotnet-tools.json"), join(dir, "dotnet-tools.json")]) {
      try {
        if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
          return hasFsharplint(candidate) ? dir : undefined;
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOTDIR")) throw error;
      }
    }

    if (dir === dirname(dir)) return;
  }
}

function resolveFile(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // An edit payload can name a missing file; still resolve symlinks in its ancestors.
    const parent = dirname(path);
    return path === parent ? path : join(resolveFile(parent), basename(path));
  }
}

function dotnet(args: string[], cwd: string, deadline: number) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) return;

  const result = spawnSync("dotnet", args, {
    cwd,
    encoding: "utf8",
    timeout: remaining,
    killSignal: "SIGKILL",
    maxBuffer: Infinity,
  });

  return result.error ? undefined : result;
}

function lintOutput(file: string, root: string, deadline: number, restored: Set<string>): string {
  // FSharpLint treats --format as a global option.
  const command = ["fsharplint", "--format", "msbuild", "lint", file];
  let result = dotnet(command, root, deadline);

  if (result?.stderr.includes(UNRESTORED) && !restored.has(root)) {
    restored.add(root);
    const restore = dotnet(["tool", "restore"], root, deadline);
    result = restore?.status === 0 ? dotnet(command, root, deadline) : undefined;
  }

  return result?.stdout ?? "";
}

function findingsIn(output: string): Finding[] {
  const findings: Finding[] = [];

  for (const text of output.split(/\r\n|[\r\n]/)) {
    const match = FINDING.exec(text);
    if (!match) continue;

    const [, line, rule, message] = match;
    findings.push({ line: Number(line), detail: `${rule} ${message}` });
  }

  return findings.sort((a, b) => a.line - b.line || (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0));
}

function report(path: string, findings: Finding[]): string {
  const lines = findings.slice(0, MAX_LISTED).map(({ line, detail }) => `${path}:${line} ${detail}`);

  if (findings.length > MAX_LISTED) lines.push(`… +${findings.length - MAX_LISTED} more`);

  return `FSharpLint: ${findings.length} finding(s) in ${path}. Fix them before moving on.\n\n${lines.join("\n")}`;
}

function main(): void {
  const hook = read("PostToolUse");

  // Other hosts ignore Claude's if: filter and already run the unscoped handler.
  if (process.argv.includes("--scoped", 2) && hook.host !== Host.CLAUDE) return;
  if (!WRITE_TOOLS.has(hook.tool)) return;

  const paths = new Set(hook.changes.map((change) => change.path).filter((path) => EXTENSIONS.has(extname(path).toLowerCase())));
  const deadline = performance.now() + BUDGET_MS;
  const restored = new Set<string>();
  const reports: string[] = [];

  for (const path of paths) {
    const file = resolveFile(resolve(path));
    const root = manifestRoot(dirname(file));
    if (!root) continue;

    const findings = findingsIn(lintOutput(file, root, deadline, restored));
    if (findings.length) reports.push(report(path, findings));
  }

  if (reports.length) emit(block(hook, reports.join("\n\n")));
}

try {
  main();
} catch {
  // A broken toolchain must never block an edit.
}
