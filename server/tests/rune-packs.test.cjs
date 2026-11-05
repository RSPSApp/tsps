const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");

before(() => {
  CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/items/OpenableItems.plugin").register(PluginManager.createApi("OpenableItems"));
});

function playerWith(pack, full = false) {
  const messages = [];
  const player = {
    getPacketSender: () => ({ sendItemContainer() {}, sendInterfaceRemoval() {}, sendSound() {} }),
    sendMessage: text => messages.push(text),
    isTeleportingReturn: () => false,
    getHitpoints: () => 10,
    messages,
  };
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  if (full) for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new Item(526, 1));
  inventory.setItem(7, new Item(pack, 1));
  return player;
}

test("all six shop packs Open through the packet handler, using the freed slot in a full bag", () => {
  for (const [pack, rune] of [[12728, 556], [12730, 555], [12732, 557], [12734, 554], [12736, 558], [12738, 562]]) {
    const player = playerWith(pack, true);
    assert.deepEqual(ItemActionPacketListener.resolveInventoryWidgetAction(pack, 2), { optionIndex: 1, option: "Open" });
    assert.equal(ItemActionPacketListener.handleFirstAction(player, Inventory.INTERFACE_ID, pack, 7, "Open"), true);
    assert.equal(player.getInventory().getAmount(pack), 0);
    assert.equal(player.getInventory().getAmount(rune), 100);
    assert.equal(player.getInventory().getFreeSlots(), 0);
    assert.equal(player.getInventory().getAmount(526), 27);
    assert.equal(ItemDefinition.forId(pack).getEquipmentType().getSlot(), -1);
    assert.equal(ItemDefinition.forId(pack + 1).getEquipmentType().getSlot(), -1, "noted packs cannot equip either");
  }
});

test("Open merges a rune stack, and preserves the clicked pack and stack at the amount limit", () => {
  const player = playerWith(12728, true);
  player.getInventory().setItem(0, new Item(556, 20));
  ItemActionPacketListener.handleFirstAction(player, Inventory.INTERFACE_ID, 12728, 7, "Open");
  assert.equal(player.getInventory().getAmount(556), 120);
  player.getInventory().setItem(7, new Item(12728, 1));
  const pack = player.getInventory().forSlot(7);
  player.getInventory().setItem(0, new Item(556, 2147483600));
  ItemActionPacketListener.handleFirstAction(player, Inventory.INTERFACE_ID, 12728, 7, "Open");
  assert.equal(player.getInventory().forSlot(7), pack);
  assert.equal(pack.getId(), 12728);
  assert.equal(player.getInventory().getAmount(12728), 1);
  assert.equal(player.getInventory().getAmount(556), 2147483600);
  assert.match(player.messages.at(-1), /enough inventory space/);
});

test("noted packs have no Open action; an invalid packet cannot consume a different slot", () => {
  assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(12729, 2), null);
  const player = playerWith(12728);
  assert.equal(ItemActionPacketListener.handleFirstAction(player, Inventory.INTERFACE_ID, 12728, 8, "Open"), false);
  assert.equal(player.getInventory().getAmount(12728), 1);
});
