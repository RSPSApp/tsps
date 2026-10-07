# Wyrmscraig

Three plugins cover Wyrmscraig's content:
- **`Wyrmscraig`** (`server/plugins/areas/Wyrmscraig.plugin.js`, units in `wyrmscraig/`, data in `wyrmscraig.json`): open access to Fallen From Grace's finished state, and the cave under Ardeaglais.
- **Agility's shortcuts** (`server/plugins/skills/agility/shortcuts/Wyrmscraig.js`): the basalt stepping stones and the rocks up to the cathedral.
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

Not captured, and not built: the golem's "Investigate" and the stairs up to the boss.

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

- **Wake** (16306): the wake animation (3321) and graphic (4010), music 885. 3 ticks later it's the fighting angel (16305), and the HP HUD opens (the `BossHud` plugin, [boss-hud.md](boss-hud.md)). It attacks the tick after.
- **Its standard attack:** melee (4589, sound 2676) every 6 ticks, landing 2 later. Max 31; Protect from Melee lowers it to 5 rather than blocking it (Wiki).
- **After three standard attacks, a special,** in turn: the sweep, the blast, the smite. The sweep and the smite hold its standard attacks; the blast doesn't.

**Sweep:**
- **The wind-up:** the sword drawn to one side (`*_01`).
- **The cleaves:** 4, 6 ticks apart (enraged: 6, 4 ticks apart). Each animation names the swing and what the sword does next: `right_left` swings right and swaps to the left, `right_02` swings right again, `right_reset` is the last.
- **Where a cleave hits:** the quarter of the arena between the way the angel faced at the step before (towards the player then) and the sword's side.
  - In the capture, the boss always faced along an axis.
  - Ten of ten captured cleaves fit this rule; the test checks each one.
- **The tiles** are the captured dust (graphic 2184), stored per quarter as offsets from the angel's centre with their delays.
- **Being caught:** up to 31, halved by Protect from Melee.
- **Dodging:** out of the quarter, beside the angel on the far side from the sword (not behind it), the player's next hit is sure to land for at least half their max hit (Wiki).

**Blast:**
- **The throw:** animation 14443 and graphic 4014. The ball (4015) flies to a tile 1–2 tiles from the player, never the player's own, its shadow (1448) on the tile. It lands 6 ticks later (enraged: 5).
- **On the tile:** it bounces back (graphic 4017 on the player, sound 12056). 2 ticks later the angel takes 18–22, and it throws again, up to 3 throws.
- **Missed:** it blows up over the whole floor (graphic 4016, each tile delayed 2 × its Manhattan distance from the ball; sound 12054). The player takes 30+, halved by Protect from Magic.

**Smite:**
- **The charge:** animation 4590 and graphic 4011 (enraged: 8543 and 4012).
- **The strikes:** 5 ticks in (enraged: 5, 9 and 11, as captured). The impact graphic (4013) plays on the player, and the hit lands a tick later.
- **Protect from Magic turned on in that tick** blocks it all, and makes the player's next hit a max hit. Already on, the player takes a quarter. Off, up to 31.

**Enrage:**
- **When:** at 350 hitpoints, at its next attack: "...!".
- **Then:** the smite, the blast and the sweep in a row.
- **From then on:** specials back to back, with standard attacks only during the blast (as in the capture, after the opening three).

### The kill

- **The death animation** (14448) plays for 7 ticks (`deathTicks` in `npc-combat-defs.json`).
- **Then, together:** "Your Mad Angel kill count is: N." (varp 5712), "Fight duration: … Personal best: …" (or "(new personal best)"), the drop, and the corpse (16308). 4 ticks later the HUD fades out, and 4 after that it is cleared, as captured.
- **The drop** is the Wiki's table (`npc-drops.json`), with four corrections in `NpcDrops`:
  - the sunstone crystal is Fallen From Grace's, so it's left out;
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
| The sweep's, the explosion's and the smite's damage | Up to 31, 32 and 31 (the Wiki gives 30+ for the explosion) |
| The specials' order before the enrage | Sweep, blast, smite (the capture shows the first two) |
| What happens after a kill | The corpse becomes the dormant angel after the respawn time |
| The drop notifications | "Untradeable drop" and "received a drop" are client settings, not sent |
| Golembane weapons | Not modelled |

### The client

The blast's shadow (graphic 1448) lies on a floor covered in flat decorations: marble patterns 1 unit up, and the window light rays (`wyrmscraig_cathedral_lightray01`) 4 units up and see-through.
- **The real client** paints graphics on a tile after them, so the shadow shows on top.
- **Ours depth-tests,** so `GfxRenderer` draws every graphic played on a tile 8 units up (6% of a tile) to keep it above them.
- **The sweep's facing** is sent as face-coordinate turns (`npc.faceTile`), one per step, while the angel is out of combat; combat would otherwise keep it turning to follow the player.

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
