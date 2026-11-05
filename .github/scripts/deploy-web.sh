#!/bin/sh
# Uses the existing forced-command deploy key; uploads cannot reach the live site.
set -eu
stage=${1:?usage: deploy-web.sh stage commit deployment-id}
sha=${2:?missing commit}
id=${3:?missing deployment-id}
test -n "${VPS_DEPLOY_KEY:-}" || { echo 'Missing VPS_DEPLOY_KEY' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
private_dir=$(mktemp -d)
trap 'rm -rf "$private_dir"' EXIT HUP INT TERM
printf '%s\n' "$VPS_DEPLOY_KEY" > "$private_dir/key"
chmod 600 "$private_dir/key"
ssh_options="-i $private_dir/key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$script_dir/vps-known-hosts"
rsync -rzc --delay-updates --stats --human-readable --link-dest=/baseline --rsync-path=web-upload \
    -e "ssh $ssh_options" "$stage/" "root@192.209.62.27:$id/"
ssh $ssh_options root@192.209.62.27 "$sha $id"
