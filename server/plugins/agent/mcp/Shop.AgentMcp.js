// The open shop, by item name.
module.exports = function registerShopTools(ctx) {
  const { core, tool, z, player, find, items, inventorySlot, carried, clicks, clickEach, byName, amountSchema } = ctx;
  const { ShopManager, ItemDefinition } = core;
  const openShop = (p) => {
    const shop = ShopManager.getOpenShop(p);
    if (!shop) throw new Error("No shop is open; interact with a shopkeeper (option Trade) first");
    return {
      name: shop.name, currency: shop.currency,
      items: shop.stock.map((e, slot) => ({ ...e, slot, name: ItemDefinition.forId(e.itemId).getName() })),
    };
  };

  tool(
    "shop",
    "List the open shop's stock: name, amount in stock and price, plus the currency it trades in.",
    { player },
    ({ player: username }) => {
      const shop = openShop(find(username));
      return { ...shop, items: shop.items.map(({ name, amount, price }) => ({ name, amount, price })) };
    }
  );

  tool(
    "shop_buy",
    "Buy an item from the open shop by name.",
    { player, item: z.string().min(1), amount: z.number().int().min(1).default(1) },
    async ({ player: username, item: name, amount }) => {
      const entry = byName(openShop(find(username)).items, name, "the shop");
      const groupId = ShopManager.MAIN_INTERFACE_ID;
      return clickEach(username, clicks(amount, [50, 10, 5, 1]), (p, step) => {
        const current = openShop(p).items.find((e) => e.itemId === entry.itemId);
        if (!current) return null;
        return {
          type: "widget_action", widgetId: (groupId << 16) | 16, groupId, childId: 16,
          slot: current.slot + 1, itemId: current.itemId, buttonNum: 1, option: `Buy ${step}`,
        };
      });
    }
  );

  tool(
    "shop_sell",
    "Sell an inventory item to the open shop by name. amount is a number or \"all\".",
    { player, item: z.string().min(1), amount: amountSchema },
    async ({ player: username, item: name, amount }) => {
      const p = find(username);
      openShop(p);
      const itemId = p.getInventory().getItems()[inventorySlot(p, name)].getId();
      const total = carried(p, itemId);
      const groupId = ShopManager.SIDE_INTERFACE_ID;
      return clickEach(username, clicks(amount === "all" ? total : Math.min(amount, total), [50, 10, 5, 1]), (p, step) => {
        const slot = items(p.getInventory()).find((e) => e.id === itemId)?.slot;
        if (slot === undefined) return null;
        return { type: "widget_action", widgetId: groupId << 16, groupId, childId: 0, slot, itemId, buttonNum: 1, option: `Sell ${step}` };
      }, !ItemDefinition.forId(itemId).isStackable?.());
    }
  );
};
