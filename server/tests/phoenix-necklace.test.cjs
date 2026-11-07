// Run after `yarn build`: node --test tests/phoenix-necklace.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Skill } = require("../dist/game/model/Skill");
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");

const PhoenixNecklace = require("../plugins/items/PhoenixNecklace.plugin");

const listeners = new Map();
let canEat = null;
let blocked = false;
PhoenixNecklace.register({
  emitCanEat: () => canEat,
  emitCustomEvent(name, request) {
    if (name === "phoenix-necklace:eligible") request.blocked = blocked;
  },
  onCustomEvent: (name, handler) => listeners.set(name, handler),
});

function createPlayer({ hp = 100, max = 99, necklace = "Phoenix necklace" } = {}) {
  const state = { hp, deleted: [], messages: [], cleared: 0 };
  const amulet = necklace ? { getId: () => 11090, getDefinition: () => ({ getName: () => necklace }) } : null;
  const player = {
    state,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({
      get: (slot) => (slot === Equipment.AMULET_SLOT ? amulet : null),
      deleteNumber: (id, amount) => state.deleted.push([id, amount]),
      refreshItems: () => {},
    }),
    getSkillManager: () => ({
      getCurrentLevel: () => state.hp,
      getMaxLevel: () => max,
      setCurrentLevels: (skill, level) => { assert.equal(skill, Skill.HITPOINTS); state.hp = level; },
    }),
    getCombat: () => ({ getHitQueue: () => ({ clearIncoming: () => state.cleared++ }) }),
    sendMessage: (message) => state.messages.push(message),
  };
  return player;
}

const damaged = (player) => listeners.get("combat:damage-applied")({ target: player });

test("dropping to 20% heals 30% of the base level (29 at 99) and destroys the necklace", () => {
  canEat = null;
  blocked = false;
  const player = createPlayer({ hp: 19 });
  damaged(player);
  assert.equal(player.state.hp, 19 + 29);
  assert.deepEqual(player.state.deleted, [[11090, 1]]);
  assert.equal(player.state.cleared, 1, "pending incoming hits are cleared");
  assert.match(player.state.messages[0], /phoenix necklace/);
});

test("20% exactly activates it; 21% and death do not", () => {
  assert.equal(PhoenixNecklace._test.isLowEnough(20, 100), true);
  assert.equal(PhoenixNecklace._test.isLowEnough(21, 100), false);
  assert.equal(PhoenixNecklace._test.isLowEnough(0, 100), false);
  const healthy = createPlayer({ hp: 40 });
  damaged(healthy);
  assert.equal(healthy.state.deleted.length, 0);
});

test("without the necklace, or where food is refused or the arena blocks it, nothing happens", () => {
  const bare = createPlayer({ hp: 5, necklace: null });
  damaged(bare);
  assert.equal(bare.state.hp, 5);
  canEat = false;
  const dueling = createPlayer({ hp: 5 });
  damaged(dueling);
  assert.equal(dueling.state.hp, 5, "No Food / On a Diet");
  canEat = null;
  blocked = true;
  const arena = createPlayer({ hp: 5 });
  damaged(arena);
  assert.equal(arena.state.hp, 5, "Bounty Hunter arena");
  assert.equal(arena.state.deleted.length, 0);
  blocked = false;
});

test("a necklace about to heal the wearer takes priority over a ring of life", () => {
  const request = { player: createPlayer({ hp: 100 }), remaining: 9, active: false };
  listeners.get("phoenix-necklace:will-trigger")(request);
  assert.equal(request.active, true);
  const unaffected = { player: createPlayer({ hp: 100, necklace: null }), remaining: 9, active: false };
  listeners.get("phoenix-necklace:will-trigger")(unaffected);
  assert.equal(unaffected.active, false);
  const healthy = { player: createPlayer({ hp: 100 }), remaining: 30, active: false };
  listeners.get("phoenix-necklace:will-trigger")(healthy);
  assert.equal(healthy.active, false);
});

test("clearing incoming drops delayed hits and other combatants' damage but keeps the owner's own", () => {
  const owner = { isRegistered: () => true, getHitpoints: () => 50 };
  const other = { isRegistered: () => true };
  const queue = new HitQueue(owner);
  queue.addPendingHit({ getAttacker: () => other }, 5);
  queue.addPendingDamage([
    new HitDamage(5, HitMask.RED).setSource(other),
    new HitDamage(2, HitMask.GREEN).setSource(owner),
    new HitDamage(3, HitMask.RED),
  ]);
  queue.clearIncoming();
  assert.equal(queue.hasPendingHitFrom(other), false);
  assert.equal(queue.getQueuedDamage(), 5, "own and unsourced damage stay (2 + 3)");
});
