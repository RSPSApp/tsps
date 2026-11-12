# Slashing webs

The Wilderness webs (loc 733 "Web", Slash) and the slashed web they turn into (loc 734), built
from the OSRS Wiki ([Web](https://oldschool.runescape.wiki/w/Web)) and checked against live
rsprox captures (<https://rsprox.net/database>; recordings 358, 360, 457, 1440, 1702, 2966, 4155
and 452 for the refusal). The code is `slashWeb` in `server/plugins/areas/Wilderness.plugin.js`;
the Sarachnis dungeon webs are her plugin's (`docs/sarachnis.md`).

## What the Wiki says

- Any weapon with a slash bonus cuts, as does a knife, from the inventory or wielded (no longer
  needs to be wielded). Non-weapon items with a slash bonus (amulets) do not.
- Chance: 100% for a Wilderness sword or a slash bonus of +100 or more, 50% for a knife, 20% for
  any slash bonus, scaled in between with a floor of 50% for slash swords. Failure costs nothing.
- Aranea boots let the player "pass through webs without needing any other tools" (Web, Aranea boots).

## What the captures show

- Success sends "You slash the web apart.", failure "You fail to cut through it." (recordings
  358, 360, 457, 1440, 4155).
- With no blade: "Only a sharp blade can cut through this sticky web." (recording 452).
- Synth 2500 plays with the swing, on a failed cut as on a cut (recording 4155, ticks 1657, 1662, 1663).
- The swing plays on the arrival tick: a knife `human_knife_chop` (911; recordings 457, 4155), a
  sword `human_sword_slash` (390; recordings 358, 360, 1702), an axe `human_axe_hack` (395;
  recordings 1440), so it follows the weapon, not one fixed animation.
- The web turns into the slashed web two ticks after the message (recording 4155: message on
  ticks 1657, 1663, then the loc change on 1659, 1665), and the player's `busy` varbit is set
  in between.
- The slashed web is a web again 99 ticks after the loc change (recording 4155: 1813 -> 1912,
  1818 -> 1917, 1834 -> 1933, three different webs).
- With aranea boots on, Slash on the Forthos tomb web (loc 34898) wades through:
  `human_aranea_boots_wade` (11511) with a one-tile exactmove (delay 30, angle 1024 going north and
  0 coming back), the web left standing and no message (recordings 3926, 3927 ticks 5035-5038, 3932
  tick 4939). No Wilderness web is recorded with the boots.

## What we do

- The cutting item is the best of the wielded weapon and the inventory; its own slash animation
  plays (cache attack animation, else the weapon type's slash style, a knife chops).
- Messages and the swing sound as captured; clicking a web already being cut does nothing.
- The web becomes the slashed one two ticks after the swing and a web again 99 ticks later.
- With aranea boots worn, Slash wades through as recorded at the Forthos web, carried blade or not: the
  wade with its one-tile forced step, no message, the web left standing. A wall web is crossed from
  its tile over its edge, or stepped back onto; any other web's tile is stepped onto. Using a blade
  on the web still slashes it.

## Not done

- The `busy` lock during the two ticks (recording 4155 sets varbit 12393 for them).
- Whether the boots wade a Wilderness web exactly as at the Forthos web: only Sarachnis' web is
  recorded, so the wade is reused from there.
