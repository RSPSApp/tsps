# Coordinated SSH deployment

Every `tsps` main deployment and website host deployment uses the same uploader and
VPS command. `prepare` excludes client source maps and server-owned client caches,
and records hashes for every file. Identical versioned/unversioned startup files
travel once and are recreated as hard links on the VPS.

The existing `VPS_DEPLOY_KEY` remains a forced-command key. `web-upload` delegates
to the VPS's installed `rrsync`, restricted to write-only uploads under
`/var/lib/rsps-web`. It does not permit a shell or writes to the live site. Each run
has a separate staging directory; the previous successful staging tree supplies
rsync's checksum/delta basis. No additional secret or running service is needed.

The VPS validates the complete deployment before publishing any file. HTML is
published last; old immutable releases and the full client cache are retained.
World 1 keeps its SQLite backup, build, restart and health checks. The active host
release marker is published only after live hashes and public cache checks pass.

## One-time rollout

Merge this TSPS change first. Using the existing administrator SSH access, install
the updated forced command before rerunning Deploy:

```sh
cd /root/tsps
git fetch origin main
git show origin/main:.github/scripts/deploy-world1.sh > /tmp/tsps-deploy-new
install -m 755 /tmp/tsps-deploy-new /usr/local/bin/tsps-deploy
```

Then merge the companion website change. Old SHA-only deployment commands remain
supported. The existing key and authorized_keys restriction are unchanged. An
unupgraded command rejects the new upload mode before any live file is modified.

Validation: `node --test .github/scripts/web-deploy.test.mjs`.
