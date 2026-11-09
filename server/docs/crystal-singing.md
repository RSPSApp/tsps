# Crystal singing (Prifddinas singing bowl)

Code: `plugins/items/CrystalSinging.plugin.js`. Test: `tests/crystal-singing.test.cjs`.
Crystal armour keeps `CrystalArmour.plugin.js`, the celestial signet `CelestialRing.ShootingStars.js`.

## Flow (rsprox captures)

- Sing-crystal on the bowl (loc `prif_singing_bowl`, 36552) opens the make menu (interface 270) of the
  recipes the inventory has the materials for. Nothing to make is the statement
  "You do not have all of the required materials and requirements to make anything." (310, 819).
- Singing takes the materials and gives the products on the same tick, plays sound 8, and awards the same XP
  in Smithing and Crafting. Five ticks later the chatbox says "With the help of the crystal bowl, you sing a
  beautiful song and shape the crystals." (1134, 1159, 1162).
- A menu amount sings that many at once: capture 1134 sings 25 crystal bows from 25 seeds for 1,000 shards.

## Recipes

| Product | Materials | Shards | Smithing and Crafting | XP each | Source |
| --- | --- | --- | --- | --- | --- |
| Eternal teleport crystal | enhanced crystal teleport seed | 100 | 80 | 5,000 | capture 312, Wiki |
| Blade of Saeldor | enhanced crystal weapon seed | 100 | 82 | 5,000 | capture 1159, Wiki |
| Bow of Faerdhinen | enhanced crystal weapon seed | 100 | 82 | 5,000 | capture 1159, Wiki |
| Crystal bow | crystal weapon seed | 40 | 78 | 2,000 | captures 819, 1134, Wiki |
| Crystal halberd | crystal weapon seed (and the Hard Western Provinces Diary) | 40 | 78 | 2,000 | cache recipe book, Wiki |
| Crystal shield | crystal weapon seed | 40 | 78 | 2,000 | capture 1162, Wiki |
| Crystal axe / pickaxe / harpoon | crystal tool seed + the dragon tool | 120 | 76 | 6,000 | Wiki |
| Crystal felling axe | crystal tool seed + dragon felling axe | 120 | 76 | 6,000 | Wiki |
| Enhanced crystal key | crystal key | 10 | 80 | 500 | capture 1149, Wiki (KeyChests data) |

The weapon and tool recipes also need Song of the Elves (Wiki). A seed or the crystal key used on the bowl
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
