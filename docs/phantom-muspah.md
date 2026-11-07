# Phantom Muspah

The Phantom Muspah (https://oldschool.runescape.wiki/w/Phantom_Muspah), solo, after Secrets of the
North. Built from rsprox captures (https://rsprox.net/database), the OSRS Wiki
(`Phantom_Muspah`, `Phantom_Muspah/Strategies`, `Spike_(Phantom_Muspah)`, `Corruption_(status)`,
`Frozen_cache`) and the cache. It is one plugin, `server/plugins/bosses/PhantomMuspah.plugin.js`,
with one unit per part in `server/plugins/bosses/phantommuspah/` and its data in
`server/plugins/bosses/data/phantom-muspah.json`.

## Sources

The captures are recordings 1762, 1767, 1774 and 91 (Leagues V, rev 227) and 3282 and 3329 (Grid
Master, rev 234-235): about 160 kills, plus 1694 for the quest's version of the fight. Every one of
them is on a Leagues or event world, so the boss's side (ids, animations, graphics, projectiles,
sounds, varps, the order and timing of everything it does) is taken from them as is. Anything
that depends on how hard the player hits (how long a form lasts, how often a special fires before
the next one) is skewed by the relics and taken from the Wiki instead. Where a value below is
neither captured nor in the Wiki it is marked **estimate**.

## Layout

| File | What it owns |
| --- | --- |
| `Common.PhantomMuspah.js` | The data, tick helpers, graphics, sounds, the overlay script. |
| `Lair.PhantomMuspah.js` | The way in (Ghorrock Dungeon's crevice), the instance, the way out, logging out and dying inside. |
| `Fight.PhantomMuspah.js` | One fight: spawn, forms, form switches, specials' timing, the shield skip, the HUD, the kill. |
| `Attacks.PhantomMuspah.js` | Its ranged, magic and melee attacks, rolled as they land. |
| `Spikes.PhantomMuspah.js` | Spikes: the waves, the knock-back, homing spikes, the spikes spreading after the shield. |
| `Clouds.PhantomMuspah.js` | The teleport special and its lightning clouds. |
| `Shield.PhantomMuspah.js` | The shockwave, the prayer shield and Soul Split. |
| `Corruption.PhantomMuspah.js` | The corruption status its magic attack and shockwave inflict. |
| `Hits.PhantomMuspah.js` | Styled hits through prayer, typeless damage, map animations, projectiles. |
| `Loot.PhantomMuspah.js` | Kill count, fight duration, Charged ice, the Venator shard rule, the frozen cache. |
| `Commands.PhantomMuspah.js` | Developer commands for testing. |

## The way in and out

| Step | What happens | Source |
| --- | --- | --- |
| Crevice `ghorrock_dungeon_cave_entry` (46597, Enter) at (2908, 10316) | Needs Secrets of the North complete (before that, the quest's own crevice handling runs). Face west; "You enter the icy cavern." in a box with `fade_overlay` [0, 200, 0, 0, 50]; minimap off a tick later; two ticks in, the move into a copy of the lair at (2859, 4259) facing west, the area's music, then the fade back in ([0, 0, 0, 255, 50]) with the box again. | capture (174 attempts) |
| The instance | All 8x8 chunks of the lair's map square (2816-2879, 4224-4287), planes 0 and 1, unturned. | capture (`build_area`) |
| Escape crevice `sotn_muspah_escape` (46599) | Placed at (2860, 4258), shape 10, rotation 0, when the boss spawns. Escape takes the player back to (2909, 10317) behind the same fade ("You leave the icy cavern."); Quick-escape at once. | capture (the loc); ours (the trip out and its message: one capture, no response recorded) |
| Logging out, teleporting, dying | Ends the instance. A player saved inside logs back in by the crevice. A death is a normal death; the grave appears outside the lair (Wiki), and what fell on the lair's floor (the supply pile) is carried out to the crevice with it. | Wiki (the grave); ours (the floor) |

## The boss

Five forms, all size 5, 850 hitpoints, combat 741. Stats come from the cache and
`monsters-complete.json`; max hits from the Wiki infobox.

| Form | Id | Attacks | Speed | Max hits |
| --- | --- | --- | --- | --- |
| Ranged | 12077 (`muspah`) | Ranged, magic (about 1 in 5) | 6 | 61 ranged, 72 magic |
| Melee | 12078 (`muspah_melee`) | Stab | 5 | 34, more the longer it stands still |
| Teleporting | 12082 (`muspah_teleport`) | Lightning clouds | - | 20 |
| Shielded | 12079 (`muspah_soulsplit`) | Ranged, magic (1 in 5), Soul Split | 5 | 72 ranged, 79 magic, 80 shockwave |
| Post-shield | 12080 (`muspah_final`) | Ranged, magic (1 in 5) | 5 | 72 ranged, 79 magic |

Attack speeds are the Wiki's, and match the captures (ranged form 6 ticks, the rest 5). The magic
share is captured: 26 of 119 attacks in ranged form, 92 of 489 shielded, 32 of 167 after the
shield, with no fixed pattern.

The attackable forms (12077-12080) can be frozen, for 66% of the spell's base duration (Wiki: 33%
freeze resistance); the teleporting form can't be attacked.

| Attack | What happens | Source |
| --- | --- | --- |
| Ranged | Seq 9922; projectile 2329 (start 26, end 60, angle 5, progress 244, heights 32 to 25); sounds 6705 (delay 2), 6787 (21), 6692 (22); the hit lands 2 ticks later, with spot 2293 (delay 60) and sound 6774 when it hits. | capture (608 hits) |
| Magic | Seq 9918 with spot 2319 and sounds 6731 (2), 6680 (3), 6813 (11), 6662 (22); two ticks later projectile 2327 (start 24, end 54, angle 5, heights 100 to 24); the hit lands 4 ticks after the attack, spot 2328 (height 124). Protect from Magic blocks it; otherwise it corrupts. | capture (132 hits); Wiki |
| Melee | Seq 9920 with spot 2320 and sound 6674 (delay 30); the hit lands a tick later. Stab. It hits harder, even through Protect from Melee, the longer the Muspah has stood still: **estimate**, +1 max hit and 5% through prayer per still tick, up to +20 and 50%. | capture; Wiki (qualitative) |

## Form switches

The Muspah swaps between ranged and melee after at least 100 damage in ranged form or 80 in melee
form, and at least four separate damaging hits since the last switch (Wiki; captures agree: the
fewest seen were 100 and 80). The switch is seq 9936; a tick later the new form with seq 9937 and
spot 2334, and a wave of spikes.

## Spikes

| Step | What happens | Source |
| --- | --- | --- |
| Warning | Spot 2335 on each tile. | capture |
| Rising (2 ticks later) | Loc `muspah_spike_pre` (46693), spot 2324; a player on the tile is knocked to a free neighbouring tile (seq 1114, an exact move over 29 cycles), hit, and the Muspah heals 75% of it. | capture (290 knock-backs); Wiki (heal) |
| Up (3 ticks after the warning) | Loc `muspah_spike` (46695), random rotation, blocks the tile; sounds 1678 and 6780 and a camera shake. | capture |
| Despawn | `invisible_type8_nonblocking` (29733) and `muspah_spike_post` (46694) with spot 2325, then removed. | capture |

Waves:

- **Spawn:** two spikes near the arena's edge as the Muspah appears. capture
- **Form switch:** one more tile next to each existing cluster and one under the player. capture
- **After the shield:** every fourth attack, one under the player and a growing number next to the
  existing clusters, so the arena slowly fills. capture (the timing); **estimate** (how many).

Knock-back damage: the captures cluster at 9-15. **estimate**: 9-15.

## Specials

At 75% (637) and 50% (425) hitpoints. A Muspah that spawned in ranged form uses Lightning clouds
first, one that spawned in melee form Homing spikes first; the other comes at 50% (Wiki; the
captures agree in every kill).

### Homing spikes

"The Phantom Muspah floods the room with darkness..." (purple), seq 9923 with spot 2321, the
overlay darkened (`muspah_set_overlay_fade` 130). Two to four existing spikes, never one next to
the player or under the Muspah, sink (despawn) and come back as `muspah_spike_follow` (46697). Each
moves one tile every 2 ticks towards the player, never diagonally and never through a standing
spike, with spot 2326 and area sounds 6686 and 6764 (delay 30) each step; the tile it left clears
a tick later. Reaching the player knocks them back like a rising spike. After 34 ticks, or when
the shield goes up, they harden where they stand into ordinary spikes. capture; Wiki
(34 ticks, the shield ending them). Damage: **estimate** 9-15, as the other spikes.

### Lightning clouds

"The Phantom Muspah floods the room with darkness...", seq 9928 with spot 2332 and sounds 6717,
6732, 6759, 6724 (delays 11-14). Three ticks later the teleporting form (12082). From the next
tick it jumps every tick through the same eight tiles, (2854, 4257), (2840, 4263), (2845, 4249),
(2852, 4263), (2838, 4257), (2851, 4251), (2846, 4262), (2839, 4250), twenty jumps in all, each
with seq 9930, spot 2333, sound 6820, and facing the arena's centre (2847, 4258). It lands on
(2852, 4263) with seq 9932 and spot 2334 in the form it left. capture (every recorded teleport).

Each jump sends up to four lightning clouds (NPC 12083, `muspah_projectile`) from tiles between
it and the centre, heading away from it; they step a tile a tick until the arena's edge stops
them, then play seq 9948 and go. A cloud on the player's tile hits for up to 20. capture (the
clouds); Wiki (20).

The Muspah's Defence cannot be reduced below 125; reductions persist across forms until the shield rises and restores it to 200 (Wiki).

## The shockwave and the shield

Below 127 hitpoints, at its next attack: the purple message and seq 9928 with spot 2332, the
overlay darkened; three ticks later at the centre ((2845, 4256), its centre tile (2847, 4258)),
seq 9932 and spot 2334; two ticks later seq 9925 with spot 2322 and sounds 6744, 6828, 6707,
6796, 6843, 6753, 6685, 6807; five ticks after that spot 2323, sound 6817 and the shockwave:
map animations on every tile, 3 cycles further per tile (`projectile_muspah_attack_explode_03`
2330 and the darker 2331). Tiles behind a spike, as seen from the centre, get none and are safe.
Elsewhere up to 80 typeless damage and corruption. Three ticks later the shielded form. capture;
Wiki (80).

Shield skip: damage that would kill it during the shockwave's wind-up is undone, and it stays on
the hitpoints it had (capture: 9 to 0 to 9). If its hitpoints reach 0 between the teleport and the
wind-up, the shield is skipped and it is left on 1 hitpoint (Wiki).

| Shielded | What happens | Source |
| --- | --- | --- |
| The shield | 75 points, shown on the HUD (`hpbar_hud_basehp` 75, npc 12079) and the head bar. Regular hits do nothing ("The Phantom Muspah's prayer shield mitigates regular damage."). | capture; Wiki |
| Draining it | 2 points after each of its attacks; a player hit with Smite on drains a quarter of the hit (the prayer-drain hitsplat, 60). | Wiki; capture (the hitsplat) |
| Soul Split | It heals half of the damage it deals, rounded down. | Wiki |
| Breaking it | The post-shield form (12080), the HUD back to hitpoints, and a wave of spikes. Homing spikes still moving harden. | capture; Wiki |

## Corruption

| Tick | What happens | Source |
| --- | --- | --- |
| 0 | "You have been corrupted!" (pink); varbits `corruption_target_iterations` (12142) 3, `corruption_current_iterations` (12141) 1, `corruption_base_damage` (12140) 3 from the magic attack, 4 from the shockwave. | capture |
| 10, 20 | current iterations 2, 3 | capture |
| 11, 21 | Prayer drained by base x 1, then base x 2, with the corruption hitsplat (0). | capture |
| 30 | The varbits back to 0, "You are no longer afflicted with corruption.", the last drain (base x 3). | capture |

A new corruption while one runs starts it again.

## The kill

At 0 hitpoints, seq 9941. Five ticks later "Your Phantom Muspah kill count is: N." (varp
`total_muspah_kills` 3752), the fight's length against the personal best ("Fight duration: m:ss.SS
(new personal best)" or "... Personal best: ..."), and the loot on its centre tile. capture.
The next Muspah spawns 30 seconds later (Wiki; the Leagues captures show 25 ticks).

Loot is the Wiki table in `npc-drops.json`, plus:

- Charged ice: guaranteed for a kill under 3:00 when the player doesn't have one or a Muphin that
  has used one (Wiki). "Untradeable drop: Charged ice" (capture).
- A Venator shard comes with no other main-table loot (Wiki).
- The frozen cache opens into the Wiki's table (pre-roll 1/50: another cache, Ancient icon,
  Venator shard), with "You open the frozen cache and find... another frozen cache inside! How
  peculiar." for a cache.

## The scoreboard

`muspah_scoreboard_multi` (46901) by the crevice shows as `muspah_scoreboard` (46700, "Scoreboard":
Read) once varbit `sotn` is 90. Read opens interface `muspah_scoreboard` (817): the reader's kill
count, deaths and best time, then the world's (Wiki, Scoreboard (Phantom Muspah); the row labels
and the "Phantom Muspah Statistics" title are the cache's). The personal kill count and best time
are the kill messages' own; a death in the lair counts. The world's numbers are kept in
`data/saves/phantom-muspah-scoreboard.json`. No recording reads this board, so the number and time
formats follow the Araxxor board's recording ("1,234", "0:52.80", "-" with none).

The board is a straight wall decoration (shape 4, rotation 0) on rock, so the shared wall-decoration
reach finds no tile to stand on; the route goes to the open tile west of it.

## Checked in game

With the agent MCP (`::muspah`, `::muspahhp`, `::muspahshield`, `::muspahkill`):

- The crevice before Secrets of the North ("The crevice is too narrow...", the quest's) and after
  (the fade, the instance, both music tracks, the Muspah in ranged or melee form with two spikes,
  the HUD on 850).
- A form switch from real damage (ranged to melee after 114, with its spike wave), and a spike
  stopping the player walking onto it.
- Its melee and ranged hits, whip damage on it, Homing spikes at 636 and Lightning clouds after
  (the teleporting form, back to its form after), the Muspah healing from spike knock-backs.
- The shockwave at 126 (hit and corrupted with base 4), the shield on the HUD (75, npc 12079),
  2 drained per attack, Smite breaking it, the post-shield form with its HUD and a spike wave.
- The kill: kill count, fight duration, Charged ice with its message, loot on its centre tile,
  the next Muspah 30 seconds later; the escape crevice; a death ending the lair, with the supply
  pile carried out to the crevice.
- The scoreboard: Read from the open floor, 817 opened; a death and a kill (0:52.80) reached the
  world records file; the board reads again after a relog.
- `tests/phantom-muspah-scoreboard.test.cjs`: the board's rows from the real kill hook, deaths,
  world records across players and a restart, the route to its front tile.
- `tests/phantom-muspah.test.cjs`: the arena, instance tiles, durations, the frozen cache, Charged
  ice, the Venator shard rule, the shockwave's shelter, corruption's ticks and drains, the freeze
  resistance.

How it all looks (graphics, the overlay, spikes rising and moving) is left to playing it.

## Not in yet

- Sergeant Raymond's warning at the crevice.
- Enchanted sapphire bolts and corruption spells draining the shield.
- Combat Achievements counts the kill from the Muspah's death, so its task messages come before
  the kill count (live sends the kill count first). Counting it by event instead would lose the
  speed and other tasks derived from the fight.
- Estimates, to check against a capture: the melee form's still-standing bonus, spike and homing
  spike damage, how many tiles each post-shield growth adds, where clouds start and what they hit
  for.
