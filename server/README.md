# Elvarg Web Server
 
 This is a TypeScript port of the the Java Server https://github.com/RSPSApp/elvarg-rsps. The goal of this server is to have a modular/plugin based RSPS built in typescript with some accurate OSRS content (Combat, minigames etc) and highly intelligent player bots. The server is designed to be extensible via plugins. Combat should stay core, but any new content e.g. special attacks and effects should bolt on as plugins.
 
## Getting started
 
 Firstly, run
 
 ```yarn install```
 
Then, run
 
```yarn dev```

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

## Plugins

Runtime plugins are loaded from:

`./plugins`

Current convention is one plugin per file.
Subdirectories are supported up to 2 levels deep under `./plugins`.

Each plugin should export:

`{ name: string, register(api) }`

Plugin API hooks and contracts are documented in:

`src/main/typescript/elvarg/plugins/PluginTypes.ts`

Hook registration/guard behavior is implemented in:

`src/main/typescript/elvarg/plugins/PluginManager.ts`
