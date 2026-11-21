# Grand Exchange

Plugin: `server/plugins/interface/GrandExchange.plugin.js` (offers, collection, history), with
`grandexchange/Sets.GrandExchange.js` and `grandexchange/Prices.GrandExchange.js`.

## Modify offer

The offer details screen has Abort (465:23, dynamic child 0) and Modify (dynamic child 1). The
Wiki's Grand Exchange page does not describe Modify, so this follows rsprox captures: local
recordings 1001438 (ticks 10289-16394, 18 modifies of sell offers) and 1001441 (ticks 3620-7230,
15 modifies of buy and sell offers), revision 241.

- Tick 0: `popuploading` (916) opens as an overlay on `ge_offers:contents` (465:1), with script
  7882 (`popuploading`: 916:1, 916:2, 916:4) and script 4217 (`loading_icon_init`: 916:6, 916:7,
  enum 3787, 10, 1000, 3000, 512, 1024, 0, 3, "Please wait..."). The offer stops trading.
- Tick 1: the offer's input shows in its collection slot.
- Tick 2: the input moves to the inventory, as Collect-all hands it over: a sell's items as notes
  from two up and as the item when there is one, a buy's coins. The collect sound plays (3928 for
  items, 3924 for coins); no game message is sent. The popup closes and the setup screen opens on
  the same slot with the offer's item, quantity and price (`ge_newoffer_price` is sent with the
  guide price first, then the offer's own price), ready to change and confirm as a new offer.

Ours (no recording covers them): an exchange closed during the two ticks, or an inventory without
room for the input, leaves the stopped offer in its collection slot, as Abort does. Modify on an
offer that has already completed answers with Abort's "That offer has already completed."
