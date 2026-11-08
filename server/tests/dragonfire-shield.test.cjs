// Run after `yarn build`: node --test tests/dragonfire-shield.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const DragonfireShield = require("../plugins/items/DragonfireShield.plugin");

const itemActions = {};
const itemOnItem = [];
let resolver = null;
let bonusProvider = null;
DragonfireShield.register({
  core: {
    Animation: class { constructor(id, delay) { this.id = id; this.delay = delay; } },
    CombatMethod: class {},
    Equipment,
    BonusManager: { update() {} },
    Flag: { APPEARANCE: "appearance" },
    Graphic: class { constructor(id, delay) { this.id = id; this.delay = delay; } },
    ChatType: { SPAM: "spam" },
    ItemIdentifiers: ItemIds,
  },
  persistAttribute() {},
  onPlayerLogin() {},
  onItemAction(name, actions) { itemActions[name] = actions; },
  onItemOnItem(...args) { itemOnItem.push(args); },
  registerBonusProvider(provider) { bonusProvider = provider; },
  onCustomEvent() {},
  registerCombatMethodResolver(registered) { resolver = registered; },
});

function item(id, meta = {}, name = "", amount = 1) {
  return {
    id,
    meta,
    amount,
    getAmount() { return this.amount; },
    getDefinition() { return { getName: () => name }; },
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
    graphics: [],
    sounds: [],
    deleted: [],
    special: false,
    getEquipment: () => ({ getItems: () => equipment, get: (slot) => equipment[slot], refreshItems() {} }),
    inventory: [],
    getInventory: () => ({ refreshItems() {}, getItems: () => player.inventory, deleteNumber: (id, amount) => player.deleted.push([id, amount]) }),
    getUpdateFlag: () => ({ flag() {} }),
    getPacketSender: () => ({
      sendConfig: (id, value) => player.configs.push([id, value]),
      getVarp: (id) => player.configs.findLast(([config]) => config === id)?.[1] ?? 0,
      sendVarbit: (id, value) => player.varbits.push([id, value]),
      sendSoundEffect(id) { player.sounds.push(id); return this; },
      sendTypedMessage: (type, text) => player.messages.push(`${type}:${text}`),
    }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    isSpecialActivated: () => player.special,
    setSpecialActivated: (value) => { player.special = value; },
    performAnimation: (animation) => player.animations.push(animation.id),
    performGraphic: (graphic) => player.graphics.push(graphic.id),
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

test("dragonfire on the worn uncharged shield charges it, with the live animation, graphic and sounds", () => {
  const shield = item(ItemIds.DRAGONFIRE_SHIELD_2);
  const player = createPlayer(shield);
  const messages = [{ text: "Your shield absorbs most of the dragon fire!", spam: true }];
  DragonfireShield._test.absorbDragonfire({ player, messages });
  assert.equal(shield.getId(), ItemIds.DRAGONFIRE_SHIELD);
  assert.equal(DragonfireShield._test.charges(shield), 1);
  assert.deepEqual(messages.map((line) => line.text), [
    "Your shield absorbs most of the dragon fire!",
    "Your dragonfire shield glows more brightly.",
  ]);
  assert.deepEqual(player.animations, [6695]);
  assert.deepEqual(player.graphics, [1160]);
  assert.deepEqual(player.sounds, [3750, 3740]);
});

test("the charge graphic steps up every ten charges, and a full shield absorbs nothing", () => {
  const graphicFor = (before) => {
    const shield = item(ItemIds.DRAGONFIRE_SHIELD, { "dragonfire-shield": before });
    const player = createPlayer(shield);
    DragonfireShield._test.absorbDragonfire({ player, messages: [] });
    return player.graphics[0];
  };
  assert.equal(graphicFor(9), 1160);
  assert.equal(graphicFor(10), 1161);
  assert.equal(graphicFor(49), 1164);

  const full = item(ItemIds.DRAGONFIRE_SHIELD);
  const player = createPlayer(full);
  const messages = [];
  DragonfireShield._test.absorbDragonfire({ player, messages });
  assert.deepEqual(messages, [{ text: "Your dragonfire shield is already fully charged.", spam: true }]);
  assert.deepEqual(player.animations, []);
  assert.equal(DragonfireShield._test.charges(full), 50);
});

test("dragonfire with no dragonfire shield worn changes nothing", () => {
  const player = createPlayer();
  const messages = [];
  DragonfireShield._test.absorbDragonfire({ player, messages });
  assert.deepEqual(messages, []);
});

const WARD = ItemIds.DRAGONFIRE_WARD;
const WARD_UNCHARGED = ItemIds.DRAGONFIRE_WARD_2;
const WYVERN = ItemIds.ANCIENT_WYVERN_SHIELD;
const WYVERN_UNCHARGED = ItemIds.ANCIENT_WYVERN_SHIELD_2;

test("the ward and the wyvern shield get the same options as the dragonfire shield", () => {
  for (const option of ["Inspect", "Check", "Activate", "Empty"]) {
    assert.equal(typeof itemActions["Dragonfire ward"][option], "function", `ward ${option}`);
  }
  for (const option of ["Inspect", "Check", "Operate", "Recharge", "Empty"]) {
    assert.equal(typeof itemActions["Ancient wyvern shield"][option], "function", `wyvern ${option}`);
  }
});

test("the ward charges, arms and empties like the dragonfire shield, with its own release animation", () => {
  const ward = item(WARD, { "dragonfire-shield": 12 });
  const player = createPlayer(ward);
  DragonfireShield._test.inspect({ player, item: ward });
  DragonfireShield._test.activate({ player, item: ward });
  assert.deepEqual(player.messages, ["The shield has 12 charges."]);
  assert.deepEqual(player.configs, [[301, 2]]);
  DragonfireShield._test.empty({ player, item: ward });
  assert.equal(ward.getId(), WARD_UNCHARGED);
  assert.deepEqual(player.animations, [7873]);

  const bottle = item(ItemIds.BOTTLED_DRAGONBREATH);
  DragonfireShield._test.chargeWithDragonbreath({ player, usedItemId: ItemIds.BOTTLED_DRAGONBREATH, usedItem: bottle, usedWithItem: ward });
  assert.equal(ward.getId(), WARD);
  assert.equal(DragonfireShield._test.charges(ward), 50);

  const absorbing = item(WARD_UNCHARGED);
  DragonfireShield._test.absorbDragonfire({ player: createPlayer(absorbing), messages: [] });
  assert.equal(DragonfireShield._test.charges(absorbing), 1);
});

test("the wyvern shield is not charged by dragonfire and its blast hits for up to 15", () => {
  const wyvern = item(WYVERN_UNCHARGED);
  const messages = [];
  DragonfireShield._test.absorbDragonfire({ player: createPlayer(wyvern), messages });
  assert.deepEqual(messages, []);
  assert.equal(wyvern.getId(), WYVERN_UNCHARGED);

  const target = { isPlayer: () => false };
  assert.equal(DragonfireShield._test.blastMaxHit(item(WYVERN), target), 15);
  assert.equal(DragonfireShield._test.blastMaxHit(item(WARD), target), 25);
  assert.equal(DragonfireShield._test.blastMaxHit(item(ItemIds.DRAGONFIRE_SHIELD), target), 25);
});

test("fossils charge the wyvern shield by their size, unidentified ones by one, rare ones not at all", () => {
  const { chargeWyvernShield, charges } = DragonfireShield._test;
  const wyvern = item(WYVERN_UNCHARGED);
  const use = (fossil) => {
    const player = createPlayer();
    const event = { player, usedItem: fossil, usedWithItem: wyvern, handled: false };
    chargeWyvernShield(event);
    return { player, event };
  };
  const names = [
    ["Unidentified small fossil", 1],
    ["Unidentified rare fossil", 1],
    ["Small fossilised limbs", 1],
    ["Medium fossilised ribs", 2],
    ["Fossilised stump", 2],
    ["Large fossilised skull", 3],
    ["Rare fossilised tusk", 0],
  ];
  for (const [name, gain] of names) {
    const before = charges(wyvern);
    const { player, event } = use(item(21604, {}, name));
    assert.equal(charges(wyvern) - before, gain, name);
    assert.equal(event.handled, gain > 0, name);
    if (gain > 0) {
      assert.deepEqual(player.messages, ["spam:Your ancient wyvern shield glows more brightly."]);
      assert.deepEqual(player.sounds, [3740]);
      assert.deepEqual(player.deleted, [[21604, 1]]);
    } else {
      assert.deepEqual(player.messages, []);
    }
  }
  assert.equal(wyvern.getId(), WYVERN);
  assert.equal(charges(wyvern), 10);
});

test("numulites charge the wyvern shield 500 to a charge, up to full, and a full shield takes none", () => {
  const { chargeWyvernShield, charges } = DragonfireShield._test;
  const wyvern = item(WYVERN_UNCHARGED);
  const player = createPlayer();
  chargeWyvernShield({ player, usedItem: item(ItemIds.NUMULITE, {}, "Numulite", 1200), usedWithItem: wyvern });
  assert.equal(charges(wyvern), 2);
  assert.deepEqual(player.deleted, [[ItemIds.NUMULITE, 1000]]);

  const short = createPlayer();
  chargeWyvernShield({ player: short, usedItem: item(ItemIds.NUMULITE, {}, "Numulite", 499), usedWithItem: wyvern });
  assert.equal(charges(wyvern), 2);
  assert.deepEqual(short.deleted, []);

  const nearlyFull = item(WYVERN, { "dragonfire-shield": 49 });
  const capped = createPlayer();
  chargeWyvernShield({ player: capped, usedItem: item(ItemIds.NUMULITE, {}, "Numulite", 5000), usedWithItem: nearlyFull });
  assert.equal(charges(nearlyFull), 50);
  assert.deepEqual(capped.deleted, [[ItemIds.NUMULITE, 500]]);

  const full = createPlayer();
  const event = { player: full, usedItem: item(21604, {}, "Large fossilised skull"), usedWithItem: item(WYVERN), handled: false };
  chargeWyvernShield(event);
  assert.equal(event.handled, false);
  assert.deepEqual(full.deleted, []);
});

test("the worn Recharge spends the fossils and numulites in the inventory", () => {
  const wyvern = item(WYVERN_UNCHARGED);
  const player = createPlayer(wyvern);
  player.inventory = [
    item(21604, {}, "Large fossilised ribs"),
    item(21562, {}, "Unidentified small fossil"),
    item(21610, {}, "Rare fossilised limbs"),
    item(ItemIds.NUMULITE, {}, "Numulite", 1000),
  ];
  assert.equal(itemActions["Ancient wyvern shield"].Recharge({ player, item: wyvern }), true);
  assert.equal(DragonfireShield._test.charges(wyvern), 3 + 1 + 2);
  const none = createPlayer(wyvern);
  assert.equal(itemActions["Ancient wyvern shield"].Recharge({ player: none, item: wyvern }), false);
});

test("each charge adds 1 to the stab, slash, crush and ranged defence on top of the item data", () => {
  const bonuses = () => new Array(14).fill(20);
  const worn = (shield) => {
    const out = bonuses();
    bonusProvider.apply({ player: createPlayer(shield), bonuses: out });
    return out;
  };
  const forty = worn(item(WARD, { "dragonfire-shield": 40 }));
  for (const index of [5, 6, 7, 9]) assert.equal(forty[index], 60, `defence ${index}`);
  for (const index of [0, 1, 2, 3, 4, 8, 10, 11, 12, 13]) assert.equal(forty[index], 20, `bonus ${index}`);
  assert.equal(worn(item(ItemIds.DRAGONFIRE_SHIELD))[9], 70, "a full shield: +50");
  assert.equal(worn(item(WYVERN, { "dragonfire-shield": 1 }))[5], 21);
  assert.deepEqual(worn(item(WYVERN_UNCHARGED)), bonuses(), "an uncharged shield has its own item data");
  assert.deepEqual(worn(null), bonuses());
});

// Last: it registers with the real plugin API, which replaces the mocked core above.
test("an armed blast beats a worn weapon's own resolver (chinchompas), but not an armed weapon special", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const Chinchompas = require("../plugins/items/Chinchompas.plugin");
  // Production loads Chinchompas first; the shield must still win.
  Chinchompas.register(PluginManager.createApi("Chinchompas"));
  DragonfireShield.register(PluginManager.createApi("DragonfireShield"));

  const shield = item(ItemIds.DRAGONFIRE_SHIELD);
  const player = createPlayer(shield);
  player.getEquipment().getItems()[Equipment.WEAPON_SLOT] = item(ItemIds.CHINCHOMPA_2);
  player.isPlayer = () => true;
  const resolve = () => {
    for (const resolver of PluginManager.getCombatMethodResolvers()) {
      const method = resolver.resolve(player);
      if (method) return method;
    }
    return null;
  };

  assert.ok(resolve(), "unarmed: the chinchompa throws");
  assert.notEqual(resolve().constructor.name, "DragonfireShieldBlast");
  DragonfireShield._test.activate({ player, item: shield });
  assert.equal(resolve()?.constructor?.name, "DragonfireShieldBlast");
  player.special = true;
  assert.notEqual(resolve()?.constructor?.name, "DragonfireShieldBlast", "an armed weapon special goes first");
});
