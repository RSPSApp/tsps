# Contributing

## Purpose

This is a TypeScript OSRS server. The TypeScript is the source of truth - there is no Java
in this repository and no Java project to port from. If you find code that looks like a
literal 317-era transliteration, that is a bug to fix, not a pattern to follow.

New behaviour is judged against live OSRS, not against any RSPS.

## Source-of-Truth Order

When behaviour is unclear, resolve in this order:

1. **OSRS Wiki** - gameplay intent, drop tables, requirements, mechanics:
   <https://oldschool.runescape.wiki/> (see also
   [Category:Game mechanics](https://oldschool.runescape.wiki/w/Category:Game_mechanics))
2. **osrsindex** - ids, definitions, cross-referenced cache data: <https://osrsindex.com/>
3. **OpenRune** - cache formats, tooling, definition layouts: <https://openrune.dev/>
4. **RuneLite** - client-side truth. Packet/opcode shapes, `gameval` id constants
   (`InterfaceID`, `VarbitID`, `VarPlayerID`, `ItemID`), and how the real client reacts to
   what the server sends.
5. **This server's own cache** - the final authority on ids and interface layout, read with
   the dump scripts below.

If a source conflicts with the cache in `server/caches`, the cache wins - it is what the
client actually loads. If sources conflict on behaviour, prefer the Wiki.

Do not cite another private server as justification. If a behaviour can only be found in
RSPS code, say so explicitly in the PR so it can be checked.

## Plugin-First Rule

- All gameplay features, content systems, QoL behaviour and overrides go in `plugins/` by
  default.
- Core server code stays foundational: networking, entity lifecycle, synchronisation,
  packet decode/encode, hook dispatch.
- If a change is not foundational, it probably belongs in a plugin.
- Prefer composable plugin hooks over hardcoded branching in core systems.

### PluginManager

`PluginManager` holds shared guardrails and hook plumbing, nothing per-feature. Keep
validation and safety checks centralised in its emit/register paths so plugins stay simple.
Do not add feature-specific logic to it unless it is genuinely generic hook infrastructure.

### Cross-Plugin Events

Plugins talk to each other only through the generic custom-event API, never through a
feature-specific hook or emit method added to `PluginManager`. A bespoke
`onSlayerAssignRequest` / `emitSlayerAssignRequest` pair is exactly the hardcoded event
this rule bans - use `onCustomEvent` / `emitCustomEvent` instead.

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

## Plugin Shape

`register` is **attach-only**. It wires hook names to handlers and does nothing else - no
logic, no state setup, no inline closures with bodies in them. Handlers are named functions
declared at module scope, so they are readable, reusable and greppable.

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

Reading `register` should tell you everything the plugin hooks, in one screen.

### Name-Based Hooks

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

### Command Rights

Commands are rights-checked by the core, never by the handler. Pass the lowest rank that
may run the command as the third argument to `registerCommand`; rights ids are ordered
(none < moderator < administrator < owner < developer) so everyone above it passes too.
Omit it and any player may run it. A handler that opens with "am I an admin?" is a bug.

```js
api.registerCommand("npc", spawnNpc, PlayerRights.OWNER); // owner and developer
api.registerCommand("players", listPlayers);              // anyone
```

`api.setCommandRights(command, minimumRights)` overrides whatever a command registered
with, so a plugin can widen or narrow someone else's command - a spawn mode opening
`::items` to everyone passes `PlayerRights.NONE`.

## Cache Lookup Tooling

Interface, sprite, enum and clientscript ids come from the cache in `server/caches`, never
from 317-era RSPS code. The dump scripts exist so you do not have to guess - each one
documents its own output in its file header:

| Command | What it answers |
| --- | --- |
| `yarn dump:widget <groupId>` | Every component in an interface group: type, parent, sprite, text, and the CS2 listeners attached to it. |
| `yarn dump:cs2 <scriptId>` | Disassembles a clientscript - which varp/varbit renders a value, and whether a script will overwrite text the server sends. |
| `yarn dump:enum <enumId>` | A cache enum's key -> value pairs, for the lookup tables the client's own scripts read. |
| `yarn ensure-cache` | Downloads/validates the cache the above need. |

Typical flow for an interface:

1. Find the group/component name in RuneLite's generated `InterfaceID.java`.
2. Confirm it against this cache with `yarn dump:widget <groupId>`.
3. If a value renders oddly, `yarn dump:cs2` the listener to see what drives it.

**Prefer feeding the varps/varbits a cache script already reads over writing component text
that the same script will overwrite a tick later.**

Item/NPC/object constants are generated from the live cache - regenerate with
`scripts/generate-identifiers.ts` rather than hand-editing, and `scripts/audit-identifiers.ts`
checks the names still match the cache.

## Tests

**Do not add a new per-feature smoke script.** The repo already carries ~75 of them and
~70 matching `test:*` entries in `server/package.json`; none run in CI, most have never run
twice. Another one adds a maintenance burden and proves nothing.

Instead:

- Extend an existing smoke script that already covers the area you touched.
- If nothing covers it, say in the PR how you verified the change (in-game steps, dump
  output, log excerpt).
- Removing a dead smoke script and its `package.json` entry is a welcome PR on its own.

## Server-Defined Interfaces

An interface that does not exist in the cache is defined entirely by the server. A plugin
registers one definition - the widget group plus the behaviour the client drives it with -
and it becomes an addressable resource:

    api.registerCustomInterface({ groupId, widgets, search, list, status, hint })
    -> GET /api/interfaces/<groupId>

The client fetches it the first time that group is opened, so opening one only needs the
usual sub-interface packet. `widgets/custom/CustomInterfaceRuntime.ts` reads the behaviour
half and owns focus, keystrokes, scrolling and slot binding; see
`plugins/interface/Commands.plugin.js` for a worked example.

Row data is a separate resource, registered with
`api.registerContentEndpoint(name, handler)` and served at `/api/<name>`. Use it for
request/response shaped, cache-derived data - searches, lists, lookups.

Rules for both:

- Read-only and public. Anything player-specific or privileged stays on the game socket,
  where the session is already authenticated.
- Responses carry an ETag and revalidate to 304, so definitions are fetched once per build
  rather than pushed on every open.
- The first open of a session waits on a fetch. Updates sent in the same batch are held by
  the client and applied once the widgets exist, so an interface can be populated straight
  after opening it.

Adding an interface of this kind should need no client change. If it does, the missing
capability belongs in the runtime as a declared option, not in a feature-specific module.

## Coding Conventions

- Prefer enums/constants over magic numbers.
- Do not hardcode semantic ids when a named symbol exists (rights, opcodes, states,
  interface ids, item/npc/object ids).
- If a constant does not exist yet, add one in the appropriate shared module instead of
  repeating raw numbers.
- Derive from the cache where the cache knows the answer. A rule that reads definitions
  (`plugins/objects/Doors.plugin.js` builds its open/closed pairs this way) beats a
  hand-picked id list that only covers what someone happened to test.

## Pattern Consistency

- Follow the existing implementation pattern in the module/domain you are changing.
- Prefer updating canonical data/config sources (`data/definitions/items.json`,
  `shops.json`) over adding runtime override maps or one-off adapter code.
- No single-item special-case paths, temporary override layers, or new abstractions for one
  value unless explicitly requested.
- Keep changes incremental and isolated. Avoid large rewrites of core systems unless asked.
- If a requested change appears to require a pattern deviation, stop and confirm before
  implementing.

## Practical Decision Rule

If in doubt:

1. Implement it in a plugin.
2. Hook it by name, handler outside `register`.
3. Read the cache before hardcoding an id.
4. Base behaviour on the OSRS Wiki, confirm against the cache.
5. Keep hook contracts generic and guards centralised in core hook dispatch.

See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for project layout and
[`docs/extrascripts.md`](../docs/extrascripts.md) for gamemode-independent modules.
