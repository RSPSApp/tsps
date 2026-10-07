# Finding ids in the cache

Interface, sprite, enum, clientscript, animation and gfx ids come from the cache in
`server/caches`, never from guesswork or stale RSPS constants. The dump scripts exist so you
do not have to guess - each one documents its own output in its file header:

| Command | What it answers |
| --- | --- |
| `yarn dump:widget <groupId>` | Every component in an interface group: type, parent, sprite, text, and the CS2 listeners attached to it. |
| `yarn dump:cs2 <scriptId>` | Disassembles a clientscript - which varp/varbit renders a value, and whether a script will overwrite text the server sends. |
| `yarn dump:enum <enumId>` | A cache enum's key -> value pairs, for the lookup tables the client's own scripts read. |
| `yarn dump:seq [<seqId...>]` | Animation sequences: frame count/ids, priority and loop count - what an attack animation lookup needs. |
| `yarn dump:spotanim [<spotanimId...>]` | Graphics (spotanim) configs: the model and sequence each gfx plays. |
| `yarn dump:item-combat-styles` | Refreshes `data/definitions/item-combat-styles.json` from cache dbtable 78, preserving server-owned fields. |
| `yarn compare:cache <cache dir>` | What moves in another cache revision, matched by gameval name: interface components (and the literal `(group << 16) \| component` ids in our code that would point elsewhere) and DB table columns (and the files that mention each changed table). Read-only. |
| `yarn ensure-cache` | Downloads/validates the cache the above need. |

Typical flow for an interface:

1. Find the group/component name: the cache's own gamevals name them (`chatbox:chatmodal`),
   which is what rsprox prints in captures; RuneLite's generated `InterfaceID.java` too.
2. Confirm it against this cache with `yarn dump:widget <groupId>`.
3. If a value renders oddly, `yarn dump:cs2` the listener to see what drives it.

**Prefer feeding the varps/varbits a cache script already reads over writing component text
that the same script will overwrite a tick later.**

Item/NPC/object constants are generated from the live cache - regenerate with
`scripts/generate-identifiers.ts` rather than hand-editing (run `--dry-run` first: it reports
added/changed/removed names and keeps existing names stable), and `scripts/audit-identifiers.ts`
checks the names still match the cache.

## Gamevals

The OSRS cache carries Jagex's own names for its ids in index 24 (one archive per kind: objs,
npcs, locs, seqs, spotanims, varps, varbits, dbrows, and interfaces with their components).
`game/cache/Gamevals.ts` reads them: `componentName(uid)` / `componentId("chatbox:chatmodal")`,
`tableColumn(166, "hotspot")` for a DB table's column, and `namesOf(GamevalKind.SEQ)`. They are the names rsprox prints (`human_reachforladder`,
`slayertower_door`), so a capture maps straight onto ids.

## Updating the cache revision

The full procedure, and what 237 → 241 changed, is in [docs/cache-revision-update.md](../../../docs/cache-revision-update.md).

`target.txt` names the cache. Before moving to a newer one:

- Config and clientscript opcode meanings for the new revision: https://github.com/zwyz/osrs-cache
  (`data/commands/*.txt` for every CS2 command with its signature,
  `src/main/java/osrs/unpack/config/*Unpacker.java` for config opcodes).
- What changed in the client per revision: rsprot's `WHATSNEW.md` (https://github.com/blurite/rsprot).
- RuneLite's `cache` module (https://github.com/runelite/runelite, `cache/`) gets a
  "cache: rev N" commit with each revision's new config opcodes.
- Client scripts: regenerate the command signatures for the revision
  (`npx tsx scripts/cache/generate-command-signatures.ts <osrs-cache checkout> <revision>` in
  `client/`), then `npx tsx scripts/cache/cs2-sweep.ts [--compare <old cache dir>]`. It runs
  every script and lists instructions that leave the stacks unlike their signature, JavaScript
  errors in handlers, and script errors that are new since the old cache (scripts run with dummy
  arguments there, so read that list: most entries are cc_create on component 0).
- Interfaces: `npx tsx scripts/cache/interface-sweep.ts [--compare <old cache dir>] [--all]` in
  `client/` opens every interface as the game does (onLoad, then each transmit listener and
  timer once) and lists script errors and components showing item 0 or "null" text that the old
  cache didn't have; `*` marks interfaces our server opens. It found the 241 bank-tag icons.
- The client tests `cs2-opcode-coverage`, `cs2-script-sweep`, `interface-sweep`,
  `cache-config-decode` and `world-map-cache-format` hold the result.
- `yarn compare:cache <new cache dir>` for interface components and DB table columns that moved,
  and for the varps/varbits the code uses whose definition is gone or changed. Code reads table
  columns by number, so a column inserted mid-table shifts every later one. For each changed
  var it lists what the scripts that used it read now (rev 241: varbit 4398, the GE offer price,
  became long varp 5753; varbit 12377 `mouseover_text_enabled` became 10035
  `mouseover_text_disabled`, inverted). The code is read as written for the older cache: from a
  worktree already on the new cache, pass `--older <old cache dir> --code <checkout before the
  update>`.
- `scripts/generate-identifiers.ts --dry-run` for item/NPC/object names that moved or vanished.
- Data files: `yarn dump:item-combat-styles`, and fix `item-gameplay.json` entries whose name no
  longer matches the cache (the loader skips them). See "Server data files" in the playbook.
- Worktrees share `server/caches` through a symlink and `ensure-cache` rewrites `caches.json`
  for every one of them: try a new revision in a worktree with its own `server/caches`.
