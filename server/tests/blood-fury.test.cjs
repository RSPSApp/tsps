// Run after `yarn build`: node --test tests/blood-fury.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { CombatMethod } = require("../dist/game/content/combat/method/CombatMethod");
const { Misc } = require("../dist/util/Misc");

const BloodFury = require("../plugins/items/AmuletOfBloodFury.plugin");

const itemOnItem = new Map();
const itemActions = new Map();
let itemAction;
let combatHitResolved;

const baseMethod = new CombatMethod();
baseMethod.type = () => CombatType.MELEE;
baseMethod.handleAfterHitEffects = () => {};

const core = {
  CombatType, CombatMethod, Equipment, ItemIdentifiers, Misc,
  Flag: require("../dist/game/model/Flag").Flag,
  BonusManager: { update() {} }, CombatFactory: { MELEE_COMBAT: baseMethod },
  DialogueChainBuilder: require("../dist/game/model/dialogues/builders/DialogueChainBuilder").DialogueChainBuilder,
  OptionDialogue: require("../dist/game/model/dialogues/entries/impl/OptionDialogue").OptionDialogue,
  ItemStatementDialogue: require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue").ItemStatementDialogue,
  DoubleItemStatementDialogue: require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue").DoubleItemStatementDialogue,
};

BloodFury.register({
  core,
  onServerStartup: (handler) => handler(),
  getBonusManager: () => ({ update() {} }),
  getCombatFactory: () => ({ MELEE_COMBAT: baseMethod }),
  onItemOnItem: (first, second, handler) => itemOnItem.set(`${first}>${second}`, handler),
  onItemAction: (name, actions) => {
    if (typeof name === "function") itemAction = name;
    else itemActions.set(name, actions);
  },
  registerCombatMethodResolver() {},
  onCustomEvent() {},
  onCombatHitResolved: (handler) => { combatHitResolved = handler; },
});

function container(capacity) {
  const items = new Array(capacity).fill(null);
  return {
    getItems: () => items,
    get: (slot) => items[slot],
    set: (slot, item) => { items[slot] = item; },
    setItem: (slot, item) => { items[slot] = item; },
    deleteAtSlot: (slot) => { items[slot] = null; },
    refreshItems() {},
    getAmount: (id) => items.reduce(
      (total, item) => total + (item?.getId?.() === id ? item.getAmount?.() ?? 1 : 0),
      0,
    ),
    deleteNumber: (id, amount) => {
      let left = amount;
      for (const item of items) {
        if (left <= 0 || item?.getId?.() !== id) continue;
        const held = item.getAmount?.() ?? 1;
        const taken = Math.min(left, held);
        left -= taken;
        if (taken < held) item.setAmount(held - taken);
        else item.setId(-1);
      }
    },
  };
}

function createPlayer() {
  return {
    dialogue: null,
    getDialogueManager() { return { startDialogues: chain => { this.dialogue = chain; }, reset: () => { this.dialogue = null; } }; },
    messages: [],
    healed: 0,
    inventory: container(28),
    equipment: container(14),
    getInventory() { return this.inventory; },
    getEquipment() { return this.equipment; },
    sendMessage(message) { this.messages.push(message); },
    heal(amount) { this.healed += amount; },
    getUpdateFlag: () => ({ flag() {} }),
    getCombat: () => ({ getCastSpell: () => null, getAutocastSpell: () => null, getRangedWeapon: () => null }),
    isSpecialActivated: () => false,
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function charges(item) {
  return item.getMetaValue("blood-fury")?.charges;
}

function useShard(player, fury, shard, named) {
  itemOnItem.get(named)({
    player,
    usedItem: fury,
    usedWithItem: shard,
    usedItemId: fury.getId(),
    usedWithItemId: shard.getId(),
  });
}

test("a blood shard makes an amulet of blood fury with 10,000 charges", () => {
  const player = createPlayer();
  const fury = new Item(ItemIdentifiers.AMULET_OF_FURY, 1);
  const shard = new Item(ItemIdentifiers.BLOOD_SHARD, 1);
  player.inventory.setItem(0, fury);
  player.inventory.setItem(1, shard);

  useShard(player, fury, shard, "Blood shard>Amulet of fury");

  assert.equal(fury.getId(), ItemIdentifiers.AMULET_OF_FURY, "nothing is consumed before confirmation");
  choose(player, 1);
  assert.equal(fury.getId(), ItemIdentifiers.AMULET_OF_BLOOD_FURY);
  assert.equal(charges(fury), 10000);
  assert.equal(shard.getId(), -1, "the shard is consumed");
});

function choose(player, option) {
  const entry = [...(player.dialogue?.getDialogues().values() ?? [])]
    .find(entry => entry instanceof core.OptionDialogue);
  assert.ok(entry, "expected a visible choice");
  entry.execute(option);
}

function setupCharge(count, shardCount = 3) {
  const player = createPlayer();
  const amulet = new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1, { "blood-fury": { charges: count } });
  const shard = new Item(ItemIdentifiers.BLOOD_SHARD, 1);
  player.inventory.setItem(0, amulet);
  player.inventory.setItem(1, shard);
  for (let n = 1; n < shardCount; n++) player.inventory.setItem(n + 1, new Item(ItemIdentifiers.BLOOD_SHARD, 1));
  useShard(player, amulet, shard, "Blood shard>Amulet of blood fury");
  return { player, amulet, shard };
}

test("recharging confirms and consumes one shard even when several are held", () => {
  const { player, amulet, shard } = setupCharge(10000);
  assert.equal(charges(amulet), 10000);
  assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), 3);
  choose(player, 1);
  assert.equal(charges(amulet), 20000);
  assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), 2);
  const success = [...player.dialogue.getDialogues().values()][0];
  assert.ok(success instanceof core.ItemStatementDialogue);
  assert.equal(success.getText(), "You have successfully added 10,000 hits to your Amulet of blood fury. It will now work for 20,000 more hits.");
});

for (const count of [20001, 25000, 29999]) {
  test(`recharging at ${count} warns before wasting a shard and caps at 30,000`, () => {
    const { player, amulet } = setupCharge(count, 1);
    choose(player, 1);
    assert.equal(charges(amulet), count, "first confirmation must not waste charges");
    const entries = [...player.dialogue.getDialogues().values()];
    assert.ok(entries[0] instanceof core.DoubleItemStatementDialogue);
    assert.match(entries[0].getText(), /nearly at maximum capacity/);
    choose(player, 1);
    assert.equal(charges(amulet), 30000);
    assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), 0);
    assert.match([...player.dialogue.getDialogues().values()][0].getText(), new RegExp((30000-count).toLocaleString("en-US") + " hits"));
  });
}

test("exactly 20,000 needs no waste warning; full capacity consumes nothing", () => {
  const { player, amulet } = setupCharge(20000, 2);
  choose(player, 1);
  assert.equal(charges(amulet), 30000);
  const left = player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD);
  useShard(player, amulet, player.inventory.get(1), "Blood shard>Amulet of blood fury");
  assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), left);
  assert.equal(player.messages.at(-1), "Your Amulet of blood fury is already at maximum capacity.");
});

for (const waste of [false, true]) {
  test(`declining ${waste ? "waste" : "recharge"} confirmation preserves items`, () => {
    const { player, amulet } = setupCharge(29999, 1);
    if (waste) choose(player, 1);
    choose(player, 2);
    assert.equal(charges(amulet), 29999);
    assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), 1);
  });
}

test("creation has two item warnings and can be declined without consuming a shard", () => {
  const player = createPlayer();
  const fury = new Item(ItemIdentifiers.AMULET_OF_FURY, 1);
  const shard = new Item(ItemIdentifiers.BLOOD_SHARD, 1);
  player.inventory.setItem(0, fury);
  player.inventory.setItem(1, shard);
  useShard(player, fury, shard, "Blood shard>Amulet of fury");
  const entries = [...player.dialogue.getDialogues().values()];
  assert.ok(entries[0] instanceof core.DoubleItemStatementDialogue);
  assert.match(entries[0].getText(), /won't be able to get it back/);
  assert.match(entries[1].getText(), /untradeable/);
  choose(player, 2);
  assert.equal(fury.getId(), ItemIdentifiers.AMULET_OF_FURY);
  assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), 1);
});

for (const change of ["remove amulet", "remove shard", "replace amulet", "change charges"]) {
  test(`pending recharge revalidates inventory: ${change}`, () => {
    const { player, amulet } = setupCharge(10000, 1);
    if (change === "remove amulet") player.inventory.setItem(0, null);
    if (change === "remove shard") player.inventory.setItem(1, null);
    if (change === "replace amulet") player.inventory.setItem(0, new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1));
    if (change === "change charges") amulet.setMetaValue("blood-fury", { charges: 29999 });
    choose(player, 1);
    assert.equal(charges(amulet), change === "change charges" ? 29999 : 10000);
    if (change !== "remove shard") assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), 1);
  });
}

// Mirrors PendingHit's hitsplats: each one reports the HP it actually removes once it lands.
function resolvedAttack(player, damages, type = CombatType.MELEE) {
  const hits = damages.map(damage => {
    const observers = [];
    return {
      getDamage: () => damage,
      onApplied(observer) { observers.push(observer); return this; },
      land: (taken) => observers.splice(0).forEach(observer => observer(taken)),
    };
  });
  const hit = {
    getAttacker: () => player,
    getCombatType: () => type,
    getHits: () => hits,
  };
  // The ordinary melee method constructs PendingHits with itself, so dispatch its
  // after-hit callback, then the resolved-hit event as CombatFactory.executeHit does.
  baseMethod.handleAfterHitEffects(hit);
  combatHitResolved?.({ attacker: player, hit });
  return hits;
}

test("ordinary resolved melee hits spend charges on resolution and heal 30% of HP lost on landing", () => {
  const player = createPlayer();
  const amulet = new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1, { "blood-fury": { charges: 5 } });
  player.equipment.set(Equipment.AMULET_SLOT, amulet);
  const originalRandom = Misc.getRandom;
  try {
    Misc.getRandom = (maximum) => { assert.equal(maximum, 4, "inclusive 0..4 gives one chance in five"); return 1; };
    resolvedAttack(player, [20])[0].land(20);
    assert.equal(charges(amulet), 4, "one damaging hit spends one charge");
    assert.equal(player.healed, 0);
    resolvedAttack(player, [0]);
    assert.equal(charges(amulet), 4, "a zero hit spends nothing");
    Misc.getRandom = () => 0;
    const [landing] = resolvedAttack(player, [20]);
    assert.equal(charges(amulet), 3);
    assert.equal(player.healed, 0, "no heal before the hit lands");
    landing.land(20);
    assert.equal(player.healed, 6);
    amulet.setMetaValue("blood-fury", { charges: 1 });
    resolvedAttack(player, [10]);
    assert.equal(amulet.getId(), ItemIdentifiers.AMULET_OF_FURY);
    assert.match(player.messages.at(-1), /run out of charges/);
  } finally { Misc.getRandom = originalRandom; }
});

test("multi-hit melee spends one charge per damaging hit, bounded by charges remaining", () => {
  const player = createPlayer();
  const amulet = new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1, { "blood-fury": { charges: 2 } });
  player.equipment.set(Equipment.AMULET_SLOT, amulet);
  const originalRandom = Misc.getRandom;
  try {
    Misc.getRandom = () => 0;
    const hits = resolvedAttack(player, [10, 0, 20, 30]);
    assert.equal(amulet.getId(), ItemIdentifiers.AMULET_OF_FURY);
    hits.forEach(hit => hit.land(hit.getDamage()));
    assert.equal(player.healed, 9, "the exhausted third damaging hit cannot heal");
  } finally { Misc.getRandom = originalRandom; }
});

test("ranged, magic and inventory-only amulets neither heal nor consume charges", () => {
  const player = createPlayer();
  const amulet = new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1, { "blood-fury": { charges: 5 } });
  player.equipment.set(Equipment.AMULET_SLOT, amulet);
  const originalRandom = Misc.getRandom;
  try {
    Misc.getRandom = () => { throw Error("must not roll healing"); };
    resolvedAttack(player, [20], CombatType.RANGED).forEach(hit => hit.land(20));
    resolvedAttack(player, [20], CombatType.MAGIC).forEach(hit => hit.land(20));
    player.equipment.set(Equipment.AMULET_SLOT, null);
    player.inventory.setItem(0, amulet);
    resolvedAttack(player, [20]).forEach(hit => hit.land(20));
    player.equipment.set(Equipment.AMULET_SLOT, null);
    player.inventory.setItem(0, amulet);
    resolvedAttack(player, [20]);
    assert.equal(charges(amulet), 5);
    assert.equal(player.healed, 0);
  } finally { Misc.getRandom = originalRandom; }
});


test("using the amulet on a shard follows the same confirmation and charge path", () => {
  const { player, amulet, shard } = setupCharge(10000, 2);
  useShard(player, shard, amulet, "Blood shard>Amulet of blood fury");
  choose(player, 1);
  assert.equal(charges(amulet), 20000);
  assert.equal(player.inventory.getAmount(ItemIdentifiers.BLOOD_SHARD), 1);
});

test("Check and Revert still operate through the named item actions", () => {
  const { player, amulet } = setupCharge(23456, 1);
  const event = { player, item: amulet, itemId: amulet.getId(), interfaceId: Equipment.INVENTORY_INTERFACE_ID };
  if (itemActions.has("Amulet of blood fury")) itemActions.get("Amulet of blood fury").Check(event);
  else itemAction({ ...event, clickType: 2 });
  assert.equal(player.messages.at(-1), "Your amulet has 23,456 charges left.");
  if (itemActions.has("Amulet of blood fury")) itemActions.get("Amulet of blood fury").Revert(event);
  else itemAction({ ...event, clickType: 3 });
  assert.equal(amulet.getId(), ItemIdentifiers.AMULET_OF_FURY);
  assert.equal(charges(amulet), undefined);
});

test("melee healing counts only HP lost on landing, not damage queued before a same-cycle hit", () => {
  const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
  const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
  const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
  const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
  const player = createPlayer();
  const amulet = new Item(ItemIdentifiers.AMULET_OF_BLOOD_FURY, 1, { "blood-fury": { charges: 5 } });
  player.equipment.set(Equipment.AMULET_SLOT, amulet);
  const target = {
    hp: 20,
    isRegistered: () => true,
    isPlayer: () => false,
    getHitpoints: () => target.hp,
    decrementHealth(hit) {
      hit.setDamage(Math.min(hit.getDamage(), target.hp));
      target.hp -= hit.getDamage();
      return hit;
    },
    addTickHit() {},
  };
  const queue = new HitQueue(target);
  const originalRandom = Misc.getRandom;
  const originalRedemption = CombatFactory.handleRedemption;
  try {
    Misc.getRandom = () => 0;
    CombatFactory.handleRedemption = () => {};
    queue.addPendingDamage([new HitDamage(19, HitMask.RED)]);
    const attack = new HitDamage(20, HitMask.RED);
    const hit = {
      getAttacker: () => player,
      getCombatType: () => CombatType.MELEE,
      getHits: () => [attack],
    };
    baseMethod.handleAfterHitEffects(hit);
    combatHitResolved({ attacker: player, hit });
    queue.addPendingDamage([attack]);
    queue.process(1);
    assert.equal(target.hp, 0, "the earlier hit leaves 1 HP and the 20 hit removes only that");
    assert.equal(charges(amulet), 4, "the charge is still spent on resolution");
    assert.equal(player.healed, 0, "30% of the 1 HP actually lost rounds down to nothing");
  } finally {
    Misc.getRandom = originalRandom;
    CombatFactory.handleRedemption = originalRedemption;
  }
});
