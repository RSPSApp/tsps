// From server/: node --test tests/crazy-archaeologist-combat-achievements.test.cjs (after yarn build).
//
// The Crazy archaeologist's Combat Achievement tasks (cache monster 12): "Mage of the Ruins" comes
// from DerivedRules, "I'd Rather Not Learn" ("without anyone being hit by his Rain of Knowledge
// attack") from his Rain of Knowledge books (CrazyArchaeologist.plugin.js), whose damage is queued
// straight onto the player and so never reaches the fight log of Fights.CombatAchievements.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

const NPC_NAME = 'Crazy Archaeologist';
let Boss, Data, Derived, rules, method, processCycle = 1000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Boss = require('../plugins/bosses/CrazyArchaeologist.plugin');
  Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
  Derived = require('../plugins/achievements/combatachievements/DerivedRules.CombatAchievements');
  const testCore = { ...core, World: { ...core.World, getProcessCycle: () => processCycle } };
  const api = new Proxy({ core: testCore, getTaskManager: () => ({ submit: () => {} }) }, { get: (target, key) => target[key] ?? (() => {}) });
  Data(new Proxy({ core }, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  const captured = {};
  require('../plugins/achievements/combatachievements/tasks/CrazyArchaeologist.CombatAchievements')(
    api, { onKill: (name, tests) => { captured[name] = tests; } },
  );
  rules = captured[NPC_NAME];
  const Combat = Boss._test.combatClass(api);
  method = new Combat();
});

function fakeNpc(players) {
  const attributes = new Map();
  return {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getAsNpc() { return this; },
    getPlayersWithinDistance: () => players,
  };
}

function fakePlayer(x, y) {
  const damage = [];
  return {
    damage,
    getLocation: () => ({ x, y, getX: () => x, getY: () => y, getZ: () => 0 }),
    getPacketSender: () => ({ sendGlobalGraphic: () => {} }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => damage.push(hits) }) }),
  };
}

const fightOf = (npc, ticks) => ({ npc, ticks });

test('the cache has the task, and Mage of the Ruins is read from its description', () => {
  assert.ok(Data.taskNamed("I'd Rather Not Learn"));
  const mage = Data.taskNamed('Mage of the Ruins');
  assert.ok(Derived.ruleFor(mage), 'only magical attacks is a derived rule');
  assert.deepEqual(Object.keys(rules), ["I'd Rather Not Learn"]);
});

test("I'd Rather Not Learn: holds when no book landed on anyone", () => {
  const npc = fakeNpc([]);
  assert.equal(rules["I'd Rather Not Learn"](fightOf(npc, 30)), true);
});

test("I'd Rather Not Learn: a book landing on a player breaks it, and so does a bystander's hit", () => {
  const fighter = fakePlayer(3000, 3700);
  const bystander = fakePlayer(3010, 3700);
  const npc = fakeNpc([fighter, bystander]);
  processCycle = 1010;
  method.explodeBooks(npc, fighter, [{ x: 3010, y: 3701 }], 0);
  assert.equal(fighter.damage.length, 0, 'the fighter stood clear');
  assert.equal(bystander.damage.length, 1, 'the bystander took the book');
  assert.equal(npc.getAttribute(Boss.RAIN_HIT_ATTRIBUTE), 1010);
  processCycle = 1040;
  assert.equal(rules["I'd Rather Not Learn"](fightOf(npc, 40)), false, 'the fight began at 1000, before the hit');
});

test("I'd Rather Not Learn: a book that missed everyone does not count", () => {
  const fighter = fakePlayer(3000, 3700);
  const npc = fakeNpc([fighter]);
  processCycle = 1010;
  method.explodeBooks(npc, fighter, [{ x: 3005, y: 3705 }], 0);
  assert.equal(npc.getAttribute(Boss.RAIN_HIT_ATTRIBUTE), undefined);
  processCycle = 1040;
  assert.equal(rules["I'd Rather Not Learn"](fightOf(npc, 40)), true);
});

test("I'd Rather Not Learn: a hit from before this fight began does not count", () => {
  const fighter = fakePlayer(3000, 3700);
  const npc = fakeNpc([fighter]);
  processCycle = 1010;
  method.explodeBooks(npc, fighter, [{ x: 3000, y: 3700 }], 0);
  assert.equal(npc.getAttribute(Boss.RAIN_HIT_ATTRIBUTE), 1010);
  processCycle = 1100;
  assert.equal(rules["I'd Rather Not Learn"](fightOf(npc, 60)), true, 'this fight began at 1040');
  assert.equal(rules["I'd Rather Not Learn"](fightOf(npc, 90)), false, 'began at 1010, the tick of the hit');
});
