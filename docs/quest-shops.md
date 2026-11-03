# Quest-gated shops and the Lost Property shop

Issue 1971. Every way into a shop (Trade, a dialogue's `open_shop` step, a plugin) goes through
`ShopManager.open`, so gates sit there and on the stock list, not on each NPC's options.

## Shops that wait for a quest

`server/plugins/quests/Shops.Quests.js`, from `server/plugins/quests/data/quest-shops.json` (OSRS
Wiki shop and owner pages):

- `shops`: a shop that won't trade until the quest is complete (`started`: once it is started),
  and, where listed, while the player isn't carrying an item (Mos Le'Harmless wants the Book o'
  Piracy). The refusal is the Wiki's own: the trader's line (Transcript:<NPC>, "Trying to trade"),
  a box, or a game message ("Only Fremenniks may purchase fish here."). A shop with no recorded
  refusal says "You need to complete <quest> to trade here." (ours).
- `stock`: items a shop sells only after a quest (the Quartermaster's dragon halberd, Regicide).
  They are hidden, so they take no slot.
- `versions`: shop versions whose names don't name their quest ("Battle Runes (Post-miniquest)",
  Enter the Abyss), picked for `npc-dialogue:shop`.

A quest this server doesn't have leaves its shop open, as `Equipment.Quests.js` does for
equipment. Player bots are never gated.

## Shop versions on Trade

When several shops.json shops share one NPC option (Daga's Default and Monkey Madness I smithies,
Raetul's Before/After Contact! stores, Baba Yaga's two Lunar Diplomacy shops, Battle Runes),
Shopkeepers gives the option no fixed binding. Trade now asks `npc-dialogue:shop` which version
applies (QuestRuntime answers "(After X)"-style names), else opens the Default version, as an
`open_shop` dialogue step does. With neither, the option stays unhandled. Razmire's two different
shops share his Trade with no Default, so his Trade still opens nothing.

## Lost Property shop

`server/plugins/npcs/LostProperty.plugin.js`, from `server/plugins/npcs/data/lost-property.json`
(Wiki: Lost Property shop, Perdu, and each item's page):

- A row shows only once it is unlocked: its quest or miniquest is complete (Boots of lightness:
  Temple of Ikov started), a god cape came from the Mage Arena statues, the collection log has the
  item (Colossal blade, Thread of Elidinis), or, for the diary rows, a tier's reward was claimed.
  Rows whose quest or miniquest this server doesn't have (Curse of the Empty Lord, Mage Arena II)
  stay hidden.
- A row also hides while the player owns one (inventory, worn or bank), unless the item is on the
  Wiki's exceptions list (diary rewards, god capes and books, Ava's devices, and so on).
- Rows without multiples sell one per purchase.
- The diary rows are display items; each sells the highest claimed tier of its diary's reward.
- Prices are the Wiki's, from `SHOP_PRICES` in `server/scripts/import-osrs-shops.mjs`.
- Perdu buys nothing back.

Not done: paying from the bank when the inventory has too few coins, and items stored in the
player-owned house counting as owned.

## Events

| Event | Payload | Emitted by |
| --- | --- | --- |
| `shop:stock-visible` | `{ player, shopId, shopName, itemId, visible }` | `ShopManager`, for each stock row a player sees and before a purchase |
| `collection-log:obtained` | `{ player, itemId, count }` | asked of the CollectionLog plugin |
| `mage-arena:cape-received` | `{ player, received }` | asked of the Mage Arena statues |
