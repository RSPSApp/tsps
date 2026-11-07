# Salamanders

`server/plugins/items/Salamanders.plugin.js` picks the combat method for the swamp lizard and the
orange, red, black and Tecu salamanders; the style buttons, speed and reach come from the
`SALAMANDER` weapon interface and `WeaponProfile` (see [weapon-data.md](weapon-data.md)).

| Salamander | Tar (ammo slot) | Wield | Hidden Magic bonus for Blaze |
| --- | --- | --- | --- |
| Swamp lizard | Guam | 30 Attack, Ranged, Magic | 56 |
| Orange | Marrentill | 50 Attack, Ranged, Magic | 59 |
| Red | Tarromin | 60 Attack, Ranged, Magic | 77 |
| Black | Harralander | 70 Attack, Ranged, Magic | 92 |
| Tecu | Irit | 80 Attack, Ranged, Magic | 104 |

Blaze max hit is `floor(0.5 + Magic * (64 + hidden bonus) / 640)`; for the Tecu salamander that gives 21 at
Magic 80-81 and 33 at 124-125, the rows of its Wiki table.

## Verified

- **Tecu salamander** ([Wiki](https://oldschool.runescape.wiki/w/Tecu_salamander)): wielded with 80 Attack, 80 Ranged
  and 80 Magic, fuelled by irit tar, Scorch (slash, 5 ticks), Flare (ranged, 4 ticks), Blaze (magic, 5 ticks), every
  style reaching 1 tile, Blaze using a hidden Magic strength of 104. It shares the other salamanders' combat code, so
  it also burns one tar per attack in every style: in recording 1607 each red-salamander attack (Scorch sound 738,
  Flare 736, Blaze 740) removes one tar from the ammo slot.
- **Irit tar** ([Wiki](https://oldschool.runescape.wiki/w/Irit_tar)): +60 ranged strength (raised from 49 in April 2024,
  which the cache agrees with), used as the Tecu salamander's ammunition.
- **Death** ([Wiki](https://oldschool.runescape.wiki/w/Items_Kept_on_Death)): "Living creatures such as Salamanders run
  away and will not be left in gravestones". An unprotected salamander is lost on death, neither dropped nor put in a
  grave; one kept by Protect Item stays. This is the Wiki's sentence only; no recording of it was found.

## Not covered

- **Herb tar** ([Wiki](https://oldschool.runescape.wiki/w/Herb_tar)) is made from 15 swamp tar and a herb (Herblore 19, 31,
  39, 44, 55 for guam to irit, XP 30, 42.5, 55, 72.5, 85). No recipe for it exists here. The Herb tar page gives no
  tool, speed or messages, and the Irit tar page alone names a pestle and mortar and 3 ticks; no recording of it was found.
- **Attacking without tar**: recording 1607 (one attempt) answers the click with "You have no food equipped for the
  salamander to use." and stops. Here the pursuit check refuses silently, so the player just stands in combat; fixing that
  needs a click-time check in the combat flow.
- Immature Tecu salamanders are not covered by the death rule.
