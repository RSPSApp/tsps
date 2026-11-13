# Elvarg Web Server
 
 This is a TypeScript port of the the Java Server https://github.com/RSPSApp/elvarg-rsps. The goal of this server is to have a modular/plugin based RSPS built in typescript with some accurate OSRS content (Combat, minigames etc) and highly intelligent player bots. The server is designed to be extensible via plugins. Combat should stay core, but any new content e.g. special attacks and effects should bolt on as plugins.
 
## Getting started
 
 Firstly, run
 
 ```yarn install```
 
Then, run
 
```yarn dev```

## Contributing bug fixes

After setup, open the repository in your coding agent and use the
[repo-owned bugfix skill](../.agents/skills/tsps-bugfix-loop/SKILL.md). Sample prompt:

```text
Read .agents/skills/tsps-bugfix-loop/SKILL.md and follow it.
Pick a quick, unclaimed bug, fix and verify it in your own worktree,
and open a PR ready for review. Stop after that issue.
```

Use your own tools and GitHub account; without push access, return a verified patch.
For continuous work, replace the last sentence with “Keep fixing quick, unclaimed
bugs until I ask you to stop.”

## Player persistence

Player saves are stored in `data/saves/players.sqlite`. On startup, JSON character
files from `data/saves/characters` are imported by default without modifying the
source files. Set `PLAYER_SAVE_IMPORT_LEGACY_JSON=0` (also accepts `false`, `off`,
or `no`) to skip that import; restart the server after changing the setting.

`PLAYER_SAVE_DATABASE_PATH` and `LEGACY_PLAYER_SAVE_DIRECTORY` optionally override
the database and legacy-save locations.

## Edit mode API

In development, `plugins/world/EditModeApi.plugin.js` serves read-only world data
at `/api/world` on the game server's HTTP/WebSocket port. The local map editor
uses its game connection address to fetch this data. Production does not register
this endpoint. `/api/world/object-spawns` provides the canonical document for
local editing; export downloads the edited JSON file.
`/api/world/npc-spawns` supplies the persisted spawns the editor renders, and
saved spawn edits download as `npc-spawns-custom.json` (added spawns, moved
spawns and `remove` markers), which the server merges over the canonical file.
Browser-host editors continue using host messaging.

## Definition plugins

Plugins contribute definition records through
`api.registerDefinitionSource(type, { name, priority, load })`. The matching
core `DefinitionLoader` validates and merges those sources into its canonical
definition collection; API routes read that collection rather than invoking
plugin loaders or reading files themselves.

Plugins can register basic NPC actions declaratively without installing a
general NPC click hook:

```js
api.registerNpcInteraction([506, 512], {
  firstClick: { shopId: 0 },
  secondClick: { teleportLocation: { x: 3200, y: 3200, z: 0 } },
});
```

Use `onNpcInteraction` for stateful or otherwise scripted interactions.

## Custom shops

`data/definitions/custom-shops.json` holds the shops behind `::shops` and the host
editor's custom shops. Each record can set:

- `name` and `currency` (`COINS` when omitted; other keys are registered by plugins).
- `stockAmount`, the default amount for `originalStock` rows that omit `amount`.
- `defaultRestockTicks`, how often one item restocks or destocks (one tick is 0.6s).
- `originalStock` rows with `id`, optional `amount`, `restockTicks` and `price`.
- `prices`, an item-ID map of overrides; `-1` or a missing entry uses the item's default price.
- `npcInteractions`, the NPC options that open the shop.

## Custom items without cache packing

Add records to `data/definitions/custom-items.json`. Each record has a stable
`id` (50000–65022), a cache `baseItemId`, client appearance/menu overrides in
`objType`, and optional server gameplay overrides in `itemDef`. The base item
supplies equipment type, bonuses, requirements and animations. Use existing
cache model IDs for recolours, or list external models in `models`:

```json
"models": {
  "1000000": "dragonic-katana/drop.dat",
  "1000001": "dragonic-katana/equip.dat"
}
```

Paths are relative to `data/models`; external model IDs start at 1000000.
Set `objType.model` for inventory/ground rendering and `maleModel`/`femaleModel`
for equipment. Clear inherited secondary models and recolours when replacing
the entire model. Inventory framing (`zoom2d`, angles and offsets) and wearable
offsets remain configurable for calibration.

Dialogue helmets use separate native head models, not the wearable body models.
In an existing helmet record, keep its `id`, `baseItemId` and other properties;
for example, add the following head assets and `objType` fields (the `.dat`
files are your own models under `data/models`):

```json
"models": {
  "1000100": "my-helmet/male-chathead.dat",
  "1000101": "my-helmet/female-chathead.dat"
},
"objType": {
  "name": "My helmet",
  "maleHeadModel": 1000100,
  "maleHeadModel2": -1,
  "femaleHeadModel": 1000101,
  "femaleHeadModel2": -1
}
```

`maleHeadModel2` and `femaleHeadModel2` are optional secondary head parts;
`-1` clears an inherited secondary part. Use head geometry suited to dialogue,
and choose unused external model IDs for your assets. These fields already use
the normal custom-item delivery and native chathead renderer; no cache packing
or additional JSON field is needed.

Restart the server and reconnect after editing. Definitions and compressed
model bytes are delivered before the initial appearance/inventory updates;
the client and render workers use them ahead of cache assets. Each compressed
model packet and the definition packet must fit the transport's 64 KiB frame.
New textures and animations are not streamed by this item mechanism.

The bundled **Dragonic katana** is item `50000`, with dragon scimitar gameplay
stats. An authorised administrator can test it with `::item 50000 1`, then
wield it or drop/pick it up. Model attribution is in
`data/models/dragonic-katana/README.md`.

## Logging

Server logging is centralized and all `console.log/info/warn/error/debug` calls go through one logger.

Log filename convention:

`kebab-case semantic-name.log`

Logs are written to:

`./logs/server.log`
`./logs/packets.log`
`./logs/movement.log`
`./logs/player-bots.log`
`./logs/plugin-performance.log`
`./logs/player-update-bits.log`

### Default behavior

1. Enabled levels: `info,warn,error`
2. Disabled type: `plugin` (plugin chatter is off by default)

### Configure at startup (env vars)

1. `LOG_LEVELS`  
Example: `LOG_LEVELS=warn,error`
2. `LOG_ENABLED_TYPES`  
CSV allowlist. If set, only these types are emitted.
3. `LOG_DISABLED_TYPES`  
CSV denylist.

Type is inferred from the first bracket tag in a message:

1. `[plugin:Woodcutting] ...` -> `plugin`
2. `[packet.out] ...` -> `packet.out`
3. `[plugins] ...` -> `plugins`
4. No bracket prefix -> `general`

### Change logging at runtime (no restart)

Developer-only in-game commands:

1. `::logstatus`
2. `::loglevels debug,info,warn,error`
3. `::logtypeon plugin,packet.out,world`
4. `::logtypeoff plugin,packet.out,world`
5. `::logtypeclear [enabled|disabled|all]`

## Debugging connection state

You can query live connected players from the web client by typing:

```::players```

Aliases:

```::online```
```::who```

The server will reply with the online player count and usernames.

## Disconnect cleanup behavior

The server now performs explicit cleanup when a WebSocket closes:

1. Removes the player from the add queue (if they disconnected before full world registration).
2. Queues the player for world removal.
3. Forces queued removal if the underlying transport is already closed.

This prevents stale "ghost" players from remaining visible after disconnects/refreshes.

## World config page

The local panel edits world settings and plugin options, lists players and their saves,
and lets you browse and upload plugins. Its Tools section links to the map and cache editors
on this worktree's client port. `yarn dev:panel` enables the cache editor's loopback-only
authoring service by default; set `CACHE_EDITOR_ENABLED=0` to disable writes. Saved cache
overlays take effect after the server restarts. Settings are saved in
`data/definitions/world.local.json`.
When launched with the root `yarn start`, the panel also provides Start, Stop and Restart
controls and stays available while the game server is stopped. The panel bundle is built from
`rsps-website/host-local`
and ships in `plugins/tools/worldadmin/panel/`. At startup the server prints the URL and where the token is, never the token
itself (logs end up in `server.log` and journald):

```
[world-admin] world config page: http://localhost:49600/?token=<token from data/definitions/world-admin.token>
```

Open `http://localhost:<port>/?token=<token from that file>` in a browser. The token is
generated once and kept in the gitignored `data/definitions/world-admin.token`, so the link
(and the page's cookie) stays valid across restarts until that file is deleted: treat the link
and the file like a password, and delete the file to get a new token. `WORLD_ADMIN_TOKEN` in
`.env` wins over the file; the log then names it instead of the file. The link sets a cookie
and the page then works without it. The page listens on `WORLD_ADMIN_PORT` (default 49600;
each `scripts/wt` worktree gets 49600 + its slot), bound to 127.0.0.1, so on a VPS reach it
through an SSH tunnel and open that URL locally:

```bash
ssh -L 49600:127.0.0.1:49600 <host>
```

`WORLD_ADMIN_BIND` (for example `0.0.0.0`) opens the listener to other machines only when
`WORLD_ADMIN_TOKEN` is set to at least 24 characters of `A-Z a-z 0-9 _ -`; otherwise the server
logs why and stays on 127.0.0.1.

Saving shows a preview of the change first. Under nodemon (`yarn dev`, `yarn start`,
`dev:stress`, or nodemon run by hand in `server/`, which reads `nodemon.json` and its
`TSPS_RESTARTER=nodemon`) the server saves players, writes the file and restarts (nodemon brings
it back); with players online the normal
world-update countdown runs first and can be cancelled from the page. Under a supervisor set
`TSPS_SUPERVISED=1` (the server exits with code 75 so on-failure restart policies restart it).
Otherwise the page only writes the file and you restart by hand. The page is not started when
`BROWSER_HOST=1`.

## Plugins

Runtime plugins are loaded from `./plugins`. In the local panel, **Plugins → Browse plugins**
lists releases from the TSPS Plugins catalogue. Select **Install** to fetch a release
directly, or use the download icon and **Upload plugin ZIP** for manual installation.
The panel stores the package under
`plugins/imported/` and the server loads it on restart. Use the **×** beside an
uploaded plugin to delete its package files. Restart the server to unload any running
plugin code. Plugin ZIPs contain server-side JavaScript, so only upload packages from
authors you trust.

The native OSRS Character Summary is shown by default. To enable the custom summary,
merge this into `data/definitions/world.local.json` (or `world.json`) and restart:

```json
{ "plugins": { "CustomCharacterSummary": true } }
```

Unset or false keeps the native summary, including when legacy `disabledPlugins`
is present. The saved combat-XP toggle choice is retained but inactive while the custom
feature is off; enabling it again restores that choice.

Current convention is one plugin per file.
Subdirectories are supported up to 2 levels deep under `./plugins`.

Each plugin should export:

`{ name: string, register(api) }`

Plugin API hooks and contracts are documented in:

`src/main/typescript/elvarg/plugins/PluginTypes.ts`

Hook registration/guard behavior is implemented in:

`src/main/typescript/elvarg/plugins/PluginManager.ts`
