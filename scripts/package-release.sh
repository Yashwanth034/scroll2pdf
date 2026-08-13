#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/scroll2pdf-1.0.0.zip"

copy() { mkdir -p "$STAGE_DIR/$(dirname "$1")"; cp "$ROOT_DIR/$1" "$STAGE_DIR/$1"; }
copy manifest.json
copy README.md
copy LICENSE
copy popup/popup.html; copy popup/popup.css; copy popup/popup.js
copy result/result.html; copy result/result.css
for file in background/*.js content/*.js content/adapters/*.js offscreen/*.js result/*.js utils/*.js; do
  rel="${file#"$ROOT_DIR/"}"
  copy "$rel"
done
for file in assets/icons/icon-*.png; do copy "${file#"$ROOT_DIR/"}"; done

node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1])); for (const f of [p.action.default_popup,p.background.service_worker,...(p.content_scripts||[]).flatMap(x=>x.js),...Object.values(p.icons||{})]) if (!fs.existsSync(process.cwd()+"/"+f)) throw new Error("Missing packaged path: "+f);' "$STAGE_DIR/manifest.json"
(cd "$STAGE_DIR" && zip -q -r "$DIST_DIR/scroll2pdf-1.0.0.zip" .)
printf 'Created %s (%s bytes)\n' "$DIST_DIR/scroll2pdf-1.0.0.zip" "$(stat -c %s "$DIST_DIR/scroll2pdf-1.0.0.zip")"
