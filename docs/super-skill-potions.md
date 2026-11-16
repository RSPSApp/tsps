# Super fishing and super hunter potions

Both are made from pillar potion (unf) (Herblore 62 / 67) and drink through
`server/plugins/items/Potions.plugin.js` like the other skill potions.

- Boost: a flat +6 Fishing / +6 Hunter a dose, from the current level, capped at base + 6
  (Wiki: Super fishing potion, Pillar coral; Super hunter potion, Crystal impling "80 Hunter,
  or 74 with a super hunter potion").
- Drinking (rsprox captures, rsprox.net rec 4100, rev 237, tick 953, super fishing potion(3)):
  `human_eat`, sound 2401, "You drink some of your super fishing potion." then
  "You have 2 doses of potion left." (both spam), a (2) left; the last dose leaves a vial.
- The super hunter potion's drink line is not recorded, so like every potion missing from
  `data/potion-drink-lines.json` it sends only the doses-left line.
