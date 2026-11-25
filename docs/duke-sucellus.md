# Postquest Duke Sucellus

The members-only plugin implements the repeatable normal encounter after Desert Treasure II. Completed players can skip Ghorrock Prison through the heavy door and enter an owner-only asylum. Leaving, disconnecting or dying clears temporary supplies; login recovery returns abandoned instance characters outside the gate. Awakened entry is unavailable and cannot consume an orb.

## Current behavior

Vats accept partial ingredients and hand-crush raw mushrooms one-for-one. A complete six-of-each recipe ferments for six ticks. Check uses the captured ingredient messagebox; Empty refunds the stored amounts atomically. A full inventory preserves the vat and its contents. Picking and grinding repeat until interrupted; mining uses the selected pickaxe interval and stops after five minutes. The iron pickaxe yields first after seven server processing steps and repeats every seven ticks. Tick manipulation and unmeasured pickaxe tiers are not claimed exact.

The June/July 2025 preparation changes remain: eight mushroom picks, resources retained between kills, level-dependent powder yields, five-point powder feeding once per tick, two normal poison doses (splats of 125, then the remaining 75) and 10 Herblore XP per poison. Feeding displays a separate green preparation meter and hitsplats, and the boss health HUD shows that meter from Duke's spawn; it cannot queue combat damage against the awakened boss. The final feed sends "Duke is waking up." and wakes him on the next tick. Resource objects become inactive during combat.

Normal combat uses 485 HP, five-tick attacks and four-tick enrage attacks at 121 HP. Melee shows the seven-tile row at launch, applies chip on that cycle and checks the aimed slam two ticks later. Magic launches from the mouth with cycles50/120, raw height350 to100, and applies damage four ticks later. Its slot2 impact is sent at cast time with delay120. Gaze checks cover four ticks after it starts and its overlay (829) closes six ticks after it opens; a failure shows spotanim369, then freezes the player with "You have been frozen!" and applies its damage a tick later. The extremities animate in place during preparation; at wake they become their awake locs (id+3), at death they close (10190) and become their dead locs (id+6), and on respawn Duke plays 10182 and they return to their sleeping locs. Freeze feedback retains its captured slots, graphics and message.

Preparation and combat gas use private vent NPCs. Preparation eyes, cones, icefalls and gas retain the later timing/geometry corrections. Every owned boss, timer, vent and cone has `combat:no-regen` before being added to the instance, through removal. Wake, death, exit and respawn clear the appropriate scheduled effects and actors.

Kill time runs from waking to the kill count message (the 25 June 2025 timer) and is shown as `Fight duration: <col=ff0000>m:ss.cc</col>` with the personal best; the kill also plays spotanim85 on the loot tile and switches the music to Prison Break until the respawn. Counts, personal/world records and novice grave discounts persist. The drop roller receives the exact dead boss's perfect-kill context. Cold Feet tracks actual running, including preparation, and resets at lethal damage for the next attempt. Mirror Image compares actual player and Duke attack-launch cycles. Five-perfect-kill and speed achievements remain; any observed Slayer assignment excludes speed awards. The native scoreboard requires quest completion.

## Source evidence and version boundaries

The current [strategies page](https://oldschool.runescape.wiki/w/Duke_Sucellus/Strategies), [Arder-musca poison](https://oldschool.runescape.wiki/w/Arder-musca_poison), [Musca powder](https://oldschool.runescape.wiki/w/Musca_powder), [Arder powder](https://oldschool.runescape.wiki/w/Arder_powder), [Salax salt](https://oldschool.runescape.wiki/w/Salax_salt) and [June2025 combat update](https://oldschool.runescape.wiki/w/Update%3ASummer_Sweep_Up%3A_Combat) supply current normal mechanics. [Cold Feet](https://oldschool.runescape.wiki/w/Cold_Feet) and [Mirror Image](https://oldschool.runescape.wiki/w/Mirror_Image) supply their restrictions. IDs and object footprints are checked against cache241.

The original source audits decoded [RSProx1703](https://rsprox.net/download/1703), revision226.1, with [official decoder source d997d071](https://github.com/blurite/rsprox/tree/d997d071bc2783664d1658a80f4d1f881b355119). It is an ordinary-world **quest** fight using NPC12193/12194/12195, not current postquest normal mode. The latest base audit records download SHA256 `1480633019627ff48c26e1327c4cca4b3479ac8f8c132df52158a3506ad82d7a`, 351274 framed packets and18184 ticks. Seventeen optional-model NPC packets were excluded from claims. Raw account-bearing logs are not committed.

| Behavior | Zero-based1703 server ticks |
| --- | --- |
| Picking |10504/10507/10510: sequence2282, sound2581, messages and three-tick repetition |
| Grinding |10647/10649/10652: sequence364 and sound2608 |
| Partial fill/refund |10709 consumes three raw arder mushrooms;10728 refunds three powder plus six musca powder/salt;10756 shows6/3/6 progress |
| Fermentation |10866→10872 and10872→10878 |
| Collection |10889/10894: sequence3572, sound2434 and collection message |
| Feeding |10931/10933: sequence9401 and sound7249; wake message10935. The observed125/75 hits are quest values, not normal poison quantities |
| Melee |10940/10945:10176, boss effect2439 and row2440/2441/2442/2443/2442/2441/2440.10991→10993 confirms two-tick slam |
| Magic |10950→10954: projectile2434, cycles50/120, byte heights87/25, delayed slot2 impact2435 |
| Gaze |10965 warning and10969 avoidance retain purple/green text. Failed-gaze feedback is supported by the later review samples |
| Eyes |10187–10189 stagger by two ticks and reset after five; wake10935, awake idle10936 |
| Freeze |10479/10490: colored message,1575 in slot4 at height124;369 in slot2 in the latter sample |

The later audit decoded [1751](https://rsprox.net/download/1751), [1827](https://rsprox.net/download/1827) and [3285](https://rsprox.net/download/3285) with the same official source and launcher1.0.5. These are Leagues V/Grid Master worlds. Duke level758 identifies normal variants in the former;3285's level1099 and370-point meter identify awakened Duke and are excluded from normal mechanics. Event worlds corroborate presentation, not normal damage, XP, yields or player attack rates. No ordinary-world postquest packet recording was found.

Retained normal-variant presentation includes independent eye clocks (middle/south/north, two-tick stagger), three-vent preparation groups every25ticks, two combat spits three ticks apart, native poison/vat headbars and a23tick lethal-to-respawn boundary. Combat vent holders spawn two ticks after the spit, warn for one tick, then damage from holder+2 until their empirical12–14tick lifetime ends. This supersedes the older quest-holder visual schedule; it does not establish exact current normal damage or lifetime RNG.

Ordinary footage and primary descriptions constrain the remaining geometry and gathering behavior:

- [Salt tick-manipulation clip](https://oldschool.runescape.wiki/images/Duke_Sucellus_-_tick_manip_%28salt%29.mp4?2237c), SHA256 `df88a1965f84f0d1ff052a699a7f4194938ea0cb5e0c9cbe3e10173024b1377f`, and [mushroom clip](https://oldschool.runescape.wiki/images/Duke_Sucellus_-_tick_manip_%28mushroom%29.mp4?dda52), SHA256 `87efba562a0cf63f2e49013681e9e0660fae88e1298c8fe6e0185b381d147a82`: manipulated gathering does not establish every ordinary pickaxe interval.
- [Extremity](https://oldschool.runescape.wiki/w/Extremity), the [quest walkthrough](https://oldschool.runescape.wiki/w/Desert_Treasure_II_-_The_Fallen_Empire?oldid=15374592#Duking_it_Out) and [running-past clip](https://oldschool.runescape.wiki/images/Duke_Sucellus_-_running_past_extremities.mp4?c9b16): the rotated3×2 wall object leaves cone rows1/3/5, with safe mushroom tiles.
- Ordinary [Extile](https://www.youtube.com/watch?v=1QjdtcregEQ), [Theoatrix](https://www.youtube.com/watch?v=M0GroGCHNlI), [TheEdB0ys](https://www.youtube.com/watch?v=HozIDuwMShw) and [10Boot](https://www.youtube.com/watch?v=O1V5U4E20pY) footage supplied the original follow-up's gathering, coverage and timing bounds; narration is not an exact server-tick measurement.

Still provisional: normal poison amount per dose, protected magic24/covered gas4 maxima, exact icefall RNG, combat gas lifetime distribution, extremity check timing and unmeasured gathering tiers/tick manipulation. A seven-tile visual does not establish a seven-tile damaging slam. Quest/event damage samples do not replace current normal maxima. Awakened hazards and achievements remain unavailable.

## Validation

The integration retains the ancestry of PR891 `16a1b9e6108d04d5912f69eaba1eee650ffa30ac` and PR895 `18c98d340476b762aa41dd381e7301624d60c5a1`. Named asylum hooks and the exact guarded unnamed Ghorrock fallback remain. Source-generated JSON is unchanged from main; the conditional-drop dependency is already merged.

Tests use actual cache definitions, inventories, templated areas, NPC processing/death tasks and hit queues. They cover the later mechanics alongside partial vat refunds, messageboxes, cast-time impacts, gaze/freeze feedback, real idle regeneration and auxiliary cleanup. The own-worktree MCP smoke entered the asylum, fed two poisons, observed485HP wake, retained a lowered300HP boss, and verified exit cleanup. Client animation feel and current ordinary-world packet parity were not visually retested. Final build/suite totals are in the integration PR.

## One strike calculation and terminal cancellation, 24 October 2026

The former strike helper constructed a dummy zero PendingHit, then rolled the
actual damage through applyStyleDamage. Real Elysian tests reproduced two effect
invocations for one melee or magic strike. The [primary shield description](https://oldschool.runescape.wiki/w/Elysian_spirit_shield)
ties its effect to the damage calculation and places recoil after its reduction.

Each strike now constructs one actual pre-rolled PendingHit, preserving the
existing inclusive range, accuracy settings, selected protected range, HP cap
and queue reveal cycle. The optional protection-bypass flag reviewed in
[PR #996](https://github.com/RSPSApp/tsps/pull/996) prevents ordinary full prayer
blocking from being reapplied to Duke's already chosen protected range. The
source branch includes that exact generic prerequisite separately so it remains
buildable while #996 is open; it includes no Whisperer feature changes.

Pending strikes are tracked alongside their parts. Terminal cancellation zeroes
both the parts and cached totals used by retaliation, and applied hits release
their references. Before correction, real Vengeance was consumed despite zero
HP loss after stop/fell. A late strike invoked after stop could also deal damage;
the helper now rejects inactive terminal/ended/replaced encounters and dead
players. Ordinary hazard damage retains its separate path.

Seven new regressions cover actual Elysian effects for both styles, cancellation
of recoil/Vengeance, a late stopped strike, protected magic with post-shield
retaliation, and non-reflecting hazard controls. Fresh prerequisite build and all
106 Duke plus 7 HitQueue checks pass (113/113); independent review repeated them
and found no important issue. Full/native/integration verification is recorded
in the PR. This does not establish new damage bounds, RNG draw order, vent/ice
selection or combat timing constants.

## Capture parity pass, 24 November 2026

A second sweep compared the plugin with the postquest normal kills in [91](https://rsprox.net/download/91), 1751 and 1827 (rev227, Leagues V), the awakened kills in [555](https://rsprox.net/download/555) and 3285 (presentation only), and 1703. Captures 100, 1754, 1767 and 3168 contain no fight.

| Change | Evidence |
| --- | --- |
| Poison dose 125 (125 then 75 to fill 200) | every normal wake in 91/1751/1827; awakened 125/125/120 is the same in 555 (Dec 2024) and 3285 (Oct 2025) |
| Gaze outcome at +4, failure freeze and damage at +5, overlay closed at +6 | 91, 555, 1703, 1751 (twice), 3285; overlay at 1751 7962→7968, 9803→9809, 10024→10030, 10103→10109, 91 10998→11004, 555 14828→14834, 3285 20227→20233; failed normal gazes at 1751 ticks 9807/9808 and 11055/11056 |
| Kill timer from wake to the kill count message, precise format | 3285: wake 20197, message 20267, `0:42`; the speed tasks' 25 June 2025 change |
| Awake/dead extremity locs, 10190, 10182 respawn 23 ticks after the lethal hit | 1751 ticks 4152-4198, 91 ticks 11010/11033, 3285 ticks 20197-20265 |
| HUD from spawn, spotanim85 on the loot tile, Prison Break (759) at the kill and Eye See You (763) at respawn | varps 1682/1683 and music in 91; spotanim85 in 91/1827/3285 |
| Sounds 7215/168 gaze, 7197 magic (delay120), 5002 gas spit, 2727 eye freeze, 7200/171 icefall freeze, 3600 salt; area sounds 2707 slam (radius10, on the boss row at 3039,6452, a row north of the slam spotanims), 2041/3052 vent spawn and idle (radius3), 7170 icefall (radius2) | co-occurrence with the matching boss sequences, spotanims and messages in 91/1751/1703 |
| Message colours `ff289d`/`a53fff`/`229628`/`ff3045` | every rev227+ capture; 1703's darker set is not used |
| Texts: mushroom inventory full, empty vat "Mushroom one/two", rev234 "No ingredients you're holding can fit into the vat." | 1751, 555, 3285 |

Not changed: Duke's own hit sound (area sound 7181, radius9) is not sent, since the engine's NPC combat sounds come from generated data. The failed-gaze freeze length is unmeasured; the recordings only show move clicks refused for at least three ticks, so it reuses the extremities' five ticks. Sounds 2663, 2685 and 2739 have no consistent trigger in the recordings and are left out.
