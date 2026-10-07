# Corporeal Beast

The Corporeal Beast, built from the OSRS Wiki, a live rsprox capture (a games necklace teleport to one attack and a death) and the cache. Offline_Scape's port (Kris's, Zenyte-based) served as a reference for ids and the cave's layout; where its numbers differ from the Wiki, the Wiki is followed. It is one plugin, `server/plugins/bosses/CorporealBeast.plugin.js`, which delegates to one unit per area in `server/plugins/bosses/corporealbeast/`.

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | The lair: cave, exit, passage, the room's overlay, spawns, multi-combat | Done |
| 2 | The Beast: its attacks, the stomp, damage reduction, regeneration, the damage overlay's count | Done |
| 3 | The dark energy core | Done |
| 4 | Tests (`server/tests/corporeal-beast.test.cjs`) and docs | Done |
| 5 | Spirit shields: blessing, sigils, the spectral passive on the Beast's drain | Done |

## Layout

| File | What it owns |
| --- | --- |
| `CorpShared.js` | Ids, tiles, the two copies of the lair, helpers. |
| `Lair.*` | The cave, its exit, the passage, and the room's overlay. |
| `Beast.*` | The Beast: its respawn, stomp, regeneration, damage reduction and the overlay's count. |
| `CorpAttacks.js` | The Beast's four attacks. |
| `DarkCore.*` | The dark energy core. |
| `SpiritShields.*` | Blessing spirit shields and attaching sigils. |

## The lair

The lair is in the map twice, 128 tiles apart, with the same locs: the room everyone uses and the one for ironmen of combat level 90 and up (Wiki). The capture was taken in the northern copy (y around 4382). The Wiki puts the normal room in the southern copy (y around 4254), so `CorpShared.ROOMS` does too; the ironman room isn't used yet.

| What | Where | Notes |
| --- | --- | --- |
| Cave (678, Enter) | (3201, 3679), Wilderness | Not while in combat (Wiki). Puts you at (2964, 4254) in the normal copy (Offline_Scape). |
| Cave exit (679, Exit) | (2963, 4254) and (2963, 4382) | "This exit leads to the Wilderness, are you sure?", then (3206, 3681) (Offline_Scape). |
| Passage (677, Go-through, Peek) | (2971, 4254) and (2971, 4382), 3 tiles wide | Go-through moves you across a tick later: x 2970 to 2974 and back (capture). No pets (Wiki); the message is Offline_Scape's. Peek counts the players in the room (Offline_Scape's messages). |
| Corporeal Beast (319) | (2994, 4253) and (2994, 4381), facing south | Capture: (2994, 4381) facing south; the southern copy is the same tile 128 south. Respawns 50 ticks after dying (Wiki). |

- **Multi-combat:** both copies, lobby and room, are multi-combat (Wiki; the capture sets the multi-way varbit on arrival).
  - This needed a core fix: `Wilderness.isMulti` tested every `world.json` multi-combat zone on plane 0, so no zone above ground ever applied. It now takes the plane.
- **The overlay:** in the room east of the passage, the Corp overlay (interface 13) opens on the HUD, and it closes on leaving (capture).
  - Script 693 shows varbit 999 as "Damage: N" ("Damage: Lots!" from 4,000).
  - Phase 2 keeps varbit 999 up to date.
- **The games necklace** lands at (2967, 4381), in the northern copy, where the capture's necklace landed (2966, 4380). `::teleports` (Bosses) goes to the normal room's lobby at (2966, 4252).

## The capture

Facts from `corp.txt` (games necklace, the private portal, the passage, about 25 ticks of the fight unarmed without prayer, and the death):

- **Private portal:** loc 9370 at (2966, 4379): "You can't have a private arena for your channel if you're not in a channel." It is OSRS's clan arena; not done here.
- **The controller:** attacking the Beast adds NPC 384 (`corp_beast_controller`) at (3001, 4383).
- **Timing:** attacks every 4 ticks (ticks 69, 73, 77, 81, 85, 89, 93).
- **Splitting attack:**
  - Anim 1679 with projectile 315 from the Beast's centre to the player's tile: start 21, 10 cycles a tile, heights 190 to 0.
  - Where it lands: splash 1836, then 6 projectiles 315 (start 10, end 41-61, heights 0) to tiles within 3, each with a 1836 splash as it lands.
- **Stat drain:** anim 1681 with projectile 314 at the player (21 to 41, end height 124), landing a tick later. "Your Prayer has been slightly drained!" or "Your Magic has been slightly drained!"; one drain came with a 0 hit.
- **Melee swipe:** anim 1683. **Block:** anim 1677. **Health bar:** 22, 160 wide.
- **Offline_Scape's mistake:** it swaps the splitting and draining animations (it has 1681 for the split and 1680 for the drain). By elimination, 1680 with projectile 316 is the plain magic attack.

The animations in `npc-combat-defs.json` are RuneLite's names: attack 1683, block 1677, death 1676.

## The Beast

**Attacks** (Wiki; ids and timings from the capture):

| Attack | When | Max hit | Ids |
| --- | --- | --- | --- |
| Melee swipe | 40% when beside one of its sides | 33; Protect from Melee blocks it | anim 1683 |
| Magic | Otherwise a third each (20% each when in reach) | 65 | anim 1680, projectile 316 (RuneLite; not captured) |
| Draining magic | | 55; a hit drains Magic or Prayer by 1-2 and heals the Beast by half the damage | anim 1681, projectile 314 |
| Splitting magic | | 40 on the tile, 30 beside it; then 6 splits within 3 tiles, 30 / 20 each | anim 1679, projectile 315, splash 1836 |

- It attacks every 4 ticks, from up to 15 tiles away. The 15 is Offline_Scape's; the capture's first attack came from 14 tiles.
- The Wiki's occasional 3-tick attack isn't done; the capture shows none.
- Protect from Magic takes only a third off its magic attacks, splits included. Hits are rolled as magic.
- Projectiles leave the Beast's centre at cycle 21 and take 10 cycles a tile; the splits take 31 + 10 a tile (capture). Heights are a quarter of the capture's, since the packet multiplies them by 4.
- The drain happens on any hit that landed, 0 included (capture). The Wiki says "a chance" on a successful hit.

**The 7-tick timer** (Wiki):
- **Stomp:** players under the Beast take 30-51, through prayer (anim 1686; Offline_Scape's message).
- **Empty room:** it heals 75, then 85, 95 and so on, and everyone's damage count is cleared.
- **Crowd:** with 8 or more players it heals 5 per player.

**Stats:** drained stats come back a level every 20 ticks. This uses a new per-NPC `setStatRestoreTicks` in core; the default stays 100.

**Damage reduction** (Wiki): melee and ranged deal half unless the weapon is Corpbane and used on a stab style.
- Corpbane: spears (not hastas), halberds, Osmumten's fang, the Thunder khopesh, King's barrage.
- Matched by name. Magic does full damage.

**Health bar:** type 22, 160 wide, over its head (capture). No boss health HUD is opened; the capture shows only the Corp overlay.

**The overlay's count:** each blow adds to the attacker's varbit 999. It resets when the Beast dies or the room empties.

**Loot:** the Wiki drop table in `npc-drops.json`, to the player who dealt the most damage (the engine's killer).
- The 12 drops the Wiki lists as noted carry `"noted": true` there, for example 125 adamantite ore and 75 magic logs.
- The generated file had lost every table's "(noted)" marks. Corp respawns 50 ticks after dying.

**Not done:**
- The ironman room's rules: kill credit and the brazier.
- The private clan arena.
- NPC 384, the invisible controller.

## The dark energy core

Wiki, unless marked:
- **Spawning:** a 1/8 chance when the Beast takes a hit of 32 or more, and on each of its attacks below 1,000 HP. The Beast's attack timer restarts at 4 when one comes out.
- **Where:** it comes from the Beast's middle and jumps at once. That and the jump rhythm are **Offline_Scape**'s.
- **Jumping:** it jumps (projectile 319, RuneLite's DARK_CORE_JUMP) to the northernmost player, east as the tie-break, whenever nobody is beside it.
  - In flight it waits out of sight, one plane up, and lands with the projectile.
  - The flight is 30 cycles plus 30 every 3 tiles, every other tick (**Offline_Scape**).
- **Leeching:** every 2 ticks it takes 5-13 from each player beside it and heals the Beast by as much. The message is **Offline_Scape**'s.
- **Poison:** a poisoned core is stunned until it next hops, and can only be stunned once.
  - A stunned core leeches every 10 ticks. This is an estimate: the Wiki only says "very slowly".
- **Removal:** it goes when the Beast dies or nobody is left in the room. It never attacks and doesn't respawn.

## Spirit shields

Wiki:
- **Blessing:** a holy elixir on a spirit shield (85 Prayer, not boostable) makes a blessed spirit shield. It shows the transcript's "The spirit shield glows an eerie holy glow."
- **Sigils:** a sigil used on an anvil, with a hammer and a blessed spirit shield in the inventory, makes the arcane, spectral or elysian spirit shield.
  - Needs 90 Prayer (not boostable) and 85 Smithing (boostable). Gives 1,800 Smithing XP.
  - The sigil message and the level messages are estimates (no transcript).
- **Spectral passive:** it halves the Beast's prayer drain. Other prayer drains are spread over a dozen call sites with no shared path, so the passive doesn't reach them yet.
- **Elysian passive:** already in core combat.
- **Not done:** Abbot Langley's paid service.

## Developer commands

| Command | What it does |
| --- | --- |
| `::corpkill` | In the room: finishes the Beast, credited to you, so its drop is yours. |
