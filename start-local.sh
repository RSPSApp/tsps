#!/usr/bin/env bash
# Launch this worktree's visual Creator without starting a duplicate local stack.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

open_page=1
case "${1:-}" in
  --no-open) open_page=0 ;;
  --help|-h)
    echo "Usage: ./start-local.sh [--no-open]"
    echo "Starts this checkout with Creator enabled and opens its cache editor."
    echo "If Creator is already running, opens that instance. Ctrl+C stops a newly started stack."
    exit 0 ;;
  '') ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

# Read only the worktree's assigned numeric ports. Do not source arbitrary .env code.
read -r client_port tool_port < <(node - <<'JS'
const fs = require('node:fs');
const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const number = (key, fallback) => Number(env.match(new RegExp(`^${key}=(\\d+)\\s*$`, 'm'))?.[1] ?? fallback);
console.log(number('PORT', 3000), 3890 + number('WT_SLOT', 0));
JS
)
url="http://localhost:${client_port}/?cache=1"
service="http://localhost:${tool_port}/api/info"
ready() { curl --silent --fail --max-time 2 --output /dev/null "$service"; }
open_creator() {
  echo "Creator: $url"
  echo "Choose NPC Creator or Gear Creator in the cache editor. Search a source, then drag a pictured part into the centre."
  if (( open_page )); then
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$url" >/dev/null 2>&1 || echo "Open the address above in your browser."
    else
      echo "Open the address above in your browser."
    fi
  fi
}
if ready; then
  echo "Using the running Creator."
  open_creator
  exit 0
fi
if curl --silent --fail --max-time 2 --output /dev/null "http://localhost:${client_port}/"; then
  echo "This checkout's client is running, but Creator is unavailable." >&2
  echo "Stop that checkout's launcher, then run this script again to enable Creator." >&2
  exit 1
fi

export CACHE_EDITOR_ENABLED=1
# Open the cache editor ourselves rather than CRA's default game page.
export BROWSER=none
(
  for ((attempt=0; attempt<180; attempt++)); do
    if ready && curl --silent --fail --max-time 2 --output /dev/null "$url"; then
      open_creator
      exit 0
    fi
    sleep 1
  done
  echo "Creator is still starting. Once startup finishes, open $url"
) &
page_waiter=$!
trap 'kill "$page_waiter" 2>/dev/null || true' EXIT
printf 'Starting Creator from %s\n' "$PWD"
printf 'Cache editor: %s\n' "$url"
npm exec --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn start
