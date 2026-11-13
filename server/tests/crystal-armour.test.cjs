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
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const CrystalArmour = require("../plugins/items/CrystalArmour.plugin");
const EquipmentEffects = require("../plugins/combat/EquipmentEffects.plugin");

function makeApi(extra = {}) {
  const api = {
    core: { Equipment, ItemIdentifiers, Skill, CacheDefinitions },
    emitCustomEvent() {},
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
    items: [],
    getItems() { return this.items; },
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
  const prompts = [];
  const player = {
    messages,
    prompts,
    amountAction: null,
    setEnteredAmountAction(action) { player.amountAction = action; },
    getPacketSender: () => ({ sendEnterAmountPrompt: (text) => prompts.push(text) }),
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => equipment, refreshItems: () => {} }),
    getInventory: () => inventory,
    getCombat: () => ({ getTarget: () => null }),
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

const FULL_SET = {
  [Equipment.HEAD_SLOT]: ItemIds.CRYSTAL_HELM,
  [Equipment.BODY_SLOT]: ItemIds.CRYSTAL_BODY,
  [Equipment.LEG_SLOT]: ItemIds.CRYSTAL_LEGS,
};

const obj = (name) => CacheDefinitions.getObjId(name);

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
      hitTargetOf: (attacker) => attacker?.getCombat?.()?.getTarget?.() ?? null,
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

test("Check says how many charges remain, with a thousands separator, for every piece", () => {
  const player = createPlayer();
  for (const [id, charges, text] of [
    [ItemIds.CRYSTAL_HELM, 215, "Your crystal helm has 215 charges remaining."],
    [ItemIds.CRYSTAL_BODY, 20000, "Your crystal body has 20,000 charges remaining."],
    [ItemIds.CRYSTAL_LEGS, 150, "Your crystal legs has 150 charges remaining."],
  ]) {
    CrystalArmour._test.checkCharges({ player, item: item(id, { "crystal-armour": { charges } }) });
    assert.equal(player.messages.at(-1), text);
  }
});

function useShards(player, inventory, piece) {
  inventory.items = [piece];
  const event = { player, usedItem: item(ItemIds.CRYSTAL_SHARD), usedWithItem: piece };
  CrystalArmour._test.addShardCharges(event);
  return event;
}

test("crystal shards ask how many to add (the most rounded up to reach 20,000) and send no chat line", () => {
  const inventory = createInventory({ [ItemIds.CRYSTAL_SHARD]: 946 });
  const player = createPlayer({}, null, {}, inventory);
  const helm = item(ItemIds.CRYSTAL_HELM, { "crystal-armour": { charges: 215 } });
  assert.equal(useShards(player, inventory, helm).handled, true);
  assert.deepEqual(player.prompts, ["How many shards do you wish to add? (0 - 198)"]);
  assert.equal(inventory.getAmount(ItemIds.CRYSTAL_SHARD), 946, "nothing is taken before the answer");
  player.amountAction.execute(198);
  assert.equal(inventory.getAmount(ItemIds.CRYSTAL_SHARD), 748);
  assert.equal(CrystalArmour._test.charges(helm), 20000);
  assert.deepEqual(player.messages, []);

  const fresh = item(ItemIds.CRYSTAL_BODY);
  useShards(player, inventory, fresh);
  assert.equal(player.prompts.at(-1), "How many shards do you wish to add? (0 - 175)");
  player.amountAction.execute(5);
  assert.equal(CrystalArmour._test.charges(fresh), 3000);
});

test("shards revive an inactive piece in its own colour; a full piece takes none", () => {
  const inventory = createInventory({ [ItemIds.CRYSTAL_SHARD]: 1 });
  const player = createPlayer({}, null, {}, inventory);
  const inactive = item(obj("crystal_helmet_inactive_iorwerth"));
  useShards(player, inventory, inactive);
  assert.equal(player.prompts.at(-1), "How many shards do you wish to add? (0 - 200)");
  player.amountAction.execute(200);
  assert.equal(inactive.getId(), obj("crystal_helmet_iorwerth"));
  assert.equal(CrystalArmour._test.charges(inactive), 100);
  assert.equal(inventory.getAmount(ItemIds.CRYSTAL_SHARD), 0);

  const shards = createInventory({ [ItemIds.CRYSTAL_SHARD]: 9 });
  const other = createPlayer({}, null, {}, shards);
  const full = item(ItemIds.CRYSTAL_HELM, { "crystal-armour": { charges: 20000 } });
  useShards(other, shards, full);
  assert.equal(other.prompts.length, 0);
  assert.equal(shards.getAmount(ItemIds.CRYSTAL_SHARD), 9);
  assert.match(other.messages.at(-1), /cannot hold any more charges/);
});

test("every clan colour and the Deadman pieces keep charges like the base piece", () => {
  for (const colour of ["hefin", "ithell", "iorwerth", "trahaearn", "cadarn", "crwys", "amlodd", "deadman"]) {
    for (const [piece, slot] of [["crystal_helmet", Equipment.HEAD_SLOT], ["crystal_chestplate", Equipment.BODY_SLOT], ["crystal_platelegs", Equipment.LEG_SLOT]]) {
      const id = obj(`${piece}_${colour}`);
      assert.ok(id != null, `${piece}_${colour}`);
      assert.ok(CrystalArmour._test.pieceOf(id), `${piece}_${colour} is a crystal armour piece`);
      assert.equal(CrystalArmour._test.inactiveOf(id), obj(`${piece}_inactive_${colour}`));
      const worn = item(id, { "crystal-armour": { charges: 1 } });
      const player = createPlayer({ [slot]: id });
      player.getEquipment().getItems()[slot] = worn;
      assert.ok(CrystalArmour._test.bonus(player).accuracy > 0, "the colour gives the set bonus");
      CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 3 });
      assert.equal(worn.getId(), obj(`${piece}_inactive_${colour}`), "it goes inactive in its colour");
    }
  }
  const player = createPlayer();
  CrystalArmour._test.checkCharges({ player, item: item(obj("crystal_helmet_iorwerth"), { "crystal-armour": { charges: 215 } }) });
  assert.equal(player.messages.at(-1), "Your crystal helm has 215 charges remaining.");
});

test("a worn elven or celestial signet gives each piece a 10% chance to keep its charge", () => {
  for (const ring of [ItemIdentifiers.ELVEN_SIGNET, ItemIdentifiers.CELESTIAL_SIGNET]) {
    const player = createPlayer(FULL_SET);
    player.getEquipment().getItems()[Equipment.RING_SLOT] = item(ring);
    const rolls = [0.05, 0.5, 0.099];
    CrystalArmour._test.onIncomingDamage(player, { getDamage: () => 4 }, () => rolls.shift());
    const items = player.getEquipment().getItems();
    const left = [Equipment.HEAD_SLOT, Equipment.BODY_SLOT, Equipment.LEG_SLOT].map((slot) => CrystalArmour._test.charges(items[slot]));
    assert.deepEqual(left, [2500, 2499, 2500]);
  }
  const plain = createPlayer(FULL_SET);
  CrystalArmour._test.onIncomingDamage(plain, { getDamage: () => 4 }, () => 0);
  assert.equal(CrystalArmour._test.charges(plain.getEquipment().getItems()[Equipment.HEAD_SLOT]), 2499, "no signet, no save");
});

test("inactive crystal armour can be worn: no equip check stops it", () => {
  const hooks = [];
  CrystalArmour.register(makeApi({ onCanEquip: (fn) => hooks.push(fn) }));
  assert.equal(hooks.length, 0);
});


test("reverting a crystal armour piece returns its seeds and forfeits the charges", () => {
  for (const [name, seeds] of [["crystal_helmet", 1], ["crystal_chestplate", 3], ["crystal_platelegs_cadarn", 2], ["crystal_helmet_inactive_hefin", 1]]) {
    const inventory = createInventory({ [ItemIds.CRYSTAL_ARMOUR_SEED]: 0 });
    const player = createPlayer({}, null, {}, inventory);
    const armour = item(obj(name), { "crystal-armour": { charges: 1234 } });
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
    // The weapon interface, as a real Player has (WeaponProfiles reads it for the max-hit formula): none, unarmed.
    getWeapon: () => require("../dist/game/content/combat/WeaponInterfaces").WeaponInterfaces.UNARMED,
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

test("the full set of active pieces shows the crystal armour text in the equipment effects panel", () => {
  const shown = (player) => {
    const request = { player, lines: [], setTexts: [] };
    CrystalArmour._test.addSetText(request);
    return request.setTexts;
  };
  assert.deepEqual(shown(createPlayer(FULL_SET, null)), [24], "shown with any weapon");
  const { [Equipment.LEG_SLOT]: _legs, ...noLegs } = FULL_SET;
  assert.deepEqual(shown(createPlayer(noLegs)), []);
  const inactive = { ...FULL_SET, [Equipment.BODY_SLOT]: CrystalArmour._test.inactiveOf(ItemIds.CRYSTAL_BODY) };
  assert.deepEqual(shown(createPlayer(inactive)), []);
});
