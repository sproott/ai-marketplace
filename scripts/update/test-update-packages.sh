#!/usr/bin/env bash
set -euo pipefail

source_script="$(cd "$(dirname "$0")/.." && pwd)/update-packages.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

setup() {
  local name=$1

  root="$tmp/$name"
  mkdir -p "$root/scripts" "$root/bin" "$root/packages/fallow"
  cp "$source_script" "$root/scripts/"

  printf '# package comment\nname: fallow\nversion: \"1.0.0\" # pinned release\n' > "$root/packages/fallow/apm.yml"
  printf '# retain me\nversion: 9.0.0 # unrelated\nmarketplace:\n  packages:\n    - name: fallow\n      version: 1.0.0\n' > "$root/apm.yml"

  for package in caveman impeccable playwright-cli rtk; do
    mkdir -p "$root/packages/$package" "$root/vendor/$package"
    printf 'name: %s\nversion: 1.0.0\n' "$package" > "$root/packages/$package/apm.yml"
    printf '    - name: %s\n      version: 1.0.0\n' "$package" >> "$root/apm.yml"
    printf '{"version":"2.0.0"}\n' > "$root/vendor/$package/package.json"
  done

  printf '[package]\nversion = "2.0.0"\n' > "$root/vendor/rtk/Cargo.toml"
  cp "$root/apm.yml" "$root/root-before.yml"
  cp "$root/packages/fallow/apm.yml" "$root/fallow-before.yml"

  export LOG="$root/log" FAIL='' LATEST=2.0.0
  : > "$LOG"

  for cmd in git just npm; do
    cat > "$root/bin/$cmd" <<'STUB'
#!/usr/bin/env bash
name=${0##*/}
printf '%s %s\n' "$name" "$*" >> "$LOG"
[[ "$name $*" != "$FAIL" ]] || exit 42
if [[ "$name $*" == "git -C vendor/caveman describe --tags --abbrev=0" ]]; then
  echo v2.0.0
fi
if [[ "$name" == npm ]]; then
  printf '%s\n' "$LATEST"
fi
STUB
    chmod +x "$root/bin/$cmd"
  done
}

run() { PATH="$root/bin:$PATH" bash "$root/scripts/update-packages.sh" "$@"; }

expect_log() { diff -u <(printf '%s\n' "$1") "$LOG" || { echo 'Expected selected operations in order' >&2; exit 1; }; }

setup selected

run impeccable

expect_log 'git submodule update --init --remote -- vendor/impeccable
just build-impeccable
just test
just install
just audit'
bun - "$root" <<'BUN'
import { readFileSync } from 'node:fs';

const root = process.argv[2];
const read = file => Bun.YAML.parse(readFileSync(`${root}/${file}`, 'utf8'));
const entries = read('apm.yml').marketplace.packages;

for (const entry of entries) {
  const expected = entry.name === 'impeccable' ? '2.0.0' : '1.0.0';
  if (entry.version !== expected || read(`packages/${entry.name}/apm.yml`).version !== expected) {
    throw new Error(`Expected only impeccable pins to change, got ${entry.name}`);
  }
}
BUN
echo 'should update only the selected source when given a package'

setup all

run

expect_log 'git submodule update --init --remote -- vendor/caveman
git -C vendor/caveman describe --tags --abbrev=0
just build-caveman
npm view fallow version
just build-fallow
git submodule update --init --remote -- vendor/impeccable
just build-impeccable
git submodule update --init --remote -- vendor/playwright-cli
just build-playwright-cli
git submodule update --init --remote -- vendor/rtk
just build-rtk
just test
just install
just audit'
bun - "$root" <<'BUN'
import { readFileSync } from 'node:fs';

const root = process.argv[2];

for (const file of ['apm.yml', 'packages/fallow/apm.yml']) {
  const doc = Bun.YAML.parse(readFileSync(`${root}/${file}`, 'utf8'));
  const version = file === 'apm.yml' ? doc.marketplace.packages[0].version : doc.version;
  if (version !== '2.0.0') throw new Error('Expected coherent fallow pins');
}
BUN
echo 'should rebuild all packages and update coherent pins when no selection is given'

for args in unknown 'impeccable rtk'; do
  setup "invalid-${args// /-}"
  if run $args; then echo 'Expected invalid selection to fail' >&2; exit 1; fi
  [[ ! -s "$LOG" ]] || { echo 'Expected no side effects for invalid selection' >&2; exit 1; }
done
echo 'should reject invalid selections before commands run'

for failure in 'git submodule update --init --remote -- vendor/impeccable' 'just build-impeccable' 'just test' 'just install' 'just audit'; do
  setup "failure-${failure// /-}"
  export FAIL="$failure"
  if run impeccable; then echo 'Expected command failure to propagate' >&2; exit 1; fi
  [[ "$(tail -1 "$LOG")" == "$failure" ]] || { echo 'Expected execution to stop at failed command' >&2; exit 1; }
done
echo 'should stop immediately when an update or check fails'

setup bad-version
export LATEST=2.0.0-beta.1
if run fallow; then echo 'Expected prerelease resolution to fail' >&2; exit 1; fi
expect_log 'npm view fallow version'
grep -q 'version: "1.0.0"' "$root/packages/fallow/apm.yml" || { echo 'Expected old pin after invalid resolution' >&2; exit 1; }
echo 'should preserve pins when npm returns a nonstable version'

setup npm-failure
export FAIL='npm view fallow version'
if run fallow; then echo 'Expected npm failure to propagate' >&2; exit 1; fi
expect_log 'npm view fallow version'
echo 'should stop before rebuilding when npm fails'

setup explicit-all
run all
[[ "$(tail -3 "$LOG")" == $'just test\njust install\njust audit' ]] || { echo 'Expected shared checks for explicit all selection' >&2; exit 1; }
echo 'should run shared checks when all is explicitly selected'

setup preserve-comments

run fallow

bun - "$root" <<'BUN'
import { readFileSync } from 'node:fs';

const root = process.argv[2];
const read = file => readFileSync(`${root}/${file}`, 'utf8');
const expectedRoot = read('root-before.yml').replace(
  '    - name: fallow\n      version: 1.0.0',
  '    - name: fallow\n      version: 2.0.0',
);
const expectedPackage = read('fallow-before.yml').replace('"1.0.0"', '"2.0.0"');

if (read('apm.yml') !== expectedRoot) {
  throw new Error('Expected only the selected marketplace version scalar to change');
}
if (read('packages/fallow/apm.yml') !== expectedPackage) {
  throw new Error('Expected only the package version scalar to change, retaining comments and quotes');
}
BUN
echo 'should preserve comments and unrelated text when updating version scalars'
