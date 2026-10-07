// Run after `yarn build`: node --test tests/ferox-enclave.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { Location } = require("../dist/game/model/Location");
const { TaskManager } = require("../dist/game/task/TaskManager");
const Bounds = require("../plugins/areas/ferox/Bounds.FeroxEnclave");
const Ferox = require("../plugins/areas/ferox/Common.FeroxEnclave");
const Barriers = require("../plugins/areas/ferox/Barriers.FeroxEnclave");
const Pool = require("../plugins/areas/ferox/Pool.FeroxEnclave");
const FFA = require("../plugins/areas/ferox/FreeForAll.FeroxEnclave");

let prompt = null;
let barrier = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  RegionManager.loadMapFiles(3123, 3629);
  barrier = (MapObjects.mapObjects.get(MapObjects.getHash(3123, 3629, 0)) ?? []).find((o) => o.getId() === 39652);
  Ferox.init({ core: PluginManager.getCoreApi(), sendMultiChatboxPrompt: recordPrompt });
});

function recordPrompt(player, title, ...pairs) {
  const options = pairs.filter((x) => typeof x === "string");
  const actions = pairs.filter((x) => typeof x === "function");
  prompt = { title, options, choose: (text) => actions[options.indexOf(text)](player) };
  return true;
}

/** A player recording, per tick, what the server sends. */
function player({ at = new Location(3123, 3629, 0), teleblocked = false } = {}) {
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const attributes = new Map();
  const varbits = new Map();
  let location = at;
  let dialogue = null;
  const levels = new Map();
  const sender = {
    sendVarbit: (id, value) => (varbits.set(id, value), log(`varbit ${id}=${value}`), sender),
    sendConfig: (id, value) => (log(`varp ${id}=${value}`), sender),
    sendSoundEffect: (id, loops, delay) => (log(`sound ${id} x${loops} delay ${delay}`), sender),
    sendPoisonType: () => sender,
    sendRunEnergy: () => sender,
    sendSubInterface: (uid, id) => (log(`overlay ${id}`), sender),
    closeSubInterface: () => (log("overlay closed"), sender),
  };
  const p = {
    ticks, varbits,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log(message),
    getLocation: () => location,
    moveTo: (to) => { location = to; log(`teleport ${to.getX()},${to.getY()}`); },
    setPositionToFace: (to) => log(`face ${to.getX()},${to.getY()}`),
    performAnimation: (animation) => log(`anim ${animation.getId()}`),
    isRegistered: () => true,
    isPlayer: () => true,
    getCombat: () => ({ getTeleblockTimer: () => ({ finished: () => !teleblocked }) }),
    getDialogueManager: () => ({
      startDialogues: (chain) => {
        dialogue = [...chain.getDialogues().values()];
        log(`statement: ${dialogue[0].getText?.() ?? dialogue[0].text}`);
      },
    }),
    continueDialogue: () => dialogue[1].send(p),
    getSkillManager: () => ({ getMaxLevel: () => 99, setCurrentLevels: (skill, level) => levels.set(skill, level) }),
    levels,
    setPoisonDamage: (d) => log(`poison ${d}`),
    setVenomed: () => {},
    setRunEnergy: (e) => log(`run ${e}`),
    nextTick: () => ticks.push([]),
  };
  return p;
}

function runTicks(p, count) {
  for (let i = 0; i < count; i++) {
    TaskManager.process();
    p.nextTick();
  }
  return p.ticks;
}

test("the barrier in this cache crosses between the town and the buffer (captured tiles)", () => {
  assert.ok(barrier, "barrier 39652 at 3123,3629");
  const out = Bounds.crossingTarget(new Location(3123, 3629, 0), barrier);
  assert.deepEqual([out.target.x, out.target.y, out.entering], [3122, 3629, false]);
  const back = Bounds.crossingTarget(new Location(3122, 3629, 0), barrier);
  assert.deepEqual([back.target.x, back.target.y, back.entering], [3123, 3629, true]);
  assert.equal(Bounds.isInsideEnclave(new Location(3123, 3629, 0)), true);
  assert.equal(Bounds.isInBuffer(new Location(3122, 3629, 0)), true);
  assert.equal(Bounds.isInBuffer(new Location(3123, 3629, 0)), false, "inside is not the buffer");
});

test("leaving warns once: the warning, the three options, then the drag and a step through", () => {
  const p = player();
  Barriers.passThrough({ player: p, object: barrier });
  assert.deepEqual(p.ticks[0], ["varbit 12393=1", `statement: ${Barriers.BARRIER_WARNING}`]);
  p.continueDialogue();
  assert.equal(prompt.title, "Continue through the Barrier?");
  assert.deepEqual(prompt.options, ["Yes.", "Yes, and don't ask again.", "No."]);
  prompt.choose("Yes.");
  assert.deepEqual(p.ticks[0].slice(2), ["varbit 12393=1", "face 3122,3629", "anim 4282", "sound 4193 x2 delay 30"]);
  p.nextTick();
  assert.deepEqual(runTicks(p, 1)[1], ["varbit 12393=0", "teleport 3122,3629", "anim 65535"]);
});

test("'Yes, and don't ask again' sets varbit 10532 and skips the warning next time", () => {
  const p = player();
  Barriers.passThrough({ player: p, object: barrier });
  p.continueDialogue();
  prompt.choose("Yes, and don't ask again.");
  assert.equal(p.varbits.get(10532), 1);
  const again = player();
  again.setAttribute(Barriers.DONT_ASK_ATTRIBUTE, true);
  Barriers.passThrough({ player: again, object: barrier });
  assert.ok(!again.ticks[0].some((x) => x.startsWith("statement")));
  assert.ok(again.ticks[0].includes("anim 4282"));
});

test("coming back in needs no warning; a teleblocked player is turned away", () => {
  const p = player({ at: new Location(3122, 3629, 0) });
  Barriers.passThrough({ player: p, object: barrier });
  assert.ok(p.ticks[0].includes("anim 4282"), "straight through");
  const blocked = player({ at: new Location(3122, 3629, 0), teleblocked: true });
  Barriers.passThrough({ player: blocked, object: barrier });
  assert.deepEqual(blocked.ticks[0], ["A magical force prevents you from entering the Ferox Enclave while teleblocked."]);
});

test("the Pool of Refreshment: drink, restore everything (prayers off) and the captured message", () => {
  const core = PluginManager.getCoreApi();
  Ferox.init({ core: { ...core, PrayerHandler: { deactivatePrayers: (who) => who.sendMessage("(prayers off)") } }, sendMultiChatboxPrompt: recordPrompt });
  const p = player({ at: new Location(3129, 3635, 0) });
  try {
    Pool.drink({ player: p });
  } finally {
    Ferox.init({ core, sendMultiChatboxPrompt: recordPrompt });
  }
  assert.deepEqual(p.ticks[0].filter((x) => !x.startsWith("poison") && !x.startsWith("run")), [
    "anim 7305", "varp 456=-1", "(prayers off)", "You feel reinvigorated after drinking from the pool.",
  ]);
  assert.ok(p.ticks[0].includes("run 100"));
  assert.ok([...p.levels.values()].every((level) => level === 99), "every skill back to base");
});

test("the Ferox varbits: 6549 inside the town, 10530 in the buffer", () => {
  const inside = player({ at: new Location(3130, 3630, 0) });
  Barriers.syncState({ player: inside });
  assert.deepEqual([inside.varbits.get(6549), inside.varbits.get(10530)], [1, 0]);
  const buffer = player({ at: new Location(3122, 3629, 0) });
  Barriers.syncState({ player: buffer });
  assert.deepEqual([buffer.varbits.get(6549), buffer.varbits.get(10530)], [0, 1]);
});

test("players can't attack each other in the town unless one is teleblocked", () => {
  const a = player({ at: new Location(3130, 3630, 0) });
  const b = player({ at: new Location(3131, 3630, 0) });
  const event = { attacker: a, target: b, allow: null };
  Barriers.denySafeZoneAttack(event);
  assert.equal(event.allow, false);
  const tb = player({ at: new Location(3131, 3630, 0), teleblocked: true });
  const allowed = { attacker: a, target: tb, allow: null };
  Barriers.denySafeZoneAttack(allowed);
  assert.equal(allowed.allow, null);
});

// ------------------------------------------------------------------ the free-for-all arena

/** The free-for-all's handlers, with its Area defined; restores show as "run 100" (run energy back). */
function ffaHarness() {
  return { ...FFA, FreeForAllArena: FFA.defineArena() };
}

const restores = (p) => p.ticks.flat().filter((x) => x === "run 100").length;

function arenaPlayer(at = new Location(3327, 4760, 0)) {
  const p = player({ at });
  const display = new Map();
  const sender = p.getPacketSender();
  sender.sendInterfaceDisplayState = (uid, hidden) => (display.set(uid & 0xffff, !hidden), sender);
  sender.sendPlayerOption = (slot, option) => (p.ticks[p.ticks.length - 1].push(`option ${slot} ${option || "(none)"}`), sender);
  p.display = display;
  p.isPlayer = () => true;
  p.getAsPlayer = () => p;
  let skull = { timer: 500, type: "white" };
  p.getSkullTimer = () => skull.timer;
  p.getSkullType = () => skull.type;
  p.setSkullTimer = (t) => { skull.timer = t; };
  p.setSkullType = (t) => { skull.type = t; };
  p.getUpdateFlag = () => ({ flag() {} });
  return p;
}

test("free-for-all: in a tick after the click, restored; the arena shows Attack and the safe PvP overlay", () => {
  const { enter, FreeForAllArena } = ffaHarness();
  const p = arenaPlayer(new Location(3127, 3627, 0));
  enter({ player: p });
  assert.deepEqual(p.ticks[0], []);
  p.nextTick();
  assert.ok(runTicks(p, 1)[1].includes("teleport 3327,4751"));
  assert.equal(restores(p), 1, "restored on the way in");
  const arena = new FreeForAllArena([]);
  arena.postEnter(p);
  assert.ok(p.ticks.flat().includes("option 1 Attack"), "player option slot 1, which the client reads");
  assert.ok(p.ticks.flat().includes("overlay 199"));
  assert.deepEqual([p.display.get(43), p.display.get(47), p.varbits.get(8121)], [true, true, 1]);
  arena.postLeave(p, false);
  assert.deepEqual([p.display.get(43), p.display.get(47), p.varbits.get(8121)], [false, false, 0]);
  assert.ok(p.ticks.flat().includes("option 1 (none)"));
  assert.equal(restores(p), 2, "leaving restores again");
});

test("free-for-all: anyone may attack anyone past the line (8875, y 4759-4760); not from the safe zone", () => {
  const { FreeForAllArena } = ffaHarness();
  const arena = new FreeForAllArena([]);
  const a = arenaPlayer(new Location(3327, 4761, 0));
  const b = arenaPlayer(new Location(3330, 4790, 0));
  const outside = arenaPlayer(new Location(3128, 3629, 0));
  assert.equal(arena.canAttack(a, b), true);
  assert.equal(arena.canAttack(a, outside), false);
  const safe = arenaPlayer(new Location(3327, 4760, 0));
  assert.equal(arena.canAttack(safe, b), false, "on the line is still safe");
  assert.ok(safe.ticks.flat().includes("You can't fight in the safe zone."));
  assert.equal(arena.canAttack(b, safe), false, "and can't be attacked there");
  assert.equal(arena.canAttack(a, { isPlayer: () => false }), null, "NPCs follow the usual rules");
});

test("the line is ground decoration 8875 across the arena, at y 4759-4760, in this cache's map", () => {
  RegionManager.loadMapFiles(3327, 4760);
  const at = (x, y) => (MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? []).some((o) => o.getId() === 8875);
  assert.ok(at(3327, 4759) && at(3327, 4760) && at(3300, 4759));
  assert.equal(FFA.SAFE_MAX_Y, 4760);
});

test("free-for-all: the north is multi-combat (captured from y 4800), the south single", () => {
  const { Wilderness } = require("../dist/game/content/wilderness/Wilderness");
  assert.equal(Wilderness.isMulti(3327, 4803, 0), true);
  assert.equal(Wilderness.isMulti(3327, 4797, 0), false);
});

test("free-for-all: a safe death keeps everything and the skull, back outside the portal", () => {
  const { keepItems, respawn } = ffaHarness();
  const p = arenaPlayer();
  const drop = { player: p, killer: null, shouldDrop: null };
  keepItems(drop);
  assert.equal(drop.shouldDrop, false);
  p.setSkullTimer(0);
  const death = { player: p, killer: null, handled: false };
  respawn(death);
  assert.equal(death.handled, true);
  assert.ok(p.ticks.flat().includes("teleport 3128,3629"));
  assert.equal(p.getSkullTimer(), 500, "the skull survives the death reset");
  const elsewhere = { player: arenaPlayer(new Location(3200, 3200, 0)), shouldDrop: null };
  keepItems(elsewhere);
  assert.equal(elsewhere.shouldDrop, null, "deaths elsewhere are untouched");
});

test("free-for-all: Disable-XP asks, sets varbit 20231 and says so (captured); XP is blocked only inside", () => {
  const { toggleXp, blockXp } = ffaHarness();
  const p = arenaPlayer(new Location(3128, 3627, 0));
  toggleXp({ player: p });
  assert.equal(prompt.title, "Disable XP gains in Clan Wars?");
  assert.deepEqual(prompt.options, ["Yes.", "No."]);
  prompt.choose("Yes.");
  assert.equal(p.varbits.get(20231), 1);
  assert.ok(p.ticks.flat().includes("statement: You will no longer gain XP in Clan Wars."));
  const outside = { player: p, allow: null };
  blockXp(outside);
  assert.equal(outside.allow, null, "outside the arena XP still counts");
  const inside = arenaPlayer();
  inside.setAttribute(FFA.XP_DISABLE_ATTRIBUTE, true);
  const event = { player: inside, allow: null };
  blockXp(event);
  assert.equal(event.allow, false);
  toggleXp({ player: inside });
  assert.equal(prompt.title, "Enable XP gains in Clan Wars?");
});

test("free-for-all: the exit portal a tick later; the Mysterious Portal is unavailable", () => {
  const { exit, mysteriousPortal } = ffaHarness();
  const p = arenaPlayer(new Location(3326, 4751, 0));
  assert.equal(exit({ player: p }), true);
  p.nextTick();
  assert.deepEqual(runTicks(p, 2)[1].slice(0, 3), ["varbit 12393=1", "teleport 3128,3629", "face 3128,3630"]);
  assert.equal(exit({ player: arenaPlayer(new Location(3200, 3200, 0)) }), false, "other Exit portals fall through");
  const q = arenaPlayer(new Location(3372, 4757, 0));
  mysteriousPortal({ player: q });
  assert.deepEqual(q.ticks[0], ["varbit 12393=1", "statement: This portal is unavailable on this world."]);
});

