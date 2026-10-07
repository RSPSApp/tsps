// The open bank, by item name.
module.exports = function registerBankTools(ctx) {
  const {
    core, tool, z, player, find, send, status, sleepTicks, inventorySlot, carried, clickEach, byName, amountSchema,
  } = ctx;
  const { Bank, ItemDefinition } = core;
  // `slot` is the display slot bank widget actions use; placeholders keep theirs but are left out.
  const bankEntries = (p) => {
    if (!Bank.isOpen(p)) throw new Error("The bank is not open; interact with a Bank booth or Banker (option Bank) first");
    return Bank.layout(p).map(({ item }, slot) => ({
      slot, id: item.getId(), name: ItemDefinition.forId(item.getId()).getName(), amount: item.getAmount(),
      itemId: Bank.displayItemId(item),
    })).filter((e) => e.amount > 0);
  };

  tool(
    "bank",
    "List the items in the open bank (name, amount).",
    { player },
    ({ player: username }) => bankEntries(find(username)).map(({ name, amount }) => ({ name, amount }))
  );

  tool(
    "bank_withdraw",
    "Withdraw an item from the open bank by name. amount is a number or \"all\".",
    { player, item: z.string().min(1), amount: amountSchema },
    async ({ player: username, item: name, amount }) => {
      const p = find(username);
      const entry = byName(bankEntries(p), name, "the bank");
      const all = amount === "all" || amount >= entry.amount;
      // With the bank open, an entered amount becomes the X quantity, as when the client answers Withdraw-X.
      return clickEach(username, all ? ["All"] : ["amount", "X"], (p, step) => step === "amount"
        ? { type: "dialogue_amount", amount }
        : {
          type: "widget_action", widgetId: (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD, groupId: Bank.MAIN_INTERFACE_ID,
          childId: Bank.ITEMS_CHILD, slot: entry.slot, itemId: entry.itemId, buttonNum: 1, option: `Withdraw-${step}`,
        });
    }
  );

  tool(
    "bank_deposit",
    "Deposit an inventory item into the open bank by name (amount is a number or \"all\"), or everything in the inventory when item is omitted.",
    { player, item: z.string().min(1).optional(), amount: amountSchema },
    async ({ player: username, item: name, amount }) => {
      const p = find(username);
      bankEntries(p);
      const groupId = Bank.MAIN_INTERFACE_ID;
      if (name === undefined) {
        send(p, { type: "widget_action", widgetId: (groupId << 16) | Bank.DEPOSIT_INVENTORY_CHILD, groupId, childId: Bank.DEPOSIT_INVENTORY_CHILD, buttonNum: 1 });
        await sleepTicks(1);
        return status(find(username));
      }
      const slot = inventorySlot(p, name);
      const itemId = p.getInventory().getItems()[slot].getId();
      const all = amount === "all" || amount >= carried(p, itemId);
      return clickEach(username, all ? ["All"] : ["amount", "X"], (p, step) => step === "amount"
        ? { type: "dialogue_amount", amount }
        : {
          type: "widget_action", widgetId: (Bank.SIDE_INTERFACE_ID << 16) | Bank.SIDE_ITEMS_CHILD, groupId: Bank.SIDE_INTERFACE_ID,
          childId: Bank.SIDE_ITEMS_CHILD, slot, itemId, buttonNum: 1, option: `Deposit-${step}`,
        });
    }
  );
};
