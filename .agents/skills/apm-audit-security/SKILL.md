---
name: apm-audit-security
description: Audits APM dependencies for supply-chain safety — apm audit flags, the content-hash / cache-integrity / unicode-scan / drift-detection model, and audit as a CI gate. Use when verifying installed primitives are untampered, wiring audit into CI, stripping hidden characters, or checking for drift before committing.
---

# APM Audit & Security

## Overview

`apm audit` verifies that the primitives deployed in a repo match what the lockfile pinned,
and that no primitive hides malicious content. It's the check you run before trusting
installed context and the gate you run in CI. This skill covers the command and APM's
security model.

## When to Use

- Verifying installed/deployed primitives are untampered
- Wiring an audit into CI as a merge gate
- Stripping hidden Unicode from a file
- Checking for drift before committing generated output

**When NOT to use:** installing/updating dependencies (`apm-install-deps`) or authoring
primitives (`apm-author-primitive`).

## `apm audit`

```bash
apm audit                            # local: scan deployed files
apm audit --ci                       # CI gate: baseline checks + install-replay drift
apm audit --file <path>              # scan an arbitrary file, not installed primitives
apm audit --strip                    # remove hidden characters in place
apm audit --strip --dry-run          # preview strip changes, write nothing
apm audit --format json|sarif|markdown   # machine-readable output (default: text)
apm audit --no-drift                 # skip install-replay in CI (faster, weaker)
apm audit --no-fail-fast             # run all checks even after one fails
apm audit --policy <source>          # evaluate org policy against the lockfile
```

## The security model (4 parts)

1. **Content-hash verification** — on a fresh network fetch, APM computes a SHA-256 over
   the package file tree and compares it to `content_hash` in `apm.lock.yaml`. On mismatch,
   the install aborts. Catches a tampered upstream.

2. **Cache-hit integrity** — on every cache hit, APM reads the checkout's `.git/HEAD` and
   verifies it matches the lockfile's `resolved_commit`. On mismatch, the cache entry is
   evicted and a fresh fetch runs. Catches a poisoned local cache.

3. **Unicode scanning** — the pre-deploy scan inspects every primitive for hidden Unicode
   (zero-width characters, bidi controls, tag characters). **Critical findings block the
   install** (override only with `--force`). Catches prompt-injection hidden in text.

4. **Drift detection** — APM rebuilds the deployed context in a scratch directory and diffs
   it against your working tree, catching hand-edits to `apm_modules/` or generated files
   before they ship.

## CI gate

`apm audit --ci` runs a set of baseline checks plus install-replay drift detection:
`lockfile-exists`, `ref-consistency`, `deployed-files-present`, `no-orphaned-packages`,
`skill-subset-consistency`, `config-consistency`, `content-integrity`, `includes-consent`.

```yaml
# CI step
- run: apm audit --ci --format sarif > apm-audit.sarif
```

Pair with `apm install --frozen` in CI so the lockfile — not the network — is authoritative.

## Auditing a whole monorepo

`apm audit` only sees the directory it runs from, so a root-only audit misses a stale
package mirror (see `apm-install-deps`). `scripts/audit-all.sh` (alongside this skill) walks
every `apm.yml` dir — pruning `apm_modules/`, `build/`, `dist/` — and runs `apm audit --ci`
in each, printing `PASS`/`FAIL` per package and exiting non-zero if any fail:

```bash
bash scripts/audit-all.sh [root]     # root defaults to the current dir
```

The repo root is one of the dirs it audits, so root-level dependency drift (e.g. a
third-party package whose deployed files diverge from the install-replay baseline) shows up
as a `FAIL .` even when every first-party package under `packages/*` is clean — read the
per-dir lines, not just the exit code.

## Fixing findings

- **Hidden Unicode:** `apm audit --strip` (preview with `--dry-run` first) to remove the
  characters, then re-audit.
- **Drift:** you hand-edited a generated/deployed file. Move the change to its `.apm/`
  source and re-deploy (`apm install`, or `apm compile` for instruction files), or revert
  the edit — don't `--force` past it.
- **Content-hash / ref mismatch:** the upstream or cache changed under a pinned ref.
  Investigate before re-pinning; only update the lockfile once you trust the new commit.

## Related (not covered here)

Org-level allow/deny enforcement lives in `apm-policy.yml` (checked at install time as the
policy gate) — that's a separate concern from auditing; see the APM docs. This skill does
not cover policy authoring.

## Red Flags

- Using `--force` to push past a critical Unicode finding instead of stripping/reviewing it.
- `--no-drift` in CI to make it pass faster — you lose install-replay drift detection.
- Treating a content-hash mismatch as noise and re-pinning without investigating.
- No `apm audit` in CI, so tampering / drift ships unnoticed.
- In a monorepo, a single root `apm audit` — it can't see a stale `packages/*` mirror. Audit
  per package dir, or run `scripts/audit-all.sh`.
