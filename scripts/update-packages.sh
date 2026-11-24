#!/usr/bin/env bash
set -euo pipefail

if (( $# > 1 )); then
  echo 'Usage: update-packages.sh [all|caveman|fallow|impeccable|playwright-cli|rtk]' >&2
  exit 2
fi

case "${1:-all}" in
  all) packages=(caveman fallow impeccable playwright-cli rtk) ;;
  caveman|fallow|impeccable|playwright-cli|rtk) packages=("$1") ;;
  *) echo "Unknown package: $1" >&2; exit 2 ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/.."

for package in "${packages[@]}"; do
  version=''

  if [[ "$package" == fallow ]]; then
    version=$(npm view fallow version)
  else
    git submodule update --init --remote -- "vendor/$package"

    if [[ "$package" == caveman ]]; then
      # Caveman's npm metadata has an independent version; release tags version the skills.
      version=$(git -C vendor/caveman describe --tags --abbrev=0)
      version=${version#v}
    fi
  fi

  bun - "$package" "$version" <<'BUN'
import { readFileSync, writeFileSync } from 'node:fs';

const [name, resolved] = process.argv.slice(2);
const read = (file) => readFileSync(file, 'utf8');

let version = resolved;

if (name === 'rtk') version = Bun.TOML.parse(read('vendor/rtk/Cargo.toml')).package.version;
if (name === 'impeccable' || name === 'playwright-cli') version = JSON.parse(read(`vendor/${name}/package.json`)).version;

if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Expected a stable release version for ${name}, got ${JSON.stringify(version)}`);
}

function replaceVersion(text, indent) {
  const scalar = new RegExp(`^(${indent}version:[ \t]*)(["']?)[^\\s"'#]+\\2([ \t]*(?:#.*)?\\r?)$`, 'gm');
  let matches = 0;
  const output = text.replace(scalar, (_, prefix, quote, suffix) => {
    matches++;
    return `${prefix}${quote}${version}${quote}${suffix}`;
  });

  if (matches !== 1) throw new Error(`Expected one version scalar with indentation ${JSON.stringify(indent)}`);
  return output;
}

const manifestPath = `packages/${name}/apm.yml`;
const manifestText = read(manifestPath);
const rootText = read('apm.yml');
const manifest = Bun.YAML.parse(manifestText);
const marketplace = Bun.YAML.parse(rootText);
const entries = marketplace.marketplace.packages.filter(entry => entry.name === name);

if (manifest.name !== name || entries.length !== 1) {
  throw new Error(`Expected unique matching manifests for ${name}`);
}

console.log(`${name}: ${manifest.version} -> ${version} (marketplace: ${entries[0].version} -> ${version})`);
const oldManifestVersion = manifest.version;
const oldMarketplaceVersion = entries[0].version;
manifest.version = version;
entries[0].version = version;

const manifestOutput = manifestText.trimStart().startsWith('{')
  ? JSON.stringify(manifest, null, 2) + '\n'
  : replaceVersion(manifestText, '');
let blocks = 0;
const rootOutput = rootText.replace(
  /^    - name: ([^\r\n]+)\r?\n(?:(?!^    - |^\S)[\s\S])*/gm,
  block => {
    if (Bun.YAML.parse(block)[0].name !== name) return block;
    blocks++;
    return replaceVersion(block, '      ');
  },
);

if (blocks !== 1 || JSON.stringify(Bun.YAML.parse(rootOutput)) !== JSON.stringify(marketplace)) {
  throw new Error(`Expected only the marketplace version for ${name} to change`);
}
if (JSON.stringify(Bun.YAML.parse(manifestOutput)) !== JSON.stringify(manifest)) {
  throw new Error(`Expected only the package version for ${name} to change`);
}

if (oldManifestVersion !== version) writeFileSync(manifestPath, manifestOutput);
if (oldMarketplaceVersion !== version) writeFileSync('apm.yml', rootOutput);
BUN

  just "build-$package"
done

just test
just install
just audit
