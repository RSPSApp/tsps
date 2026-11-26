# Wyrmscraig

Three plugins cover Wyrmscraig's content:
- **`Wyrmscraig`** (`server/plugins/areas/Wyrmscraig.plugin.js`, units in `wyrmscraig/`, data in `wyrmscraig.json`): open access to Fallen From Grace's finished state, and the cave under Ardeaglais.
- **Agility's shortcuts** (`server/plugins/skills/agility/shortcuts/Wyrmscraig.Agility.js`): the basalt stepping stones and the rocks up to the cathedral.
- **`MadAngel`** (`server/plugins/bosses/MadAngel.plugin.js`, units in `madangel/`, data in `mad-angel.json`): the cathedral's doors and broken pew, a cathedral instance per player, the fight and the kill.

## Sources

- **rsprox captures:** the cave both ways; each shortcut both ways; a Mad Angel kill (doors, pew, waking, the whole fight, the death, the drop, the way out).
- **The Wiki:** the shortcuts' levels and XP; the Mad Angel's stats, mechanics (Mad Angel, Mad Angel/Strategies), drop table and respawn time.
- **The cache:** every id, under the gameval names rsprox prints (`ffg`, `wyrmscraig_cliff_shortcut`, `npc_mad_angel_*`, `vfx_mad_angel_*`, `total_mad_angel_kills`).

## Open access

Fallen From Grace isn't on this server. Every player gets its finished state at login, through the varbits the cache's own multilocs read:

| Varbit | Value | What it shows |
| --- | --- | --- |
| 15759 `ffg` | 20 | The post-quest Mad Angel in Ardeaglais (16313 → 16314), the powered golem in the cave (16320 → 16322) |
| 15720 `wyrmscraig_cliff_shortcut` | 1 | The mined rocks at the top of the cliff shortcut (62265 → 62266) |

The two NPCs are new spawns: the cathedral's angel at 2532,2215 facing east, and the cave's golem at 2573,8650 facing south.

## The cave

| Tick | What happens |
| --- | --- |
| The click | The crawl (2796), sound 2454 (3 loops, delay 4), the fade out and `busy` |
| +2 | The move: in at 2564,8630 facing east; out at 2530,2205 facing south |
| +3 | The fade back in |
| +5 | The overlay closes |

The golem's "Investigate" and the stairs up to the cathedral during the quest are Fallen From
Grace's ([its doc](quests/fallen-from-grace/README.md)).

## The shortcuts

| Object | Shortcut | Agility | Crossing |
| --- | --- | --- | --- |
| 62260 | Basalt stepping stone | 58 | 2584,2286 ↔ 2584,2280, three jumps |
| 62262 | Slippery basalt stepping stone | 62 | 2565,2217 ↔ 2565,2221, two jumps |
| 62261 | Extra slippery basalt stepping stone | 72 | 2614,2250 ↔ 2614,2246, two jumps |
| 62267 (bottom) / 62265 (top) | Rocks | 54 | 2554,2209 ↔ 2550,2209 |

- **A jump:** two tiles, one every 2 ticks. Animation 741 and sound 2461, each 15 cycles in; the move from cycle 30 to 45.
- **The rocks:** one move over 60 cycles, facing the cliff (west) both ways. Up with the climbing loop (4435), down with 740; sound 2454 (3 loops, delay 5).
- **XP:** 5 a crossing, 2 ticks after the last move.
- **The rocks' top end** is a nameless multiloc (gameval `wyrmscraig_cliff_shortcut_top`). The client sends its base id, so the shortcut is hooked by that id.

## The Mad Angel

### Getting in and out

- **The doors** (62368/62369, "Open"): the drag (4282) and sound 62 (delay 20), and the next tick the player is a tile across.
- **Climb on the broken pew** (62250):
  1. The pick-up animation (832, delay 30), the fade out and `busy`.
  2. +1: the minimap off.
  3. +2: the player's own cathedral, with the player at 2537,2215 (its copy). OSRS copies the 13×13-chunk scene from chunk 311,270, every plane, unturned; so does `TemplatedInstanceArea`. The angel is dormant on its spot.
  4. +3: the fade and the minimap back, and "You climb over the broken pew...".
- **Exit on the pew** (62251): "Are you sure you want to leave?" (Yes!/No.). **Quick-exit** skips the question. Then the fade, and back at 2539,2216 facing the doors; the fade comes back 4 ticks after it started.
- **Leaving any other way** (teleporting, dying, logging out) ends the cathedral. A login inside is moved outside the pew.

### The fight

- **Wake** (16306): the wake animation (3321) and graphic (4010), music 885. 3 ticks later it's the fighting angel (16305), and the HP HUD opens (the `BossHud` plugin, [boss-hud.md](boss-hud.md)). Its first swing comes the tick after.
- **Its standard attack:** melee (4589, sound 2676) every 6 ticks, landing 2 later. Max 31; Protect from Melee lowers it to 5 rather than blocking it (Wiki).
- **After three standard attacks, a special,** in turn: the sweep, the blast, the smite. The sweep and the smite hold its standard attacks; the blast doesn't.
- **Never on a step:** the angel only moves while it blasts (following the player), and live it never starts a sweep or a smite on a tick it stepped. When ours would, it stands still and starts the special 2 ticks later (`specials.settleTicks`). The client holds a step that arrives with an animation like theirs until the animation ends, so a step taken with the sweep's wind-up kept the angel drawn a tile off for the whole enraged chain, its turns and dust offset with it.

**Sweep:**
- **The wind-up:** the sword drawn to one side (`*_01`), turned to face the player along an axis.
- **Facing:** it turns to the player with each cleave but the last. After the last it holds still and keeps its facing for 3 ticks, then turns back to the player (as captured).
- **The cleaves:** 4, 6 ticks apart (enraged: 6, 4 ticks apart). Each animation names the swing and what the sword does next: `right_left` swings right and swaps to the left, `right_02` swings right again, `right_reset` is the last.
- **Which way a cleave goes:** towards the diagonal between the way the angel faced at the step before (towards the player then) and the sword's side.
  - In the capture, the boss always faced along an axis.
  - Ten of ten captured cleaves fit this rule; the test checks each one.
- **The tiles** (dust, graphic 2184) are half the floor, worked out from where the angel stands:
  - every arena tile on that diagonal's side of the line through the angel's centre, the angel's own tiles included;
  - the line itself only at its counter-clockwise end, and the centre;
  - the dust starts on the centre (delay 0), then 2 cycles under the angel and 2 more per tile out.
  - All ten captured cleaves match tile for tile, delays included; the test checks their sizes.
- **Being caught:** up to 31, halved by Protect from Melee. The tile is where the player stood before moving that tick.
- **Dodging:** out of the quarter, beside the angel on the far side from the sword (not behind it), the player's next hit is sure to land for at least half their max hit (Wiki).

**Blast:**
- **The throw:** animation 14443 and graphic 4014. The ball (4015) flies to a tile 1–2 tiles from the player, never the player's own, its shadow (1448) on the tile. It lands 6 ticks later (enraged: 5).
- **The first throw** turns the angel to the ball's tile until its next turn.
- **On the tile:** it bounces back to the angel (sound 12056), its graphic (4017) playing on the angel as it arrives, each bounce in the next slot from 11. It throws again in the same tick, up to 3 throws, and 2 ticks later the angel takes 18–22.
- **Missed:** it blows up over the whole floor (graphic 4016, each tile delayed 2 × its Manhattan distance from the ball; sound 12054). The player takes 30+, halved by Protect from Magic.

**Smite:**
- **The charge:** animation 4590 and graphic 4011 (enraged: 8543 and 4012).
- **The strikes:** 5 ticks in (enraged: 5, 9 and 11, as captured). The impact graphic (4013) plays on the player, and the hit lands a tick later.
- **Protect from Magic turned on in that tick** blocks it all, and makes the player's next hit a max hit. Already on, the player takes a quarter. Off, up to 31.
- **Its turns:** the smite also holds the turn that falls on its last strike, so the next special comes 18 ticks after the enraged smite started.
- **The prayer it reads:** the cleaves, the explosion and the smites land in the player's own turn (`onPlayerHitModify`), after that tick's clicks, so a prayer flicked on the tick counts as on live.

**Enrage:**
- **When:** at 350 hitpoints, at its next attack: "...!", a turn of 4 ticks.
- **Then:** the smite, the blast and the sweep, over and over.
- **From then on:** specials back to back, with standard attacks only during the blast. After a sweep its next turn comes 6 ticks after the last cleave, as before the enrage.

### The kill

- **The death animation** (14448) plays for 7 ticks (`deathTicks` in `npc-combat-defs.json`). Whatever special it was in is called off at its last hitpoint.
- **Then, together:** "Your Mad Angel kill count is: N." (varp 5712), "Fight duration: … Personal best: …" (or "(new personal best)"), the drop, and the corpse (16308). 4 ticks later the HUD fades out, and 4 after that it is cleared, as captured.
- **The drop** is the Wiki's table (`npc-drops.json`), with four corrections in `NpcDrops`:
  - the sunstone crystal stays on its 100% table but only drops when owed: no bank chest built and
    none owned (Wiki; Fallen From Grace answers `npc-drops:quest-item`);
  - the Ardeaglais teleport's pre-roll is 1/25;
  - a supply batch (16/150) is sharks or yellowfins, each with a prayer potion(2) and a super combat potion(1).
  - the super combat potions(3), raw monkfish, emeralds and sapphires are noted, as the Wiki marks them (the export lost every "(noted)").

  The export had listed the batch as four separate rolls on a 182 table.
- **The respawn:** the corpse stays for the Wiki's respawn time (26 ticks). Then the angel is back on its spot, dormant, for the next "Wake".

### Not captured, so assumed

| What | Taken as |
| --- | --- |
| The left-handed sweep animations | Named by the cache (`*_left_*`), not seen |
| The pre-enrage smite's timing | Like the enraged first strike (5 ticks in) |
| The enrage cry's turn when it isn't during a blast | 4 ticks, as during the captured blast |
| Bounce graphic slots past the fifth bounce | Back to 11 (the capture's five bounces used 11 to 15) |
| The sweep's, the explosion's and the smite's damage | Up to 31, 32 and 31 (the Wiki gives 30+ for the explosion) |
| The specials' order before the enrage | Sweep, blast, smite (the capture shows the first two) |
| What happens after a kill | The corpse becomes the dormant angel after the respawn time |
| The drop notifications | "Untradeable drop" and "received a drop" are client settings, not sent |
| Golembane weapons | Not modelled |

### The client

The blast's shadow (graphic 1448) lies on a floor covered in flat decorations: marble patterns 1 unit up, and the window light rays (`wyrmscraig_cathedral_lightray01`) 4 units up and see-through.
- **The real client** paints graphics on a tile after them, so the shadow shows on top.
- **Ours depth-tests,** so both renderers (`GfxRenderer` for WebGL, `WebGPUActors` for WebGPU) draw every graphic played on a tile 8 units up (6% of a tile, `TILE_GFX_LIFT_UNITS`) to keep it above them.
- **Back-to-back animations:** each sweep animation lasts exactly one cleave (180 or 120 cycles, plus the client's one). The client steps a sequence only through the cycles after the one it arrived in (`NpcEcs.hasSeqStartedBy`), as the real client does; charging it for the earlier cycles of a render frame's batch ended each swing early and showed the idle pose for a moment before the next.
- **WebGPU's poses** are built by a worker. Until a new swing's first pose is ready (a frame or two), the angel keeps the pose it was showing (`AsyncNpcPoseCache`, up to 150 ms) instead of its unanimated base model, which flashed between swings.
- **The sweep's facing** is sent as face-coordinate turns (`npc.faceTile`), one per step, while the angel is out of combat; combat would otherwise keep it turning to follow the player. The client offsets a face tile by the NPC's size, so the angel is sent the tile one down-left of the one it should face.

### Testing

- **`tests/wyrmscraig.test.cjs`:**
  - the ids against the cache and its gamevals;
  - the shortcuts' levels, ends and timing;
  - open access;
  - the cave;
  - the corrected drop table;
  - the fight's rules (each captured cleave's quarter, the attack cycle, the sweep, the blast, the smite, the enrage).
- **`tests/agility.test.cjs`:** every shortcut's object id is checked against the cache, so nameless multilocs count too.
- **`::madangelhp <hitpoints>`** (developer): sets your angel's hitpoints, to see the enrage (360) or finish it off.
- **`::madangelspecial <sweep|blast|smite>`** (developer): has your woken angel use that special now (enraged if it is).

## Fallen From Grace's angel

As recorded on the quest (Fallen From Grace P2, ticks 314-469; the quest doc has the full table):

- The pew asks "Climb over the pew?" (Yes./No.) while the quest is at stage 16-19
  (`madangel:pew-climb`).
- The cathedral uses the quest variant (`madangel:instance-variant`): the dormant angel (16306)
  wakes by itself 3 ticks after the move, as 16311 and then 16309 (565 hitpoints). It enrages at
  255 hitpoints (Wiki walkthrough) instead of 350.
- Its death: the kill count and the drop as usual, but no fight-duration line; the corpse (16312)
  stays and no angel comes back, and the pew becomes the climbable one (62250), which takes the
  player straight out.
- Back in at stages 18-19 (ours, not recorded): the corpse and the climbable pew, nothing to wake.
