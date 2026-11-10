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
(`Module:Shop calculator`). For an overstocked purchase the calculator divides instead
(value ÷ (sell rate + change per × extra items)); live OSRS subtracts, as the Shop page's text
says (see Evidence).

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

- Checked on live OSRS: Bob's Brilliant Axes sells steel axes (value 200) for 200, 204 and 208
  as his stock falls from 3 to 1. The Lumbridge General Store buys them for 80, 74 and 68 as
  its stock rises from 0 to 2, then sells them for 242, 248 and 254 at 3, 2 and 1 in stock
  (130% − 3% per item; the calculator's division would give 143, 147 and 150).
- rsprox captures: an uncut onyx costs 300,000 tokkul at the Mor Ul Rek gem stores (150%,
  recordings 83 and 3276) and 260,000 wearing the gloves (130%, recording 73). In the same
  recording a chaos rune sells for 31 tokkul (35% of 90). Uncut gems cost 1.5× their value
  rounded down (an uncut sapphire 37, recording 3276).
- rsprox captures: Hur-Lek's, Hur-Rin's, Hur-Tel's and Mej-Roh's stores open the same shop
  inventory with and without Karamja gloves worn (recordings 73, 91, 96, 1768, 1863, 3276).
- rsprox captures: Gabooty's red topaz costs 240 trading sticks and sells for 120 (120% / 60%,
  recordings 1102 and 1858).
