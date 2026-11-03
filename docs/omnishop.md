# Omnishop

Jagex's shared reward shop interface: `omnishop_main` (819) with `omnishop_side` (806). The cache describes every omnishop in DB tables:

- `omnishop_shop_data` (39): name, stock rows, currencies, info title
- `omnishop_stock_data` (40): obj, cost pairs and modifiers, restricted, buyable, sellable, view-only, sold noted, transaction multiplier
- `omnishop_currency_data` (41): obj or none, names, graphic

The interface draws itself from those tables. `server/plugins/interface/Omnishop.plugin.js` opens a shop, keeps the selection varps and balances right, and does the buying and selling. Mixology Rewards, the Boat Emporium (`sailing_boat_shop`, Sailing's Buy-boat) and the Agility Arena Store (`agilityarena_rewards_newshop`, Pirate Jackie's Trade) use it. Other omnishops in the cache (Tithe Farm, Castle Wars, Bounty Hunter, Trouble Brewing, Forestry, abyssal pearls) can move onto it the same way.

## Plugging a shop in

| Event | Payload | Who answers |
| --- | --- | --- |
| `omnishop:open` | `{ player, shop }`, where `shop` is the DB row's gameval name | anyone opening it |
| `omnishop:currency` | `{ player, shop, currency, itemId, balance, set, inventoryCost? }` | the owner: set `balance` and a `set(value)`. Mixed saved/item balances can provide `inventoryCost(amount)`, the count of `itemId` removed from inventory by that payment, for capacity checks. No-obj currencies have no fallback owner; an obj currency is claimed only if the owner answers |
| `omnishop:describe` | `{ player, shop, stock, description }` | the owner: the info text, which the cache doesn't carry |
| `omnishop:can-buy` | `{ player, shop, stock, itemId, cancel, unlock }` | before payment: `cancel` refuses (the owner sends the message); `unlock` needs no inventory space |
| `omnishop:purchase` | `{ player, shop, stock, itemId, handled }` | after payment: `handled` means nothing is handed over |
| `omnishop:units` | `{ player, shop, stock, single }` | a transaction-multiplier-0 row buys one unit an order; the owner sets `single` false where live buys the clicked amount (the Agility Arena Store's Agility XP: rsprox 75, 1863, 4308) |
| `omnishop:can-sell` | `{ player, shop, stock, itemId, cancel }` | the owner can refuse sales; checked again on a sale and when deciding whether the side panel offers Sell |

A currency with an obj is that item in the inventory unless its owner claims it through
`omnishop:currency` (to keep it as a saved balance instead). Guardians of the Rift's abyssal
pearls are the item, so Felix's rows take them from the inventory.

## Protocol

From rsprox captures of Mixology Rewards (recordings 1107, 4182, 4210, 4234, 4235), other omnishops (4288) and the Boat Emporium (rev 241, docs/sailing-osrs-reference.md):

- **Open:** varps `omnishop_lastshop` (3874) = shop row and `omnishop_selected_id` (3869) = -1, then:
  - script `toplevel_mainmodal_background` [-1, -3]
  - both modals
  - `omnishop_main_init` [shop, -1, -1] and `omnishop_side_init` [shop]
  - events on `omnishop_main:list` (OP1-6, OP10), `omnishop_side:items` (OP1-6, OP10, DEPTH1, DRAGTARGET) and `omnishop_side:info_layer` (OP1)
- **List:** each entry is 12 components.
  - Op1 selects: varp 3869 = entry. The client draws the info panel and asks for its text with a script trigger on `trigger_request_info` [shop, entry] (zigzag varint ints). The server answers `omnishop_main_info_update` (9772) [shop, -1, entry, description, 1, 0, 1].
  - Until rev 238 the server sent `omnishop_main_info_setup` [shop, -1, entry, restricted ? 1 : -1, 0, first cost, stock row, description, true] on op1 instead.
  - Ops 2-5 buy 1/5/10/50, capped at `omnishop_stock_max_purchase`; op10 examines. `button_1`-`button_4` buy for the selected entry. The client also sends a `trigger_buy` trigger with each buy, which the plugin ignores so that a click buys once.
- **Buying:** each transaction takes each currency (one varp change per currency), gives the stock's transaction multiplier in items (at least one), and runs `omnishop_main_currency_redraw` [shop], unless the purchase closed the shop (a boat delivery). Sell-only and view-only entries cannot be bought. The stock's buy/sell modifier overrides the shop's; native cost procs 7261/7262 clamp the modifier to at least 100/1000. Free zero-cost entries remain free. Refusals:
  - "You don't have enough Lye resin." (the currency's name: resins have the same singular and plural, so the plugin uses the plural, as in "Coins")
  - "You cannot buy any more of that item." (a restricted item already owned)
  - "You don't have enough inventory space."
- **Selling (side panel):** op1 selects an inventory slot (varp 3870, `omnishop_side_info_setup` [slot, shop, 1, 0, sellable ? 1 : -1, entry or -1, description]). Ops 2-5 and the side buttons refund each currency at the cache's sell modifier (default 40%; Forestry 80%), then `omnishop_side_info_close`. A stock override takes precedence: Forestry eggs and whistles cost 75,000 bark and refund 250 bark. Capacity checks preview the payment or sale before changing inventory, including stack limits. Close Info sets 3870 back to -1.

Component ids move between revisions (`omnishop_main:list` was 819:34 in rev 238 and is 819:38 in 241), so the plugin looks them up by gameval name.

Not captured: the messages for an Ultimate Ironman buying a `restricted_uim` item and for selling an item the shop doesn't take.
