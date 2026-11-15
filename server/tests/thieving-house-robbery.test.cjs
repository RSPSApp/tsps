// Run after `yarn build`: node --test tests/thieving-house-robbery.test.cjs
// Stealing valuables in Civitas illa Fortis (Wiki: Stealing valuables; rsprox captures 1102, 1104, 1105, 1106,
// 1108, 4054, 3275): the owners' errands, the locked door, searching, the shiny object, the whistle, being caught.
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Location } = require("../dist/game/model/Location");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");

const HouseRobbery = require("../plugins/skills/thieving/HouseRobbery.Thieving");

const { DATA, cycle, visits, houses } = HouseRobbery._test;
const log = [];
const world = { npcs: [], players: [], objects: [] };
const tasks = [];
const handlers = new Map();
/** Every custom event the module emits: [name, payload, world tick]. */
const emitted = [];
let core;

const id = {
  key: () => CacheDefinitions.getObjId(DATA.items.key),
  valuable: () => CacheDefinitions.getObjId(DATA.items.valuable),
  seq: (name) => CacheDefinitions.getSeqId(DATA.seqs[name]),
  varbit: (name) => CacheDefinitions.getVarbitId(DATA.varbits[name]),
  loc: (name) => CacheDefinitions.getLocId(name),
};

function npcOf(gameval, [x, y]) {
  const npcId = CacheDefinitions.getNpcId(gameval);
  let at = new Location(x, y, 0);
  const npc = {
    gameval, scripted: false, queue: [],
    getId: () => npcId, isRegistered: () => true, getPrivateArea: () => null,
    getLocation: () => at,
    moveTo(tile) { at = tile; log.push(`${gameval} at ${tile.getX()},${tile.getY()}`); },
    setScriptedMovement(value) { this.scripted = value; },
    getMovementQueue: () => ({ reset: () => {}, hasPendingWork: () => false }),
    setPositionToFace: () => {},
    forceChat(text) { log.push(`${gameval} says ${text}`); },
    performAnimation(animation) { log.push(`${gameval} seq ${animation.getId()}`); },
  };
  return npc;
}

function playerAt([x, y], { level = 60, keys = 1, valuables = 0, free = 20, attributes = {} } = {}) {
  let at = new Location(x, y, 0);
  const items = new Map([[id.key(), keys], [id.valuable(), valuables]]);
  const attrs = new Map(Object.entries(attributes));
  const me = {
    log: [], items, attrs, xp: 0,
    isRegistered: () => true,
    getIndex: () => 9,
    getLocation: () => at,
    moveTo(tile) { at = tile; me.log.push(`moved to ${tile.getX()},${tile.getY()}`); },
    setLocation(tile) { at = tile; me.log.push(`set to ${tile.getX()},${tile.getY()}`); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    sendMessage(text) { me.log.push(`game: ${text}`); },
    getPacketSender: () => ({
      sendTypedMessage: (_type, text) => me.log.push(`spam: ${text}`),
      sendSoundEffect: (soundId, _loops, delay) => me.log.push(`sound ${soundId}${delay ? ` delay ${delay}` : ""}`),
      sendVarbit: (varbitId, value) => me.log.push(`varbit ${varbitId}=${value}`),
      sendConfig: (varpId, value) => me.log.push(`varp ${varpId}=${value}`),
      sendPositionalHint: (tile, position, height) => me.log.push(`hint ${tile.getX()},${tile.getY()} position ${position} height ${height}`),
      clearHintArrow: () => me.log.push("hint cleared"),
    }),
    getSkillManager: () => ({ getCurrentLevel: () => level, getMaxLevel: () => level, addExperiences: (_s, xp) => { me.xp += xp; } }),
    getInventory: () => ({
      getAmount: (item) => items.get(item) ?? 0,
      delete: (item, n) => items.set(item, (items.get(item) ?? 0) - n),
      adds: (item, n) => items.set(item, (items.get(item) ?? 0) + n),
      getFreeSlots: () => free,
    }),
    getMovementQueue: () => ({ reset: () => {} }),
    setPositionToFace: () => {},
    performAnimation: (animation) => me.log.push(`anim ${animation.getId()}`),
    getDialogueManager: () => ({ startDialogues: (chain) => me.log.push(`box: ${chain.dialogues.get(0).getText()}`) }),
  };
  return me;
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const real = PM.getCoreApi();
  core = {
    ...real,
    World: { getNpcs: () => world.npcs, getPlayers: () => world.players, getProcessCycle: () => cycle.tick },
    TaskManager: { submit: (task) => { task.setRunning?.(true); tasks.push(task); }, cancelTasks: (key) => { for (const task of tasks) if (task.key === key) task.stop(); } },
    PathFinder: { calculateWalkRoute: (npc, x, y) => { log.push(`${npc.gameval} walks to ${x},${y}`); npc.moveTo(new Location(x, y, 0)); } },
    MapObjects: { get: (locId, at) => world.objects.find((o) => o.getId() === locId && o.getLocation().equals(at)) ?? null },
    ObjectManager: {
      register: (object) => { world.objects.push(object); log.push(`loc ${object.getId()} rot ${object.getFace()} at ${object.getLocation().getX()},${object.getLocation().getY()}`); },
      deregister: (object) => { world.objects.splice(world.objects.indexOf(object), 1); },
    },
    Sounds: { playAreaSound: (o) => log.push(`area sound ${o.soundId}${o.delay ? ` delay ${o.delay}` : ""} at ${o.x},${o.y}`) },
  };
  const api = {
    core,
    onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload, cycle.tick - 1]);
      if (name === "quest:is-complete") payload.complete = payload.player.questDone !== false;
      (handlers.get(name) ?? []).forEach((handler) => handler(payload));
    },
    persistAttribute() {}, onPlayerLogin() {}, onPlayerLogout() {}, onServerStartup() {}, onObjectInteraction() {},
  };
  HouseRobbery(api);
});

/** Runs the world clock and every task for `n` ticks. */
function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    HouseRobbery._test.processCycle(() => 0);
    HouseRobbery._test.processShinies(() => 0);
    for (const task of tasks.splice(0)) {
      if (task.tick()) tasks.push(task);
    }
  }
}

let owners;
beforeEach(() => {
  log.length = 0;
  tasks.length = 0;
  visits.clear();
  world.players = [];
  world.objects = [];
  owners = DATA.houses.map((house) => npcOf(house.owner, house.ownerInside));
  world.npcs = [...owners, ...DATA.houses.map((house) => npcOf(house.urchin, house.outside.map((v, i) => v + (i ? 3 : 0))))];
  const restore = Math.random;
  Math.random = () => 0;
  try {
    HouseRobbery._test.start();
  } finally {
    Math.random = restore;
  }
  tasks.length = 0;
  for (const house of DATA.houses) {
    world.objects.push(new core.GameObject(id.loc(DATA.locs.doorOpen), new Location(house.door[0], house.door[1], 0), 0, house.doorRotation.open, null));
  }
});

/** Plays the cycle until Lavinia (house 0: random() = 0 picks the first) has locked up. */
function untilLocked() {
  for (let i = 0; i < 60 && cycle.phase !== "away"; i++) tick();
  assert.equal(cycle.phase, "away");
  return houses[0];
}

function doorEvent(player, house) {
  const object = world.objects.find((o) => o.getLocation().equals(new Location(house.door[0], house.door[1], 0)));
  return { player, object, objectId: object.getId() };
}

function searchEvent(player, spot, gameval) {
  const object = new core.GameObject(id.loc(gameval), new Location(spot[0], spot[1], 0), 10, 0, null);
  return { player, object, objectId: object.getId() };
}

test("the data names the cache's owners, urchins, locs, items, varbits and sequences", () => {
  assert.deepEqual(DATA.houses.map((h) => NpcDefinition.forId(CacheDefinitions.getNpcId(h.owner)).getName()), ["Lavinia", "Victor", "Caius"]);
  assert.deepEqual(DATA.houses.map((h) => NpcDefinition.forId(CacheDefinitions.getNpcId(h.urchin)).getName()), ["Lucia", "Rufus", "Ava"]);
  assert.deepEqual([DATA.locs.doorOpen, DATA.locs.doorLocked, ...Object.keys(DATA.locs.searchables), DATA.locs.window].map(id.loc), [51999, 51998, 52008, 52010, 52011, 52998]);
  assert.deepEqual([id.key(), id.valuable()], [29325, 29332]);
  assert.deepEqual(["brokeIn", "lootProgress", "lastChecked", "specialLoc", "strangerMet", "mostValuables"].map(id.varbit), [9928, 9929, 9930, 9932, 9940, 9943]);
  assert.equal(CacheDefinitions.getVarpId(DATA.varps.lifetime), 4178);
  assert.deepEqual(["picklock", "grind", "search", "grab", "think", "angry"].map(id.seq), [10095, 10097, 11075, 11091, 857, 859]);
});

test("an owner leaves 10-17 ticks in, says their line on the way, locks up on the outside tile and goes off", () => {
  const house = untilLocked();
  assert.ok(cycle.tick >= 10 && cycle.tick <= 18, `left on tick ${cycle.tick}`);
  assert.ok(log.includes("varlamore_thieving_house_owner_1 says I need to get a few things from the bazaar."));
  // The lock: the pick, sound 2407 (delay 5) at the outside tile, the locked door at its captured rotation, sound 43 at the door.
  const lock = log.slice(log.indexOf(`varlamore_thieving_house_owner_1 seq ${id.seq("picklock")}`));
  assert.deepEqual(lock.slice(0, 4), [
    `varlamore_thieving_house_owner_1 seq ${id.seq("picklock")}`,
    "area sound 2407 delay 5 at 1668,3095",
    "loc 51998 rot 1 at 1668,3094",
    "area sound 43 at 1668,3094",
  ]);
  assert.ok(lock.includes("varlamore_thieving_house_owner_1 walks to 1674,3106"), "off on the errand");
  assert.equal(cycle.house, house);
});

test("the return, from the whistle: keys on 5, unlock on 10, open on 15, in on 16, a remark on 18, the next owner 10-17 ticks after", () => {
  untilLocked();
  const lockedAt = cycle.lockedAt;
  // random() = 0: away 302 ticks to "Ah, there they are!", so the whistle is 292 after the lock.
  assert.equal(cycle.whistleAt - lockedAt, 302 - 10);
  while (cycle.tick <= cycle.whistleAt) tick();
  const byStep = new Map();
  for (let step = 1; step <= 21; step++) {
    log.length = 0;
    tick();
    byStep.set(step, [...log]);
  }
  assert.deepEqual(byStep.get(5), [`varlamore_thieving_house_owner_1 seq ${id.seq("grind")}`, "varlamore_thieving_house_owner_1 says Now where did I put my keys...", "area sound 1735 at 1668,3094"]);
  assert.deepEqual(byStep.get(10), [`varlamore_thieving_house_owner_1 seq ${id.seq("picklock")}`, "varlamore_thieving_house_owner_1 says Ah, there they are!", "area sound 2407 delay 5 at 1668,3094"]);
  assert.deepEqual(byStep.get(15), ["loc 51999 rot 0 at 1668,3094", "area sound 44 at 1668,3094"]);
  assert.deepEqual(byStep.get(16), ["varlamore_thieving_house_owner_1 at 1668,3093"]);
  assert.deepEqual(byStep.get(18), ["varlamore_thieving_house_owner_1 says There's mud all over the floor!", `varlamore_thieving_house_owner_1 seq ${id.seq("think")}`]);
  assert.equal(cycle.phase, "home");
  assert.equal(cycle.last, houses[0]);
  const reopened = cycle.whistleAt + 15;
  while (cycle.phase === "home") tick();
  assert.ok(cycle.leftAt - reopened >= 10 && cycle.leftAt - reopened <= 17 + 6, `next left ${cycle.leftAt - reopened} after`);
  assert.notEqual(cycle.house, houses[0], "never the same house twice running");
});

test("the house's urchin whistles; only a player inside it is warned, and their window has no question after it", () => {
  const house = untilLocked();
  const thief = playerAt(house.outside);
  const passer = playerAt([1660, 3100]);
  world.players = [thief, passer];
  HouseRobbery._test.openDoor(doorEvent(thief, house));
  tick(2);
  const question = { player: thief, objectId: id.loc(DATA.locs.window), ask: true };
  HouseRobbery._test.windowQuestion(question);
  assert.equal(question.ask, true, "before the whistle the window asks");
  while (cycle.phase === "away") tick();
  assert.ok(log.includes("varlamore_thieving_house_urchin_c says *Whistle*"));
  assert.ok(thief.log.includes(`game: ${DATA.messages.warning}`));
  assert.ok(thief.log.includes("sound 1569"));
  assert.deepEqual(passer.log, []);
  HouseRobbery._test.windowQuestion(question);
  assert.equal(question.ask, false);
});

test("breaking in: the pick, the key and sound 2407 on arrival; the message, the move, sound 2419 and 1 XP two ticks later", () => {
  const house = untilLocked();
  const thief = playerAt(house.outside, { keys: 3 });
  world.players = [thief];
  assert.equal(HouseRobbery._test.openDoor(doorEvent(thief, house)), true);
  assert.deepEqual(thief.log, [`anim ${id.seq("picklock")}`, "sound 2407 delay 5", "varbit 9928=1", "hint cleared", `varbit ${CacheDefinitions.getVarbitId("current_hint_arrow")}=0`]);
  assert.equal(thief.items.get(id.key()), 2);
  thief.log.length = 0;
  tick(2);
  assert.deepEqual(thief.log, [`spam: ${DATA.messages.enter}`, "moved to 1668,3094", "anim -1", "sound 2419"]);
  assert.equal(thief.xp, 1);
  assert.equal(thief.attrs.get(HouseRobbery._test.INSIDE_ATTRIBUTE), "lavinia");
  // A second Open (a click queued behind the first) breaks no second key.
  HouseRobbery._test.openDoor(doorEvent(thief, house));
  assert.equal(thief.items.get(id.key()), 2);
});

test("the door's refusals: owner home or no key is nothing interesting, too low a level the House Robbery box, the owner still near", () => {
  const home = houses[1];
  const thief = playerAt(home.outside);
  HouseRobbery._test.openDoor(doorEvent(thief, home));
  assert.deepEqual(thief.log, ["game: Nothing interesting happens."]);
  const house = untilLocked();
  const keyless = playerAt(house.outside, { keys: 0 });
  HouseRobbery._test.openDoor(doorEvent(keyless, house));
  assert.deepEqual(keyless.log, ["game: Nothing interesting happens."]);
  const novice = playerAt(house.outside, { level: 49 });
  HouseRobbery._test.openDoor(doorEvent(novice, house));
  assert.deepEqual(novice.log, [`box: ${DATA.messages.level}`]);
  const early = playerAt(house.outside);
  owners[0].moveTo(new Location(1670, 3097, 0));
  HouseRobbery._test.openDoor(doorEvent(early, house));
  assert.deepEqual(early.log, [`game: ${DATA.messages.nearDoor}`]);
  const unquested = playerAt(house.outside);
  unquested.questDone = false;
  owners[0].moveTo(new Location(1674, 3106, 0));
  HouseRobbery._test.openDoor(doorEvent(unquested, house));
  assert.deepEqual(unquested.log, ["game: You need to complete Children of the Sun before you can do that."]);
});

function brokenIn(options) {
  const house = untilLocked();
  const thief = playerAt(house.outside, options);
  world.players = [thief];
  HouseRobbery._test.openDoor(doorEvent(thief, house));
  tick(2);
  thief.log.length = 0;
  return { house, thief };
}

test("searching: the first search sets 28-32 rolls and its line; every 3 ticks a roll, a valuable and 45 XP on a success", () => {
  const { house, thief } = brokenIn({ level: 80 });
  const restore = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(HouseRobbery._test.search(searchEvent(thief, house.searchables[0], "varlamore_thieving_house_chest04")), true);
  } finally {
    Math.random = restore;
  }
  assert.deepEqual(thief.log, [`varbit ${id.varbit("lootProgress")}=28`, "spam: You start to search through the chest...", `anim ${id.seq("search")}`]);
  thief.log.length = 0;
  tick(3);
  assert.deepEqual(thief.log, [
    `varbit ${id.varbit("lootProgress")}=27`, `anim ${id.seq("search")}`,
    `spam: ${DATA.messages.found}`, "sound 2582", "varp 4178=1", `varbit ${id.varbit("mostValuables")}=1`,
  ]);
  assert.equal(thief.items.get(id.valuable()), 1);
  assert.equal(thief.xp, 1 + 45);
  tick(3 * 27);
  assert.equal(thief.items.get(id.valuable()), 28, "level 80: every roll lands, 28 of them");
  assert.equal(tasks.filter((t) => t.isRunning()).length, 0, "and the search stops at 0");
});

test("a switch of object re-rolls; a full inventory refuses; only the vacant house's own objects, and only after breaking in", () => {
  const { house, thief } = brokenIn();
  HouseRobbery._test.search(searchEvent(thief, house.searchables[0], "varlamore_thieving_house_chest04"));
  tick(6);
  thief.log.length = 0;
  HouseRobbery._test.search(searchEvent(thief, house.searchables[2], "varlamore_thieving_house_wardrobe02"));
  assert.ok(thief.log.includes("spam: You start to search through the wardrobe..."));
  const full = playerAt(house.entry, { free: 0 });
  visits.set(full, { ...visits.get(thief) });
  HouseRobbery._test.search(searchEvent(full, house.searchables[0], "varlamore_thieving_house_chest04"));
  assert.deepEqual(full.log, [`spam: ${DATA.messages.full}`]);
  const visitor = playerAt(houses[1].entry);
  HouseRobbery._test.search(searchEvent(visitor, houses[1].searchables[0], "varlamore_thieving_house_chest04"));
  assert.deepEqual(visitor.log, ["game: Nothing interesting happens."]);
  const other = { player: thief, object: new core.GameObject(id.loc("varlamore_thieving_house_door_open"), new Location(1, 1, 0), 0, 0, null) };
  assert.equal(HouseRobbery._test.search(other), false, "another Chest's Search falls through");
});

test("the shiny object: 43-85 ticks after the search starts, another object, an arrow at height 70 for 12 ticks; searching it is 14 valuables and 630 XP", () => {
  const { house, thief } = brokenIn({ level: 50 });
  const restore = Math.random;
  Math.random = () => 0.999;
  try {
    HouseRobbery._test.search(searchEvent(thief, house.searchables[0], "varlamore_thieving_house_chest04"));
  } finally {
    Math.random = restore;
  }
  const started = cycle.tick;
  thief.log.length = 0;
  // The search rolled the long end (85 ticks); the world clock picks the first other object.
  tick(84);
  assert.equal(visits.get(thief).shiny, null, "not before its time");
  tick(1);
  const shone = thief.log.indexOf(`game: ${DATA.messages.shiny}`);
  assert.ok(shone >= 0);
  assert.ok(visits.get(thief).shiny);
  assert.equal(cycle.tick - started, 85);
  const spot = house.searchables[1];
  assert.ok(thief.log.includes(`hint ${spot[0]},${spot[1]} position 2 height 70`));
  assert.ok(thief.log.includes(`varbit ${CacheDefinitions.getVarbitId("current_hint_arrow")}=6`));
  assert.ok(thief.log.includes("sound 3147"));
  const before = thief.items.get(id.valuable());
  const xp = thief.xp;
  thief.log.length = 0;
  const original = Math.random;
  Math.random = () => 0;
  try {
    HouseRobbery._test.search(searchEvent(thief, spot, "varlamore_thieving_house_chest04"));
  } finally {
    Math.random = original;
  }
  assert.equal(thief.items.get(id.valuable()) - before, 14);
  assert.equal(thief.xp - xp, 630);
  assert.ok(thief.log.includes(`spam: ${DATA.messages.grab}`));
  assert.ok(thief.log.includes(`anim ${id.seq("grab")}`));
  assert.ok(thief.log.includes("sound 2115"));
  assert.ok(!thief.log.some((line) => line.startsWith("spam: You start to search")), "no start line on the shiny one");
  // One that isn't taken goes after 12 ticks (the next comes 43-85 ticks after the grab; random() = 0 here: 43).
  tick(43);
  assert.ok(visits.get(thief).shiny);
  tick(12);
  assert.equal(visits.get(thief).shiny, null);
});

test("caught: the owner steps in while the thief is inside; thrown out with a tenth of what they took there, and an accusation", () => {
  const { house, thief } = brokenIn({ level: 80, valuables: 5 });
  HouseRobbery._test.search(searchEvent(thief, house.searchables[0], "varlamore_thieving_house_chest04"));
  while (cycle.phase !== "returning") tick();
  log.length = 0;
  tick(15);
  const stolen = visits.get(thief).stolen;
  assert.ok(stolen >= 10, `${stolen} stolen`);
  // The search is still going; the owner's step in on 16 is the catch.
  const held = thief.items.get(id.valuable());
  assert.equal(held, 5 + stolen);
  tick(7);
  assert.equal(thief.items.get(id.valuable()), 5 + Math.floor(stolen * 0.1), "the five from before are kept");
  assert.ok(thief.log.includes("moved to 1668,3095"));
  assert.equal(visits.has(thief), false);
  assert.ok(log.includes("varlamore_thieving_house_owner_1 says What are you doing here?"));
  assert.ok(log.includes("varlamore_thieving_house_owner_1 says Guards! Guards!"));
  assert.ok(log.includes(`varlamore_thieving_house_owner_1 seq ${id.seq("angry")}`));
});

test("out of the window before the owner is in: the visit ends and nothing is lost", () => {
  const { house, thief } = brokenIn({ level: 80 });
  HouseRobbery._test.search(searchEvent(thief, house.searchables[0], "varlamore_thieving_house_chest04"));
  tick(9);
  const held = thief.items.get(id.valuable());
  thief.moveTo(new Location(1670, 3087, 0));
  HouseRobbery._test.leftByWindow({ player: thief, objectId: id.loc(DATA.locs.window) });
  assert.equal(visits.has(thief), false);
  assert.ok(thief.log.includes("varbit 9928=0"));
  while (cycle.phase !== "home") tick();
  assert.equal(thief.items.get(id.valuable()), held);
});

test("inside a house when its owner locks up: escorted out", () => {
  const visitor = playerAt([1670, 3091]);
  world.players = [visitor];
  untilLocked();
  assert.ok(visitor.log.includes(`game: ${DATA.messages.escorted}`));
  assert.ok(visitor.log.includes("moved to 1668,3095"));
});

test("a relog inside the house puts the player outside its door", () => {
  const player = playerAt([1670, 3091], { attributes: { [HouseRobbery._test.INSIDE_ATTRIBUTE]: "lavinia" } });
  HouseRobbery._test.onLogin({ player });
  assert.ok(player.log.includes("moved to 1668,3095"));
  assert.equal(player.attrs.get(HouseRobbery._test.INSIDE_ATTRIBUTE), null);
});

test("the search chance: 0.65 at 50, every roll from 74", () => {
  const at = (level) => HouseRobbery._test.successChance(playerAt([0, 0], { level }));
  assert.equal(at(50), 0.65);
  assert.ok(at(62) > 0.8 && at(62) < 0.85);
  assert.equal(at(74), 1);
  assert.equal(at(99), 1);
});

test("logging out inside: put outside before the save, so a relog is outside the door (Wiki)", () => {
  const { thief } = brokenIn();
  HouseRobbery._test.onLogout({ player: thief });
  assert.ok(thief.log.includes("set to 1668,3095"), JSON.stringify(thief.log));
  assert.equal(visits.has(thief), false);
});

test("leaving the house another way (a teleport) ends the visit: no whistle there, and the next door opens", () => {
  const { house, thief } = brokenIn({ keys: 2 });
  thief.moveTo(new Location(3222, 3218, 0));
  tick();
  assert.equal(visits.has(thief), false);
  while (cycle.phase === "away") tick();
  assert.ok(!thief.log.includes(`game: ${DATA.messages.warning}`));
  while (cycle.phase !== "away") tick();
  const next = cycle.house;
  assert.notEqual(next, house);
  thief.moveTo(new Location(next.outside[0], next.outside[1], 0));
  owners.find((owner) => owner.gameval === next.owner).moveTo(new Location(next.errand[0], next.errand[1], 0));
  HouseRobbery._test.openDoor(doorEvent(thief, next));
  assert.equal(visits.get(thief)?.house, next, "breaks into the next house");
});

test("walking off during the pick: no way in, the visit over", () => {
  const house = untilLocked();
  const thief = playerAt(house.outside, { keys: 2 });
  world.players = [thief];
  HouseRobbery._test.openDoor(doorEvent(thief, house));
  thief.moveTo(new Location(1668, 3099, 0));
  tick(2);
  assert.ok(!thief.log.some((line) => line.includes("sneak in")));
  assert.equal(visits.has(thief), false);
  assert.ok(thief.log.includes("varbit 9928=0"));
});

test("3 ticks after the door reopens (whistle +18) the house is announced as reopened, for the urchins to forget it", () => {
  untilLocked();
  while (cycle.phase !== "returning") tick();
  const at = cycle.whistleAt;
  emitted.length = 0;
  for (let i = 0; i < 22; i++) tick();
  const reopened = emitted.filter(([name]) => name === "house-robbery:reopened");
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0][1].house.key, "lavinia");
  assert.equal(reopened[0][2] - at, 18);
});
