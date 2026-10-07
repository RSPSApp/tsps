// Run after `yarn build`: node --test tests/ring-of-life.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");

const RingOfLife = require("../plugins/items/RingOfLife.plugin");

const teleports = [];
RingOfLife.register({
  core: {
    ItemIdentifiers: ItemIds,
    GameConstants: { DEFAULT_LOCATION: { getX: () => 3222, getY: () => 3218, getZ: () => 0 } },
    TeleportHandler: {
      checkReqs: () => true,
      teleport: (player, destination, type, warning) => teleports.push({ player, destination, type, warning }),
    },
    TeleportType: { NORMAL: "NORMAL" },
  },
  registerIncomingDamageModifier() {},
});

function createPlayer({ hp = 100, max = 100, ring = -1, cape = -1, teleblocked = false } = {}) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  const deleted = [];
  const messages = [];
  if (ring > 0) equipment[Equipment.RING_SLOT] = { getId: () => ring };
  if (cape > 0) equipment[Equipment.CAPE_SLOT] = { getId: () => cape };
  const player = {
    messages,
    deleted,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({
      get: (slot) => equipment[slot],
      deleteNumber: (id, amount) => deleted.push([id, amount]),
      refreshItems: () => {},
    }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.HITPOINTS ? hp : 99),
      getMaxLevel: (skill) => (skill === Skill.HITPOINTS ? max : 99),
    }),
    getCombat: () => ({ getTeleblockTimer: () => ({ finished: () => !teleblocked }) }),
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

test("a hit leaving 10% HP procs the ring and destroys it", () => {
  teleports.length = 0;
  const player = createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE });
  RingOfLife._test.onIncomingDamage(player, { getDamage: () => 95 });
  assert.equal(teleports.length, 1);
  assert.deepEqual(player.deleted, [[ItemIds.RING_OF_LIFE, 1]]);
  assert.match(player.messages[0], /Ring of Life saves you/);
});

test("the ring does not save a lethal hit or a hit above the 10% threshold", () => {
  teleports.length = 0;
  RingOfLife._test.onIncomingDamage(createPlayer({ hp: 15, ring: ItemIds.RING_OF_LIFE }), { getDamage: () => 15 });
  assert.equal(teleports.length, 0, "a hit to zero is not saved");
  RingOfLife._test.onIncomingDamage(createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE }), { getDamage: () => 89 });
  assert.equal(teleports.length, 0, "89 damage leaves 11 HP, above 10%");
  RingOfLife._test.onIncomingDamage(createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE }), { getDamage: () => 90 });
  assert.equal(teleports.length, 1, "exactly 10 HP procs");
});

test("a Defence cape saves without being destroyed, and Tele Block stops both", () => {
  teleports.length = 0;
  const caped = createPlayer({ hp: 100, cape: ItemIds.DEFENCE_CAPE });
  RingOfLife._test.onIncomingDamage(caped, { getDamage: () => 95 });
  assert.equal(teleports.length, 1);
  assert.equal(caped.deleted.length, 0);
  assert.match(caped.messages[0], /Defence cape saves you/);

  RingOfLife._test.onIncomingDamage(
    createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE, teleblocked: true }),
    { getDamage: () => 95 }
  );
  assert.equal(teleports.length, 1, "a teleblocked ring does not activate");
});
