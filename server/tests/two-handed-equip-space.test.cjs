// Run after `yarn build`: node --test tests/two-handed-equip-space.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { Item } = require('../dist/game/model/Item');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { UpdateFlag } = require('../dist/game/model/UpdateFlag');
const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');

const I = PluginManager.getCoreApi().ItemIdentifiers;
const TWO_HANDED = I.BRONZE_HALBERD;
const ONE_HANDED = I.BRONZE_SHORTSWORD;
const SHIELD = I.WOODEN_SHIELD;
const FILLER = I.RAKE;
const NO_ITEM = -1;

/** A player carrying `carried` items, the two-hander to wield in slot 0, wearing `worn`. */
function player({ worn = {}, carried = 28 } = {}) {
  const messages = [];
  const holder = {
    messages,
    getUsername: () => 'two-handed-equip-space',
    getInterfaceId: () => -1,
    getHitpoints: () => 50,
    isPlayerBot: () => false,
    onEquipmentChanged() {},
    getUpdateFlag: () => new UpdateFlag(),
    getPacketSender: () => new Proxy({}, { get: () => () => {} }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCombatLevel: () => 126,
      stopSkillable() {},
    }),
    getCombat: () => ({ getAutocastSpell: () => null }),
    setSpecialActivated() {},
    sendMessage: (message) => messages.push(message),
  };
  holder.inventory = new Inventory(holder);
  holder.equipment = new Equipment(holder);
  holder.getInventory = () => holder.inventory;
  holder.getEquipment = () => holder.equipment;
  for (let slot = 0; slot < carried; slot++) {
    holder.inventory.setItem(slot, new Item(FILLER, 1));
  }
  holder.inventory.setItem(0, new Item(TWO_HANDED, 1));
  for (const [slot, id] of Object.entries(worn)) {
    holder.equipment.setItem(Number(slot), new Item(id, 1));
  }
  return holder;
}

const held = (p) => [...p.inventory.getItems(), ...p.equipment.getItems()]
  .filter((item) => item.getId() !== NO_ITEM).length;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  // The engine side of wielding (weapon tab, bonuses, autocast) is not under test here.
  PluginManager.getCoreApi().WeaponInterfaceManager.assign = () => {};
  require('../dist/game/content/combat/magic/Autocasting').Autocasting.setAutocast = () => {};
  require('../dist/game/model/equipment/BonusManager').BonusManager.update = () => {};
});

test('the fixture carries a two-hander and wears a shield the way the report describes', () => {
  assert.equal(ItemDefinition.forId(TWO_HANDED).isDoubleHanded(), true);
  assert.equal(ItemDefinition.forId(TWO_HANDED).getEquipmentType().getSlot(), Equipment.WEAPON_SLOT);
  assert.equal(ItemDefinition.forId(ONE_HANDED).isDoubleHanded(), false);
  assert.equal(ItemDefinition.forId(ONE_HANDED).getEquipmentType().getSlot(), Equipment.WEAPON_SLOT);
  assert.equal(ItemDefinition.forId(SHIELD).getEquipmentType().getSlot(), Equipment.SHIELD_SLOT);
});

test('a full inventory still lets a shield-wearing player wield a two-hander into empty hands', () => {
  const p = player({ worn: { [Equipment.SHIELD_SLOT]: SHIELD }, carried: 28 });
  const before = held(p);
  EquipPacketListener.equip(p, TWO_HANDED, 0, Inventory.INTERFACE_ID);
  assert.deepEqual(p.messages, [], 'no inventory-space refusal');
  assert.equal(p.equipment.getItems()[Equipment.WEAPON_SLOT].getId(), TWO_HANDED);
  assert.equal(p.equipment.getItems()[Equipment.SHIELD_SLOT].getId(), NO_ITEM,
    'the off hand is clear for the two-hander');
  assert.equal(p.inventory.getItems()[0].getId(), SHIELD,
    'the shield takes the slot the two-hander came from');
  assert.equal(p.inventory.getFreeSlots(), 0);
  assert.equal(held(p), before, 'nothing duplicated or lost');
});

test('wielding into empty hands with a spare slot keeps the spare slot spare', () => {
  const p = player({ worn: { [Equipment.SHIELD_SLOT]: SHIELD }, carried: 27 });
  EquipPacketListener.equip(p, TWO_HANDED, 0, Inventory.INTERFACE_ID);
  assert.deepEqual(p.messages, []);
  assert.equal(p.equipment.getItems()[Equipment.WEAPON_SLOT].getId(), TWO_HANDED);
  assert.equal(p.inventory.getItems()[0].getId(), SHIELD);
  assert.equal(p.inventory.getFreeSlots(), 1, 'the swap costs no space');
});

test('a two-hander past both a worn weapon and a worn shield still needs a free slot', () => {
  const p = player({
    worn: { [Equipment.WEAPON_SLOT]: ONE_HANDED, [Equipment.SHIELD_SLOT]: SHIELD },
    carried: 28,
  });
  EquipPacketListener.equip(p, TWO_HANDED, 0, Inventory.INTERFACE_ID);
  assert.deepEqual(p.messages, ['Not enough space in your inventory.']);
  assert.equal(p.equipment.getItems()[Equipment.WEAPON_SLOT].getId(), ONE_HANDED);
  assert.equal(p.equipment.getItems()[Equipment.SHIELD_SLOT].getId(), SHIELD);
  assert.equal(p.inventory.getItems()[0].getId(), TWO_HANDED, 'still carrying the two-hander');
});

test('with one free slot both displaced weapons land in the inventory', () => {
  const p = player({
    worn: { [Equipment.WEAPON_SLOT]: ONE_HANDED, [Equipment.SHIELD_SLOT]: SHIELD },
    carried: 27,
  });
  const before = held(p);
  EquipPacketListener.equip(p, TWO_HANDED, 0, Inventory.INTERFACE_ID);
  assert.deepEqual(p.messages, []);
  assert.equal(p.equipment.getItems()[Equipment.WEAPON_SLOT].getId(), TWO_HANDED);
  assert.equal(p.equipment.getItems()[Equipment.SHIELD_SLOT].getId(), NO_ITEM);
  assert.equal(p.inventory.getItems()[0].getId(), ONE_HANDED,
    'the displaced sword takes the slot the two-hander came from');
  assert.equal(p.inventory.getItems()[27].getId(), SHIELD, 'the shield takes the only free slot');
  assert.equal(p.inventory.getFreeSlots(), 0);
  assert.equal(held(p), before, 'nothing duplicated or lost');
});
