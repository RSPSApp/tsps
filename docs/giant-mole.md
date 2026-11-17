# Giant Mole burrowing and attacks

The Mole's burrow check runs after an eligible hitsplat has taken HP, through the
existing damage-application event and its applied observer. Starting the dig when
an attack was launched made the Mole untargetable before impact, discarding the
very hit that triggered it. A projectile could also start the dig before arriving.

The [Giant Mole](https://oldschool.runescape.wiki/w/Giant_Mole) and
[strategy](https://oldschool.runescape.wiki/w/Giant_Mole/Strategies) pages were
checked on 28 October 2026. They establish:

- A one-in-four dig chance in the 5–50% health range, with no digging at or below
  10 HP (the main page's 18 February 2016 change explicitly includes 10).
- Melee/ranged zeros can cause digging; magic splashes and poison cannot.
- Burrowing loses aggression and moves the Mole elsewhere in the lair.
- Thralls can cause digging. The strategy page also identifies the extra dig
  chance from Twinflame's second hit; eligibility therefore follows applied hits,
  rather than one notification for an entire multi-hit attack.

The plugin checks surviving HP after each eligible hit. The existing direct-damage
path attributes thrall hits to their player, so it now reaches the same check as
ordinary combat. Magic splashes never apply damage; poison and reflected damage
are excluded. Once buried, another hit already landing still deals its damage,
without scheduling a second dig. A single lethal hit never starts a dig.

## Digging down

A burrow used to hide the Mole on the tick it started, so `mole_burrow_down` (3314) was
sent but never seen: she blinked out. She now stops fighting and walking, turns
untargetable and plays the dig with the mud cloud (571) where she stands. She stays in sight
for 3 ticks, then is hidden. The cache sequence runs 97 client cycles (frame lengths summed),
about 3.2 ticks, so 3 ticks hides her just before the animation would end and she would stand
back up. The 4 ticks underground and `mole_burrow_up` (3315) at the new spot are unchanged.
Dying mid-dig (poison) cancels the burrow where she stands.

Her resurface spot becomes her spawn position until she dies. The burrow spots lie far outside
her wander radius, so measured from the lair spawn she counted as away: she walked back there
and, as a retreating NPC, regenerated 10% of her hitpoints a tick (checked in game: a dig at 40
of 200 came up at 180). At death the lair spawn is restored, so her respawn clone appears where
it always has.

From her first burrow she also carries `combat:no-regen` for the rest of her life. Any NPC left
alone 20 seconds regenerates 10% of its hitpoints a tick here, and finding her after a burrow
often takes longer: in game she came up at 64 and was back to 200 before a player reached her.
With the flag, a resurfaced Mole left alone for 50 ticks kept her damage. A respawn is a new NPC
without the flag.

## Combat achievements

The plugin keeps, on the NPC, how many times she has burrowed (`giant-mole:burrows`), the
tick she last resurfaced (`giant-mole:surfaced-tick`) and the tick she died
(`giant-mole:died-tick`, from the before-death hook). A respawn is a new clone, so each life
starts clean. `GiantMole.CombatAchievements.js` reads them:

- **Why Are You Running?** "Kill the Giant Mole without her burrowing more than 2 times."
  At most 2 burrows in her life.
- **Whack-a-Mole** "Kill the Giant Mole within 10 seconds of her resurfacing." She must have
  resurfaced, and died no more than 16 ticks (9.6 seconds) later.

Giant Mole Novice and Champion are plain kill counts; Hard Hitter and Avoiding Those Little
Arms were already ruled.

## Attacks and entering the lair

Npc 5779 takes its attack, defend and death animations from its entry in
`data/definitions/npc-combat-defs.json` (`mole_attack` 3312, `mole_defend` 3311,
`mole_death` 3310), rather than the cache scan's guessed sequence. The Wiki's
four-tick attack speed is asserted against the loaded definition.

Digging with a spade (Spade, Large spade, Eastfloor spade) while standing on a Falador Park
mole hill (loc 12202, a single walkable tile) enters the lair, as the Wiki's Mole Hole page
describes. Using the spade on the hill does the same. Both play the shared dig animation (830,
synth sound 1470) and open the dark-area warning (cws_warning_3, "Falador Mole Lair",
rsprox_transcripts/227/910326.txt tick 1288). Yes, or the dig itself once the warning is turned
off, asks "What kind of tunnels would you like to enter?" (Public. / Private.). Either choice
plays the dig again and drops the player at (1752, 5237) one tick later with the spam line "You
seem to have dropped down into a network of mole tunnels." (227/910326.txt ticks 1292-1295
Public., 227/910356.txt ticks 13201-13207 Private.). Private. rents the instance below, exactly
as Fight-privately does. A dig anywhere else is left to the other dig handlers and the spade's "Nothing
interesting happens."

The Mole Hole is a dark area (Darkness.plugin.js; Wiki, Light source: "Light source required"):
without a light source a player is warned, then bitten every tick, and cannot attack. The dig
in is refused without one, with "It's going to be dark down there, I should bring a light
source." and no animation or move, as captured on the north-west spade
(rsprox_transcripts/240/911352.txt tick 45); the mole hills are taken to refuse the same way.
The Fire of Eternal Light built in the lair's fire pit (varbit `my2arm_fire_mole`) lights it
for good (Wiki, Mole Hole), though building the fire is not implemented yet. Her dirt putting
out open light sources when she burrows is not done: the Wiki gives no chance for it. The rope at the Mole hole climbs back out to the
well. Both paths and the wrong-location refusal are covered by the regression
suite. The Wiki does not describe a stun that interrupts a dig, so none is
implemented.

Look-inside on a Mole hill counts the players in the Mole Hole (the Falador Diary's kill
bounds, extended south to y 5120 so the corridor to the exit rope counts) in a game message:
"You look inside the mole hill and see no adventurers inside the mole tunnels." (rsprox
captures, recording 1638 tick 267). One is "one
adventurer", as the Kalphite Queen's and Sarachnis's captured peeks say; two or more use the
digits (ours, as the scrying pool's captured count does).

The plugin remains members-only. Its transient buried attribute uses a namespaced,
kebab-case key. Registration only attaches named handlers with the existing core
API; no generated definitions or shared combat code are changed.

## Verification

The regression suite runs the real hit queue and combat hit execution with
cache-backed NPC definitions. It covers damage preservation, projectile delay,
health boundaries (including exactly 10), zeros and splashes, two-hit attacks,
poison, failed rolls, resurfacing, loss of the combat target, the real thrall
summoning/attack task, the combat animations and speed, and the spade dig-in and
rope climb-out. Nine of its earlier 21 cases fail against the original plugin;
all 24 cases pass now. The related hit-queue, hitsplat-source and thrall suites
also pass (19 tests across the three suites). The server TypeScript build passed.

A running-world combat check used a max-level player with an abyssal whip and
explicit damage immunity, then lowered the Mole to 80 HP after establishing a
normal damaging attack. A zero-hit dig preserved 80 HP; a subsequent damaging
dig retained its 12 damage, resurfacing at 68 HP at a different lair location.
This verifies server state, not the visual quality of the animations or
unassisted combat balance. Exact 10 HP and thrall eligibility are covered by the
regression suite rather than claimed as live-world boundary checks.

## Evidence limits and separate mechanics

No Giant Mole combat recording was found in the available capture index; the
behavior evidence above is the Wiki, not a recording. The existing four-tick
buried interval and animation/graphic IDs are retained; their exact live timing
has not been established.

The Wiki also describes a chance of dirt extinguishing nearby open lights. That
branch remains unimplemented: neither the checked pages nor an available combat
capture establishes its odds or exact packet sequence. Implementing it would
require more evidence rather than an invented probability.

Falador shield tracking, dark-area damage, entrance counting, private-instance
purchase and diary-dependent drops are separate mechanics outside this burrow
fix. The existing plugin identifies tracking and entry features as omitted;
this change does not certify them.

## Private instance

Fight-privately on the spade in the north-west of Falador Park (loc 29460, `mole_hill_spade`)
rents a private Mole Hole (Wiki: Giant Mole, Mole Hole, Instance): 25,000 coins, 12,500 once the
hard Combat Achievement tier is done (`ca_tier_status_hard`, as the Sarachnis instance reads it),
halved again for ironmen (Mole Hole). The light check comes first, as captured
(rsprox_transcripts/240/911352.txt tick 45). The coins come from the bank and the player is
moved to the lair tile in the same tick, inside a PrivateArea over the lair's tiles with her own
Giant Mole at her lair spawn. The instance is dark like the public lair. Her next life comes 16
ticks after a kill while the player is there. Leaving, dying or teleporting ends it, and a logout
inside logs back in by the spade. A death there leaves its grave by the spade, outside the entrance
(Wiki, Instance, Giant Mole row: "Grave outside instance entrance"). Look-inside counts only the public lair.

Private. from a mole hill reaches the same instance a tick after the choice and sends the
"dropped down" spam line, as captured (227/910356.txt tick 13207); Fight-privately on the spade
sends none. Ours: no Giant Mole payment was recorded, so the payment and short-of-coins lines
reuse the Sarachnis instance's wording. Not done: the public lair's
baby moles in an instance.
