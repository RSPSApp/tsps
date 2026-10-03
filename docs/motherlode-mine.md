# Motherlode Mine

Prospector Percy's mine under Falador (`server/plugins/areas/MotherlodeMine.plugin.js`, with its parts in `server/plugins/areas/motherlode/`). Behaviour is from the OSRS Wiki, and the mine's packets are from two live captures. Where neither covers something, it follows OpenRune-Server's `motherlode-mine` module (ISC licence).

The plugin lives under `areas/` so that its "Ladder" handler runs before the generic one in `objects/Ladders.plugin.js` (plugins load in path order).

## How it works

- **Veins:** the map holds all 266 veins depleted (locs 26665-26668), and the server spawns the live veins (26661-26664) over them at startup.
  - Mining needs level 30 (not boostable) and gives 60 XP per pay-dirt. The roll for each pay-dirt is OpenRune's, made every pickaxe interval.
  - A vein's timer starts with its first pay-dirt. It depletes 38-45 ticks later (Wiki: 23-27 seconds), or 60-67 on the upper level (36-40 seconds). Everyone mining it stops.
  - It respawns 159-176 ticks later, or 94-101 upstairs.
- **The ore** is rolled when the pay-dirt is mined, not when it's cleaned (Wiki). Pay-dirt from elsewhere, such as the bank, is rolled when it's deposited.
  - Rolls go top-down: nugget, runite (85), adamantite (70), mithril (55), gold (40), else coal.
  - The rates give a nugget 1 in 32 at every level, and coal 96.9% at level 30 down to 24.6% at 99, as the Wiki's chart shows.
  - Cleaning gives the Wiki's bonus XP: coal and gold 15, mithril 30, adamantite 45, runite 75.
- **The machine:**
  - A hopper takes as much pay-dirt as the sack has room for. The sack holds 108, or 189 with the bigger sack, counting what's still being washed.
  - The pay-dirt floats down the channel and becomes ore in the sack 12 ticks after the deposit.
  - The upper hopper is fenced in by railings, so it's used across them from the walkway in front, (3755, 5676). An object route hook sends the player there instead of to a side of the hopper.
  - It only moves while at least one water wheel turns: "any pay-dirt that was making its way to the sack will stop in place" (Wiki).
- **The struts:**
  - A broken strut is repaired with a hammer. Each tick there's a 12% chance of a repair at Smithing 1, up to 27% at 99, for 1.5 Smithing XP per level (Wiki).
  - Percy calls out his transcript's overhead lines when a wheel, or both, breaks.
- **The sack** gives the nuggets first, then each ore into the free inventory slots. Varbit 5558 is its count, which the HUD and the sack loc (26688, empty or full) both read.
- **Rockfalls** (26679/26680) are mined away for 10 XP (Wiki). They come back down later and hit whoever stands on the tile for 1-4 (Wiki), moving them off it.
- **Prospector Percy's unlocks** run through his Wiki transcript. The plugin answers its "If the player..." conditions (`api.onNpcDialogueCondition`) and makes each purchase on its "You pay Percy N nuggets." step:
  - the upper level, 100 nuggets and 57 Mining;
  - the bigger sack, 200 nuggets;
  - the upper hopper, 50 nuggets.

  The Wiki's transcript has no lines for two branches, so `npc-dialogues.json` fills them from Percy's own lines:
  - **Buying the bigger sack:** "You pay Percy 200 nuggets.", then back to the question, like his other purchases.
  - **When only the bigger sack is bought:** "Let me have a think...", his lines for the two upgrades left, then the same menu.
- **The upper level** is a bridge on the same plane. Varbit 2086 says which level the player is on, and the ladders (19044 at the foot, 19045 at the top) are multilocs on it.
  - The map stores the bridge's locs a plane up. The server sends their changes on plane 0 (as captured), and the client's `SceneBuilder` maps them onto the bridge, so its veins and rockfalls change in place.
- **The nugget shop** stock and prices are the Wiki's: the prospector outfit, coal bag, gem bag, soft clay pack and bag full of gems.

## Ways in and out

| Loc | Where | Goes to |
| --- | --- | --- |
| Cave 26654 "Enter" | Dwarven Mine (3059, 9764) | **(3728, 5692)** |
| Tunnel 26655 "Exit" | (3728, 5693) | (3060, 9766) |
| Cave 30374 "Enter" | Mining Guild (3055, 9743) | (3718, 5678) |
| Tunnel 30375 "Exit" | (3717, 5678) | Mining Guild (3054, 9744), needs 60 Mining |
| Ladder 19044 / 19045 | (3755, 5673) / (3755, 5674) | (3755, 5675) up / (3755, 5672) down |
| Dark tunnels 10047 | (3760, 5670) ↔ (3764, 5671), (3744, 5642) ↔ (3745, 5645) | the other end, needs 54 Agility |

Bold is captured; the rest are OpenRune's.

## From the captures

### Going in, mining, depositing and collecting

- **The cave:** the crawl animation 2796 and sound 2454 (2 loops, delay 4), then the move the next tick. The tick after that, the HUD (interface 382) opens in the toplevel's `overlay_hud` (164:8).
- **A vein:**
  - Mining plays the pickaxe's wall animation (6758 with a dragon pickaxe) and starts with "You swing your pick at the rock.".
  - Each pay-dirt gives "You manage to mine some pay-dirt." and sound 3600.
  - A vein depleted 43 ticks after its first pay-dirt. It was sent as the depleted loc being added, with sound 2661 (delay 10, range 1).
  - The respawn timers sent were 159-176 ticks below and 94-101 above (one outlier, 69, on a "left" vein).
- **The hopper:**
  - Deposit plays animation 832 and sound 2496.
  - A pay-dirt NPC (6564) appears at (3748, 5671) the next tick and moves one tile south each tick.
  - 12 ticks after the deposit, varbit 5558 rose by the deposit, with "Some ore is ready to be collected from the sack." and sound 2739 (delay 30).
- **The sack:**
  - Search took the 7 nuggets, then 26 ores into the free slots.
  - Varbit 5558 was updated twice (172 → 165 → 139).
  - Interface 193 (objectbox) showed pay-dirt with "You collect your ore from the sack." even though ore was left. It is built by script 2868, with the item at zoom 400. This is the new core `ItemStatementDialogue`.
- **A rockfall:** it was gone 2 ticks after the swing. It came down again 78 ticks later as two falling rocks (projectile 645, from heights 1000 and 900, landing after 30 cycles), a splash (spotanim 305) and sound 360.
- **The channel:** water overlays (10459) and small foams (2018) are spawned by the server. The foams are re-sent every 3 ticks.

### A strut breaking and being repaired

- **Breaking:** the strut becomes 26670 (shape 10, rotation 0) and the wheel 26672 (rotation 2), the same as the map's locs. The waterfall foam beside it (2016) is removed.
- **Repairing:**
  - The hammer animation 3971 and sound 1786 (delay 10) play every 4 ticks.
  - The strut was fixed 6 ticks after the first swing.
  - The fixed strut 26669 (rotation 0), the wheel 26671 (rotation 0) and the foam 2016 (rotation 1) were sent, with Smithing XP.
- **Where:** the northern strut is at (3742, 5669), its wheel at (3743, 5668) and its foam at (3743, 5671). The southern strut's foam is at (3743, 5665).

## Guessed rather than captured

- **How often a strut breaks:** 2-4 rounds of 97 ticks after its repair (OpenRune).
- **The pay-dirt roll** (OpenRune's 60/256 at level 1 to 105/256 at 99, every pickaxe interval) and the rockfall's respawn (78-100 ticks).
- **The channel when both wheels are broken:** the water's locs are left as they are.
- **The messages for:**
  - no pickaxe or level;
  - a full inventory or sack;
  - "You already have enough pay-dirt to fill the sack.";
  - depositing with no room;
  - an empty sack, or one still washing;
  - the ladder without access;
  - the hammer;
  - the Mining Guild.

  These are OpenRune's, or this plugin's own.
- **Getting out** through the tunnels, the Mining Guild cave, the ladder and the shortcuts: their tiles and timings are OpenRune's.

## Not built yet

- The rockfall's splash (spotanim 305): there's no packet for a graphic on a tile.
- The respawn timers drawn over depleted veins (client script 5474, `add_overlaytimer_loc`).
- The medium Falador diary that the eastern dark tunnel needs, since there are no achievement diaries yet.
- The coal bag, gem bag and the prospector outfit's XP bonus.
- Mercy's other dialogue, and the Falador elite diary's better ore chances.
