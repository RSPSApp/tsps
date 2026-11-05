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

It only recognises `(group << 16) | component`. A component written any other way is missed:
`groupId === 593 && childId === 39`, a named constant (`VIEW_SAILING_OPTIONS_CHILD = 46`), or a
list passed to a script (`[13, 14, 15].map(uid)`). For each group in its list, search the code
(server, plugins, client, tests) for the group id and check every component number near it.

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
| Construction hand data (`server/plugins/skills/construction/data/`) | cache DB tables 110 (furniture), 111 (poh_room), 112 (poh_hotspot), enum 5215 | the plugin reads the cache's fields at load; `yarn dump:construction` lists rows the data names that are gone (exit 1) and new furniture, rooms and trophies that need experience and built loc ids added by hand |
| `item-gameplay.json` | an old export, no generator | `ItemDefinitionLoader` skips an entry whose name differs from the cache's (ignoring case), so list the entries that match the old cache's name but not the new one's and fix them by hand, checking the item against the cache (a rename can be a different item: check its params) |
| `monsters-complete`, `npc-drops`, `npc-dialogues`, `npc-dialogue-index`, `shops` | [osrsreboxed-db](https://github.com/DayV-git/osrsreboxed-db), built from the live Wiki | Usually already on the new revision; refresh only to pick up new content |
| `item-prices.json` | live Wiki buy/sell quotes | `yarn fetch:prices` if it predates the revision |
| `plugins/interface/data/grand-exchange.json` | live Wiki 24h volume and GE buy limits | `yarn fetch:prices` if it predates the revision |
| `item-alch.json` | [osrsreboxed-db](https://github.com/DayV-git/osrsreboxed-db) `docs/item-alch.json` | Copy the generated file into `server/data/definitions/item-alch.json` after regenerating osrsreboxed-db |
| `item-gameplay.json` weapon types | the Wiki's combat style per weapon | `yarn sync:weapon-types` for new weapons (`weapon-data` test); check what it picks for new content, the Wiki can be incomplete on release day |
| Combat Achievements `data/bosses.json` | cache scripts 4778/4780 | `yarn dump:ca-bosses`; the monster keys (enum 3970) are alphabetical, so a new boss moves every key after it |
| `plugins/bots/data/object-index.json` | the cache's maps | rebuilt by the server at startup when it names another cache; commit the rebuilt file |
| Food (`food-effects` test) | the cache's Eat items | a new Eat item needs a food entry or a reason in the test's list |
| `npc-combat-defs`, `npc-captured-animations`, `npc-animations` | hand edits; [rsprox.net captures](https://rsprox.net/database) (`rsprox_index.py npc-anims` in osrs-captures, after its `link-cache` reads the new ids); an old RuneLite export | Nothing required: `NpcDefinitionLoader` takes each animation's role from its gameval name in the cache, and fills attackable NPCs nothing covers from their stand animation's family, so new NPCs get animations on their own. Regenerate `npc-captured-animations` to pick up new captures, and compare the startup line `service animations captured=..., guessed=..., by family=...` with the old cache's |
| `npc-spawns`, `object-spawns`, plugin data | captures and hand edits | Check NPCs whose name moved into a transform (below); a `npc-spawns` entry may name an `NpcIdentifiers` constant with `key` instead of a raw `id`, which follows identifier regeneration |
Data matched by name is what breaks: the loader check above, and strings in plugins. Most of 241's
1,133 item renames are capitalisation ("Staff of the Dead"), which the loader's check ignores.

When a name moves into a transform, the spawn keeps the nameless parent id (e.g. Brundt's 3926
resolves to 9263) and the named variant ids stay in `NpcIdentifiers` and `npc-dialogue-index.json`.
NPC interactions pass the resolved variant as `event.npcId` (`NPC.getContentId(player)`), so quest
plugins and the dialogue index meet the spawn on the same id; an item-on-NPC event carries it as
`npcId` too. New content should key on the named variants, and should not hardcode the parent id -
`NpcIdentifiers` only keeps a parent constant when the old file already named it.

### 9. World map and the rest

- `world-map-cache-format` (test): every map area, composite map and geography file decodes.
- `graphics-defaults` (test): the default sprites (compass, head icons, hint arrows, scrollbars).
- Map XTEA keys: `ensure-cache` writes OpenRS2's keys to `keys.json`. Since 241 there are none and
  map files are unencrypted; a missing key means "read as is" on both server and client.
- Full client tests (`yarn test`) and server tests (`yarn build`, then `node --test tests/*.test.cjs`).

### 10. Play

The tools do not see behaviour that depends on server data, or features that never existed. Check
in game: the login screen (its art is the cache's `title.jpg`), world map (switch maps), compass and head icons, hover text and HUD overlays, chat, bank
(all buttons, tags), GE (buy, sell, collect, abort), shops, a skill menu, settings, sailing, and an
NPC whose name moved into a transform (see below).

### 11. Publish the client cache

The production Deploy workflow runs `ensure-cache --publish /var/www/flarum/play/caches`
on the VPS as part of World 1 deployment. It downloads the exact cache in `server/target.txt`
if missing, stages the public copy, then atomically replaces `caches.json`. Existing versioned
cache directories stay available for clients that are still using them. It also repairs the
manifest when the cache is already present. CI verifies the public manifest and HTTP range
requests after deployment; a successful client JavaScript upload alone does not update the cache.

The VPS forced command is installed from `.github/scripts/deploy-world1.sh`:
`install -m 755 .github/scripts/deploy-world1.sh /usr/local/bin/tsps-deploy`.
Reinstall it on the VPS whenever that script changes.

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
| DB table 166 gained a column at 27; table 179 lost three | Sailing parts and facilities | `BoatParts.Sailing.js`, `BoatFacilities.Sailing.js` |
| Display names moved into NPC transforms (Morgan 3479, Dr Harlow 3480: name `null`, a varbit picks the named variant) | none: hooks resolve the variant | — |
| 431 object and 23 item names gone or reused | compile errors | identifiers regenerated; plugins renamed (e.g. "Scythe of Vitur") |
| Eight items renamed outright: 9487–9490 "Wizard blizzard" → "Cocktail glass", 9735/9738 "Desert goat horn" → "Goat horn", 23595/23596 "Berserker ring" → "Berserker ring (i)" | Their `item-gameplay.json` entries were skipped (23595 lost its bonuses) | names updated; 23595 takes the imbued +8 its cache params give |

## Weekly builds within a revision

Jagex ships content in weekly cache builds without a new revision. OpenRS2 lists each one
(`osrs-241_2026-10-20`); the same playbook applies, and usually only steps 3, 4 and 8 find
anything. Saved player data keyed by a cache position (an enum key, a list index) rather than an
id moves with it: look for such keys in persisted attributes.

`osrs-241_2026-09-30` → `osrs-241_2026-10-20` (Raids 4, The Fractured Archive):

| Change | Effect on the old code | Fix |
|---|---|---|
| Item opcode 161 (`keeponlyduringseqs`: a u16 count of u16 sequence ids) now used, by 4 new items; the server also read opcode 99 (`recolall`) as one byte instead of two | `ObjType: Opcode 161 not implemented` | server `ObjType` (the client already had both) |
| 102 items, 167 NPCs, 329 objects added; nothing renamed or removed | — | identifiers regenerated |
| `combat_interface` (593): `special_attack` 39 → 41, `switch_button` 46 → 48 | The special attack and sailing "View" clicks go unhandled | `NetworkBuilder` named constants, `Sailing.plugin.js` |
| `hpbar_hud` (303) gained `hp_bar_extra` at 11 (and a second bar at 22-27): everything from 11 up moves by one | The HUD scripts get the wrong components (bar colours, fades, text) | `BossHud.plugin.js` component lists, Opponent Info's HUD text 20 → 21 |
| `equipment` (84): weight 51 → 50, attack speed 53/54 → 52/53 | Wrong texts on the equipment stats screen | `EquipmentStats.plugin.js` |
| A Combat Achievements monster (The Fractured Archive) inserted at key 26: every later key +1 | Saved kill counts (keyed by monster key) would attach to the next boss; tasks bumped the wrong boss's counter | `dump:ca-bosses`; kill counts now saved by monster name, old numeric saves read through `data/legacy-monster-keys.json` (the 2026-09-30 keys) |
| Client script strings carry text templates: `<str_name=value>` defines a value, `<str_name>` draws it (2 scripts on 2026-09-30, 14 now: quest names in "Requires", "Quest:", the quest list and journal, region unlocks, Slayer unblock, Gauntlet shards) | The names were dropped (bitmap font) or the tags drawn as text (widget renderer) | `rs/font/textTemplates.ts`, resolved where text is drawn, measured or wrapped |
| The login art (binary index: `titlewide.png`/`.jpg`, 545x671, and `title.jpg`, 383x503, each the left half) is the Raids 4 art | The login screen kept showing the bundled classic archway (`public/images/loading-bg.jpg`, the old `titlewide` art), which never came from the cache | the client builds the background from `titlewide` (else `title.jpg`) and its mirror, 1089x671; the classic 765x503 scene is its top middle (162 columns in) |
| Graphics defaults opcode 3 (three five-colour flame palettes) turned green; the client skipped it and drew hardcoded red flames | Red login flames on the green Raids 4 art | `GraphicsDefaults.flamePalettes`, `LoginScreenAnimation` builds its palettes from them (the classic colours give the old palettes exactly) |
| Six new weapons, one new Eat item (Leftovers) | `weapon-data` and `food-effects` tests | `sync:weapon-types` (the Wiki gives Obligator and Zorya's tome "Unarmed" for now); Leftovers listed as raid food |

`compare:cache` reported only the Opponent Info literal; the rest were found by searching for the
group ids (see step 4).

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

- `<switch,pronoun,"he","she","they">` in script strings (scripts 5077/5078, with `text_pronoun`) is not
  resolved: it needs the player's pronoun setting.

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
