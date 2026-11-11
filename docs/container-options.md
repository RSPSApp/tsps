# Container options: Empty, Fill, Remove-one

Inventory options on filled vessels and on produce sacks and baskets (issue 4462).

## Empty on vessels

`server/plugins/items/EmptyContainers.plugin.js` (buckets, pots, jugs) and `Potions.plugin.js` (vials). The filled
item becomes the empty one in the same slot and keeps its meta. From rsprox captures (op6 on `inventory:items`,
spam message, tick 0):

| Item (gameval) | Leaves | Message | Sound | Recordings |
| --- | --- | --- | --- | --- |
| `bucket_water` | `bucket_empty` | You empty the contents of the bucket on the floor. | 4951 | 268, 2765 |
| `bucket_sand` | `bucket_empty` | same | 2584 | 268, 375, 1693, 3196 |
| `bucket_milk` | `bucket_empty` | same | 2401 | 3179, 1098 |
| `bucket_ectoplasm` (Bucket of slime) | `bucket_empty` | same | 2401 | 377 |
| `bucket_compost` | `bucket_empty` | You empty the bucket of compost. | none | 3030 |
| `pot_flour` | `pot_empty` | You empty the contents of the pot on the floor. | 2584 | 3181 |
| `vial_water`, `pillarvial` | `vial_empty` | You empty the vial. | none | 3005, 4100 |

Not captured, Ours:
- Jug of water: "You empty the contents of the jug on the floor.", no sound (the captured floor line, for a jug).
- Plant cure: a vial (Wiki), so it takes the vial line and leaves `vial_empty`.

## Sacks and baskets

`server/plugins/skills/farming/Services.Farming.js` (`CONTAINERS`). One produce per container; sacks hold 10
vegetables, baskets 5 fruit.

- **Fill** on an empty sack takes up to 10 of one vegetable from the inventory, "cabbages first, then onions, and
  lastly potatoes"; Draynor Manor cabbages (`magic_cabbage`) can't go in (Wiki, Empty sack).
- **Fill** on an empty basket takes up to five of one fruit, with no message, and the filled basket takes the
  basket's slot (rsprox captures: recording 3276, strawberries; a Grid Master event world, the only basket capture).
- **Fill** on a filled one tops it up with the same produce. **Remove-one** takes one out (needs a free slot).
- **Empty** gives back the empty container and all the produce, silently (rsprox captures: recording 3128,
  `sack_potato_3`).
- Ours: the basket's fruit order (list order: apples, bananas, oranges, strawberries, tomatoes), "The sack/basket is
  full." and "You don't have any ... to put in the sack/basket." (no capture or Wiki text).

The Final Dawn's own sack of potatoes (Potatoes(3)) empties through the quest during its stages, and through farming
otherwise.

## Not covered

The bottomless milk bucket (`bottomless_milk_bucket`, `bottomless_milk_bucket_filled`): no charges, milk types or
cow milking exist yet, and no capture or Wiki text gives its Fill, Check or Empty messages.
