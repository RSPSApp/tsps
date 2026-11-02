# TSPS - TypeScript RuneScape Private Server

A browser-based Old School RuneScape private server with a TypeScript/WebGL client and TypeScript game server.

## Packages

- [`client/`](client/) — browser client (Forked from [xRSPS](https://github.com/xrsps/xrsps-typescript))
- [`server/`](server/) — game server (Official continuation of our [Elvarg](https://github.com/RSPSApp/elvarg-rsps) fork - Ported to TypeScript)

## Quick start

Install [Node.js 22.16 or later](https://nodejs.org/en/download) first. No separate Yarn or Corepack installation is needed.

From the repository root:

```bash
npm run setup
yarn start
```

Open <http://localhost:3000>. The first start downloads the game cache automatically.

If setup is interrupted, run `npm run setup` again.

Running several branches at once, one worktree each on its own ports: see [docs/worktrees.md](docs/worktrees.md).

### Optional: Java sidecars

Two optional local services are Java; neither is needed to run the server.

| Command | What it enables | Setup |
| --- | --- | --- |
| `yarn bridge` | the in-game Quest Helper panel, from the upstream Java helper | **Java 21**, then the one-time build in [`tools/quest-helper-bridge`](tools/quest-helper-bridge/README.md) |
| `yarn gateway` | the official OSRS client through RSProx, playing on this server | [`gateway/README.md`](gateway/README.md) |

The bridge and server need the same `QUEST_HELPER_TOKEN` (at least 24 characters) in `.env`.
Without it, the panel reports that the server token is missing. Tutorial Island and Recipe for
Disaster still work because the server answers those itself. `QUEST_HELPER_URL` can point the
server at a bridge outside loopback, such as `http://quest-helper:16471`; it must be an HTTP(S)
URL without credentials, query parameters or a fragment. The default is
`http://127.0.0.1:${QUEST_HELPER_PORT:-16471}`. A separate single-client RuneLite 1.13.3 demo
lives in [`tools/runelite-gateway`](tools/runelite-gateway/README.md).

## Publish your world

Create a server token at [RSPS.app](https://rsps.app/) under **Settings → Server tokens**, then add it to `.env` in the repository root:

```dotenv
WEBRTC_WORLD_ID=my-world
WEBRTC_WORLD_NAME=My World
WEBRTC_WORLD_TOKEN=paste-your-token-here
```

`WEBRTC_WORLD_NAME` is the name shown in the World list; it defaults to `WEBRTC_WORLD_ID`. The list also shows the `description` (up to 120 characters) and `spawn` from [`server/data/definitions/world.json`](server/data/definitions/world.json).

Run `yarn start`. Your world appears in the World list once it registers. Keep the token private.

## Links

- [Discord](https://discord.com/invite/TCTDGVzejn) — questions, help and development chat
- [Progress](https://rsps.app/progress) — how much of OSRS is implemented, by category
- [Host a world](https://rsps.app/host)

## Credits

We want to thank Astrul/@Lerl, Detuks/@Reinismu, @xrsps, Vexus/@bandithaxx and all the contributors of both the legacy Java project and the TypeScript continuation.

## Legal

This fan project is not affiliated with Jagex Ltd. Old School RuneScape and related assets and trademarks belong to their respective owners.
