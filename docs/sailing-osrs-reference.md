# Sailing: OSRS reference

What live OSRS actually sends for Sailing, recorded so the tsps implementation can match it. It complements [the Sailing design](sailing.md): that page says what tsps does and why; this one records the observed facts it is built from.

## Sources

- **Live captures** (rsprox, 2026-09-30): boarding the raft, skiff and sloop at The Pandemonium; Junior Jim's Recover-boat and Customise-boat; opening the raft's cargo hold. Names below are rsprox's symbolic names.
- **OSRS Wiki**: [Boat](https://oldschool.runescape.wiki/w/Boat), [Raft](https://oldschool.runescape.wiki/w/Raft), [Shipwright](https://oldschool.runescape.wiki/w/Shipwright).
- **The cache**: tsps runs revision 237 (2026-03-25). The captures are from a newer live revision, so **check every id against the cache before using it**. For example, 29506, 29517 and 29527 are the raft, skiff and sloop's second sail piece live, but fairy rings in revision 237.

Coordinates are written as rsprox does, `level_squareX_squareY_localX_localY` (map square 64 tiles; tile = square × 64 + local). "Deck tile (x, y)" means a tile relative to the boat's template zone.

## Boat types

| | Raft | Skiff | Sloop |
| --- | --- | --- | --- |
| Boat type id (varbit 19137) | 0 | 1 | 2 |
| World entity config | 1 | 2 | 3 |
| World entity size (x × z) | 8 × 8 | 8 × 8 | 8 × 16 |
| Sidepanel boat type (varp 5117) | 8110 | 8111 | 8112 |
| Sidepanel facility slots (937:25 end) | 16 | 40 | 64 |
| HP-bar NPC on deck | `boat_hp_npc_tiny` 15186 | `boat_hp_npc_small` 15187 | `boat_hp_npc_medium` 15188 |
| Player placed on (deck tile, level) | (3, 4), 1 | (4, 4), 1 | (3, 8), 1 |
| Spawn at The Pandemonium | (3074, 2987) | (3075, 2987) | (3075, 2987) |

- Every boat spawns with fine offset 64, 64 and angle 1024 (north).
- **The cache's world entity types:**
  - basePlane is 1 for all three;
  - base offsets are raft (−64, −64), skiff (0, −64) and sloop (−64, 0);
  - bounds are raft 128×384, skiff 256×640, and sloop 384×1280 starting at y −256.

  A boat's centre in its deck frame is size × 64 + base offset: raft (448, 448), skiff (512, 448), sloop (448, 1024). Its hull is the bounds rectangle.
- **Walkable deck tiles:** the template's level-1 collision gives them. The raft has x 3, y 2-4. The skiff has x 3-4, y 2-5. The sloop has x 2-4, y 5-10, with a solid stern below.
- The wiki's per-boat facts (level, cost, size, crew, hotspots) are on the [Boat](https://oldschool.runescape.wiki/w/Boat) page.

### Deck templates

Every deck is copied from map square (60, 100), laid out as a grid:

- **The column is the hull material**, 8 tiles per tier: local x = 8 × tier (wooden 0, oak 1, teak 2, mahogany 3, camphor 4, ironwood 5, rosewood 6).
- **The row is the boat type**: raft y = 56, skiff y = 48, sloop y = 32 (two zones, 32 and 40).

| Seen | Template zone(s) |
| --- | --- |
| Raft, wooden hull | (0_60_100_0_56) |
| Skiff, teak hull | (0_60_100_16_48) |
| Skiff, camphor hull | (0_60_100_32_48) |
| Sloop, camphor hull | (0_60_100_32_32), (0_60_100_32_40) |

Upgrading a hull rebuilds the boat from the new column: the capture shows the world entity deleted, re-added and rebuilt from the camphor template.

### Raft deck

Deck tile (x, y), all on level 1, rotation 0:

| Loc | Id | Tile | Shape | Notes |
| --- | --- | --- | --- | --- |
| Helm | 59554 (`sailing_boat_steering_kandarin_1x3_wood`) | (3, 4) | 10 | Navigate / Stop-navigating / Escape |
| Sail | 59530 (`sailing_boat_sail_kandarin_1x3_wood`) | (3, 3) | 10 | |
| Linen sail | 29506 live (`sailing_boat_sail_kandarin_1x3_linen`) | (3, 5) | 10 | a fairy ring in revision 237: not placed |
| Cargo hold | 60245 (`sailing_boat_cargo_hold_regular_raft`) | (3, 2) | 10 | |
| Invisible | 32545 | (2, 2), (2, 3), (4, 2), (2, 5), (4, 5) | 22 | |
| Gulls sound | 58569 | (4, 3) | 22 | |
| Water loop sound | 58526 | (2, 4) | 22 | |
| Crashing waves sound | 58568 | (4, 4) | 22 | |

The HP-bar NPC stands on deck tile (3, 3), level 1.

### Skiff and sloop decks (as captured, upgraded boats)

Deck tile relative to each template zone, level 1 unless noted. Part ids depend on the part's tier.

- **Skiff** (keel steel, trim camphor, helm oak, sail teak):
  - level 0: keel 59518 (2, 1), trim 59628 (1, 1);
  - helm 59579 (4, 6); sail 59539 (4, 4); canvas sail 29517 live (4, 5);
  - salvaging hook 60493 (3, 2, rotation 1); inoculation station 59704 (3, 1); cargo hold 60259 (4, 1);
  - sound and invisible locs around the edges.
- **Sloop** (keel adamant, trim camphor, helm mahogany, sail camphor), from zone (60_100_32_32):
  - level 0: keel 59527 (1, 3), trim 59646 (1, 2), and hull gunports 60696, 60700, 60698 and 60702;
  - helm 59607 (3, 11); sail 59548 (4, 10); canvas sail 29527 live (4, 11);
  - salvaging station 59701 (4, 6, rotation 1); salvaging hooks 60505 (2, 5) and 60506 (4, 5, rotation 3); inoculation station 59706 (2, 4); cargo hold 60273 (4, 4).
- **In the shipyard** (Customise-boat), empty facility hotspots show placeholders 59664-59667 (skiff).

### Stats

| | Raft (wooden) | Skiff (teak) | Skiff (camphor) | Sloop (camphor) |
| --- | --- | --- | --- | --- |
| Max HP (19177) | 20 | 120 | 180 | 260 |
| Base speed (19250) | 192 | 256 | 320 | 320 |
| Speed cap (19251) | 320 | 384 | 384 | 448 |
| Speed boost duration (19256) | 20 | 24 | 24 | 30 |
| Acceleration (19257) | 64 | 64 | 64 | 128 |
| Defence (varp 5147) | 1 | 30 | 50 | 55 |
| Armour (varp 5148) | 0 | 300 | 300 | 600 |

- **Speeds are fine units (1/128 tile) per tick.** 192 is 1.5 tiles, 256 is 2 and 320 is 2.5, matching the wiki's base speed for wooden, teak and camphor hulls.
- **Per-style defence**, varps 5159-5165 (stab, slash, crush, magic, heavy, standard and light ranged): raft 24, 11, 6, 9, 4, 13, 26; skiff (camphor) 103, 76, 54, 66, 34, 68, 111.
- **Resistances** (19248 storm, 19249 rapids, 19252 fetid water, 19253 crystal-flecked): 1 or 2 on the skiff and sloop, none on the raft.
- Current HP (19181) is separate from max: the captured raft was at 13 of 20.

## Boarding

The gangplank's Board (op 1) opens the boat selection interface when you own several boats; with one boat it boards straight away. After choosing, in order:

1. Fade out: interface 174 on the atmosphere overlay, script 948 `[0, 255, 0, 0, 15]`; minimap state 2.
2. Message (type spam): **"You board your boat."**
3. Varbits:
   - `sailing_boat_spawned` 19121 = boat slot (from 1);
   - `sailing_previous_boat_data_slot` 19130 = slot;
   - `sailing_previous_boat_type_id` 19143 = boat type;
   - `sailing_boarded_boat` 19136 = 1;
   - `sailing_boarded_boat_type` 19137 = boat type;
   - `sailing_boarded_boat_world` 19122 = world;
   - the boat's name, packed into 19149 and 19150;
   - `sailing_player_is_on_player_boat` 19104 = 1;
   - `sailing_sidepanel_player_role` 19233 = 10 (captain);
   - `sailing_last_personal_boat_boarded` 18554 = slot;
   - `sailing_preloaded_anims` 19118 = 1.
4. Sidepanel values: varp 5117 (boat type), move mode 19175 = 4 (moored), players on board 19235 = 1, helm status 19176 = 1, max and current HP, facility tiers and hotspots, repair kits (raft 10), and the stats above.
5. `WORLDENTITY_INFO` adds the boat. The player teleports onto the deck (level 1). `REBUILD_WORLDENTITY` builds the deck from the template, then the HP-bar NPC and the deck locs are added.
6. Sound 10754. Script 8776 `[name, 1, "", 1]`, script 915 `[0]`, and the sidepanel (937) opens on the combat tab.
7. Sidepanel events:
   - 937:1 slots 0-12, op 1;
   - 937:25 slots 0 to the boat's facility slots, ops 1-4;
   - 937:26 same slots, target NPC;
   - 937:20 same slots, op 1;
   - 937:29 slots 0-11, op 1;
   - 937:10 slots 0-1, target player;
   - 937:38 slots 0-3, op 1.
8. The sails play their "down" animation: raft 13367, plus 13875 on the linen sail.
9. Fade in: script 948 `[0, 0, 0, 255, 15]`, minimap state 0.

**Disembarking** (captured at the shipyard's gangplank):
- the player teleports back ashore;
- varbits 19136, 19137, 19122 and 19104 go to 0;
- the helm plays its inactive animation (13345 on the skiff);
- script 8778 `["", 1, "", 1]` runs;
- players on board 19235 goes to 0.

## Per-boat varbits

The server describes every owned boat to the client at login (live login capture) and whenever one changes. Each boat slot has a block of varbits, 38 ids apart: slot 1 starts at 19258, slot 2 at 19296, up to slot 5 at 19410.

| Offset | Varbit (slot 1) | Value |
| --- | --- | --- |
| +0 | 19258 `owned` | 1 |
| +1 | 19259 `type` | raft 0, skiff 1, sloop 2 |
| +2 | 19260 `port` | the dock's port id (0 = Port Sarim, 1 = The Pandemonium); 255 bottled, 254 capsized, 253 lost at sea (cache script 8997) |
| +3 | 19261 `bottle_previous_port` | 255 |
| +4 | 19262 `facilities_unaltered` | 1 |
| +5, +6, +7 | 19263-19265 `name_1`-`name_3` | the name's three words |
| +8 to +11 | 19266-19269 keel, hull, sail, steering | part tiers (0 on a raft) |
| +15 + n | 19273 + n `hotspot_n` | the facility at hotspot n (raft hotspot 0 = 15) |
| +26 | 19284 `trim` | trim tier |

- **HP:** stored HP is 19458 + slot and stored max HP is 19463 + slot.
- **Also at login:**
  - varbit 18166 stays 0. Cache scripts 607/633 read it through 8950(23), and at 1 they lock Sailing: the skills tab fades it and the customisation answers every Build with "You cannot build that at the moment." (script 8807 via 9022). Its name isn't known;
  - `sailing_intro` (18314): 50 once the intro (The Pandemonium) is done. Script 9022 needs it at 50+ (on a members world) before the customisation allows any Build;
  - the last dock, standard dock and mooring point (19145-19147);
  - where the boat was spawned: slot, fine x/z, angle (19121, 19141, 19142, 19129);
  - `last_personal_boat_boarded` (18554) and `previous_boat_data_slot` (19130);
  - the cargo hold warning (19123).

**Boat names** are three words (cache scripts 9085 and 9088):
- Word *n* (1-based, 0 = none) is entry *n* − 1 of the string list in db row 8545, 8546 or 8547 (table 187, column 1). The words are joined with spaces.
- With no words, the name is "Boat" (row 8547's column 0).
- Row 8545's list is empty in revision 237. The raft in the capture, words 0, 32, 57, is "Extreme Pride".

## Boat selection (interface 934)

One interface serves the gangplank and Junior Jim. Varbit 18553 sets the mode, and varp 5005 is the current dock's db row (8588 = The Pandemonium):

| Mode (18553) | Opened by |
| --- | --- |
| 2 | Customise-boat |
| 3 | Board (gangplank), when you own more than one boat |
| 5 | Recover-boat |

**Opening:**
1. The server sends the bank (95) and every cargo hold (963-967).
2. Script 2524 `[-1, -3]`, then 934 opens as the main modal.
3. Script 8621 initialises it.
4. 934:5 gets slots 1-5, with pause button and op 1.
5. `busy` is set to 1.

**Choosing:** a choice is a pause-button resume on 934:5 whose slot is the boat's slot + 1. The mode and dock vars go back to 0 and -1, script 2158 (`chatdefault_restoreinput`) gives the chatbox its input back, and the interface closes. Without 2158 you can't type in chat afterwards.

**Texts in its scripts** (shown by the client for boats you can't choose):
- "You can't choose that boat at the moment."
- "That boat is already at the nearby dock. There's no need to recover it."
- "That boat is already docked at …"
- "That boat does not have anything stored in its cargo hold."

## Buying a boat (Junior Jim's Buy-boat)

Buy-boat opens the data-driven shop "omnishop", not a special interface:
- **Interfaces:** 819 as the main modal and 806 as the side modal.
- **Scripts:** 7140 `[8548, -1, -1]` and 7246 `[8548]`.
- **Shop varps:** `omnishop_selected_id` (3869) is -1 and `omnishop_lastshop` (3874) is 8548.
- **Shop definition:** db row 8548 (`sailing_boat_shop`, table 39): "Boat Emporium", entries 8549-8551 and the button text "Buy".
- **Events:**
  - list 819:38 slots 0-36, ops 1-6 and 10;
  - side items 806:0;
  - info 806:1;
  - buy, examine and request-info triggers 819:4, 819:3 and 819:5 (script triggers);
  - dropdown 819:41.

Buying itself hasn't been captured yet.

## Ports and docking

From a capture of docking at Port Sarim's buoy and disembarking at its gangplank. The ports are the cache's, in `server/data/definitions/sailing-ports.json`.

**Ports** are db table 194: port id (column 0), name (1), the name in a sentence ("the Pandemonium", 2), the Sailing level to dock there (4), and a requirement for some (5, not used yet). There are 59 rows. Ids 32 and up are islands ("mooring points"), whose gangplanks are scenery rather than jetty planks.

**Every port has a docking buoy and a gangplank**, placed by the cache map:
- the buoy is loc **59769 + port id**, "Buoy" with op "Dock";
- the gangplank is loc **59835 + port id**, a multiloc on varbit 19104 (Board / Disembark; ports also have Board-previous and Board-friend).

Red Rock and Last Light have neither, so they're left out.

**The landing** is the one walkable tile beside the gangplank, on the jetty. Both captured ports land one tile west of their plank: Port Sarim (3050, 3193) and the Pandemonium (3069, 2987). Every other port has exactly one walkable neighbour, which matches the plank's rotation (3 west, 0 north, 1 east, 2 south) except at Entrana. Islands, where every neighbour is walkable, use the rotation.

**The mooring** (where a boat is placed when it isn't where it was left) is the Pandemonium's captured one, applied to every port: out from the plank on the sea side, 4 tiles for a raft and 5 for a skiff or sloop, side-on (angle 1024 for an east-west plank, 512 for a north-south one).

**Dock** (op 1 on a port's buoy, from the boat):
- the boat's per-boat `port` varbit becomes the port's id;
- `sailing_boarded_boat_last_dock` (19145) and `sailing_boarded_boat_last_standard_dock` (19146) become the port's id;
- "You dock the boat at Port Sarim. You will return here if you have to abandon your boat for any reason.", and sound 1794.

The player stays aboard and the boat stays where it is. At sea, the `port` varbit keeps the port the boat last docked at (it was 1, the Pandemonium, until the Dock).

**Disembark** at a port's gangplank, from the boat, here about 9 tiles away:
1. fade out;
2. next tick: "You disembark at Port Sarim." (spam filter), the boarded and sidepanel varbits cleared, the player moved to the landing, and sound 10754;
3. the tick after: fade in.

The boat stays where it was docked.

## Recovery (Junior Jim)

- **The fee is taken from the bank**, with the message "Payment has been taken from your bank." Recovery also brings back boats docked at other ports, not only sunk ones.
- **What was paid:** a raft 250 coins; a camphor sloop 60,000.
- **The boat's port varbit is set to this dock:**
  - raft `sailing_boat_1_port` 19260: from 0 to 1;
  - sloop `sailing_boat_3_port` 19336: from 26 (another port) to 1.

  So 0 seems to mean lost or sunk.
- **A Port Wizard next to Jim does the work.** One of Perrie, Peter, Petra or Paulie (15378-15381) appears at (3059, 2981):
  - teleports in: animation 715, spot animation 1299, sound 201;
  - says (overhead) "Another recovery? This won't take long...";
  - casts: animation 725, spot animation 3546 with delay 10, sound 10900 with delay 35;
  - teleports out: animation 714, spot animation 111, sound 200.
- **Dialogue:** Jim says "All done! The boat is now docked here at the Pandemonium." (chat head animation 568), and the player answers "Thanks!" (animation 567).
- Junior Jim is 14972 (multinpc 14975). He moves around (3058-3059, 2978-2980).

## Customisation (shipyard)

**Getting there:**
- Junior Jim's Customise-boat opens the boat selection (mode 2).
- Choosing a boat moves you to the shipyard, a normal map area in map square (32, 42), after a fade. You arrive at (2084, 2730).
- Your boat is shown at (2091, 2724), with fine offset (64, 0) and angle 1536 (east).
- The shipyard varbits are set: mode 19173 = 1, boat angle 19519 = 1536, fine-x offset 19520 = 1. The sidepanel describes the boat.
- The Shipyard Portal (59722) "Exit" returns you to (3058, 2980) at The Pandemonium. Its own gangplank (59719) boards the boat.

**Boat schematics (59718) "Modify":**
1. Varp 5190 is set to the boat type's row (8110-8112), and varbit 19525 to the boat's slot + 1.
2. Script 2524 `[-1, -3]`, then interface **939** opens as the main modal. Script 8809 initialises it.
3. 939:17 gets slots 0-50 with op 1 and script triggers.
4. Each option's preview is the part's **loc**. Script 8825 takes the loc id from the option's db row (script 9075, default 59660), its animation (9077) and its angle (9076), and passes the loc id to opcode 1214 (`cc_setmodel_loc`, model type 8). The client draws that loc's centrepiece model (shape 10) and never treats the id as a model id.
   - The angles come from table 188: the part's angles row (column 4 of its hull/keel/… row) holds `[boat size, offsetX, offsetY, xan, yan, zan, zoom]` tuples, and 9076 picks the one for the boat type's size (table 166 column 0). The skiff's hull is (-10, 0, 130, 1950, 0, 5000).
   - 9076 reads those tuples one value at a time: a packed db field's low 4 bits select one tuple element (1-based; 0 is the whole tuple).

**Build:** script 8834 calls `if_triggeroplocal` on 939:17 with the option row as one int argument.
- The live packet carried `A6 81 01 00`: a zigzag varint of row **8275**, the skiff's camphor hull.
- The server:
  1. takes the materials from the inventory;
  2. sets the part, with no refund of the old one;
  3. gives Construction XP;
  4. closes 939, clears varp 5190 and varbit 19525, and opens the message box (229) "With the help of some workers, you swap out the hull of your boat." with **no** "Click here to continue", then fades out;
  5. next tick, rebuilds the boat from its new template column;
  6. 4 ticks after the build, fades back in and reopens the message box, now with "Click here to continue". Continuing closes it and the fade overlay.
- The hull swap also moves the per-boat trim varbit with it (trim follows hull). Lower tiers can be built too (downgrades).

### The cache's sailing tables

Everything a part is lives in db tables. tsps reads them at runtime (`CacheDefinitions.getDbRow` / `getDbTableRows`).

| Table | What | Columns used |
| --- | --- | --- |
| 166 | Boat types (rows 8110-8112, also the sidepanel boat type) | 18 recovery fee (raft 250, skiff 3,750, sloop 50,000); option lists by tier: 24 keels, 25 hulls, 26 sails, 27 helms, 29 trims; 31 facility hotspots |
| 178 | Hulls (raft "bases" 8264-8270, skiff 8271-8277, sloop 8278-8284) | 0 name, 7 Sailing, 8 Construction, 12 materials (item, count pairs), 13 stats row |
| 177 | Keels | 3 loc [coord, id, rotation, shape], 6 Sailing, 7 Construction, 11 materials, 12 stats row |
| 179 | Masts and sails | 15 loc [id, coord, rotation, shape], 6 Sailing, 7 Construction, 11 materials, 16 stats row |
| 181 | Helms | 6 loc [coord, id, rotation, shape], 9 Sailing, 10 Construction, 14 materials, 15 stats row |
| 164 | Part stats | 0 HP, 10 armour, 21 storm resistance, 22 rapids resistance, 24 base speed, 25 speed cap, 26 extra acceleration, 27 boost duration, 30 crystal-flecked immunity |
| 186 | Trims (cosmetic painted trims) | |
| 176 | Facilities (97 rows; some per boat size, such as each size's cargo holds and hooks) | 0 name, 6 loc (the first is placed), 8 preview angles row, 12 Sailing, 13 Construction, 17 materials, 22 category |
| 175 | What a facility hotspot allows | 2 facility rows, in order |
| 188 | Customisation preview angles | 0 `[boat size, offsetX, offsetY, xan, yan, zan, zoom]` tuples |
| 187 | Boat name words (rows 8545-8547) | |

**How a boat's stats come together:**
- HP = hull + keel.
- Armour = the keel's.
- Speed and speed cap = the hull's.
- Boost duration and storm resistance = the sails'. Acceleration = 64 + the sails' extra.
- Rapids resistance = the helm's.

These reproduce every captured boat.

**Construction XP isn't in the tables.** It comes from the wiki, and the camphor skiff hull's 881 matches the capture.

## Facilities (shipyard)

From a capture of building and removing a range on a sloop in the shipyard.

**Hotspots** are table 166 column 31, one `[coord, a, b, hotspot row]` tuple each:
- The hotspot id is the tuple's index. The raft has 1 hotspot, the skiff 7 and the sloop 13; the sloop's 11 and 12 are its cannon spots.
- The coord is a template tile on the base-tier template. Its deck tile is the coord minus the boat's base template chunk × 8, the same frame as the other deck locs. Sloop hotspot 2 is deck (4, 9), level 1.
- The hotspot row (table 175) lists the facility rows it allows.
- `a` looks like the side: 1 west, 3 east, 0 on the centre line.
- Facing depends on the facility too. On the centre line everything faces 0 (cargo holds, the inoculation station). A salvaging hook on a west hotspot faces 1, out over the side. The range on east hotspot 2 ended at 1, facing in: OSRS sent it at 3 (`a`) and then twice at 1. So facilities that work over the side face `a` and the rest face `a` + 2. Placeholders face 1 on both sides.
- The facilities that work over the side are taken to be those with column 23 set (cannons, salvaging hooks, trawling nets, chum stations, wind and gale catchers). That's inferred from the hook and the range.
- `b` is unknown.

**What a hotspot holds** is one varbit value: the facility's **1-based position in the hotspot's list**, or 0 for empty. That fits every login value (raft cargo hold 15; skiff mithril hook 4, inoculation station 1, cargo hold 1; sloop salvaging station 6, adamant hooks 5, cargo hold 1) and the built range (1).
- Per boat: hotspots 0-10 at block offset +15 + n; hotspots 11 and 12 at 20207 + 4 × slot and the id after (cache script 8805).
- On the sidepanel: 19156 + n for 0-10, and 20185 and 20186 for 11 and 12 (script 8729).
- Building or removing sets `facilities_unaltered` (block +4) to 0, and it stays 0.

**Schematics:** some facilities and the top-tier parts show as "Unknown" in the customisation interface until their schematic is found (cache script 9078; varbit 1 or more = found). Salvaging stations 19544, gale catcher 19545, eternal braziers 19546, dragon hooks 19547, rosewood cargo holds 19548, dragon cannon 19549, top-tier hulls 19550, sails 19551, helms 19552, keels 19553, ballistic attractor 20227. Tsps sends them all as found at login, since finding schematics doesn't exist yet.

**Empty hotspots** show a "Facility hotspot" loc with op 1 **Build**, but only in the shipyard; at sea an empty hotspot shows nothing. Solid facilities (clip type ≠ 0, such as the range, cargo holds, inoculation station and cannons) block their deck tile; hooks and placeholders don't. The placeholder ids are: raft 59661 (inferred, not captured), skiff 59664 + n, sloop 59671 + n for 0-10, plus 60720 and 60721. Built facilities have op 5 **Modify**.

**Boarding in the shipyard:** the boat's own gangplank (59719, a multiloc on varbit 19104: 59721 Board, 59720 Disembark) teleports you straight onto the deck, level 1, at the boarding tile. There's no fade and no message; the boarded varbits and the sidepanel are set as at a dock. Disembark puts you back at (2086, 2724).

**Build on a hotspot:**
1. Sets varbit 19524 (`sailing_boat_customisation_hotspot_id`) to the hotspot, varp 5190 to the boat type row, varbit 19523 (`sailing_boat_customisation_type`) to **1**, and varbit 19525 to the boat slot + 1.
2. Opens interface 939 the same way as for parts: script 2524, the modal, 8809, the option events, 8809. The events cover 0-8 on a cannon spot and 0-12 on the range's hotspot.
3. Closing it resets 19523, 19524, 19525 and 5190.

**Building a facility:** the Build trigger carries the facility row (8512 for the range). The server:
1. resets the customisation varbits and closes 939;
2. plays animation 3676 (`human_poh_build`) and sound 938;
3. takes the materials (the range: 4 steel bars, 2 charcoal, 1 tinderbox);
4. gives **no XP**;
5. sets the hotspot varbits and `facilities_unaltered` 0;
6. replaces the placeholder with the facility's loc (range 59682) on the deck.

There's no message.

**Modify** (op 5) opens the chat menu (219, script 58) "How would you like to modify this facility?" with "Completely remove it.", "Replace it." and "Do nothing.". "Completely remove it." asks "Really remove it?" with "Yes." and "No.". On Yes:
- animation 3685 (`human_throw_away`) and sound 10753;
- the hotspot varbits go back to 0 and the placeholder returns;
- nothing is refunded.

## Shipwreck salvaging

From captures of salvaging a small shipwreck with a sloop's adamant hook, deploying away from any wreck, and sorting at the sloop's salvaging station. The rest is the OSRS Wiki's (Shipwreck salvaging, each shipwreck's and each salvage's page), in `server/data/definitions/sailing-salvage.json`.

**Wrecks** are loc pairs: an active form with "Inspect" (60464 small, 60466 fisherman's, 60468 barracuda, 60470 large, 60472 pirate, 60474 mercenary, 60476 Fremennik, 60478 merchant) and a sunken form with no ops (the next id).
- The cache map places every wreck sunken: 16 small spots (two groups of 8), and the other types in groups of 6 (barracuda's 43 are strung out unevenly). The small group south-east of the Pandemonium is at about (3085-3132, 2928-2989).
- The server raises some of each group, sinks a wreck when its time is up, and raises another of the group (Wiki: "When one shipwreck sinks, another in the area immediately rises").
- Salvaging starts a wreck's despawn timer: small 2:30, fisherman's, barracuda, large and pirate 3:00, mercenary 3:15, Fremennik 3:45, merchant 4:00. When it sinks: "You salvage all you can from the shipwreck before it is reclaimed by the sea."

**Deploy** (op 1 on a salvaging hook):
- No wreck in range: "There are no shipwrecks within range of the salvaging hook." Nothing else.
- Otherwise: "You cast out your salvaging hook towards the shipwreck...", player animation 13576, and the hook loc plays 13573.
- 3 ticks later varbit `sailing_sidepanel_player_at_facility_n` (19193 + hotspot; 19200 for hotspot 7) goes to 1, and from then on every tick the player replays 13577 and the hook 13574.
- The first salvage came 10 ticks after the cast: "You reel in some salvage." (spam filter), the salvage in the inventory, and the wreck's XP (small 10).
- Players roll every 4 ticks (Wiki), against each wreck's success chart: per hook tier a `low`/`high` out of 256, interpolated by Sailing level (the standard skilling formula; small with a bronze hook is 50-100, with a dragon hook 67-135).

**Sort-salvage** (salvaging station: the boat facility 59699-59701, or a port's 60462/60463):
- "You begin sorting through your salvage...", animation 13599, sound 10864.
- Every 3 ticks one salvage is sorted: "You sort through the small salvage and find: 1 x Bones.", the loot in its place, sound 10860, and the salvage's XP (small 5.5; 5 and 6 alternate in the capture).
- The animation replays with each, with sound 10864 after the first and 10866 after the rest.
- With none left: "You have no more salvage to sort."
- Loot: each salvage's pre-rolls first (1 in n each), then its main table by weight.

## Cargo hold

**The loc** is a multiloc (60245 on the raft), chosen by varbit 19134:
- 0 gives "Basic cargo hold" (60577) with Open / Deposit-all / Modify;
- 1 gives 60581, whose first op is Deposit-held (when carrying cargo).

**What it holds** (OSRS Wiki, Cargo hold):
- **Capacity:** by boat and hold tier. A basic hold has 20 slots on the raft, 30 on the skiff and 40 on the sloop; a rosewood hold has 120, 180 and 240.
- **Slots:** every item takes a slot, except that a stackable item's whole stack takes one.
- **Which items:** only the wiki's "Storable items": sailing capes and tools, salvage, courier crates, bounty items, repair kits, cannonballs, ship drinks, fish, fish offcuts and crates, and fishing gear. Noted items aren't accepted.
- **Recovery losses:** courier crates, bounty items, salvage, fish and full fish crates are lost when a shipwright recovers the boat.

**Opening it:**
1. Op 1 "Open". You walk next to the hold and face it.
2. Varp 5204 (`sailing_boat_cargohold_inv`) is set to the boat's inventory: 963 for slot 1, up to 967 for slot 5. That inventory is sent in full.
3. Sound 10907, then script 917 `[-1, -1]`.
4. Interface 943 opens as the main modal and 944 as the side modal.
5. Events:
   - 943:10 slots 0-239, ops 1-6 and 10;
   - 944:1 slots 0-27, ops 1-6 and 10, plus drag;
   - 943:18 slots 0-4, op 1.
6. Text and title: 943:5 shows the capacity ("20"), and script 227 sets the title to "Cargo Hold: <boat name>".
7. The `busy` varbit (12393) is 1 while it's open.

**Closing:** varp 5205 and `busy` go back to 0, and 944 then 943 close.

**Items:**
- **Withdraw** is an op on 943:10 at the hold slot. **Deposit** is an op on 944:1 at the inventory slot, and the item goes to the hold's first free slot.
- **Quantity:** the 1 / 5 / 10 / X / All buttons (943:20-24) set `depositbox_mode` (varbit 4430) to 0, 1, 4, 3 and 2.
  - **Op 1 is the selected quantity.** Ops 2-6 are 1, 5, 10, X and All, with the selected one moved to op 1 (cache scripts 8873 and 8896). Op 10 is Examine.
  - **X** runs script 108 "Enter amount:" and reads the typed count.
  - Asking for more than there is moves what's there. Withdrawing 5 unstackable items takes them from several slots.
- **Whitelist:** varp 5205 is a bitmask of the inventory slots that can be deposited. It's rebuilt after every inventory change while the hold is open.
- **Repair kits:** the sidepanel's repair kit count (varbit 19210) is 5 uses per repair kit in the hold, and follows every change.
- **Refused:** "The cargo hold cannot store that item." (game message).
- **Deposit buttons** (943:13 Cargo, 14 Salvage, 15 Inventory):
  - Deposit Inventory moves everything storable, with sound 10905.
  - With nothing to move: "You have no cargo to deposit." / "You have no salvage to deposit.", with sound 2277.
- **Item stacking:** the "Item stacking" toggle (varbit 19592) sends nothing to the server. It only changes how the client draws the hold.
- **Warning:** "Dismiss" (944:8) sets varbit 19123 and hides the warning on the side panel.

**The tools compartment:** shared by all your boats, and taking no space. Taking a tool is op 1 on 943:18, with sound 2582.

| Slot | Tool | Item(s) | Message |
| --- | --- | --- | --- |
| 0 | Captain's log | 31986 | You collect your captain's log from the tools compartment. |
| 1 | Spyglass | 31803 | You collect a spyglass from the tools compartment. |
| 2 | Current duck | 31805 | not captured |
| 3 | Crowbar | 31807 | not captured |
| 4 | Diving gear | 7534 + 7535 | You collect some diving gear from the tools compartment. |

Depositing a tool, by Deposit Inventory or singly, puts it back in the compartment.

**Tool unlocks:** script 9138 shows a tool only once its quest progress is reached. The captain's log always shows.

| Tools row | Shown when |
| --- | --- |
| 8010 | varbit 18314 ≥ 50 (The Pandemonium, which also switches the log between 31985 and 31986 at 46) |
| 8011 | 18314 ≥ 50 and 18282 ≥ 40 |
| 8012 | 18314 ≥ 50 and 18317 ≥ 20 |
| 8013 | 18314 ≥ 50 and 1895 ≥ 40 |

## Messages

| Where | Type | Text |
| --- | --- | --- |
| Boarding | spam | You board your boat. |
| Recovery | game | Payment has been taken from your bank. |
| Recovery | npc say (Port Wizard) | Another recovery? This won't take long... |
| Recovery | dialogue (Junior Jim) | All done! The boat is now docked here at the Pandemonium. |
| Hull upgrade | message box | With the help of some workers, you swap out the hull of your boat. |
| Cargo hold | game | The cargo hold cannot store that item. |
| Cargo hold | game | You have no cargo to deposit. / You have no salvage to deposit. |
| Tools compartment | game | You collect your captain's log / a spyglass / some diving gear from the tools compartment. |

## Where tsps differs

- **Deck level:** people aboard stand on level 0 of the deck scene, not level 1. The tsps client already raises actors on a world entity by the deck height, so level 1 would lift them twice. Matching OSRS needs a client rendering change.
- **The HP-bar NPC** isn't placed: that needs NPC sync inside a boat's world view.
- **The boat's name varbits** (19149, 19150) aren't sent: their encoding is unknown.
- **The linen sail** isn't placed, because its live id is a fairy ring in revision 237. Neither are the skiff's and sloop's canvas sails, for the same reason.
- **New boats are base tier, with only a basic cargo hold** (OSRS Wiki, Sloop: "A newly purchased Sloop with no facilities"; the basic hold comes with every boat).
  - The hold's hotspot and value come from the captures. The raft uses hotspot 0 with value 15. The skiff's is hotspot 6 with value 1: the shipyard shows hotspots 0-3 as empty placeholders, then the hook (4), the inoculation station (5) and the hold (6). The sloop's is hotspot 10 (its last) with value 1.
  - The parts are a wooden hull (template column 0), bronze keel, wooden helm, wooden sails and wooden trim.
  - The part loc ids run in tier order in the cache:
    - keels: 59516-59522 (skiff), 59523-59529 (sloop);
    - sails: 59530 (raft), 59537 (skiff), 59544 (sloop);
    - helms, three ids each: 59554 (raft), 59576 (skiff), 59598 (sloop);
    - trims: 59624 (skiff), 59642 (sloop).
- **Base-tier stats** come from the wiki's component tables:
  - HP is hull + keel: skiff 30 + 50 = 80, sloop 40 + 70 = 110. This checks out against the captures: teak skiff 60 + steel 60 = 120, camphor skiff 180, camphor sloop 160 + adamant 100 = 260.
  - Armour is 100 (bronze keel).
  - Speed 192, speed cap 320, boost 20 and acceleration 64 (0.5).
  - No resistances.
  - Wooden per-style defence isn't known, so it isn't sent.
- **Skiff and sloop:**
  - Only their sails' "down" animation (and the skiff helm's inactive one) is known, so other sail and helm animations are skipped.
  - Their helms sit on the hull's edge, so Navigate is used from beside them rather than on their tile.
  - Recovery fees are the wiki's base fees (4,125 and 50,000). The captured camphor sloop cost 60,000.
- **Client:**
  - A world view's collision isn't filled in, so a run step on a deck is drawn as if the deck were open floor. The server checks the real deck.
  - A despawned boat's added deck locs are forgotten, since the next boat reuses its entity index and deck coordinates.
  - A loc animation on a deck rebuilds the boat's scene with it, so it starts a moment late. The same animation sent again while it plays (a salvaging hook's idle, every tick) only extends it.
- **The skiff and sloop spawn tile** (3075, 2987) is one tile east of the raft's. tsps only has the raft so far.
- **Cargo hold:**
  - `busy` isn't set while it's open, because plugins get no close hook to clear it.
  - Varbit 19134 isn't driven, so the loc's first op stays Open (no Deposit-held).
  - Guessed rather than captured:
    - the loc's "Deposit-all" (taken to mean everything storable);
    - the full-hold message ("Your cargo hold is full.");
    - a tool you haven't stored (nothing happens);
    - diving gear needing both parts to be stored.
  - The wiki's bounty items aren't listed, since no item name matched.
- **Shipyard:**
  - The shown boat, and the owner while aboard it, are shown only to the owner. Other players in the shipyard see neither.
  - "Shipwright assistance" (paying to build without the Construction level) isn't built yet.
  - Facilities are built, removed and replaced there, but only placed: none of them can be used yet (cooking on the range, firing cannons and so on). A cargo hold's tier doesn't change its capacity yet.
  - Guessed rather than captured for facilities:
    - "Replace it." opens the hotspot's options, and building over a facility replaces it without a refund;
    - a hotspot's Build and a facility's Modify do nothing away from the shipyard;
    - which facilities face out over the side (column 23; see Facilities);
    - the raft's placeholder id (59661).
  - Guessed rather than captured:
    - the part names in the swap message ("mast and sails");
    - the level, materials and "already has that" messages.
  - Materials come from the inventory only.
- **Ports**, guessed rather than captured:
  - Disembarking at a port's gangplank docks the boat there if it wasn't (the capture docked at the buoy first). It needs the port's level unless the boat is already docked there.
  - The too-low-level message, and that boarding a port's boat needs no level.
  - The mooring for every port but the Pandemonium (its offsets, on each port's sea side), and the landing for islands (by the plank's rotation).
  - Locs on the shore can be used from up to 12 tiles away while aboard (the capture used a gangplank from 9).
  - Islands only differ in not being a "standard dock" (19146). Column 5's requirement isn't checked.
- **Sailing** is a skill (23). Salvaging and sorting give Sailing XP; nothing else does yet.
- **Salvaging**, guessed rather than captured:
  - the hook's reach: 8 tiles from the hook to the nearest tile of the wreck (about what it is in OSRS, as played);
  - facing out over the hook's side of the boat while working it (the capture faced the hook tile, from beside it);
  - how many wrecks a group keeps raised (two thirds, from the Wiki's "typically 4 of the 6");
  - the first roll 6 ticks after the cast, then every 4;
  - the messages for too low a level, a full inventory and finding nothing, and stopping without a message when you walk, leave the boat or sail out of reach;
  - the hook animations for every boat size (the captured ones are the sloop's).
- **Salvaging, not yet:** crewmates, salvage into the cargo hold, "Inspect" on a wreck, clue scrolls and soup from sorting, and opulent salvage's rare seed, herb and gem tables (rolled as nothing). Tsps floors XP on every gain, so 5.5 XP a sort counts as 5.
- **Boat selection and recovery:**
  - The bank isn't sent when interface 934 opens.
  - The Port Wizard's line is only shown overhead, not also in the chatbox.
  - Stored HP is always full, because boats don't take damage yet.
  - A boat sunk by a teleport, Escape or death sends "lost at sea" (253); capsizing (254) comes with boat damage. A boat at sea with its owner sends port 0.
  - Guessed rather than captured:
    - falling back to coins in the inventory ("Payment has been taken from your inventory.");
    - the message for not having enough coins.
  - None of the tool quests exist yet, so only the captain's log shows. The developer command `::sailingtools` sets the unlock varbits for your own client. The server doesn't check unlocks, so a hidden tool can still be deposited.

## Wanted captures

- Taking the helm, setting and trimming sails, steering and stopping.
- Teleporting from sea, Escape, and logging out and back in at sea.
- Disembarking at a port's gangplank without docking at its buoy first.
- Buying a boat (Junior Jim's Buy-boat).
