# Architecture

XRSPS is a full-stack OSRS emulation engine. The client runs in the browser with React and WebGL. The server runs on Node.js with WebSocket networking. Both are written in TypeScript and share the same OSRS cache.

## Project Layout

The repository root contains the **`client/`**, **`server/`**, and **`docs/`** packages plus root scripts for setup and local development.

```
client/                 # @xrsps/client — browser CRA/craco app
  package.json
  craco.config.js
  public/
  scripts/cache/        # Cache export tooling
  common/               # Shared protocol/types (imported by server)
  game/                 # Game domains: chat, combat, ecs, login, input, sync…
  render/               # WebGL + overlays
  widgets/              # Widget tree, CS2 glue, GL widget draw
  components/           # React shell only
  network/              # Browser WebSocket client
  rs/                   # Cache loaders and OSRS engine code
  ui/                   # Canvas, menus, overlays

server/                 # @xrsps/server — Node WebSocket game server
  package.json
  caches/               # OSRS cache on disk (gitignored; downloaded via ensure-cache)
  scripts/              # ensure-cache, collision build, tooling
  tests/
  src/                  # Server core
  gamemodes/
  extrascripts/
  data/

docs/                   # @xrsps/docs — VitePress documentation
  package.json
```

Use `yarn setup` and `yarn start` from the repository root for local development. Package-specific commands can still be run from their package directory.

Shared protocol/cache code lives in `client/common` and `client/rs`; the server TypeScript project includes those paths.

### Where code lives

| Layer            | Directory                   | Purpose                                                                                                           |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Client**       | `client/`                   | Browser React + WebGL game client.                                                                                |
| **Server**       | `server/`                   | Node WebSocket game server.                                                                                       |
| **Docs**         | `docs/`                     | Architecture and contributor docs.                                                                                |
| **Engine**       | `server/src/`               | Tick loop, networking, collision, pathfinding, packet routing, player sync. Never references a specific gamemode. |
| **Gamemodes**    | `server/gamemodes/{id}/`    | Server identity — rules, progression, content handlers, providers. Each gamemode is a self-contained directory.   |
| **Extrascripts** | `server/extrascripts/{id}/` | Universal modules that work on any server regardless of gamemode.                                                 |
| **Common**       | `client/common/`            | Types, constants, and utilities used by both client and server.                                                   |

### Client code conventions

Adopted from our Vite site discipline, adapted for a game client:

- **File size:** Prefer **100–150** lines for app/domain code; **hard cap 400**. Exceptions: `client/rs/**` Jagex ports, generated/static data, opcode/ID tables, shaders.
- **`client/common`:** Non-UI code shared by **2+** domains (or by client + server). Prefer extending shared helpers over rewriting.
- **`client/components`:** React shell only. PascalCase folder = single component; lowercase folder = group with barrel; nested pieces under `ComponentName/components/`. Prefer `components/common` bases.
- **Game domains** (`game/`, `render/`, `widgets/`): lowercase folders for groups (`chat/`, `combat/`); PascalCase files for one class/module (`EnterToTypeChat.ts`). Groups may use `index.ts` barrels when stable.
- **Orchestrators stay thin:** `OsrsClient` and renderer facades wire explicit `*Deps`; feature logic lives in domain modules.

## Game Loop

The server runs a **600ms tick loop** — the same as OSRS. Each tick:

1. Tick NPCs (AI, combat, movement)
2. Tick players. Each player's turn starts with the client packets received since their last
   turn, so input acts on the next tick as in live OSRS. Only connection upkeep, login,
   client-plugin traffic, free movement and logout are handled as they arrive
   (`IMMEDIATE_PACKETS` in `net/NetworkBuilder.ts`).
3. Encode updates into binary packets
4. Send sync packets to all connected clients

The client receives `PLAYER_SYNC` and `NPC_INFO` packets each tick, decodes them, and renders the updated world state on the next frame.

## Networking

Communication is over **WebSocket** with a **binary protocol**. No JSON at runtime.

- Client packets: `client/common/network/ClientPacketId.ts`
- Server packets: `client/common/packets/ServerPacketId.ts`
- Message routing: `server/src/network/MessageRouter.ts`

Packets cover movement, interactions, widget clicks, combat, inventory, chat, and sync updates.

## Cache

Both client and server load the OSRS cache — the same binary format Jagex uses. It contains models, animations, maps, widgets, item definitions, NPC definitions, and more.

- **Server:** loads from disk via `initCacheEnv("caches")` (cwd = `server/`)
- **Client:** loads from IndexedDB (downloaded from CDN on first visit)
- **Loaders:** `CacheLoaderFactory` provides typed loaders (NPC types, obj types, loc types, animations, textures, etc.)

Cache files are stored in `server/caches/` (gitignored) and managed by `server/scripts/ensure-cache.ts`.

## Varps and Varbits

OSRS uses **varps** (player variables) and **varbits** (bit-packed sub-variables) to drive UI state. The server modifies varps, sends delta packets to the client, and client-side CS2 scripts react to the changes to update widgets.

This is how equipment panels, skill tabs, settings, and all widget state stays in sync — no custom UI packets needed.

## Actions

All player actions flow through the **ActionScheduler**:

1. Client sends an interaction packet
2. `MessageRouter` dispatches to the correct handler
3. Handler creates an action payload and queues it
4. On subsequent ticks, the scheduler executes the action
5. Type-specific handlers process it (`CombatActionHandler`, `SkillActionHandler`, etc.)
6. `EffectDispatcher` applies results (animations, XP drops, loot)

## Persistence

Player state is stored through a **`PersistenceProvider`** interface (`server/src/game/state/PersistenceProvider.ts`). This decouples storage from game logic — the server doesn't care whether data lives in SQLite, Postgres, or another backend.

The default implementation is `PlayerPersistence`, backed by `game.sqlite` in each gamemode directory under `server/data/gamemodes/{id}/`. The same database stores password hashes and durable trade escrow/refund records. Existing `player-state.json` and `accounts.json` files are imported once and retained as rollback backups.

### Save triggers

- **Login/logout** — saved immediately via `saveSnapshot()`
- **Autosave** — bulk save every 120 seconds via `savePlayers()`
- **Orphan expiration** — saved when a disconnected-in-combat player is removed

### What gets persisted

The `PlayerStateSerializer` (`server/src/game/state/PlayerStateSerializer.ts`) handles export/import of:

- Skills, hitpoints, location, orientation
- Inventory, equipment, bank (capacity, tabs, modes)
- Varps/varbits, combat settings, prayer, autocast state
- Equipment charges, degradation charges, collection log
- Gamemode-specific state (via `gamemode.serializePlayerState()`)

### Custom backends

To implement a custom backend, create a class that implements `PersistenceProvider`:

```typescript
import type { PersistenceProvider } from "./game/state/PersistenceProvider";

class SqlitePersistenceProvider implements PersistenceProvider {
    applyToPlayer(player, key) {
        /* load from db */
    }
    hasKey(key) {
        /* check if exists */
    }
    saveSnapshot(key, player) {
        /* write to db */
    }
    savePlayers(entries) {
        /* bulk write */
    }
}
```

Then swap it in at `server/src/network/wsServer.ts` where `PlayerPersistence` is constructed. No other code changes needed.

For backends that need setup/teardown (database connections), implement `ManagedPersistenceProvider` which adds optional `initialize()` and `dispose()` hooks.

## Custom Content

Gamemodes and extrascripts can define content that doesn't exist in the OSRS cache. The custom content pipeline handles registration, serialization, and client-side resolution automatically.

### Custom Items

`CustomItemRegistry` (`client/custom/items/`) stores item definitions keyed by ID (50000+). Items can clone properties from existing cache items via `basedOn` and override specific fields.

- **Server:** `ServerCustomItemRegistry` merges custom definitions with base cache lookups
- **Client:** `CustomObjTypeLoader` wraps the base `ObjTypeLoader` and injects custom items transparently

### Custom Widgets

`CustomWidgetRegistry` (`server/src/game/scripts/`) stores widget group definitions that don't exist in the cache.

### Delivery

Custom content reaches the client via the **gamemode content data packet** (`getContentDataPacket()` on `GamemodeDefinition`). The engine calls this during login and sends the result over WebSocket. The client unpacks it in `GamemodeContentStore` and re-registers items/widgets into their respective client-side registries.

This is a generic pipeline — any gamemode can use it to deliver arbitrary datasets alongside custom items and widgets.

## Content Systems

All gameplay content (skills, combat, shops, UI, etc.) is registered through the **script system** via `ScriptRegistry`. Content is organized into [Gamemodes](gamemodes.md) (server identity and rules) and [Extrascripts](extrascripts.md) (universal modules).

### Gamemode Hierarchy

```
BaseGamemode (abstract — OSRS defaults, no content)
  └─ VanillaGamemode (banking, shops, combat providers, skills, widgets)
       └─ LeaguesVGamemode (league-specific rules and content)
       └─ YourGamemode (extend vanilla, override what you need)
```

`BaseGamemode` (`server/src/game/gamemodes/BaseGamemode.ts`) provides sensible defaults for every `GamemodeDefinition` hook — 1x XP, Lumbridge spawn, no tutorial, standard drop rates. It registers no content.

`VanillaGamemode` (`server/gamemodes/vanilla/index.ts`) extends BaseGamemode with the full OSRS experience: banking, shops (via `ShopService`), equipment, all 13 global combat/spell providers, skill implementations, and UI widget handlers. Complex subsystems are extracted into dedicated service classes (e.g. `ShopService` wraps `ShopManager` + server integration) so the gamemode index stays thin.

Most community gamemodes should extend `VanillaGamemode` and override what they need. See [Gamemodes](gamemodes.md) for details.

### Script Loading

At startup, the bootstrap pipeline:

1. Resets the script registry
2. Calls `gamemode.registerHandlers()` (registers all gamemode content)
3. Discovers and loads all extrascripts (registers universal content)

Extrascripts are loaded after the gamemode, so they can complement but not replace gamemode handlers.
