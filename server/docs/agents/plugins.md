# Plugins

Detail behind the plugin rules in [AGENTS.md](../../AGENTS.md).

## What goes where

- All gameplay features, content systems, QoL behaviour and overrides go in `plugins/` by
  default.
- Core server code stays foundational: networking, entity lifecycle, synchronisation,
  packet decode/encode, hook dispatch.
- If a change is not foundational, it probably belongs in a plugin.
- Prefer composable plugin hooks over hardcoded branching in core systems.

`PluginManager` holds shared guardrails and hook plumbing, nothing per-feature. Keep
validation and safety checks centralised in its emit/register paths so plugins stay simple.
Do not add feature-specific logic to it unless it is genuinely generic hook infrastructure.

## Core access

Core classes and helpers are exposed on the shared, frozen `api.core` object (built once by
`PluginManager.getCoreApi()`):

```js
module.exports = {
  name: "Example",
  register(api) {
    const { Animation, ItemIdentifiers, Skill } = api.core;
    ...
  },
};
```

- If a class you need is missing from `api.core`, add it to `getCoreApi()` and
  `PluginCoreApi` - never add the relative require.
- Relative requires between files inside the same plugin directory are fine (that is plugin
  code, not core): `require("./specials/AbyssalWhip.SpecialAttack")`.
- Existing core relative requires in plugins are legacy. Converting one to `api.core` is a
  welcome cleanup.

## Shape: `register` is attach-only

It wires hook names to handlers and does nothing else. Handlers are named functions declared
at module scope, so they are readable, reusable and greppable. Reading `register` should tell
you everything the plugin hooks, in one screen.

```js
// good
function prayerAltar({ player }) {
  ...
}

module.exports = {
  name: "Altars",
  register: (api) => {
    api.onObjectInteraction("Altar", { "Pray-at": prayerAltar, Pray: prayerAltar });
  },
};
```

```js
// bad - logic buried in register
register: (api) => {
  const cache = new Map();
  api.onObjectInteraction("Altar", {
    "Pray-at": ({ player }) => {
      /* twenty lines */
    },
  });
};
```

## Splitting large plugins

When a plugin covers many independent units (one weapon special per weapon, one quest per
quest), it is a registration list, not a home for all of them. Keep the top-level file thin
and give each unit its own file in a folder named after the plugin:

- The folder sits next to the plugin and is lowercase: `SpecialAttacks.plugin.js` keeps its
  units in `./specials/`.
- Files end with the plugin name, singular where that reads better:
  `AbyssalWhip.SpecialAttack.js`, `DragonClaw.SpecialAttack.js`.
- Each file exports an attach function that takes `api` and calls `api.register*` itself.

Delegation lines are the one allowed addition to `register`:

```js
// plugins/combat/SpecialAttacks.plugin.js
module.exports = {
  name: "SpecialAttacks",
  register(api) {
    require("./specials/AbyssalWhip.SpecialAttack")(api);
    require("./specials/DragonClaw.SpecialAttack")(api);
    // one line per unit
  },
};
```

See `plugins/combat/SpecialAttacks.plugin.js` and `plugins/combat/specials/` for the
canonical example.

## Name-based hooks

Use the name-based overloads wherever they exist. They read as the game reads, and they
cover every id the cache gives that name - including variants a hand-written id list will
always miss.

```js
api.onObjectInteraction("Ladder", { "Climb-up": climbUp });
api.onNpcInteraction("Banker", { Collect: openCollectionBox });
api.onItemAction("Spade", { Dig: dig });
api.onItemOnObject("Knife", "Web", slashWeb, { noted: false });
```

Fall back to raw ids only when the name is genuinely ambiguous or the behaviour is
id-specific (a single transformed variant, for example). When you do, use a named constant
from `IdEnums` / the generated identifier files, never a bare number.

## Cross-plugin events

Plugins talk to each other only through the generic custom-event API. A bespoke
`onSlayerAssignRequest` / `emitSlayerAssignRequest` pair on `PluginManager` is exactly the
hardcoded event this rule bans.

```js
// emitter: a mutable payload is the reply channel
const request = { player, npcId, line: null };
api.emitCustomEvent("slayer:assignment", request);
if (request.line) { /* use request.line */ }

// listener
api.onCustomEvent("slayer:assignment", (request) => {
  request.line = "...";
});
```

- Names are namespaced `domain:event` (`slayer:assignment`, `duelarena:validate-winnings`,
  `mining:success`).
- `emitCustomEvent` is synchronous and fire-and-forget; it returns nothing. A handler that
  answers back mutates the payload it was given (`request.line`, `event.accept`,
  `event.handled`), and the emitter reads it straight after.
- The emitter owns the event name and payload shape; the listener owns the handler. Adding
  a new cross-plugin interaction means a new event name, not new `PluginManager` surface.

## Members content

Every plugin whose content is members-only in OSRS (members skills, areas, bosses, minigames,
members items) must export `members: true`. When world.json sets `"membersWorld": false`,
`PluginManager` skips those plugins entirely.

- Check the OSRS wiki page's "Members" field when unsure; F2P content (e.g. Castle Wars,
  Emir's Arena, Obor) stays untagged.
- Quests are not plugins: add members quests to `QUESTS` only and free-to-play ones to
  `F2P_QUESTS` as well, in `plugins/quests/Quests.plugin.js`.
- Members gating that a whole-plugin skip can't express (items, XP, spawns, shop stock, areas)
  lives in `plugins/modes/FreeToPlay.plugin.js` via the `onCan*` hooks, not in core.

## Command rights

Commands are rights-checked by the core, never by the handler. Pass the lowest rank that
may run the command as the third argument to `registerCommand`; rights ids are ordered
(none < moderator < administrator < owner < developer) so everyone above it passes too.
Omit it and any player may run it.

```js
api.registerCommand("npc", spawnNpc, PlayerRights.OWNER); // owner and developer
api.registerCommand("players", listPlayers);              // anyone
```

Give commands a description as the fourth argument. The Commands interface reads the live
registry and filters it using the same permissions as command execution:

```js
api.registerCommand("tele", teleport, api.core.PlayerRights.OWNER, "Teleport to coordinates (x y [z])");
api.getRegisteredCommands(player); // [{ command: "tele", description: "..." }, ...]
```

`api.setCommandRights(command, minimumRights)` overrides whatever a command registered
with, so a plugin can widen or narrow someone else's command.

World owners set ranks without a plugin through world.json `pluginConfig`
`"commands:permissions"`, a map of command name (no `::`) to a `PlayerRights` name. It
wins over both of the above:

```json
"pluginConfig": { "commands:permissions": { "items": "NONE", "teleports": "OWNER" } }
```

## Conventions

- Do not hardcode semantic ids when a named symbol exists (rights, opcodes, states,
  interface ids, item/npc/object ids). If a constant does not exist yet, add one in the
  appropriate shared module instead of repeating raw numbers.
- Attribute keys are kebab-case, namespaced with `:` (`warriors-guild:basement-unlocked`,
  `pvp:open-presets-on-death`, `blast-furnace`). Declare each key once in a `*_ATTRIBUTE`
  constant and read/write through it; item `getMetaValue`/`setMetaValue` keys follow the
  same rule.
- Derive from the cache where the cache knows the answer. A rule that reads definitions
  (`plugins/objects/Doors.plugin.js` builds its open/closed pairs this way) beats a
  hand-picked id list that only covers what someone happened to test.
- Keep changes incremental and isolated. Avoid large rewrites of core systems unless asked.
- Removing a dead smoke script and its `package.json` entry is a welcome PR on its own:
  ~75 exist, none run in CI, and most have never run twice.
