// From server/: node --test tests/brutus-combat-achievements.test.cjs (after yarn build).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
let rules, events;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Data({ core: PluginManager.getCoreApi() });
  events = new Map();
  const api = {
    onCustomEvent: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
  };
  require("../plugins/achievements/combatachievements/tasks/Brutus.CombatAchievements")(
    api,
    { onKill: (name, tests) => { assert.equal(name, "Brutus"); rules = tests; } },
  );
});

function player(equipment = []) {
  return { getEquipment: () => ({ getItems: () => equipment }) };
}

function emit(name, event) {
  for (const handler of events.get(name) ?? []) handler(event);
}

test("the two Brutus tasks are registered from their current cache definitions", () => {
  assert.equal(Data.taskNamed("Beef vs Beef").id, 635);
  assert.equal(Data.taskNamed("Smarter than a Cow").id, 636);
  assert.deepEqual(Object.keys(rules), ["Beef vs Beef", "Smarter than a Cow"]);
});

test("Beef vs Beef allows bare kills and manual casts, but rejects gear, food or potions", () => {
  const p = player(), fight = { player: p };
  emit("ides-of-milk:brutus-spawn", { player: p });
  assert.equal(rules["Beef vs Beef"](fight), true);
  assert.equal(rules["Smarter than a Cow"](fight), true, "manual casts do not count as Brutus attacks");

  emit("food:eaten", { player: p });
  assert.equal(rules["Beef vs Beef"](fight), false);

  const q = player();
  emit("ides-of-milk:brutus-spawn", { player: q });
  emit("potions:drunk", { player: q });
  assert.equal(rules["Beef vs Beef"]({ player: q }), false);

  const geared = player([{ getId: () => 100 }]);
  emit("ides-of-milk:brutus-spawn", { player: geared });
  assert.equal(rules["Beef vs Beef"]({ player: geared }), false);

  const equippedDuringFight = player();
  emit("ides-of-milk:brutus-spawn", { player: equippedDuringFight });
  equippedDuringFight.getEquipment = () => ({ getItems: () => [{ getId: () => 100 }] });
  emit("equipment:changed", { player: equippedDuringFight });
  equippedDuringFight.getEquipment = () => ({ getItems: () => [] });
  emit("equipment:changed", { player: equippedDuringFight });
  assert.equal(rules["Beef vs Beef"]({ player: equippedDuringFight }), false);
});

test("Smarter than a Cow fails after a successful Brutus hit, not an attack attempt", () => {
  const p = player(), fight = { player: p };
  emit("ides-of-milk:brutus-spawn", { player: p });
  assert.equal(rules["Smarter than a Cow"](fight), true, "an attack attempt alone does not fail the task");
  emit("ides-of-milk:brutus-hit", { player: p });
  assert.equal(rules["Smarter than a Cow"](fight), false);

  emit("ides-of-milk:brutus-spawn", { player: p });
  assert.equal(rules["Smarter than a Cow"](fight), true, "a fresh Brutus spawn starts a new attempt");
});
