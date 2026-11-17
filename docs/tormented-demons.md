# Tormented Demons

Tormented Demons (https://oldschool.runescape.wiki/w/Tormented_Demon and its
[Strategies](https://oldschool.runescape.wiki/w/Tormented_Demon/Strategies) page) in the Ancient
Guthixian Temple after While Guthix Sleeps, built from rsprox captures (https://rsprox.net/database),
the OSRS Wiki and the cache. One plugin, `server/plugins/bosses/TormentedDemons.plugin.js`, with its
units in `server/plugins/bosses/tormenteddemons/` and its data in
`server/plugins/bosses/data/tormented-demons.json`.

The captures are all from Leagues V and Grid Master worlds (revisions 227-235): recordings 552,
1756, 3308 and 3312, plus 1752, 1754 and 3412-3417 for the temple's multiway indicator. They are
trusted for packets, animations, graphics, sounds and timing; damage comes from the Wiki.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.TormentedDemons.js` | Ids, timings, per-demon fight state, the prayer each spawn keeps, graphics/sounds/projectile helpers. |
| `Combat.TormentedDemons.js` | The demon's combat method: its three attacks, the bind and fire bombs, two and three demons on one player. |
| `Shield.TormentedDemons.js` | The player's attacks on it: the fire shield and the unshielded attack, defenceless accuracy, its prayer and the 150-damage swap. |
| `Temple.TormentedDemons.js` | The temple `Area`: each room's demon limit and its indicator, who may attack which demon, lost targets, the respawn summon, death effects. |
| `Scroll.TormentedDemons.js` | The Guthixian temple teleport. |
| `CombatAchievements.TormentedDemons.js` | The kill-count varp and the Combat Achievement tasks. |

Outside the plugin:

- `data/definitions/npc-combat-defs.json`: 13599-13602 (the temple pair and the quest pair) with
  no attack or block animation (none was ever captured; the plugin plays the attacks), death
  `luc2_undead_demon_death` (11394) over 6 ticks, and for 13599/13600 a 15-tick respawn after
  removal (21 ticks from death, the Wiki's respawn time; the event-world captures respawn faster).
- `data/definitions/monsters-complete.json`: 13599-13602 had no max hit (so every hit rolled 0)
  and no attack styles; now 31 and melee/ranged/magic (Wiki).
- `data/definitions/npc-spawns.json`: 8 of the 26 Wiki spawns are `tormented_demon_2` (13600), as
  captured on or within two tiles of those spawn tiles; spawns no capture shows stay 13599.
- `plugins/combat/effects/Demonbane.EquipmentEffects.js`: `isDemonbaneAttack(player)`, the same
  weapon list plus demonbane spells, for the shield.
- `plugins/quests/wgs/` (While Guthix Sleeps): after the quest, logging out at the bottom of the
  chasm or in the temple keeps the player there (before, every login threw them back to the top),
  Movario and Darve are gone from the chasm, and `wgs:enter-chasm` takes a scroll's arrival in.

## Getting there

| Step | What happens | Source |
| --- | --- | --- |
| The light creature | After the quest, a lit sapphire lantern on the light creature at the top of the Chasm of Tears floats the player down; the two walls lead up to the temple door (as in the quest). | Wiki, capture (rec 3308) |
| The temple door | `luc2_gt_main_temple_door` (54082, an Opening after the quest) takes the player to (4061, 4466, 0), and `td_multiway_indicator` goes 0 -> 2. | capture |
| Guthixian temple teleport (29684) | "Teleport" lands at (4063, 4557, 0) before the walls, one scroll used. Before the quest: "You need to complete the While Guthix Sleeps quest before you can teleport to Ancient Guthixian Temple." No capture reads the scroll, so it uses the other teleport scrolls' animation 3864, graphic 1039 and sound 200. | Wiki |
| Cannons | Already refused here (`plugins/items/data/cannon-restrictions.json`). | Wiki |

## Rooms

The temple is single-way combat, but each room lets a player fight its own number of demons at
once (Wiki: 10 demons in single rooms, 10 in double, 6 in triple); `td_multiway_indicator`
(varbit 10960) shows the number, 0 outside. The Wiki's multicombat map gives one point per room;
a tile takes the limit of the nearest point. The captured indicator disagrees with that at the
entrance (2, the central chamber, not the nearer single room), down the west corridor (3) and
into the plinth room (1), so those tiles are points too. With them every captured tile reads its
captured value except the two where it changes.

- A player fighting the room's number of demons is refused another: "I'm already under attack."
- Nobody else may attack a demon that is fighting a player: "Someone else is fighting that."
  The demon stays theirs until they leave (teleport, death, logout); it then heals to full.
- The demons themselves are multi-combat NPCs, so the engine's single-combat check never stops a
  second one joining.

## The demon's attacks

| What | Detail | Source |
| --- | --- | --- |
| Speed and max | An attack every 6 ticks, up to 31 in every style. Not aggressive. | Wiki |
| Melee | `luc2_undead_demon_melee` (11392), `luc2_undead_demon_melee_spot` (2851, slot 2), sound 9219. | capture |
| Ranged | `luc2_undead_demon_spare_ribs` (11389), `luc2_rib_bone_shard_spotanim` (2858, slot 2), projectile 2857 (cycles 60-118, angle 10, progress 200, heights 100-30), sound 9253 at 118. | capture |
| Magic | `luc2_undead_demon_firey_balls` (11388), projectile 2853 (30-118, angle 0, progress 160, heights 86-30), `luc2_undead_demon_fireball_impact` (2854, slot 2, height 124, delay 118) on the player, sound 9229 at 118. | capture |
| Hit timing | Both projectiles land at cycle 118 whatever the distance, so the hit lands 4 ticks on. | capture |
| Opening style | Melee half the time, ranged or magic a quarter each, whatever it last used (528 captured fights in recordings 1756 and 3312: 264 melee, 126 ranged, 138 magic). | capture |
| First attack | Its first ranged or magic attack of a fight does a quarter of the damage (Strategies: ~75% less). Captured: against players not praying against it, first attacks hit at most 6 (mean ~3) where later ones hit up to 24; the matching protection prayer still stops it. It is full strength once a 5+ tick attack has hit it while its shield was down (Strategies). | capture, Wiki |
| Styles | It melees when it can reach; if it can't, it switches to magic or ranged and keeps fighting. It changes style after every fire bomb, never to the one it had. | Wiki |
| First attack | 8 ticks after its shield drops. | capture |
| Bind and fire bombs | Every 10th attack (~60 ticks): `luc2_undead_demon_explosion_fire` (11387), `entangle_casting` (177, slot 2, height 240), projectile 178 to the player, `entangle_impact` (179, height 124) on them, "The demon's spell binds you!", sounds 9224 (30), 9210 (3), 9215 (36), 9259 (39), 7099, run turned off (varp 173). Two bombs, projectile 2855 (45-115, angle 30, progress 128, heights 86-0), one at the player's tile and one at a random walkable tile beside it, each tile showing 1446 (delay 30) and 2856 (delay 115). | capture |
| Bomb damage | Bound for 2 ticks, the bombs land 4 ticks on: 40-45 on a player standing on one (Wiki: "40+", 45 the special's max). Run comes back on. | Wiki |
| Two demons | The second never melees, and never attacks within a tick of the first (moved 3 ticks off when it would). | Wiki |
| Three or more | The third and later throw one bomb at the player each attack: 11387, projectile 2855 and the tile graphics, sounds 9221 (33), 9335 (3), 9215 (36). | capture (rec 552) |

## The player's attacks on it

| What | Detail | Source |
| --- | --- | --- |
| Protection prayer | Hits of the style it protects against do nothing. Every 150 damage since its last switch, it protects against the style that last hit it and doesn't attack for 6 ticks. It starts protecting melee and keeps its prayer through death and respawn. Head icons 0/1/2 (melee/ranged/magic). | Wiki, capture |
| Fire shield | Cuts damage by 20%, except demonbane weapons and spells and abyssal weapons. Every attack launched at it plays `luc2_undead_demon_shield_spot` (2849, slot 4). | Wiki, capture |
| Shield drop | The tick after the first attack of a fight (and after every fire bomb): 11387, `luc2_undead_demon_explosion_fire_spot` (2852, slot 4), sounds 9224, 9210 (3), 9215 (36), 9259 (39). | capture |
| Unshielded attack | The next attack hits unshielded, and the one after it restores the shield (`luc2_undead_demon_shield_restore_spot`, 2850, slot 4). For crush melee, crossbows and ballistae and spells (not a powered staff's own) it deals X^2 - 16 more (X its usual speed: 7 +33, 6 +20, 5 +9) and takes 4 ticks, one less per other demon on the player. Against its prayer the bonus still lands, divided by 3. | Wiki, capture |
| Defenceless | 30 ticks after the shield first drops, `luc2_undead_accuracy_debuff` (3013, slot 5) and its flames go out: its one body model (53287 / 53285) becomes 55475 / 55474 (model customisation, slot 0), reset when it ends and on respawn. Every attack lands, until the first one after its next fire bomb, when the 30 ticks start again. | Wiki, capture |

## Spawning and dying

| What | Detail | Source |
| --- | --- | --- |
| Respawn | `luc2_undead_demon_summon` (11395) and `wgs_undead_demon_summon_spotanim` (2847, slot 4); it can't be attacked for 8 ticks. | capture |
| Death | 11394 and `luc2_undead_demon_death_spot` (2848), its overhead cleared, area sounds 9333 (4), 9332 (128), 9336 (136) at its spawn tile, range 7. | capture |
| Drops | `tormented_demon` in `data/definitions/npc-drops.json`, unchanged. | Wiki |
| Kill count | `wgs_tormented_demon_killcount` (varp 4240): one more each kill (captured), saved as `tormented-demons:kills` and sent at login. | capture |

## Combat Achievements

| Task | Rule |
| --- | --- |
| Unending Torment | Kill a Tormented Demon: a plain kill count, counted by Combat Achievements itself. |
| Through Fire and Flames | The demon dies while its shield is down (from its drop until the attack after the unshielded one restores it). |
| Two Times the Torment | Two kills within 2 seconds (3 ticks). |
| Three Times the Thrashing | Three kills within 3 seconds (5 ticks). |
| Rapid Reload | Accurate crossbow or ballista hits on three different demons within 3 seconds (5 ticks). |

## Tormented synapse weapons

`plugins/quests/wgs/Rewards.WhileGuthixSleeps.js`. Levels, the hammer and the XP (730 the first
time, 73 after; the staff also 13 Smithing) are the Wiki's (Tormented synapse). The rest is from
rsprox.net recordings 3315 (ticks 438-1776), 3333 (ticks 11847-12149) and 3314 (tick 486), rev 235.

| Action | Live | Source |
| --- | --- | --- |
| Inspect | A player line (chat_right): before reading Duradel's notes "I'm not sure what to do with this... Maybe I could ask one of the heroes that confronted Lucien for some ideas." (chatquiz3); after, "Duradel's notes mentioned creating a weapon out of demon parts... Maybe I should try it with this." (chatquiz2). | capture |
| On a magic longbow (u) | `stringing_magic_longbow` (6689) at once; 5 ticks later sound 4545 and an objectbox with the Scorching bow: "You string the synapse onto the bow. ..." | capture |
| On an anvil with a battlestaff and an iron bar | `human_smithing` (898) at +0 and +3; at +6 sound 4545 and an objectbox with the Purging staff: "You hammer the metal onto the battlestaff's tip, forming a brazier. ..." | capture |
| On an anvil with an Arclight | The same animation and timing, then the Emberlight objectbox: "The synapse writhes as you hammer it into the sword, ..." | capture |
| On an anvil, battlestaff but no iron bar | Objectbox with an iron bar: "You need an iron bar to do that." | capture |
| On an anvil with neither | Objectbox with the synapse: "You require either a battlestaff and an iron bar or Arclight to make a weapon out of this." | capture |
| On an Arclight | objectbox_double (synapse, Arclight): "You try to attach the synapse to the sword. The blade sizzles for a moment, but the synapse just slides off it again." | capture |
| On a battlestaff | "Nothing interesting happens." (sent by the plugin: item-on-item has no default line) | capture |

Ours: the refusals for unread notes, a missing hammer, low levels and Emberlight's charges, and
the menu when both an Arclight and a battlestaff are carried. Live takes the bow and the staff's
battlestaff and iron bar at the click; ours takes them with the synapse at the result, so a
walk-away keeps them.

## Not done

- A melee demon that can't reach its target switching to range is built but untested.
- The quest's own pair (13601/13602) keeps its simpler fight in `plugins/quests/wgs/Stone.WhileGuthixSleeps.js`.
- The live chasm floor is shared; ours stays the quest's private area, so players there don't see
  each other until the temple.
