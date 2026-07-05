---
name: apm-author-marketplace
description: Authors an APM marketplace to publish packages for others to install — the apm.yml marketplace: block (owner, build, outputs, packages) or standalone marketplace.json, plus per-package tag versioning and local-path vs remote sources. Use when setting up or editing a marketplace, adding a package to it, or choosing a version tag pattern.
---

# Authoring an APM Marketplace

## Overview

A marketplace lets a repo *publish* one or more APM packages that others resolve and
install. It's declared either as a `marketplace:` block inside the root `apm.yml`, or as a
standalone `marketplace.json`. Each listed package points at a source (a local path in the
same repo, or a remote `owner/repo`) and a version resolved from Git tags.

## When to Use

- Setting up a marketplace in a repo, or adding/editing a package in the marketplace list
- Choosing how package versions map to Git tags (`tag_pattern`)
- Deciding between a local-path package entry and a remote one

**When NOT to use:** installing/consuming dependencies (`apm-install-deps`), authoring the
primitives inside a package (`apm-author-primitive`), or manifest/compile basics
(`apm-package-init`).

## Form 1: `marketplace:` block in `apm.yml` (this repo's pattern)

This repo's root `apm.yml` is the live example — a monorepo publishing local-path packages:

```yaml
marketplace:
  owner:
    name: sproott
    url: https://github.com/sproott

  # Default tag pattern used to resolve version ranges for each package.
  build:
    tagPattern: "v{version}"

  # Output targets (map form). Each output writes to its profile default path;
  # add 'path:' under a key to override.
  outputs:
    claude: {}
    # codex: {}   # enabling codex requires every package to declare 'category:'

  packages:
    # Local-path entry: a package shipped alongside this repo.
    - name: sdd
      source: ./packages/sdd
      description: Spec Driven Development toolkit
      version: 1.0.0
```

Per-package fields:

| Field | Purpose |
|---|---|
| `name` | Package identifier consumers install by |
| `source` | `./packages/<x>` (local path) or `owner/repo` (remote) |
| `description` | Human-readable; should match the package's own `apm.yml` |
| `version` | Version this entry publishes |
| `tag_pattern` | Per-package tag scheme, overrides `build.tagPattern` (e.g. `"{name}-v{version}"` for independent monorepo releases) |
| `ref` | Pin to an explicit Git ref instead of a version range |
| `subdir` | Path inside the repo if the package isn't at root |
| `category` | Required only when `outputs` includes `codex` |
| `include_prerelease` | Include prerelease tags when resolving |

### Versioning: lockstep vs independent tags

- **Lockstep** (repo-wide tags like `v{version}`): omit `tag_pattern` on the package so it
  inherits `build.tagPattern`. Every package releases together under one repo tag. This is
  what `packages/sdd` does today (no `tag_pattern`).
- **Independent** (per-package tags like `{name}-v{version}` → `apm-v1.0.0`): set
  `tag_pattern` on the package. Preferred in a monorepo so each package versions on its own
  cadence.

## Form 2: standalone `marketplace.json`

Same fields, JSON form, when you don't want a `marketplace:` block in `apm.yml`:

```json
{
  "owner": "acme",
  "build": { "tagPattern": "v*", "outputs": "dist/" },
  "packages": [
    {
      "name": "code-review",
      "source": "./packages/review",
      "description": "Code review skills",
      "version": "1.0.0",
      "tag_pattern": "v*",
      "ref": "main",
      "subdir": "review",
      "category": "review",
      "include_prerelease": false
    }
  ]
}
```

## Local-path vs remote packages

- **Local path** (`source: ./packages/<x>`): package lives in this same repo. Consumers
  installing from a remote resolve it via the marketplace owner's repo + tag. In-repo, it's
  also wired as a `devDependencies.apm: ./packages/<x>` so this repo deploys it locally.
- **Remote** (`source: owner/repo`): package lives in another repo; resolved by its own
  tags.

## Out of Scope

- **`apm pack`** (building a distributable local bundle) exists in APM but is **not** this
  repo's workflow — packages here are installed by direct GitHub reference, not packed
  bundles. Don't teach `apm pack` as the primary path.
- **Org policy** (`apm-policy.yml`) is a separate concern from the marketplace — it governs
  what consumers are allowed to install, not what a repo publishes. Not covered here; see
  the APM docs.

## Red Flags

- `tag_pattern` that doesn't match the tags you actually push → version resolution fails.
- A marketplace `description` that drifts from the package's own `apm.yml` description.
- Adding `codex` to `outputs` without giving every package a `category:` → compile error.
- Mixing up publish (marketplace `packages:`) with consume (`dependencies` /
  `devDependencies`) — a monorepo package usually appears in *both*.
