#!/bin/sh
# Deploys World 1 and the public client cache at a tsps main commit.
# Install: install -m 755 .github/scripts/deploy-world1.sh /usr/local/bin/tsps-deploy
# The Deploy workflow runs it through a forced-command SSH key.
set -eu
sha=${SSH_ORIGINAL_COMMAND:-${1:-}}
case "$sha" in *[!0-9a-f]* | "") echo "usage: tsps-deploy <40-char commit sha>" >&2; exit 2 ;; esac
[ ${#sha} -eq 40 ] || { echo "usage: tsps-deploy <40-char commit sha>" >&2; exit 2; }

exec 9>/run/tsps-deploy.lock
flock 9

cd /root/tsps
git fetch -q origin main
# Refuses to move if the checkout has local commits or edits.
git merge --ff-only -q "$sha"

cd server
corepack yarn install --immutable
corepack yarn ensure-cache --publish /var/www/flarum/play/caches
corepack yarn build

# Keep the last 30 save snapshots in case a release corrupts them.
backups=/root/backups/saves
mkdir -p "$backups"
sqlite3 data/saves/players.sqlite ".backup $backups/players-$(date -u +%Y%m%dT%H%M%SZ)-$(echo "$sha" | cut -c1-8).sqlite"
ls -1t "$backups"/players-*.sqlite | tail -n +31 | xargs -r rm --

systemctl restart rsps-game-server
sleep 15
systemctl is-active --quiet rsps-game-server || { journalctl -u rsps-game-server -n 50 --no-pager; exit 1; }
git log -1 --format='World 1 is running %h %s'
