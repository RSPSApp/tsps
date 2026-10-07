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

## Publish your world

Create a server token at [RSPS.app](https://rsps.app/) under **Settings → Server tokens**, then add it to `.env` in the repository root:

```dotenv
WEBRTC_WORLD_ID=my-world
WEBRTC_WORLD_TOKEN=paste-your-token-here
```

Run `yarn start`. Your world appears in the World list once it registers. Keep the token private.

## Links

- [Progress](https://rsps.app/progress) — how much of OSRS is implemented, by category
- [Host a world](https://rsps.app/host)

## Credits

We want to thank Astrul, Detuks, Vexus and all the contributors of both the legacy Java project and the TypeScript continuation.

## Legal

This fan project is not affiliated with Jagex Ltd. Old School RuneScape and related assets and trademarks belong to their respective owners.
