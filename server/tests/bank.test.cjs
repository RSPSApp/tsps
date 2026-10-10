// Run after `yarn build`: node --test tests/bank.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");

const TRIDENT = 11907;
const LAVA_BATTLESTAFF = 3053;
const MYSTIC_LAVA_STAFF = 3054;
// In the cache this note belongs to 3053, not to 3054 (its id minus one).
const LAVA_BATTLESTAFF_NOTE = 3055;
const LAVA_BATTLESTAFF_PLACEHOLDER = 90053;

// Item definitions normally come from the cache; stub the few this test uses.
const DEFINITIONS = {
  [TRIDENT]: { name: "Trident of the seas" },
  [LAVA_BATTLESTAFF]: { name: "Lava battlestaff", placeholder: LAVA_BATTLESTAFF_PLACEHOLDER },
  [MYSTIC_LAVA_STAFF]: { name: "Mystic lava staff" },
  [LAVA_BATTLESTAFF_NOTE]: { name: "Lava battlestaff", stackable: true, noteOf: LAVA_BATTLESTAFF },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null" };
  return {
    getId: () => id,
    getName: () => def.name,
    isStackable: () => def.stackable === true,
    isNoted: () => def.noteOf != null,
    unNote: () => def.noteOf ?? id,
    getNoteId: () => -1,
    getPlaceholderId: () => def.placeholder ?? -1,
    isTradeable: () => true,
  };
};

function createPlayer() {
  // Every packet-sender call is a chainable no-op; sendVarbit also records.
  const varbits = [];
  const sender = new Proxy({}, {
    get: (_target, prop) =>
      prop === "sendVarbit"
        ? (id, value) => { varbits.push([id, value]); return sender; }
        : () => sender,
  });
  let currentTab = 0;
  const messages = [];
  const player = {
    varbits,
    messages,
    getUsername: () => "alice",
    sendMessage: (message) => messages.push(message),
    isSearchingBank: () => false,
    getPacketSender: () => sender,
    getStatus: () => (player.closed ? PlayerStatus.NONE : PlayerStatus.BANKING),
    insertModeReturn: () => player.insertMode === true,
    getInterfaceId: () => Bank.MAIN_INTERFACE_ID,
    getCurrentBankTab: () => currentTab,
    setCurrentBankTab: (tab) => { currentTab = tab; },
    withdrawAsNote: () => false,
    isPlaceholders: () => player.placeholders === true,
    isPlayerBot: () => false,
    getBankCustomQuantity: () => 0,
    getBankQuantityMode: () => 0,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => new Bank(player).resetItems());
  player.getInventory = () => player.inventory;
  player.getBank = (tab = 0) => player.banks[tab];
  player.setBank = (tab, bank) => { player.banks[tab] = bank; };
  return player;
}

test("depositing a note banks the item it notes, not the item before it", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 2), false);

  player.getInventory().switchItem(player.getBank(), new Item(LAVA_BATTLESTAFF_NOTE, 2), false, 0, false);

  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 2);
  assert.equal(player.getBank().getAmount(MYSTIC_LAVA_STAFF), 0);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
});

test("depositing everything banks notes as the item they note", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 3), false);
  const item = player.getInventory().getValidItems()[0];

  // What Deposit inventory does for each inventory item.
  player.getInventory().switchItems(player.getBank(), item.clone(), false, false);

  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 3);
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
  assert.equal(player.getInventory().getAmount(LAVA_BATTLESTAFF_NOTE), 0);
});

function metas(container) {
  return container.getValidItems().map((item) => [item.getAmount(), item.getMeta()]);
}

test("depositing items keeps each one's metadata", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(TRIDENT, 1, { charges: 5 }), false);
  player.getInventory().add(new Item(TRIDENT, 1, { charges: 1200 }), false);

  Bank.deposit(player, TRIDENT, 1, 2, true);

  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 1200 }], [1, { charges: 5 }]]);
  assert.equal(player.getInventory().getValidItems().length, 0);
});

test("inventory bank options count matching unnoted items across slots", () => {
  for (const [buttonNum, option, custom, mode, expected] of [
    [8, "Deposit-All", 0, 0, 4],
    [7, "Deposit-X", 3, 0, 3],
    [7, undefined, 3, 0, 3],
    [4, "Deposit-5", 0, 0, 4],
    [5, "Deposit-10", 0, 0, 4],
    [2, undefined, 3, 3, 3],
    [2, undefined, 0, 4, 4],
    [1, "Deposit-1", 0, 0, 1],
  ]) {
    const player = createPlayer();
    player.getBankCustomQuantity = () => custom;
    player.getBankQuantityMode = () => mode;
    for (const charges of [5, 20, 100, 1200]) {
      player.getInventory().add(new Item(TRIDENT, 1, { charges }), false);
    }
    player.getInventory().add(new Item(LAVA_BATTLESTAFF, 1), false);

    Bank.handleWidgetAction(player, {
      groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_ITEMS_CHILD,
      buttonNum, option, slot: 3, itemId: TRIDENT,
    });

    assert.equal(player.getBank().getAmount(TRIDENT), expected);
    assert.equal(player.getInventory().getAmount(TRIDENT), 4 - expected);
    assert.equal(player.getInventory().getAmount(LAVA_BATTLESTAFF), 1);
    assert.deepEqual(player.getBank().getValidItems()[0].getMeta(), { charges: 1200 });
  }
});

test("Deposit-X still moves a partial noted stack", () => {
  const player = createPlayer();
  player.getBankCustomQuantity = () => 3;
  player.getInventory().add(new Item(LAVA_BATTLESTAFF_NOTE, 7), false);
  Bank.handleWidgetAction(player, {
    groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_ITEMS_CHILD,
    buttonNum: 7, option: "Deposit-X", slot: 0, itemId: LAVA_BATTLESTAFF_NOTE,
  });
  assert.equal(player.getBank().getAmount(LAVA_BATTLESTAFF), 3);
  assert.equal(player.getInventory().getAmount(LAVA_BATTLESTAFF_NOTE), 4);
});

test("withdrawing an item keeps its metadata", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(TRIDENT, 1, { charges: 1200 }), false);

  Bank.withdraw(player, TRIDENT, 0, 1, 0);

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 1200 }]]);
  assert.equal(player.getBank(0).getAmount(TRIDENT), 0);
});

test("a full bank tab refuses the item instead of throwing", () => {
  const player = createPlayer();
  const bank = player.getBank(0);
  for (let slot = 0; slot < bank.capacity(); slot++) bank.add(new Item(20000 + slot, 1), false);
  player.getInventory().add(new Item(TRIDENT, 1), false);

  assert.doesNotThrow(() => player.getInventory().switchItem(bank, new Item(TRIDENT, 1), false, 0, false));

  assert.ok(player.messages.includes("Not enough space in bank."));
  assert.equal(player.getInventory().getAmount(TRIDENT), 1);
});

function bankTwoTridents(player) {
  player.getBank(0).add(new Item(TRIDENT, 1, { charges: 5 }), false);
  player.getBank(0).add(new Item(TRIDENT, 1, { charges: 1200 }), false);
}

test("withdrawing takes the stack that was clicked, not the first with that item", () => {
  const player = createPlayer();
  bankTwoTridents(player);

  Bank.handleWidgetAction(player, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: 12, buttonNum: 1, option: "Withdraw-1", slot: 1, itemId: TRIDENT,
  });

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 1200 }]]);
  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 5 }]]);
});

test("withdrawing never takes more than the clicked stack holds", () => {
  const player = createPlayer();
  bankTwoTridents(player);

  Bank.withdraw(player, TRIDENT, 0, 2, 0);

  assert.deepEqual(metas(player.getInventory()), [[1, { charges: 5 }]]);
  assert.deepEqual(metas(player.getBank(0)), [[1, { charges: 1200 }]]);
});

test("the client layout lists tabs 1-9 before the main tab", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(LAVA_BATTLESTAFF, 1), false);
  player.getBank(2).add(new Item(TRIDENT, 1), false);
  player.getBank(1).add(new Item(MYSTIC_LAVA_STAFF, 1), false);

  assert.deepEqual(
    Bank.layout(player).map(({ tab, item }) => [tab, item.getId()]),
    [[1, MYSTIC_LAVA_STAFF], [2, TRIDENT], [0, LAVA_BATTLESTAFF]],
  );
  assert.equal(Bank.resolveDisplaySlot(player, 2).item.getId(), LAVA_BATTLESTAFF);
});

test("withdrawing everything leaves the item's faded cache placeholder", () => {
  const player = createPlayer();
  player.placeholders = true;
  player.getBank(0).add(new Item(LAVA_BATTLESTAFF, 1), false);

  Bank.withdraw(player, LAVA_BATTLESTAFF, 0, 1, 0);

  const [entry] = Bank.layout(player);
  assert.equal(entry.item.getAmount(), 0);
  assert.equal(Bank.displayItemId(entry.item), LAVA_BATTLESTAFF_PLACEHOLDER);
});

test("an item without a cache placeholder leaves none", () => {
  const player = createPlayer();
  player.placeholders = true;
  player.getBank(0).add(new Item(TRIDENT, 1), false);

  Bank.withdraw(player, TRIDENT, 0, 1, 0);

  assert.deepEqual(Bank.layout(player), []);
});

test("clicking Release on a placeholder removes it; other options leave it", () => {
  const player = createPlayer();
  player.getBank(0).add(new Item(LAVA_BATTLESTAFF, 0), false);
  const click = (option, buttonNum) => Bank.handleWidgetAction(player, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: 12, buttonNum, option, slot: 0, itemId: LAVA_BATTLESTAFF_PLACEHOLDER,
  });

  click("Withdraw-1", 1);
  assert.equal(Bank.layout(player).length, 1);

  click("Release", 8);
  assert.deepEqual(Bank.layout(player), []);
});

function clickTab(player, tab, buttonNum, option) {
  Bank.handleWidgetAction(player, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.TABS_CHILD, buttonNum, option, slot: Bank.TAB_BUTTON_SLOT_OFFSET + tab,
  });
}

function tabsOf(player) {
  return Bank.layout(player).map(({ tab, item }) => [tab, item.getId(), item.getAmount()]);
}

test("clicking a tab views it; clicking the empty slot after the last tab explains how to make one", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);

  clickTab(player, 1, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);

  clickTab(player, 2, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);
  assert.ok(player.messages.includes("To create a new tab, drag an item here."));
});

test("collapsing a tab moves its items and placeholders into the main tab and shifts later tabs down", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1, { charges: 1200 }), false);
  player.getBank(1).add(new Item(LAVA_BATTLESTAFF, 0), false);
  player.getBank(2).add(new Item(MYSTIC_LAVA_STAFF, 3), false);

  clickTab(player, 1, 6, "Collapse tab");

  assert.deepEqual(tabsOf(player), [[1, MYSTIC_LAVA_STAFF, 3], [0, TRIDENT, 1], [0, LAVA_BATTLESTAFF, 0]]);
  assert.deepEqual(player.getBank(0).getValidItems()[0].getMeta(), { charges: 1200 });
});

test("removing placeholders from a tab leaves other tabs' placeholders", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(LAVA_BATTLESTAFF, 0), false);
  player.getBank(1).add(new Item(TRIDENT, 1), false);
  player.getBank(0).add(new Item(MYSTIC_LAVA_STAFF, 0), false);

  clickTab(player, 1, 7, "Remove placeholders");

  assert.deepEqual(tabsOf(player), [[1, TRIDENT, 1], [0, MYSTIC_LAVA_STAFF, 0]]);
});

const BANK_ITEMS = (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD;
const BANK_TABS = (Bank.MAIN_INTERFACE_ID << 16) | Bank.TABS_CHILD;
const SIDE_ITEMS = (Bank.SIDE_INTERFACE_ID << 16) | Bank.SIDE_ITEMS_CHILD;
const A = MYSTIC_LAVA_STAFF, B = LAVA_BATTLESTAFF, C = TRIDENT;

function drag(player, sourceWidgetId, sourceSlot, sourceItemId, targetWidgetId, targetSlot) {
  return Bank.handleDrag(player, { sourceWidgetId, sourceSlot, sourceItemId, targetWidgetId, targetSlot });
}

function bankOf(player, ...tabs) {
  tabs.forEach((ids, tab) => ids.forEach((id) => player.getBank(tab).add(new Item(id, 1), false)));
}

test("dragging a bank item onto another swaps them, or inserts in insert mode", () => {
  const swapping = createPlayer();
  bankOf(swapping, [A, B, C]);
  drag(swapping, BANK_ITEMS, 0, A, BANK_ITEMS, 2);
  assert.deepEqual(tabsOf(swapping).map(([, id]) => id), [C, B, A]);

  const inserting = createPlayer();
  inserting.insertMode = true;
  bankOf(inserting, [A, B, C]);
  drag(inserting, BANK_ITEMS, 0, A, BANK_ITEMS, 2);
  assert.deepEqual(tabsOf(inserting).map(([, id]) => id), [B, C, A]);
});

test("dragging a bank item onto a tab button moves it there, creating at most one new tab", () => {
  const player = createPlayer();
  bankOf(player, [A, B]);

  drag(player, BANK_ITEMS, 0, A, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET + 5);
  assert.deepEqual(tabsOf(player), [[1, A, 1], [0, B, 1]]);

  drag(player, BANK_ITEMS, 0, A, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET);
  assert.deepEqual(tabsOf(player), [[0, B, 1], [0, A, 1]]);
});

test("dragging a bank item onto another tab's item joins that tab", () => {
  const player = createPlayer();
  player.insertMode = true;
  bankOf(player, [C], [A, B]);

  drag(player, BANK_ITEMS, 2, C, BANK_ITEMS, 0);

  assert.deepEqual(tabsOf(player), [[1, C, 1], [1, A, 1], [1, B, 1]]);
});

test("dragging an inventory item onto a tab deposits it there, or onto its existing stack", () => {
  const player = createPlayer();
  bankOf(player, [A]);
  player.getInventory().add(new Item(B, 1), false);
  player.getInventory().add(new Item(A, 1), false);

  drag(player, SIDE_ITEMS, 0, B, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET + 1);
  drag(player, SIDE_ITEMS, 1, A, BANK_TABS, Bank.TAB_BUTTON_SLOT_OFFSET + 1);

  assert.deepEqual(tabsOf(player), [[1, B, 1], [0, A, 2]]);
  assert.equal(player.getInventory().getValidItems().length, 0);
});

test("dragging within the bank's inventory panel swaps inventory slots", () => {
  const player = createPlayer();
  player.getInventory().add(new Item(A, 1), false);
  player.getInventory().add(new Item(B, 1), false);

  drag(player, SIDE_ITEMS, 0, A, SIDE_ITEMS, 1);

  assert.deepEqual(player.getInventory().getValidItems().map((item) => item.getId()), [B, A]);
});

test("bank drags are ignored while the bank is closed", () => {
  const player = createPlayer();
  bankOf(player, [A, B]);
  player.closed = true;

  assert.equal(drag(player, BANK_ITEMS, 0, A, BANK_ITEMS, 1), false);
  assert.deepEqual(tabsOf(player).map(([, id]) => id), [A, B]);
});

test("depositing keeps the tab being viewed", () => {
  const player = createPlayer();
  bankOf(player, [A], [B]);
  player.getInventory().add(new Item(B, 1), false);

  Bank.deposit(player, B, 0, 1, true);

  assert.equal(player.getCurrentBankTab(), 0);
  assert.equal(player.getBank(1).getAmount(B), 2);
});

test("in swap mode, dragging onto another tab's item trades their places and tabs", () => {
  const player = createPlayer();
  bankOf(player, [C], [A, B]);

  drag(player, BANK_ITEMS, 2, C, BANK_ITEMS, 0);

  assert.deepEqual(tabsOf(player), [[1, C, 1], [1, B, 1], [0, A, 1]]);
});

test("dragging onto the empty space after a tab's items moves the item to the end of that tab", () => {
  const player = createPlayer();
  bankOf(player, [C], [A, B]);

  drag(player, BANK_ITEMS, 2, C, BANK_ITEMS, Bank.TAB_DROP_SLOT_OFFSET + 1);

  assert.deepEqual(tabsOf(player), [[1, A, 1], [1, B, 1], [1, C, 1]]);
});

/** A player whose packet sender records client scripts. */
function recordingPlayer() {
  const player = createPlayer();
  const scripts = [];
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      if (name === "sendClientScript") scripts.push(args);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  player.scripts = scripts;
  return player;
}

test("as captured: picking a tab, on the tab bar or a tab heading, ends the bank search", () => {
  const player = recordingPlayer();
  for (const tab of [1, 2, 3]) player.getBank(tab).add(new Item(TRIDENT, 1), false);
  clickTab(player, 1, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);
  assert.deepEqual(player.scripts, [[101, 11]], "meslayer_close for the bank search input");
  // The all-items view's tab headings are bankmain:items slots 1419-1427 (tabs 1-9).
  player.scripts.length = 0;
  Bank.handleWidgetAction(player, { groupId: Bank.MAIN_INTERFACE_ID, childId: 12, buttonNum: 1, slot: 1421 });
  assert.equal(player.getCurrentBankTab(), 3);
  assert.deepEqual(player.scripts, [[101, 11]]);
});

test("as captured: Search switches to the main tab", () => {
  const player = recordingPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);
  clickTab(player, 1, 1, "View tab");
  Bank.handleWidgetAction(player, { groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.SEARCH_CHILD, buttonNum: 1 });
  assert.equal(player.getCurrentBankTab(), 0);
});

test("as captured: closing the bank by any route ends a bank search; closing anything else does not", () => {
  const { PacketSender } = require("../dist/net/packet/PacketSender");
  // sendInterfaceRemoval: the bank's own close; closeInterruptibleInterfaces: the X (IF_CLOSE)
  // and walking away.
  for (const route of ["sendInterfaceRemoval", "closeInterruptibleInterfaces"]) {
    const close = (interfaceId) => {
      const player = recordingPlayer();
      PacketSender.prototype[route].call({
        player,
        resetInterfaceState: () => interfaceId,
        closeTrackedInterfaces: () => true,
        sendSubInterface: () => {},
        endBankSearch: PacketSender.prototype.endBankSearch,
        emitInterfaceClosed: () => {},
      });
      return player.scripts;
    };
    assert.deepEqual(close(Bank.MAIN_INTERFACE_ID), [[101, 11]], route);
    assert.deepEqual(close(300), [], route);
  }
});

const bankTabsSent = (player) => player.varbits.filter(([id]) => id === 4150);

test("moving items does not re-send the viewed tab, so the client's own tab stays", () => {
  const player = createPlayer();
  bankOf(player, [TRIDENT], [LAVA_BATTLESTAFF]);
  // The bank's tab buttons are handled by the client (it sets BANK_CURRENTTAB
  // itself), so the server's current tab can be stale while the player views
  // another tab. A refresh must not drag them back to it.
  Bank.withdraw(player, LAVA_BATTLESTAFF, 0, 1, 1);

  assert.equal(player.getBank(1).getAmount(LAVA_BATTLESTAFF), 0);
  assert.deepEqual(bankTabsSent(player), []);
});

test("viewing a tab for the client sends BANK_CURRENTTAB", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);

  clickTab(player, 1, 1, "View tab");
  assert.equal(player.getCurrentBankTab(), 1);
  assert.deepEqual(bankTabsSent(player), [[4150, 1]]);
});

test("collapsing the viewed tab sends the main tab", () => {
  const player = createPlayer();
  player.getBank(1).add(new Item(TRIDENT, 1), false);
  clickTab(player, 1, 1, "View tab");
  player.varbits.length = 0;

  clickTab(player, 1, 6, "Collapse tab");
  assert.equal(player.getCurrentBankTab(), 0);
  assert.deepEqual(bankTabsSent(player), [[4150, 0]]);
});

test("bank item slots get the captured events: ops 1-10, depth 2, drag target, target, and no pause button", () => {
  const flags = Bank.ITEM_SLOT_FLAGS;
  assert.equal(flags & 1, 0, "no pause button: an empty slot must not offer Continue");
  for (let op = 1; op <= 10; op++) assert.ok(flags & (1 << op), `op${op}`);
  assert.equal((flags >> 17) & 7, 2, "depth 2");
  assert.ok(flags & (1 << 20), "drag target");
  assert.ok(flags & (1 << 21), "target");
  assert.equal(flags, 3409918);
});
