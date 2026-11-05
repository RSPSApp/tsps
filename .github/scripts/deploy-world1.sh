#!/bin/sh
# Install once: install -m 755 .github/scripts/deploy-world1.sh /usr/local/bin/tsps-deploy
# The existing CI key stays a forced command, including its restricted rsync mode.
set -efu
command=${SSH_ORIGINAL_COMMAND:-"$*"}
case "$command" in
    'web-upload --server '*)
        install -d -m 700 /var/lib/rsps-web /var/lib/rsps-web/baseline
        SSH_ORIGINAL_COMMAND="rsync ${command#web-upload }"
        export SSH_ORIGINAL_COMMAND
        exec /usr/bin/rrsync -wo -no-del -munge /var/lib/rsps-web
        ;;
esac
set -- $command
[ "$#" -eq 1 ] || [ "$#" -eq 2 ] || { echo 'usage: tsps-deploy commit [deployment-id]' >&2; exit 2; }
sha=$1
id=${2:-}
case "$sha" in *[!0-9a-f]* | '') echo 'Invalid commit' >&2; exit 2 ;; esac
[ ${#sha} -eq 40 ] || { echo 'Invalid commit length' >&2; exit 2; }
if [ -n "$id" ]; then
    case "$id" in *[!0-9-]* | '' | -* | *-) echo 'Invalid deployment id' >&2; exit 2 ;; esac
    case "$id" in *-*) ;; *) echo 'Invalid deployment id' >&2; exit 2 ;; esac
fi
set +f

exec 9>/run/tsps-deploy.lock
flock 9
cd /root/tsps
git fetch -q origin main
git merge-base --is-ancestor "$sha" origin/main
# Refuses old/out-of-order deployments and local edits/commits.
git merge --ff-only -q "$sha"
if [ -n "$id" ]; then
    node .github/scripts/web-deploy.mjs check "/var/lib/rsps-web/$id" /var/www/flarum "$sha" "$id"
fi
cd server
corepack yarn install --immutable
corepack yarn ensure-cache --publish /var/www/flarum/play/caches
corepack yarn build
if [ -n "$id" ]; then
    node ../.github/scripts/web-deploy.mjs apply "/var/lib/rsps-web/$id" /var/www/flarum "$sha" "$id"
fi

backups=/root/backups/saves
mkdir -p "$backups"
sqlite3 data/saves/players.sqlite ".backup $backups/players-$(date -u +%Y%m%dT%H%M%SZ)-$(echo "$sha" | cut -c1-8).sqlite"
ls -1t "$backups"/players-*.sqlite | tail -n +31 | xargs -r rm --

systemctl restart rsps-game-server
sleep 15
systemctl is-active --quiet rsps-game-server || { journalctl -u rsps-game-server -n 50 --no-pager; exit 1; }
if [ -n "$id" ]; then
    node ../.github/scripts/web-deploy.mjs publish "/var/lib/rsps-web/$id" /var/www/flarum "$sha" "$id" "$(cat target.txt)"
    install -d -m 700 /var/lib/rsps-web/baseline
    rsync -rc --delete "/var/lib/rsps-web/$id/" /var/lib/rsps-web/baseline/
    # Only the last verified upload is needed as the next transfer's checksum/delta basis.
    rm -rf "/var/lib/rsps-web/$id"
fi
install -m 755 ../.github/scripts/deploy-world1.sh /usr/local/bin/tsps-deploy
git log -1 --format='World 1 is running %h %s'
