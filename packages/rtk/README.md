# rtk

Local APM package for [rtk-ai/rtk](https://github.com/rtk-ai/rtk) — a Rust CLI proxy that cuts
LLM token consumption 60-90% on common dev commands (git, cargo, npm, docker, kubectl, etc.).

This package is **generated**, not authored by hand. `.apm/` is produced by
`bun scripts/build-rtk-package.ts` (repo root) from the vendored, untouched submodule at
`vendor/rtk`, plus the shell sources authored in this repo under `scripts/rtk/` that replace
upstream's hardcoded-absolute-path hook with a PATH-resolving wrapper and add the shim
installer, shim gate, and extra rewrites — see `docs/specs/rtk-package/spec.md` for why. Only `apm.yml` and this
README are fixed, hand-authored sources — everything under `.apm/` is rewritten on every
regenerate.

Commands:

```
Generate package:   bun scripts/build-rtk-package.ts
Validate package:   bun scripts/build-rtk-package.ts --validate
Install (deploy):   apm install                            # from repo root
Bump rtk:           git -C vendor/rtk fetch --tags \
                       && git -C vendor/rtk checkout <ref> \
                       && bun scripts/build-rtk-package.ts \
                       && git add vendor/rtk packages/rtk
                     # then bump `version:` in packages/rtk/apm.yml by hand to match <ref>
```

See the upstream repo for rtk's actual product documentation, install instructions, and
behavior reference.
