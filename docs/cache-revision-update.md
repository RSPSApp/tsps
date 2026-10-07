# Updating the cache revision

How the OSRS cache was moved from revision 237 to 241, written as a playbook for the next update.
The first half is the procedure and its tools; the second half records what 241 changed, what
broke, and how each problem was found, because the same kinds of change come back.

## Playbook

### 1. Work in a separate worktree with its own cache

`server/caches` is a symlink shared by every worktree, and `yarn ensure-cache` rewrites
`caches.json` for all of them. Give the update worktree a real `server/caches` directory, set
`server/target.txt` to the new cache (`osrs-<revision>_<date>`), and run `yarn ensure-cache` there.
Run the server and the client from that same worktree (see the client `node_modules` note in
`server/docs/agents/cache.md`).

### 2. Read what the revision changed

| Source | What it gives |
|---|---|
| [zwyz/osrs-cache](https://github.com/zwyz/osrs-cache) | Every CS2 command with its signature per revision (`data/commands/*.txt`, lines tagged with a revision override older ones) and every config opcode (`src/main/java/osrs/unpack/config/*Unpacker.java`) |
| [RuneLite](https://github.com/runelite/runelite) `cache/` | A "cache: rev N" commit with each revision's new config opcodes |
| [rsprot](https://github.com/blurite/rsprot) `WHATSNEW.md` | Protocol changes per revision (long varps, GE prices, ...) |
| rsprox captures | What a live server sends; ids are checked against the cache |

### 3. Identifiers

`npx tsx scripts/generate-identifiers.ts --dry-run` (in `server/`) first, then without `--dry-run`.
Names stay on the ids they had: an id that lost its display name keeps its constant, and a name the
committed file gave another id is never reused (a renamed id drops its constant and fails to
compile, rather than silently pointing at something else). Fix the compile errors by name.

### 4. Compare the two caches: `yarn compare:cache`

```bash
# from a worktree still on the old cache
yarn compare:cache <new cache dir>
# from the new worktree, auditing the code as it was before the update
yarn compare:cache <old cache dir> --older --code <checkout before the update>
```

It lists, old to new:

- interface components that moved or are gone, and literal `(group << 16) | component` in code;
- DB table columns that moved (code reads columns by number);
- every varp/varbit the code uses whose definition is gone or changed, with what the scripts that
  used it read now. A varbit that only moved bits under the same name is harmless while it is set
  by id.

The code is read as written for the older cache: scanning code that is already migrated reports
the migrated ids as wrong, hence `--code`.

### 5. Config decoders

The client test `cache-config-decode` decodes every config entry (items, NPCs, locs, sequences,
spot animations, enums, structs, varcs, ...) and fails on an unknown opcode or an entry that does
not end where its bytes do. The normal decoder treats a dat2 overflow as the end of an entry, so a
new opcode with a payload otherwise misreads silently. Add the opcode from zwyz/RuneLite.

### 6. Client scripts

```bash
cd client
npx tsx scripts/cache/generate-command-signatures.ts <osrs-cache checkout> <revision>
npx tsx scripts/cache/cs2-sweep.ts [--compare <old cache dir>]
```

- `rs/cs2/CommandSignatures.ts` is generated: what every command pops and pushes, per stack.
- `cs2-opcode-coverage` (test): every instruction the cache's scripts use has a handler.
- `cs2-sweep`: runs all scripts and checks every instruction's stack effect against its signature,
  runs every handler alone on neutral values (covers instructions no script reaches), and lists
  JavaScript errors in handlers. `cs2-script-sweep` (test) holds it at zero. With `--compare` it
  also lists script errors new since the old cache; scripts run with dummy arguments there, so read
  that list (most entries are `cc_create` on component 0).
- Commands for features this client does not have go in `rs/cs2/handlers/UnsupportedOps.ts`
  (they pop their inputs and push neutral results).

### 7. Interfaces

```bash
npx tsx scripts/cache/interface-sweep.ts [--compare <old cache dir>] [--all]
```

Opens every interface as the game does (onLoad, then every transmit listener and timer once, as
when the server's first update arrives) and lists script errors and components showing item 0 or
"null" text that the old cache did not have. `*` marks interfaces our server opens. The
`interface-sweep` test asserts those load without script errors.

### 8. Server data files

Data in `server/data/definitions` is keyed by id, and OSRS ids do not move, so most of it survives
an update. What to do with each source:

| Data | Source | On an update |
|---|---|---|
| `item-combat-styles.json` | cache DB table 78 | `yarn dump:item-combat-styles` (in `server/`) and commit the result |
| `item-gameplay.json` | an old export, no generator | `ItemDefinitionLoader` skips an entry whose name differs from the cache's (ignoring case), so list the entries that match the old cache's name but not the new one's and fix them by hand, checking the item against the cache (a rename can be a different item: check its params) |
| `monsters-complete`, `npc-drops`, `npc-dialogues`, `npc-dialogue-index`, `shops` | [osrsreboxed-db](https://github.com/DayV-git/osrsreboxed-db), built from the live Wiki | Usually already on the new revision; refresh only to pick up new content |
| `item-prices.json` | live Wiki prices | `yarn fetch:prices` if it predates the revision |
| `npc-spawns`, `object-spawns`, plugin data | captures and hand edits | Check NPCs whose name moved into a transform (below) |

Data matched by name is what breaks: the loader check above, and strings in plugins. Most of 241's
1,133 item renames are capitalisation ("Staff of the Dead"), which the loader's check ignores.

### 9. World map and the rest

- `world-map-cache-format` (test): every map area, composite map and geography file decodes.
- `graphics-defaults` (test): the default sprites (compass, head icons, hint arrows, scrollbars).
- Map XTEA keys: `ensure-cache` writes OpenRS2's keys to `keys.json`. Since 241 there are none and
  map files are unencrypted; a missing key means "read as is" on both server and client.
- Full client tests (`yarn test`) and server tests (`yarn build`, then `node --test tests/*.test.cjs`).

### 10. Play

The tools do not see behaviour that depends on server data, or features that never existed. Check
in game: world map (switch maps), compass and head icons, hover text and HUD overlays, chat, bank
(all buttons, tags), GE (buy, sell, collect, abort), shops, a skill menu, settings, sailing, and an
NPC whose name moved into a transform (see below).

## What revision 241 changed

### Cache formats

| Change | Symptom | Fix |
|---|---|---|
| Item opcodes 15 (not tradeable), 160 (never stackable), 251 (unlockable); later 99 (recolall, 2 bytes) and 161 (id list) | — | `ObjType` (client and server) |
| Seq opcode 19 (`crossworldsound`) | — | `SeqType` |
| NPC/loc/spot anim opcode 42 (recolall), spot anim 10 (`rotate=no`), varc opcode 3 (array type) | — (not used by 241 entries, except varc 3) | decoders; spot anims now throw on unknown opcodes |
| Graphics defaults: the sprite list moved to opcode 6 (12 sprites); opcodes 3/4/5 added | No compass, head icons, hint arrows, scrollbars | `GraphicsDefaults` |
| Map files are no longer encrypted: OpenRS2 has no XTEA keys for 241 (`keys.json` is `{}`) | none: with no key, map files are read as they are (all 2937 regions decode) | `CacheMaps` takes keys from `CachePipeline`; the edit-mode region pack no longer needs keys for loc data |
| World map (index 19) lost its group names; composite map entries lost their geography refs; geography (18) and ground (20) keyed by region `(x << 8) \| y` with file = map area id, headerless; chunk regions are one file per area holding only its chunks; decoration loc ids are ints | Map does not open | `WorldMapArea`, `WorldMapArchiveRenderer` |

### Client scripts

| Change | Symptom | Fix |
|---|---|---|
| New commands: long maths/vars (`LongOps`), array commands (`array_fill`, `resize`, `insert`, `delete`, `indexof`, ...), `mes_typed`, `cc_childcount`, `stockmarket_sellable/value`, platform features | `Cs2Error: Unknown opcode 8010` and others; scripts stop halfway | handlers; `UnsupportedOps` for features we lack |
| Arrays in client variables (varcs with an array type) | Bank: `RuntimeException` in script 9551 | an array varc starts as an empty array of its type |
| `stockmarket_value(obj)(status, long)`: guide prices come from a table the client loads | GE prices 0 | server `/api/item-prices` (GE plugin), client `itemPrices.ts` |
| `stockmarket_getofferprice/completedgold` return longs | Wrong offer amounts | push longs |

### Interfaces, variables and tables

| Change | Symptom | Fix |
|---|---|---|
| Bank components +6/+7; chatbox `chatmodal` 567 → 568, `chatdisplay` 56 → 57 | Bank buttons, chat dialogs | `Bank.ts` named constants, literals |
| Varbit 4398 `ge_newoffer_price` → long varp 5753 | GE price 0, confirm shows "---" | new `VARP_LONG` packet (id 44): `PacketSender.sendVarpLong`, client `VarManager.setVarpLong` |
| Varbit 12377 `mouseover_text_enabled` → varbit 10035 `mouseover_text_disabled` (inverted) | HUD overlays under the hover text; an aerial fishing option switched on | Settings plugin sends 10035 = 0 |
| DB table 166 gained a column at 27; table 179 lost three | Sailing parts and facilities | `boatParts.js`, `boatFacilities.js` |
| Display names moved into NPC transforms (Morgan 3479, Dr Harlow 3480: name `null`, a varbit picks the named variant) | none: hooks resolve the variant | — |
| 431 object and 23 item names gone or reused | compile errors | identifiers regenerated; plugins renamed (e.g. "Scythe of Vitur") |
| Eight items renamed outright: 9487–9490 "Wizard blizzard" → "Cocktail glass", 9735/9738 "Desert goat horn" → "Goat horn", 23595/23596 "Berserker ring" → "Berserker ring (i)" | Their `item-gameplay.json` entries were skipped (23595 lost its bonuses) | names updated; 23595 takes the imbued +8 its cache params give |
## Bugs the tools found that predate 241

Found by the stack and interface checks, present on 237 too:

- Misnumbered commands: component finds 202–207 (`cc_find_parent` was at 202, entity overlays ran
  it and broke the stack), `if_query_next` returned nothing, input-field setters 1133–1146,
  settings and notification commands 3120–3173, sidebar 6231/6232, `loc_name` 6800, world list.
- `enum` pushed by the enum's declared type instead of the requested one (type arguments were
  also labelled the wrong way round); `enum_getinputs` (8020) returned outputs and always threw;
  `array_randomise` (8001) sorted instead of shuffling (now `java.util.Random`, the order is our
  best guess); `oc_find` ignored its boolean; `array_push` (8024) was treated as an insert.
- Unset varc ints read 0; the OSRS client reads -1 (bank tags test `!= -1`, so every tag showed
  item 0 "Dwarf remains").

Not from the cache: public chat went to friends chat (`FriendsList.plugin.js` claimed every social
packet), and the GE's Collect and Abort buttons were never wired (465:6 and 465:23, children
created by scripts 793 and 819).

## Known gaps

- Input fields (component type 16) are not drawn or edited; their setters only store values.
- GE: Modify offer and Repeat offer are not implemented.
- `chat_gethistory_*` (5003/5004) push eight values, more than the signature lists (the cache
  scripts read eight); `worldmap_getsourcecoord` (6618) is unused and its second output unknown.
- The script sweep's "new since" list needs reading; the interface sweep cannot reach code that
  only runs with server state (the bank crash needed tags that exist).
- REBUILD_NORMAL, REBUILD_REGION and world-entity packets still carry a key per region. The client
  decodes them but uses its own `keys.json`, and the server looks them up by region id while the
  keys are stored by archive id, so they are zeros. Dropping them changes the packet format, so
  they stay for now. XTEA decryption also stays for caches older than 241.
