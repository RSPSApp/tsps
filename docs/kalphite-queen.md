# Kalphite Queen standard attacks

The [Kalphite Queen strategy guide](https://oldschool.runescape.wiki/w/Kalphite_Queen/Strategies)
states that a ranged attack drains one Prayer point when its damage roll is positive,
even if Protect from Missiles prevents the damage. A zero roll does not drain Prayer.
The [boss article](https://oldschool.runescape.wiki/w/Kalphite_Queen) also identifies the
Spectral spirit shield as a modifier of this drain. These pages were checked on
28 October 2026. No indexed rsprox player actions were available for this boss; this
correction relies on the Wiki, not on a recording.

The strategy guide also gives the standard attack mix: at melee distance, 50% melee,
25% ranged and 25% magic; further away, 50% ranged and 50% magic. The combat provider
constructs a fresh method on every lookup. Previously its constructor selected Magic
and `finished` selected a next style that was discarded. Consequently ordinary attacks
kept reverting to Magic. Style selection now happens in `start` for the attack being
launched, so all documented branches are reachable.

Previously the boss checked final damage at impact. That prevented any Prayer drain
through Protect from Missiles and prevented the shield modifier from being reached.
Both crawling and airborne forms used that handler, including nearby secondary targets.

The encounter now retains whether each ranged damage roll was positive before the
normal protection and damage reductions. The hit still uses the ordinary damage path.
At impact, a positive original roll spends one Prayer point through the existing drain
modifier, which preserves the Spectral shield's pass/save behavior. Each victim has its
own roll; changing the boss's attack style while a projectile travels does not change
that projectile's drain. Zero rolls, melee attacks and magic attacks do not trigger it.

The plugin delegates to `kalphitequeen/Encounter.KalphiteQueen.js` and accesses engine
classes through the core API. The reusable timed object replacement task is exposed
there for the existing rope attachment. Named rope and tunnel callbacks retain their
existing destinations and yield unrelated objects.

## Regression coverage

`server/tests/kalphite-queen.test.cjs` drives the registered combat method with real
pending hits, NPCs, players, protection prayers and the existing Spectral modifier.
Four of the original eleven cases failed against the old implementation: both forms
with Protect from Missiles, a protected drain passed by Spectral, and a projectile
whose attacker changed style before impact. All eleven passed after the fix.
Additional checks cover independent secondary-target rolls, rope-hook fallthrough and
all six distance/random-roll branches across newly constructed combat methods. Four
launch-style cases failed before moving selection to launch. The final focused boss,
spirit shield and Prayer-drain suites pass 29 tests. The server TypeScript build passes.

In an isolated headless encounter, Protect from Missiles was active and the corrected
standard attacks produced an extra Prayer drain: Prayer fell from 96 to 94 between
consecutive ticks, including natural prayer consumption. Health assistance was explicitly
enabled; this verifies the resulting Prayer state, not unassisted damage balance.
The boss was engaged through normal combat; positioning and skill setup were assisted.

The scope is standard attack selection and ranged Prayer drain, not a complete boss
parity audit. A full kill and phase-transition check was not completed: separate retreat
and regeneration behavior interrupted that attempt. This is a movement-mechanic lead,
not part of the standard attack correction. Exact projectile flight differences between magic and ranged attacks need capture evidence before changing
the existing timing. No changes are made to generated definitions or drops.

## The Queen's tunnel (#4292)

The map places the tunnel down to the Queen as `kalphite_chamber_entrance_update` (23609) at
(3509, 9497, 2). It is a multiloc on varbit `kalphite_chamber_entrance` (11705): 0 shows
`kalphite_chamber_entrance_norope` (19053, Look-inside), 1 shows `_withrope_normal` (40421) and
2 shows `_withrope_private` (40422). A rope used on it reaches the server as 23609. The handler
matched only 19053, so the rope did nothing and the Queen's level couldn't be reached. Both ids
are matched now.

From the rsprox captures (rev 227 and 234, recordings 95, 96, 545, 1757, 1864, 3276):
- **Rope on the tunnel:** one rope is used up and the loc changes to
  `kalphite_chamber_entrance_withrope` (10230; Climb-down through its multiloc). The player doesn't
  move: that comes in 57 of 58 attempts, with no teleport. Previously the rope took the player
  straight down. Now it only ties the rope on, for `ROPE_LIFETIME_TICKS`.
- **Climb-down** on 10230 lands on (3508, 9493, 0) on the click tick, with no animation. This was
  (3508, 9494, 0).
- **Climb-up** on the Queen's rope (`kalphite_chamber_exit`, 3832) lands on (3508, 9497, 2). This
  was (3508, 9494, 2).
- **The surface rope** (`kalphite_burrow_entrance`, 3827) still takes the player down to
  (3483, 9510, 2), as captured.
- **Multi-combat:** the upper level had no multi-combat boundary, only the Queen's plane 0. The
  captures show the multi icon coming on when the player climbs down from the surface (95, 545,
  1510, 1511, 1757, 1864, 2952, 4001). `world.json` now has the same box on plane 2. Its walkable
  tiles (x 3460-3517, y 9475-9530) are inside it.

**The Hard Desert Diary's ropes** (Wiki, Kalphite Lair: after the diary "both ropes need to be
placed the first time", then none are needed): with the diary, a rope on either tunnel is tied on
for good and for that player only. The surface tunnel (`kalphite_burrow_entrance`, 3827) is a
multiloc on varbit `kalphite_rope_1` and the Queen's (23609) on `kalphite_chamber_entrance`, so the
plugin sets those varbits (and `kalphite_rope_2` with the Queen's, as diary accounts carry it) from
the persisted `kalphite-queen:surface-rope-placed` / `kalphite-queen:chamber-rope-placed` and sends
them again at login. Diary accounts log in with all three at 1 (rsprox 224/1510, 225/910132,
227/910176); no recording shows them being set, so the first placement is the Wiki's. Climb-down on
the map's own locs then works for that player. Without the diary a rope is still the shared, timed
loc swap the captures show (rsprox 227/95: `loc_add_change` to 3828 and 10230 after each rope).

Not covered: the private Queen instance (40422, varbit `kalphite_chamber_entrance_rope`).

Look-inside on the tunnel, with or without the rope, counts the players in the Queen's chamber
only (level 0 of map square 54,148) in a game message: "You peek down and see one adventurer
inside the lair." (rsprox captures, recording 1864 ticks 1162 and 1166). A whole-lair count is
ruled out: at the peek, the recorder and another player throwing bronze knives at a worker from
(3504, 9525, 2) are both on level 2, and live still says "one". Two readings fit that capture: the
chamber only, with someone unseen there who left before the recorder climbed down at tick 1195
(the Queen was at full health then), or the whole lair minus the clicker, which would make the
thrower the "one". They differ when the hive has players and the chamber doesn't; no capture
shows that case. Ours takes the chamber, after the Wiki's 2015 update note ("other players
currently in the boss room"); its 2017 note ("currently inside the lair") fits either reading. None and
two or more fill the same sentence ("no adventurers", "N adventurers"; ours, uncaptured). The surface rope still moves the player on the tick of use; the capture moves them 2
ticks after arrival.

## The molt and no damage while she molts (#4548, #6430)

Timeline from the first form's death, in game ticks (rsprox 227/234, recordings 95, 96, 545, 1757,
1864, 3276; 154 molts, `kalphite_update_flying_queen_emerging`, 6270):

- Tick 0: her last hitsplat. She stays in the first form, hitpoints bar at 0, for 7 ticks (101
  molts) or 8 ticks (53 molts); then the molt packet arrives: `TransformationExtendedInfo(id=965)`,
  `EnabledOpsExtendedInfo`, sequence 6270 and spotanim 1055 together.
- Molt tick +0 to +11.5: sequence 6270 and molt graphic 1055's sequence 6269 each last 345 client
  cycles, 11.5 ticks at 30 cycles per tick.
- Molt tick +13 to +16: her first hitsplat from the player (72 at +13, 66 at +14, 13 at +15, 3 at
  +16). Players were already clicking her at +5 to +11 in 27 molts and no hit landed before +13
  (recording 95, molt at 8873: clicks from +5, first hit +14). That is hit-arrival timing, so the
  unlock is inferred to be about +12; no packet records the server's targetability decision.

Wiki: Kalphite Queen: "When the first form is killed, it takes 20 game ticks (12 seconds) for the
transition into the second airborne form." That is the whole span from the kill: 8 ticks before the
molt starts and 12 ticks of molt. The Wiki is silent on whether she can be targeted during it.

A recent public kill agrees (YouTube WbepbOvvTgs, stepped frame by frame): the killing splat and a
0/255 health reading at about 39.6 s, her shell breaking apart from about 44.4-45.0 s (about 5 s, 8
ticks later), and the airborne form's health bar and first splat at about 54 s (the player was
swapping gear, so that first hit is a late bound, not the unlock).

Ours (`MOLT_DELAY_TICKS` 8, `TRANSFORMATION_TICKS` 12): `transformFirstForm` holds her at 1
hitpoint and untargetable in the first form with no animation; `MoltStartTask` switches her to the
airborne appearance and plays 6270 and 1055 8 ticks later; `TransformTask` restores 255 hitpoints
and makes her targetable 12 ticks after that, 20 from the kill. Before this she molted on the kill
tick and sat in the airborne form, untargetable and with no animation, for 8 more ticks (#6430).
The 8 is the Wiki's 20 minus the 12-tick molt; the captures show 7 or 8.

Untargetable prevents both incoming attacks and her own attacks, and the hit queue is cleared.
Direct damage (a burn's tick, poison, venom) is queued straight onto her pending damage. A burn
ticking at the moment of the kill took her last hitpoint mid-molt, and since she already had the
airborne id, the before-death hook let her die: the second form was skipped (#4548). The encounter
marks her as molting from the first form's death until the airborne form takes over, and zeroes
any damage applied to her meanwhile (`combat:damage-apply`). In the captures no hitsplat lands on
her in the 12 ticks after the molt starts; none of those fights had status damage on her, so how
live shows a burn tick then isn't captured. Ours: damage that still arrives shows as a 0 splat, burn
stacks keep running down, and what is left carries over to the airborne form.

The #6430 report ("mage works after 4-5 clicks") has not been reproduced separately.

`server/tests/kalphite-queen-molt.test.cjs` loads the real plugins, burns or poisons a real Queen
through the first form's death, and asserts she stays in the first form for 7 ticks, is airborne
from tick 8, is untargetable on ticks 0 to 19 and targetable on tick 20.
