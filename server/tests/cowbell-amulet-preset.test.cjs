// Run after `yarn build`: node --test tests/cowbell-amulet-preset.test.cjs
// Charging the cowbell amulet took air runes by id and Uncharge pays plain runes back, so free preset air runes came
// back plain. Only plain runes charge it now. Real engine: every plugin loaded, a real Player and Inventory, the
// amulet's own item-on-item path and amount prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function setup(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8941); p.setUsername("cowbell8941"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const amulet = new core.Item(I.COWBELL_AMULET, 1);
  p.getInventory().setItem(0, amulet);
  const charge = () => {
    p.setEnteredAmountAction(null);
    PM.emitItemOnItem({ player: p, usedItemId: I.AIR_RUNE, usedItem: p.getInventory().getItems()[1], usedSlot: 1,
      usedWithItemId: amulet.getId(), usedWithItem: amulet, usedWithSlot: 0, handled: false });
    return p.getEnteredAmountAction();
  };
  return { p, amulet, charge };
}

function presetRunes(amount) {
  const runes = new core.Item(I.AIR_RUNE, amount);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) runes.setMetaValue(meta, true);
  return runes;
}

test("preset air runes do not charge the amulet; plain ones do", (t) => {
  const f = setup(t);
  f.p.getInventory().setItem(1, presetRunes(500));
  assert.equal(f.charge(), null, "no amount prompt for preset-only runes");
  assert.equal(f.p.getInventory().getAmount(I.AIR_RUNE), 500, "the preset runes stay");
  assert.equal(f.amulet.getMetaValue("cowbell-amulet:charges"), undefined);

  f.p.getInventory().setItem(2, new core.Item(I.AIR_RUNE, 30));
  // the event names the preset stack, as the client may; only the plain 30 pay
  f.charge().execute(400);
  assert.equal(f.amulet.getMetaValue("cowbell-amulet:charges"), 30);
  assert.equal(f.p.getInventory().getItems()[1]?.getAmount(), 500, "the preset stack is untouched");
  assert.equal(f.p.getInventory().getAmount(I.AIR_RUNE), 500, "only the plain stack paid");
});

test("Uncharge with a full pack and only a preset air-rune stack keeps the charges", (t) => {
  const f = setup(t);
  const inventory = f.p.getInventory();
  const amulet = new core.Item(I.COWBELL_AMULET_2, 1);
  amulet.setMetaValue("cowbell-amulet:charges", 40);
  inventory.setItem(0, amulet);
  inventory.setItem(1, presetRunes(500));
  for (let slot = 2; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.LOGS, 1));
  const uncharge = () => PM.emitItemAction({ player: f.p, item: amulet, itemId: amulet.getId(), slot: 0,
    interfaceId: core.CacheDefinitions.getComponentId("inventory:items"),
    clickType: core.CacheDefinitions.getItem(I.COWBELL_AMULET_2).inventoryActions.indexOf("Uncharge") + 1, handled: false });
  uncharge();
  assert.equal(amulet.getMetaValue("cowbell-amulet:charges"), 40, "the plain runes have nowhere to go, so the charges stay");
  assert.equal(inventory.getAmount(I.AIR_RUNE), 500);
  inventory.deleteAtSlot(27, 1);
  uncharge();
  assert.equal(amulet.getId(), I.COWBELL_AMULET, "a free slot lets it uncharge");
  assert.equal(inventory.getItems()[27]?.getAmount(), 40);
  assert.equal(inventory.getItems()[27].isPresetItem(), false, "the refunded runes are plain");
});

const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { JsonPlayerPersistence } = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const MAX_RUNES = 0x7fffffff;
const CHARGES = "cowbell-amulet:charges";

const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");

function invokeUncharge(player, amulet) {
  const worn = player.getEquipment().getItems().includes(amulet);
  const container = worn ? player.getEquipment() : player.getInventory();
  return ItemActionPacketListener.handleAction(player,
    worn ? core.Equipment.INVENTORY_INTERFACE_ID : core.Inventory.INTERFACE_ID,
    amulet.getId(), container.getItems().indexOf(amulet),
    core.CacheDefinitions.getItem(amulet.getId()).inventoryActions.indexOf("Uncharge") + 1, "Uncharge");
}
function restored(t, player) {
  const codec = new JsonPlayerPersistence();
  const record = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const result = setup(t).p;
  codec.hydratePlayerSave(record).applyToPlayer(result);
  return result;
}

for (const worn of [false, true]) {
  for (const headroom of [0, 10, 39, 40]) {
    test(`Uncharge ${worn ? "worn" : "carried"} amulet requires its entire refund: stack room ${headroom}`, t => {
      const { p, amulet: original } = setup(t), inventory = p.getInventory();
      let amulet = original;
      amulet.setId(I.COWBELL_AMULET_2).setMetaValue(CHARGES, 40);
      amulet.setMetaValue(core.Item.PRESET_META, true);
      amulet.setMetaValue("test:identity", "kept");
      if (worn) {
        EquipPacketListener.equip(p, amulet.getId(), 0, core.Inventory.INTERFACE_ID);
        amulet = p.getEquipment().get(core.Equipment.AMULET_SLOT);
        assert.notEqual(amulet, original, "real equip transfers a metadata-preserving copy");
      }
      const runes = new core.Item(I.AIR_RUNE, MAX_RUNES - headroom);
      inventory.setItem(1, runes);
      inventory.setItem(2, presetRunes(500));
      // Free slots do not let add() overflow an existing matching stack.
      const messages = [];
      const sendMessage = p.sendMessage.bind(p);
      p.sendMessage = text => { messages.push(text); return sendMessage(text); };
      const before = inventory.getItems().map(item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() }));
      invokeUncharge(p, amulet);
      const fits = headroom === 40;
      assert.equal(runes.getAmount(), fits ? MAX_RUNES : MAX_RUNES - headroom);
      assert.equal(amulet.getMetaValue(CHARGES), fits ? undefined : 40);
      assert.equal(amulet.getId(), fits ? I.COWBELL_AMULET : I.COWBELL_AMULET_2);
      assert.equal(amulet.getMetaValue("test:identity"), "kept");
      assert.equal(amulet.isPresetItem(), true);
      assert.equal((worn ? p.getEquipment().getItems() : inventory.getItems()).includes(amulet), true);
      assert.equal(inventory.get(2).getAmount(), 500);
      assert.equal(inventory.get(2).isPresetItem(), true);
      if (!fits) {
        assert.deepEqual(inventory.getItems().map(item => ({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta() })), before);
        assert.deepEqual(messages, ["You need a free inventory slot for the Air Runes."]);
      }
      const loaded = restored(t, p);
      const savedAmulet = worn ? loaded.getEquipment().get(core.Equipment.AMULET_SLOT) : loaded.getInventory().get(0);
      assert.equal(savedAmulet.getMetaValue(CHARGES), fits ? undefined : 40);
      assert.equal(savedAmulet.getMetaValue("test:identity"), "kept");
      assert.equal(savedAmulet.isPresetItem(), true);
      assert.equal(loaded.getInventory().get(1).getAmount(), runes.getAmount());
      assert.equal(loaded.getInventory().get(2).isPresetItem(), true);
    });
  }
}

test("metadata-bearing unrestricted rune stack cannot absorb a plain refund in a full pack", t => {
  const { p, amulet } = setup(t), inv = p.getInventory();
  amulet.setId(I.COWBELL_AMULET_2).setMetaValue(CHARGES, 40);
  const runes = new core.Item(I.AIR_RUNE, 10).setMetaValue("test:origin", "kept");
  inv.setItem(1, runes);
  for (let slot = 2; slot < 28; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1));
  invokeUncharge(p, amulet);
  assert.equal(amulet.getMetaValue(CHARGES), 40);
  assert.equal(inv.getAmount(I.AIR_RUNE), 10);
  assert.equal(inv.get(1), runes);
  inv.deleteAtSlot(27, 1);
  invokeUncharge(p, amulet);
  assert.equal(amulet.getId(), I.COWBELL_AMULET);
  assert.equal(inv.get(27).getAmount(), 40);
  assert.equal(inv.get(27).getMeta(), null);
  invokeUncharge(p, amulet);
  assert.equal(inv.getAmount(I.AIR_RUNE), 50, "repeated Uncharge cannot duplicate the refund");
});
