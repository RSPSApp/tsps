# Mogres and the fishing explosive

Mudskipper Point's three Ominous Fishing Spots hold no Mogre of their own: one comes out when
a fishing explosive is thrown at the spot. `server/plugins/npcs/Mogre.plugin.js` does this;
`SkippyAndTheMogres.Quest.js` owns the miniquest (the Slayer task and kill credit come from it).

## Captured (rsprox captures 464 and 3299, both revision 233-234)

Using a fishing explosive on an Ominous Fishing Spot (`ominous_fishing_spot_a`/`_b`):

| tick (after the click) | what live sends |
| ---: | --- |
| 0 | player animation `human_stake2` (929), graphic `vial_launch` (50, height 96), synth sound 2708, "You hurl the shuddering vial into the water..." (spam), one explosive removed, projectile `vial_travel` (49; start height 163, end height 30, angle 15, progress 11, launch delay 41, end 61-91 by distance) |
| 3 | synth sound 1487 (the blast) |
| 5 (3 to 6) | "...and a Mogre appears!" (spam), the hint arrow reset onto the Mogre (`mudskipper_ogre`, npc 2592) |
| 6-12 | the Mogre hits the thrower (21 of 28 throws in 3299 and 464 produced a Mogre) |

While that Mogre is alive a second throw sends only "There is already one Mogre attacking you!"
(game message) and keeps the explosive (3 of 28 attempts).

## From the Wiki

- [Fishing explosive](https://oldschool.runescape.wiki/w/Fishing_explosive): before the miniquest is
  finished the thrower says "Sinister as that fishing spot is, why would I want to explode it?";
  within two squares of the spot they say "If this thing explodes, I think I should stand a
  liiiiittle further away...".
- [Mogre](https://oldschool.runescape.wiki/w/Mogre): Lure and Bait on the spot do nothing but say
  "Something seems to have scared all the fishes away...". Mogres are level 60 with 48 hitpoints,
  need 32 Slayer, and are only met by luring them out (there are no standing Mogres at the Point).

## What was wrong

Nothing handled the explosive on the spots, so using it ended in "You can't reach that!" and no
Mogre could be summoned. Instead three standing Mogres (npc spawns on the three spot tiles) attacked
anyone who walked up; those spawns are removed, as the Wiki has Mogres come only from the explosive.

## Estimates (not captured)

- The Mogre stands on the nearest free 2x2 of land to the spot (the spot tile itself is water it
  cannot leave), the one nearest the player on a tie; the captures do not show where it appears.
- Throws are made from where the player stands within 10 tiles of the spot; no walk-up was captured.
- The vial's flight is 5 client cycles a tile (the three captured ends fit it).
- Lure and Bait are reached the same way as a throw.
