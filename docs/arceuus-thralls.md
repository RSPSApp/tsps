# Shared thrall parity correction

Bounded implementation plan (24 October 2026): reproduce inclusive 0–tier-max
damage rolls, applied-damage ownership, the shared ten-second resurrection
cooldown, and duration doubling only after claiming Master Combat Achievements
rewards. Use actual Task ticks, cast/rune checks and hit queues. Keep the current
range, attack interval and flight behavior; no per-boss adjustment. Add the
minimal existing applied-hit observer foundation as an explicit #882 dependency,
then implement the claimed reward through a plugin custom event. Run focused
regressions and a fresh build, request independent review, and commit locally.

Primary source: [Thralls](https://oldschool.runescape.wiki/w/Thralls), retrieved
24 October 2026. It specifies successful rolls including zero, four-tick attacks,
one tick per current Magic level, doubled after claiming Master rewards, and a
ten-second cooldown shared by resurrection spells. Its 25 June 2025 change entry
places the full duration extension at Master rather than Grandmaster.

Implementation: attacks retain the existing four-tick gate and use the shared
inclusive integer roller from zero through the tier maximum (1/2/3). The queued
hit identifies the summoner and credits only health actually removed when the
hit applies. An overkill, cancelled queue or earlier lethal hit cannot award
the original maximum as damage. This uses only the reviewed generic `onApplied`
observer hunks from #882 in `HitDamage`/`HitQueue`, before reactive healing;
integration with a branch already containing that foundation must retain one
copy of the same contract.

The nine resurrection spells keep their shared cooldown key, now ten seconds.
Upstream commit `3bbf1cc8e516c87ce03a9bdbfd771928d57d8f7d` converts the
shared spell clock to whole game cycles (17 whole 600-ms cycles for ten seconds).
The older installed integration retains its existing millisecond clock and an
exact 10,000-ms deadline. This bounded feature does not port that wider clock
refactor. Its cast regression fixes both clocks independently, accepts only
those two exact deadline protocols, and advances only the active clock while
checking rejection at cast time and immediately before expiry, then acceptance
at expiry for every resurrection variant. A 30-second gate or arbitrary deadline
still fails; the inactive clock stays frozen to expose mixed-unit behavior.
Rejected attempts spend neither runes nor Prayer. Duration remains one tick
per current Magic level at summon time, queried through `magic:thrall-duration`.
The existing Combat Achievement reward plugin doubles this only when its saved
claimed-tier set includes Master (5). Completed tasks or points without claiming
do not grant the perk. A later Magic change does not resize an existing summon;
replacement and logout keep the existing owned-task cleanup.
Each attack's max hit is asked through `magic:thrall-max-hit` { player, thrall,
target, maxHit } (Shattered Relics' Thrall Damage fragment raises it).
The hit goes straight to the target's HitQueue, past `onNpcHitModify`, and carries
`HitDamage.getOrigin()` "thrall" (recoil and vengeance carry "recoil" and "vengeance"):
content whose rules live in that hook applies them in `combat:damage-apply`, as Nex
(siphon, floors, immunity) and the Alchemical Hydra (its shield) do.

Four regressions were observed failing before implementation: a zero roll dealt
the tier maximum, launch awarded damage before application, cooldown was 30
seconds, and claimed Master duration did not double. The final focused run uses
actual Task ticks, real Spell cast/rune checks, Combat attribution and HitQueue
application with controlled entity fixtures. Fresh TypeScript build and all 46
thrall/hit-queue/magic/Combat Achievement checks pass. No complete-suite or live
installation claim is made here. Thrall range, flight, attack startup and other
unmeasured behavior are outside this bounded correction.
