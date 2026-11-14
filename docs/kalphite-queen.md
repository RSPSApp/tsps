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

Not covered: the Hard Desert Diary's permanent ropes (`kalphite_rope_1`/`_2` and varbit 11705 set
to 1). The private Queen instance (40422, varbit `kalphite_chamber_entrance_rope`) is not covered
either.

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

## No damage while she molts (#4548)

When the first form dies, `transformFirstForm` holds her at 1 hitpoint, untargetable, for
`TRANSFORMATION_TICKS` (20, Wiki: Kalphite Queen) before the airborne form takes over at 255.
Untargetable stops attacks and the hit queue is cleared, but direct damage (a burn's tick, poison,
venom) is queued straight onto her pending damage. A burn ticking at the moment of the kill took
her last hitpoint mid-molt, and since she already had the airborne id, the before-death hook let
her die: the second form was skipped.

The encounter now marks her as molting from the first form's death until the airborne form takes
over, and zeroes any damage applied to her meanwhile (`combat:damage-apply`).

From the rsprox captures (rev 227 and 234, recordings 95, 96, 545, 1757, 1864, 3276): across 154
molts (`kalphite_update_flying_queen_emerging`, 6270) no hitsplat lands on her in the 12 ticks
from the molt. None of those fights had status damage on her, so how live shows a burn tick then
isn't captured.

Ours: damage that still arrives during the molt shows as a 0 splat, and burn stacks keep running
down; what is left carries over to the airborne form.

In the captures the airborne form takes its first hit 13 to 16 ticks after the molt, while our
molt lasts the Wiki's 20 ticks. That is left for a separate check.

`server/tests/kalphite-queen-molt.test.cjs` loads the real plugins and burns or poisons a real
Queen through the first form's death.
