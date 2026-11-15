# FAQ

## General

### Is there a hosted version I can play?

No. XRSPS is a self-hosted project — you clone the repo and run it locally. See the [Setup Guide](/setup) to get started.

### What cache version is supported?

Check `server/target.txt` for the current target. The cache is downloaded automatically from the OpenRS2 Archive.

### Where can I see what's being worked on?

The project roadmap and task tracking is on [Trello](https://trello.com/b/UjMvJYrl/xrsps).

### Can I contribute?

Yes. Fork the repo, make your changes, and open a pull request. Join the [Discord](https://discord.gg/3dzttF2q73) if you have questions.

## Plugins and game modes

### Where does gameplay code go?

In a plugin under `server/plugins/`. The server core (`server/src/main/typescript/elvarg/`) only holds foundations such as networking, sync and hook dispatch. Plugins reach core classes through `api.core`; see the [plugin guide](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/plugins.md#core-access).

### How do I change how my server plays?

With the world config: `server/data/definitions/world.json`, overridden by your own `world.local.json`. It sets the XP rate, drop rates, spawn point and world name, and turns plugins on and off. Game modes (Ironman, Leagues, PvP, free-to-play, Hardcore worlds) are plugins in `server/plugins/modes/`; a league or Hardcore world is turned on by its world config setting. See [World configuration](world-configuration.md).

### Where is player data stored?

By default in `server/data/saves/players.sqlite`, written by the `SqlitePlayerPersistence` plugin. A JSON backend (`server/data/saves/characters/`) and a browser (IndexedDB) backend are also included. See [Player saves](player-saves.md).

## Custom Content

### How do I add a custom item?

Add a row to `server/data/definitions/custom-items.json`. Custom items use IDs 50000+ and can copy everything from a cache item with `baseItemId`. See [Custom content](custom-content.md#custom-items).

### How does custom content reach the client?

In the `GAMEMODE_DATA` packet, sent at login. The client's `GamemodeContentStore` unpacks it and registers the items, models and interfaces into the client-side registries. See [Architecture — Custom Content](ARCHITECTURE.md#custom-content).

## Development

### How do varps and varbits work?

Varps are player variables. Varbits are bit-packed sub-variables within a varp. The server sets them, sends delta packets, and client-side CS2 scripts react to update widgets. This is the same system OSRS uses — no custom UI packets needed. See [Architecture](ARCHITECTURE.md#varps-and-varbits).
