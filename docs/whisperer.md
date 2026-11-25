# The Whisperer

The members-only plugin owns the postquest normal encounter after Desert Treasure II. A completed player needs a real Blackstone fragment; the bank placeholder does not qualify. Ketla's generated reclaim conversation grants a lost plain fragment at its handout step. The owner-only private cathedral includes both realms, inherits cache clipping and preserves each approach tile. North/south wakes push three tiles away from the figure; no east/west/diagonal displacement is invented. Public rope/teleporter access uses named hooks independently of quest progress.

## Current behavior

Normal combat has900HP, threshold specials at720/495/270, impact-time prayer checks, increasingly mixed three-projectile volleys, static four-tile tentacle rays, mirrored melee hits, binding pursuit, sanity/prayer changes and140HP enrage. Each shot animates its alternating hand and uses fixed cycles30/90 with raw heights350/100. Launched shots survive a later melee recovery or phase transition; final death, departure and stop cancel all remaining encounter damage. Tentacles show spawn/attack/path/hit/removal at+0/+1/+2/+3/+4, with one hit per wave across realm transfers.

Specials retain teleport preparation and actor materialization at+6 seeds/+5 columns/+4 souls. Seeds use all four24/28-tile patterns and40ticks after materialization. Screech uses eight20/40/60HP columns, native40-pixel headbar2 and blasts at+17/+23/+29. Water-wave graphics, delayed column projectile/HP impacts and removal remain separate phases. Souls use twelve one-HP actors in2/3/3/4 sets, vulnerable in shadow, with per-set rewards. Completing a special emits depletion/result messages. Fragment switching begins with materialization; screech closes switching at+14.

Binding uses the melee transformation, cast sequence10254 and cast/impact graphics177/2466. Captured Chebyshev distances3/4/5-or-more select200/180/170cycles; the corresponding impact occurs at+7/+6/+6. A real freeze counter cancels the impact and releases the player. After the third special, below100HP cancels pursuit and restores autos two ticks later while preserving the launched bind's original deadline. Crossing the next special threshold replaces the post-special bind. No optional-bind skip probability is invented.

Every owned boss, figure, tentacle, column and soul has `combat:no-regen` before area ownership through removal. Final death freezes kill time, restores sanity and grades actual avoidable damage; protected melee chip preserves perfection. Death/exit/logout removes actors and resets realm/HUD state. Counts, PBs, first-five-kill grave discounts, native personal/world statistics and normal combat achievements persist. Slayer assignments exclude speed awards. Awakened entry and achievements remain unavailable.

## Primary sources and capture boundaries

The current [Whisperer](https://oldschool.runescape.wiki/w/The_Whisperer), [strategies](https://oldschool.runescape.wiki/w/The_Whisperer/Strategies), [Floating Column](https://oldschool.runescape.wiki/w/Floating_Column), [Blackstone fragment](https://oldschool.runescape.wiki/w/Blackstone_fragment) and [Tentacular](https://oldschool.runescape.wiki/w/Tentacular) pages supply normal mechanics and restrictions. Cache241 establishes IDs: plain fragment28357, active28356, placeholder28358; NPC12203–12212; sanity interface834; varbits15064/15162/15067. The fragment and transport corrections from the later base review are retained.

The original source audits decoded [1703](https://rsprox.net/download/1703) (revision226, ordinary-world quest) and [3281](https://rsprox.net/download/3281), [3285](https://rsprox.net/download/3285), [3299](https://rsprox.net/download/3299) (revision234, Grid Master) using [official source d997d071](https://github.com/blurite/rsprox/tree/d997d071bc2783664d1658a80f4d1f881b355119), runtime1.0.5. No ordinary-world postquest packet recording was found. Quest and event recordings corroborate presentation; they do not establish ordinary damage, healing, prayer, attack rates or RNG.

Normal variants in the event recordings are independently classified by level791, three-shot volleys, three screeches and twelve souls. Later level1146 actors are awakened and excluded. Capture3285 SHA256 is `8cfd915cc9172769c3b871b17640f5b6141468f8e3796abf75d3ff461dace3da`;3281 is `f5c74b17e6d3b96380b11f76eb8cbd07c444f4aeec951f25e60ba7093a111b92`;3299 is `2cdae59cc4d39fe356137483853b3d66021f675854ee801c7f3d4c9434b478b8`. Raw account-bearing logs are not committed.

| Behavior | Retained evidence |
| --- | --- |
| Fragment/feedback |1703 updates15925/15957 show active28356/plain28357. It establishes pulse/depletion, special/result, bind and enrage wording. Later captures establish current pink/purple/red/green colors |
| Wake |1703 pickup827 at15841, flyback9799/spawn10227/sound3201 at15842, transform at15846. Normal event actors corroborate north three-tile displacement and transform+4 |
| Volleys |1703 ranged2444 at15850/51/52 and magic2445 at15860/61/62 alternate10237/38 and10243/44. Old byte heights87/25 cannot distinguish raw348 from350; later234 packets establish350/100, angle254, progress128 and a tile source |
| Tentacles |3285 example20914 spawn,20915 attack,20916 path graphics2447–2450 with5/10/15/20cycle delays,20917 hit,20918 removal |
| Screech |3285 normal actor47055 teleports20971, appears20972, charges20974, materializes columns20976 and blasts20988/20994/21000. All21 normal water waves corroborate the footprint and protected column rectangles |
| Binding |3285 casts21405/21484/21929/22106/22149/22553/22603/22776/23058 show form12205, sequence10254, launch80, heights580/0, angle16, progress150. Across22 classified casts, distances3/4/5+ match200/180/170cycle arrivals |
| Enrage |Normal event sequences separate HP restoration, appearance+4, realm transfer+5 and first shot+7, retaining shots already launched |

Ordinary footage supplies independent normal-world bounds:

- [Noob Friendly2024 guide](https://www.youtube.com/watch?v=Xc3_IIKmEKI), SHA256 `4c2d11881d5addc43c6f8d75b3d7a2524f3ed89a9209122b9471a597432182f1`: a stationary675HP special exit omits a visible bind. This does not establish its optional selection rule.
- [Ordinary thralls kills](https://www.youtube.com/watch?v=_tSCuWmbjos), SHA256 `468d2346a27ec0030b9f85c533cfda1b63211db48286838d84230b7d9f818840`: bind graphics and uncountered movement constrain natural freeze below the former12ticks. Eight remains a provisional choice; attacks/camera prevent an exact expiry measurement.
- [Max-mage footage](https://www.youtube.com/watch?v=JUi2ZBkEih0), first600s SHA256 `fb84b719ab92302ade2bd25e70210897e1057bbfe29ddaa91f941ce902783ac2`: approach preservation, south-side wake displacement and clean column bars. The roughly three-tile distance is a calibrated visual inference, not a packet measurement.
- [Wiki screech clip](https://oldschool.runescape.wiki/images/The_Whisperer_-_screech_dodging.mp4), SHA256 `bc6791a81881aafcd5d85d4fd5d13fd11113c4e378543b13036a927ee9645407`: waves precede column hits by about two ticks and columns disappear afterward. Approximate frame times are not exact tick timestamps.
- [2026 ordinary guide](https://www.youtube.com/watch?v=RfZ8Sp28EEA), SHA256 `ccb12c27e2dce0c24f2054329888b5be4428dfea6c7cfe3054c567a276e8411d`: walk-up mirrored melee corroboration; edited segments do not establish optional-bind RNG or below100HP timings.

## Remaining source limits

This is functional normal content, not complete1:1 parity. The28–42 melee distribution, floored two-thirds protected share, zero-sanity damage ramp, column-health distribution beyond published guarantees, bind selection, exact freeze expiry and distances below3 remain provisional. General east/west/diagonal wake behavior is unmeasured. Wiki30tick respawn remains despite shorter historical/event observations. Soul-result branches beyond no/some/all completed sets remain unverified. Awakened mechanics are not offered.

## Integration and validation

The branch retains PR893 `a92357d8add71092ec5618f710e1f5b6744cca1c` and PR896 `ca5a794d7fda0bcf39491d1e32b6cc94566708ad`. Named transport/fragment hooks, generated Ketla dialogue integration, messages, visited varbit and colored duration/PB output coexist with the later phase/achievement/record work. Only unnamed scoreboard parents need a guarded generic fallback. Source-generated JSON is unchanged from main.

Tests use real cache definitions, players, NPC processing, inventories, private areas and hit queues. Added integration regressions preserve launched volleys during melee recovery and cancel them on stop; existing real-NPC clocks verify boss/column/soul HP. The own-worktree MCP smoke verified north6371→6374 wake,900HP boss, a threshold screech with all eight columns, and exit reset of realm/HUD with no visible encounter actors. Client animation feel was not visually retested. Final build/suite totals are in the integration PR.


### Whole-footprint diagonal pursuit regression (24 October 2026)

The local release d583823ab still restricted diagonal movement to size-one actors,
while upstream065d29b68 already permits all sizes when their entire footprint can
travel. This is an observable normal Whisperer movement gap, separate from choosing
an unmeasured binding duration. Two real MovementQueue regressions now cover it.

Original [RSProx recording3285](https://rsprox.net/download/3285) has normal actor12205
walk from2655,6360 at23066 to2654,6361 at23067 and2653,6362 at23068. The player remains
at2649,6369. The recording belongs to an altered world; these NPC coordinates establish
geometry only, not an ordinary freeze timer, damage roll or probability. Capture
SHA2568cfd915cc9172769c3b871b17640f5b6141468f8e3796abf75d3ff461dace3da;
filtered derived stream SHA256fb8225e522011e3311443d6a80e86581ea74d81300eaf2343f19549733110864.
No player names, chat, saves or raw video are included in the regression.

The first test asserts the NPC's size remains3 through transformation and follows
both recorded steps using actual cache clipping. A second overlays an obstruction
at2654,6363 in its private area: this blocks the diagonal's outer3x3 corner while
leaving the cardinal west fallback open. It must square that corner, not pass
through it. The old size-one guard was temporarily restored and rebuilt: the first
regression failed at2654,6360 instead of2654,6361; restoring upstream and rebuilding
passes both. The upstream change is regression-only; the local integration selects
just the already-merged generic guard correction and excludes unrelated movement,
raid, client and generated-data changes.

This audit also reacquired two original ordinary videos: ManaCharge's [full kill](https://www.youtube.com/watch?v=gqwJCArI818)
(uploaded15August2023) explicitly uses freeze counters; ImperatorBTW's [three tips](https://www.youtube.com/watch?v=5_WV8Wbhv4s)
(uploaded6August2023) is an edited guide. Neither establishes a controlled natural
expiry. Extile's previously incomplete [guide](https://www.youtube.com/watch?v=KsA9ENMEQII)
is now recovered completely; its normal wake is consistent with known N/S faces,
but its countered/edited binding sequence does not resolve8versus9ticks. The earlier
incomplete-download note is historical, not the current source availability.

A ten-tile centre-distance probe was rejected as an oracle: the Wiki does not define
that distance convention for every direction and illustrates specific N/S lanes.
Review also caught stale compiled movement code after switching branches, so all
subsequent guard comparisons rebuild first. No binding/pursuit constant is changed
from those exploratory failures. Wake directions, optional-bind selection, natural
expiry, melee distribution/recovery and other listed numerical gaps remain open.

### Bind pursuit movement-pass alignment (24 October 2026)

The intended five-tick first step was one tick late in the encounter. World processes
NPC mechanics before player mechanics; the cathedral advances the fight from the
owner's player-area pass. Queueing a route on cast+5 therefore cannot move the NPC
until cast+6. The route is now prepared on+4 so the registered NPC first steps on+5.
The authored pursuitTicks5 is retained, and an already-adjacent target is still not
meleed before+5. No freeze, phase deadline, flight, damage or selection value changes.

This audit selects actual binding projectiles2467, then checks each actor's current
combat-level update. Across original [3281](https://rsprox.net/download/3281),
[3285](https://rsprox.net/download/3285) and[3299](https://rsprox.net/download/3299),
there are22normal791casts. Seventeen have a subsequent recorded walk, all first on
+5; five have no walk in the inspected14-tick window. The apparent+3cases instead
belong to fiveAwakened1146casts and are excluded. Animation masks can be replayed
when the player changes realm, so they are not treated as independent cast packets.
These are altered-world normal actors; the result supports this already-intended
first-step schedule, not all ordinary movement/counter timing or RNG.

Examples:3281cast2710 firstwalk2715;3285cast21929 firstwalk21934;3285cast22106
firstwalk22111;3299cast15300 firstwalk15305. The17movingcast ticks are
3281:2710/2844/2897/3057/3811/4482/5577/5812;
3285:21405/21484/21929/22106/22553/22603/22776/23058;
3299:15300. Excluded1146examples include3285:23306/23403 and3299:15652/15801/15943.
No sample-derived optional-bind probability is introduced.

Regressions run real NPC queues before player timers and fight processing, matching
World order. The first-step test failed on the old implementation (still stationary
at+5), then passed after correction. Adjacent melee remains+5. A real
CombatFactory.freezeTicks counter after route preparation cancels the queue, keeps
the NPC stationary and suppresses the in-flight player bind. Existing impact/phase
assertions remain; the old mock-route test now distinguishes queue preparation+4
from actual movement+5. Natural player expiry8versus9, optional binding selection,
post-melee recovery and the remaining ordinary numerical gaps remain unresolved.

## Paired melee retaliation, 24 October 2026

The current [Whisperer Speed-Runner strategy](https://oldschool.runescape.wiki/w/Whisperer_Speed-Runner)
explicitly recommends double Vengeance on the two equal melee hits. The prior
raw HitDamage path bypassed Vengeance and recoil entirely: real-player regressions
left Vengeance active and the boss at 900 HP despite damage to the player.

Both physical strikes now use the normal PendingHit/CombatFactory queue. Their
single original damage roll, partial-prayer snapshot and one-tick separation are
retained. A generic optional `PendingHitConfig.bypassProtectionPrayer` flag
(default false) prevents ordinary full prayer blocking from being reapplied to
the already mitigated amount. Armour effects occur once per impact; an actual
Elysian regression rejected a dummy zero-hit workaround that produced two effects.
The explicit flag also reaches multi-hit and first-success special roll paths;
callers that omit it retain existing behavior.

Real recoil and Vengeance regressions cover both strikes, rearmed Vengeance
between them, protected chip and ordinary hazard controls. Player HP and its
perfect-kill callback resolve before reflected damage reaches the next NPC pass.
A lethal reflected hit freezes the already-imperfect result and cancels the
second strike. Finish/departure zero both the pending parts and their cached
PendingHit total; otherwise a cancelled zero hit could still consume retaliation.
Applied hits release their tracked references.

Test fixtures now use the actual World clock when processing scheduled hits and
complete the binding test's setup teleport before accepting combat. Fresh build
and 85 Whisperer plus 7 HitQueue checks pass (92/92). Independent code review
found no important issue and independently repeated those 92 checks. Full-suite,
native staging and local integration results are reported with the PR.

This fixes the published retaliation behavior, not the unresolved melee damage
distribution, rounding, recovery, freeze duration or optional-bind RNG. No client,
Claude content or generated data is changed.

## Capture parity pass (24 November 2026)

A packet-by-packet comparison of [3281](https://rsprox.net/download/3281),
[3285](https://rsprox.net/download/3285), [3299](https://rsprox.net/download/3299) and
[1703](https://rsprox.net/download/1703) against this plugin found presentation and timing gaps.
[1754](https://rsprox.net/download/1754), [1827](https://rsprox.net/download/1827) and
[3168](https://rsprox.net/download/3168) have no fight: 1754 is the Siren's staff examine (already
present), 1827/3168 are the Ancient Vault statues after the quest. Ticks below count from the
teleport sequence 10247; recorded examples are from 3281 unless named.

| Change | Evidence |
| --- | --- |
| Special announcements are sent with the appearance (+1), not with the pulse | seeds 2628/2629/2634, screech 2671/2672/2676, souls 2912/2913/2915 |
| Souls pulse at +3 with 10257 and twelve 668 projectiles; the souls appear a tick later with 9047 | 2915/2916 |
| The chant result follows the depletion by three ticks, with a type-116 `Strange Whisper| <unfinished sets>.` in Sanitas, Mors, Vita, Oratio order | 2933/2936; 3285 failed chants list all four |
| Shadow souls chant every three ticks with 5545; at timeout they clear the text, fade (5542), fly into the boss and leave three ticks later. The projectile is 2458 in the Shadow Realm and 2457 in the normal realm | 2922/2925/2928/2931, 2933, 2936; 2457 at 3281 3803/4518/5456/5613, 3285 21476/21921, 3299 15330 |
| Screech's depletion message is sent at +14 when switching closes | 2685 |
| The boss shows headbar 35 (80 wide) counting down each special: seeds 40 ticks, screech 11, souls 17 from the soul spawn | 2635-2668, 2677-2687, 2917-2933 |
| Seeds: 2459 on each seed when it appears, 2463 and sound 7263 per stomp, boss 10252 at the end. Then dark seeds still standing vanish; light seeds still standing at the timeout hatch, and so does the last light seed when its stomp ends the special (no stomp burst). Each hatch sends leech projectile 2456 into the player. Shadow Realm: vanish 2461, hatch 2462, sound 7311. Normal realm: 2464, 2465, 7480 | 2634, 2642-2664, 2668; 3285 20965 (11 vanish, 9 hatch), 21848, 23397 |
| After seeds the player stays in the Shadow Realm 2 more ticks, after a souls timeout 7, so the end effects play there | 2668 -> 2670, 2933 -> 2940 |
| Columns rise with 10226 and graphic 2450 on each footprint tile. Shadow columns show HP in their model (49311/49308/49309 for 60/40/20); normal columns keep one of 49310/49312/49313 | 2676/2681, all eight 3281 screeches |
| Shadow Realm models: boss slot 0 49220, tentacles 49250/49247/49253 | 2639, 2739 |
| The nine entrance tentacles at 2652-2660, 6384: 47584 from the wake, 47585 in the Shadow Realm, 47586 on the kill | 2611, 2734, 2761 |
| Server SynthSounds with their recorded delays: ranged/magic impact 7316/7343, tentacle spawn 7301 and attack 7369/7367/7319/7364 (+ area 7321 per path), melee 7359/7444, screech charge 7365/7308/7275 and blast 7437/7325/7293/7415/7459, bind 151 and 7461 | 3281: 53 ranged and 34 magic impacts, 41 tentacle waves, 24 blasts |
| Enrage shows a 140 heal hitsplat (type 6) | 2729 |
| The Odd Figure plays 10228 when it returns. The respawn stays at the Wiki's 30 ticks; recordings show 15 (noted, not applied) | 3281 2761->2776, 2971->2986, 3170->3185, 3851->3866; 3299 15366->15381 |
| Statues past the vault say "The statue is holding a medallion" once given theirs | 1827 tick 495, 3168 ticks 10602/10870/10949 |

Not changed: loc 32545 placed on destroyed column tiles, the exit delay after a full souls
disturb in the Shadow Realm (no recording; it exits at once), headbar fills within one of the recorded value, the Awakened-only
"takes advantage of the souls you left behind" line (3285, 23359), and the open numerical
questions above.
