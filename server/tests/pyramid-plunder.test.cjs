// Run after `yarn build`: node --test tests/pyramid-plunder.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const PyramidPlunder = require("../plugins/minigames/PyramidPlunder.plugin");

const T = PyramidPlunder._test;
const C = T.Common;

/** Ticks, tasks and the world cycle under the test's control. */
const clock = { cycle: 1000, tasks: [] };
const spawned = [];
const removed = [];
const prompts = [];
let questStarted = true;

/** Lets the last action's ticks pass, so the next click is taken. */
function next() {
  clock.cycle += 5;
}

function flush(ticks = 10) {
  for (let i = 0; i < ticks; i++) {
    clock.cycle++;
    const due = clock.tasks.filter((task) => --task.left <= 0);
    clock.tasks = clock.tasks.filter((task) => task.left > 0);
    for (const task of due) task.task.execute();
  }
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const real = PluginManager.getCoreApi();
  const core = {
    ...real,
    World: { getProcessCycle: () => clock.cycle },
    TaskManager: { submit: (task) => clock.tasks.push({ task, left: task.delay ?? task.getDelay?.() ?? 1 }) },
    CombatFactory: { poisonEntity: (player, severity) => { player.poisoned = severity; } },
    ItemOnGroundManager: { registerLocation: (player, item, at) => { player.ground.push([item.getId(), at]); } },
  };
  const api = {
    core,
    emitCustomEvent(name, payload) {
      if (name === "quest:is-started") payload.started = questStarted;
      if (name === "npc-dialogue:start") {
        payload.handled = true;
        startedVariants.push(payload.variant);
      }
    },
    spawnNpc(definition) {
      const npc = { definition, attacked: null, getCombat: () => ({ attack: (target) => { npc.attacked = target; } }) };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => removed.push(npc),
    sendMultiChatboxPrompt: (player, title, ...pairs) => { prompts.push({ player, title, pairs }); return true; },
  };
  C.bind(api);
});

/** The variants "npc-dialogue:start" was asked to play, latest last. */
const startedVariants = [];

/** Always (1), never (0), or a fixed roll. */
const always = () => 0;
const never = () => 0.999999;

function player({ thieving = 99, strength = 99, items = {}, at = { x: 3289, y: 2801, z: 0 } } = {}) {
  const attrs = new Map();
  const varbits = new Map();
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const Skill = C.getCore().Skill;
  const p = {
    at: { ...at },
    messages: [],
    xp: { THIEVING: 0, STRENGTH: 0 },
    hits: [],
    anims: [],
    ground: [],
    overlay: null,
    poisoned: 0,
    sounds: [],
    areaSounds: [],
    spam: [],
    dialogues: [],
    varbits,
    inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.STRENGTH ? strength : thieving),
      getMaxLevel: (skill) => (skill === Skill.STRENGTH ? strength : thieving),
      addExperiences: (skill, amount) => { p.xp[skill === Skill.STRENGTH ? "STRENGTH" : "THIEVING"] += amount; },
    }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => varbits.set(id, value),
      getVarbit: (id) => varbits.get(id) ?? 0,
      sendSubInterface: (uid, id) => { p.overlay = id; },
      closeSubInterface: () => { p.overlay = null; },
      sendSound: (id) => p.sounds.push(id),
      sendAreaSound: (id, x, y, z, loops, delay, range) => p.areaSounds.push({ id, x, y, z, range }),
      sendTypedMessage: (_type, message) => { p.messages.push(message); p.spam.push(message); },
      sendObjectAnimation: () => {},
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.dialogues.push(chain) }),
    getMovementQueue: () => ({ reset: () => {} }),
    getForceMovement: () => p.forced,
    setForceMovement: (value) => { p.forced = value; },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      addItem: (item) => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      getFreeSlots: () => 28 - [...inventory.values()].filter((amount) => amount > 0).length,
      getAddableAmount: (item) => Math.min(item.getAmount(), 0x7fffffff - (inventory.get(item.getId()) ?? 0)),
    }),
    getCombat: () => ({ reset: () => {}, getHitQueue: () => ({ addPendingDamage: (hits) => p.hits.push(...hits.map((h) => h.getDamage?.() ?? h.damage ?? h)) }) }),
    performAnimation: (anim) => p.anims.push(anim),
    sendMessage: (message) => p.messages.push(message),
    getLocation: () => ({ getX: () => p.at.x, getY: () => p.at.y, getZ: () => p.at.z, clone: () => ({ ...p.at }) }),
    moveTo: (location) => { p.at = { x: location.getX(), y: location.getY(), z: location.getZ() }; },
  };
  return p;
}

const ids = () => C.ids();
const art = (key) => ids().item.artefacts[key];
const artefactCount = (p) => Object.values(ids().item.artefacts).reduce((n, id) => n + Math.max(0, p.inventory.get(id) ?? 0), 0);
const roomOf = (p) => C.roomAt(p.at.x, p.at.y, p.at.z);
const objectAt = (room, objectId) => {
  const b = C.roomData(room).bounds;
  return { objectId, location: { x: b.minX + 2, y: b.minY + 2, z: 0 } };
};
const firstUrn = () => [...ids().urns.keys()][0];
const doorId = (n) => [...ids().tombDoors.entries()].find(([, door]) => door === n)[0];

// --- Data and rolls

test("rooms, XP and sceptre rates follow the Wiki", () => {
  assert.equal(C.ROOMS.length, 8);
  assert.deepEqual(C.ROOMS.map((r) => r.level), [21, 31, 41, 51, 61, 71, 81, 91]);
  assert.deepEqual(C.ROOMS.map((r) => r.urnXp), [60, 90, 150, 215, 300, 450, 675, 825]);
  assert.deepEqual(C.ROOMS.map((r) => r.chestXp), [40, 60, 100, 140, 200, 300, 450, 550]);
  assert.deepEqual(C.ROOMS.map((r) => r.sarcophagusXp), [20, 30, 50, 70, 100, 150, 225, 275]);
  assert.deepEqual(C.ROOMS.map((r) => r.sceptre), [4200, 2800, 1600, 950, 800, 750, 650, 650]);
  for (const room of C.ROOMS) {
    const b = room.bounds;
    assert.ok(room.entry.x >= b.minX && room.entry.x <= b.maxX && room.entry.y >= b.minY && room.entry.y <= b.maxY, `room ${room.room} entry inside`);
  }
});

test("fitted chances hit the Wiki's chart values", () => {
  assert.equal(Math.round(C.chanceOf("urnSearch", 21, 1) * 256), 117);
  assert.equal(Math.round(C.chanceOf("urnSearch", 99, 1) * 256), 181);
  assert.equal(Math.round(C.chanceOf("urnSearch", 99, 4) * 256), 178, "1/256 less per room");
  assert.equal(Math.round(C.chanceOf("checkForSnakes", 21, 1) * 256), 179);
  assert.equal(Math.round(C.chanceOf("checkForSnakes", 69, 1) * 256), 223);
  assert.equal(Math.round(C.chanceOf("door", 21, 1) * 256), 149);
  assert.equal(Math.round(C.chanceOf("door", 99, 1) * 256), 221);
  assert.equal(Math.round(C.chanceOf("doorLockpick", 21, 1) * 256), 179);
  assert.equal(Math.round(C.chanceOf("speartrap", 99, 1) * 256), 251);
  assert.equal(Math.round(C.sarcophagusChance(1, 1) * 256), 60);
  assert.equal(Math.round(C.sarcophagusChance(99, 1) * 256), 250);
  assert.equal(Math.round(C.sarcophagusChance(1, 6) * 256), 10);
  assert.equal(C.sarcophagusChance(1, 7), 0, "room 7: impossible at Strength 1");
  assert.ok(C.sarcophagusChance(2, 7) > 0);
  assert.equal(C.sarcophagusChance(7, 8), 0, "room 8: impossible up to Strength 7");
  assert.ok(C.sarcophagusChance(8, 8) > 0);
});

test("loot tables: one artefact per chest and sarcophagus from the room's table", () => {
  assert.equal(C.rollChestArtefact(1, () => 0), "stoneSeal");
  assert.equal(C.rollChestArtefact(1, () => 0.5), "stoneScarab");
  assert.equal(C.rollChestArtefact(8, () => 0.99), "goldenStatuette");
  assert.equal(C.rollSarcophagusArtefact(1, () => 0), "potteryScarab");
  assert.equal(C.rollSarcophagusArtefact(8, () => 0.99), "goldSeal");
  assert.equal(C.rollUrnArtefact(1, () => 0), "ivoryComb");
  assert.equal(C.rollUrnArtefact(8, () => 0.99), "goldenStatuette");
  assert.equal(C.rollSceptre(8, () => 0), true);
  assert.equal(C.rollSceptre(8, () => 1 / 650), false);
});

// --- Entry, rooms and the timer

test("21 Thieving and Icthlarin's Little Helper started are needed to play", () => {
  const low = player({ thieving: 20 });
  assert.equal(T.Entrance.tryStart(low), false);
  assert.deepEqual(low.messages, [C.MESSAGES.entryLevel]);
  questStarted = false;
  const noQuest = player({ thieving: 50 });
  assert.equal(T.Entrance.tryStart(noQuest), false);
  assert.deepEqual(noQuest.messages, [C.MESSAGES.quest]);
  questStarted = true;
  assert.equal(C.sessionOf(low), null);
});

test("a run starts in room 1 with the overlay, a full timer and closed rooms", () => {
  const p = player({ thieving: 21 });
  p.varbits.set(ids().urnVarbits[0], 1);
  assert.equal(T.Entrance.tryStart(p, () => 0), true);
  const run = C.sessionOf(p);
  assert.equal(run.room, 1);
  assert.equal(roomOf(p), 1);
  assert.equal(p.overlay, ids().overlay);
  assert.equal(p.varbits.get(ids().varbit.room), 1);
  assert.equal(p.varbits.get(ids().varbit.level), 21);
  assert.equal(p.varbits.get(ids().varbit.timer), 0);
  assert.equal(p.varbits.get(ids().urnVarbits[0]), 0, "rooms reset");
  C.endRun(p);
});

test("rooms advance in order through the right door, and only with the level", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  C.sessionOf(p).exits = [2, 2, 2, 2, 2, 2, 2, 2];
  T.Passages.pickLock({ player: p, ...objectAt(1, doorId(1)) }, always);
  assert.ok(!p.messages.includes(C.MESSAGES.deadEnd), "not on the pick's tick");
  flush(3);
  assert.ok(p.messages.includes(C.MESSAGES.deadEnd), "three ticks after the pick");
  next();
  T.Passages.pickLock({ player: p, ...objectAt(1, doorId(2)) }, always);
  flush(2);
  assert.equal(C.sessionOf(p).room, 1, "still in room 1 two ticks after the pick");
  flush(1);
  assert.equal(C.sessionOf(p).room, 2);
  assert.equal(roomOf(p), 2);
  assert.equal(p.varbits.get(ids().varbit.doors[0]), 0, "doors closed again in the new room");
  assert.equal(p.xp.THIEVING, 40 + 40, "room 1 door XP for each picked door");

  const low = player({ thieving: 30 });
  T.Entrance.tryStart(low, () => 0);
  C.sessionOf(low).exits = [1, 1, 1, 1, 1, 1, 1, 1];
  T.Passages.pickLock({ player: low, ...objectAt(1, doorId(1)) }, always);
  assert.deepEqual(low.messages.slice(-1), [C.MESSAGES.level(31)]);
  assert.equal(C.sessionOf(low).room, 1);
  C.endRun(p);
  C.endRun(low);
});

test("after three dead ends the fourth door always leads on; a lockpick halves the XP", () => {
  const p = player({ thieving: 99, items: { [1523]: 1 } });
  T.Entrance.tryStart(p, () => 0);
  const run = C.sessionOf(p);
  run.exits = [3, 4, 4, 4, 4, 4, 4, 4];
  for (const n of [1, 2, 4]) {
    T.Passages.pickLock({ player: p, ...objectAt(1, doorId(n)) }, always);
    flush(3);
  }
  assert.equal(C.sessionOf(p).room, 1, "doors 1, 2 and 4 were dead ends");
  run.exits = [1, 4, 4, 4, 4, 4, 4, 4];
  assert.equal(T.Passages.leadsOn(p, C.sessionOf(p), 3), true, "doors 1, 2 and 4 failed: 3 leads on");
  assert.equal(p.xp.THIEVING, 3 * 20, "half of 40 per door with a lockpick");
  C.endRun(p);
});

test("room 8's doors ask before leaving the tomb", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  C.enterRoom(p, C.sessionOf(p), 8);
  T.Passages.pickLock({ player: p, ...objectAt(8, doorId(1)) }, always);
  const prompt = prompts.at(-1);
  assert.equal(prompt.player, p);
  prompt.pairs[1](p);
  assert.equal(C.sessionOf(p), null);
  assert.deepEqual(p.at, C.DATA.outside);
});

test("the run ends once when the time runs out, and the next run starts fresh", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  C.enterRoom(p, C.sessionOf(p), 3);
  clock.cycle += C.DATA.timerTicks;
  T.Session.tick(p);
  assert.equal(C.sessionOf(p), null);
  assert.deepEqual(p.at, C.DATA.outside);
  assert.equal(p.overlay, null);
  assert.equal(p.messages.filter((m) => m === C.MESSAGES.timeUp).length, 1);
  T.Session.tick(p);
  assert.equal(p.messages.filter((m) => m === C.MESSAGES.timeUp).length, 1, "ends once");
  assert.equal(T.Entrance.variantFor(p), T.Entrance.VARIANT.timedOut);
  assert.equal(T.Entrance.variantFor(p), T.Entrance.VARIANT.later, "the time-out line plays once");

  T.Entrance.tryStart(p, () => 0);
  assert.equal(C.sessionOf(p).room, 1);
  assert.equal(p.varbits.get(ids().varbit.timer), 0);
  C.endRun(p);
});

test("logout mid-run ends the run outside, and nothing can be looted after", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  T.Session.onPlayerLogout({ player: p });
  assert.equal(C.sessionOf(p), null);
  assert.deepEqual(p.at, C.DATA.outside);
  T.Containers.searchUrn({ player: p, ...objectAt(1, firstUrn()) }, always);
  assert.equal(artefactCount(p), 0);
  p.at = { ...C.roomData(2).entry, z: 0 };
  T.Session.onPlayerLogin({ player: p });
  assert.deepEqual(p.at, C.DATA.outside, "a player saved inside wakes outside");
});

// --- Containers

test("an urn gives its XP and one artefact once", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  const urn = { player: p, ...objectAt(1, firstUrn()) };
  T.Containers.searchUrn(urn, always);
  flush(5);
  assert.equal(p.xp.THIEVING, 60);
  assert.equal(artefactCount(p), 1);
  T.Containers.searchUrn(urn, always);
  assert.equal(artefactCount(p), 1, "looted once");
  assert.ok(p.messages.includes(C.MESSAGES.looted));
  C.endRun(p);
});

test("a failed urn search bites and poisons; a charmed snake makes it safe", () => {
  const p = player({ thieving: 21, items: { [ids().item.snakeCharm]: 1 } });
  T.Entrance.tryStart(p, () => 0);
  const urn = { player: p, ...objectAt(1, firstUrn()) };
  T.Containers.searchUrn(urn, never);
  flush(5);
  assert.equal(p.hits.length, 1);
  assert.ok(p.poisoned >= 1 && p.poisoned <= 4);
  assert.equal(artefactCount(p), 0);
  next();
  T.Containers.checkUrn(urn, always);
  assert.equal(p.varbits.get(ids().urns.get(firstUrn())), T.Containers.URN_STATE.SNAKE);
  assert.equal(p.xp.THIEVING, 20, "a third of the urn's XP for the check");
  T.Containers.charmUrn(urn);
  next();
  T.Containers.searchUrn(urn, never);
  flush(5);
  assert.equal(artefactCount(p), 1, "charmed: no roll to fail");
  C.endRun(p);
});

test("the chest always gives its artefact; a scarab swarm takes the XP instead", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  // 0.5: no swarm at 99 Thieving, no sceptre.
  T.Containers.searchChest({ player: p, ...objectAt(1, ids().chest) }, () => 0.5);
  assert.equal(artefactCount(p), 0, "the chest opens a tick after the click");
  flush(1);
  assert.equal(p.xp.THIEVING, 40);
  assert.equal(artefactCount(p), 1);
  T.Containers.searchChest({ player: p, ...objectAt(1, ids().chest) }, () => 0.5);
  assert.equal(artefactCount(p), 1, "opens once");

  const q = player({ thieving: 21 });
  T.Entrance.tryStart(q, () => 0);
  spawned.length = 0;
  T.Containers.searchChest({ player: q, ...objectAt(1, ids().chest) }, () => 0.9);
  flush(1);
  assert.equal(q.xp.THIEVING, 0, "the swarm takes the XP");
  assert.equal(artefactCount(q), 1);
  assert.deepEqual(q.hits, [3]);
  assert.equal(spawned[0].definition.id, ids().npc.scarabs);
  assert.equal(spawned[0].attacked, q);
  C.endRun(q);
  assert.ok(removed.includes(spawned[0]), "the swarm goes with the run");
  C.endRun(p);
});

test("the sceptre ends the run, and lands outside with a full pack", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  T.Containers.searchChest({ player: p, ...objectAt(1, ids().chest) }, () => 0);
  flush(1);
  assert.equal(C.sessionOf(p), null);
  assert.equal(p.inventory.get(ids().item.sceptre), 1);
  assert.equal(p.dialogues.length, 1, "the sceptre is shown in an item box");
  assert.deepEqual(p.at, C.DATA.outside);

  const full = {};
  for (let i = 0; i < 28; i++) full[20000 + i] = 1;
  const q = player({ thieving: 99, items: full });
  T.Entrance.tryStart(q, () => 0);
  T.Containers.searchChest({ player: q, ...objectAt(1, ids().chest) }, () => 0);
  flush(1);
  assert.equal(q.inventory.get(ids().item.sceptre) ?? 0, 0);
  assert.ok(q.ground.some(([id]) => id === ids().item.sceptre));
});

test("the sarcophagus opens on Strength and gives Strength XP", () => {
  const weak = player({ thieving: 99, strength: 5 });
  T.Entrance.tryStart(weak, () => 0);
  C.enterRoom(weak, C.sessionOf(weak), 8);
  T.Containers.openSarcophagus({ player: weak, ...objectAt(8, ids().sarcophagus) }, always);
  assert.deepEqual(weak.messages.slice(-1), [C.MESSAGES.sarcophagusWeak]);
  C.endRun(weak);

  const p = player({ thieving: 99, strength: 99 });
  T.Entrance.tryStart(p, () => 0);
  // 0.5: opens, no mummy in room 1 (1/9), no sceptre.
  T.Containers.openSarcophagus({ player: p, ...objectAt(1, ids().sarcophagus) }, () => 0.5);
  flush(10);
  assert.equal(p.xp.STRENGTH, 20);
  assert.equal(artefactCount(p), 1);
  assert.equal(p.varbits.get(ids().varbit.sarcophagus), T.Containers.SARCOPHAGUS.OPEN);
  T.Containers.openSarcophagus({ player: p, ...objectAt(1, ids().sarcophagus) }, () => 0.5);
  assert.equal(artefactCount(p), 1, "opens once");
  C.endRun(p);
});

test("containers in another room do nothing", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  T.Containers.searchChest({ player: p, ...objectAt(5, ids().chest) }, () => 0.5);
  assert.equal(artefactCount(p), 0);
  C.endRun(p);
});

// --- The speartrap

test("the speartrap is armed on entry; its disarm takes the captured six ticks, then the spears go down", () => {
  const p = player({ thieving: 21 });
  T.Entrance.tryStart(p, () => 0);
  const trap = C.roomData(1).trap;
  const trapVarbit = ids().varbit.trap;
  assert.equal(p.varbits.get(trapVarbit), 1, "armed as the room starts");
  const event = { player: p, objectId: 21280, location: { x: trap.x, y: trap.y, z: 0 } };
  p.at = { x: trap.x, y: trap.y + 2, z: 0 };
  T.Passages.passTrap(event, never);
  flush(1);
  assert.equal(p.messages.at(-1), C.MESSAGES.trapTry);
  flush(5);
  assert.equal(p.messages.at(-1), C.MESSAGES.trapFail);
  assert.equal(p.hits.length, 1);
  assert.deepEqual(p.sounds, [ids().sound.trapWork, ids().sound.trapWork]);

  next();
  T.Passages.passTrap(event, always);
  T.Passages.passTrap(event, always);
  flush(5);
  assert.deepEqual(p.at, { x: trap.x, y: trap.y + 2, z: 0 }, "nothing until the sixth tick");
  flush(1);
  assert.equal(p.messages.at(-1), C.MESSAGES.trapDisarmed);
  assert.equal(p.xp.THIEVING, T.Passages.TRAP_XP, "a click during the disarm is ignored");
  flush(1);
  assert.deepEqual(p.at, { x: trap.x, y: trap.y + 2, z: 0 }, "the three-tile walk is still in progress");
  assert.equal(p.varbits.get(trapVarbit), 1, "the spears are still up as the player crosses");
  flush(1);
  assert.equal(p.varbits.get(trapVarbit), 0, "down two ticks after the disarm, for the rest of the room");
  flush(1);
  assert.deepEqual(p.at, { x: trap.x, y: trap.y - 1, z: 0 }, "walked across in three ticks");
  T.Passages.passTrap(event, never);
  flush(3);
  assert.deepEqual(p.at, { x: trap.x, y: trap.y + 2, z: 0 }, "Pass on a disarmed trap just walks back across");
  assert.equal(p.hits.length, 1);
  C.endRun(p);
});

// --- The entrance

test("one outer panel leads to the Guardian mummy, the others to an abandoned room", () => {
  const p = player();
  C.state.entranceChangesAt = clock.cycle + 100;
  C.state.entrance = 2;
  T.Entrance.searchPanel({ player: p, objectId: ids().outerPanels[2] });
  flush(4);
  assert.deepEqual(p.at, C.DATA.mummyLobby);
  T.Entrance.searchPanel({ player: p, objectId: ids().outerPanels[0] });
  flush(4);
  assert.deepEqual(p.at, C.DATA.abandonedLobby);
});

test("the mummy's start steps put the player in room 1", () => {
  const p = player({ thieving: 50 });
  const request = { player: p, npcId: ids().npc.guardian, stepId: "1Goj0e", handled: false };
  T.Entrance.onDialogueAction(request);
  assert.equal(request.handled, true);
  assert.equal(C.sessionOf(p).room, 1);
  C.endRun(p);
  assert.equal(T.Entrance.variantFor(player()), T.Entrance.VARIANT.first);
});

// --- Simon Templeton

test("Simon takes every artefact, noted or not, and pays his prices", () => {
  const noted = ids().item.noted;
  const p = player({ items: { [art("ivoryComb")]: 2, [noted.goldenStatuette]: 3, [art("stoneSeal")]: 1 } });
  assert.equal(T.Simon.onDialogueVariant({ player: p, npcId: 5786 }), T.Simon.VARIANT.carrying);
  T.Simon.onDialogueAction({ player: p, npcId: 5786, stepId: "Kn2FnM", handled: false });
  const pay = { player: p, npcId: 5786, stepId: "7vfUYS", handled: false };
  T.Simon.onDialogueAction(pay);
  assert.equal(p.inventory.get(ids().item.coins), 2 * 50 + 3 * 1250 + 150);
  assert.equal(artefactCount(p), 0);
  assert.equal(p.inventory.get(noted.goldenStatuette), 0);
  assert.equal(T.Simon.onDialogueVariant({ player: p, npcId: 5786 }), T.Simon.VARIANT.firstTalk, "nothing left: his introduction");
});

test("an artefact used on Simon sells just that one", () => {
  const p = player({ items: { [art("goldSeal")]: 2 } });
  const event = { player: p, npcId: 5786, itemId: art("goldSeal"), target: {}, handled: false };
  T.Simon.onItemOnNpc(event);
  assert.equal(event.handled, true);
  T.Simon.onDialogueAction({ player: p, npcId: 5786, stepId: "0egJhg", handled: false });
  T.Simon.onDialogueAction({ player: p, npcId: 5786, stepId: "dFDQfD", handled: false });
  assert.equal(p.inventory.get(art("goldSeal")), 1);
  assert.equal(p.inventory.get(ids().item.coins), 750);
});

test("Simon refuses an artefact invoice larger than a new coin stack", () => {
  const noted = ids().item.noted.goldenStatuette;
  const count = Math.floor(0x7fffffff / 1250) + 1;
  const p = player({ items: { [noted]: count } });
  const request = { player: p, npcId: 5786, stepId: "Kn2FnM", handled: false };
  T.Simon.onDialogueAction(request);
  assert.equal(request.end, true);
  assert.equal(p.inventory.get(noted), count);
  assert.equal(p.inventory.get(ids().item.coins) ?? 0, 0);
  assert.equal(T.Simon.owed.has(p), false);
});

test("Simon explains when an artefact payment cannot fit", () => {
  for (const route of ["one", "all"]) {
    const p = player({ items: { [art("goldSeal")]: 1, [ids().item.coins]: 0x7fffffff } });
    if (route === "one") T.Simon.onItemOnNpc({ player: p, npcId: 5786, itemId: art("goldSeal"), target: {}, handled: false });
    const request = { player: p, npcId: 5786, stepId: route === "one" ? "0egJhg" : "Kn2FnM", handled: false };
    T.Simon.onDialogueAction(request);
    assert.equal(request.end, true);
    assert.equal(p.inventory.get(art("goldSeal")), 1);
    assert.equal(p.inventory.get(ids().item.coins), 0x7fffffff);
    assert.equal(T.Simon.owed.has(p), false);
    assert.deepEqual(p.messages, ["You do not have enough room to carry all of those coins."]);
  }
});

test("Simon: his introduction first, then the pyramid top lines, before and after the first sale (Wiki transcript)", () => {
  const p = player();
  const { VARIANT } = T.Simon;
  assert.equal(T.Simon.onDialogueVariant({ player: p, npcId: 5786 }), VARIANT.firstTalk);
  assert.equal(p.varbits.get(ids().varbit.simonNamed), 1, "agility_pyramid_simon_named (rsprox 1757)");
  assert.equal(p.varbits.get(ids().varbit.simonJob), 1, "agility_pyramid_simon_job");
  assert.equal(T.Simon.onDialogueVariant({ player: p, npcId: 5786 }), VARIANT.talkAgain);
  p.inventory.set(ids().item.pyramidTop, 1);
  T.Simon.onDialogueAction({ player: p, npcId: 5786, stepId: "xCY7EK", handled: false });
  assert.equal(p.varbits.get(ids().varbit.simonJobDone), 1, "agility_pyramid_simon_job_done");
  assert.equal(T.Simon.onDialogueVariant({ player: p, npcId: 5786 }), VARIANT.afterSelling);
});

test("Simon: the transcript's conditions follow how many pyramid tops are carried", () => {
  const p = player();
  const answer = (stepId) => T.Simon.onDialogueCondition({ player: p, npcId: 5786, stepId });
  assert.deepEqual(["zXAwBg", "mPKGhu", "aJi_9W"].map(answer), [true, false, false]);
  p.inventory.set(ids().item.pyramidTop, 1);
  assert.deepEqual(["-mixJS", "DW3JPR", "D8hzoV"].map(answer), [false, true, false]);
  p.inventory.set(ids().item.pyramidTop, 3);
  assert.deepEqual(["zXAwBg", "mPKGhu", "aJi_9W"].map(answer), [false, false, true]);
  assert.equal(answer("unrelated"), null);
});

test("Simon pays 10,000 coins a pyramid top, in a message box (Wiki; rsprox 1757)", () => {
  const p = player({ items: { [ids().item.pyramidTop]: 3 } });
  const request = { player: p, npcId: 5786, stepId: "0iaVVb", text: "", handled: false };
  T.Simon.onDialogueAction(request);
  assert.equal(p.inventory.get(ids().item.pyramidTop), 0);
  assert.equal(p.inventory.get(ids().item.coins), 30000);
  assert.equal(request.text, "You hand over the artefact(s) and Simon hands you 30000 coins.");
  assert.deepEqual(request.box, { statement: true });
  const nothing = { player: p, npcId: 5786, stepId: "MoWeP6", text: "", handled: false };
  T.Simon.onDialogueAction(nothing);
  assert.equal(nothing.end, true, "no tops left: the chat ends");
  assert.equal(p.inventory.get(ids().item.coins), 30000);
});

test("Simon keeps the tops when the coin stack cannot take the whole payment", () => {
  const p = player({ items: { [ids().item.pyramidTop]: 1, [ids().item.coins]: 0x7fffffff - 5000 } });
  const request = { player: p, npcId: 5786, stepId: "xCY7EK", text: "", handled: false };
  T.Simon.onDialogueAction(request);
  assert.equal(request.end, true);
  assert.equal(p.inventory.get(ids().item.pyramidTop), 1);
  assert.equal(p.inventory.get(ids().item.coins), 0x7fffffff - 5000);
  assert.deepEqual(p.messages, ["You do not have enough room to carry all of those coins."]);
});

test("Simon's payment can take the slot the tops leave in a full inventory", () => {
  const items = { [ids().item.pyramidTop]: 1 };
  for (let id = 1; id <= 27; id++) items[id] = 1;
  const p = player({ items });
  const request = { player: p, npcId: 5786, stepId: "xCY7EK", text: "", handled: false };
  T.Simon.onDialogueAction(request);
  assert.equal(p.inventory.get(ids().item.pyramidTop), 0);
  assert.equal(p.inventory.get(ids().item.coins), 10000);
});

test("a pyramid top used on Simon sells them all once he has explained the job (rsprox 1757)", () => {
  const p = player({ items: { [ids().item.pyramidTop]: 2 } });
  const use = () => {
    const event = { player: p, npcId: 5786, itemId: ids().item.pyramidTop, target: {}, handled: false };
    T.Simon.onItemOnNpc(event);
    assert.equal(event.handled, true);
    return startedVariants.at(-1);
  };
  assert.equal(use(), T.Simon.VARIANT.usedBeforeTalking, "he asks for a chat first");
  T.Simon.onDialogueVariant({ player: p, npcId: 5786 });
  assert.equal(use(), T.Simon.VARIANT.usedTop);
});

// --- Review fixes

test("a run's exits are its own: another player's run doesn't change them", () => {
  const a = player({ thieving: 99 });
  T.Entrance.tryStart(a, () => 0);
  const exits = [...C.sessionOf(a).exits];
  const b = player({ thieving: 99 });
  T.Entrance.tryStart(b, () => 0.9);
  assert.deepEqual(C.sessionOf(a).exits, exits);
  C.endRun(a);
  C.endRun(b);
});

test("walking onto the armed speartrap springs it and pushes the player back", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  const run = C.sessionOf(p);
  const trap = C.roomData(1).trap;
  p.at = { x: trap.x, y: trap.y + 3, z: 0 };
  T.Session.guardTrap(p, run);
  p.at = { x: trap.x, y: trap.y + 1, z: 0 };
  T.Session.guardTrap(p, run);
  assert.equal(p.hits.length, 1);
  assert.deepEqual(p.at, { x: trap.x, y: trap.y + 3, z: 0 });
  C.endRun(p);
});

test("a search takes its ticks: an immediate second click is ignored", () => {
  const p = player({ thieving: 21 });
  T.Entrance.tryStart(p, () => 0);
  const urn = { player: p, ...objectAt(1, firstUrn()) };
  T.Containers.searchUrn(urn, never);
  T.Containers.searchUrn(urn, never);
  flush(5);
  assert.equal(p.hits.length, 1, "one bite, not two");
  C.endRun(p);
});

test("walking away stops the sarcophagus pushes", () => {
  const p = player({ thieving: 99, strength: 1 });
  T.Entrance.tryStart(p, () => 0);
  // Never opens on this roll; then the player walks off.
  T.Containers.openSarcophagus({ player: p, ...objectAt(1, ids().sarcophagus) }, () => 0.99);
  p.at = { x: p.at.x + 1, y: p.at.y, z: 0 };
  flush(10);
  assert.equal(p.varbits.get(ids().varbit.sarcophagus), T.Containers.SARCOPHAGUS.CLOSED);
  assert.equal(p.xp.STRENGTH, 0);
  C.endRun(p);
});

test("with a full pack, the artefact found with the sceptre lands outside too", () => {
  const full = {};
  for (let i = 0; i < 28; i++) full[20000 + i] = 1;
  const p = player({ thieving: 99, items: full });
  T.Entrance.tryStart(p, () => 0);
  T.Containers.searchChest({ player: p, ...objectAt(1, ids().chest) }, () => 0);
  flush(1);
  const outside = p.ground.filter(([, at]) => at.x === C.DATA.outside.x && at.y === C.DATA.outside.y);
  assert.equal(outside.length, 2, "the sceptre and the artefact, both outside");
});

test("an unanswered one-item offer doesn't stick to Simon's next conversation", () => {
  const p = player({ items: { [art("goldSeal")]: 1 } });
  T.Simon.onItemOnNpc({ player: p, npcId: 5786, itemId: art("goldSeal"), target: {}, handled: false });
  assert.ok(T.Simon.offered.has(p));
  T.Simon.forget({ player: p });
  assert.ok(!T.Simon.offered.has(p));
  assert.equal(T.Simon.onDialogueVariant({ player: p, npcId: 5786 }), T.Simon.VARIANT.carrying);
});

test("Leave Tomb asks first, Quick-leave doesn't; time running out has the live lines", () => {
  const p = player({ thieving: 21 });
  T.Entrance.tryStart(p, () => 0);
  T.Passages.leaveTomb({ player: p, objectId: ids().tombExit, option: "Leave Tomb" });
  assert.equal(prompts.at(-1).title, C.MESSAGES.leaveTomb);
  assert.ok(C.sessionOf(p), "nothing happens until the player answers");
  const beforeQuickLeave = prompts.length;
  // ObjectActionPacketListener supplies lowercase option text.
  T.Passages.leaveTomb({ player: p, objectId: ids().tombExit, option: "quick-leave" });
  assert.equal(C.sessionOf(p) ?? null, null);
  assert.equal(prompts.length, beforeQuickLeave);

  const q = player({ thieving: 21 });
  T.Entrance.tryStart(q, () => 0);
  C.endRun(q, { timedOut: true });
  assert.equal(q.messages.at(-1), C.MESSAGES.timeUp);
  assert.equal(q.dialogues.length, 1, "the Guardian mummy's line");
});

test("the forced trap walk lasts as long as its client movement", () => {
  const trap = C.roomData(1).trap;
  const at = trap.horizontal ? { x: trap.x - 1, y: trap.y, z: 0 } : { x: trap.x, y: trap.y - 1, z: 0 };
  const p = player({ at });
  const destination = T.Passages.crossingTile(trap, at);
  T.Passages.walkAcross(p, { room: 1 });
  assert.ok(p.forced);
  flush(1);
  assert.deepEqual(p.at, at, "one tick cannot complete a three-tile walk");
  assert.ok(p.forced);
  flush(2);
  assert.deepEqual(p.at, { ...destination, z: 0 });
  assert.equal(p.forced, null);
});

test("ending a run with a mummy or swarm out tells the player they go", () => {
  const p = player({ thieving: 21 });
  T.Entrance.tryStart(p, () => 0);
  const run = C.sessionOf(p);
  run.hostiles.push({ getId: () => ids().npc.mummy, getHitpoints: () => 10, isRegistered: () => true });
  run.hostiles.push({ getId: () => ids().npc.scarabs, getHitpoints: () => 10, isRegistered: () => true });
  C.endRun(p);
  assert.ok(p.messages.includes(C.MESSAGES.mummyVanishes));
  assert.ok(p.messages.includes(C.MESSAGES.scarabsLeave));
});

// --- Timing from the rsprox captures (recordings 545, 549, 552, 1788, 1843, 1857)

/** Runs `ticks` ticks and returns what each one showed: animations, synths, area sounds, spam and game lines, varbits. */
function watch(p, ticks) {
  const seen = [];
  for (let i = 0; i < ticks; i++) {
    const before = { anims: p.anims.length, sounds: p.sounds.length, area: p.areaSounds.length, messages: p.messages.length, varbits: new Map(p.varbits) };
    flush(1);
    const varbits = [...p.varbits].filter(([id, value]) => before.varbits.get(id) !== value).map(([id, value]) => [id, value]);
    seen.push({
      anims: p.anims.slice(before.anims).map((a) => a.getId()),
      sounds: p.sounds.slice(before.sounds),
      area: p.areaSounds.slice(before.area).map((s) => s.id),
      messages: p.messages.slice(before.messages),
      varbits,
    });
  }
  return seen;
}
const seq = (name) => C.getCore().CacheDefinitions.getSeqId(name);
const has = (tick, id, value) => tick.varbits.some(([v, x]) => v === id && x === value);

test("captured urn search: search at 1, loot at 2, synth 1217 at 4, artefact and varbit at 5; spam lines", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  const urn = { player: p, ...objectAt(1, firstUrn()) };
  T.Containers.searchUrn(urn, always);
  assert.equal(p.anims.length, 0, "nothing on the click");
  const [t1, t2, , t4, t5] = watch(p, 5);
  assert.deepEqual(t1.anims, [seq("urn_search")]);
  assert.ok(has(t1, ids().varbit.busy, 1));
  assert.deepEqual(t2.anims, [seq("urn_search_success")]);
  assert.deepEqual(t2.messages, [C.MESSAGES.urnLooted]);
  assert.deepEqual(p.spam, [C.MESSAGES.urnLooted], "a spam message");
  assert.deepEqual(t4.sounds, [1217]);
  assert.ok(has(t5, ids().urns.get(firstUrn()), 1) && has(t5, ids().varbit.busy, 0));
  assert.equal(artefactCount(p), 1);
  C.endRun(p);

  const q = player({ thieving: 21 });
  T.Entrance.tryStart(q, () => 0);
  T.Containers.searchUrn({ player: q, ...objectAt(1, firstUrn()) }, never);
  const [, b2, , b4] = watch(q, 4);
  assert.deepEqual(b2.anims, [seq("urn_search_bit")]);
  assert.equal(b4.sounds[0], 797);
  assert.equal(b4.messages[0], C.MESSAGES.bitten);
  assert.equal(q.hits.length, 1);
  C.endRun(q);
});

test("captured lock pick: open with synth 87 and area sound 54, busy, and the dead end three ticks later", () => {
  const p = player({ thieving: 99 });
  T.Entrance.tryStart(p, () => 0);
  C.sessionOf(p).exits = [2, 2, 2, 2, 2, 2, 2, 2];
  T.Passages.pickLock({ player: p, ...objectAt(1, doorId(1)) }, always);
  assert.deepEqual(p.sounds.slice(-1), [87]);
  assert.deepEqual(p.areaSounds.map((s) => [s.id, s.range]), [[54, 5]]);
  assert.deepEqual(p.spam, [C.MESSAGES.noLockpick]);
  const [t1, , t3] = watch(p, 3);
  assert.ok(has(t1, ids().varbit.busy, 1));
  assert.deepEqual(t3.messages, [C.MESSAGES.deadEnd]);
  assert.ok(!p.spam.includes(C.MESSAGES.deadEnd), "the dead end is a game message");
  next();
  T.Passages.pickLock({ player: p, ...objectAt(1, doorId(1)) }, always);
  assert.equal(p.messages.at(-1), C.MESSAGES.deadEndOpened);
  C.endRun(p);
});

test("captured sarcophagus: a push every tick, the lid with area sound 1218 and state 2, the artefact five ticks later; no line", () => {
  const p = player({ thieving: 99, strength: 99 });
  T.Entrance.tryStart(p, () => 0);
  let rolls = 0;
  // Two failed rolls, then the lid moves; 0.5 afterwards: no mummy, no sceptre.
  const random = () => (++rolls <= 2 ? 0.999 : 0.5);
  T.Containers.openSarcophagus({ player: p, ...objectAt(1, ids().sarcophagus) }, random);
  const ticks = watch(p, 10);
  assert.ok(has(ticks[0], ids().varbit.busy, 1));
  assert.deepEqual(ticks[1].anims, [seq("ntk_tomb_push_loop")]);
  assert.ok(has(ticks[1], ids().varbit.sarcophagusPush, 1));
  assert.deepEqual([ticks[2].anims, ticks[3].anims], [[seq("ntk_tomb_push_loop")], [seq("ntk_tomb_push_loop")]]);
  assert.deepEqual(ticks[4].anims, [seq("ntk_tomb_open")]);
  assert.deepEqual(ticks[4].area, [1218]);
  assert.ok(has(ticks[4], ids().varbit.sarcophagus, 2));
  assert.equal(artefactCount(p), 1);
  assert.ok(has(ticks[9], ids().varbit.sarcophagus, 1) && has(ticks[9], ids().varbit.sarcophagusPush, 0));
  assert.deepEqual(p.messages, [], "no message");
  C.endRun(p);
});

test("captured panel search: three pulls a tick apart, synth 1220 on the first and third, and the way in opens its door", () => {
  C.state.entrance = 2;
  C.state.entranceChangesAt = clock.cycle + 100000;
  const p = player({ thieving: 99 });
  T.Entrance.searchPanel({ player: p, objectId: ids().outerPanels[2] });
  assert.deepEqual(p.sounds, [1220]);
  assert.deepEqual(p.spam, [C.MESSAGES.panelSearch]);
  const [t1, t2, t3] = watch(p, 3);
  assert.equal(t1.anims.length, 1);
  assert.ok(has(t1, ids().varbit.busy, 1));
  assert.deepEqual(t2.sounds, [1220]);
  assert.deepEqual(t3.messages, ["You find a door! You open it successfully."]);
  assert.ok(has(t3, ids().varbit.outerPanels[2], 2) && has(t3, ids().varbit.busy, 0));
});


// Native registered Simon offers, without the legacy inventory/dialogue/task stand-ins above.
test("native Simon artefact sales preserve the full payment at the coin limit", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const native = PluginManager.getCoreApi();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  native.RegionManager.init(); native.RegionManager.loadMapFiles(3226, 3218);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  assert.equal(C.getCore().World, native.World); assert.equal(C.getCore().TaskManager, native.TaskManager);
  const MAX = 0x7fffffff, PRICE = 750, COINS = native.ItemIdentifiers.COINS;
  const GOLD = native.CacheDefinitions.getObjId("ntk_seal_gold");
  assert.equal(GOLD, 9040); assert.equal(C.DATA.artefacts.goldSeal.coins, PRICE);
  assert.equal(native.ItemDefinition.forId(GOLD).isStackable(), false);
  assert.equal(native.ItemDefinition.forId(GOLD).isNoted(), false);
  assert.equal(native.ItemDefinition.forId(COINS).isStackable(), true);
  let nextIndex = 1960;
  const cases = [
    { name: "one-item ordinary payment", route: "item", held: 0, seals: 2, moved: 1 },
    { name: "Talk-to ordinary all-artefact payment", route: "talk", held: 0, seals: 2, moved: 2 },
    { name: "one-item exact payment headroom", route: "item", held: MAX - PRICE, seals: 1, moved: 1 },
    { name: "payment uses the consumed artefact slot", route: "item", held: 0, seals: 1, moved: 1, full: true },
    { name: "declined one-item offer", route: "item", held: 1000, seals: 1, moved: 0, decline: true },
    { name: "one-item insufficient payment headroom", route: "item", held: MAX - PRICE + 1, seals: 1, moved: 0, near: true },
    { name: "one-item capped coin stack", route: "item", held: MAX, seals: 1, moved: 0, capped: true },
    { name: "Talk-to capped coin stack", route: "talk", held: MAX, seals: 2, moved: 0, capped: true },
  ];
  for (const row of cases) await t.test(row.name, async t => {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(new PlayerSession(channel));
    player.setIndex(nextIndex++); player.setUsername("simonbuyer" + player.getIndex());
    player.setRegistered(true); player.setLocation(new native.Location(3226, 3218, 0)); player.needsPlacement = false;
    const connection = new ClientConnection(channel); connection.player = player;
    const npc = native.NPC.create(native.CacheDefinitions.getNpcId("agility_pyramid_simon"), new native.Location(3227, 3218, 0));
    assert.equal(native.World.getNpcs().add(npc), true);
    assert.equal(npc.getId(), 5786); assert.equal(npc.getCurrentDefinition(player).getName(), "Simon Templeton");
    t.after(() => {
      player.closeInterruptibleInterfaces();
      PluginManager.emitPlayerDisconnect({ player, username: player.getUsername() });
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
      player.setRegistered(false); native.TaskManager.cancelTasks(player.getIndex()); native.TaskManager.cancelTasks(player);
      native.World.getNpcs().remove(npc);
      for (const ground of native.World.getItems().filter(g => g.getOwner() === player.getUsername())) native.ItemOnGroundManager.deregister(ground);
    });
    const inv = player.getInventory();
    for (let n = 0; n < row.seals; n++) inv.add(new native.Item(GOLD), false);
    if (row.held) inv.add(new native.Item(COINS, row.capped ? MAX - 1 : row.held), false);
    if (row.full) while (inv.getFreeSlots() > 0) inv.add(new native.Item(native.ItemIdentifiers.LOGS), false);
    const logsBefore = inv.getAmount(native.ItemIdentifiers.LOGS), gains = [];
    const skills = player.getSkillManager(), addXp = skills.addExperiences.bind(skills);
    t.mock.method(skills, "addExperiences", (skill, amount) => { gains.push({ skill, amount }); return addXp(skill, amount); });
    const floor = id => native.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === player.getUsername()
      && g.getPrivateArea() === player.getPrivateArea() && g.getItem().getId() === id).reduce((n, g) => n + g.getItem().getAmount(), 0);
    const stores = id => ({ inventory: inv.getAmount(id), equipment: player.getEquipment().getAmount(id),
      bank: player.getBanks().reduce((n, b, tab) => n + (b && tab !== native.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0), floor: floor(id) });
    const owned = id => Object.values(stores(id)).reduce((n, amount) => n + amount, 0);
    const state = () => ({ name: row.name, coins: stores(COINS), seals: stores(GOLD), owed: T.Simon.owed.get(player) ?? 0, gains: [...gains] });
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 32, "bounded native phase budget"); player.resetUpdating();
      native.World.processCycle = (native.World.processCycle + 1) & MAX; native.TaskManager.process();
      connection.processTurnPackets(); const queue = player.getMovementQueue();
      queue.beginCycle(); queue.processEntityPursuit(); if (queue.hasPendingWork()) queue.process();
      native.TaskManager.processWalkTo(player.getIndex());
    };
    const send = async packet => { await connection.dispatch([packet]); turn(); };
    const observeLine = () => {
      const current = player.getDialogueManager().getCurrent(), sender = player.getPacketSender(), group = sender.getChatboxGroupId();
      assert.ok(current instanceof native.NpcDialogue || current instanceof native.PlayerDialogue, "actual native speech must own this continuation");
      assert.ok(group === 231 || group === 217);
      const mount = sender.subInterfaceTargets.get(group); assert.ok(mount); assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
      return { current, group };
    };
    const continueLine = async () => { const { group } = observeLine(); await send({ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 }); };
    if (row.capped) {
      const at = player.getLocation(); native.ItemOnGroundManager.registerLocation(player, new native.Item(COINS), at.clone());
      assert.equal(floor(COINS), 1);
      await send({ type: "ground_item_action", itemId: COINS, x: at.getX(), y: at.getY(), option: "Take", optionIndex: 3 });
      for (let n = 0; n < 6 && floor(COINS); n++) turn();
      assert.equal(inv.getAmount(COINS), MAX, "real native pickup fills the ordinary coin stack"); assert.equal(floor(COINS), 0);
    }
    assert.equal(owned(COINS), row.held); assert.equal(owned(GOLD), row.seals); assert.equal(T.Simon.owed.has(player), false);
    const addable = inv.getAddableAmount(new native.Item(COINS, PRICE * (row.route === "talk" ? row.seals : 1)));
    if (row.capped) assert.equal(addable, 0, "native output precondition, with real artefacts still present");
    if (row.near) assert.equal(addable, PRICE - 1, "native output cannot accept the entire invoice");
    if (row.name === "one-item exact payment headroom") assert.equal(addable, PRICE);
    const before = state(), valueBefore = owned(COINS) + PRICE * owned(GOLD);
    if (row.route === "item") await send({ type: "item_on_npc", widgetId: 149 << 16, targetIndex: npc.getIndex(),
      itemId: GOLD, slot: inv.getSlotForItemId(GOLD) });
    else {
      const talk = npc.getCurrentDefinition(player).getActions().indexOf("Talk-to") + 1; assert.ok(talk > 0);
      await send({ type: "npc_option", index: npc.getIndex(), clickType: talk });
    }
    for (let n = 0; n < 8 && !native.MultiChatboxPrompt.getPending(player); n++) {
      const current = player.getDialogueManager().getCurrent();
      if (current) {
        assert.match(current.getText(), /You wanna sell that mate|interesting artefacts|Bonzer|flog the lot/); await continueLine();
      } else turn();
    }
    const menu = native.MultiChatboxPrompt.getPending(player); assert.ok(menu, "actual registered offer must produce its native choice");
    assert.equal(player.getDialogueManager().isActive(), false, "real MultiChatboxPrompt owns the options");
    const choice = menu.options.indexOf(row.decline ? "No, I think I'll keep it." : "Yes, show me the money.") + 1; assert.ok(choice > 0);
    await send({ type: "dialogue_continue", widgetId: native.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice });
    assert.equal(observeLine().current.getText(), row.decline ? "No, I think I'll keep it." : "Yes, show me the money.");
    assert.deepEqual(state(), before, "resources remain intact until the real player's line is continued");
    await continueLine();
    const after = state(), details = JSON.stringify({ before, after });
    // First target assertion: a sold artefact must remain owned or be paid in full; floor credit counts.
    assert.equal(owned(COINS) + PRICE * owned(GOLD), valueBefore, "artefact/payment conservation: " + details);
    assert.equal(owned(GOLD), row.seals - row.moved, details);
    assert.equal(owned(COINS), row.held + row.moved * PRICE, details);
    assert.equal(T.Simon.owed.has(player), false, "no transient unpaid invoice remains after the synchronous transaction");
    assert.equal(inv.getAmount(native.ItemIdentifiers.LOGS), logsBefore); assert.deepEqual(gains, []);
  });
});
