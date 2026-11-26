# Quest Helper bridge

The Quest Helper plugin (`client/game/plugins/questhelper`) shows steps, highlights and puzzle
solutions computed by the real [Quest Helper](https://github.com/Zoinkwiz/quest-helper) Java
code (BSD-2, Zoinkwiz). This bridge compiles that code, pinned at `06da90f`, against RuneLite
`1.13.3`, and runs it headless on `127.0.0.1`.

The client sends read-only game snapshots through the server, which forwards them to the bridge.
The bridge calls the upstream helper lifecycle directly. It does not start QuestManager or Swing,
and it never changes game or quest state. Each session owns a fresh helper, event bus and
configuration.

## Build

From the repository root, `yarn bridge:setup` does all of this. It needs Java 21 and git, then
clones Quest Helper at the pinned commit and runs `installDist`. By hand:

```bash
git clone https://github.com/Zoinkwiz/quest-helper tools/quest-helper-bridge/quest-helper-upstream
git -C tools/quest-helper-bridge/quest-helper-upstream checkout 06da90f982518a093f2fe1c9cfac5547fa7053d3
cd tools/quest-helper-bridge && ./gradlew test installDist
```

- The build checks the checkout is at that commit and unmodified.
- To use a checkout elsewhere, set `QUEST_HELPER_SOURCE`.
- `gradle.lockfile` and `resolved-runtime.txt` pin the dependency set.

## Run

Once built, `yarn start` starts the bridge with the server. The server makes a token and picks a
free loopback port, and the bridge exits when the server does. It does this only when
`QUEST_HELPER_TOKEN` and `QUEST_HELPER_URL` are unset; `QUEST_HELPER_AUTOSTART=0` turns it off.

To run one bridge yourself, the bridge and the game server share a secret of at least 24
characters. From the repository root, `yarn bridge` reads `QUEST_HELPER_TOKEN` from `.env`, finds a JDK 21 and starts the built
install, so nothing has to be exported by hand:

```bash
yarn bridge
```

By hand (any JDK 21 on `PATH`, or `QUEST_HELPER_JAVA_HOME`):

```bash
export QUEST_HELPER_TOKEN=$(openssl rand -hex 32) QUEST_HELPER_PORT=16471
tools/quest-helper-bridge/build/install/offline-quest-helper-bridge/bin/offline-quest-helper-bridge
```

One bridge serves every worktree: sessions are per-request UUIDs, so nothing is shared between
them. The agent MCP's `quest_helper` tool drives this bridge headless — see
[server/docs/agents/quest-helper-testing.md](../../server/docs/agents/quest-helper-testing.md).

- Start the server with the same `QUEST_HELPER_TOKEN` (and `QUEST_HELPER_PORT`, if you changed it).
- Without the bridge, players see that Quest Helper isn't enabled on this world, and the server log says why. The native Tutorial Island and Recipe for Disaster routes still work, because the server provides them.
- By default the bridge binds only `127.0.0.1` and refuses other callers. `GET /health` is public. `GET /catalog`, `POST /evaluate` and `POST /close` need `Authorization: Bearer <secret>`. The browser never sees the secret.
- Requests are bounded to 4 MiB and 128 sessions (`QUEST_HELPER_MAX_SESSIONS`). A session nobody has evaluated for 30 minutes (`QUEST_HELPER_SESSION_IDLE_MS`) is stopped, so a world that went away without closing its sessions doesn't keep them.

## Shared bridge

A browser-hosted world (RSPS.app, `BROWSER_HOST=1`) runs its server in a WebContainer, which can't
run Java. It gets the full Quest Helper from one bridge that many worlds share; without one, its log
says so and players keep the Tutorial Island and Recipe for Disaster guides.

Run the built install on a host with JDK 21, behind an HTTPS reverse proxy on the same host:

```bash
export QUEST_HELPER_TOKEN=$(openssl rand -hex 32)   # the same value goes to every world
export QUEST_HELPER_SHARED=1 QUEST_HELPER_PORT=16471   # stays on 127.0.0.1; the proxy reaches it
export QUEST_HELPER_ALLOWED_ORIGINS='https://*.webcontainer-api.io'
export QUEST_HELPER_TRUST_PROXY=1
build/install/offline-quest-helper-bridge/bin/offline-quest-helper-bridge
```

Then give each world `QUEST_HELPER_URL=https://<bridge host>` and the same `QUEST_HELPER_TOKEN`.
For a browser-hosted world, the page that starts its WebContainer puts them in its environment.
The bridge a game server starts itself ignores these settings and stays private to that server.

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUEST_HELPER_SHARED` | off | `1` applies the shared limits below while bound to loopback, behind a local proxy. |
| `QUEST_HELPER_BIND` | `127.0.0.1` | Address to listen on. Any non-loopback address accepts other hosts and implies shared. Prefer loopback plus a proxy; if the port is reachable directly, don't set `QUEST_HELPER_TRUST_PROXY`. |
| `QUEST_HELPER_ALLOWED_ORIGINS` | none | Comma-separated origins allowed by CORS, exact or `http(s)://*.domain`. A WebContainer's requests come from the browser, so its origin must be here. |
| `QUEST_HELPER_RATE_PER_MIN` | 6000 shared, off otherwise | Requests per caller address per minute; more get 429. |
| `QUEST_HELPER_TRUST_PROXY` | off | `1` counts the last `X-Forwarded-For` hop as the caller. Set it only when every request comes through a proxy that appends it. |
| `QUEST_HELPER_THREADS` | 8 shared, 2 otherwise | HTTP worker threads. Shared bridges also drop requests that take over 30 s to arrive. |
| `QUEST_HELPER_MAX_SESSIONS` | 128 | Open sessions across every world. |
| `QUEST_HELPER_MAX_SESSIONS_PER_CALLER` | 32 shared, off otherwise | Open sessions one caller address may hold, so one world can't take every slot. |
| `QUEST_HELPER_SESSION_IDLE_MS` | 1800000 | Idle time before a session is stopped. |

- **The token isn't secret from hosts.** Every browser host's page can read the token it was given, so treat it as a shared key that stops casual use. The request limit and session caps are what bound the load.
- **One evaluation at a time.** The engine evaluates one step at a time for every world. If it falls behind, run more bridges behind the proxy, each world kept on one of them (sticky routing by caller address): sessions live in the bridge that opened them.
- **If the bridge is down,** players see that Quest Helper isn't enabled, the world's log names the bridge it couldn't reach, and the native guides still work.

## Protocol 1

**Evaluate request:** `{protocol:1, session, sequence, questKey, helperVariant?, snapshot, events:[], config?, lockSection?}`.
- `sequence` must increase.
- `config` holds flat upstream `QuestHelperConfig` keys with boolean or ARGB values (puzzle solutions, hints, colours).
- `lockSection` is `{section, locked}`, the sidebar's "mark section as complete" box.
- `bankTab: true` asks for the quest bank tab (sent while the bank is open, or near the Grand Exchange).

**Snapshot:**
- **Vars:** sparse nonzero `varps`, observed `varbits` (or `varbitDefinitions`), and `questStates`.
- **Player:** `inventory`, `equipment` and an optional `bank`; the local player and `skills`.
- **Scene:** `npcs`, `objects`, `groundItems`, the visible `widgets` tree, and cache definitions.
- **Geometry:** the browser camera's view-projection matrix and packed heights, for upstream's own overlays. `loadedTilesPacked` marks the tiles the client has built; the rest are absent from the scene.
- **Reuse (server only):** the browser sends `objects`, `widgets`, the definitions and the packed terrain once with `digests`, and afterwards names an unchanged section in `reuse` by digest; the server restores it before forwarding, and echoes the digests it holds as `cached` on each result. The bridge always receives a full snapshot.

Missing state produces `MISSING_STATE` with a structured request, and an unimplemented API produces `UNSUPPORTED_API`. Neither falls back to null or zero.

**Result:**
- The active step: text, requirements (pass, fail, partial or boost), NPC, object, item and tile targets.
- Dialogue choices and `choiceRules`, recommended items, teleports, inventory highlights, and the portable draw commands from upstream's custom overlays.
- `overview`: the QuestOverviewPanel contents.
- `sections`: the QuestStepPanel PanelDetails, with the current step and lock state.
- `pluginMessages`: the `PluginMessage("shortestpath", "path" | "clear")`s upstream's steps posted since the last evaluation, with WorldPoints as `{x, y, plane}`. Toggling `useShortestPath` calls the active step's `setShortestPath` or `disableShortestPath`, as QuestManager does.
- `bankTab` (when asked):
  - `sections`: upstream `QuestHelperBankTagService.getPluginBankTagItemsForSections(false)`, each item's `quantity`, `text`, `itemIds`, `displayId`, `details` and `met`.
  - `missingItems`: `itemsToTag`, for the Grand Exchange search.
- `activeStep.geItems`: the step's `getGeInterfaceIcon`, when it names any.
- `overlayPanel`: the QuestHelperOverlay lines.

**Catalog rows** carry difficulty, type, release, optimal and ironman order, quest points and skill-filter data.

## Catalog

`src/main/resources/catalog.json` maps the server's quests to upstream `QuestHelperQuest` routes. Regenerate it from the repository root:

```bash
QUEST_HELPER_SOURCE=tools/quest-helper-bridge/quest-helper-upstream node tools/quest-helper-bridge/scripts/generate_catalog.cjs
```

All 186 server quests map: 185 to Java routes, plus the native Tutorial Island route.

## Coverage

The tests initialise and evaluate all 193 Java variants and exercise 3,334 declared quest stages and 108 custom step classes. They write `coverage-*.json`. This is source and fixture coverage, not a claim that every branch or puzzle has been played live.

The upstream licence is in `UPSTREAM-LICENSE`; the build packages each source file's notice.
