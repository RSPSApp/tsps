// Run after `yarn build`: node --test tests/skulling.test.cjs
// Skull timers (docs/skulling.md): attacking while skulled restarts the 30 minutes, the skull
// icon goes when the timer runs out, and the amulet of avarice and cape of skulls give 20.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { SkullType } = require("../dist/game/model/SkullType");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const Avarice = require("../plugins/npcs/revenants/Avarice.Revenants");
const CapeOfSkulls = require("../plugins/items/CapeOfSkulls.plugin");
const SkullPrevention = require("../plugins/combat/SkullPrevention.plugin");

const PVP_TICKS = 3000; // 30 minutes
const ITEM_TICKS = 2000; // 20 minutes
const WILDERNESS = new Location(3100, 3700, 0);
const AMULET_SLOT = 2;
const CAPE_SLOT = 1;

before(async () => {
  await CachePipeline.initialize();
  const core = PluginManager.getCoreApi();
  Avarice({ core, persistAttribute() {}, onPlayerProcess() {}, ...modifierStubs() });
  CapeOfSkulls.register({ core, onCanEquip() {}, onCustomEvent() {}, onPlayerLogin() {} });
  SkullPrevention.register({ core: { CombatFactory }, onCanAttack() {} });
});

function modifierStubs() {
  const stubs = {};
  for (const style of ["Melee", "Ranged", "Magic"]) {
    stubs[`register${style}AttackAccuracyModifier`] = () => {};
    stubs[`register${style}HitModifier`] = () => {};
  }
  return stubs;
}

function player({ at = WILDERNESS, timer = 0, type = SkullType.WHITE_SKULL } = {}) {
  const equipment = [];
  const p = {
    skullTimer: timer,
    skullType: type,
    messages: [],
    appearanceFlags: 0,
    attacker: null,
    damaged: new Set(),
    equipment,
    isPlayer: () => true,
    getLocation: () => at,
    isSkulled: () => p.skullTimer > 0,
    getSkullTimer: () => p.skullTimer,
    setSkullTimer: (ticks) => { p.skullTimer = ticks; },
    getSkullType: () => p.skullType,
    setSkullType: (skullType) => { p.skullType = skullType; },
    getUpdateFlag: () => ({ flag: () => { p.appearanceFlags++; } }),
    sendMessage: (message) => p.messages.push(message),
    getPacketSender: () => ({
      getVarbit: (id) => p.varbits.get(id) ?? 0,
      sendMessage: (message) => p.messages.push(message),
    }),
    varbits: new Map(),
    getCombat: () => ({ getAttacker: () => p.attacker, damageMapContains: (other) => p.damaged.has(other) }),
    getEquipment: () => ({ getItems: () => equipment, get: (slot) => equipment[slot] ?? null }),
  };
  return p;
}

function wear(p, slot, id) {
  p.equipment[slot] = id === null ? null : { getId: () => id };
}

test("an unprovoked attack in the Wilderness skulls the attacker for 30 minutes", () => {
  const attacker = player();
  const target = player();
  CombatFactory.handleSkull(attacker, target);
  assert.equal(attacker.skullTimer, PVP_TICKS);
  assert.equal(attacker.skullType, SkullType.WHITE_SKULL);
  assert.equal(target.skullTimer, 0);
});

test("attacking while already skulled restarts the 30 minutes and keeps the skull's colour", () => {
  const attacker = player({ timer: 100, type: SkullType.RED_SKULL });
  CombatFactory.handleSkull(attacker, player());
  assert.equal(attacker.skullTimer, PVP_TICKS);
  assert.equal(attacker.skullType, SkullType.RED_SKULL);
  assert.deepEqual(attacker.messages, [], "no second skulled message");

  const longer = player({ timer: PVP_TICKS + 500 });
  CombatFactory.handleSkull(longer, player());
  assert.equal(longer.skullTimer, PVP_TICKS + 500, "a longer skull is not shortened");
});

test("retaliating does not skull, and nothing changes outside the Wilderness", () => {
  const attacker = player();
  const target = player();
  target.attacker = attacker;
  CombatFactory.handleSkull(target, attacker);
  assert.equal(target.skullTimer, 0);

  const skulled = player({ at: new Location(3222, 3218, 0), timer: 100 });
  CombatFactory.handleSkull(skulled, player({ at: new Location(3222, 3219, 0) }));
  assert.equal(skulled.skullTimer, 100);
});

test("the skull icon is redrawn on the tick the skull runs out", () => {
  const p = player({ timer: 2 });
  Player.prototype.processSkullTimer.call(p);
  assert.equal(p.skullTimer, 1);
  assert.equal(p.appearanceFlags, 0);
  Player.prototype.processSkullTimer.call(p);
  assert.equal(p.skullTimer, 0);
  assert.equal(p.appearanceFlags, 1, "appearance update drops the skull");
  Player.prototype.processSkullTimer.call(p);
  assert.equal(p.skullTimer, 0, "never goes below zero");
  assert.equal(p.appearanceFlags, 1);
});

test("the amulet of avarice keeps its wearer skulled until 20 minutes after it comes off", () => {
  const p = player({ at: new Location(3222, 3218, 0) });
  wear(p, AMULET_SLOT, ItemIdentifiers.AMULET_OF_AVARICE);
  Avarice.keepSkulled({ player: p });
  assert.equal(p.skullTimer, ITEM_TICKS);
  assert.equal(p.messages.length, 1);
  for (let tick = 0; tick < 2500; tick++) {
    Player.prototype.processSkullTimer.call(p);
    Avarice.keepSkulled({ player: p });
  }
  assert.equal(p.skullTimer, ITEM_TICKS, "held at 20 minutes while worn");
  assert.equal(p.messages.length, 1, "no repeated skulled message");

  wear(p, AMULET_SLOT, null);
  Avarice.keepSkulled({ player: p });
  for (let tick = 0; tick < ITEM_TICKS; tick++) Player.prototype.processSkullTimer.call(p);
  assert.equal(p.skullTimer, 0, "gone 20 minutes after taking it off");

  const pk = player({ timer: PVP_TICKS });
  wear(pk, AMULET_SLOT, ItemIdentifiers.AMULET_OF_AVARICE);
  Avarice.keepSkulled({ player: pk });
  assert.equal(pk.skullTimer, PVP_TICKS, "a longer PK skull is kept");
});

test("the cape of skulls skulls for 20 minutes from putting it on, even while worn", () => {
  const { skullOnWear, skullOnLogin } = CapeOfSkulls._test;
  assert.equal(ItemDefinition.forId(ItemIdentifiers.CAPE_OF_SKULLS).getName(), "Cape of skulls");
  const p = player();
  skullOnLogin({ player: p });
  assert.equal(p.skullTimer, 0);
  wear(p, CAPE_SLOT, ItemIdentifiers.CAPE_OF_SKULLS);
  skullOnWear({ player: p });
  assert.equal(p.skullTimer, ITEM_TICKS);
  for (let tick = 0; tick < ITEM_TICKS; tick++) {
    Player.prototype.processSkullTimer.call(p);
    skullOnWear({ player: p });
  }
  assert.equal(p.skullTimer, 0, "wears off while the cape stays on");

  wear(p, CAPE_SLOT, null);
  skullOnWear({ player: p });
  wear(p, CAPE_SLOT, ItemIdentifiers.CAPE_OF_SKULLS);
  skullOnWear({ player: p });
  assert.equal(p.skullTimer, ITEM_TICKS, "putting it on again skulls again");

  const hopper = player();
  wear(hopper, CAPE_SLOT, ItemIdentifiers.CAPE_OF_SKULLS);
  skullOnLogin({ player: hopper });
  assert.equal(hopper.skullTimer, ITEM_TICKS, "logging in with it on skulls again");
});

// Review on #1284: wearing the cape asks first. Driven through the real EquipPacketListener with
// the plugin's hooks registered: "No" leaves equipment and skull alone, "Yes" equips and skulls.
function nativeCapeHolder() {
  const { Item } = PluginManager.getCoreApi();
  const p = new Player(null);
  p.dialogues = [];
  p.getDialogueManager = () => ({ startDialogues: (chain) => p.dialogues.push(chain) });
  p.getPacketSender = () => new Proxy({}, { get: () => () => p.getPacketSender() });
  p.getInventory().setItem(0, new Item(ItemIdentifiers.CAPE_OF_SKULLS, 1));
  PluginManager.emitPlayerLogin({ player: p, username: "skulltest" });
  return p;
}

function answer(p, option) {
  const { OptionDialogue } = PluginManager.getCoreApi();
  const chain = p.dialogues.at(-1);
  const menu = [...chain.getDialogues().values()].find((entry) => entry instanceof OptionDialogue);
  assert.ok(menu, "the warning offers Yes / No");
  menu.execute(option);
}

test("putting the cape of skulls on warns first; No changes nothing, Yes equips and skulls", () => {
  const { EquipPacketListener, Inventory } = PluginManager.getCoreApi();
  CapeOfSkulls.register(PluginManager.createApi("CapeOfSkullsTest"));
  const capeId = () => p.getEquipment().getItems()[CAPE_SLOT].getId();

  const p = nativeCapeHolder();
  EquipPacketListener.equip(p, ItemIdentifiers.CAPE_OF_SKULLS, 0, Inventory.INTERFACE_ID);
  assert.equal(p.dialogues.length, 1, "the warning opened");
  assert.equal(capeId(), -1, "not worn before an answer");
  assert.equal(p.isSkulled(), false);

  answer(p, 2);
  assert.equal(capeId(), -1, "No leaves the cape in the inventory");
  assert.equal(p.getInventory().getItems()[0].getId(), ItemIdentifiers.CAPE_OF_SKULLS);
  assert.equal(p.isSkulled(), false, "No leaves the skull timer alone");

  EquipPacketListener.equip(p, ItemIdentifiers.CAPE_OF_SKULLS, 0, Inventory.INTERFACE_ID);
  answer(p, 1);
  assert.equal(capeId(), ItemIdentifiers.CAPE_OF_SKULLS, "Yes puts the cape on");
  assert.equal(p.getSkullTimer(), ITEM_TICKS, "and skulls for 20 minutes");

  const dropped = nativeCapeHolder();
  EquipPacketListener.equip(dropped, ItemIdentifiers.CAPE_OF_SKULLS, 0, Inventory.INTERFACE_ID);
  dropped.getInventory().setItem(0, new (PluginManager.getCoreApi().Item)(-1, 0));
  answer(dropped, 1);
  assert.equal(dropped.getEquipment().getItems()[CAPE_SLOT].getId(), -1, "Yes after the cape left the inventory does nothing");
  assert.equal(dropped.isSkulled(), false);
});

test("skull prevention blocks an attack that would skull and says why", () => {
  const message = "You cannot attack this target as it would result in you getting skulled.";
  const blocked = { attacker: player(), target: player(), method: {}, allow: null };
  blocked.attacker.varbits.set(13131, 1);
  SkullPrevention._test.blockSkullAttack(blocked);
  assert.equal(blocked.allow, false);
  assert.deepEqual(blocked.attacker.messages, [message]);

  const bystander = { attacker: player(), target: player(), allow: null };
  bystander.attacker.varbits.set(13131, 1);
  SkullPrevention._test.blockSkullAttack(bystander);
  SkullPrevention._test.blockSkullAttack(bystander);
  assert.equal(bystander.allow, false, "an area attack still spares a bystander it would skull for");
  assert.deepEqual(bystander.attacker.messages, [], "but says nothing for each one");

  const off = { attacker: player(), target: player(), method: {}, allow: null };
  SkullPrevention._test.blockSkullAttack(off);
  assert.equal(off.allow, null, "the setting is off");
  assert.deepEqual(off.attacker.messages, []);

  const skulled = { attacker: player({ timer: 100 }), target: player(), allow: null };
  skulled.attacker.varbits.set(13131, 1);
  SkullPrevention._test.blockSkullAttack(skulled);
  assert.equal(skulled.allow, null, "an existing skull is only prolonged");

  const retaliating = { attacker: player(), target: player(), allow: null };
  retaliating.target.attacker = retaliating.attacker;
  retaliating.attacker.varbits.set(13131, 1);
  SkullPrevention._test.blockSkullAttack(retaliating);
  assert.equal(retaliating.allow, null, "a fight already underway does not skull");

  const struckBack = { attacker: player(), target: player(), method: {}, allow: null };
  struckBack.attacker.attacker = struckBack.target;
  struckBack.attacker.varbits.set(13131, 1);
  SkullPrevention._test.blockSkullAttack(struckBack);
  assert.equal(struckBack.allow, null, "retaliation does not skull");

  const outside = { attacker: player({ at: new Location(3222, 3218, 0) }), target: player(), allow: null };
  outside.attacker.varbits.set(13131, 1);
  SkullPrevention._test.blockSkullAttack(outside);
  assert.equal(outside.allow, null, "nothing skulls outside the Wilderness");
});
