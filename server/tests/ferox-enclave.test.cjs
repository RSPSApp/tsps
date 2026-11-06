process.env.DISABLE_PLAYER_BOTS = '1';
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
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const Bounds = require("../plugins/areas/ferox/Bounds.FeroxEnclave");
const Ferox = require("../plugins/areas/ferox/Common.FeroxEnclave");
const Barriers = require("../plugins/areas/ferox/Barriers.FeroxEnclave");
const Pool = require("../plugins/areas/ferox/Pool.FeroxEnclave");
const FFA = require("../plugins/areas/ferox/FreeForAll.FeroxEnclave");
const Portal = require("../plugins/areas/ferox/CastleWarsPortal.FeroxEnclave");
const FeroxPlugin = require("../plugins/areas/FeroxEnclave.plugin");

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

test("random events use the captured enclave polygon, leaving the buffer and arena restricted", () => {
  let eligibility;
  const api = new Proxy({
    core: PluginManager.getCoreApi(), sendMultiChatboxPrompt: recordPrompt,
    onCustomEvent(name, handler) { if (name === "random-events:eligibility") eligibility = handler; },
  }, { get(target, name) { return target[name] ?? (() => {}); } });
  FeroxPlugin.register(api);
  assert.equal(typeof eligibility, "function");
  for (const [x, y, z, expected] of [[3130, 3631, 0, true], [3123, 3629, 0, true],
    [3122, 3629, 0, null], [3123, 3617, 0, null], [3130, 3631, 1, null], [3320, 4750, 0, null]]) {
    const request = { player: player({ at: new Location(x, y, z) }), kind: "mime", following: false, allowed: null };
    eligibility(request);
    assert.equal(request.allowed, expected, `${x},${y},${z}`);
  }
  const blocked = { player: player({ at: new Location(3130, 3631, 0) }), allowed: false };
  eligibility(blocked);
  assert.equal(blocked.allowed, false, "an active activity's exclusion wins over Ferox's general permission");
});

test("the barrier in this cache crosses between the town and the buffer (captured tiles)", () => {
  assert.ok(barrier, "barrier 39652 at 3123,3629");
  const out = Bounds.crossingTarget(new Location(3123, 3629, 0), barrier);
  assert.deepEqual([out.target.x, out.target.y, out.entering], [3122, 3629, false]);
  const back = Bounds.crossingTarget(new Location(3122, 3629, 0), barrier);
  assert.deepEqual([back.target.x, back.target.y, back.entering], [3123, 3629, true]);
  assert.equal(Bounds.isInsideEnclave(new Location(3123, 3629, 0)), true);
  assert.equal(Bounds.isInBuffer(new Location(3122, 3629, 0)), true);
  assert.equal(Bounds.isInBuffer(new Location(3123, 3629, 0)), false, "inside is not the buffer");
  for (const objects of MapObjects.mapObjects.values()) {
    for (const object of objects) {
      if (!Bounds.BARRIER_IDS.includes(object.getId())) continue;
      const tile = object.getLocation();
      assert.ok(tile.getX() - 1 >= Bounds.AREA.minX && tile.getX() + 1 <= Bounds.AREA.maxX
        && tile.getY() - 1 >= Bounds.AREA.minY && tile.getY() + 1 <= Bounds.AREA.maxY,
      `local area includes barrier ${tile.getX()},${tile.getY()} and its buffer`);
    }
  }
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

function enclaveWorld(t) {
  const core = { ...PluginManager.getCoreApi(), AreaManager, CombatFactory };
  const saved = { areas: AreaManager.areas, index: AreaManager.areaSearchIndex,
    api: Ferox.api, stats: PluginManager.pluginPerfStats,
    enabled: PluginManager.isPluginPerformanceProfilingEnabled() };
  AreaManager.areas = [];
  AreaManager.areaSearchIndex = null;
  PluginManager.pluginPerfStats = new Map();
  PluginManager.setPluginPerformanceProfilingEnabled(true);
  t.after(() => {
    AreaManager.areas = saved.areas;
    AreaManager.areaSearchIndex = saved.index;
    Ferox.init(saved.api);
    PluginManager.pluginPerfStats = saved.stats;
    PluginManager.setPluginPerformanceProfilingEnabled(saved.enabled);
  });
  const custom = new Map(), startup = [], global = { attack: [], process: [] };
  const apiFor = (name) => new Proxy({
    core, sendMultiChatboxPrompt: recordPrompt,
    registerArea(area) { area.pluginName = name; AreaManager.areas.push(area); },
    onCustomEvent(name, handler) { custom.set(name, [...(custom.get(name) ?? []), handler]); },
    emitCustomEvent(name, event) { for (const handler of custom.get(name) ?? []) handler(event); },
    onServerStartup(handler) { startup.push(handler); },
    onCanAttack(handler) { if (name === 'FeroxEnclave') global.attack.push(handler); },
    onPlayerProcess(handler) { if (name === 'FeroxEnclave') global.process.push(handler); },
  }, { get(target, name) { return target[name] ?? (() => {}); } });
  require('../plugins/areas/Wilderness.plugin').register(apiFor('Wilderness'));
  FeroxPlugin.register(apiFor('FeroxEnclave'));
  for (const handler of startup) handler({});
  let index = 0;
  function actor(at, teleblocked = false) {
    const p = player({ at, teleblocked });
    let area = null, multi = 0;
    const id = ++index;
    Object.assign(p, {
      isPlayerBot: () => true, isNpc: () => false, getAsPlayer: () => p, getIndex: () => id,
      getArea: () => area, setArea: (value) => { area = value; }, getPrivateArea: () => null,
      getMultiIcon: () => multi, setMultiIcon: (value) => { multi = value; },
    });
    AreaManager.process(p);
    return p;
  }
  return { core, actor, global, area: AreaManager.areas.find((area) => area.getName() === 'FeroxEnclaveArea') };
}

test('Ferox has no global combat/process hooks and does no work for distant players', (t) => {
  const { core, actor, global, area } = enclaveWorld(t);
  assert.ok(area);
  assert.deepEqual(global, { attack: [], process: [] });
  const a = actor(new Location(3100, 3600, 0)), b = actor(new Location(3101, 3600, 0));
  assert.equal(a.getArea().getName(), 'WildernessArea');
  core.CombatFactory.canAttackByPolicy(a, b);
  assert.equal(PluginManager.getPluginPerformanceSnapshot().some((row) => row.pluginName === 'FeroxEnclave'), false);
  const lookup = t.mock.method(MapObjects.mapObjects, 'get');
  assert.equal(Bounds.isSafeLocation(a.getLocation()), false);
  assert.equal(Bounds.isInBuffer(a.getLocation()), false);
  assert.equal(lookup.mock.callCount(), 0, 'shared Ferox bounds reject remote tiles before map queries');
});

test('walking from Wilderness into Ferox updates town/buffer varbits and clears them on departure', (t) => {
  const { core, actor, area } = enclaveWorld(t);
  const p = actor(new Location(3109, 3629, 0));
  assert.equal(p.getArea().getName(), 'WildernessArea');
  p.moveTo(new Location(3122, 3629, 0));
  core.AreaManager.process(p);
  assert.equal(p.getArea(), area, 'specific area replaces the overlapping Wilderness area');
  assert.deepEqual([p.varbits.get(6549), p.varbits.get(10530)], [0, 1]);
  p.moveTo(new Location(3123, 3629, 0));
  core.AreaManager.process(p);
  assert.deepEqual([p.varbits.get(6549), p.varbits.get(10530)], [1, 0]);
  p.moveTo(new Location(3109, 3629, 0));
  core.AreaManager.process(p);
  assert.equal(p.getArea().getName(), 'WildernessArea');
  assert.deepEqual([p.varbits.get(6549), p.varbits.get(10530)], [0, 0]);
  p.moveTo(new Location(3130, 3630, 0));
  core.AreaManager.process(p);
  p.moveTo(new Location(3130, 3630, 1));
  core.AreaManager.process(p);
  assert.notEqual(p.getArea(), area);
  assert.deepEqual([p.varbits.get(6549), p.varbits.get(10530)], [0, 0], 'changing plane clears both bits');
});

test('local Ferox combat protects either actor across its edge and preserves Wilderness fallback', (t) => {
  const { core, actor, area } = enclaveWorld(t);
  const denied = core.CanAttackResponse.CANT_ATTACK_IN_AREA;
  const inside = actor(new Location(3130, 3630, 0));
  const buffer = actor(new Location(3122, 3629, 0));
  const outside = actor(new Location(3109, 3629, 0));
  for (const safe of [inside, buffer]) {
    assert.equal(core.CombatFactory.canAttackByPolicy(outside, safe), denied);
    assert.equal(core.CombatFactory.canAttackByPolicy(safe, outside), denied);
  }
  const teleblocked = actor(new Location(3122, 3629, 0), true);
  assert.equal(area.canAttack(teleblocked, outside), false, 'teleblock does not bypass the existing Wilderness rule');
  assert.equal(area.canAttack(outside, teleblocked), false);
  assert.equal(area.canAttack(inside, { isPlayer: () => false }), null, 'NPC combat is unchanged');
});

test('Ferox clears state when another area claims a player before moving them', (t) => {
  const { core, actor, area } = enclaveWorld(t);
  const p = actor(new Location(3130, 3630, 0));
  assert.equal(p.varbits.get(6549), 1);
  const instance = new (class extends core.Area {})(area.getBoundaries());
  instance.enter(p);
  assert.deepEqual([p.varbits.get(6549), p.varbits.get(10530)], [0, 0]);
});

// ------------------------------------------------------------------ the Castle Wars portal

test("the Castle Wars portal by The Old Nite is this cache's 30386, with an Enter option", () => {
  RegionManager.loadMapFiles(3146, 3638);
  const portal = (MapObjects.mapObjects.get(MapObjects.getHash(3146, 3638, 0)) ?? []).find((o) => o.getId() === 30386);
  assert.ok(portal, "portal 30386 at 3146,3638");
  assert.deepEqual(portal.getDefinition().getInteractions().filter(Boolean), ["Enter"]);
});

test("the Castle Wars portal: warns about no return, then walks you to the lobby a tick later", () => {
  const p = player({ at: new Location(3146, 3637, 0) });
  Portal.enter({ player: p, object: { id: 30386 } });
  assert.ok(p.ticks[0].includes(`statement: ${Portal.WARNING}`));
  p.continueDialogue();
  assert.equal(prompt.title, "Enter the Castle Wars portal?");
  assert.deepEqual(prompt.options, ["Yes.", "No."]);
  prompt.choose("Yes.");
  assert.ok(p.ticks[0].includes("varbit 12393=1"));
  p.nextTick();
  assert.deepEqual(runTicks(p, 1)[1], ["varbit 12393=0", "teleport 2440,3090"]);
});

test("the Castle Wars portal: 'No.' only clears the busy flag", () => {
  const p = player({ at: new Location(3146, 3637, 0) });
  Portal.enter({ player: p, object: { id: 30386 } });
  p.continueDialogue();
  prompt.choose("No.");
  assert.ok(p.ticks[0].filter((x) => x === "varbit 12393=1").length === 1, "busy once");
  assert.ok(p.ticks[0].includes("varbit 12393=0"), "declining clears busy");
  assert.deepEqual(runTicks(p, 1)[1], [], "nothing else happens");
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


// Native name/action dispatch, not network walk routing.
const { describe, after } = require('node:test');
describe('Castle Wars lobby return (native dispatch)', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  let core, leaves, originals, next = 4900;
  before(() => {
    core = PluginManager.getCoreApi();
    RegionManager.loadMapFiles(2440, 3090);
    RegionManager.loadMapFiles(3128, 3629);
    require('../plugins/objects/Doors.plugin').register(PluginManager.createApi('Doors'));
    FeroxPlugin.register(PluginManager.createApi('FeroxEnclave'));
    PluginManager.emitServerStartup({});
    leaves = [core.ObjectIdentifiers.LARGE_DOOR_98, core.ObjectIdentifiers.LARGE_DOOR_99].map(id => {
      const found = [...MapObjects.mapObjects.values()].flat().filter(o => {
        const l = o.getLocation();
        return o.getId() === id && l.getZ() === 0 && l.getX() >= 2430 && l.getX() <= 2450
          && l.getY() >= 3080 && l.getY() <= 3100;
      });
      assert.equal(found.length, 1, `one mapped lobby leaf ${id}`);
      return found[0];
    });
    originals = leaves.map(o => ({ id: o.getId(), location: o.getLocation().clone(),
      clipping: RegionManager.getClipping(o.getLocation().getX(), o.getLocation().getY(), 0, null) }));
  });
  after(() => PluginManager.emitServerShutdown({}));
  function actor(t) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel), p = new Player(session);
    session.setPlayer(p); p.setIndex(next++); p.setUsername(`feroxdoor${p.getIndex()}`);
    p.setRegistered(true); p.needsPlacement = false;
    const client = new ClientConnection(channel); client.player = p;
    t.after(() => { core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
    return { p, client };
  }
  function standing() { return originals.map(row => MapObjects.get(row.id, row.location.clone(), null)); }
  function closed() {
    assert.ok(standing().every(Boolean), 'both original map leaves stand');
    for (const row of originals) assert.equal(RegionManager.getClipping(row.location.getX(), row.location.getY(), 0, null), row.clipping);
  }
  function click(f, leaf) {
    const o = standing()[leaf]; assert.ok(o, 'clicked closed map leaf');
    const l = o.getLocation(), source = new core.Location(l.getX(), l.getY() + 1, l.getZ());
    assert.equal(RegionManager.blocked(source, null), false, 'adjacent source tile is walkable');
    f.p.setLocation(source); f.p.needsPlacement = false;
    const definition = core.ObjectDefinition.forPlayer(o.getId(), f.p);
    assert.equal(definition.getName(), 'Large door');
    const clickType = definition.getInteractions().findIndex(a => a?.toLowerCase() === 'open') + 1;
    assert.ok(clickType, 'cache supplies Open');
    assert.equal(PluginManager.emitObjectInteraction({ player: f.p, object: o, objectId: o.getId(), definition, clickType,
      option: 'Open', sourceLocation: { x: source.getX(), y: source.getY(), z: source.getZ() },
      location: { x: l.getX(), y: l.getY(), z: l.getZ() }, handled: false }), true);
  }
  function resetDoor() {
    // Exercise the real door's own auto-close; no other plugins or startup jobs are registered here.
    for (let i = 0; i < 502; i++) core.TaskManager.process();
  }
  async function choose(f, n) {
    await f.client.dispatch([{ type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: n }]);
    f.client.processTurnPackets();
  }
  for (const leaf of [0, 1]) {
    test(`leaf ${leaf}: members named dispatch opens the real pair`, (t) => {
      t.mock.method(core.WorldDefinition, 'isMembersWorld', () => true);
      const f = actor(t);
      try { closed(); click(f, leaf); assert.ok(standing().every(o => !o), 'both closed leaves removed'); }
      finally { resetDoor(); }
      closed();
    });
    test(`leaf ${leaf}: F2P asks before travel and leaves both leaves closed on cancel`, async (t) => {
      t.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
      const f = actor(t);
      try {
        closed(); click(f, leaf);
        const pending = core.MultiChatboxPrompt.getPending(f.p);
        assert.ok(pending, 'return confirmation is shown'); closed();
        const no = pending.options.findIndex(s => /^(no|cancel)\b/i.test(s)); assert.ok(no >= 0);
        const at = f.p.getLocation().clone(); await choose(f, no + 1);
        core.TaskManager.process(); core.TaskManager.process();
        assert.ok(f.p.getLocation().equals(at)); closed();
      } finally { resetDoor(); }
    });
    test(`leaf ${leaf}: F2P does not open the shared door`, (t) => {
      t.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
      const f = actor(t);
      try { closed(); click(f, leaf); closed(); } finally { resetDoor(); }
    });
    test(`leaf ${leaf}: F2P acceptance reaches safe walkable Ferox`, async (t) => {
      t.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
      const f = actor(t);
      try {
        closed(); click(f, leaf);
        const pending = core.MultiChatboxPrompt.getPending(f.p); assert.ok(pending, 'return confirmation is shown');
        const yes = pending.options.findIndex(s => /^yes\b/i.test(s)); assert.ok(yes >= 0);
        await choose(f, yes + 1); core.TaskManager.process(); core.TaskManager.process();
        assert.ok(Bounds.isInsideEnclave(f.p.getLocation()), 'arrived in the enclave');
        assert.equal(RegionManager.blocked(f.p.getLocation(), null), false, 'arrival tile is walkable');
        closed();
      } finally { resetDoor(); }
    });
    test(`leaf ${leaf}: a stale return cannot move a player who walked away`, async (t) => {
      t.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
      const f = actor(t);
      try {
        closed(); click(f, leaf);
        const pending = core.MultiChatboxPrompt.getPending(f.p); assert.ok(pending);
        const yes = pending.options.findIndex(s => /^yes\b/i.test(s)); assert.ok(yes >= 0);
        const away = new core.Location(2440, 3090, 0); f.p.setLocation(away.clone()); f.p.needsPlacement = false;
        await choose(f, yes + 1); core.TaskManager.process(); core.TaskManager.process();
        assert.ok(f.p.getLocation().equals(away)); closed();
      } finally { resetDoor(); }
    });
    for (const change of ['movement', 'world', 'logout']) {
      test(`leaf ${leaf}: ${change} after Yes prevents delayed travel`, async (t) => {
        let members = false;
        t.mock.method(core.WorldDefinition, 'isMembersWorld', () => members);
        const f = actor(t);
        try {
          closed(); click(f, leaf);
          const pending = core.MultiChatboxPrompt.getPending(f.p); assert.ok(pending);
          const yes = pending.options.findIndex(s => /^yes\b/i.test(s)); assert.ok(yes >= 0);
          await choose(f, yes + 1);
          if (change === 'movement') f.p.setLocation(new core.Location(2440, 3090, 0));
          if (change === 'world') members = true;
          if (change === 'logout') f.p.setRegistered(false);
          const at = f.p.getLocation().clone();
          core.TaskManager.process(); core.TaskManager.process();
          assert.ok(f.p.getLocation().equals(at)); closed();
        } finally { resetDoor(); }
      });
    }
    test(`leaf ${leaf}: another prompt replaces the return`, async (t) => {
      t.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
      const f = actor(t);
      try {
        closed(); click(f, leaf); assert.ok(core.MultiChatboxPrompt.getPending(f.p));
        let picked = false;
        core.MultiChatboxPrompt.showPrompt('fixture', f.p, 'Replacement?', ['Yes.', () => { picked = true; }, 'No.', () => {}]);
        const at = f.p.getLocation().clone(); await choose(f, 1);
        core.TaskManager.process(); core.TaskManager.process();
        assert.equal(picked, true); assert.ok(f.p.getLocation().equals(at)); closed();
      } finally { resetDoor(); }
    });
  }
});
