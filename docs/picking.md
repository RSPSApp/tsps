# Picking crops and plants

Wheat, potatoes, onions, cabbages, sweetcorn, flax and nettles are picked through `server/plugins/objects/Pickable.plugin.js`. What each gives and how it depletes is in `server/data/definitions/pickables.json`.

## From rsprox captures

Picking potatoes (Lumbridge) and wheat (Varrock):

| Tick | What the server sends |
| --- | --- |
| The tick the player is beside the plant | animation 827 (`human_pickupfloor`) |
| One tick later | the message ("You pick a potato.", "You pick some grain."), the item, sound 2581, and `loc_del` of the plant for everyone |
| Potato: 50 ticks after the pick started; wheat: 20 | `loc_add_change`, the plant is back |

- **Every pick removed the plant:** both potatoes and wheat.
- **The messages are spam-type:** they can be filtered out. Here they are ordinary game messages.

## From the Wiki

| Plant | Item | Depletes | Respawn |
| --- | --- | --- | --- |
| Wheat | Grain | always (capture) | 20 ticks (capture) |
| Potato | Potato | always | 50 ticks |
| Onion | Onion | always | 50 ticks |
| Cabbage | Cabbage | always | 40 to 80 ticks, depending on world population |
| Sweetcorn | Sweetcorn | always, turning into its empty version (51829 → 51831, 51830 → 51832) | estimated at 20 ticks (the Wiki says "a short amount of time") |
| Flax | Flax | 3 in 16 picks | 10 ticks (Mod Ash) |
| Nettles | Nettles | not documented, so never | — |

**Nettles need gloves.** Any gloves work except beekeeper's gloves; the Wiki lists the gloves that work, and any worn gloves is an approximation of that list. Without gloves, the player gets no nettles and takes up to 2 damage.

## Unverified

These are worth checking against captures:
- **Messages:** "You pick an onion.", "You pick a cabbage.", "You pick some sweetcorn.", "You pick some flax.", "You pick the nettles." and "You have been stung by the nettles!".
- **Sweetcorn:** its respawn time, and its rare sweetcorn seed (not modelled).

## Not covered

Other scenery with a Pick option is mostly quest or area content: grapevines, kelp, glowing fungus, rare flowers, black mushrooms, a Farming pineapple plant, and berry bushes ("Pick-from"). These belong to their quests or areas. Banana trees have their own plugin, and "Pick-lock" belongs to Thieving.
