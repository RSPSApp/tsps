# Crystal singing (Prifddinas singing bowl)

Code: `plugins/items/CrystalSinging.plugin.js`. Test: `tests/crystal-singing.test.cjs`.
Crystal armour is sung here too (its charges: `docs/crystal-armour.md`); the celestial signet keeps `CelestialRing.ShootingStars.js`.

## Flow (rsprox captures)

- Sing-crystal on the bowl (loc `prif_singing_bowl`, 36552) opens the make menu (interface 270) of the
  recipes the inventory has the materials for. Nothing to make is the statement
  "You do not have all of the required materials and requirements to make anything." (310, 819).
- Singing takes the materials and gives the products on the same tick, plays sound 8, and awards the same XP
  in Smithing and Crafting. Five ticks later an item box of the product says "With the help of the crystal bowl,
  you sing a beautiful song and shape the crystals." (312, 1134, 1159, 1162).
- The menu is titled "What would you like to make?" with several products and "How many would you like to make?"
  with one (312, 1159).
- Crystal armour is in the same menu. Choosing a piece first shows its warning beside an armour seed ("This will
  consume your armour seed as well as your crystal shards. Reverting the helmet will not give you any crystal shards
  back.", and the body's and legs' with three and two seeds), then "Are you sure you wish to proceed?" (Yes. / Yes,
  and don't ask again. / No.). The second answer is saved and skips both from then on (ours: no capture of it) (1159).
- A menu amount sings that many at once: capture 1134 sings 25 crystal bows from 25 seeds for 1,000 shards.

## Recipes

| Product | Materials | Shards | Smithing and Crafting | XP each | Source |
| --- | --- | --- | --- | --- | --- |
| Crystal helm | crystal armour seed | 50 | 70 | 2,500 | capture 1159, Wiki |
| Crystal body | 3 crystal armour seeds | 150 | 74 | 7,500 | capture 1159, Wiki |
| Crystal legs | 2 crystal armour seeds | 100 | 72 | 5,000 | capture 1159, Wiki |
| Eternal teleport crystal | enhanced crystal teleport seed | 100 | 80 | 5,000 | capture 312, Wiki |
| Blade of Saeldor | enhanced crystal weapon seed | 100 | 82 | 5,000 | capture 1159, Wiki |
| Bow of Faerdhinen | enhanced crystal weapon seed | 100 | 82 | 5,000 | capture 1159, Wiki |
| Crystal bow | crystal weapon seed | 40 | 78 | 2,000 | captures 819, 1134, Wiki |
| Crystal halberd | crystal weapon seed (and the Hard Western Provinces Diary) | 40 | 78 | 2,000 | cache recipe book, Wiki |
| Crystal shield | crystal weapon seed | 40 | 78 | 2,000 | capture 1162, Wiki |
| Crystal axe / pickaxe / harpoon | crystal tool seed + the dragon tool | 120 | 76 | 6,000 | Wiki |
| Crystal felling axe | crystal tool seed + dragon felling axe | 120 | 76 | 6,000 | Wiki |
| Enhanced crystal key | crystal key | 10 | 80 | 500 | capture 1149, Wiki (KeyChests data) |

The armour, weapon and tool recipes also need Song of the Elves (Wiki). A seed or the crystal key used on the bowl
opens the menu of what it goes into.

## Recipes book

Loc 37344 "Crystal Singing Recipes" (Read) opens interface 181 `prif_recipes`. The cache builds the whole list
itself in its onLoad script (cs2 2924: names, material text, item icons), so the server only opens the group.

## Not covered (unverified or not built)

- Corrupting the Blade of Saeldor and Bow of Faerdhinen (capture 1159 shows "you sing a dark song which corrupts the
  crystals" and a 1,900-shard price for a charged bow, 2,000 less its stored shards; the recipe book lists 1,000
  for both while the weapon pages say 1,000 and 2,000).
- Reverting an inactive blade or bow to an enhanced crystal weapon seed (250 shards, 82; the Wiki gives no XP).
- Conwenna and Reese singing for players under the levels, the Tree Gnome Village and Brimstail's cave bowls
  (capture 310 shows only their no-materials statement), and what a player short of Song of the Elves sees.
- Using an item on the bowl is modelled as Sing-crystal filtered to that item; no capture uses an item on the bowl.
