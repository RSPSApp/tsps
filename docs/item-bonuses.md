# Item bonuses

An item's equipment stats (`ItemDefinition.getBonuses()`) come from its params in the cache, so
they are the current game's and follow cache updates. `ItemDefinition.bonusesFromParams` reads
them when the item is loaded.

| Bonus index | Stat | Cache param |
| --- | --- | --- |
| 0-4 | Stab, slash, crush, magic, ranged attack | 0-4 |
| 5-9 | Stab, slash, crush, magic, ranged defence | 5-9 |
| 10 | Melee strength | 10 |
| 11 | Ranged strength | 12 (ammunition) + 189 (other gear) |
| 12 | Magic damage, in percent | 299 (tenths of a percent) |
| 13 | Prayer | 11 |

Param 14 is the attack speed (`getAttackSpeed()`).

## Where else bonuses come from

- **`item-gameplay.json`:** its `bonuses` only fill items the cache has no stat params for, such
  as custom items and old item ids. It is a 2021 export: before this, about one wearable item in
  five had stats out of date with the game (the Osmumten's fang and occult necklace changes,
  d'hide, darts), or none at all (Masori (f), Virtus, the DT2 rings, the Venator bow).
- **Broken Barrows pieces** ("0") get no stats. The cache has none for them, and the export would
  otherwise fill them. Degraded pieces (100-25) carry their base piece's stats in the cache.
- **Plugins** add effects on top through bonus providers: the blowpipe's darts, Tumeken's shadow,
  Dizana's quiver, salve amulet, void, and crystal and obsidian armour.

`tests/item-bonuses.test.cjs` checks every wearable item against its cache params.
