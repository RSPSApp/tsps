// Run after `yarn build`: node --test tests/ring-of-endurance.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const RingOfEndurance = require("../plugins/items/RingOfEndurance.plugin");

RingOfEndurance.register({
  core: { ItemIdentifiers: ItemIds },
  onCustomEvent() {},
  onItemAction() {},
  onItemOnItem() {},
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

function createPlayer({ ring = null, doses = 1 } = {}) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (ring) equipment[Equipment.RING_SLOT] = ring;
  const messages = [];
  return {
    messages,
    getEquipment: () => ({ get: (slot) => equipment[slot], refreshItems: () => {} }),
    getInventory: () => ({
      deleteNumber: () => {},
      refreshItems: () => {},
      getAmount: () => doses,
    }),
    sendMessage: (message) => messages.push(message),
  };
}

test("stamina doses charge the ring one charge each", () => {
  const ring = item(ItemIds.RING_OF_ENDURANCE_UNCHARGED_);
  const player = createPlayer({ ring });
  RingOfEndurance._test.chargeRing({
    player,
    usedItem: ring,
    usedWithItem: item(ItemIds.STAMINA_POTION_4_),
    usedItemId: ItemIds.RING_OF_ENDURANCE_UNCHARGED_,
    usedWithItemId: ItemIds.STAMINA_POTION_4_,
    handled: false,
  });
  assert.equal(ring.getId(), ItemIds.RING_OF_ENDURANCE);
  assert.equal(RingOfEndurance._test.charges(ring), 4);
  RingOfEndurance._test.chargeRing({
    player,
    usedItem: item(ItemIds.STAMINA_MIX_2_),
    usedWithItem: ring,
    usedItemId: ItemIds.STAMINA_MIX_2_,
    usedWithItemId: ItemIds.RING_OF_ENDURANCE,
    handled: false,
  });
  assert.equal(RingOfEndurance._test.charges(ring), 6);
});

test("a worn charged ring doubles a stamina dose and spends one charge", () => {
  const ring = item(ItemIds.RING_OF_ENDURANCE, { "ring-of-endurance": 3 });
  const player = createPlayer({ ring });
  const request = { player, energy: 20, durationMs: 120000 };
  RingOfEndurance._test.doubleStamina(request);
  assert.equal(request.energy, 40);
  assert.equal(request.durationMs, 240000);
  assert.equal(RingOfEndurance._test.charges(ring), 2);

  ring.setMetaValue("ring-of-endurance", 1);
  RingOfEndurance._test.doubleStamina(request);
  assert.equal(ring.getId(), ItemIds.RING_OF_ENDURANCE_UNCHARGED_);
  assert.match(player.messages.at(-1), /run out of charges/);

  const withoutRing = createPlayer();
  const plain = { player: withoutRing, energy: 20, durationMs: 120000 };
  RingOfEndurance._test.doubleStamina(plain);
  assert.equal(plain.energy, 20, "no ring, no doubling");
});

test("uncharging drops the charges without refunding them", () => {
  const ring = item(ItemIds.RING_OF_ENDURANCE, { "ring-of-endurance": 50 });
  const player = createPlayer({ ring });
  RingOfEndurance._test.uncharge({ player, item: ring });
  assert.equal(ring.getId(), ItemIds.RING_OF_ENDURANCE_UNCHARGED_);
  assert.equal(RingOfEndurance._test.charges(ring), 0);
});
