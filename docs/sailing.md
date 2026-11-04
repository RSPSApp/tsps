# Sailing

Design for Sailing in tsps: player-owned boats that sail the main world as world entities. It follows live OSRS as closely as possible; where the OSRS Wiki is silent, behaviour was checked in live OSRS and is marked **(live-checked)**.

**Status:** the first PR (engine, raft and saving) is implemented. What live OSRS sends, from wiki pages and live captures, is recorded in [the OSRS reference](sailing-osrs-reference.md).

## Scope

The first PR delivers a playable raft end to end:

- the engine: world views, boat instances, movement and collision, and world-entity sync to **every nearby player**, not just the owner
- raft content: boarding at a gangplank, the helm and sails, disembarking at a dock
- saving: owned boats, where each boat is, and the rules for leaving a boat (disembark, teleport, Escape, death, logout)

Later PRs: the cargo hold, skiff and sloop, shipbuilding facilities and hull upgrades, boat hitpoints and capsizing, port tasks. Other players **boarding** your boat is out of scope for now; they can see it and you on it.

## OSRS rules

| Topic | Rule | Source |
| --- | --- | --- |
| Boat types | Raft (1x3, 1 facility slot), skiff (2x5, 7 slots), sloop (3x10, 9-11 slots); bought from shipwrights | Wiki: Sailing, Boat |
| Boats owned | 1 at level 1, 2 at 15, 3 at 50, 4 at 78, 5 at 91 | Wiki: Boat |
| Location | A boat is at a single port (or mooring point) at a time. Disembarking there sets it | Wiki: Boat, Mooring point |
| Hitpoints | From hull and keel; no natural regeneration. Repaired by upgrades, a shipwright (50 coins per HP) or repair kits | Wiki: Boat |
| Logging out at sea | You log back in on your boat, at sea | live-checked |
| Teleporting from the boat | The boat disappears (is **sunk**). No gangplank can board it until a shipwright recovers it | live-checked |
| Escape | A helm option for a stuck boat with no teleport. The boat sinks, same as teleporting | live-checked |
| Death at sea | Gravestone at the last gangplank you set sail from; some cargo is lost | Wiki: Sailing |
| Capsizing (0 HP) | You are moved to the last gangplank you set sail from and keep your inventory; some cargo is lost | Wiki: Sailing |
| Return point | Disembarking at a gangplank or mooring point, or clicking a buoy, sets where you are sent after Escape or capsizing | Wiki: Mooring point, Buoy |
| Shipwright | At large ports: buy, destroy, customise, and retrieve a sunk boat or one at another port. The Pandemonium's is Junior Jim | Wiki: Shipwright |
| Recovery fee | Raft 250 gp, skiff 4,125 gp, sloop 50,000 gp; more with damage and built facilities | Wiki: Shipwright |

Cargo lost on death, capsizing and teleporting (courier crates, bounty items, salvage, trawling fish, fish crates) matters once the cargo hold exists; PR 1 has no cargo.

## Concepts

- **Owned boat**: a saved record in the player's save: its type, name, hitpoints, facilities and location. A player owns 1-5.
- **Boat instance**: an owned boat that is out at sea, live in the world. At most one per player. It exists only while its owner is aboard (or logged out aboard, see below).
- **World view**: a separate coordinate space with its own map, collision and entities. The main world is world view -1; each boat instance is a world view keyed by its world-entity index. Players and NPCs belong to exactly one world view.
- **Deck frame vs world frame**: a boat's deck is a 13x13-zone scene placed far outside the real map (tiles 9600+), with the boat's cache template zone copied into its centre. People aboard stand in deck coordinates, on level 0 (OSRS uses level 1, but the tsps client already raises actors on a boat by the deck height). The boat itself has a world-frame position (1/128-tile precision) and angle, and is drawn there. Converting a deck tile to the world tile under it uses the boat's position and angle.
- **Root tile**: for anything measured in the main world (sync range, main-world locs like gangplanks), a player aboard counts as standing on the world tile under their deck tile.

## Pandemonium tutorial ship

The [quest guide](https://oldschool.runescape.wiki/w/Pandemonium) puts the player aboard Will and Anne's boat, then has them deploy its hook at the wreck. [RSProx capture 381](https://rsprox.net/download/381), revision 231, identifies the owned tutorial as entity 16 at tick 336: an 8x8 scene copied from chunk `(480,800)`, with a 2x5 hull. The active revision 241 cache maps that hull to world-entity type 2 (bounds 256x640, deck centre `(512,448)`); type 1/chunk `(480,807)` is the raft. Boarding is local `(4,4)`, Will `(4,3)` and Anne `(3,2)`, all within the two-column walkable deck.

Initial boarding follows the ship with a freely rotatable camera, rather than sending fixed move/look commands. In recording 381's Sailing Beta, boarding at tick 335 targets the world entity and Will automatically speaks at 337; the [October 2026 quest guide](https://www.youtube.com/watch?v=oY8TutuQ-6s) also shows the view changing during the onboard dialogue. The canonical crew conversation keeps stage 6 until Anne's last instructions, then changes to 8. The native helm interaction itself earns stage 10; the extra route-acknowledgement menu is unnecessary. Each spoken crew line turns the player to that actual owned deck actor, and taking the helm releases Will's initial facing target. A deferred boarding conversation cannot replace newer UI or survive its ship's retirement; interrupted stage-6 saves can recover by talking to the crew. Stage-8/10 resumes retain their helm/sails route, while the later Deploy and shore cameras remain separate.

The capture places `sailing_intro_navigating` at `(4,6)`, `sailing_boat_sails_intro` at `(4,4)` and `sailing_intro_salvaging_hook` at `(3,4)`, rotation 1, all on display plane 1. Those map to current ids 59620, 59553 and 60480. Hook opflags 15 include Deploy; the real OPLOC1 at tick 497 names the parent's historical id 58012, while its visible child is 60482 in this cache. Server-side deck lookup remains at z=0. Keeping the hook in the initial blueprint also makes the first native sync after a wreck-stage login send it.

The world map already contains `sailing_intro_wreck` 58208 at `(3031,3035,0)`; no extra wreck model belongs on the deck. The tutorial's course follows the observed full-sail start, headings and stopped wreck point from ticks 368–459, checked with the real hull/collision code. The course does not replay optional sail-trim boosts, so exact journey timing is not claimed. Arrival keeps the voyage camera; the capture's later fixed camera belongs to Deploy.

Deploy copies the capture's separate cinematic ship from map origin `(1472,4480)` into an owner-only 8x8 instance. At source `(1498,4512,1)`, the camera moves to `(1490,4509,550)` and looks at `(1510,4514,350)`, with rates 232/100. The active cache's named cutscene Will/Anne are 14961/14966. The canonical transcript drives the human hook drop/reset (13576/13578), cup/medallion double box, approach, and simultaneous human-overboard/Anne-push sequences (13083/13084). These actor/sequence pairs are observed together in capture 381; they are not borrowed from other models.

The push switches the same instance to shore origin `(3008,2944)`, player source `(3034,2995,0)`, camera move `(3026,3000,550)`/look `(3036,2993,350)`, and captured floor/get-up sequences 10044/8328. Native Continue advances the existing shore text. Stage 14 remains pending until its owned final fade finishes, when stage 16 and normal-world landing `(3049,2970,0)` commit together. Closing, replacement dialogue, logout, death or leaving removes only that scene's actors/tasks/source; retries retain a carried cup. Pose cleanup checks the last accepted animation generation, including after a sync flush, so it cannot clear a newer feature's animation. Existing version-two stage-16 and later saves are retained, as is the older stage-ladder migration; there is no blanket rewind of completed progress. Tests exercise native input, instance/camera packets, actor privacy, item/stage commits and cancellation/save recovery; browser rendering and exact frame parity were not tested.

Jim's first captain's-log conversation assigns courier task 599 at its canonical request message, before the first Port Sarim ledger visit. A full task list keeps the request pending for retry. A carried source-port crate can be returned to its own ledger without a boat: only its exact carried task's taken count decreases; no delivery, quest progress or reward is granted. Other cargo and crew remain attached to their own task/boat. Ordinary shipwrights refuse to destroy a boat while its hold contains outstanding noncancellable task cargo. Withdraw that crate and return it to its source ledger (or deliver it) first; unrelated cargo retains the normal destruction warning.

## Data model

A new `sailing` block in `PlayerSave`, owned by core (not a plugin attribute), because the engine's exit rules read and write it:

```ts
sailing: {
  boats: Array<{
    slot: number;             // 0-4
    type: "raft" | "skiff" | "sloop";
    name: [number, number, number]; // three words from cache db rows 8545-8547 (0 = none)
    hitpoints: number;        // PR 1: stored, not yet used
    facilities: number[];     // per hotspot, the facility's 1-based position in its list; empty = the type's defaults
    location:
      | { kind: "docked"; dock: string }                                // at a port or mooring point
      | { kind: "at_sea"; fineX: number; fineY: number; angle: number } // owner logged out aboard
      | { kind: "sunk" };                                               // needs a shipwright
    cargo: ({ id: number; amount: number } | null)[]; // the cargo hold, by slot
    parts: { hull: number; keel: number; sails: number; helm: number }; // tiers 0-6 into the cache's part lists
  }>;
  activeBoatSlot: number | null; // the boat the player is aboard or last set sail in
  returnPoint: { x: number; y: number; level: number } | null; // last gangplank, mooring point or buoy
  tools: number[]; // tools compartment slots holding their tool, shared by all boats
}
```

What a cargo hold accepts is data (`plugins/skills/sailing/data/sailing-cargo.json`): the tools by item id, and every other storable item by exact name or name prefix, grouped by category. `lostOnRecovery` marks the categories a shipwright's recovery loses.

Docks are every port in the cache (`plugins/skills/sailing/data/sailing-ports.json`): its id, name, docking level, buoy, gangplank, where the player lands on disembarking, and where a boat is placed when it isn't where it was left. What only some docks have, such as a shipwright or the shipyard, is in `plugins/skills/sailing/data/sailing-docks.json`.

The cache's `sailing_dock` table has 61 rows; 60 are docks here. Ports have a `sailing_gangplank_<port>` in the map; the 26 mooring points have none. Three docks have no land or sea coordinates in the table and take theirs from the map: Red Rock (dock 22) and Wyrmscraig and its cavern (59, 60, wide gangplanks). Their landing is the walkable tile beside the gangplank, and the boat moors on the water side the way every other port's does (4.5 tiles out for a raft, 5.5 for a skiff or sloop, along the gangplank's row). Red Rock's landing (2808, 2509), its dock number and "You dock the boat at Red Rock and disembark." are from an rsprox capture; no capture shows a boat spawned at these docks or anything at Wyrmscraig. Last Light has no gangplank in the map and is left out. The wide proxy gangplank at 2087, 2723 is the shipyard's.

## Lifecycle

One state machine in core owns every transition, so no path can leave a boat half-alive (the trade and bank bugs came from exits that forgot to clean up).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| docked at A | board at A's gangplank | at sea (aboard) | spawn the instance at A; send the deck scene; move the player onto the deck; set `returnPoint` |
| docked elsewhere / sunk | board at A's gangplank | - | refused; the shipwright message |
| at sea | Dock at port B's buoy | at sea, docked at B | the boat's port becomes B; set `returnPoint` |
| at sea | disembark at port B's gangplank | docked at B, where it is | move the player to B's landing tile; dispose the instance; set `returnPoint` |
| at sea | teleport (any source) | sunk | dispose the instance; the teleport proceeds |
| at sea | Escape (helm) | sunk | dispose the instance; move the player to `returnPoint` |
| at sea | death | sunk (to confirm) | dispose the instance; gravestone at `returnPoint` |
| at sea | logout / disconnect | at sea (saved) | save the boat's position and angle; dispose the instance |
| at sea (saved) | login | at sea (aboard) | respawn the instance at the saved position; board the player |
| sunk | shipwright retrieve at port P | docked at P | fee: raft 250 gp (PR 1 has no damage or facilities) |

Teleports are caught in one core hook that every teleport passes through, not in each spell or item.

## Engine (core, TypeScript)

tsps has no world views, but it has `PrivateArea` (used by Construction's house): collision, pathfinding, object lookup and entity visibility are already scoped by the area an actor is in. A boat's deck is a `PrivateArea` at the deck coordinates, so walking and deck objects work without threading a world-view id through the engine.

- **Deck area** (`BoatDeckArea extends PrivateArea`): every tile of its scene is blocked except the boat type's walkable deck tiles; deck objects that block add their flags. Deck coordinates have no cache region, so without this they would read as walkable.
- **BoatManager**: allocates world-entity indices (3000-3999) and deck regions, builds deck collision from the template zone, ticks movement, and disposes instances. Ported from xrsps.
- **Movement and collision** (rsprox, Sailing recordings 856, 907, 908, 1030-1032, 3457, 3461, 3578, 3579): full sail the hull's base speed (wooden 192 fine units, 1.5 tiles, a tick), half sail half that, reverse 64 whatever the hull. The boat eases into that speed by its acceleration a tick (64, half a tile, plus the sails' extra from table 164), both ways: rsprox shows a sloop gathering way at 0.5, 1, 1.5, 2 tiles a tick and, stopped from 2.5, drifting on at 2, 1.5, 1, 0.5. Running aground loses all way at once. A trim (or a released wind mote) adds 64 for the sails' boost duration; a Barracuda Trial's rapids push the sails up to the hull's speed cap; nothing takes a boat past its cap plus 64. Turning 128 units of angle a tick without losing speed. A move is checked in half-tile steps, so the boat can't hop over a thin strip of land. A tile is sailable when its level-0 overlay is water (decoded from the cache map) and it has no solid object; only tiles the hull newly covers are checked. Ported from xrsps (`BoatMovement`, `BoatCollision`, `WaterMap`).
- **Sync**:
  - `REBUILD_WORLDENTITY` sends a boat's deck scene (template chunks) to each client that sees it.
  - `WORLDENTITY_INFO` is per viewer: each tick, boats whose world tile is in a viewer's range are added, moved or removed, like NPC sync.
  - Player and NPC sync measure range from root tiles, and a deck area counts as the main world for who-sees-whom. When a player on a deck enters a viewer's list, the encoder writes its world-view id, and a player the viewer already sees who boards or leaves a boat is removed for one frame and added back with the new one. The client places them on the boat.
  - `NPC_INFO` gains the viewer's root tile in its header (server and client), so a player on a deck sees main-world NPCs where they are.
  - While a player is on a deck, the normal map keeps following their root tile, so the sea streams as the boat moves.
- **Deck locs** (helm, sails) are sent per viewer as loc spawns in the deck scene.

## Content (plugins)

- boat types (`plugins/skills/sailing/data/boats.json`): template zone, size, hull bounds, deck centre, walkable deck tiles, deck locs, stats, facility hotspots, part tiers and loc animations. The raft, and the skiff and sloop with camphor hulls.
- gangplanks: Board / Disembark, routed to the lifecycle
- helm: Navigate (walking onto the helm tile first) / Stop-navigating, the sail buttons (move mode from varbit 19175), clicking to set a heading; the first heading after taking the helm (moored, 4) sets full sail, while with the sails lowered at the helm (stopped, 0) a heading only turns the boat, on the spot at 128 a tick (the user's crew-combat capture: 640 -> 1280 in five ticks with the sails down after the Stop button); Escape, after a yes/no confirmation. Asking for more speed at full sail says "The boat is already going as fast as it can."
- helm animations (rsprox: the skiff's and sloop's; boats.json `anims.helm`, each size's set from the cache: `sailing_alpha_helm_raft01_*`, `sailing_alpha_helm_small01_*`, `sailing_helm_3x8_*` and their `human_` versions): taking the helm plays `active01` on the helmsman and the helm loc together; every 10 ticks after, both replay `active01_loop` while they navigate (the trim's own loop replaces it while the sails are trimmed); leaving resets the helmsman and plays the loc's `inactive01`. The raft's are matched by name, not captured. Navigate walks to the boat type's helm stand tile (boats.json `helmStand`, from the wheel), which the helm animations are made for (rsprox): the raft's own helm tile, south of the skiff's wheel, south-east of the sloop's (every recorded sloop navigation). At the helm the helmsman faces the bow, three tiles ahead (rsprox: the skiff's facing, the sloop's face angle 0), not the wheel. Stop-navigating resets the helm animation facing the bow and turns them to the wheel a tick later (live turns them on the same tick: face angle 768 on the sloop, 1024 on the skiff). Clicking any other loc from the helm leaves it and stops the boat (rsprox, salvaging hooks' Deploy from the helm); the sail cloth's options are used from the helm
- sails (rsprox capture of a skiff's sails, tick by tick): a boat's sail is two deck locs, the mast (the sails part) and the sail cloth beside it (`sailing_boat_sail_kandarin_<size>_<linen|canvas|cotton>`, the material the built sails' option names). Every change plays on both on the same tick (the cloth with the `_offset` animation): the transition (`down_to_full`, `full_to_half`, ...) or, when the state doesn't change, the state's own loop; a tick later the new state's loop (`down`, `half` or `full`). Full and half are up; stopped, moored and reversing are down. Each size's animations are in `boats.json` `anims.sail`.
- helm sounds and lines (rsprox captures, rev 235): taking the helm plays 10792 on the raft's 1x3 helm (49 recordings) and 10807 on the skiff's and sloop's (210 and 35), leaving it 10793 or 10808 (boats.json `anims.helm.sounds`); live sends no chat line when the helm is taken
- gangplank lines (rsprox captures, rev 235-239): "You board your boat." and the disembark lines are spam. Disembarking where the boat was docked says "You disembark at <port>."; where it wasn't, "You dock the boat at <port> and disembark." (both in the same recordings at Port Sarim, the Pandemonium and Musa Point)
- salvaging station (rsprox captures, rev 235, 3752 Sort-salvage attempts): the begin line is a game message; each find is spam with synth 10860; the begin and every sort after a find play 10864, 10865 or 10866 at random; no line follows the last salvage; with none: "You do not have any salvage to sort through." in a message box
- courier crates in the cargo hold (rsprox captures, rev 235): taking one out plays `human_pickuptable` with synths 10903 and 10908 and closes the hold; Deposit-held plays `human_pickuptable` on the click, then a tick later synth 10905 and "You deposit some cargo into the cargo hold."
- the sail cloth's options (rsprox): live sends deck locs with op flags (`loc_add_change_v2`), and the cloth shows only "Set" (op2, `0b10`) while the sails aren't set and only "Un-set" (op5, `0b10000`) while they are; reversing counts as set although the sails stay furled. Every sail change re-sends the cloth on the click's tick, before the animations (`setSailClothOps`, straight to the viewers: a loc that arrives after its animation starts over without it). Set raises full sail and Un-set stops, as the side panel's button, for whoever is at the helm; with nobody steering: "You or a crewmate must be navigating at the helm to adjust the sails." A crewmate walks beside the cloth; the helmsman uses it from the helm.
- gusts and Trim (`Trim.Helm.js`; the user's capture of a trim, tick by tick, and the gusts in about a hundred rsprox.net recordings, rev 235-238): while the sails are set (half or full), a gust comes when the boat's gust timer runs out: "You feel a gust of wind.", sound 10839, the cloth re-sent with Trim (op flags `0b10001`) and the size's gust wind (`vfx_wind_sail_<size>_full01`) on the cloth every tick. Trim catches it within 14 ticks: "You trim the sails, catching the wind for a burst of speed!", the helm's `trim_sails01` on the helm loc and the helmsman, sounds 10842 and 10841, the cloth back to `0b10000`, the boost wind (`_speedboost01`) every tick, and the trim loop every 4 ticks. The wind shows only while the sails are set (rsprox: lowering them stops it at once). The boat sails at its hull's speed cap (table column 25) for the sails' boost duration (column 27: 20 to 36 ticks; 24 in the capture, teak sails); then "The wind dies down and your sails with it." and `trim_sails02`. Left alone, a gust dies down after 14 ticks (271 of 300 recorded) with the same message. The next gust comes 50 ticks after a trim (334 of about 420) or 49 after an untrimmed gust dies down. The timer keeps running while the sails are down, so a gust can come as soon as they go up; a boat's first comes 49 ticks after its sails are first set. Trim with no gust: "The sails are already catching the wind well." Animations per size are `boats.json` `anims.trim`; the sloop's wind effects (`large01`) are matched by size, not seen in a capture. The client draws tile graphics on a deck tile through the deck's overlay map (`GfxManager.listWorldInstancesInView`), as it places NPCs aboard; before, they were only matched against normal map squares and never drawn. Not done: the boost's speed at half sail (half of the cap here) and trimming by a crewmate away from the helm (the helmsman animates) Our `loc_add_change` carries the flags as an optional ninth byte, and the client hides the ops whose bit isn't set
- shipyard: Junior Jim's Customise-boat takes the boat to the shipyard, whose boat schematics (interface 939) swap its hull, keel, sails or helm for any tier, at the cache's levels and materials, for Construction XP; parts, stats and fees come from the cache's sailing tables at runtime. Aboard the boat there (its own gangplank), a facility hotspot's Build builds any facility the hotspot allows (no XP), and a facility's Modify removes or replaces it; hotspots, facilities and materials are the cache's too
- Summon boat tablets (`SummonBoat.plugin.js`; the user's rsprox captures of four breaks, and the Wiki): Break near a dock or mooring point opens the boat selection in its Summon mode (varbit 18553 = 6, table 149 `boat_selection_type_teleport_boat_with_focus`) with varp 5006 (`sailing_boat_selection_teleport_dock`) and 5005 set to the dock's row, and busy (varbit 12393) on; closing it without a choice clears them all. Choosing a boat with a teleport focus (or a greater one) moves it there as a shipwright's recovery does, losing the same cargo, and sets its port varbit; the player breaks the tablet at once (`poh_smash_magic_tablet` 4069 delayed 16, sound 965 delayed 15), and two ticks later "Your boat has been summoned to <the dock>." with `teleport_other_casting` (spotanim 343, seq 1818), area sound 199 and the tablet used up; busy clears two ticks after that. Away from a dock: "You need to be near a dock or mooring point to use this tablet." "Near" is within 16 tiles of the gangplank or landing here (the cache's dock zones are server side; the captured breaks were 6 and 13 tiles away). "Last boat" summons the boat last summoned (attribute `sailing:last-summoned-boat`) without the interface; it isn't captured, and neither are the no-focus, same-dock and nothing-summoned-yet messages, which are ours
- Teleport to boat tablets (`BoatTeleport.plugin.js`; Wiki, not captured): teleport the player to the dock or mooring point where a moored boat with a greater teleport focus is, without boarding it. The boat is picked in the boat selection's Teleport to Boat mode (8).
- teleport foci: each boat's `sailing_boat_N_teleport_focus` varbit (block offset 12: 19270 for slot 1) is 1 with a teleport focus and 2 with a greater one (rsprox). The boat selection greys out boats by it: table 149's Summon mode `requires_teleport_focus` (either focus), Teleport to Boat `requires_greater_teleport_focus`
- shipwright: Junior Jim at The Pandemonium retrieves a sunk raft for 250 gp (PR 1 needs this, or a sunk raft is stuck forever)
- side panel events (rsprox, every boarding): the crew picker (937:20) over the facility slots, its
  Back button (937:29, 0-11) and the crew tab's radio buttons (937:38, 0-3), with the panel.
- facility ops: built facilities are sent with op flags (rsprox, every capture): at sea ops 1-4 (`0b1111`, no Modify), in the shipyard only Modify (`0b10000`).
- facility facing: on a side hotspot, facilities that work over the side (cannons, hooks, nets, wind catchers) face out and the rest (a range, a keg) face in; chum stations and spreaders face in although they work over the side (rsprox: all 431 recorded placements). The centre line faces 0.
- salvaging: shipwrecks rise and sink at every site the cache places them; a boat's salvaging hook reels salvage in from one nearby for Sailing XP, and a salvaging station (on a boat or at a port) sorts it into loot for more. Data in `plugins/skills/sailing/data/sailing-salvage.json`
- Barracuda Trials (`BarracudaTrials.plugin.js`): the Tempor Tantrum, the Jubbly Jive and the Gwenith Glide, in [barracuda-trials.md](barracuda-trials.md).
- sea charting (`Charting.plugin.js`): the 358 charting tasks, their sea and ocean bonuses and the Captain's log variables, in [sea-charting.md](sea-charting.md).
- crewmates (`Crew.plugin.js` and `crew/`; live captures from normal worlds and [rsprox.net](https://rsprox.net/database), the cache and the Wiki):
  - data: the ten crewmates are `data/sailing-crew.json` joined with cache table 173 (`sailing_crew`: the ship NPC, Helmsmanship/Privateering/Deckhandiness). The saved state is the `sailing:crew` attribute: met, recruited, five slots and each slot's job.
  - crew slots open at 40, 55, 70, 85 and 95 Sailing, unboosted (skill guide rows, Wiki). A boat holds table 166's `crew_capacity`: raft 0, skiff 2, sloop 5. The first slots go aboard.
  - recruiting goes through each crewmate's Wiki transcript (`npc-dialogues.json`), with the variant, the prose conditions and the recruit messages hooked (`Recruit.Crew.js`, rules in `sailing-crew.json`). A crewmate's own level stands for all of their requirements: quests, the Fremennik diaries for Bosun Zarah, 100 Tempoross kills (varp 2934) for Spotter Virginia. Live order: `_met` as the offer is reached; after their last line `_unlocked`, the highlighted "You have recruited X as a crew member.", the first free slot, and a message box over a fade while they leave their spot. With no slot free they "depart for the Pandemonium" instead, whatever the transcript says (live recruits "Captain Siad", by that name, to the boat). The box has no "Click here to continue" while the crewmate leaves (3 ticks); it's sent again with it as the screen fades back in a tick later.
  - where each crewmate stands comes from varbits. The client resolves their NPCs by them, so one world spawn each covers every state (`npc-spawns.json`; the spots are from recordings or the Wiki's maps, four Pandemonium spots are estimated). The visibility varbit is 0 at the recruit spot, 1 at the Pandemonium, 2 aboard and 3 on the docks. After disembarking, the first slot's crewmate waits on the docks (varbit 19503 on the `sailing_crew_on_dock` spawns).
  - the Crew Registrar's Manage-crew, or "Can I manage my crew?" in the transcript, opens interface 938. Its client scripts draw everything from the slot varbits; a crew list click is varbit 18311, a recruits list click 18310, Assign fills the slot (moving the crewmate from another), and Clear empties it and its job.
  - aboard: the ship NPCs spawn on the boarding tile and show Command to the captain (role varbit 19233 = 10). More crew assigned than the boat holds: "One or more members of your crew cannot board this boat due to its limited size." Crewmates run to a job and walk when they wander; idle ones say a line about every 220 ticks (counted in recordings). The crew tab's radio buttons (937:38) set varbit 19234: button 2 the crew, button 0 the players. Command opens "Crewmate Assignation: <name> (H# P# D#)" with:
    - "Helm and sails (H#)." (the helm's table 181 requirement);
    - "Repairs (D1).";
    - the one crew facility by name, or "Other facility." for a list of them, by `crew_facility` and with "Starboard side"/"Port side" on a sloop (`same_facilities_port_and_starboard`; starboard is hotspot side 1);
    - "Idle." ("Current - " marks the job).
    
    A stat below the facility's: "Your crewmate requires N Helmsmanship to use that facility." The captain says "<name>, take control of the <job>!", "<name>, make repairs!" or "<name>, take a rest!". Repairs with no repair kits in the hold: 2 ticks later (1 when back at it after boarding) "Your crew can only make repairs if the boat has repair kits in its cargo hold.", back to idle, and their line about it. The slot's position varbit is set (client script 9031: 4 helm and sails, 5 repairs, 6 + n hotspot n), and the crewmate walks there. The sidepanel's crew button on a facility row (937:25, fourth button; varbits 19106/19171) and its picker (937:20) do the same.
  - at the helm: the helm is theirs from the order (helm status 3). The captain steers by clicking the sea and sets the sails from the sidepanel. Arrived, they loop the helm animation every 10 ticks and set full sail 3 ticks later (sound 11089). They trim each gust 3 ticks in (sound 10841, and area sound 10807 at the sail cloth, range 5), and the captain gets 40/50/60/70% of the trim's XP at H1-H4 with "You gain some experience by watching your crew work." Taking the helm makes them idle, sails as they are. Trimming is worth the sails' tier in XP (Wiki: 10.5 to 125, `sailing-parts.json` `trim_xp`).
  - on a salvaging hook: with a raised wreck in range they cast on their own (crew cast 1180/1181). Every 5 ticks they play the hook's idle and roll at the player's level. Salvage goes into the cargo hold with their line, and the captain gets 10/20/30/40% of its XP at D1-D4. They stand on the hook's own tile facing out over the side (rsprox), and with no raised wreck in range neither they nor the hook animate (live too). A full hold: "Your crewmate on the salvaging hook cannot salvage as the cargo hold is full." A raised wreck above the captain's Sailing level: "Afraid that ship is a bit too complicated for me to salvage.", once, with the hook's reset (35 recordings, all other players' boats; the condition is the transcript's). A roll that misses: "'avin a butchers at the hook." about once in 72. Deploying their hook yourself makes them idle. Hook animations follow the hook model's size (its loc's idle 13565/13572/13579), the player's too.
  - lines over their heads (idle, at the helm, trimming, salvaging) come from the transcripts' at-sea variants.
  - `::crew all | <name or id> | reset | list` (developers): recruits crewmates without their conversations or requirements, into free crew slots, or resets them.
  - Bank-cargo (`BankCargo.Crew.js`, rsprox): the dock crewmate's Bank-cargo, or "Can you help bank my cargo hold contents?", asks "Move all available items from your cargo hold to your bank?" (Yes/No) for the boat docked there; with several docked, the boat selection in its bank cargo mode (11) comes first. Yes: their first line with no "Click here to continue" as the screen fades (50 cycles, minimap kept), 3 ticks later "Your crew start moving the contents of the cargo hold..." (no continue), at 7 the cargo goes to the bank (what a full bank or a maxed stack can't take stays in the hold) and the screen fades in, at 10 their closing line by whether the bank had room. Lines from their transcript. An empty hold: their "nothing to move" line. No boat at that dock: Jenkins' captured lines ("This some 'ghost ship' joke? If not, I reckon yer boat ain't here."; without ghostspeak "Woooo..." and "You think Jenkins is either trying to tell you that your boat isn't at this dock..."); the others, whose lines weren't captured, "Your boat isn't docked here." (ours). The Wiki's Deckhandiness 2 isn't enforced: its refusal was never captured.
  - courier crates (`Courier.Crew.js`, rsprox; capacity from the Wiki): with the boat docked at the port, the crew carry what's left of a task's crates, 2 each with Deckhandiness 3-4, else 1, in slot order. Taking a crate at the ledger table: "Your crew come to help you carry the heavy cargo." and "...There are two more crates of this type to collect, but your crew can help with that."; each appears beside the player with a puff of smoke (2902) in their carrying form for that many crates (table 173 `cargo_npc`) and follows (the second follows the first). Boarding: "Your crew pack the cargo they were holding into the cargo hold.", and they count as taken. Disembarking at the destination with a crate in hand, a tick later they carry the task's other crates out of the hold, and the ledger takes theirs first: "Your crew drop off the cargo that needed to be delivered here.". `sailing_crew_held_cargo_n` (varp 5174+n, crate) and `_amount` (varbit 19473+n) per task slot, varp 5179 the hold they came from. Ours: crew who lose the player (leaving port, teleporting, logging out) put the crates back where they came from and go, cancelling the task drops theirs with it, and a hold too full to pack them leaves the rest at the ledger.
  - wind and gale catchers (`WindCatcher.Helm.js`, rsprox 907, 908, 936, 1031, 4306): Activate and Deactivate (from the helm too), trims kept as wind motes while switched on (2, or 3 in a gale catcher; three quarters of the trim's XP, full XP owed on release), Release-mote on the loc or the side panel (the first button of the catcher's hotspot row: 937:25 slot (3 + hotspot) x 4, slot 12 on hotspot 0 as in every recording) for the trim's burst, the motes kept with the boat. Building one keeps its captured wind mote.
  - on a cannon or making repairs: see Combat below.
  - not done yet: trawling or a crewmate working the wind catcher (they go there and stand; live's switch it on and off), and the level-up boxes ("You can now recruit Jobless Jim as a crewmate."; tsps has no level-up unlock messages yet).
- developer commands: `::maxboat [default|salvaging|combat|fishing]` gives the boat being customised in the shipyard (else the active one) every part's best tier and a preset's facilities, replacing what was built (not while aboard it; the shipyard's display is rebuilt); `::raft`, `::skiff` and `::sloop` give a boat docked at The Pandemonium, `::pandemonium` teleports to its gangplank, `::sailingtools` shows every tool in the cargo hold's tools compartment (their quests don't exist yet), and `::boatmats <hull|keel|sails|helm> <tier> [boat]` or `::boatmats facility <name>` spawns a part's or facility's materials for the shipyard. The dock is where xrsps's raft docks (gangplank 59836 at 3070, 2987); the Pandemonium quest comes later. Junior Jim's Buy-boat opens the Boat Emporium omnishop (`BoatShop.Sailing.js`), and the boat is moored at his dock

## Combat

Boat combat: sea creatures, the boat's cannons (manned by the player or a crewmate), ranged and
magic from the deck, the boat's HP and repairs, harvesting corpses, and bounty tasks
([port-tasks.md](port-tasks.md)). Code: `SeaCombat.plugin.js` and `seacombat/` (`Cannon`,
`Creatures`, `BoatHp`, `Loot`, `Repairs`, `DeckCombat`), `crew/Cannon.Crew.js`,
`crew/Repair.Crew.js`, `porttasks/Bounty.PortTasks.js`; static ships' cannon fire stays in
`ShipCombat.Sailing.js`. Data: `data/sea-combat.json`. Tests: `server/tests/sea-combat.test.cjs`.

Sources: two of the user's own rev 241 rsprox captures (a rune cannon on a camphor sloop against
ospreys; Jittery Jim on a skiff's adamant cannon against terns, with the Pandemonium tern
bounty), rsprox.net recordings (https://rsprox.net/database: the other creatures' sounds and
animations, repair kits), the cache (cannon table 162 via facility table 176, cannonball ids in
table 165, task table 197) and the OSRS Wiki (Boat combat, the cannons' and cannonballs' pages,
Bounty tasks, Repair kits).

- **Cannons.** Operate mans one: `facility_lockedin` 19105 = 4, varps 5042/5043 the loc and its
  table 162 row (8080 adamant, 8081 rune), `sailing_facility_hotspot_number` 19103 = hotspot + 1,
  the combat tab as "Category: Cannon" (357 -> 33, `com_mode` 43 -> 5), "You man the cannon and
  take aim...", the side panel's `player_at_facility_n` and ammunition (`ammo_flags_n` 4,
  `ammunition_type_n`, `ammunition_count_n`), the engage animation 13325 then the idle 13327 and
  the cannon's 13322/13324. Operate again: "You disengage from the cannon." with everything put
  back; walking off (to the helm, say) says nothing. Levels: the facility's Sailing level and the
  table's Ranged one (our refusal wording).
- **Ammunition.** A cannonball used on a cannon sets the preferred one (varbit 19101, the
  cannonball's type 1-8 as in table 165): "Your preferred ammunition has been set to
  <red>adamant cannonballs</col>."; Check-ammunition shows it ("Your preferred ammunition is set to
  ...", or "You have no preferred ammunition type set. Set it by using a cannonball on any
  cannon."), Reset-ammunition clears it ("Your preferred ammunition type has been reset."). A
  cannon fires the preferred one if there's any, otherwise the best it can (`ammunition_max_tier`),
  the player's from the inventory first and then the cargo hold, a crewmate's from the hold only.
- **Firing.** Attack on a creature while manning fires every 7 ticks (`attack_rate`) until it dies
  or leaves the cannon's reach, 15 tiles in the 180 degrees in front of it (Wiki): "I can't reach
  that!". A shot: the gunner's 13326, the cannon's 13323 and its flash on the cannon's own deck tile, by
  the cannon's rotation (`vfx_sailing_cannon01_small01_attack01-04`: 3538 facing 1, 3540 facing 3,
  in 900 recorded shots), the cannonball's projectile from the tile outboard of the cannon (x - 1
  facing 1, x + 1 facing 3; 3487-3494; start 0, end 46 + 5 a tile, angle 15, heights 30 to a
  quarter of the creature's impact height: rsprox prints map_projanim_v2 heights four times over,
  120 -> 210 for an osprey, 264 a tern, 20 a shark), the impact 3541 (at the full height) delayed
  to land with it, and the hitsplat
  floor(end / 30) ticks after the shot (captured: 51-59 -> 1 tick, 61-89 -> 2, 96 and 111 -> 3) with
  sound 10927. The side panel's ammunition count goes down, `weapon_n_has_target` 1,
  `last_fired_ammunition_player` the type.
- **Damage and XP** (Wiki): the player's ranged max hit with the cannon's and cannonball's strength
  added to the worn gear it counts (not the weapon, shield or ammo slots), prayers and set effects
  included; accuracy the same way against the creature's heavy ranged defence. Cannonball bonuses
  are the Wiki's (table 165's stats are server side). 1 Sailing and 4 Ranged XP per point of the
  rolled damage, overkill included, on the shot (captured: 48 dealt to an osprey with 48 left gave
  59 Sailing, 236 Ranged). A crewmate's max hit is floor(floor((Sailing x (cannon + ball + 64) +
  320) / 640) x (Privateering + 13) / 20); their accuracy uses the captain's Sailing (ours). The
  captain gets 0.7 of a crewmate's damage as Sailing XP and no Ranged (captured: 9 -> 7, 13 -> 9,
  17 -> 12, 21 -> 15), with "You gain some experience by watching your crew work." at most every 21
  ticks (captured gaps 21-32).
- **Crewmates on cannons**: they stand on the deck tile inboard of the cannon, facing it (captured:
  Jittery Jim at 3876 for a cannon at 3875), and drop the cannon's idle pose when they leave it; by Command or the row's crew picker, needing the cannon's Privateering
  ("Your crewmate requires 3 Privateering to use that facility."), and not while the player mans
  it ("A player is already working at that facility."; the player manning it while they walk there
  sends them back to idle). No ammunition in the hold: "Your crewmate
  on the cannon can't find any ammo in the cargo hold." and "I can't find any ammo in the cargo
  hold." over their head, once until they next fire (live repeats it now and then). Orders are the cannon row's first two buttons (row 3 + hotspot: slots 16
  and 17 for a skiff's hotspot 1): the first cycles "Await further orders!", "Fire at will!" and
  "Attack my targets!" (`weapon_n_following_target` 1, 2, 0), the second is "Hold fire!", said by
  the captain. Following the captain they take the captain's target, whether the captain mans a cannon or attacks
  with their own weapon ("Fire!"); firing at will they
  pick the nearest creature the cannon reaches, for 10 minutes (captured: 1000 ticks), then follow
  the captain again.
- **Sea creatures** (`data/sea-combat.json`, every spawned kind; their animations, death sounds
  and aggression are the NPC definitions', with `npc-combat-defs.json` entries giving each no block
  animation, as captured): hit by a player on their boat, or near one when aggressive (krakens and
  every shark but the bull shark, Wiki; ours: 8 tiles), a
  creature takes the boat as its target, never the player. It comes over the water to its reach of
  the hull (ours: birds 4 tiles as the captured osprey, krakens 6, the rest beside it) and attacks
  every attack speed ticks: its attack animation and sound (osprey 13233/10925, tern 13237/10936,
  rays 10933, frigatebird 10915, mogre 10802, dolphin 10912; sharks silent), then a tick later
  (captured) a roll against the hull's defence up to its max hit, less 1 per 100 of the keel's
  armour (Wiki; a creature with a lower max hit than that can't hurt the boat), with sound 11165
  for a block and 10700 for damage. Under the hull it can't attack (Wiki); it gives up 20 tiles
  behind (ours).
- **The boat's HP.** `boat_hp_npc_tiny/small/medium` stands on the deck (raft and skiff (3,3), sloop
  (3,8), captured for the skiff and sloop) while the player is aboard; hits on the boat show as
  hitsplats on it (the client draws a deck NPC's hitsplats and health bars where its deck is drawn) (12 for the owner's block, as captured) with the boat's health bar (headbar 19,
  100 wide, on a skiff; 21, 140 wide, on a sloop; the raft's 17, 60 wide, follows the sizes'
  pattern). The HP goes to `sailing_sidepanel_boat_hp` and the slot's stored HP. At 0 the boat is
  lost: all of its cargo goes when a creature or ship sank it (Wiki; a Barracuda Trial's hazards
  only send the player back, as before) and the player escapes to land; the boat is sunk until a
  shipwright recovers it.
- **Repairs.** A repair kit's Apply aboard (rsprox.net recording 3455): `human_repairkit`, sound 2101
  at 15, 30 and 45 cycles, "You use the repair kit to fix up the boat.", the kit used and the boat
  repaired by the kit's hitpoints (wooden 5, oak 10, teak 20, mahogany 30, camphor 40, ironwood 45,
  rosewood 50; Wiki). It holds off the player's next cannon shot 3 ticks (ours, as food). A
  crewmate on repairs uses the hold's kits (best first, every 5 ticks: ours) for the kit's
  hitpoints plus their Deckhandiness less 1 (Wiki), saying "Aye, that's better.". The side panel's
  repair kit count is what the hold's kits repair (5 a wooden kit, as captured).
- **Corpses and loot.** A creature dies with its death animation and sound (osprey 10926, tern
  10937, rays 10934, mogre 10799), and 2 ticks later lies as its corpse (`_dead`, op1 Harvest) for
  two minutes (Wiki), then respawns its usual time later. Its drops wait for the harvest: the killer's Harvest picks it up beside the
  hull (`human_pickupfloor`, the loot a tick later) or throws a net further out
  (`sailing_human_loot_net_cast_01` with spotanims 3519 and 3521, projectile 3520: start 30, end
  90, angle 255, progress 112, heights 128 to 0), pulling it a tile a tick towards the player for six ticks (its death left its movement locked; the net
  frees it, and while it's pulled, as while a creature fights a boat, its walk is scripted: core's
  NPC movement coordinator doesn't wander it or walk it home) (stopping beside the hull; the net's
  3522 on it from the third tick for four, then 3523) and looting 9 ticks after the throw (captured).
  Out of the net's reach (ours: 10 tiles), the player first walks along the deck to the tile
  nearest it (`BoatManager.deckTileToward`), as for any main-world NPC's option from a deck. The loot goes into the inventory, each item
  flying in (script 7192 with the corpse, a loot key counting up, the item and the amount) with
  sound 2581; without room for all of it, it all drops under the player (Wiki).
- **Loot rules**: a harvest's loot goes through the same hooks as a kill's drops (NpcDrops'
  `npc-drops:add`, `npc-drops:roll` with everyone who damaged the creature, `npc-drops:generated`,
  with the creature's own id), so an Ironman's shared kill keeps nothing, members items go on a
  free world and the collection log counts it; a bounty part only counts if it survives them.
- **Bounty parts** in a creature's drop table (Wiki tertiaries, "only dropped while on an applicable
  bounty task") come only from an active bounty (porttasks/Bounty.PortTasks.js); harvests drop them
  from the table's roll.
- **From the deck** (Wiki): bows and spells reach sea creatures from the deck of the player's own
  boat (the one a creature fights back against), measured from the
  boat's tile on the sea (core `CombatPosition`: across a deck both are measured from the
  main-world tiles under them, over main-world clipping, and projectiles fly in the main world);
  melee says "I can't reach that!", and nothing ashore can be attacked. Out of reach, the player
  walks along the deck to the tile nearest the target and attacks once in reach; when the deck
  takes them no nearer, "I can't reach that!" (captured). The client faces a target in another
  world view from where the player stands in the world, relative to the deck it turns with
  (`PlayerMovementSync.acrossDeckOrientation`).
- **Not done**: chainshot and incendiary cannonballs, the ballistic attractor, the perildance
  bitter's +1, the cannons' auto-retaliate setting, the side panel's NPC target layer (937:26),
  Telekinetic Grab on corpses, the herb sack and seed box when looting, crewmates "fire at will"
  needing their target cleared, and multi-combat limits at sea.
- Shipwright Seb repairs the boat visiting the shipyard for 50 coins per missing hitpoint,
  with canonical confirmation, a remembered warning choice and PIN-guarded bank fallback.
  See [repair sources and verification limits](shipwright-repairs.md).

## Client

The tsps client already decodes `REBUILD_WORLDENTITY`, `WORLDENTITY_INFO` and world-view ids in player and NPC sync. Ported from xrsps: `worldEntityMotion` (placing the deck scene at the boat's position), the `WorldEntityAnimator` fix, `HelmSteering` (click-to-heading on the sea surface), and the picking, camera and minimap changes that follow the player's root tile.

- Steering from the helm (`HelmSteering.ts`): a click on the boat's deck scene, which includes its drawn border just outside the world view (`DECK_SCENE_MARGIN`), aims at where the mouse ray meets the water; any other click is a world tile. Before the margin, a click on that border was taken as a world tile thousands of tiles away and steered the boat off in a fixed wrong direction.
- A boat's deck is its own map square (overlay map 200 + entity index). It is never pruned with the map grid, which it is never in (or every grid move while sailing would drop the deck and rebuild it), and it never fades in like new terrain.
- A boat replaced by a new one (the shipyard respawns it after a build or part swap) gets a new entity index, as live does (970 -> 972 in a capture), so viewers despawn the old and spawn the new in the same update. The client keeps the old deck drawn until the new one's is built (or five seconds pass), so the boat doesn't vanish while its deck loads.

## Testing

Headless tests like `trade.test.cjs` and `bank.test.cjs`, one per lifecycle row: every exit path leaves exactly one consistent saved state and no live instance. Plus movement and collision, and sync range (a viewer gets the boat when it comes into range and loses it when it leaves).

## Open questions

- Death at sea: does the boat sink, or return to its last dock?
- Recovery fee once boats take damage and have facilities (the wiki gives only the base fee).
- The Escape message and its confirmation prompt are placeholders; the live wording is unconfirmed. The board and disembark lines are captured.
- Logging out at sea when the boat last left from an island mooring point rather than a port (a Dec 2025 fix changed this; unclear if it differs).

## Sources

- [Sailing](https://oldschool.runescape.wiki/w/Sailing), [Boat](https://oldschool.runescape.wiki/w/Boat), [Mooring point](https://oldschool.runescape.wiki/w/Mooring_point), [Buoy](https://oldschool.runescape.wiki/w/Buoy_(Sailing)), [Shipwright](https://oldschool.runescape.wiki/w/Shipwright) — OSRS Wiki
- xrsps (`bank-overhaul` branch) `docs/internals/sailing.md` and its engine code, the starting point for the engine and client work
