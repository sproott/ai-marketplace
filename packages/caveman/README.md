# caveman

Local APM package for [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — ultra-compressed
caveman-style agent responses, 65% fewer output tokens with full technical accuracy preserved.

This package is **generated**, not authored by hand. `.apm/` is produced by
`node scripts/build-caveman-package.js` (repo root) from the vendored, untouched submodule at
`vendor/caveman`. Only `apm.yml` and this README are fixed, hand-authored sources — everything
under `.apm/` is rewritten on every regenerate.

To pick up a new caveman release: bump `vendor/caveman` to the new tag, re-run the generator,
then bump `version:` in `apm.yml` to match.

See the upstream repo for caveman's actual product documentation, install instructions, and
behavior reference.
