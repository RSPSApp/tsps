# NPC spawns

`server/data/definitions/npc-spawns.json` holds every NPC spawned with the world, one per line: `id` (or `key`, an `NpcIdentifiers` constant), `name`, `x`, `y`, `level` (the plane), and optionally `wanderRadius` (default 5) and `direction`. `NpcSpawns.plugin.js` registers it; plugins can veto a spawn (`canSpawnNpc`).

The client cache has no spawns: OSRS keeps them on the server. The file came from a one-time import, then captures and plugins added to it by hand. Areas released since then had none, until this script.

## Adding an area from the Wiki

`yarn sync:npc-spawns` (`server/scripts/sync-npc-spawns.ts`) adds the spawns an area is missing, from the OSRS Wiki:

```sh
cd server
yarn sync:npc-spawns --box 2520,2170,2660,2310 --box 2560,8560,2640,8660 --tag Wyrmscraig            # dry run
yarn sync:npc-spawns --box 2520,2170,2660,2310 --box 2560,8560,2640,8660 --tag Wyrmscraig --write    # add them
```

| Option | Meaning |
| --- | --- |
| `--box minX,minY,maxX,maxY[,plane]` | The area, inclusive; repeatable. Every plane unless one is given. |
| `--tag <word>` | Prefer Wiki versions whose label has it ("Wyrmling#Idle (Wyrmscraig)"). |
| `--id <Name>=<id>` | Use this NPC id for a page's spawns. |
| `--skip <Name>` | Leave a page's spawns out (Leagues, events, quest states). |
| `--radius <tiles>` | How far an existing spawn may be from the Wiki's and still match (default 4). |
| `--report <file>` | Write every map square's gaps as JSON instead: area name, spawn counts, missing NPCs with their labels. Nothing is written to the spawn file; without `--box`, the whole map. |
| `--wiki <file> [--save]` | Read a saved copy of the Wiki data, or (with `--save`) fetch and write one. A full fetch is about 90 requests. |
| `--repair-identities` | Also reconcile literal IDs whose current-cache name contradicts the authored name, using unique nearby Wiki/cache evidence. Opt-in; dry run unless `--write` is supplied. Not combined with `--report`. |
| `--spawns <file>` | Alternate spawn input/output, useful for isolated regeneration checks. Defaults to `server/data/definitions/npc-spawns.json`. |

**Where the Wiki keeps spawns:**
- **Monsters:** `{{LocLine}}` coordinates, one per spawn (bucket `locline`), with ids per page version from bucket `infobox_monster`.
- **Single NPCs:** the infobox's `{{Map}}` in the page's wikitext, with ids from bucket `infobox_npc`. A polygon, rectangle or line outlines an area: it becomes one spawn at its centre. Every `{{Map}}` on a `|map =` line counts, labelled or not (`|map = Port Sarim Docks {{Map|…}} Port Piscarilius {{Map|…}}`).
- **Not counted:** pages without an NPC infobox (LocLine also places scenery and items), and historical or event pages without real ids.

**NPCs with several versions:** an infobox's `map1`, `map2`… belong to its `id1`, `id2`… (Guild Hunter Fox: `map1` the Hunter Guild with `id1` 13426, `map3` the Avium Savannah with `id3`, injured). The script pairs them by that number. It used to take the versions in the data bucket's order, which differs, so 60 spawns on 32 pages got the wrong id or a quest stage; they're fixed below.

**Choosing the id:** a LocLine row has no version, so the script picks: a version whose label has a `--tag`, else the id existing spawns of that NPC already use most, else the first. The dry run prints each choice.

**Add-only.** Per NPC name and plane, a Wiki spawn with an existing one of that name within `--radius` is already there (closest pairs first), and leftover existing spawns **in the same 64×64 map square** still count, so only the difference in number is added there (the Wiki spawns furthest from any existing one). A spawn elsewhere on the map doesn't stand in for one missing here, so a whole-map run counts correctly. Nothing is moved or removed, so a second run adds nothing. In an area that already has its spawns, only real gaps show up: Lumbridge has 85 Wiki spawns and 84 existing, and the script would add 7. Added spawns carry `"source": "wiki"`, so they can be found and replaced by captured positions later.

**Wander radius:**
1. What existing spawns of that NPC mostly use (by id, else by name): 0 for fishing spots and bankers, as the old data set by hand.
2. Otherwise 0 for an NPC without a walk animation in the cache.
3. Otherwise the loader's default (5).

The Wiki map's `r` only sizes its marker, so it isn't used: Mortimer's map has `r=4`, and he wanders one tile (rsprox captures).

### Repairing mismatched identities

Add-only matching uses the authored NPC name, so it cannot notice an imported row
whose numeric id now refers to a different NPC. `--repair-identities` reconciles
that mismatch before planning additions. It requires one unique ID among nearby
Wiki candidates on the same plane, with both the Wiki name and the cache name
agreeing with the authored name. The area boxes, skip decisions and `--only`
labels still apply. Ambiguity or missing evidence is reported without changing
the row. Correct variants, explicit cache `key` entries and unnamed rows remain
unchanged, as does a nameless multinpc parent one of whose variants has the name: live
spawns the Leagues Tutor at 3226, 3215 as 317 (cache name `null`), which `league_account`
(varbit 10031) shows as the main game's 316 and hides from a league character, so it is not
"repaired" to the Wiki's 316. Coordinates, facing, wandering and other metadata are retained.
Repair evidence retains every plausible Wiki ID before the normal add-only
`--tag`/`--id`/most-used choice and name/tile deduplication; those choices cannot
make an ambiguous source pin appear unique.

The writer accepts valid one-record-per-line JSON with LF or CRLF. It retains the
original bytes of untouched records, including their spacing, and the existing
line ending. This avoids reformatting older imported/captured rows while making
a focused identity correction. Malformed or multi-record lines are rejected.

On 24 October 2026, the [Key Master](https://oldschool.runescape.wiki/w/Key_Master)
row at1310,1251,0 still used5870, which cache241 names Patchy; the current Wiki
and cache identify the Key Master as12599. The real Patchy at3677,2978 keeps5870.
`server/tests/fixtures/npc-spawn-identity-wiki.json` preserves original infobox
id/map lines extracted from the canonical Wiki authoring cache
`osrsreboxed-db/data/dialogues/npc-pages.json`, rather than a repaired output or
per-NPC override. This spawn file is owned by the TSPS sync pipeline;
osrsreboxed-db has no spawn exporter.

Reproduce the correction, then repeat the command to verify zero repairs and
identical file bytes:

```sh
cd server
TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' node node_modules/ts-node/dist/bin.js scripts/sync-npc-spawns.ts --wiki tests/fixtures/npc-spawn-identity-wiki.json --box 1310,1251,1310,1251,0 --repair-identities --write
```

Validation uses `tests/npc-spawns-sync.test.cjs` and
`tests/npc-spawn-refine.test.cjs`, including the actual CLI on isolated LF/CRLF
fixtures, unchanged unrelated bytes, repeated regeneration and cache identity.

**Wiki map layers.** The Wiki draws many dungeons on their own map layers (`mapID`), whose coordinates or plane can differ from the game's: the God Wars Dungeon is on plane 0 there and 2 in the game, and the Stronghold of Security's floors are each shifted (the Sepulchre of Death by +352, +288). Before comparing, each Wiki map square on a layer votes, through its spawns, for the shift that puts them on existing spawns of the same NPC:
- **A square is aligned** when at least 2 spawns, and half of those with a same-name spawn anywhere, agree on one shift.
- **A layer whose aligned squares all agree** takes that shift everywhere, its empty squares too.
- **A layer holding places shifted differently** uses each aligned square's own shift. Its other squares stay unaligned, are labelled "Wiki map layer not aligned", and are left out.

The surface (`mapID` 0, or none) is in game coordinates already.

**Decisions** live in `server/data/definitions/npc-spawn-sync.json`, so every run respects them. Each has a `label`, `skip` (leave the spawns out) and `why`:
- `categories`: cache NPC categories (opcode 18). Category 2353 holds the Sailing sea creatures (sharks, rays, krakens, seabirds): labelled, not skipped.
- `names`: cache NPC names. The Stronghold of Security doors are skipped, since tsps opens them as scenery.
- `pagePatterns`: Wiki page titles. Leagues, Deadman and holiday-event pages are skipped.
- `boxes`: areas a plugin spawns itself (Pest Control's island, the Theatre of Blood, Scurrius' lair).
- `unalignedLayers`: how unaligned Wiki map layers are treated (skipped).

**Checks it prints:**
- NPCs on the Wiki with ids newer than this cache.
- Spawned NPCs with a combat level but no drop table or stats. Drops come from the Wiki drop dumper in osrsreboxed-db (`plugins/npcs/NpcDrops.plugin.js`); rerun it for an area newer than the last dump.

## Wyrmscraig

Added with the command above: 84 spawns on the island and in the Wyrmscraig Cavern.
- **The villagers:** Cormac, Ffion, Muriel, the Auchrie residents (Rian, Catriona, Baldwin, Angus), Oisin, Declan, Mr Supplies Jnr, Geoff, and Mortimer (the post-quest version with Assignment and Trade, 16175). Keenan has no NPC infobox on the Wiki, so he isn't placed.
- **Monsters:** wyrmlings (16297, the Wyrmscraig idle version), wyrms, lava strykewyrms, mountain trolls, bats.
- **Animals:** goats, chickens, bunnies, a yak, seagulls, and great white sharks in the sea around it (a Sailing encounter; they can't be reached without a boat).
- **Other:** golems and fishing spots.

The existing Mad Angel matched and wasn't doubled. All of them that fight have drop tables and stats.

- **Standing still:** the fishing spots (as existing ones) and the broken golem (no walk animation).
- **Mortimer:** live spawns the parent `slayer_master_mortimer` (4462), which transforms on `ffg` into the post-quest version with Assignment and Trade (16175), and wanders one tile around 2590, 8614 (rsprox captures). The client animates an NPC from its parent: 4462 has `mortimer_idle` and a walk animation, while 16175 has none, so spawned as 16175 he stood in the default pose and couldn't walk.
- **Mountain trolls:** the Wiki lists 936–942 and 16330–16332 under one version, identical in the cache; the script used 936, which existing spawns use.
- **Not covered by spawns:** dialogue, the two shops, Mortimer's Slayer assignments, goat hunting and golem crafting.

## Varlamore (surface)

```sh
yarn sync:npc-spawns --box 1024,2752,1919,3455 --write
```

2,391 spawns across 47 areas, which had 186 before. The largest are Civitas illa Fortis (374), the Tlati Rainforest (254), the Avium Savannah (221), Aldarin (198), Auburnvale (93) and Laguna Aurorae (89).
- **Kept:** 270 Sailing sea creatures along the coast, and 94 spawns of NPCs without drops yet (Strangled, giant mosquitoes, carnivorous chinchompas, Sunlight antelopes, a few guards); their tables come with the next monster and drop dump.
- **Left out:** the Leagues Navigator; the Gemstone Crab and Sol Heredit, which plugins spawn themselves.
- **Not covered:** Varlamore's underground (Cam Torum, the Ruins of Tapoyauik, the Stalker Den), for a dungeon batch.

## Sailing islands and seas

1. **Every empty surface map square outside Varlamore** (190 squares, from the gap report, `--box` per square): 1,932 spawns. That's The Great Conch, Isle of Serpents, Cape Conch, Dognose Island, The Summer Shore, The Onyx Crest, Anglers' Retreat, The Crown Jewel, Charred Island, Sunbleak Island and the rest, with the sea around them.
2. **Sea creatures off coasts tsps already covers:** `--box 0,0,16383,16383,0 --only "Sailing sea creature"`, 280 spawns. Narwhals, bull sharks, albatrosses, terns, vampyre krakens and orcas off Morytania, the Fremennik isles, Kourend and Karamja. Nothing else is added there.

- **Left out by the decisions:** Tempoross and its props (ammunition crates, spirit pools), the Soul Wars Avatar of Creation, the Wiki's Void Knight and squire on Pest Control's island (the plugin spawns its own), and The Node, the Group Ironman starting island.
- **Left for later:** Lucien's camp (its skeletons and undead mages look quest-related) and the "Meaty Aura Logist" rows.

## Varlamore's underground

```sh
yarn sync:npc-spawns --box 1216,9344,1727,9855 --tag Neypotzli --write
```

454 spawns: Cam Torum's city (guards, citizens, children, bankers, the bar and smithy, on plane 1), the Stalker Den's custodian stalkers, the Ruins of Tapoyauik (icefiends, ice giants, blue dragons, Frost Nagua, chilled jellies), the Tonali Cavern (Earthen Nagua, grimy lizards, giant rock crabs), and Neypotzli's gaps. `--tag Neypotzli` picks Neypotzli's own wyrmlings (13031) over Wyrmscraig's.

- **Left out:** the Perilous Moons bosses (Blood, Blue and Eclipse Moon) and Amoxliatl, since no plugin gives them their fights yet. Araxxor is in the same decision ahead of the dungeon batch.
- **Not yet:** the Frost Nagua have no stats until the monster database update.

## Open monster dungeons

1,163 spawns in 80 map squares of open monster dungeons, from an allowlist of areas in the gap report rather than everything below ground: the Black Knight Catacombs, Underground Pass, Morytania Spider Cave (araxytes), Charred Dungeon, the Sophanem and Scabaras dungeons, Tarn's Lair, Zemouregal's Base and Fort, the God Wars Dungeon's spirituals and blood reavers, the Gryphons' cave, Ynysdail Cavern, Deepfin Mine, the Buccaneers' Laboratory, Grimstone Dungeon (frost dragons), Waterbirth, Pandemonium Cave, Brimhaven Dungeon, the Ancient Guthixian Temple (tormented demons), the Stronghold of Security's minotaurs, the Vampyrium and its realm, and smaller slayer caves.

- **New decisions, left out:**
  - `namePatterns` `^<col=`: coloured names are always props of a minigame, raid or quest (Theatre of Blood pillars, Nightmare totems, Inferno glyphs);
  - the *Defender of Varrock* zombies invading Varrock Palace (quest only).
- **Removed by the new rule:** `<col=00ffff>Forebearer Janus</col>`, which the Varlamore batch had added in Civitas before the rule existed.
- **Left out of the allowlist, for a later look:** raid and boss areas their plugins spawn (Tombs of Amascut, Theatre of Blood, the Nightmare, the Inferno, the Abyssal Nexus); bosses without a plugin yet (Skotizo, Yama, Phantom Muspah, the Headless Beast, the Jormungand); minigames (Barbarian Assault, Nightmare Zone, the Motherlode Mine); and single quest NPCs.

## Multi-version NPCs

The fix to the version pairing above, on the 60 spawns it affected (32 Wiki pages). Every page was checked: which version belongs in the world after its quests, where, with which id.
- **The id corrected** (the place was right, the version wasn't): Azzanadra (730, ghostly), Maisa in Sophanem (11474), a gnome traveller, Zanaris's grey and light-grey sheep (swapped), Queen Zyanyi Arkan on her throne (14296), four of the Knights of Varlamore, Furia Tullus (the royal servant), Primio in Civitas (12889), the Darkfrost workers and seers (swapped), Ikniu, the chameleons, two Aranei scouts (swapped), Forebearer Janus at his home (the civilian, 14241).
- **The Hunter Guild:** the *Injured hunter* (12931) is the quest's version; Guild Hunter Fox (13426) stands there after *At First Light*. In live OSRS he walks within about 2 tiles (13 recordings), so `wanderRadius` 2.
- **Quest stages removed:** Attala and the builder at the Ralos' Rise camp (in Cam Torum after *Perilous Moons*, where they already are); Antos, Shas and Etz injured; the injured Guild Hunter Fox in the Avium Savannah; Forebearer Janus as a cultist, captured and bound; Furia Tullus as a cultist; Junior Jim's "limbo".
- **Achilka:** one per boat stop, each with that stop's id (14727 Kastori, 14728 Tal Teklan, 14729 the Gloomthorn Trail); there had been two or three per stop with the wrong ids.
- **Added:** Primio's Varrock end (12888), lost when the Civitas one took its id.
- **Decisions:** the quest-stage ids are in `npc-spawn-sync.json` under `ids` (`Quest stage`, skipped), so a rerun doesn't add them back.

## Labelled and several maps on one line

The sync read a map line only when it began with `{{Map}}`, and only its first map. Pages that label their places, or give several on one line, lost some or all of their spawns: 35 pages in the Wiki authoring cache gain maps (Cabin Boy Herbert, Veos, Zanik, Captain Barnaby, Jenny Blade, the Gamer and others). They show up on their next sync; none was synced with the fix.

**Cabin Boy Herbert** at Port Sarim, placed from rsprox captures instead (26 recordings): `cabin_boy_herbert_sarim` (11126) at 3053, 3245, facing north, standing still. The Wiki lists only his visible ids (10932-10934), so a sync would pick the wrong one. 11126 shows as 10933 (Talk-to, Port Piscarilius, Land's End) once varbit 12296 `akd` reaches 12, when Fuggy names Veos' ship in *A Kingdom Divided*. Veos (1063) keeps his spawn beside him, but from the same stage *X Marks the Spot* sends his visibility (`veos_sarim_vis`, 12148) as 0, so he's gone: captures at `akd` 150 have it at 0 and never add him.

## Doubled spawns

132 Wiki spawns stood on the tile of another spawn of the same name, two NPCs where the game has one. Two faults in the sync, both fixed:
- **Pairing in Wiki order:** a Wiki spawn a tile off an existing one could take it, leaving the Wiki spawn exactly on it unmatched, and added. Pairs now go closest first. This hit the open monster dungeons batch: spiders, blessed spiders and waterfiends in the Underground Pass, skeletons, minotaurs in the Stronghold of Security, bloodvelds in the God Wars Dungeon, enraged barbarian spirits, and Zanaris's sheep.
- **The Wiki listing one spawn twice:** another map layer drawing the place again (Kalrag's Lair "during *Song of the Elves*"), two pages of one NPC (*Sheep* and *Sheep (Zanaris)*), two LocLines on one page (the Stronghold's minotaurs, once per level), or a map giving its centre and a pin on the same tile (the shipwrights, a jackal, the red salamanders). A tile now counts once per NPC name.

The fix was applied to the data: those NPCs' Wiki spawns in the 7 affected map squares (126) were removed and synced again with the fixed script, which added back only 5 bloodvelds, where the God Wars Dungeon really lacks them; the 9 same-tile copies elsewhere were removed. The three bards at each camp stay: three different NPCs on one Wiki pin.


## Audits

- [NPC wander and aggression audit (2026-11-01)](audits/npc-wander-and-aggression.md) - every
  spawned NPC id, the stationary/prop cases still on a positive radius, the service-NPC default
  outliers, and the aggression-range code against the Wiki.

## Draynor jail (Prince Ali Rescue)

Lady Keli, Prince Ali and Joe were spawned as their visible ids (11578, 11579, 11577), which never change, so Keli stayed in the jail after the player tied her up. Live spawns their nameless parents, keyed on the quest's varp 273, as rsprox recording 1723 shows for Keli. They're spawned as those now:
- **Lady Keli** `lady_keli` (11643): shows as 11578 at varp 273 values 0-40, then nothing, so she's gone from stage 50, when she's tied up and put in a cupboard.
- **Prince Ali** `prince_ali_prison` (11644): 11579 at 0-90, then gone once he's freed (100).
- **Joe** (11642): 11577 at 0-101.
