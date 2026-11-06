# Deploying the idle world to jogo.stfu.fun

The live idle world runs on a shared VPS that already serves other production
sites. Everything here follows from that one fact: the box is not ours alone.

## What is where

| | |
|---|---|
| Host | `179.198.112.158`, Ubuntu 24.04, 2 vCPU / 7.8 GB, **no swap** |
| Deploy root | `/home/stfu/jogo` (compose) and `/home/stfu/jogo/tsps` (this repo) |
| Web entry point | **Traefik**, in a container, owning `:80` and `:443` |
| Containers | `jogo-server` (the game) and `jogo-web` (the built client) |
| Compose | [`jogo-stfu-fun.compose.yml`](jogo-stfu-fun.compose.yml), copied to `/home/stfu/jogo/docker-compose.yml` |

## Three things that will bite you

**Traefik already owns 80 and 443.** Installing nginx or Caddy on this host
takes down every other site on it. A new service is published by adding labels
to its container and joining the `holyia_default` network, never by putting
another web server in front.

**One hostname serves both the client and the game socket.** The game's HTTP
server accepts the WebSocket upgrade on any path and answers `/api/` itself, so
the split is by matcher and priority, not by subdomain:

| Priority | Rule | Goes to |
|---|---|---|
| 100 | `Header(Upgrade, websocket)` | `jogo-server` |
| 90 | `PathPrefix(/api/)` | `jogo-server` |
| 10 | `Host(jogo.stfu.fun)` | `jogo-web` |

**`client/.env` beats the root one, and it is not yours.** Create React App reads
`client/.env` after the root `.env`, so a local development override there wins
over production. Building the client with one present ships a client that points
at `ws://localhost:43594`: it loads, it is branded correctly, and nobody can
connect. Check before every client build:

```bash
ls client/.env    # must not exist; keep the dev one as client/.env.localdev
grep -o 'wss\?://[^"]*' client/build/static/js/main.*.js | sort -u
```

The second line is the one that matters — it says where the built client will
actually dial.

**Compile elsewhere, ship the result.** With no swap and ten production
containers, a webpack build here can get something else killed. Build the client
and the server on a workstation and copy `client/build` and `server/dist` over.
What may run on the host is dependency installation and `ensure-cache`, which
download rather than compile, and even those go in a memory-capped container.

## Deploying a new version

```bash
# On a workstation, from a clean checkout of main:
(cd server && yarn build)
(cd client && yarn build)          # needs PUBLIC_URL=/ (see below)
tar czf - -C server dist   | ssh VPS 'cd ~/jogo/tsps/server && rm -rf dist  && tar xzf -'
tar czf - -C client build  | ssh VPS 'cd ~/jogo/tsps/client && rm -rf build && tar xzf -'
ssh VPS 'cd ~/jogo && sudo docker compose restart jogo-server jogo-web'
```

When `package.json` dependencies changed, reinstall inside a capped container
first — **without** `--mode=skip-build`, or `node-datachannel`'s native binary is
never produced and the server dies on boot with `MODULE_NOT_FOUND`:

```bash
sudo docker run --rm --user "$(id -u):$(id -g)" \
  -v "$HOME/jogo/tsps:/app" -w /app/server -m 2g --cpus 1.5 \
  -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  node:22-bookworm bash -lc 'corepack yarn install && corepack yarn ensure-cache'
```

## Deployment-only files, all gitignored

`.env` at the repo root, read by `scripts/run-with-env.mjs`:

```
REACT_APP_DEFAULT_WS_URL=wss://jogo.stfu.fun
REACT_APP_DEFAULT_SERVER_ADDRESS=jogo.stfu.fun
REACT_APP_DEFAULT_SERVER_NAME=Idle
REACT_APP_DEFAULT_SERVER_SECURE=true
REACT_APP_SERVERS_JSON=[{"name":"Idle","address":"jogo.stfu.fun","secure":true,"maxPlayers":2047}]
WORLD_WEBSOCKET_URL=wss://jogo.stfu.fun
PUBLIC_URL=/
```

`PUBLIC_URL=/` matters: `homepage` in `client/package.json` is `/play`, which is
where the upstream project mounts its own client. Overriding it through the
environment keeps `package.json` identical to upstream, so syncing never
conflicts over it. Without it every asset 404s at the root.

```
REACT_APP_WEBRTC_SIGNAL_URL=off
REACT_APP_BRAND_NAME=OldSchool Idle
```

`off` stops the client discovering worlds through the shared directory at
`wss://worlds.rsps.app`, so the server list is this world alone;
`REACT_APP_BRAND_NAME` is the name the tab title and the login screens print.

`server/data/definitions/world.local.json` turns the idle mode on for new
accounts. Note the path: it is read relative to `server/`, not from the repo root.

```json
{ "description": "Idle", "pluginConfig": { "IdleMode:newAccounts": true } }
```

Both are gitignored, so `git reset --hard origin/main` on the host leaves them
alone.

## Backups

`/home/stfu/jogo/backup.sh` runs daily at 04:17 UTC from the `stfu` crontab and
keeps seven days in `/home/stfu/jogo/backups`. It snapshots `players.sqlite` with
SQLite's `VACUUM INTO` from inside the running container, because a plain `cp` of
a live database can catch a half-written page, and copies `idle-hiscores.json`.
It falls back to `cp` only when the container is down and the file is at rest.
