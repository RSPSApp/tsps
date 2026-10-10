// Run after `yarn build`: node --test tests/maxgear.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const MaxGear = require('../plugins/commands/MaxGear.plugin');

const core = PluginManager.getCoreApi();
const { Equipment, ItemIdentifiers: I, Item } = core;
const SHIELD_SLOT = Equipment.SHIELD_SLOT;
const commands = new Map();

function fakePlayer() {
  const worn = new Array(14).fill(null);
  const inventory = Array.from({ length: 28 }, () => new Item(-1, 0));
  const banked = [];
  const messages = [];
  const equipment = {
    getCopiedItems: () => worn.map((item) => item?.clone?.() ?? item),
    resetItems() { worn.fill(null); return equipment; },
    setItem(slot, item) { worn[slot] = item; return equipment; },
    refreshItems() { return equipment; },
    forSlot: (slot) => worn[slot] ?? new Item(-1, 0),
  };
  return {
    worn,
    inventory,
    banked,
    messages,
    getEquipment: () => equipment,
    getInventory: () => ({
      capacity: () => inventory.length,
      getItems: () => inventory,
      refreshItems() { return inventory; },
    }),
    getInterfaceId: () => require('../dist/game/model/container/impl/Inventory').Inventory.INTERFACE_ID,
    getHitpoints: () => 30,
    getBank: () => ({ add: (item) => banked.push(item.getId()), contains: () => false, getAmount: () => 0, getFreeSlots: () => 800 }),
    getCurrentBankTab: () => 0,
    getPacketSender: () => ({ sendSpecialAttackState() {}, sendInterfaceRemoval() {} }),
    getUpdateFlag: () => ({ flag() {} }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCombatLevel: () => 126, stopSkillable() {} }),
    setSpecialActivated() {},
    sendMessage: (message) => messages.push(message),
  };
}

before(async () => {
  await CachePipeline.initialize();
  // The engine side of equipping (weapon tab, autocast, bonuses) is not under test here.
  core.WeaponInterfaceManager.assign = () => {};
  require('../dist/game/content/combat/magic/Autocasting').Autocasting.setAutocast = () => {};
  MaxGear.register({
    core,
    getBonusManager: () => ({ update() {} }),
    registerCommand: (name, handler, rights) => commands.set(name, { handler, rights }),
  });
});

test('::maxgear is a developer command', () => {
  assert.equal(commands.get('maxgear').rights, core.PlayerRights.DEVELOPER);
});

test('every set fits: each item goes in its slot, and no shield beside a two-handed weapon', () => {
  for (const style of ['melee', 'range', 'mage']) {
    for (const withVoid of [false, true]) {
      const set = MaxGear.loadoutFor(style, withVoid);
      for (const { slot, id } of set) {
        const cached = CacheDefinitions.getItem(id);
        assert.equal(cached?.wearPos, slot, `${style}${withVoid ? ' void' : ''}: ${cached?.name ?? id} in slot ${slot}`);
      }
      const weapon = CacheDefinitions.getItem(set.find((entry) => entry.slot === Equipment.WEAPON_SLOT).id);
      if (weapon.wearPos2 === SHIELD_SLOT) {
        assert.ok(!set.some((entry) => entry.slot === SHIELD_SLOT), `${style}: shield with a two-handed ${weapon.name}`);
      }
    }
  }
});

test('the worn gear goes to the bank and the set goes on', () => {
  const player = fakePlayer();
  player.worn[Equipment.WEAPON_SLOT] = new Item(I.ABYSSAL_WHIP, 1);
  player.worn[Equipment.HEAD_SLOT] = new Item(I.HELM_OF_NEITIZNOT, 1);
  commands.get('maxgear').handler({ player, parts: ['maxgear', 'melee'] });
  assert.deepEqual(player.banked.sort(), [I.ABYSSAL_WHIP, I.HELM_OF_NEITIZNOT].sort());
  assert.equal(player.worn[Equipment.WEAPON_SLOT].getId(), I.GHRAZI_RAPIER);
  assert.equal(player.worn[Equipment.HEAD_SLOT].getId(), I.TORVA_FULL_HELM);
});

test('void swaps the head, body, legs and hands for the style\'s void pieces', () => {
  const player = fakePlayer();
  commands.get('maxgear').handler({ player, parts: ['maxgear', 'range', 'void'] });
  const at = (slot) => player.worn[slot]?.getId();
  assert.equal(at(Equipment.HEAD_SLOT), I.VOID_RANGER_HELM);
  assert.equal(at(Equipment.BODY_SLOT), I.ELITE_VOID_TOP);
  assert.equal(at(Equipment.LEG_SLOT), I.ELITE_VOID_ROBE);
  assert.equal(at(Equipment.HANDS_SLOT), I.VOID_KNIGHT_GLOVES);
  assert.equal(at(Equipment.WEAPON_SLOT), I.TWISTED_BOW);
  assert.equal(player.worn[Equipment.AMMUNITION_SLOT].getAmount(), 5000);
});

test("mage gets a fully charged Tumeken's shadow", () => {
  const player = fakePlayer();
  commands.get('maxgear').handler({ player, parts: ['maxgear', 'magic'] });
  const staff = player.worn[Equipment.WEAPON_SLOT];
  assert.equal(staff.getId(), I.TUMEKENS_SHADOW);
  const { CHARGES_KEY } = require('../plugins/items/TumekensShadow.plugin');
  assert.equal(staff.getMetaValue(CHARGES_KEY), 20000);
});

test('a wrong style or flag only explains the usage', () => {
  for (const parts of [['maxgear'], ['maxgear', 'tank'], ['maxgear', 'melee', 'elite']]) {
    const player = fakePlayer();
    commands.get('maxgear').handler({ player, parts });
    assert.match(player.messages.at(-1), /::maxgear <melee\|range\|mage> \[void\]/);
    assert.ok(player.worn.every((item) => item == null), 'nothing put on');
  }
});

test('gear the player has not trained for is refused and stays in their inventory', () => {
  // item-gameplay.json is where the requirements come from, so load it the way the server does
  require('../plugins/items/ItemDefinitionLoader.plugin').register({
    log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
  });
  const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const player = fakePlayer();
  const levels = new Map([[core.Skill.RANGED, 74], [core.Skill.DEFENCE, 79]]);
  let combatLevel = 126;
  player.getSkillManager = () => ({
    getMaxLevel: (skill) => levels.get(skill) ?? 99,
    getCombatLevel: () => combatLevel,
    stopSkillable() {},
  });

  player.inventory[0] = new Item(I.TWISTED_BOW, 1);
  EquipPacketListener.equip(player, I.TWISTED_BOW, 0, Inventory.INTERFACE_ID);
  assert.equal(player.messages.at(-1), 'You need a Ranged level of at least 75 to wear this.');
  assert.equal(player.worn[Equipment.WEAPON_SLOT], null, 'not wielded');
  assert.equal(player.inventory[0].getId(), I.TWISTED_BOW, 'still in the inventory');

  player.inventory[0] = new Item(I.TORVA_FULL_HELM, 1);
  EquipPacketListener.equip(player, I.TORVA_FULL_HELM, 0, Inventory.INTERFACE_ID);
  assert.equal(player.messages.at(-1), 'You need a Defence level of at least 80 to wear this.');
  assert.equal(player.worn[Equipment.HEAD_SLOT], null, 'not worn');

  // A Black mask gates on combat level, which has no Skill of its own.
  levels.clear();
  combatLevel = 39;
  player.inventory[0] = new Item(I.BLACK_MASK, 1);
  EquipPacketListener.equip(player, I.BLACK_MASK, 0, Inventory.INTERFACE_ID);
  assert.equal(player.messages.at(-1), 'You need a combat level of at least 40 to wear this.');
  assert.equal(player.worn[Equipment.HEAD_SLOT], null, 'not worn');

  // Only the gate is under test, so everything past it is stubbed away.
  require('../dist/game/model/equipment/BonusManager').BonusManager.update = () => {};
  core.WeaponInterfaceManager.assign = () => {};
  combatLevel = 40;
  player.messages.length = 0;
  try {
    EquipPacketListener.equip(player, I.BLACK_MASK, 0, Inventory.INTERFACE_ID);
  } catch {
    /* the containers here are not a real player's */
  }
  assert.ok(!player.messages.some((message) => /to wear this/.test(message)),
    'the same mask goes on once the combat level is there');
});
