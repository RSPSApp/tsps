# Rune Pouch

A port of RuneLite's Rune Pouch plugin. It is on by default, as in RuneLite.

It shows what is in your rune pouch or divine rune pouch, including the Trouver-locked
versions, without opening it. The contents come from the pouch's own varbits
(`rune_pouch_type_1-6`, `rune_pouch_quantity_1-6`), which the server sends.

## On the pouch

Shown on the pouch in the inventory, the inventory-like side panels (bank side, deposit box,
shop, trade and so on) and the bank:

- **Fewer than four runes:** a list. Each row has the rune's icon and its count. Counts of
  1000 or more show as thousands, as `5K`.
- **Four runes or more (divine rune pouch):** a grid of icons, two to a row. Each icon has a
  bar beside it:
  - **Red** under 1000 runes, rising in steps of 100.
  - **Green** from 1000 runes, rising in steps of 1000 and full from 10,000.

The rune icons are the runes' own inventory images, drawn at RuneLite's 11-pixel size.
RuneLite bundles its own icons instead.

## Tooltip

Hovering over the pouch lists each rune's count and name (in yellow).

## Settings

| Setting      | Default | Effect                                                        |
|--------------|---------|---------------------------------------------------------------|
| Font color   | Yellow  | Colour of the counts on the pouch                             |
| Display mode | Both    | **Inventory**: on the pouch only. **Mouse hover**: tooltip only. **Both**: both. |

## Licence

Ported from RuneLite (BSD 2-Clause); see `LICENSE`.
