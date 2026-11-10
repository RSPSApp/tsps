# Shop pricing

How a shop prices what players buy from it and sell to it. Code: `ShopManager.ts`
(`ratedBuyPrice`, `ratedSellPrice`, `affordablePrices`); data: the `sellsAt`, `buysAt` and
`changePer` fields of `server/data/definitions/shops.json`, written by
`server/scripts/import-osrs-shops.mjs` from the osrsreboxed shop dump.

## The rule

Every Wiki store page's StoreTableHead gives three figures, each per mille of the item's value
([Wiki: Shop § Pricing](https://oldschool.runescape.wiki/w/Shop#Pricing)):

| Field | Wiki | Meaning |
| --- | --- | --- |
| `sellsAt` | Sells at | What a player pays at the normal stock |
| `buysAt` | Buys at | What a player is paid at the normal stock |
| `changePer` | Change per | How far either price moves for each item above or below the normal stock |

With `n` = the shop's stock minus its normal stock (the listed stock; 0 for an item it doesn't list):

- **Buying one** costs `floor(value × (sellsAt − changePer × n) / 1000)`, at least 1 coin, 10% of
  value and `sellsAt − 1000`, at most `sellsAt + 5000`.
- **Selling one** pays `floor(value × (buysAt − changePer × n) / 1000)`, at least 10% of value,
  at most `value + buysAt`.
- Several at once: each item is priced at the stock it leaves or joins. A purchase stops at the
  last item the player can pay for.

The rounding and bounds are those of the Wiki's
[Shop calculator](https://oldschool.runescape.wiki/w/Calculator:Shop_calculator)
(`Module:Shop calculator`). Its overstocked purchase price divides by the rate instead of
subtracting from it; the Shop page's worked example (a steel axe at 4 in stock costs 196,
"98%") and its text describe the linear rule used here. The two agree at a 100% sell rate.

## Which shops

- **Coins, tokkul and trading sticks** are priced by value, so the rates set both prices.
- **Per-item prices** (`price` in a stock row, a shop's `prices` map) are the purchase price as
  they stand. Selling still pays the buy rate of the item's value.
- **Reward currencies** (marks of grace, stardust, points) keep their per-item prices. A positive
  `buysAt` makes the shop buy its own stock back at that share of the price (#3912).
- **Shops without the figures** (the legacy core shops, most pubs) sell at value and pay 85%.
- Content still has the last word through `shop:buy-price` and `shop:sell-price`.

## Karamja gloves

Thirteen Karamja shops have a second version, "(Karamja gloves)", with better rates for players
wearing the gloves ([Wiki: Karamja gloves](https://oldschool.runescape.wiki/w/Karamja_gloves)).
Any tier works for most of them; Jiminua's Jungle Store and the Karamja General Store need
gloves 3 or 4. Both versions are bound to the same NPC option. The DiaryRewards plugin's
`KaramjaGloves.DiaryRewards.js` picks the version through `npc-dialogue:shop`. Gabooty's two
shops are picked by the Tai Bwo Wannai Cleanup plugin.

The two versions are one shop with one stock; the gloves change only its prices. The same unit
registers `ShopManager.shareStock`, so each gloves version (Gabooty's included) shows and trades
its Default version's stock, and a purchase at either moves both prices.

## Evidence

- rsprox captures: an uncut onyx costs 300,000 tokkul at the Mor Ul Rek gem stores (150%,
  recordings 83 and 3276) and 260,000 wearing the gloves (130%, recording 73). In the same
  recording a chaos rune sells for 31 tokkul (35% of 90). Uncut gems cost 1.5× their value
  rounded down (an uncut sapphire 37, recording 3276).
- rsprox captures: Hur-Lek's, Hur-Rin's, Hur-Tel's and Mej-Roh's stores open the same shop
  inventory with and without Karamja gloves worn (recordings 73, 91, 96, 1768, 1863, 3276).
- rsprox captures: Gabooty's red topaz costs 240 trading sticks and sells for 120 (120% / 60%,
  recordings 1102 and 1858).
