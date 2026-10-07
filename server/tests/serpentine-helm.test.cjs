// Run after `yarn build`: node --test tests/serpentine-helm.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const SerpentineHelm = require("../plugins/items/SerpentineHelm.plugin");

const poisoned = [];
let cycle = 100;
const weaponNames = new Map([
  [1001, "Rune scimitar"],
  [1002, "Rune dagger(p++)"],
]);
SerpentineHelm.register({
  core: {
    ItemIdentifiers: ItemIds,
    World: { getProcessCycle: () => cycle },
    ItemDefinition: { forId: (id) => ({ getName: () => weaponNames.get(id) ?? "" }) },
    CombatFactory: { poisonEntity: (target, severity, orb) => poisoned.push({ target, severity, orb }) },
  },
  persistAttribute() {},
  onItemAction() {},
  onItemOnItem() {},
  onCombatHitResolved() {},
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

function createPlayer({ helm = null, weapon = 0, inCombat = true, scales = 0 } = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (helm) equipment[Equipment.HEAD_SLOT] = helm;
  if (weapon) equipment[Equipment.WEAPON_SLOT] = item(weapon);
  const attributes = new Map();
  const immunity = { starts: 0, finished: () => true, start() { this.starts++; } };
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
      addItem: () => {},
      refreshItems: () => {},
    }),
    getCombat: () => ({ getTarget: () => (inCombat ? {} : null), getPoisonImmunityTimer: () => immunity }),
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
  assert.ok(Math.abs(SerpentineHelm._test.venomChance(plain) - 1 / 6) < 1e-9);
  const poisonedWeapon = createPlayer({ helm: item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 }), weapon: 1002 });
  assert.equal(SerpentineHelm._test.venomChance(poisonedWeapon), 0.5);
  const toxic = createPlayer({ helm: item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 }), weapon: ItemIds.TOXIC_BLOWPIPE });
  assert.equal(SerpentineHelm._test.venomChance(toxic), 1);
});

test("a successful hit on a monster can envenom it, but never a player", () => {
  poisoned.length = 0;
  const helm = item(ItemIds.SERPENTINE_HELM, { "serpentine-helm": 100 });
  const player = createPlayer({ helm, weapon: ItemIds.TOXIC_BLOWPIPE });
  const npc = { isNpc: () => true, isVenomed: () => false };
  const hit = { isAccurate: () => true, getTotalDamage: () => 5 };
  const original = Math.random;
  try {
    Math.random = () => 0.99;
    SerpentineHelm._test.onHitResolved({ attacker: player, target: npc, hit });
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
