# Ectofuntus

`server/plugins/skills/Ectofuntus.plugin.js` (members), with one unit per part in
`server/plugins/skills/ectofuntus/`: the ectophial, the pool of slime, the bone grinder, worship and
the ghost disciples. Bones and bonemeal come from `server/plugins/skills/data/bones.json`
([prayer-bones.md](prayer-bones.md)). Ghosts Ahoy keeps only its quest.

Behaviour follows the OSRS Wiki (Ectofuntus, Ectophial, Bonemeal); messages, animations, sounds,
varbits and ticks follow rsprox captures (https://rsprox.net/database).

## Ectophial

Recordings 361, 371, 375-377, 390-392, 703, 1440, 2765, 3031, 3929, 3931 (rev 224-236). Ticks count
from the click on Empty:

| Tick | Captured |
| --- | --- |
| 0 | `ahoy_ecto_teleport` (878, which loops until stopped) with `ectophial_pour_spotanim` (1273); the full phial becomes the empty one (4252); "You empty the ectoplasm onto the ground around your feet..." |
| 3 | the sequence is reset; lands on one of (3658-3661, 3522, 0); "...and the world changes around you." |
| 4 | faces (3659, 3520); `human_pickupfloor` (827) with synth 1132 |
| 5 | the phial is full again; "You refill the ectophial from the Ectofuntus."; the sequence is reset |

Clicks don't stop it: in recording 703 the player clicks on tick 5, the phial refills that tick and
they move on the next. So movement is held until the refill. Using an empty phial on the Ectofuntus
refills it too (Wiki). The teleport takes the usual checks (level 20 Wilderness).

### Refill protection and feedback

The [Ectophial Wiki page](https://oldschool.runescape.wiki/w/Ectophial) states that automatic
refilling cannot be interrupted by the player and grants damage immunity; successful PvP
attacks still award experience. Protection starts on arrival and ends when the phial is full.
The plugin zeroes incoming combat hits at impact, after launch-time experience is awarded,
and direct damage at the final health-decrement boundary. The latter uses the generic
`combat:damage-apply` event (`{ target, hit }`, with a mutable `HitDamage`) so existing
poison/venom pulses also cannot reduce health during refill. Damage before arrival and after
completion is unaffected. Manual filling does not start this automatic-refill protection.

Recordings 361, 703 and 3929 show the liquid area sound (2401, one loop, range 5) when the
phial is emptied. Their automatic-refill kneeling sequence has a 10-cycle delay and sound
1132 has a 30-cycle delay. Recording 3929 also sends `busy` = 1 with the pouring action and
`busy` = 0 with the completed refill. These delays do not change the tick 3 arrival or
tick 5 inventory refill in the table above (relative to the pouring action).

Regression coverage in `server/tests/ectophial.test.cjs` exercises the registered handlers,
both damage paths, the captured feedback, item swaps, requirements rejection, removal cleanup
and manual filling. Combat immunity, busy state, animation/sound delays, the pouring sound
and direct-damage immunity each failed before their fixes. The cache supplies the sequence,
graphic and busy-varbit identifiers. This validation does not constitute a Ghosts Ahoy quest
playthrough or a visual review of the animation.

A live poisoned-player check kept health at 99 while the poison severity advanced from 30
to 29 during refill; the next pulse after completion reduced health to 93. A separate live
check confirmed the busy bit, full/empty/full inventory sequence, arrival, refill messages and
the unchanged level-20 Wilderness restriction. PvP attacker experience was checked by tracing
the launch/impact execution path, rather than a live two-player combat test.

## Pool of slime

Recording 377. A bucket used on the pool fills every bucket carried (Wiki). It plays
`quest_ahoy_human_filling_bucket` (4471) at once. Two ticks later a bucket becomes a bucket of slime
with synth 1132; the first fill also says "You fill the bucket with ectoplasm." Each next bucket's
animation comes two ticks after the last fill, so a bucket fills every four ticks (+2, +6, +10,
+14). The older recording 2765 (rev 229) filled every three ticks; tsps follows rev 231.

## Bone grinder

Recordings 376, 377 (rev 231). Bones on the loader run the whole round, then start the next bone
after each pot, until bones or pots run out or the player clicks. The player walks between the
three parts. The first part is used two ticks after the player arrives, whichever option or item
started the round (the loader with bones, Wind, Empty or a pot on the bin), and the sequence and
synth of each part carry the same client delay:

| Part (player's tile, facing north) | Captured | Then |
| --- | --- | --- |
| Loader (3660, 3524, 1) | `ahoy_bone_dump` (1649) and synth 1133, both delay 5, "You put some big bones in the grinder's hopper.", `ahoy_grinder_status` 1 | +3 steps west, +5 winds |
| Handle (3659, 3524, 1) | `ahoy_bone_grind` (1648) and synth 1131, both delay 10, "You wind the grinder handle."; +3 "Some crushed big bones pour into the bin.", status 2 | +6 steps west, +8 fills |
| Bin (3658, 3524, 1) | `ahoy_fillbucket_bonedust` (1650) and synth 1136, both delay 5, "You fill a pot with crushed big bones.", the pot becomes bonemeal, status 0 | +5 runs to the loader, +7 loads the next bone |

The other answers, also captured, are game messages two ticks after the player arrives:

- No pot at the bin: "You need an empty pot to put the crushed big bones into." The round stops
  with the bones in the bin.
- Bones on the loader while the bin is full: "You need to empty the grinder's bin before you put
  more bones in it."
- Status: "The grinder is empty." / "There are some big bones in the hopper." / "There are some
  crushed big bones in the bin."
- Empty, or a pot on the bin: "The grinder is already empty." / "You need to wind the handle to
  grind the big bones." / a full bin fills the pot and carries on.
- Winding an empty grinder only turns the handle.

What's in the grinder is saved (`ectofuntus:grinder-status`, `ectofuntus:grinder-bone`) and sent in
`ahoy_grinder_status` (varbit 210) on login. Not captured: bones on the loader while the hopper is
full. They are wound, as the handle does.

## Worship

Recordings 375-377, 703 (rev 229-231). One worship per click; a bucket of slime or bonemeal used on
the Ectofuntus does the same:

- `ahoy_prayer` (1651), synth 2671, "You put some ectoplasm and bonemeal into the Ectofuntus, and
  worship it." The bucket and pot are emptied in their slots, and `ahoy_ectotokens_base` goes up 5.
  The experience is four times the bones' burying experience (Wiki, Bonemeal).
- Missing either, a message box: "You don't have any ectoplasm or crushed bones to put into
  the<br>Ectofuntus." / "You need a bucket of ectoplasm to put into the Ectofuntus." / "You need a
  pot of crushed bones to put into the Ectofuntus."

The disciples hold up to 1000 unclaimed tokens (Wiki). Past that, the Wiki's "There isn't room to
put any more in." shows in a message box (not captured). Superior dragon bonemeal is passed over
below 70 Prayer. The count is saved in `ectofuntus:tokens` and shown in `ahoy_ectotokens_base`
(4769) and `ahoy_ectotokens_more` (5671), which only hold 255.

The experience rates above use the Wiki's table rather than the recordings' XP drops.

### Worship experience and Zealot's robes

The [Ectofuntus Wiki page](https://oldschool.runescape.wiki/w/Ectofuntus) lists bat bones at
21.2 Prayer XP per offering. Worship passes that fractional amount to the skill manager;
rounding each offering up to 22 incorrectly added 4 XP per five offerings. A live check of
five bat-bonemeal offerings now gives 106 XP, consumes five bonemeal and five slime buckets,
and adds 25 unclaimed ecto-tokens.

The [Zealot's robes Wiki page](https://oldschool.runescape.wiki/w/Zealot%27s_robes) and the
Ectofuntus page specify a 1.25% chance per worn piece, up to 5%, to preserve both bonemeal
and slime. One saving roll covers the pair. Saved offerings still give their normal Prayer
experience and five ecto-tokens; they leave both filled containers in their original slots.
Carrying the robes gives no bonus. Requirements and the 1,000-token limit are checked before
rolling, so saved supplies cannot bypass them.
A live full-set offering preserved both filled containers while granting Prayer XP and
increasing the unclaimed token count from 45 to 50.

Regression coverage exercises the registered Worship and item-use handlers with real
inventory, equipment and skill containers. It checks fractional XP accumulation, each
robe-count probability boundary, saved and consumed pairs, ordinary captured feedback,
missing supplies, the superior-dragon level requirement and the token limit. The inventory
swaps, worship message, animation, sound and five-token increment are supported by rsprox
recording 377; the fractional XP and robe probabilities use the Wiki pages above. The
recordings inspected do not establish any extra message when the robes save supplies.

## Ghost disciples

Recordings 376, 377, 703, 1857. Their Wiki transcript (`npc-dialogues.json`) has the words; the
plugin picks the variant:

1. Without a ghostspeak amulet or Morytania legs 2 or better: "Woooo wooo wooooo woooo".
2. With tokens waiting: "Can I have the tokens I have earned?", then "Certainly, mortal. Here's 5
   ectotokens." as they're handed over, or, with no room, "I have 5 ectotokens waiting for you
   mortal, but you do not have room in your inventory for them."
3. After the hard Morytania diary: "Can I have another bonecrusher, please?". Without one in the
   inventory or bank, the bonecrusher is handed over as "Compliments of Morytania for your efforts
   throughout the tasks set." shows; otherwise "You already appear to own such a device, mortal."
4. Otherwise the standard questions about the Ectofuntus.

## Varp 408

Ghosts Ahoy's stage is varbit 217 (bits 28-31 of varp 408); the grinder and the tokens are other
bits of the same varp. The quest now writes its varbit rather than the whole varp, so the stage no
longer wipes them.

## Not built

- The diary's teleport to the pool of slime.
- The weathered wall shortcut (58 Agility).
