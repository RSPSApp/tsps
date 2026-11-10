// Run after `yarn build`: node --test tests/serpentine-helm.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { ItemIds } = require("../dist/util/IdEnums");

const SerpentineHelm = require("../plugins/items/SerpentineHelm.plugin");

const poisoned = [];
let cycle = 100;
let hitResolved;
const weaponNames = new Map([
  [1001, "Rune scimitar"],
  [1002, "Rune dagger(p++)"],
  [ItemIds.ABYSSAL_TENTACLE, "Abyssal tentacle"],
  [ItemIds.ABYSSAL_TENTACLE_OR_, "Abyssal tentacle (or)"],
  [ItemIds.TRIDENT_OF_THE_SWAMP_O_, "Trident of the Swamp (o)"],
  [ItemIds.TRIDENT_OF_THE_SWAMP_E_O_, "Trident of the Swamp (e) (o)"],
  [ItemIds.RUNE_ARROW_P_PLUS_PLUS_, "Rune arrow(p++)"],
  [ItemIds.EMERALD_BOLTS_E_, "Emerald bolts (e)"],
  [ItemIds.NOXIOUS_HALBERD, "Noxious halberd"],
  [ItemIds.TOXIC_BLOWPIPE, "Toxic blowpipe"],
  [ItemIds.TRIDENT_OF_THE_SWAMP_E_, "Trident of the Swamp (e)"],
]);
SerpentineHelm.register({
  core: {
    ItemIdentifiers: ItemIds,
    Equipment, CombatType,
    Item: require("../dist/game/model/Item").Item,
    World: { getProcessCycle: () => cycle },
    ItemDefinition: { forId: (id) => ({ getName: () => weaponNames.get(id) ?? "" }) },
    CombatFactory: { poisonEntity: (target, severity, orb) => poisoned.push({ target, severity, orb }) },
  },
  persistAttribute() {},
  onItemAction() {},
  onItemOnItem() {},
  onCombatHitResolved(handler) { hitResolved = handler; },
  onPlayerProcess() {},
});

function item(id, meta = {}) {
  return {
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
}

function createPlayer({ helm = null, weapon = 0, inCombat = true, scales = 0, ammo = null, defending = false } = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (helm) equipment[Equipment.HEAD_SLOT] = helm;
  if (weapon) equipment[Equipment.WEAPON_SLOT] = item(weapon);
  const attributes = new Map();
  const immunity = { starts: 0, protectBriefly(seconds, venom) { assert.equal(seconds, 2); assert.equal(venom, true); this.starts++; } };
  const messages = [];
  const player = {
    attributes,
    immunity,
    messages,
    getEquipment: () => ({ get: (slot) => equipment[slot], refreshItems: () => {} }),
    getInventory: () => ({
      getAmount: () => scales,
      deleteNumber: () => {},
      getFreeSlots: () => 10,
      getAddableAmount: (refund) => refund.getAmount(),
      addItem: () => {},
      refreshItems: () => {},
    }),
    getCombat: () => ({ getTarget: () => (inCombat ? {} : null), getAttacker: () => defending ? {} : null, getAmmunition: () => ammo == null ? null : { getItemId: () => ammo }, getPoisonImmunityTimer: () => immunity }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
  return player;
}

test("the charged helm grants poison/venom immunity and spends scales in combat", () => {
  cycle = 100;
  const helm = item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 });
  const player = createPlayer({ helm });
  SerpentineHelm._test.processUpkeep(player);
  assert.equal(player.immunity.starts, 1, "the immunity timer is kept alive");
  assert.equal(SerpentineHelm._test.charges(helm), 90);
  SerpentineHelm._test.processUpkeep(player);
  assert.equal(SerpentineHelm._test.charges(helm), 90, "under 90 ticks spends nothing");
  cycle = 200;
  SerpentineHelm._test.processUpkeep(player);
  assert.equal(SerpentineHelm._test.charges(helm), 80);

  const idle = createPlayer({ helm, inCombat: false });
  idle.attributes.set("serpentine:combat-charge-tick", 100);
  SerpentineHelm._test.processUpkeep(idle);
  assert.equal(idle.attributes.get("serpentine:combat-charge-tick"), null);
});

test("the envenom chance depends on the weapon: 1/6 plain, 1/2 poisoned, 100% toxic", () => {
  const plain = createPlayer({ helm: item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 }), weapon: 1001 });
  assert.ok(Math.abs(SerpentineHelm._test.venomChance(plain, CombatType.MELEE) - 1 / 6) < 1e-9);
  const poisonedWeapon = createPlayer({ helm: item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 }), weapon: 1002 });
  assert.equal(SerpentineHelm._test.venomChance(poisonedWeapon, CombatType.MELEE), 0.5);
  const toxic = createPlayer({ helm: item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 }), weapon: ItemIds.TOXIC_BLOWPIPE });
  assert.equal(SerpentineHelm._test.venomChance(toxic, CombatType.RANGED), 1);
});

test("a successful hit on a monster can envenom it, but never a player", () => {
  poisoned.length = 0;
  const helm = item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 });
  const player = createPlayer({ helm, weapon: ItemIds.TOXIC_BLOWPIPE });
  const npc = { isNpc: () => true, isVenomed: () => false };
  const hit = { isAccurate: () => true, getTotalDamage: () => 5, getCombatType: () => CombatType.RANGED };
  const original = Math.random;
  try {
    Math.random = () => 0.99;
    hitResolved({ attacker: player, target: npc, hit });
  } finally {
    Math.random = original;
  }
  assert.equal(poisoned.length, 1, "toxic blowpipe guarantees the proc");
  assert.deepEqual(poisoned[0], { target: npc, severity: 6, orb: 2 });

  const pvp = { isNpc: () => false };
  SerpentineHelm._test.onHitResolved({ attacker: player, target: pvp, hit });
  assert.equal(poisoned.length, 1, "the helm never envenoms players");
});

test("scales charge the helm and uncharging returns them", () => {
  const helm = item(ItemIds.SERPENTINE_HELM_UNCHARGED_);
  const player = createPlayer({ helm, scales: 300 });
  SerpentineHelm._test.chargeHelm({
    player,
    usedItem: helm,
    usedWithItem: item(ItemIds.ZULRAHS_SCALES),
    usedItemId: ItemIds.SERPENTINE_HELM_UNCHARGED_,
    usedWithItemId: ItemIds.ZULRAHS_SCALES,
    handled: false,
  });
  assert.equal(helm.getId(), ItemIds.SERPENTINE_HELM);
  assert.equal(SerpentineHelm._test.charges(helm), 300);
  SerpentineHelm._test.uncharge({ player, item: helm });
  assert.equal(helm.getId(), ItemIds.SERPENTINE_HELM_UNCHARGED_);
});


test('charging leaves unrelated target items and their materials untouched', () => {
  const target=item(12924),material=item(ItemIds.ZULRAHS_SCALES),player=createPlayer();
  player.getInventory=()=>({getAmount:()=>100,deleteNumber:()=>{throw Error('unrelated charge consumed material');}});
  const event={player,usedItem:material,usedWithItem:target,usedItemId:material.getId(),usedWithItemId:target.getId()};
  SerpentineHelm._test.chargeHelm(event);
  assert.equal(event.handled,undefined);assert.deepEqual(target.meta,{});
});

// Serpentine helm and Venom Wiki: only the basic non-poisoned chance is melee-only.
function resolve({ weapon = 1001, type = CombatType.MELEE, helmId = ItemIds.SERPENTINE_HELM,
  roll = 0, damage = 5, accurate = true, targetIsPlayer = false, ammo = null } = {}) {
  poisoned.length = 0;
  const player = createPlayer({ helm: item(helmId, { "serpentine-helm": 100 }), weapon, ammo });
  const npc = { isNpc: () => !targetIsPlayer, isVenomed: () => false };
  const hit = { isAccurate: () => accurate, getTotalDamage: () => damage, getCombatType: () => type };
  const original = Math.random;
  try {
    Math.random = () => roll;
    hitResolved({ attacker: player, target: npc, hit });
  } finally { Math.random = original; }
  return poisoned.length;
}

test("ordinary ranged and magic hits cannot use the helm's basic melee venom chance", () => {
  for (const type of [CombatType.RANGED, CombatType.MAGIC]) {
    assert.equal(resolve({ type }), 0, `combat type ${type}`);
  }
  assert.equal(resolve(), 1);
  assert.equal(resolve({ roll: 1 / 6 }), 0);
});

// The halberd's own 1/3 melee roll follows the helm's: 1/4 + 3/4 * 1/3 = the Wiki's 1/2.
test("the noxious halberd's helm roll is 1/4, making 1/2 with its own 1/3", () => {
  assert.equal(resolve({ weapon: ItemIds.NOXIOUS_HALBERD, roll: 0.24 }), 1);
  assert.equal(resolve({ weapon: ItemIds.NOXIOUS_HALBERD, roll: 0.25 }), 0);
});

for (const weapon of [ItemIds.ABYSSAL_TENTACLE, ItemIds.ABYSSAL_TENTACLE_OR_]) {
  test(`poisonous melee weapon ${weapon} has a 50% helm chance`, () => {
    assert.equal(resolve({ weapon, roll: 0.49 }), 1);
    assert.equal(resolve({ weapon, roll: 0.5 }), 0);
  });
}

for (const weapon of [ItemIds.TRIDENT_OF_THE_SWAMP_E_, ItemIds.TRIDENT_OF_THE_SWAMP_O_, ItemIds.TRIDENT_OF_THE_SWAMP_E_O_]) {
  test(`toxic trident variant ${weapon} guarantees venom`, () => {
    assert.equal(resolve({ weapon, type: CombatType.MAGIC, roll: 0.99 }), 1);
  });
}

for (const [charged, empty] of [[ItemIds.TANZANITE_HELM, ItemIds.TANZANITE_HELM_UNCHARGED_],
  [ItemIds.MAGMA_HELM, ItemIds.MAGMA_HELM_UNCHARGED_]]) {
  test(`recoloured helm ${charged} provides immunity and venom and keeps its colour when depleted`, () => {
    assert.equal(resolve({ helmId: charged }), 1);
    const helm = item(charged, { "serpentine-helm": 20 });
    const player = createPlayer({ helm });
    cycle = 100;
    SerpentineHelm._test.processUpkeep(player);
    assert.equal(player.immunity.starts, 1);
    assert.equal(SerpentineHelm._test.charges(helm), 10);
    cycle = 190;
    SerpentineHelm._test.processUpkeep(player);
    assert.equal(helm.getId(), empty);
    assert.equal(SerpentineHelm._test.charges(helm), 0);
  });
}

test("selected poisoned ammunition gets 50%, but enchanted emerald bolts do not", () => {
  assert.equal(resolve({ type: CombatType.RANGED, ammo: ItemIds.RUNE_ARROW_P_PLUS_PLUS_, roll: 0.49 }), 1);
  assert.equal(resolve({ type: CombatType.RANGED, ammo: ItemIds.RUNE_ARROW_P_PLUS_PLUS_, roll: 0.5 }), 0);
  assert.equal(resolve({ type: CombatType.RANGED, ammo: ItemIds.EMERALD_BOLTS_E_ }), 0);
  assert.equal(resolve({ type: CombatType.MAGIC, weapon: 1002 }), 0, "a poisoned dagger cannot poison a spell");
});

test("helm procs require damage and never affect players", () => {
  assert.equal(resolve({ damage: 0 }), 0);
  assert.equal(resolve({ accurate: false }), 0);
  assert.equal(resolve({ targetIsPlayer: true }), 0);
});

test("being attacked with retaliation off still consumes scales", () => {
  cycle = 100;
  const helm = item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 });
  const player = createPlayer({ helm, inCombat: false, defending: true });
  SerpentineHelm._test.processUpkeep(player);
  assert.equal(SerpentineHelm._test.charges(helm), 90);
});

test("uncharging can return scales to an existing stack in a full inventory", () => {
  const helm = item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 });
  const player = createPlayer({ helm });
  let scales = 50;
  player.getInventory = () => ({
    getFreeSlots: () => 0,
    getAddableAmount: refund => refund.getId() === ItemIds.ZULRAHS_SCALES ? refund.getAmount() : 0,
    addItem: refund => { scales += refund.getAmount(); },
    refreshItems() {},
  });
  SerpentineHelm._test.uncharge({ player, item: helm });
  assert.equal(scales, 150);
  assert.equal(helm.getId(), ItemIds.SERPENTINE_HELM_UNCHARGED_);
});

test("uncharging without room preserves the helmet and all scales", () => {
  const helm = item(ItemIds.MAGMA_HELM, { "serpentine-helm": 100 });
  const player = createPlayer({ helm });
  player.getInventory = () => ({ getFreeSlots: () => 0, getAddableAmount: () => 0 });
  SerpentineHelm._test.uncharge({ player, item: helm });
  assert.equal(helm.getId(), ItemIds.MAGMA_HELM);
  assert.equal(SerpentineHelm._test.charges(helm), 100);
});

test("charging reports total scales and percentage as in recording 1074", () => {
  const helm = item(ItemIds.SERPENTINE_HELM_UNCHARGED_);
  const player = createPlayer({ helm, scales: 12373 });
  const inventory = player.getInventory();
  let removed = 0;
  inventory.deleteNumber = (id, count) => { assert.equal(id, ItemIds.ZULRAHS_SCALES); removed += count; };
  player.getInventory = () => inventory;
  SerpentineHelm._test.chargeHelm({ player, usedItem: helm,
    usedWithItem: item(ItemIds.ZULRAHS_SCALES), usedItemId: helm.getId(), usedWithItemId: ItemIds.ZULRAHS_SCALES });
  assert.equal(removed, 11000);
  assert.equal(SerpentineHelm._test.charges(helm), 11000);
  assert.equal(player.messages.at(-1), "Scales: <col=007f00>11,000 (100.0%)</col>");
});
