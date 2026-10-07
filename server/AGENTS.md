# AGENTS.md

A TypeScript OSRS server. The TypeScript is the source of truth, and behaviour is judged
against live OSRS, never against another private server.

## Rules

1. **Plugins first.** Gameplay, content, QoL and overrides go in `plugins/`. Core is for
   foundations only (networking, entity lifecycle, sync, packets, hook dispatch) and gets
   generic hooks, never feature logic.
2. **Core through `api.core`.** Plugins never `require("../../src/main/typescript/...")`. If a
   class is missing from `api.core`, add it to `getCoreApi()` and `PluginCoreApi`.
3. **`register` is attach-only.** One line per hook, wired to a named module-level function.
   No logic, state setup or closures with bodies inside `register`.
4. **Hook by name.** `api.onObjectInteraction("Ladder", { "Climb-up": climbUp })`, not id
   lists. Where an id is unavoidable, use a named constant, never a bare number.
5. **Plugins talk through custom events.** `api.emitCustomEvent("domain:event", payload)` /
   `api.onCustomEvent(...)`. Never add a feature-specific hook or emit to `PluginManager`.
6. **Members content exports `members: true`**, or it leaks into free-to-play worlds.
7. **Area-scoped content is an `Area`**, registered with `api.registerArea`, not global
   `onPlayerProcess` / `onCanAttack` / `onCanTeleport` hooks that run for every player.
8. **Commands declare their rank:** `api.registerCommand("npc", spawnNpc, PlayerRights.OWNER)`.
   Handlers never check rights themselves.
9. **Ids come from the cache** (`yarn dump:widget`, `dump:cs2`, `dump:enum` ...), never from
   guesswork or old RSPS constants.
10. **Behaviour comes from the OSRS Wiki**; the cache wins on ids. Never cite another RSPS as
    justification - if RSPS code is your only source, say so in the PR.
11. **No new smoke scripts.** Extend an existing one, or say in the PR how you verified.
12. **Follow the pattern already in the module you touch.** Ask before deviating.
13. **No one-offs.** No single-item special cases, override layers or abstractions for one
    value. Edit the canonical data (`data/definitions/items.json`, `shops.json`) instead.
14. **Attribute keys** are kebab-case and namespaced (`warriors-guild:basement-unlocked`),
    declared once in a `*_ATTRIBUTE` constant.

## A plugin that follows them

```js
const LAST_PRAYED_ATTRIBUTE = "altars:last-prayed";

function prayAtAltar({ player }) {
  player.setAttribute(LAST_PRAYED_ATTRIBUTE, Date.now());
  ...
}

module.exports = {
  name: "Altars",
  register(api) {
    api.onObjectInteraction("Altar", { "Pray-at": prayAtAltar, Pray: prayAtAltar });
  },
};
```

## Read when the task touches it

| Topic | File |
| --- | --- |
| Plugin structure, splitting large plugins, events, members, commands | [docs/agents/plugins.md](docs/agents/plugins.md) |
| Area-scoped content (wilderness, minigames, boss rooms) | [docs/agents/areas.md](docs/agents/areas.md) |
| Finding ids: cache dump scripts, generated identifiers | [docs/agents/cache.md](docs/agents/cache.md) |
| Interfaces that don't exist in the cache | [docs/agents/interfaces.md](docs/agents/interfaces.md) |
| Where behaviour comes from, packet captures, reference codebases | [docs/agents/sources.md](docs/agents/sources.md) |
| Measuring performance before and after a change (MCP load + perf tools) | [docs/agents/perf.md](docs/agents/perf.md) |
| Checking behaviour in-game without a client (MCP test tools) | [docs/agents/testing.md](docs/agents/testing.md) |

Project layout: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Gamemode-independent
modules: [`docs/extrascripts.md`](../docs/extrascripts.md).
