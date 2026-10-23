# Dwarf multicannon

`server/plugins/items/DwarfCannon.plugin.js`, with its parts in `server/plugins/items/dwarfcannon/`:

| Unit | Contents |
|---|---|
| `Setup` | setting the cannon up |
| `Ammo` | Fire, Empty, Load X |
| `Firing` | turning and shooting |
| `Decay` | breaking, Repair, loss, Pick-up, logout and login |
| `Nulodion` | the 750,000-coin set purchase and getting a lost cannon back |
| `Ornament` | the shattered cannon ornament kit |
| `Restrictions` + `plugins/items/data/cannon-restrictions.json` | where a cannon can't be set up |
| `Data`, `Common` | shared numbers and state |

**Sources:**
- **an OSRS capture** (rsprox) of a cannon's whole life at the Woodcutting Guild's ents: setup, auto-load, Fire, two shots, Empty, Load X, Pick-up;
- **the OSRS Wiki:** "Dwarf multicannon" (its prohibited-areas list too), "Shattered cannon ornament kit", and Nulodion's transcript;
- **this cache:** ids;
- **Near-Reality's code**, historically, for the firing polygons and most older area outlines. Their central 49 firing tiles are now independently checked against the Wiki diagram; the outer polygons and older outlines remain flagged where unverified.

## Setting up (captured)
"Set-up" on the base marks the player busy (varbit 12393).
- **The base:** two ticks after the click: "You place the cannon base on the ground.". The base (loc 7) appears with the player on its centre tile, and they run off to the tile south of its south-west corner.
- **The other parts:** the stand 2 ticks later, then the barrels and the furnace 3 ticks apart: "You add the stand.", "You add the barrels.", "You add the furnace.". The furnace turns it into the cannon (loc 6).
- **Each part:** animation 827, area sound 2876, the part leaves the inventory, and the player faces the cannon.
- **Auto-load:** the tick after the furnace, it loads up to 30 balls: "You load the cannon with 30 cannonballs.".

**Vars:**

| Var | Meaning |
|---|---|
| varp 2 | parts added (1–4) |
| varp 3 | balls loaded |
| varp 4, varp 3551 | the cannon's packed south-west tile `(z << 28) \| (x << 14) \| y` |
| varbit 2180 | the tick of the last part |
| varbit 1968 | the world. **Ours:** always 1, since this server has no world number. |

Only changed vars are sent, as in the capture; all of them are sent again on login.

**Refused (our wording, not captured):**
- a second cannon: "You cannot construct more than one cannon at a time.";
- missing or mixed parts: "You need the base, stand, barrels and furnace to set up a cannon.";
- no clear 3×3: "There isn't enough space to set up a cannon here.";
- a restricted area: that area's Wiki message.

**Ours:** the setup stops (keeping what's built) if the player walks more than 5 tiles away, logs out, or no longer has the next part.

**No quest requirement:** the Wiki requires the Dwarf Cannon quest. This server leaves it out by choice.

## Firing (captured)
- **Starting:** "Fire" tops the cannon up from the inventory. The next tick varp 1 (`mcannonmulti`) is set to `1 << 20`, and from the tick after, the barrel turns one step a tick, N → NE → … → NW.
- **Each turn:** area sound 2877 and `mcannon_<dir>_turn` (514 N … 521 NW).
- **A shot:** on a tick when something is in the direction it faces, it plays `mcannon_<dir>_fire` (506 N … 513 NW) and sound 1667, then turns in the same tick.
- **The ball:** projectile 53 from the cannon's centre, heights 145 → 140 (36 → 35 here), angle 2, progress 11. The capture's two shots took 35 cycles (north) and 40 (south-west). **Ours:** 35 for straight directions and 40 for diagonals.
- **The hit** lands the next tick, as the owner's (kill credit, retaliation).

**From the Wiki:**
- **Damage:** up to 30, or 35 with granite.
- **Accuracy:** the owner's Ranged roll with a ranged weapon, otherwise melee, against the target's Ranged defence.
- **XP:** 2 Ranged XP per damage, no Hitpoints XP. Core's `PendingHitConfig.experience: false` skips the usual combat XP for these hits.
- **Targets:**
  - in singles, only what fights the owner or nothing at all, and only while the owner isn't fighting something else; in multi, anything attackable;
  - never sand crabs, ammonite crabs, demonic gorillas or kurasks;
  - in line of sight from the cannon's footprint.
  - **Ours:** a target fighting the owner first, otherwise the nearest.
- **Granite:** granite balls load first, and steel only once the granite is used up. Granite fires first (projectile 1443).

**Ours or unverified:**
- **Firing zones:** all 49 tiles in the Wiki's [Cannon Double Shot.png diagram](https://oldschool.runescape.wiki/images/Cannon_Double_Shot.png) match the implemented 0/1/2 shots per revolution, covered by a regression test. The original polygons came from Near-Reality; their direction assignment and shapes outside the diagram remain unverified. Both captured shots fall inside the expected directional zones.
- **Running dry:** "Your cannon is out of ammo!" and the cannon stops.
- **Fire with nothing to load:** "You need to load the cannon with cannonballs first.".
- **Logging out:** the cannon stops firing.

## Cannonballs (captured)

The existing Combat Achievements tier event raises capacity to 35 (Medium), 45 (Hard) or 60 (Elite), with 30 by default. Setup auto-load, Fire, Load X and its input maximum all use the same capacity.

- **Empty:** "You unload your cannon and receive Steel cannonball x 28." (granite: "Granite cannonball"). Varp 3 goes to 0, and firing stops the next tick. **Ours:** the no-space message.
- **Load X:** the first time, a count prompt "Set load-x cannonballs (1 - 30):", then varbit 17870 and "You will now load 10 cannonballs when using Load-x.". After that it loads that many: "You load the cannon with 10 cannonballs.". Saved per player.

## Pick-up (captured)
"You pick up the cannon. It's really heavy.", synth sound 2581.
- **Vars:** they clear, except that varp 4 keeps the player's tile, as captured.
- **Items:** the parts added so far and every ball come back in the same tick.

Also works on a broken cannon or a part-built one. **Ours:** the no-space message.

## Decay (Wiki)
- **Breaking:** after 25 minutes set up it breaks: the broken multicannon (14916; ornament 43028), with "Repair" and "Pick-up". Repair starts the 25 minutes again.
- **Loss:** 10 more minutes unrepaired and it's gone. Its parts and loaded balls wait at Nulodion; reclaimed ammunition loads into the next cannon that player sets up.
- **Logout:** the cannon stays up while the owner is logged out. If the server restarts, a cannon saved on a player but missing from the world counts as lost.
- **Messages (ours, unverified):** "Your cannon has broken!", "You repair your cannon, restoring it to working order.", "Your cannon has decayed. Speak to Nulodion to obtain a new one.".
- **Testing:** `::cannondecay` (developer) breaks your cannon, and on a broken one makes it disappear, each on the next tick.

## Nulodion (Wiki transcript)

The existing generated Nulodion transcript and `Multicannon parts for sale` shop already contain the sale branches. The plugin answers the six-free-slots and 750,000-coin conditions, then consumes payment and grants the four parts, ammo mould and instruction manual on the transcript's existing message. It rechecks funds and space at payment. The generated shop and dialogue JSON are unchanged.

Lost-cannon replacement likewise rechecks inventory space and refuses while another owned cannon is deployed. Decayed/restart-lost cannons retain their loaded steel/granite ammunition, which is restored already loaded at the next setup (matching the Wiki's replacement-ammunition rule). The recovered ammunition is persisted on the player until setup.

"I've lost my cannon." follows his transcript, with its conditions answered from the cannon's state:
- still set up somewhere;
- fewer than 4 free slots;
- lost by despawning or world-hopping (a restart here);
- not lost.

"The dwarf gives you a new cannon." hands back the lost cannon's parts, ornament if it was one.

## Ornament kit (Wiki)
- **Applying:** one shattered cannon ornament kit used on each part makes its (or) version.
- **Dismantle:** gives the part and the kit back.
- **No mixing:** ornament and plain parts can't be set up together.
- **Objects:** the ornament cannon uses 43029 base, 43030 stand, 43031 barrels, 43027 cannon and 43028 broken.
- **Animations (not captured):** the cache's matching runs of eight, fire 9230–9237 and turn 9239–9246, taken in the same N-first order as the plain ones.

## Restricted areas
`cannon-restrictions.json` tracks 72 Wiki entries, including the historical Realm of Memories. **60 now have explicit coordinate outlines.** Any private area is refused, covering Chambers of Xeric, Clan Hall, Nightmare Zone dreams, Theatre of Blood, Tombs of Amascut and player-owned houses during their actual instances. Sailing boats use `BoatManager.getBoatAboard(player)` instead of fixed coordinates. The Realm of Memories page is marked removed since the Cow Boss update; it remains a historical entry, not an exposed live location here.

The 13 initially added outlines use canonical content bounds or the Wiki's own polygon: Ancient Guthixian Temple, Ancient Prison, Bryophyta's lair, Callisto's Den, Hair of the Dog, Kraken Cove, Scurrius' Lair, Silk Chasm, Sorceress's Garden, Ungael, Vet'ion's Rest, Water mill cellar and Zemouregal's Base. Sources are recorded on each entry. Hair of the Dog uses the Wiki's exact polygon; Sorceress's Garden uses the isolated map square enclosing its four cache-flood-filled mazes and central garden.

A further **18 previously missing outlines** are now supported:

- **Feldip Hunter area:** the [Wiki's highlighted-area polygon](https://oldschool.runescape.wiki/w/Feldip_Hunter_area?action=raw), not the broader Feldip Hills location pin.
- **Abyssal Area, Barbarian Assault game/lobby and Jiggig Dungeon:** exact, unpadded source `regionList` definitions from the [Wiki's map generator](https://github.com/osrs-wiki/osrs-wiki-maps/blob/f6fe9b2f5483625aad1de98d45e15fa08b124440/scripts/user_world_defs.json), independently corroborated by RuneLite's GPU region definitions. The Wiki's `basemaps.json` display bounds include padding and were deliberately not used as gameplay boundaries.
- **Forthos Dungeon and Lizardman Caves:** explicit source sections in the active cache's world-map index 19, details archive 0 (Kourend Underground area 32 and Kebos Underground area 33), corroborated by their Wiki locations, captured entrances and cache NPC spawns. Forthos includes the southern Sarachnis chamber, which the older Slayer-area box omits.
- **Brutus, Mogre Camp, Tapoyauik, Tonali Cavern, Vanstrom Klause, Tower of Magic and both Uzer Mastaba levels:** their existing canonical quest/Slayer/Area bounds. Tower of Magic checks `quest:get-stage` and is prohibited only during The Ascent of Arceuus (stages 1–13), matching the Wiki's quest-only qualification.
- **Fight Arena interior, both Karuulm wyrm rooms, Alchemical Hydra, all six Scabaras Dungeon room components and Shellbane Gryphon Cave:** naturally closed collision components in active cache `osrs-241_2026-10-20`. Seeds come from the quests, Wiki pins or actual NPC spawns. Regression tests re-flood-fill each component, check its exact extent and verify the enclosing bounds contain no disconnected valid 3×3 cannon location. Normal hydras, drakes and other Karuulm floors remain permitted.
- **Fossil Island offshore bank chest island:** its closed 23-tile land/shore component in terrain region 14908, bounded by full-water tiles and corroborated by the Wiki's [Bank Chest-wreck](https://oldschool.runescape.wiki/w/Bank_Chest-wreck?action=raw) position. This is the offshore island, not the Museum Camp bank polygon.

**Four active outlines remain genuinely unsupported:**

| Area | Missing evidence |
| --- | --- |
| Near Gilbert | The Wiki confirms cannons are disabled around the Pride event, but provides no radius or boundary. Gilbert's `r=3` map square is an NPC marker, not an established prohibition area. The rsprox archive has no recording of its distinctive refusal message. |
| Jormungand's Prison basilisk rooms | The Wiki prohibits the basilisk rooms while explicitly allowing the dagannoth rooms. They form one connected cache component; neither the location page nor the server's multi-combat zone data supplies the dividing boundary. Banning the whole dungeon would block allowed cannoning. |
| Mort'ton and Shades of Mort'ton | Wiki town/minigame pages provide location pins, without a prohibition polygon. The Shade Catacombs explicitly permit cannons, so a broad surrounding dungeon rectangle would be incorrect. |
| Smoke Dungeon task-only room | The Wiki confirms only the western task room is prohibited. Its corridor connects to the permitted public dungeon, preventing a naturally closed component; neither Dusty Aliv's page nor the Wiki's map source definitions establish the exact task boundary. |

These four remain listed without guessed rectangles. Older imported Near-Reality outlines also retain their explicit unverified provenance.

## Follow-ups
- the four unsupported active outlines listed above, and independent verification of older imported outlines;
- the real messages for the parts marked "ours".
