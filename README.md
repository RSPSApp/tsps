# TSPS - TypeScript RuneScape Private Server

A browser-based Old School RuneScape private server with a TypeScript/WebGL client and TypeScript game server.

In game, `::home` teleports to the world's configured spawn using the usual teleport restrictions.
`::staff` shows online staff and their ranks in a scroll. Press `Ctrl+;` to open `::teleports`
or `Ctrl+/` to open `::commands` while playing; page text fields keep their normal keyboard behavior.

## Packages

Content inventory, delivery evidence and agent update instructions:
[repository progress record](docs/progress/README.md).

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

### Local world settings

Create `server/data/definitions/world.local.json` with the settings you want to override from
`world.json`; omitted settings keep their shipped values. This file is gitignored, so local
customizations survive updates without changing tracked files. Restart the server after edits.
Every setting is listed in [docs/world-configuration.md](docs/world-configuration.md).

### Optional: Java sidecars

Two optional local services are Java; neither is needed to run the server.

| Command | What it enables | Setup |
| --- | --- | --- |
| `yarn bridge` | the in-game Quest Helper panel, from the upstream Java helper | **Java 21**, then the one-time build in [`tools/quest-helper-bridge`](tools/quest-helper-bridge/README.md) |
| `yarn gateway` | the official OSRS client through RSProx, playing on this server | [`runelite-gateway/README.md`](runelite-gateway/README.md) |

The bridge and server need the same `QUEST_HELPER_TOKEN` (at least 24 characters) in `.env`.
Without it, the panel reports that the server token is missing. Tutorial Island and Recipe for
Disaster still work because the server answers those itself. `QUEST_HELPER_URL` can point the
server at a bridge outside loopback, such as `http://quest-helper:16471`; it must be an HTTP(S)
URL without credentials, query parameters or a fragment. The default is
`http://127.0.0.1:${QUEST_HELPER_PORT:-16471}`.

## Publish your world

Create a server token at [RSPS.app](https://rsps.app/) under **Settings → Server tokens**, then add it to `.env` in the repository root:

```dotenv
WEBRTC_WORLD_ID=my-world
WEBRTC_WORLD_TOKEN=paste-your-token-here
```

Set `"name": "My World"` in `server/data/definitions/world.local.json` to choose the display name; it defaults to `Old School RuneScape`. This name is used by the login page, World list, welcome messages and bank title. The list also shows the `description` (up to 120 characters) and `spawn` from [`server/data/definitions/world.json`](server/data/definitions/world.json).

Run `yarn start`. Your world appears in the World list once it registers. Keep the token private.

### Browser client compatibility

The server announces its explicit wire protocol version before the existing welcome packet.
The browser client accepts a matching version and refuses a known mismatch before sending
login credentials. Worlds with no valid announcement remain accessible with a compatibility
warning; their version is unknown, even if they otherwise resemble a version 1 world.
Compatibility notices stay within the game area and disappear after three seconds. To hide
them, open Configuration → RSPS.app and turn off **Show protocol compatibility notices**.
This changes only the display; known mismatches still block login and explain the error.
The wire protocol version describes the compiled client/server packet format, not the OSRS
cache revision or an editable supported-version list. A mismatch notice shows both versions.
Existing clients can ignore the announcement on the existing plugin-message channel.

For an incompatible browser game wire change, increment the positive integer
`WIRE_PROTOCOL_VERSION` in both
`server/src/main/typescript/elvarg/net/protocol/WireProtocolVersion.ts` and
`client/network/serverConnection/protocolCompatibility.ts`, then rebuild and deploy both
packages. The focused server protocol test checks that the mirrored values agree. Source,
comments, gameplay changes and cache revisions alone do not change the protocol version.
The constants stay inside each package so the server's standalone build layout is preserved.
The optional native gateway retains its existing login behavior and ignores this announcement.

## Links

- [Discord](https://discord.com/invite/TCTDGVzejn) — questions, help and development chat
- [Progress](https://rsps.app/progress) — how much of OSRS is implemented, by category
- [Host a world](https://rsps.app/host)

## Credits

We want to thank Astrul/[@Lerl](https://github.com/Lerl), Detuks/[@Reinismu](https://github.com/Reinismu), Kraken/[@UnhealthyKraken](https://github.com/UnhealthyKraken), Vexus/[@Bandit-HaxUnit](https://github.com/Bandit-HaxUnit), [@xrsps](https://github.com/xrsps) and all the contributors of both the legacy Java project and the TypeScript continuation.

## Legal

This fan project is not affiliated with Jagex Ltd. Old School RuneScape and related assets and trademarks belong to their respective owners.
