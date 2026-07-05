---
name: apm-install-deps
description: Installs and manages APM dependencies — apm install flags, dependency reference forms (short owner/repo, git-host, MCP), the apm.lock.yaml lockfile, apm update/outdated/list, and auth for private packages. Use when adding, updating, pinning, or removing an APM or MCP dependency, or when a private install fails on auth.
---

# Installing & Managing APM Dependencies

## Overview

Dependencies are declared in `apm.yml` under `dependencies.apm` / `dependencies.mcp` and
resolved by `apm install`, which pins them in `apm.lock.yaml` for reproducible, hash-checked
installs. This skill covers the install/update commands, reference forms, the lockfile, and
auth.

## When to Use

- Adding, updating, pinning, or removing an APM package or MCP server
- CI installs (frozen / lockfile-only)
- Diagnosing a private-package auth failure

**When NOT to use:** publishing a marketplace (`apm-author-marketplace`), authoring
primitives (`apm-author-primitive`), or the audit/security model (`apm-audit-security`).

## `apm install`

```bash
apm install                                             # install everything in apm.yml (uses lockfile)
apm install anthropics/skills/frontend-design           # add a new APM dependency
apm install ./path/to/bundle                            # install a local bundle
apm install --mcp io.github.github/github-mcp-server     # add an MCP server dependency
apm install --frozen                                    # lockfile-only, CI (like npm ci)
apm install --dry-run                                   # resolve + policy gate only; print the plan
apm install --update                                    # re-resolve refs to latest matching pins
apm install --force                                     # deploy despite critical security findings
apm install --no-policy                                 # skip org policy gate for this one run
apm install --trust-transitive-mcp                      # allow transitive MCP without re-declaration
apm install -t claude,copilot                           # scope which harnesses receive files
apm install -g                                          # deploy to user (global) scope, not project
apm install --dev                                       # include dev-only primitives locally
```

### Order of operations (what `install` does)

1. **Resolve** — walk dependencies + transitive deps, pick versions.
2. **Policy gate** — check against `apm-policy.yml` (skip with `--no-policy`).
3. **Scan** — inspect every primitive for hidden Unicode; critical findings block unless
   `--force`.
4. **Integrate** — write primitives into harness dirs, merge MCP configs.
5. **Lockfile** — write `apm.lock.yaml` with pinned commits + content hashes.

## Dependency reference forms (`apm.yml`)

```yaml
dependencies:
  apm:
    # Short form — owner/repo, optionally a sub-path and a #ref
    - microsoft/apm-sample-package
    - anthropics/skills/frontend-design
    - github/awesome-copilot/plugins/context-engineering#v2.1
    - github/awesome-copilot/agents/api-architect.agent.md

    # Git-host form — explicit git:/path:/ref: keys (non-GitHub or private hosts)
    - git: https://gitlab.com/acme/coding-standards.git
      path: instructions/security
      ref: v2.0

    # Direct host URLs
    - dev.azure.com/acme/platform/_git/prompts/review.prompt.md
    - bitbucket.org/team/agent-rules#main

    # Local path (monorepo package in this same repo)
    - ./packages/sdd

  mcp:
    - io.github.github/github-mcp-server
    - io.github.microsoft/playwright-mcp
```

Use `devDependencies.apm:` for packages needed only during local development (not shipped
to consumers) — e.g. this repo wires its own local packages there.

## Lockfile — `apm.lock.yaml`

Lives at the project root next to `apm.yml`. Pins exact commit SHAs and per-file content
hashes so every install from the same lockfile is byte-identical. Key fields:

- `resolved_commit` — exact SHA (reproducibility).
- `content_hash` — SHA-256 of the package tree (supply-chain integrity check).
- `deployed_file_hashes` — per-file SHA-256 (drift detection; see `apm-audit-security`).

Commit `apm.lock.yaml`. In CI, install with `--frozen` so the lockfile is authoritative and
never silently rewritten.

## `apm update` / `apm outdated` / `apm list`

```bash
apm update            # re-resolve every dep to latest matching ref; print add/update/remove/unchanged; prompt before rewriting lockfile (defaults to No)
apm update --yes      # skip the prompt (CI)
apm update --dry-run  # print the plan, write nothing
apm outdated          # list dependencies that have newer matching versions available
apm list              # list installed dependencies
```

`apm update` defaults to **No** on its consent prompt — declining exits cleanly with no
writes.

## Auth for private packages

APM resolves credentials **per host** and never forwards a credential to a host you didn't
configure it for. Precedence:

- **GitHub** (`github.com`, GHE, GHES): `GITHUB_APM_PAT_<ORG>` → `GITHUB_APM_PAT` →
  `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token --hostname <host>` (if `gh` installed).
- **GitLab:** `GITLAB_APM_PAT` → `GITLAB_TOKEN` → git credential helper → git transport.
- **Azure DevOps:** `az login` (recommended) → `ADO_APM_PAT`.
- **Bitbucket / Gitea / other:** git credential helper — `git clone` must work first.

If a private install 401s, check the highest-precedence variable for that host is set.

## Red Flags

- CI install without `--frozen` → lockfile may be rewritten, breaking reproducibility.
- Using `--force` or `--no-policy` to push past a security/policy block instead of fixing
  the finding.
- Editing `apm_modules/` or deployed files by hand → drift; `apm audit` will flag it.
- Not committing `apm.lock.yaml` → installs aren't reproducible across machines/CI.
- Adding a transitive MCP server via `--trust-transitive-mcp` without reviewing what it is.
