# Ground Items

A port of RuneLite 1.13.3's Ground Items. It is off by default to avoid ground item overlay cost.

## Labels

Every item within about 19 tiles gets a label: its name, the quantity (`Coins (1.5M)`) and,
by "Price display mode", the stack's Grand Exchange and High Alchemy value. Coins have no
price. Stacks of the same item on one tile are merged into one label. Labels on a tile stack
upwards 15 px apart, with a text shadow, or an outline with "Text outline".

Colours, in order:

1. The item's own colour (Shift + right-click Examine on it, then **Color**).
2. The highlight colour for items on the highlight list.
3. A value tier (low, medium, high, insane): the stack is worth more than the tier's price,
   by "Highlight value calculation".

Items on the hidden list, or worth less than "Hide under value" on both prices, are not drawn.
"Do not hide untradeables" keeps untradeable items from being hidden by value.

## Lists

"Highlighted items" and "Hidden items" take comma-separated names, in the **Item lists**
section. Names ignore case. `*` matches anything (`rune*`), `"Name"` matches only that exact
name, and `Name>10` or `Name<10` checks the quantity. An exact entry in either list beats a
wildcard in the other.

## Hotkey mode (Alt by default)

While the hotkey is held:

- Hidden items show too.
- Each label gets two boxes: **−** (hidden list) and **+** (highlight list). A box is filled
  when the item is in that list.
- Clicking a box toggles the item in that list. Left-clicking the name highlights it;
  right-clicking the name hides it. These clicks don't reach the game.

Double-tapping the hotkey (within "Double-tap delay") hides every label until you press it
again.

## Menus

The **Take** entry (and Telekinetic Grab's **Cast**) is coloured like the label, on the option,
the item name or both ("Menu highlight mode"), when "Item highlight mode" includes the menu.
Its target gets the stack quantity for stackable items. Hidden items can be recoloured
("Recolor menu hidden items") and made right-click only ("Deprioritize menu hidden items").
"Collapse ground item menu" merges identical entries into one, with ` x N` added.

## Other features

- **Despawn timer:** shows, for items whose despawn time is known, the time left in ticks or
  seconds after the label, or as a pie left of it. Green while the item is still private,
  then yellow.
- **Highlight tiles:** outlines each item's tile in the item's colour.
- **Notifications:** "Notify for highlighted drops" and "Notify tier" announce new drops in
  the chat. While the game is in the background, they also show a browser notification, once
  you have allowed them. The browser asks for permission at your next click after the first
  notification.
- **Loot beams:** a beam over a tile with a highlighted item ("Highlighted item lootbeams"),
  or with an item worth more than "Lootbeam tier", in the matching colour. The style is
  RuneLite's Modern or Light.

## Storage

Config group `grounditems`, with RuneLite's keys and enum names, and `highlight_<itemId>` for
per-item colours. Settings saved by the earlier version of this plugin are moved over once:
`rightClickHidden`, `valueCalculationMode` and `despawnTimerMode` are renamed, old enum values
become RuneLite's names, and colours saved without alpha become opaque.

## Differences from RuneLite

- **GE prices** come from this world's guide price table, not live trading prices. Until the
  table loads, the item's store value is shown.
- **Notifications** are a chat message plus a browser notification, not RuneLite's tray,
  sound and flash options.
- **Pick** uses the browser's colour picker. It keeps the colour's current alpha.
- **Loot beam lighting** goes through the client's graphics path, so brightness may differ
  slightly.
- The label height uses the tallest item model on the tile, not just the top three items, as
  the game does.
