# Picking crops and plants

Wheat, potatoes, onions, cabbages, sweetcorn, flax and nettles are picked through `server/plugins/objects/Pickable.plugin.js`. What each gives and how it depletes is in `server/plugins/objects/data/pickables.json`.

## From rsprox captures

Picking potatoes (Lumbridge) and wheat (Varrock):

| Tick | What the server sends |
| --- | --- |
| The tick the player is beside the plant | animation 827 (`human_pickupfloor`) |
| One tick later | the message ("You pick a potato.", "You pick some grain."), the item, sound 2581, and `loc_del` of the plant for everyone |
| Potato: 50 ticks after the pick started; wheat: 20 | `loc_add_change`, the plant is back |

- **Every pick removed the plant:** both potatoes and wheat.
- **The messages are spam-type:** they can be filtered out. Here they are ordinary game messages.

Picking nettles (Edgeville, rsprox recs 1001702 at tick 15597 and 1000376 at tick 1810):

| Tick | What the server sends |
| --- | --- |
| The tick the player is beside the nettles | animation 827 and sound 2581 |
| Two ticks later | "You pick a handful of nettles.", the nettles (4241), sound 2581 again, and `loc_del` of the nettles |
| 15 ticks after the pick started (rec 1001702) | `loc_add_change`, the nettles are back |

- **Every pick removed the nettles:** both recordings, with gloves worn.

## From the Wiki

| Plant | Item | Depletes | Respawn |
| --- | --- | --- | --- |
| Wheat | Grain | always (capture) | 20 ticks (capture) |
| Potato | Potato | always | 50 ticks |
| Onion | Onion | always | 50 ticks |
| Cabbage | Cabbage | always | 40 to 80 ticks, depending on world population |
| Sweetcorn | Sweetcorn | always, turning into its empty version (51829 → 51831, 51830 → 51832) | estimated at 20 ticks (the Wiki says "a short amount of time") |
| Flax | Flax | 3 in 16 picks | 10 ticks (Mod Ash) |
| Nettles | Nettles | always (capture) | 15 ticks (capture, one respawn seen) |

**Nettles need gloves.** Any gloves work except beekeeper's gloves; the Wiki lists the gloves that work, and any worn gloves is an approximation of that list. Without gloves, the player gets no nettles and takes up to 2 damage.

## Unverified

These are worth checking against captures:
- **Messages:** "You pick an onion.", "You pick a cabbage.", "You pick some sweetcorn.", "You pick some flax." and "You have been stung by the nettles!".
- **Bare-handed nettles:** no capture picks them without gloves, so the sting's timing, and whether the first sound plays, are ours.
- **Sweetcorn:** its respawn time, and its rare sweetcorn seed (not modelled).

## Not covered

Other scenery with a Pick option is mostly quest or area content: grapevines, kelp, glowing fungus, rare flowers, black mushrooms, a Farming pineapple plant, and berry bushes ("Pick-from"). These belong to their quests or areas. Banana trees have their own plugin, and "Pick-lock" belongs to Thieving.
