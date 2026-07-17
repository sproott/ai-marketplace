# rtk

Local APM package for [rtk-ai/rtk](https://github.com/rtk-ai/rtk) — a Rust CLI proxy that cuts
LLM token consumption 60-90% on common dev commands (git, cargo, npm, docker, kubectl, etc.).

This package is **generated**, not authored by hand. `.apm/` is produced by
`node scripts/build-rtk-package.js` (repo root) from the vendored, untouched submodule at
`vendor/rtk`, plus two scripts authored in this repo (`scripts/rtk/rtk-hook-wrapper.sh`,
`scripts/rtk/rtk-shim-install.sh`) that replace upstream's hardcoded-absolute-path hook with a
PATH-resolving wrapper — see `docs/specs/rtk-package/spec.md` for why. Only `apm.yml` and this
README are fixed, hand-authored sources — everything under `.apm/` is rewritten on every
regenerate.

Commands:

```
Generate package:   node scripts/build-rtk-package.js
Validate package:   node scripts/build-rtk-package.js --validate
Install (deploy):   apm install                            # from repo root
Bump rtk:           git -C vendor/rtk fetch --tags \
                       && git -C vendor/rtk checkout <ref> \
                       && node scripts/build-rtk-package.js \
                       && git add vendor/rtk packages/rtk
                     # then bump `version:` in packages/rtk/apm.yml by hand to match <ref>
```

See the upstream repo for rtk's actual product documentation, install instructions, and
behavior reference.
