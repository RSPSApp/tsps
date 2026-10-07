# Doom of Mokhaiotl

The delve boss beneath the Ruins of Mokhaiotl (`server/plugins/bosses/DoomOfMokhaiotl.plugin.js`, units in `server/plugins/bosses/doom/`). Behaviour comes from the OSRS Wiki ("Doom of Mokhaiotl" and "Doom of Mokhaiotl/Strategies"). Ids, tiles and timings come from two live captures:

- `doom.txt`: the ruins and about a minute of delve 1.
- `doom-wave1-5.txt`: delves 1 to 4 completed, then death at delve 5 from a melee-charge beam.

Anything from neither source is listed under [Guesses](#guesses). That covers the reward screen's claiming and chest views, delves 6+, and parts of the Wiki the captures didn't show.

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Access, the lobby, the instance, delves and the burrow hole, the boss HUD, death and logouts | Done |
| 2 | Delves 1–2: orbs, the tongue, rock throws, larvae and their charge, the melee charge and beam, shockwaves with volatile earth and the earthen shield | Done |
| 3 | Delves 3–4: acid blood, the demonic shield (14708) with its beam, coloured larvae | Done |
| 4 | Delves 5–8+: the burrowed "car" phase (14709), car slams and rockblock, giant larvae, two rock throws | Done |
| 5 | Delve-scaled loot, the reward screen (interface 919), the unclaimed-loot chest, the scoreboard (920) | Done |

The Doom's items (Eye of Ayak, avernic treads, Mokhaiotl cloth, Dom) are a separate piece of work.

## Layout

| File | What it owns |
| --- | --- |
| `DoomShared.js` | Ids, tiles, the two arenas, varps and helpers. |
| `DoomDelves.js` | What changes with the delve level (the Wiki's table). |
| `DoomRun.js` | A player's run: the instance, delves, the HUD, the burrow hole, varps and messages, leaving. |
| `DoomBoss.js` | The Doom's attacks, the melee charge, shockwaves and the rotation. |
| `DoomHazards.js` | Larvae, rocks, volatile earth and the earthen shield. |
| `DoomAcid.js` | Acid blood (delve 3+). |
| `DoomHolyWater.js` | The holy water after a melee-punish kill. |
| `DoomShield.js` | The demonic shield (delve 3+). |
| `DoomBurrow.js` | The burrowed "car" phase (delve 5+). |
| `DoomLoot.js` | The loot table and its delve scaling. |
| `DoomRecords.js` | Personal and world records (`data/saves/doom-scoreboard.json`). |
| `Rewards.*` | The burrow hole's reward screen, claiming, the lobby's chest. |
| `Scoreboard.*` | The lobby's scoreboard. |
| `Lobby.*` | The ruins' entrance, the lobby's exit and the gap. |
| `Delve.*` | Objects in the arena, combat rules, death and logging in. |
| `Commands.*` | Developer commands. |

## Access

The Doom needs The Final Dawn. Here it is open to everyone, like Zulrah. The ruins' entrance (56613 at (1310, 9533, 1)) is a multiloc on The Final Dawn's varbit 16663: at 68 (complete) it shows as 56616, Pass-through. That value is sent on login and on entering the ruins.

| What | Where | Notes |
| --- | --- | --- |
| Entrance (56613/56616) | (1310, 9533, 1) | Fades out (script 948 on interface 174) and puts you in the lobby at (1311, 9540). |
| Exit (56618) | (1310, 9539) | Back outside the entrance (guess). |
| Gap (57289, Jump-over) | (1310, 9557) | The jump (anim 12196) and "You jump the gap...", into the arena. |
| Scoreboard (57288) | (1314, 9547) | See [The scoreboard](#the-scoreboard). |
| Chest (50938) | (1307, 9548) | Unclaimed rewards. |

`::teleports` lists it under Bosses, outside the entrance.

## The instance

Capture: a run copies two map squares, and the arena sits at the same local tiles in both.

- **Delve 1** copies map square 20_149 (1280–1343, 9536–9599), the square the lobby is in. The player lands at (1311, 9559) and the gap behind them becomes 57290 (Exit, Quick-exit).
- **Delves 2+** copy a separate square, 53_100 (3392–3455, 6400–6463). Descending puts the player at local (31, 30), which is (3423, 6430). That square has no way out but the burrow hole's rewards, teleporting or dying.

Each run is one `PrivateArea` over delve 1's arena (y 9557+, so not the lobby) and the whole deeper square, at real coordinates. The code is written in delve 1's frame. `Shared.shift` moves a tile into the deeper square and `Shared.frame` brings one back.

Rocks and acid stay from delve to delve. Delve 2 leaves delve 1's behind with the square, and delve 6 starts clean (Wiki). Nothing re-sends the map after a run, so leaving shows the lobby's gap again and takes away the run's rocks and hole.

## A delve

**The Doom surfaces** once the prompt is closed, or the player moves or prays. The prompt is "You jump the gap..." at delve 1 and "You jump further into the burrow..." after each descent.

It appears at local (29, 35), its south-west tile (it is 5×5), with anim 12418 and graphic 3372. The same tick:
- varp 4805 is set to the cycle, 4828 to the level (0-based), and 4804 is cleared;
- the boss HUD opens: varp 1683 = 14707, varbits 6099/6100 = its hitpoints, 12401 = 1, then scripts 2376 and 2887 (the `BossHud` plugin, [boss-hud.md](boss-hud.md)). Its overhead bar is headbar 20.

**Beaten** (capture), it plays 12422 with graphic 3377 and its larvae and volatile earth go. The game says:
- "Delve level: N duration: m:ss.cc. Personal best: m:ss.cc"
- "Total duration: m:ss.cc"

The varps set are 4807 (all completions), 4808–4816 (this level's), 4798 (the level, 0-based), 4804 (its ticks) and 4803 (the run's ticks).

Five ticks later the burrow hole (57285) opens where the Doom was, with loc anim 12477. The Doom goes at seven. As in the game, it's used from wherever it's clicked, with no walk to it (an `onObjectRoute` to the player's own tile).
- **Descend** follows it to the next delve. With a unique waiting, it asks first (Wiki).
- **Investigate** opens the reward screen (see [Rewards](#rewards)).

**Leaving:** claiming, dying or teleporting out ends the run, so the delve level starts again at 1 (Wiki). Delve 1's gap: **Exit** asks first, **Quick-exit** leaves at once.

**Death** (capture): "Oh dear, you are dead!", then the lobby at (1313, 9555), by the gap, and varp 4828 back to 0. What would drop lands there, as the grave would be. A logout ends the run, and logging back in puts the player at the gap.

## The Doom by delve (Wiki, and the captures for delves 1–5)

| Delve | HP | Speed | Max hit | Orb lands (cycle) | Rock pieces | Rock orbs | Shockwaves | Larvae | Beam | Punish delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 525 | 6 | 47 | 205 | 8 | 1 | 1 | melee or none | 60 | 8 |
| 2 | 550 | 6 | 50 | 205 | 12 | 2 | 1 | melee or none | 60 | 8 |
| 3 | 575 | 5 | 50 | 175 | 15 | 2 | 2 | any prayer | 60 | 7 |
| 4 | 600 | 5 | 50 | 175 | 17 | 3 | 2 | coloured | 80 | 7 |
| 5 | 625 | 5 | 53 | 145 | 18 | 3 | 3 | 2× coloured | 80 | 7 |
| 6 | 650 | 5 | 53 | 115 | 19 | 3 | 3 | 2× coloured | 99 | 7 |
| 7 | 650 | 4 | 57 | 115 | 20 | 3 | 4 | 2× coloured | 99 | 6 |
| 8 | 675 | 4 | 65 | 115 | 21 | 2×3 | 5 | giant | 99 | 6 |
| 9+ | 625 | 4 | 65 | 115 | 21 | 2×3 | 5 | giant | 99 | 6 |

The orb and rock-piece columns from delve 6 on are guesses. The punish delay is the Wiki's, counted from the attack; the captures show the next attack that many ticks less one after the hit lands.

## Attacks

The Doom's own combat does nothing; the run attacks on its own timer. None of its NPCs (its three forms, the larvae, volatile earth, the earthen shield) play a block animation when hit (capture), so `npc-combat-defs.json` gives them `"block": -1` with their captured spawn and death animations; without an entry they got the default human block (424).

- **First attack:** 6 ticks after it surfaces.
- **Tongue:** when the player stands beside it (not at a corner). Anim 12416, the hit lands the next tick, and it acts again 4 ticks later. Wiki: up to 40, halved by Protect from Melee.
- **Orb:** anim 12406, projectile 3380 (Ranged), 3379 (Magic) or, from delve 2, 3378 (Melee).
  - It flies from cycle 55 to the cycle in the table, heights 387 to 100, angle 30 and progress 147. Its launch sound plays at delay 55: 10341 (Ranged), 10375 (Magic), 10367 (Melee).
  - It lands with graphic 2490 or 2492 (spotanim slot 2) at height 100 and impact sound 7026 or 7023, but only when it isn't prayed against (51 impacts for 91 orbs in the capture). The red orb's are guesses: 2491 (between the others, on the same animation) and 7025.
  - It is rolled on impact (Wiki).
- **The pattern** (capture): one to three orbs between rock throws, sometimes a throw at once. After a throw the Doom acts again after twice its attack speed.
  - **No overlap with the rock's orbs:** its next attack waits while a rock is in the air, and until its orb would land the tick after the rock's last orb. The delve-5 capture had the orb after a throw 12 ticks on, not 10; the Wiki's changelog keeps them apart after a melee punish too.
- **Rock throw:** anim 12407, projectile 3384/3385 from its centre to the tile beside it towards the player (cycles 60 to 210, from delve 5 to 180; heights 340 to 500, angle 50, progress 124).
  - **7 ticks later it bursts** (6 from delve 5: all four delve-5 throws in the capture). Graphic 3386/3387 where it lands, with area sound 10331 (range 10), and the player's protection prayers turn off.
  - The pieces fly (see the table): one to the player's tile and the rest within four tiles. Projectiles 3388–3395, 60 + 3 cycles a tile, heights 500 to 0, each with a shadow (2380) on its tile. Each piece's impact comes with area sound 10297 (range 1), delayed as the impact.
  - **2 ticks later** the impacts (3404) are sent, each delayed to its piece's landing.
  - **The tick after:**
    - a rock (57286) stands on the marked tile;
    - a player on a piece's tile is hit (Wiki: up to 21);
    - a player on the rock's tile is thrown aside (anim 1114);
    - the rock's orbs leave together from the pieces' tiles, landing a tick apart from cycle 90 (150 at delve 2), alternating styles from the rock's.
  - At delve 8, two rocks (Wiki).
- **The melee charge** (capture): 2 ticks after about one throw in three. Never with throws before a shockwave (Wiki).
  - Headbar 81 (100 wide) fills over 390 cycles (`npc.showHeadbar`), and the Doom shows headicon 6 (Magic and Ranged). When the charge ends the bar empties (0 to 0 over 1 cycle).
  - Anim 12408, then 12409 with graphic 3412 each tick.
  - Only melee lands, and always (100% accurate through `api.onCombatHitRoll`'s `forceAccurate`). A melee hit cancels the charge (12410). The bonus, a fifth of the visible Strength bonus, lands the next tick as its own hitsplat (type 17), once per hitsplat of the hit (23 and 23 from a crystal halberd).
  - Left 13 ticks it fires (12411), hitting the next tick: 80 at delve 5 killed the captured player.
  - **The beam** (capture, also the shield's and the burrowed Doom's): five flat projectiles from its centre to the player at height 100, a head (3409, cycles 0–25), three middle segments (3410, 1–26, 1–27, 1–28) and an end (3411, 2–29); the next tick graphic 3413 (height 50) on the player and the hit.
  - **A melee-punish kill** (Wiki): at delves 1–8, holy water flies out around the Doom, restoring 28 hitpoints, 14 prayer and 25% special attack, and clearing acid in a 3×3 where each lands. Only a player standing in a splash's 3×3 is restored (seen in game), once. The changelog has it guaranteed when the Doom dies during the punish phase. The capture shows none when the killing blow was an arrow loosed before the charge, so here it takes the punishing melee hit (or its bonus the tick after).
- **Shockwave:** volatile earth appear 79–96 ticks into the fight. The timer stands still while the shield is up, and from delve 5 the earth comes as the Doom surfaces instead.
  - The Doom keeps attacking until 15 ticks later: anim 12412, then 12413 at 17.
  - A slam (12414, graphic 3370) at 19, and another every 2 ticks for each further shockwave. Each lands 2 ticks after its slam, with graphics over the floor.
  - 12415 after the last, and it acts again the tick after.
  - Hits of 26–33 were seen; the Wiki says 30–42, so 26–42 here.
- **Volatile earth** (14714, anim 12432): 19–28 of a pool of 39 tiles each time, never under rocks. Destroying one pops it (12434).
  - The second destroyed brings the earthen shield (14715, anim 12436) centred on it. The rest die (12433) and go 2 ticks later.
  - The shield walks to the first earth, diagonally first: every 2 ticks at delve 1 (capture: delve 2 too), every tick from delve 3. The 2-tick steps are crawls (capture), so it slides; the every-tick steps are walks. Standing in it blocks the shockwave.
  - From the tick after it appears, a player inside it is tinted each tick (player tinting: lightness 106, weight 112 over 30 cycles) and one outside gets the clearing tint (hue, saturation and lightness -1). Core's `mobile.tint` sends it.
- **Larvae** (capture):
  - **When:** with about one attack in three at delve 1, one in six deeper. They drop about four tiles past the player, away from the Doom, two side by side from delve 5. They show graphic 3417 and anim 12458.
  - **Prayers:** half pray Melee at delves 1–2 (headicon 0); any prayer at delve 3 (0–2). From delve 4 they are coloured: Melee (14713, headicon 6), Magic (14712, 7) and Ranged (14711, 8). Each takes only its own style, and Melee ones come only during the shield.
  - **Crawl:** a tile every 2 ticks (Melee ones often every tick) to the Doom's centre. Every step is sent as an NPC crawl (`npc.setCrawling`), which clients play at half walking speed, so a larva keeps moving instead of walking a tile and waiting. They path around rocks (seen in game), over the arena floor, and go into the Doom over the last stretch. There the charge varbit 17758 goes up, the player takes graphic 3426 and a hit of the charge, at most 12 (20 from delve 8, 30 for a giant; seen in game), and the Doom heals 9 plus the charge, shown as a heal hitsplat (type 6).
  - **Killed:** they play 12459 with graphic 3374 over their 3×3, with area sound 163 (range 7), and go the next tick. Wiki: up to 21 to the player, or 5–10 to the Doom instead (a type-17 hitsplat in the capture).
  - **Hit with the style they pray:** "The demonic larva seems resistant to your attack."
  - **Demons** (Wiki): demonbane spells are cast on them, so `monsters-complete.json` lists them (14710–14713, giants 14788/14789) with the demon attribute; without it the spells were refused.
  - **Attack timer:** larvae and volatile earth can be attacked while the player's attack is on cooldown (Wiki). The capture (a demonbane bow, speed 4) shows how the timer moves:
    - a larva shot on cooldown leaves the timer as it was (Doom 359, larva 360, Doom 363);
    - a larva shot off cooldown makes the next attack wait 1 tick (larva 350, Doom 351);
    - volatile earth sets the weapon's full delay, demonbane or not (Doom 246, earth 248 and 250, Doom 254).
    
    Only a new target goes in on cooldown: the capture's two earth shots (248, 250) were at two different earths, so attacking the same one again waits for the timer and auto-attack doesn't fire a second shot while the first is in the air. Other weapons on larvae get their normal delay (Wiki). Core's `api.onAttackTiming` (`ignoreDelay`, `keepDelay`, `minimumDelay`, `newTarget`) does this.

## Delves 3–4

- **Acid blood** (capture):
  - Each delve the acid goes one way from the Doom (north at delves 3 and 4, west at 5).
  - Every hit on it sends a blob (projectile 3445, height 100 down, 15 + 3 cycles a tile) to the tile just past its edge, plus one more at delve 3 and two from delve 4 (three from 8, Wiki). The extra blobs land 1–9 tiles out, up to 4 to the side (2 at delve 3).
  - Each blob lands with a splat (3429–3432) and an acid pool (57283, shape 10) the next tick.
  - Standing in acid hurts 3–6 a tick (3–7 here; the Wiki says up to 7) and envenoms (Wiki).
  - No acid while the Doom is shielded or burrowed. Rocks cover acid, and it is back when they break.
- **The demonic shield** (capture): at 75% or less once it has attacked twice (seen at 68%).
  - It comes at its attack's turn: anim 12408, then 2 ticks later it becomes 14708.
  - The HUD shows 500/500 (varp 1683 = 14708), and its bar turns blue: `if_setcolour` on 303:13–15 (132/623/853, back to 25600/576/800 when it ends), then script 2102.
  - Every tick it loops the charge (12409, graphic 3412 in spotanim slot 2), as the melee charge does; it never plays a block animation. On a tick a demonbane hit cancels it, neither the loop nor its graphic plays (hits are processed after the plugin's tick, so the graphic is withdrawn: `mobile.withdrawGraphicInSlot`).
  - Headbar 81 runs 510 cycles (17 ticks) at every delve. Each demonbane hit restarts it (12410 in place of the loop that tick; a larva bursting on the shield doesn't), and shows the shield's points on headbar 11 (120 wide) instead of hitpoints. Anything else is "The demonic shield resists your attack!" (Wiki).
  - A larva bursting on it takes 100, shown as a type-17 hitsplat. Larvae come every 7–9 ticks from the north-west, 8–12 tiles out, the first 5 ticks in.
  - Broken, it becomes the Doom again with a rock throw (delves 3–4), or burrows (delve 5).
  - Left to charge, the beam fires and the shield drops (Wiki). Stored damage from larvae killed during it, up to 50, lands as it drops (Wiki; none was seen).

## Delves 5–8+

- **Burrowing** (capture, delve 5):
  - As the shield breaks: anim 12420 with graphic 3375, and rocks fall (graphic 2529, delay 20) on 24 and 26 tiles in two captures (24–28 here): one on the Doom's centre tile, the rest anywhere free, beside and under it too. The rocks stand 6 ticks later. Sounds: a rumble (10303, 5 loops), rocks falling (10301, delay 45) and landing (10372, delay 160).
  - The camera shakes as it burrows (random 5 on each axis) and resets 5 ticks later, when it becomes 14709 (HUD with its real hitpoints), charging for 600 cycles (20 ticks, headbar 81). Each hit restarts the charge. From then on it shows graphic 3414 in spotanim slot 2 every tick, except a tick a hit restarts the charge.
  - 3 ticks later the eye (graphic 3416, and 3415 with delay 60) marks where its centre will stop. That is the compass direction of the player from its centre, as far as the player is plus four, kept inside the arena.
  - 3 ticks after the eye it goes there, 4 tiles a tick. Rocks in the way break (graphic 2699).
  - Each tick of a zoom is a teleport to that tick's last tile plus an NPC `exact_move` from the tile it left, with `delay1=0`, `delay2=30` and `angle` the direction of travel (768 north-west, 1536 east). Here that is one `npc.exactMove` a tick (its defaults are these values), so the Doom glides; rocks and the player are still checked tile by tile along the way.
  - Facing (capture): as it burrows its lock on the player is cleared (face reset), and burrowed it isn't locked on. As the eye appears it turns to the corner tile it will stop on; while zooming the exact move's angle turns it; the tick after it stops it turns once to the player's tile. Surfaced, it locks on again. This uses the NPC face-coord block (`npc.faceTile`); clients offset the tile by the NPC's size, as they do positions, so the corner it stops on faces straight along its path.
  - Attacks while burrowed are 100% accurate (Wiki), and any hit restarts the charge.
  - The next eye comes 9 ticks after it stops. After the second zoom it surfaces 5 ticks later, into volatile earth and the shockwave.
  - Trample: 10 at delve 5 (seen), 20/30/40 at 6/7/8+ (Wiki).
- **Delve 6+** (Wiki): three zooms, each followed by 1–3 orbs and a car slam.
  - The slam breaks every rock within 15 tiles that no other rock shelters, and hits the player unless a rock is in the way.
  - A rock under its centre (rockblock) stops the slam, and only that rock breaks.
- **Rotation from delve 5** (Wiki): shield, burrow, the shockwave, two attacks, the shield again.

**NPC view distance:** the capture uses the large NPC update throughout the fight (554 of 556), so in the arena NPCs are seen 32 tiles out (`player.setNpcViewDistance`, back to 15 on leaving), the whole floor; their projectiles reach as far.

**Other sounds** (capture): acid flying plays area sound 10345 (range 10) at the Doom's centre.
- **Deep delves (9+):** delve 8 with 625 hitpoints.

## Rewards

Each completed delve rolls once on the Wiki's table (weights out of 104, quantities as at delve 3), scaled by Q_n = Q_3 + trunc(Q_3 × M_n). The multipliers M_n are −0.5, −0.35, 0, 0.05, 0.1, 0.12, 0.14 and 0.17 for delves 1–8, and 0.2 beyond.

On top of that roll:
- **Demon tears** from delve 3: 50, plus 10 a delve, up to 100. The capture had 50 after delve 3 and 110 after delve 4.
- **Uniques** at the delve's overall rate, equally likely among those unlocked: cloth from delve 2, Eye of Ayak from 3, treads from 4.
- **Dom** from delve 6.
- **An elite clue:** 1/75, then 1/50.

The capture's piles were 18 sun-kissed bones (delve 1), then a noted mystic earth staff, a spirit seed and another staff.

**The reward screen** (interface 919, capture):

1. Investigate sends inventories 935 (the loot) and 923 (empty).
2. It opens 919 as the main modal and runs script 7927 with the level 0-based, 0, 0.
3. It sets OP1 on the buttons and ops 1–5 and 10 on the loot's 28 slots, and writes "Value: 1,728 GP".
4. Descend closes it and says "You jump further into the burrow...".

The buttons: Claim & Leave 14, Descend 23, Leave 16, Take-all 17, Bank-all 26.

- **Claim & Leave** moves the loot to the claiming view (7927 with 1 as its second argument): Take-all, Bank-all, then Leave walks out to the lobby.
- **Leaving without claiming** (Exit, teleport, logout) leaves the loot in the lobby's chest (50938, Look-inside). The chest uses the same screen (7927 with 1 as its third argument).
- **Dying after descending** loses the run's loot (Wiki).

## The scoreboard

The scoreboard (57288) opens interface 920, filled with strings:
- **Read** and **Delve-stats** show component 5: personal and global completions and best times per level.
- **General-stats** shows component 3: deepest delve, deaths, best time from delve 1 to 8, and deep delves, personal and global.

## Guesses

- **The run:** the lobby's exit leading outside the entrance; the Exit's question; the wording of a new personal best.
- **Rewards:**
  - the claiming and chest views of script 7927 (only the hole's was captured);
  - the chest's "The chest is empty.";
  - a unique coming on top of the regular roll;
  - the moon key half (30105).
- **Delves 6+:** orb timings (cycle 115), rock pieces (one more a delve) and rock-orb timings from delve 7 (from cycle 30).
- **Burrowing:**
  - 24–28 rocks at delves 5–7 (24 and 26 seen), 16 from delve 8, never on the player's tile, and 3 ticks of grace;
  - speeds of 5/5/8 tiles a tick at delves 6/7/8+;
  - the car slam's damage (26–42) and its orbs (one per 5 tiles travelled).
- **Larvae:** a giant one in three at delve 8, adding one charge.
- **Holy water:** seven projectiles (holy water's, 192) up to four tiles from the Doom's centre, landing a tick apart.
- **Larvae walled in by rocks** crawl straight on, through them.
- **Shockwaves:** at delves 1–4, a repeat 100 ticks after the last.
- **Not done:** the collection log (the server tracks none yet).

## Developer commands

| Command | What it does |
| --- | --- |
| `::doom` | To the lobby. |
| `::doomdelve <n>` | Starts a run at delve n (before the Doom surfaces). |
| `::doomkill` | Beats the Doom of the current delve. |
| `::exactmove [npcId] [tiles] [laps] [snap]` | Glides an NPC (the burrowed Doom by default) around you. |
| `::headbar [npcId] [barId] [cycles]` | Shows a headbar over an NPC (the Doom's charge bar by default), filling, held, then removed. |
| `::ifcolour <group> <child> <rgb15>` | Recolours a component (the Doom's HUD bar is 303:13–15). |
