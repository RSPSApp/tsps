// Wine of Zamorak spawns: Zamorak's punishment, the guarding monks, hand-take rules, noted wine.
//   node --test tests/wine-of-zamorak.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const plugin = require("../plugins/items/WineOfZamorak.plugin");

const Skill = { ATTACK: "attack", DEFENCE: "defence", STRENGTH: "strength", HITPOINTS: "hitpoints", RANGED: "ranged", PRAYER: "prayer", MAGIC: "magic" };
const WINE = 245;
const DISPLAY_WINE = 23489;
const NAMES = { 1033: "Zamorak monk bottom", 1035: "Zamorak monk top", 10460: "Zamorak robe top", 10468: "Zamorak robe legs", 1101: "Iron chainbody" };

const loc = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
let npcs = [];
let tasks = [];
const pickups = [];
const handlers = new Map();
let completeTiers = new Set();

class Task {
  constructor(delay) { this.delay = delay; this.stopped = false; }
  stop() { this.stopped = true; }
}
const core = {
  ItemIdentifiers: { WINE_OF_ZAMORAK: WINE, WINE_OF_ZAMORAK_3: DISPLAY_WINE },
  Skill,
  Equipment: { BODY_SLOT: 4, LEG_SLOT: 7 },
  ItemDefinition: { forId: (id) => ({ getName: () => NAMES[id] ?? "" }) },
  Graphic: class { constructor(id) { this.id = id; } },
  HitDamage: class { constructor(damage, mask) { this.damage = damage; this.mask = mask; } },
  HitMask: { RED: "red" },
  Task,
  TaskManager: { submit: (task) => tasks.push(task) },
  World: { getNpcs: () => ({ forEach: (action) => npcs.forEach(action) }) },
  // The generic pickup runs the pickup hooks again: record whether the wine's hook let it through.
  ItemOnGroundManager: {
    pickup(player, groundItem) {
      const event = { player, groundItem, handled: false };
      handlers.get("pickup")(event);
      pickups.push([player, groundItem, event.handled]);
    },
  },
};
const api = {
  core,
  onGroundItemPickup: (handler) => handlers.set("pickup", handler),
  onCustomEvent: (name, handler) => handlers.set(name, handler),
  emitCustomEvent(name, request) {
    if (name === "diary:is-complete") request.complete = completeTiers.has(`${request.diary}:${request.tier}`);
  },
};
plugin.register(api);

function runTicks() {
  const due = tasks;
  tasks = [];
  for (const task of due) task.execute();
}

function player({ levels = {}, hitpoints = 99, worn = {} } = {}) {
  const current = { attack: 99, defence: 99, strength: 99, ranged: 99, prayer: 99, magic: 99, hitpoints, ...levels };
  const p = {
    messages: [], graphics: [], sounds: [], hits: [], current, tile: [2931, 3515, 0],
    isRegistered: () => true,
    getLocation: () => loc(...p.tile),
    getHitpoints: () => current.hitpoints,
    sendMessage: (message) => p.messages.push(message),
    performGraphic: (graphic) => p.graphics.push(graphic.id),
    getPacketSender: () => ({ sendSoundEffect: (id) => p.sounds.push(id) }),
    getEquipment: () => ({ getItems: () => Object.assign([], { 4: worn.body && { getId: () => worn.body }, 7: worn.legs && { getId: () => worn.legs } }) }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => current[skill],
      getMaxLevel: (skill) => (skill === Skill.HITPOINTS ? hitpoints : 99),
      decreaseCurrentLevel: (skill, amount, minimum) => { current[skill] = Math.max(minimum, current[skill] - amount); },
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => p.hits.push(...hits.map((hit) => hit.damage)) }) }),
  };
  return p;
}

function monk(x, y, z = 0, name = "Monk of Zamorak") {
  const m = { attacked: [], target: null, hp: 20 };
  Object.assign(m, {
    isRegistered: () => true,
    getHitpoints: () => m.hp,
    getDefinition: () => ({ getName: () => name }),
    getLocation: () => loc(x, y, z),
    getCombat: () => ({ getTarget: () => m.target, attack: (target) => { m.attacked.push(target); m.target = target; } }),
  });
  return m;
}

function wine(x, y, z = 0, id = WINE, staticSpawn = true) {
  return { isStaticSpawn: () => staticSpawn, getPosition: () => loc(x, y, z), getItem: () => ({ getId: () => id }) };
}

const FLOOR0 = [2930, 3515, 0];
const FLOOR1 = [2938, 3517, 1];
const CHURCH = [2950, 3824, 0];
const DUNGEON = [3018, 10353, 0];

function reset() {
  npcs = [];
  tasks = [];
  pickups.length = 0;
  completeTiers = new Set();
}

test("the drain and the hit are level / 20 + 1", () => {
  const { penalty } = plugin._test;
  assert.deepEqual([1, 19, 20, 39, 40, 59, 60, 79, 80, 99].map(penalty), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(penalty(109), 6, "a boosted level loses more");
  assert.equal(penalty(0), 1);
});

test("the punishment: the shout, flame, sound and drain now, the hit a tick later", () => {
  reset();
  const p = player({ levels: { attack: 109, ranged: 91, prayer: 70, defence: 42, magic: 3 }, hitpoints: 41 });
  plugin._test.punish(p);
  assert.deepEqual(p.messages, ["STOP STEALING MY WINE! GAH!"]);
  assert.deepEqual(p.graphics, [78]);
  assert.deepEqual(p.sounds, [229]);
  assert.deepEqual({ ...p.current }, { attack: 103, defence: 39, strength: 94, ranged: 86, prayer: 66, magic: 2, hitpoints: 41 });
  assert.deepEqual(p.hits, [], "no hit on the punishment tick");
  runTicks();
  assert.deepEqual(p.hits, [3], "the hit follows the Hitpoints level");
});

test("by hand at Asgarnia with the monks alive: punished, attacked, and the wine stays", () => {
  reset();
  const guards = [monk(2931, 3516), monk(2940, 3517)];
  const elsewhere = [monk(2938, 3516, 1), monk(2931, 3516, 0, "Monk")];
  npcs = [...guards, ...elsewhere];
  const p = player();
  const event = { player: p, groundItem: wine(...FLOOR0), handled: false };
  handlers.get("pickup")(event);
  assert.equal(event.handled, true);
  assert.deepEqual(p.messages, ["STOP STEALING MY WINE! GAH!"]);
  assert.deepEqual(guards.map((m) => m.attacked.length), [1, 1], "the floor's monks attack");
  assert.deepEqual(elsewhere.map((m) => m.attacked.length), [0, 0], "the upper floor's monk and other NPCs don't");
  runTicks();
  assert.deepEqual(p.hits, [5]);
  assert.equal(pickups.length, 0, "the wine is not taken");
});

test("by hand at Asgarnia once the floor's monks are dead: punished, and the wine comes away a tick later", () => {
  reset();
  const dead = monk(2931, 3516);
  dead.hp = 0;
  npcs = [dead, monk(2938, 3516, 1)];
  const p = player();
  const groundItem = wine(...FLOOR0);
  const event = { player: p, groundItem, handled: false };
  handlers.get("pickup")(event);
  assert.equal(event.handled, true, "the generic take waits for the next tick");
  assert.equal(p.messages.length, 1);
  assert.equal(pickups.length, 0);
  runTicks();
  assert.deepEqual(p.hits, [5]);
  assert.deepEqual(pickups, [[p, groundItem, false]], "the released take goes through the generic pickup");
  assert.equal(p.messages.length, 1, "and is not punished twice");
  const again = { player: p, groundItem, handled: false };
  handlers.get("pickup")(again);
  assert.equal(again.handled, true, "a later take is the wine's again");
});

test("by hand on the upper floor: its monk attacks whatever is worn", () => {
  reset();
  const upstairs = monk(2938, 3516, 1);
  npcs = [upstairs, monk(2931, 3516)];
  const p = player({ worn: { body: 1035, legs: 1033 } });
  handlers.get("pickup")({ player: p, groundItem: wine(...FLOOR1), handled: false });
  assert.deepEqual(upstairs.attacked, [p]);
  assert.equal(npcs[1].attacked.length, 0);
  runTicks();
  assert.equal(pickups.length, 0);
});

test("by hand in the Wilderness: never taken, and nothing else happens", () => {
  for (const [tile, id] of [[CHURCH, WINE], [DUNGEON, DISPLAY_WINE]]) {
    reset();
    const p = player();
    const event = { player: p, groundItem: wine(...tile, id), handled: false };
    handlers.get("pickup")(event);
    assert.equal(event.handled, true);
    assert.deepEqual(p.messages, []);
    runTicks();
    assert.equal(pickups.length, 0);
  }
});

test("other ground items and dropped wine are left alone", () => {
  reset();
  for (const groundItem of [wine(...FLOOR0, WINE, false), wine(2931, 3515, 0), wine(...FLOOR0, 1917)]) {
    const event = { player: player(), groundItem, handled: false };
    handlers.get("pickup")(event);
    assert.equal(event.handled, false);
  }
  const p = player();
  handlers.get("magic:telekinetic-grab-cast")({ player: p, groundItem: wine(2931, 3515, 0) });
  assert.deepEqual(p.messages, []);
});

test("Telekinetic Grab: punished on the cast; the ground floor's monks attack", () => {
  reset();
  const guard = monk(2934, 3515);
  npcs = [guard];
  const p = player({ worn: { body: 1035, legs: 1033 } });
  handlers.get("magic:telekinetic-grab-cast")({ player: p, groundItem: wine(...FLOOR0) });
  assert.deepEqual(p.messages, ["STOP STEALING MY WINE! GAH!"]);
  assert.deepEqual(guard.attacked, [p], "robes don't calm the ground floor");
  runTicks();
  assert.deepEqual(p.hits, [5]);
});

test("Telekinetic Grab on the upper floor: robes keep its monk off", () => {
  const cases = [
    [{ body: 1035, legs: 1033 }, 0], [{ body: 10460, legs: 10468 }, 0], [{ body: 1035, legs: 10468 }, 0],
    [{ body: 1035 }, 1], [{ body: 1101, legs: 1033 }, 1], [{}, 1],
  ];
  for (const [worn, attacks] of cases) {
    reset();
    const upstairs = monk(2938, 3516, 1);
    npcs = [upstairs];
    const p = player({ worn });
    handlers.get("magic:telekinetic-grab-cast")({ player: p, groundItem: wine(...FLOOR1) });
    assert.equal(p.messages.length, 1, "the grab is punished either way");
    assert.equal(upstairs.attacked.length, attacks, JSON.stringify(worn));
  }
});

test("Telekinetic Grab in the Wilderness: the church is punished, the dungeon isn't", () => {
  reset();
  const church = player();
  handlers.get("magic:telekinetic-grab-cast")({ player: church, groundItem: wine(...CHURCH) });
  assert.deepEqual(church.messages, ["STOP STEALING MY WINE! GAH!"]);
  const dungeonMonk = monk(3020, 10355);
  npcs = [dungeonMonk];
  const dungeon = player();
  handlers.get("magic:telekinetic-grab-cast")({ player: dungeon, groundItem: wine(...DUNGEON, DISPLAY_WINE) });
  assert.deepEqual(dungeon.messages, []);
  assert.equal(dungeonMonk.attacked.length, 0);
});

test("the hard Wilderness Diary notes the Wilderness wines only", () => {
  reset();
  const noted = (tile, id, tiers) => {
    completeTiers = new Set(tiers);
    const request = { player: player(), groundItem: wine(...tile, id), source: "telegrab", noted: false };
    handlers.get("ground-items:reward")(request);
    return request.noted;
  };
  assert.equal(noted(CHURCH, WINE, ["wilderness:hard"]), true);
  assert.equal(noted(DUNGEON, DISPLAY_WINE, ["wilderness:hard"]), true);
  assert.equal(noted(CHURCH, WINE, ["wilderness:medium"]), false);
  assert.equal(noted(FLOOR0, WINE, ["wilderness:hard"]), false);
  assert.equal(noted(FLOOR1, WINE, ["wilderness:hard", "falador:hard"]), false);
});

test("by hand: walking off before the wine comes away drops the take, and repeat clicks wait for it", () => {
  reset();
  const p = player();
  const groundItem = wine(...FLOOR0);
  handlers.get("pickup")({ player: p, groundItem, handled: false });
  const repeat = { player: p, groundItem, handled: false };
  handlers.get("pickup")(repeat);
  assert.equal(repeat.handled, true);
  assert.equal(p.messages.length, 1, "a take on its way is not punished again");
  assert.equal(tasks.length, 2, "one hit and one release, not two of each");
  p.tile = [2932, 3515, 0];
  runTicks();
  assert.equal(pickups.length, 0, "the player walked off");
  p.tile = [2931, 3515, 0];
  handlers.get("pickup")({ player: p, groundItem, handled: false });
  assert.equal(p.messages.length, 2, "a new take after that is the wine's again");
  runTicks();
  assert.deepEqual(pickups, [[p, groundItem, false]]);
});
