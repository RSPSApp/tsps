# Container options: Empty, Fill, Remove-one

Inventory options on filled vessels and on produce sacks and baskets (issue 4462). Facts from rsprox captures;
"20261111T230428" is the user's rev 242 recording of these items, cited by tick.

## Empty on vessels

`server/plugins/items/EmptyContainers.plugin.js`. The filled item becomes the empty one in the same slot and keeps
its meta. Op6 on `inventory:items`, spam message, tick 0:

| Item (gameval) | Leaves | Message | Sound | Recordings |
| --- | --- | --- | --- | --- |
| `bucket_water` | `bucket_empty` | You empty the contents of the bucket on the floor. | 4951 | 268, 2765 |
| `bucket_sand` | `bucket_empty` | same | 2584 | 268, 375, 1693, 3196 |
| `bucket_milk` | `bucket_empty` | same | 2401 | 3179, 1098 |
| `bucket_ectoplasm` (Bucket of slime) | `bucket_empty` | same | 2401 | 377 |
| `pot_flour` | `pot_empty` | You empty the contents of the pot on the floor. | 2584 | 3181 |
| `jug_water` | `jug_empty` | You empty the contents of the jug on the floor. | 2401 | 20261111T230428 t12 |
| `bowl_water` | `bowl_empty` | You empty the contents of the bowl on the floor. | 2401 | 20261111T230428 t168 |
| `plant_cure` | `vial_empty` | You empty the contents of the vial on the floor. | 2401 | 20261111T230428 t17 |
| `bucket_compost` | `bucket_empty` | You empty the bucket of compost. | none | 3030 |
| `bucket_supercompost` | `bucket_empty` | You empty the bucket of supercompost. | none | 20261111T230428 t175 |
| `bucket_ultracompost` | `bucket_empty` | You empty the bucket of ultracompost. | none | 20261111T230428 t172 |

Potions and the other vials empty in `Potions.plugin.js` with "You empty the vial." (3005, 4100).

**Pot of cornflour** (`chickenquest_pot_cornflour`) asks first (20261111T230428, ticks 156-164). It opens chatmenu
219 with script 58, "Are you sure you want to empty that pot?" and "Yes|No".
- No closes the menu and nothing else changes.
- Yes closes it and sends "You empty the contents of the pot on the floor." as a game message, not spam, with no
  sound. The cornflour goes and the empty pot lands in the first free slot, not the pot's own slot.

## Sacks and baskets

`server/plugins/skills/farming/Services.Farming.js` (`CONTAINERS`). One produce per container; sacks hold 10
vegetables, baskets 5 fruit. All from 20261111T230428 unless noted.

- **Fill** on an empty sack takes one vegetable, cabbages first, then onions, then potatoes. This is also the Wiki's
  order (Empty sack), and the capture shows it at ticks 64-79 and 117. It takes as many as are held, up to 10
  (3 cabbages make Cabbages(3) and 9 potatoes Potatoes(9)), in the sack's own slot, silently.
- An empty basket does the same with one fruit, up to 5: 4 bananas make Bananas(4) (ticks 133-153).
- Noted produce doesn't count. With none held, an empty sack says "You don't have any potatoes, onions or
  cabbages." as a game message (tick 26, noted onions held).
- Using noted onions on an empty sack: "Nothing interesting happens." (tick 29).
- Draynor Manor cabbages (`magic_cabbage`) can't go in (Wiki, Empty sack).
- **Fill** on a filled one tops it up with its own produce, silently (Onions(8) to Onions(10), tick 43). With none of
  that produce held it does nothing at all (Cabbages(1), Onions(1), Potatoes(1); ticks 69, 77, 81).
- **Remove-one** puts one into a free slot and drops the count. It sends a spam line: "You take an onion out of the
  onion sack.", "You take a cabbage out of the cabbage sack.", "You take a potato out of the potato sack." and "You
  take a banana out of the banana basket." (ticks 37, 58, 59, 127).
- **Empty** leaves the empty container in its slot and puts the produce in free slots, silently (ticks 45, 102, 114,
  131; and 3128, `sack_potato_3`).

Ours (no capture or Wiki text):
- the basket's fruit order (list order: apples, bananas, oranges, strawberries, tomatoes);
- the empty basket's line, "You don't have any apples, bananas, oranges, strawberries or tomatoes.";
- Fill on a full container doing nothing;
- the other fruits' Remove-one lines, following the banana one;
- Remove-one with a full inventory refusing with the usual full message.

The Final Dawn's own sack of potatoes (Potatoes(3)) empties through the quest during its stages, and through
farming otherwise. A sack at any count stops the quest's ground sack respawning.

## Not covered

The bottomless milk bucket (`bottomless_milk_bucket`, `bottomless_milk_bucket_filled`): no charges, milk types or
cow milking exist yet, and no capture or Wiki text gives its Fill, Check or Empty messages.
