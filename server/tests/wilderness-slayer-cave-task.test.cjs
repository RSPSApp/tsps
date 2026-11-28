// Run after `yarn build`: node --test tests/wilderness-slayer-cave-task.test.cjs
// Wiki: the cave's abyssal demons, dust devils, nechryaels and jellies can only be attacked on a
// Slayer task; Peeve refuses everyone else.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");
const plugin = require("../plugins/areas/WildernessSlayerCave.plugin");

const { refuseOffTask, REFUSAL, GHOSTLY_REFUSAL } = plugin._test;
const CAVE_IDS = [11238, 11239, 11240, 11241, 11242, 11243, 11244, 11245];

const handlers = [];
let task = null;

before(() => {
  plugin.register({
    core: { Equipment, ItemIdentifiers, NpcIdentifiers },
    onCanAttack: (handler) => handlers.push(handler),
    emitCustomEvent: (name, request) => {
      if (name === "slayer:on-task") request.onTask = task === request.npc.getId();
    },
  });
});

const npc = (id) => ({ isNpc: () => true, isPlayer: () => false, getId: () => id });

function player(worn = {}) {
  return {
    isNpc: () => false,
    isPlayer: () => true,
    getEquipment: () => ({ get: (slot) => (slot in worn ? { getId: () => worn[slot] } : undefined) }),
  };
}

function attempt(attacker, target) {
  const event = { attacker, target, allow: null };
  refuseOffTask(event);
  return event;
}

test("the plugin gates attacks on the cave's task-only ids", () => {
  assert.deepEqual(handlers, [refuseOffTask]);
  task = null;
  for (const id of CAVE_IDS) assert.equal(attempt(player(), npc(id)).allow, false, String(id));
});

test("a matching task lets the player attack, a task for something else does not", () => {
  task = 11241;
  assert.equal(attempt(player(), npc(11241)).allow, null);
  assert.equal(attempt(player(), npc(11241)).message, undefined);
  assert.equal(attempt(player(), npc(11239)).allow, false);
});

test("Peeve is understood only through a ghostspeak amulet or Morytania legs", () => {
  task = null;
  assert.equal(attempt(player(), npc(11239)).message, GHOSTLY_REFUSAL);
  const amulet = { [Equipment.AMULET_SLOT]: ItemIdentifiers.GHOSTSPEAK_AMULET };
  assert.equal(attempt(player(amulet), npc(11239)).message, REFUSAL);
  const legs = { [Equipment.LEG_SLOT]: ItemIdentifiers.MORYTANIA_LEGS_2 };
  assert.equal(attempt(player(legs), npc(11239)).message, REFUSAL);
});

test("auto-retaliation off task is refused without repeating the line", () => {
  task = null;
  const retaliating = { ...player(), getCombat: () => ({ isAutoRetaliating: () => true }) };
  const event = attempt(retaliating, npc(11239));
  assert.equal(event.allow, false);
  assert.equal(event.message, undefined);
});

test("the ordinary monsters, the cave's other monsters and NPC attackers are left alone", () => {
  task = null;
  // 415, 423, 7278, 437: the same monsters elsewhere. 7861, 7864: the cave's black dragon and ankou.
  for (const id of [415, 423, 7278, 437, 7861, 7864]) assert.equal(attempt(player(), npc(id)).allow, null, String(id));
  assert.equal(attempt(npc(11239), player()).allow, null);
  assert.equal(attempt(npc(10), npc(11239)).allow, null);
});
