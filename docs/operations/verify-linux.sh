#!/bin/bash
set -euo pipefail
mkdir -p /work/source /work/tmp /work/home /work/cache
export HOME=/work/home XDG_CONFIG_HOME=/work/home/config XDG_DATA_HOME=/work/home/data
export XDG_CACHE_HOME=/work/cache BUN_INSTALL_CACHE_DIR=/work/cache/bun
export TMPDIR=/work/tmp TMP=/work/tmp TEMP=/work/tmp CI=1
trap 'rc=$?; printf "runner_exit=%s\n" "$rc"; exit "$rc"' EXIT
cp -a /input/source/. /work/source/
cd /work/source
gate() {
  local name=$1 seconds=$2
  shift 2
  local rc=0
  timeout --signal=TERM --kill-after=5s "${seconds}s" "$@" >"/evidence/$name.log" 2>&1 || rc=$?
  printf '%s exit=%s\n' "$name" "$rc" | tee -a /evidence/exits.log
  if [ "$rc" != 0 ]; then tail -n 50 "/evidence/$name.log"; exit "$rc"; fi
}
uname -a
bun --version
bun --revision
node --version
sha256sum bun.lock > /evidence/lock-before.sha256
gate install 180 bun install --frozen-lockfile --ignore-scripts
sha256sum -c /evidence/lock-before.sha256
gate adapter 120 bun run test ./src/test-support/token-host.test.ts
gate summary 120 bun run test ./src/token-summary.test.ts
gate display 120 bun run test ./src/token-display.test.tsx
gate full 120 bun run test
gate types 120 ./node_modules/.bin/tsc --noEmit
gate lint 120 bun run lint
gate build 180 bun run build
gate format 120 ./node_modules/.bin/prettier --check src/token-summary.test.ts src/token-display.test.tsx src/test-support/token-host.ts src/test-support/token-host.test.ts src/tui.click.test.tsx src/store.test.ts src/backfill.test.ts
sha256sum bun.lock dist/index.js dist/tui.js > /evidence/artifacts.sha256
find /work/tmp -maxdepth 1 -type d -name 'cmon-*' > /evidence/remaining-fixtures.log
if [ -s /evidence/remaining-fixtures.log ]; then echo 'Fixture cleanup failed'; exit 1; fi
