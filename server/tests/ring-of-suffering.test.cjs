// Run after `yarn build`: node --test tests/ring-of-suffering.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");

const RingOfSuffering = require("../plugins/items/RingOfSuffering.plugin");

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
let hitResolved, core;
before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const api = PluginManager.createApi("RingOfSufferingRegression");
  core = api.core;
  const registerHit = api.onCombatHitResolved;
  RingOfSuffering.register({ ...api, onCombatHitResolved(handler) {
    hitResolved = handler;
    registerHit(handler);
  } });
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

function createPlayer({ ring = null, disabled = false } = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (ring) equipment[Equipment.RING_SLOT] = ring;
  const attributes = new Map();
  if (disabled) attributes.set("ring-of-suffering:recoil-disabled", true);
  const messages = [];
  return {
    attributes,
    messages,
    getEquipment: () => ({ get: (slot) => equipment[slot], refreshItems: () => {} }),
    getInventory: () => ({ deleteNumber: () => {}, refreshItems: () => {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => { this.pending = hits; } }), getTarget: () => null }),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function attacker() {
  const pending = [];
  return { pending, getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => pending.push(...hits) }) }) };
}

test("rings of recoil charge the ring and switch it to (r)", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING);
  const player = createPlayer({ ring });
  RingOfSuffering._test.chargeRing({
    player,
    usedItem: ring,
    usedWithItem: item(ItemIds.RING_OF_RECOIL),
    usedItemId: ItemIds.RING_OF_SUFFERING,
    usedWithItemId: ItemIds.RING_OF_RECOIL,
    handled: false,
  });
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING_R_);
  assert.equal(RingOfSuffering._test.charges(ring), 40);
});

/** A hit of `damage` from `from` landing on `player`. */
function land(player, damage, from = attacker()) {
  hitResolved({ attacker: from, target: player, hit: { getTotalDamage: () => damage } });
  return from;
}

test("every damaging hit recoils 10% + 1, spending a charge per point of recoil", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 40 });
  const player = createPlayer({ ring });
  for (let i = 0; i < 3; i++) {
    const enemy = land(player, 100);
    assert.equal(enemy.pending.length, 1, "no random fizzle");
    assert.equal(enemy.pending[0].getDamage(), 11);
    assert.ok(enemy.pending[0].isReflected());
    assert.equal(enemy.pending[0].getSource(), player);
  }
  assert.equal(RingOfSuffering._test.charges(ring), 40 - 33);
  assert.equal(land(player, 0).pending.length, 0, "a 0 recoils nothing");
});

test("the last recoil deals only the charges left and reverts the ring", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 3 });
  const player = createPlayer({ ring });
  const enemy = land(player, 100);
  assert.equal(enemy.pending[0].getDamage(), 3);
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING, "the last charge reverts the ring");
  assert.match(player.messages.at(-1), /run out of charges/);
});

test("the toggle disables the effect without spending charges", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 5 });
  const disabled = createPlayer({ ring, disabled: true });
  assert.equal(land(disabled, 100).pending.length, 0);
  assert.equal(RingOfSuffering._test.charges(ring), 5, "disabled spends nothing");
});

test("recoil immunity prevents suffering damage without spending its last charges", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 3 });
  const player = createPlayer({ ring }), enemy = attacker();
  enemy.getAttribute = key => key === 'combat:recoil-immune';
  land(player, 100, enemy);
  assert.deepEqual(enemy.pending, []);
  assert.equal(RingOfSuffering._test.charges(ring), 3);
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING_R_);
});

// Exercise real name/noted hook filtering and real inventory deletion, in both orders.
function chargingFixture(ringId, recoilNoted, remaining = 0) {
  const player = new Player(null);
  const prompts = [];
  const sender = new Proxy({}, { get: (_, name) => name === "sendEnterAmountPrompt" ? (title) => { prompts.push(title); return sender; } : () => sender });
  player.prompts = prompts;
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const ring = new core.Item(ringId);
  if (remaining) ring.setMetaValue("ring-of-suffering", remaining);
  const recoilId = recoilNoted
    ? core.ItemDefinition.forId(ItemIds.RING_OF_RECOIL).getNoteId()
    : ItemIds.RING_OF_RECOIL;
  player.getInventory().setItem(0, ring);
  player.getInventory().setItem(1, new core.Item(recoilId, recoilNoted ? 3 : 1));
  player.setAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 17);
  return { player, ring, recoilId };
}

/** Uses a recoil ring on the suffering ring; with several held, answers the count prompt with `answer`. */
function useRecoil(fixture, reverse = false, answer = 1) {
  const { player } = fixture;
  const usedItemSlot = reverse ? 0 : 1, usedWithItemSlot = reverse ? 1 : 0;
  const usedItem = player.getInventory().get(usedItemSlot);
  const usedWithItem = player.getInventory().get(usedWithItemSlot);
  const prompted = player.prompts.length;
  const handled = PluginManager.emitItemOnItem({ player, usedItem, usedWithItem,
    usedItemId: usedItem.getId(), usedWithItemId: usedWithItem.getId(),
    usedItemSlot, usedWithItemSlot, handled: false });
  if (player.prompts.length > prompted) player.getEnteredAmountAction().execute(answer);
  return handled;
}

for (const noted of [false, true]) {
  for (const reverse of [false, true]) {
    test(`charging with ${noted ? "noted" : "unnoted"} recoil, reverse=${reverse}, resets shared recoil damage`, () => {
      const f = chargingFixture(ItemIds.RING_OF_SUFFERING, noted);
      assert.equal(useRecoil(f, reverse), true);
      assert.equal(f.ring.getId(), ItemIds.RING_OF_SUFFERING_R_);
      assert.equal(RingOfSuffering._test.charges(f.ring), 40);
      assert.equal(f.player.getInventory().getAmount(f.recoilId), noted ? 2 : 0);
      assert.equal(f.player.getAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 0);
    });
  }
}

for (const [base, charged] of [
  [ItemIds.RING_OF_SUFFERING, ItemIds.RING_OF_SUFFERING_R_],
  [ItemIds.RING_OF_SUFFERING_I_, ItemIds.RING_OF_SUFFERING_RI_],
  [ItemIds.RING_OF_SUFFERING_I__3, ItemIds.RING_OF_SUFFERING_RI__3],
  [ItemIds.RING_OF_SUFFERING_I__5, ItemIds.RING_OF_SUFFERING_RI__5],
]) {
  test(`charging and topping up cache variant ${base} preserves its imbue variant`, () => {
    const f = chargingFixture(base, true);
    assert.equal(useRecoil(f), true);
    assert.equal(f.ring.getId(), charged);
    assert.equal(useRecoil(f, true), true);
    assert.equal(RingOfSuffering._test.charges(f.ring), 80);
    assert.equal(f.player.getInventory().getAmount(f.recoilId), 1);
  });
}

// rsprox 237/01150.txt:596557-596596: "How many rings do you wish to use?", then "You load your ring with 106 rings of
// recoil. It now has 4,240 recoil charges." (40 each).
test("several recoil rings ask how many, and load that many at 40 charges each", () => {
  const f = chargingFixture(ItemIds.RING_OF_SUFFERING, true);
  const messages = [];
  f.player.sendMessage = message => messages.push(message);
  assert.equal(useRecoil(f, false, 2), true);
  assert.deepEqual(f.player.prompts, ["How many rings do you wish to use?"]);
  assert.equal(RingOfSuffering._test.charges(f.ring), 80);
  assert.equal(f.player.getInventory().getAmount(f.recoilId), 1);
  assert.deepEqual(messages, ["You load your ring with 2 rings of recoil. It now has 80 recoil charges."]);
  assert.equal(useRecoil(f, false, 5), true, "the last ring loads without a prompt");
  assert.equal(f.player.prompts.length, 1);
  assert.equal(RingOfSuffering._test.charges(f.ring), 120);
  assert.equal(f.player.getInventory().getAmount(f.recoilId), 0);
  assert.equal(messages.at(-1), "You load your ring with 1 ring of recoil. It now has 120 recoil charges.");
});

test("a full ring consumes nothing and does not reset ordinary recoil damage", () => {
  const f = chargingFixture(ItemIds.RING_OF_SUFFERING_R_, true, 100000);
  assert.equal(useRecoil(f), true);
  assert.equal(f.player.getInventory().getAmount(f.recoilId), 3);
  assert.equal(RingOfSuffering._test.charges(f.ring), 100000);
  assert.equal(f.player.getAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 17);
});

test("the last complete recoil fills the charge cap exactly", () => {
  const f = chargingFixture(ItemIds.RING_OF_SUFFERING_RI_, true, 99960);
  assert.equal(useRecoil(f), true);
  assert.equal(RingOfSuffering._test.charges(f.ring), 100000);
  assert.equal(f.player.getInventory().getAmount(f.recoilId), 2);
});

test("noted suffering rings and unrelated sapphire rings cannot be charged", () => {
  const notedId = core.ItemDefinition.forId(ItemIds.RING_OF_SUFFERING).getNoteId();
  for (const ringId of [notedId, ItemIds.SAPPHIRE_RING]) {
    const f = chargingFixture(ringId, true);
    assert.equal(useRecoil(f), false);
    assert.equal(f.player.getInventory().getAmount(f.recoilId), 3);
    assert.equal(f.player.getAttribute(CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 17);
  }
});


test("legacy saved charges migrate on top-up without losing the stored balance", () => {
  const f = chargingFixture(ItemIds.RING_OF_SUFFERING_R_, false, 123);
  assert.equal(useRecoil(f), true);
  assert.equal(f.ring.getMetaValue("ring-of-suffering:charges"), 163);
  assert.equal(f.ring.getMetaValue("ring-of-suffering"), undefined);
  assert.equal(RingOfSuffering._test.charges(f.ring.clone()), 163);
});

test("spending or discarding old saved charges clears the legacy key", () => {
  const ring = item(ItemIds.RING_OF_SUFFERING_R_, { "ring-of-suffering": 3 });
  const player = createPlayer({ ring });
  land(player, 1);
  assert.equal(ring.getMetaValue("ring-of-suffering:charges"), 2);
  assert.equal(ring.getMetaValue("ring-of-suffering"), undefined);
  RingOfSuffering._test.discharge({ player, item: ring });
  assert.equal(RingOfSuffering._test.charges(ring), 0);
  assert.equal(ring.getMetaValue("ring-of-suffering:charges"), undefined);
  assert.equal(ring.getId(), ItemIds.RING_OF_SUFFERING);
});


test("named inventory and worn hooks retain Check and recoil toggles", () => {
  const f = chargingFixture(ItemIds.RING_OF_SUFFERING_R_, false, 80);
  const messages = [];
  f.player.sendMessage = message => messages.push(message);
  function click(interfaceId, clickType, option) {
    const event = { player: f.player, item: f.ring, itemId: f.ring.getId(), slot: 0,
      interfaceId, clickType, option, handled: false };
    PluginManager.emitItemAction(event);
    assert.equal(event.handled, true);
  }
  click(3214, 4, "check");
  // rsprox: "Your ring currently has N recoil charges remaining. The recoil effect is currently enabled."
  assert.equal(messages.pop(), "Your ring currently has 80 recoil charges remaining. The recoil effect is currently enabled.");
  click(3214, 5, "recoil settings");
  assert.equal(messages.pop(), "You disable the recoil effect of your ring.");
  assert.equal(f.player.getAttribute("ring-of-suffering:recoil-disabled"), true);
  click(core.Equipment.INVENTORY_INTERFACE_ID, 2, "Check");
  assert.equal(messages.pop(), "Your ring currently has 80 recoil charges remaining. The recoil effect is currently disabled.");
  click(core.Equipment.INVENTORY_INTERFACE_ID, 3, "Recoil Settings");
  assert.equal(f.player.getAttribute("ring-of-suffering:recoil-disabled"), false);
  assert.equal(RingOfSuffering._test.charges(f.ring), 80);
});
