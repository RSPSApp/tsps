// Run after `yarn build`: node --test tests/nightmare-staff-orbs.test.cjs
//
// Wiki (Nightmare staff): each orb used on the staff makes its staff, "You add the orb to the
// staff."; the upgraded staves "can be reverted to its tradeable components at any time", with
// "You remove the orb from the staff.".
//
// Real Player, Inventory and plugins, through the server's own item-on-item and item-action paths.
// Only the network is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const plugin = require("../plugins/items/NightmareStaffOrbs.plugin");
const ADD = "You add the orb to the staff.";
const REMOVE = "You remove the orb from the staff.";
const PRESET = "Preset items cannot be used for this.";

const ORBS = [
  ["Harmonised", I.HARMONISED_ORB, I.HARMONISED_NIGHTMARE_STAFF],
  ["Eldritch", I.ELDRITCH_ORB, I.ELDRITCH_NIGHTMARE_STAFF],
  ["Volatile", I.VOLATILE_ORB, I.VOLATILE_NIGHTMARE_STAFF],
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  plugin.register(PluginManager.createApi("NightmareStaffOrbsTest"));
  require("../plugins/items/HarmonisedNightmareStaff.plugin").register(PluginManager.createApi("HarmonisedStaffOrbsTest"));
});

let index = 3300;
function holder(t) {
  const player = new Player(null);
  player.setUsername(`orbs${index}`);
  player.setIndex(index++);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  const messages = [];
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  const inventory = player.getInventory();
  t.mock.method(inventory, "refreshItems", () => inventory);
  inventory.resetItems();
  return { player, inventory, messages };
}

/** Uses the item in `used` on the one in `on`, as the client's item-on-item packet does. */
function use(player, used, on) {
  const items = player.getInventory().getItems();
  return PluginManager.emitItemOnItem({
    player,
    usedItem: items[used], usedItemId: items[used].getId(), usedItemSlot: used,
    usedWithItem: items[on], usedWithItemId: items[on].getId(), usedWithItemSlot: on,
    handled: false,
  });
}

function dismantleBy(player, slot) {
  const item = player.getInventory().getItems()[slot];
  const option = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf("Dismantle");
  assert.ok(option >= 0, `the cache gives ${item.getId()} a Dismantle option`);
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot,
    clickType: option + 1, option: "Dismantle", handled: false,
  });
}

for (const [name, orb, staff] of ORBS) {
  test(`the ${name} orb on the Nightmare staff makes the ${name} staff in the staff's slot`, (t) => {
    const { player, inventory, messages } = holder(t);
    inventory.setItem(3, new core.Item(I.NIGHTMARE_STAFF, 1));
    inventory.setItem(9, new core.Item(orb, 1));
    assert.equal(use(player, 9, 3), true);
    assert.equal(inventory.getItems()[3].getId(), staff);
    assert.equal(inventory.getItems()[9].getId(), -1, "the orb's slot is emptied");
    assert.equal(inventory.getAmount(I.NIGHTMARE_STAFF), 0);
    assert.equal(inventory.getAmount(orb), 0);
    assert.deepEqual(messages, [ADD]);
  });

  test(`the Nightmare staff on the ${name} orb works the same way round`, (t) => {
    const { player, inventory, messages } = holder(t);
    inventory.setItem(0, new core.Item(orb, 1));
    inventory.setItem(5, new core.Item(I.NIGHTMARE_STAFF, 1));
    assert.equal(use(player, 5, 0), true);
    assert.equal(inventory.getItems()[5].getId(), staff);
    assert.equal(inventory.getItems()[0].getId(), -1);
    assert.deepEqual(messages, [ADD]);
  });

  test(`the ${name} staff dismantles back into the staff and orb`, (t) => {
    const { player, inventory, messages } = holder(t);
    inventory.setItem(4, new core.Item(staff, 1));
    assert.equal(dismantleBy(player, 4), true);
    assert.equal(inventory.getItems()[4].getId(), I.NIGHTMARE_STAFF, "the staff's slot");
    assert.equal(inventory.getAmount(orb), 1);
    assert.equal(inventory.getAmount(staff), 0);
    assert.deepEqual(messages, [REMOVE]);
    // And back again.
    const orbSlot = inventory.getItems().findIndex((item) => item.getId() === orb);
    assert.equal(use(player, orbSlot, 4), true);
    assert.equal(inventory.getItems()[4].getId(), staff);
  });
}

test("a preset staff or orb is refused and both are kept", (t) => {
  const { player, inventory, messages } = holder(t);
  const preset = new core.Item(I.ELDRITCH_ORB, 1);
  preset.setMetaValue(core.Item.PRESET_META, true);
  inventory.setItem(0, new core.Item(I.NIGHTMARE_STAFF, 1));
  inventory.setItem(1, preset);
  assert.equal(use(player, 1, 0), true);
  assert.equal(inventory.getItems()[0].getId(), I.NIGHTMARE_STAFF);
  assert.equal(inventory.getItems()[1].getId(), I.ELDRITCH_ORB);
  assert.deepEqual(messages, [PRESET]);

  const presetStaff = new core.Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  presetStaff.setMetaValue(core.Item.PRESET_META, true);
  inventory.setItem(2, presetStaff);
  assert.equal(dismantleBy(player, 2), true);
  assert.equal(inventory.getItems()[2].getId(), I.VOLATILE_NIGHTMARE_STAFF);
  assert.equal(inventory.getAmount(I.VOLATILE_ORB), 0);
});

test("dismantling with a full inventory keeps the staff", (t) => {
  const { player, inventory } = holder(t);
  const full = t.mock.method(inventory, "full", () => inventory);
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.ELDRITCH_NIGHTMARE_STAFF, 1));
  assert.equal(dismantleBy(player, 27), true);
  assert.equal(full.mock.callCount(), 1);
  assert.equal(inventory.getAmount(I.ELDRITCH_NIGHTMARE_STAFF), 28);
  assert.equal(inventory.getAmount(I.ELDRITCH_ORB), 0);
});

test("an orb on anything else, or two orbs, is left to the other handlers", (t) => {
  const { player, inventory, messages } = holder(t);
  inventory.setItem(0, new core.Item(I.HARMONISED_ORB, 1));
  inventory.setItem(1, new core.Item(I.VOLATILE_ORB, 1));
  inventory.setItem(2, new core.Item(I.HARMONISED_NIGHTMARE_STAFF, 1));
  assert.equal(use(player, 0, 1), false);
  assert.equal(use(player, 1, 2), false);
  assert.equal(inventory.getAmount(I.HARMONISED_ORB), 1);
  assert.equal(inventory.getAmount(I.VOLATILE_ORB), 1);
  assert.deepEqual(messages, []);
});

test("a noted staff or orb is not combined", (t) => {
  const { player, inventory } = holder(t);
  const notedStaff = core.ItemDefinition.forId(I.NIGHTMARE_STAFF).getNoteId();
  if (notedStaff < 0) return t.skip("no noted Nightmare staff in this cache");
  inventory.setItem(0, new core.Item(notedStaff, 1));
  inventory.setItem(1, new core.Item(I.ELDRITCH_ORB, 1));
  assert.equal(use(player, 1, 0), false);
  assert.equal(inventory.getAmount(I.ELDRITCH_ORB), 1);
});
