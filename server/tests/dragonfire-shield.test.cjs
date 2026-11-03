// Run after `yarn build`: node --test tests/dragonfire-shield.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const DragonfireShield = require("../plugins/items/DragonfireShield.plugin");

const itemActions = {};
let resolver = null;
DragonfireShield.register({
  core: {
    Animation: class { constructor(id) { this.id = id; } },
    CombatMethod: class {},
    Equipment,
    Flag: { APPEARANCE: "appearance" },
    Graphic: class { constructor(id) { this.id = id; } },
    ItemIdentifiers: ItemIds,
  },
  persistAttribute() {},
  onPlayerLogin() {},
  onItemAction(name, actions) { itemActions[name] = actions; },
  onItemOnItem() {},
  registerCombatMethodResolver(registered) { resolver = registered; },
});

function item(id, meta = {}) {
  return {
    id,
    meta,
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, value) { this.meta[key] = value; },
  };
}

function createPlayer(shield = null) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (shield) equipment[Equipment.SHIELD_SLOT] = shield;
  const attributes = new Map();
  const player = {
    messages: [],
    configs: [],
    varbits: [],
    animations: [],
    deleted: [],
    special: false,
    getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
    getInventory: () => ({ refreshItems() {}, deleteNumber: (id, amount) => player.deleted.push([id, amount]) }),
    getUpdateFlag: () => ({ flag() {} }),
    getPacketSender: () => ({
      sendConfig: (id, value) => player.configs.push([id, value]),
      sendVarbit: (id, value) => player.varbits.push([id, value]),
      sendSoundEffect() { return this; },
    }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    isSpecialActivated: () => player.special,
    setSpecialActivated: (value) => { player.special = value; },
    performAnimation: (animation) => player.animations.push(animation.id),
    performGraphic() {},
    sendMessage: (message) => player.messages.push(message),
    getAsPlayer: () => player,
  };
  return player;
}

test("the charged and uncharged shields share Inspect, Check, Activate and Empty", () => {
  for (const option of ["Inspect", "Check", "Activate", "Empty"]) {
    assert.equal(typeof itemActions["Dragonfire shield"][option], "function", option);
  }
});

test("Inspect and Check report the charges, full when none are saved", () => {
  const player = createPlayer();
  const { inspect } = DragonfireShield._test;
  inspect({ player, item: item(ItemIds.DRAGONFIRE_SHIELD) });
  inspect({ player, item: item(ItemIds.DRAGONFIRE_SHIELD, { "dragonfire-shield": 49 }) });
  inspect({ player, item: item(ItemIds.DRAGONFIRE_SHIELD_2) });
  assert.deepEqual(player.messages, [
    "The shield has 50 charges.",
    "The shield has 49 charges.",
    "The shield has no charges.",
  ]);
});

test("Activate arms the blast with sa_attack 2 and a second click disarms it", () => {
  const shield = item(ItemIds.DRAGONFIRE_SHIELD);
  const player = createPlayer(shield);
  DragonfireShield._test.activate({ player, item: shield });
  assert.deepEqual(player.configs, [[301, 2]]);
  assert.ok(resolver.resolve(player), "the armed blast replaces the next attack");
  DragonfireShield._test.activate({ player, item: shield });
  assert.deepEqual(player.configs, [[301, 2], [301, 0]]);
  assert.equal(resolver.resolve(player), null);
});

test("Activate while the shield recharges refuses with the live message", () => {
  const shield = item(ItemIds.DRAGONFIRE_SHIELD);
  const player = createPlayer(shield);
  player.setAttribute("dragonfire-shield:recharge", 20);
  DragonfireShield._test.activate({ player, item: shield });
  assert.deepEqual(player.messages, ["You must let the shield cool down before using it again."]);
  assert.deepEqual(player.configs, []);
});

test("Empty vents every charge and leaves the uncharged shield", () => {
  const shield = item(ItemIds.DRAGONFIRE_SHIELD, { "dragonfire-shield": 12 });
  const player = createPlayer();
  DragonfireShield._test.empty({ player, item: shield });
  assert.equal(shield.getId(), ItemIds.DRAGONFIRE_SHIELD_2);
  assert.deepEqual(player.messages, ["You vent the shield's remaining charges harmlessly into the air."]);
  assert.deepEqual(player.animations, [6700]);
});

test("Bottled dragonbreath charges the shield to full and is used up", () => {
  const shield = item(ItemIds.DRAGONFIRE_SHIELD_2);
  const player = createPlayer();
  DragonfireShield._test.chargeWithDragonbreath({
    player,
    usedItemId: ItemIds.BOTTLED_DRAGONBREATH,
    usedItem: item(ItemIds.BOTTLED_DRAGONBREATH),
    usedWithItem: shield,
  });
  assert.equal(shield.getId(), ItemIds.DRAGONFIRE_SHIELD);
  assert.equal(DragonfireShield._test.charges(shield), 50);
  assert.deepEqual(player.deleted, [[ItemIds.BOTTLED_DRAGONBREATH, 1]]);
  assert.deepEqual(player.messages, ["You charge your shield using the bottled dragonbreath."]);
});
