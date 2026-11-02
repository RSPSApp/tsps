# Bank

The value parts of RuneLite's core Bank plugin (`net.runelite.client.plugins.bank`, BSD-2) at
RuneLite 1.13.3. It's on by default, as in RuneLite. Its config group (`bank`) and keys are
RuneLite's: `showGE`, `showHA`, `showExact`.

## What it does

- **Bank value in the title.** After `[clientscript,bankmain_build]` runs, the title gets the total
  value of the items the bank shows, as RuneLite writes it:
  - `The Bank of Gielinor (1.23M)` with only the Grand Exchange price on (the default).
  - `(GE: 1.23M) (HA: 456K)` with both on; `(1,234,567)` with "Show exact bank value".
  - The total is of the items in view, so a search or a tag tab shows that selection's value
    (`Tag tab melee (3M)`). Placeholders count for nothing.
- **Value searches.** RuneLite's search syntax, through the patched `bankmain_filteritem`'s
  `bankSearchFilter` callback:
  - `ge>1m`, `ha<50k`, `alch>=100k`, `qty=1`: a stack's value or quantity against a number.
  - `100k-1m`: a range; GE is the default mode.
  - `i`, `iv`, `per` or `individual` after the mode compares one item's price, not the stack's:
    `ge i>1m`.

## Prices

- GE is the server's guide price (`/api/item-prices`) of the unnoted item, as Ground Items and
  Item Rarity use it. An item without a quote is worth 0, as an untradeable is in RuneLite.
- HA is 60% of the item's store price, floored (`ItemComposition.getHaPrice`).
- Coins are 1 gp and platinum tokens 1,000 gp at either price.
- The guide prices load after login. A bank built before they arrive is laid out again when they
  do.

## Not ported

| RuneLite | Reason |
|---|---|
| Disable left-click bank inventory / equipment / loot | Not value features; left for a later port. |
| Keyboard bank pin | No bank pins offline. |
| Seed vault and group storage values | The seed vault and group storage aren't built offline. |
| `ItemMapping` prices for untradeable variants (degraded Barrows and the like) | The guide price table has no mapping; those count for 0. |
| Laying the bank out early when the search text changes | Not a value feature; left for a later port. |
