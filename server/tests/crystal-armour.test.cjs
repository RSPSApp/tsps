// Run after `yarn build`: node --test tests/crystal-armour.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();

const { Skill } = require("../dist/game/model/Skill");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const CrystalArmour = require("../plugins/items/CrystalArmour.plugin");
const EquipmentEffects = require("../plugins/combat/EquipmentEffects.plugin");

let songComplete = true;

class CreationMenu {
  constructor(title, items, action) {
    this.title = title;
    this.items = items;
    this.action = action;
  }

  execute(itemId, amount) {
    this.action.execute(itemId, amount);
  }
}

function makeApi(extra = {}) {
  const api = {
    core: { Equipment, ItemIdentifiers, Skill, CreationMenu },
    emitCustomEvent(name, request) {
      if (name === "quest:is-complete" && request.key === "song_of_the_elves") {
        request.complete = songComplete;
      }
    },
    registerRangedAttackAccuracyModifier() {},
    registerRangedHitModifier() {},
    registerIncomingDamageModifier() {},
    onCanEquip() {},
    onItemAction() {},
    onItemOnItem() {},
    onItemOnObject() {},
    ...extra,
  };
  return new Proxy(api, {
    get(target, property) {
      return property in target ? target[property] : () => {};
    },
  });
}

CrystalArmour.register(makeApi());

function item(id, meta = {}) {
  const value = {
    id,
    meta: { ...meta },
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, next) {
      if (next === undefined) delete this.meta[key];
      else this.meta[key] = next;
    },
  };
  return value;
}

function createInventory(counts = {}) {
  const amounts = new Map(Object.entries(counts).map(([id, amount]) => [Number(id), amount]));
  return {
    getAmount: (id) => amounts.get(id) ?? 0,
    deleteNumber(id, amount) {
      const left = (amounts.get(id) ?? 0) - amount;
      if (left > 0) amounts.set(id, left);
      else amounts.delete(id);
    },
    deleteItem(item) {
      this.deleteNumber(item.getId(), 1);
    },
    adds(id, amount) {
      amounts.set(id, (amounts.get(id) ?? 0) + amount);
    },
    getFreeSlots: () => 28,
    refreshItems() {},
  };
}

function createPlayer(worn = {}, weapon = ItemIds.CRYSTAL_BOW, meta = {}, inventory = createInventory()) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  for (const [slot, id] of Object.entries(worn)) {
    equipment[Number(slot)] = item(id, meta[Number(slot)]);
  }
  if (weapon) equipment[Equipment.WEAPON_SLOT] = item(weapon);
  const messages = [];
  const player = {
    messages,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => equipment, refreshItems: () => {} }),
    getInventory: () => inventory,
    getCombat: () => ({ getTarget: () => null }),
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

function craftingPlayer({ seeds = 0, shards = 0, crafting = 74, smithing = 74 } = {}) {
  const inventory = createInventory({
    [ItemIds.CRYSTAL_ARMOUR_SEED]: seeds,
    [ItemIds.CRYSTAL_SHARD]: shards,
  });
  const xp = [];
  const levels = new Map([[Skill.CRAFTING, crafting], [Skill.SMITHING, smithing]]);
  const messages = [];
  const menus = [];
  const player = {
    messages,
    menus,
    inventory,
    xp,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => new Array(14).fill(null).map(() => item(0)), refreshItems: () => {} }),
    getInventory: () => inventory,
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill) ?? 1,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getPacketSender: () => ({
      sendSound: () => {},
      sendCreationMenu: (menu) => menus.push(menu),
    }),
    performAnimation: () => {},
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

const FULL_SET = {
  [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM,
  [Equipment.BODY_SLOT]: ItemIds.CRYSTAL_BODY,
  [Equipment.LEG_SLOT]: ItemIds.CRYSTAL_LEGS,
};

const RECIPE = Object.fromEntries(CrystalArmour._test.PIECES.map((piece) => [piece.itemName, piece]));

test("a full charged crystal armour set gives 30% accuracy and 15% damage to crystal bows", () => {
  const player = createPlayer(FULL_SET);
  const bonus = CrystalArmour._test.bonus(player);
  assert.ok(Math.abs(bonus.accuracy - 0.30) < 1e-9);
  assert.ok(Math.abs(bonus.damage - 0.15) < 1e-9);
  assert.ok(Math.abs(CrystalArmour._test.applyCrystalAccuracy(player, 100) - 130) < 1e-9);
  assert.ok(Math.abs(CrystalArmour._test.applyCrystalDamage(player, 100) - 115) < 1e-9);
});

test("the bonus is applied once, by the item plugin rather than EquipmentEffects", () => {
  const rangedHits = [];
  const rangedAccuracy = [];
  EquipmentEffects.register(new Proxy({
    core: {},
    getCombatFactory: () => ({ inCombat: () => false }),
    onCustomEvent: () => {},
    registerRangedHitModifier: (fn) => rangedHits.push(fn),
    registerRangedAttackAccuracyModifier: (fn) => rangedAccuracy.push(fn),
  }, {
    get: (target, property) => (property in target ? target[property] : () => {}),
  }));

  const player = createPlayer(FULL_SET);
  assert.equal(rangedHits.reduce((value, fn) => fn(player, value), 100), 100);
  assert.equal(rangedAccuracy.reduce((value, fn) => fn(player, value), 100), 100);

  const pluginHits = [];
  const pluginAccuracy = [];
  CrystalArmour.register(makeApi({
    registerRangedHitModifier: (fn) => pluginHits.push(fn),
    registerRangedAttackAccuracyModifier: (fn) => pluginAccuracy.push(fn),
  }));
  assert.ok(Math.abs(pluginHits.reduce((value, fn) => fn(player, value), 100) - 115) < 1e-9);
  assert.ok(Math.abs(pluginAccuracy.reduce((value, fn) => fn(player, value), 100) - 130) < 1e-9);
});

test("per-piece bonuses only count while charged, and only for crystal weapons", () => {
  const helmOnly = createPlayer({ [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM });
  const helmBonus = CrystalArmour._test.bonus(helmOnly);
  assert.ok(Math.abs(helmBonus.accuracy - 0.05) < 1e-9);
  assert.ok(Math.abs(helmBonus.damage - 0.025) < 1e-9);

  const inactiveBody = createPlayer({
    [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM,
    [Equipment.BODY_SLOT]: ItemIds.CRYSTAL_HELM_INACTIVE_,
  });
  assert.deepEqual(CrystalArmour._test.bonus(inactiveBody), helmBonus, "an inactive piece gives nothing");

  const wrongWeapon = createPlayer(FULL_SET, ItemIds.DRAGON_SCIMITAR);
  assert.deepEqual(CrystalArmour._test.bonus(wrongWeapon), { accuracy: 0, damage: 0 });
});

test("the slayer helmet (i) multiplies the body+legs damage bonus to about 29.375%", () => {
  const NAMES = new Map([[ItemIdentifiers.SLAYER_HELMET_I_, "Slayer helmet (i)"]]);
  let onTask = true;
  let salve = false;
  const SlayerHelmet = require("../plugins/items/SlayerHelmet.plugin");
  SlayerHelmet.register({
    core: {
      ItemIdentifiers,
      Skill,
      Equipment,
      ItemDefinition: { forId: (id) => ({ getName: () => NAMES.get(id) ?? "" }) },
      CacheDefinitions: { getVarbitId: () => null },
    },
    emitCustomEvent(name, request) {
      if (name === "slayer:on-task") request.onTask = onTask;
      if (name === "salve:applies") request.applies = salve;
    },
    registerMeleeAttackAccuracyModifier() {},
    registerMeleeHitModifier() {},
    registerRangedAttackAccuracyModifier() {},
    registerRangedHitModifier() {},
    registerMagicAttackAccuracyModifier() {},
    registerMagicHitModifier() {},
    onCustomEvent() {},
    onItemOnItem() {},
    onItemAction() {},
  });

  const player = createPlayer({
    [Equipment.HEAD_SLOT]: ItemIdentifiers.SLAYER_HELMET_I_,
    [Equipment.BODY_SLOT]: ItemIds.CRYSTAL_BODY,
    [Equipment.LEG_SLOT]: ItemIds.CRYSTAL_LEGS,
  });
  player.getCombat = () => ({ getTarget: () => ({ isNpc: () => true, getAsNpc: () => ({}) }) });

  const crystalDamage = CrystalArmour._test.applyCrystalDamage(player, 1000);
  assert.ok(Math.abs(crystalDamage - 1125) < 1e-9, "body+legs = +12.5%");
  const combined = SlayerHelmet._test.rangedDamageBoost(player, crystalDamage);
  assert.ok(Math.abs(combined / 1000 - 1.29375) < 0.001, "1.15 x 1.125 = 1.29375");

  salve = true;
  assert.equal(SlayerHelmet._test.rangedDamageBoost(player, crystalDamage), crystalDamage, "a salve wins over the helmet");
  salve = false;
  onTask = false;
  assert.equal(SlayerHelmet._test.rangedDamageBoost(player, crystalDamage), crystalDamage, "off task there is no helmet boost");
});

test("pieces start at 2,500 charges, lose one per hit and deactivate at zero", () => {
  const helm = item(ItemIds.CRYSTAL_HELM);
  const player = createPlayer({ [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM });
  player.getEquipment().getItems()[Equipment.HEAD_SLOT] = helm;
  assert.equal(CrystalArmour._test.charges(helm), 2500);

  CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 0 });
  assert.equal(CrystalArmour._test.charges(helm), 2500, "a fully reduced hit spends nothing");

  CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 5 });
  assert.equal(CrystalArmour._test.charges(helm), 2499);

  helm.setMetaValue("crystal-armour", { charges: 1 });
  CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 5 });
  assert.equal(helm.getId(), ItemIds.CRYSTAL_HELM_INACTIVE_);
  assert.match(player.messages.at(-1), /run out of charges/);
});

test("crystal shards add 100 charges each up to 20,000 and reactivate the piece", () => {
  const inventory = createInventory({ [ItemIds.CRYSTAL_SHARD]: 10 });
  const helm = item(ItemIds.CRYSTAL_HELM, { "crystal-armour": { charges: 19950 } });
  const player = createPlayer({ [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM }, null, {}, inventory);
  player.getEquipment().getItems()[Equipment.HEAD_SLOT] = helm;

  CrystalArmour._test.addShardCharges({ player, usedItem: helm, usedWithItem: item(ItemIds.CRYSTAL_SHARD) });
  assert.equal(CrystalArmour._test.charges(helm), 20000);
  assert.equal(inventory.getAmount(ItemIds.CRYSTAL_SHARD), 9, "only the shards that fit are used");

  const inactive = item(ItemIds.CRYSTAL_HELM_INACTIVE_);
  player.getEquipment().getItems()[Equipment.HEAD_SLOT] = inactive;
  const oneShard = createInventory({ [ItemIds.CRYSTAL_SHARD]: 1 });
  const rechargePlayer = createPlayer({}, null, {}, oneShard);
  rechargePlayer.getEquipment().getItems()[Equipment.HEAD_SLOT] = inactive;
  CrystalArmour._test.addShardCharges({ player: rechargePlayer, usedItem: oneShard, usedWithItem: inactive });
  assert.equal(inactive.getId(), ItemIds.CRYSTAL_HELM, "the active id comes back");
  assert.equal(CrystalArmour._test.charges(inactive), 100);
  assert.equal(oneShard.getAmount(ItemIds.CRYSTAL_SHARD), 0);

  const full = item(ItemIds.CRYSTAL_HELM, { "crystal-armour": { charges: 20000 } });
  player.getEquipment().getItems()[Equipment.HEAD_SLOT] = full;
  CrystalArmour._test.addShardCharges({ player, usedItem: full, usedWithItem: item(ItemIds.CRYSTAL_SHARD) });
  assert.equal(inventory.getAmount(ItemIds.CRYSTAL_SHARD), 9);
  assert.match(player.messages.at(-1), /cannot hold any more charges/);
});

test("inactive crystal armour cannot be equipped", () => {
  const player = createPlayer();
  const event = { player, item: item(ItemIds.CRYSTAL_BODY_INACTIVE_), allow: null };
  CrystalArmour._test.canEquip(event);
  assert.equal(event.allow, false);
  assert.match(player.messages.at(-1), /inactive/);

  const active = { player, item: item(ItemIds.CRYSTAL_BODY), allow: null };
  CrystalArmour._test.canEquip(active);
  assert.equal(active.allow, null);
});

test("crystal armour is sung from seeds and shards with the wiki levels and Song of the Elves", () => {
  const helm = RECIPE["Crystal helm"];

  songComplete = false;
  let player = craftingPlayer({ seeds: 1, shards: 50 });
  assert.equal(CrystalArmour._test.makeArmour(player, helm, 1), false);
  assert.equal(player.inventory.getAmount(ItemIds.CRYSTAL_ARMOUR_SEED), 1);
  assert.match(player.messages.at(-1), /Song of the Elves/);

  songComplete = true;
  player = craftingPlayer({ seeds: 1, shards: 50, crafting: 69, smithing: 69 });
  assert.equal(CrystalArmour._test.makeArmour(player, helm, 1), false);
  assert.equal(player.inventory.getAmount(ItemIds.CRYSTAL_ARMOUR_SEED), 1);
  assert.match(player.messages.at(-1), /level 70/);

  player = craftingPlayer({ seeds: 1, shards: 50 });
  assert.equal(CrystalArmour._test.makeArmour(player, helm, 1), true);
  assert.equal(player.inventory.getAmount(ItemIds.CRYSTAL_ARMOUR_SEED), 0);
  assert.equal(player.inventory.getAmount(ItemIds.CRYSTAL_SHARD), 0);
  assert.equal(player.inventory.getAmount(ItemIds.CRYSTAL_HELM), 1);
  assert.deepEqual(player.xp, [[Skill.SMITHING, 2500], [Skill.CRAFTING, 2500]]);

  const body = RECIPE["Crystal body"];
  player = craftingPlayer({ seeds: 3, shards: 150 });
  assert.equal(CrystalArmour._test.makeArmour(player, body, 1), true);
  assert.equal(player.inventory.getAmount(ItemIds.CRYSTAL_BODY), 1);
  assert.deepEqual(player.xp, [[Skill.SMITHING, 7500], [Skill.CRAFTING, 7500]]);

  songComplete = false;
});

test("using a seed on a singing bowl opens the armour menu after the quest", () => {
  const calls = [];
  CrystalArmour.register(makeApi({
    onItemOnObject: (...args) => calls.push(args),
  }));
  assert.ok(calls.some(([itemName, objectName, , filter]) =>
    itemName === "Crystal armour seed" && objectName === "Singing bowl" && filter?.noted === false));

  const player = craftingPlayer({ seeds: 3, shards: 150 });
  songComplete = false;
  assert.equal(CrystalArmour._test.useSeedOnBowl({ player }), true);
  assert.equal(player.menus.length, 0);
  assert.match(player.messages.at(-1), /Song of the Elves/);

  songComplete = true;
  assert.equal(CrystalArmour._test.useSeedOnBowl({ player }), true);
  assert.equal(player.menus.length, 1);
  assert.deepEqual(player.menus[0].items, [ItemIds.CRYSTAL_HELM, ItemIds.CRYSTAL_BODY, ItemIds.CRYSTAL_LEGS]);
  songComplete = false;
});

test("reverting a crystal armour piece returns its seeds and forfeits the charges", () => {
  for (const [name, seeds] of [["Crystal helm", 1], ["Crystal body", 3], ["Crystal legs", 2]]) {
    const piece = RECIPE[name];
    const inventory = createInventory({ [ItemIds.CRYSTAL_ARMOUR_SEED]: 0 });
    const player = createPlayer({}, null, {}, inventory);
    const armour = item(ItemIds[piece.activeIdName], { "crystal-armour": { charges: 1234 } });
    inventory.adds(armour.getId(), 1);

    CrystalArmour._test.dismantle({ player, item: armour, interfaceId: 3214, slot: 0 });
    assert.equal(inventory.getAmount(ItemIds.CRYSTAL_ARMOUR_SEED), seeds, name);
    assert.equal(inventory.getAmount(armour.getId()), 0, name);
    assert.equal(armour.getMetaValue("crystal-armour"), undefined, "charges are lost");
  }
});

test("ranged hit modifiers now reach the ranged max-hit formula", () => {
  const { registerRangedHitModifier } = require("../dist/game/content/combat/EquipmentEffects");
  const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
  const { FightStyle } = require("../dist/game/content/combat/FightStyle");
  const { CombatType } = require("../dist/game/content/combat/CombatType");

  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return this; },
    getSkillManager: () => ({ getCurrentLevel: (skill) => (skill === Skill.RANGED ? 99 : 1) }),
    getFightType: () => ({ getStyle: () => FightStyle.ACCURATE }),
    getBonusManager: () => ({ getOtherBonus: () => [0, 0, 0, 0] }),
    getEquipment: () => ({ getItems: () => new Array(14).fill(null).map(() => ({ getId: () => 0 })) }),
    isSpecialActivated: () => false,
    getCombatSpecial: () => null,
    getPrayerActive: () => new Array(30).fill(false),
  };
  const base = DamageFormulas.calculateMaxRangedHit(player);
  assert.equal(base, 11, "Ranged 99 accurate with no bonus");
  registerRangedHitModifier((_entity, hit) => hit * 2);
  assert.equal(DamageFormulas.calculateMaxRangedHit(player), 22, "the registered modifier applies");
  void CombatType;
});
