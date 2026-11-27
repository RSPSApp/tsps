// Run after `yarn build`: node --test tests/dormant-npcs.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const Crabs = require("../plugins/npcs/DormantNpcs.plugin");
const { start, track, wake, killed, onAttack, pick, watched, awake, picking, crabSquares, dormantIds } = Crabs._test;

const core = PluginManager.getCoreApi();
const events = [];
const inCombat = new Set();
const routes = [];
const api = {
  core,
  getAreaManager: () => ({ inMulti: () => false }),
  emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.CombatFactory.inCombat = (mobile) => inCombat.has(mobile);
  core.PathFinder.calculateWalkRoute = (npc, x, y) => routes.push([x, y]);
  start(api);
});

beforeEach(() => {
  events.length = 0;
  routes.length = 0;
  inCombat.clear();
  watched.clear();
  awake.clear();
  picking.clear();
});

function createCrab(id, x, y) {
  let transform = -1;
  let hitpoints = CacheDefinitions.getNpc(id) ? 60 : 0;
  let maxOverride = -1;
  let location = new Location(x, y, 0);
  const spawn = new Location(x, y, 0);
  const crab = {
    log: [],
    attacked: [],
    moveTo: (to) => { location = to; },
    getId: () => (transform !== -1 ? transform : id),
    getRealId: () => id,
    setNpcTransformationId: (value) => { transform = value; },
    setMaxHitpoints: (value) => { maxOverride = value; },
    getMaxHitpoints: () => (maxOverride >= 0 ? maxOverride : core.NpcDefinition.forId(id).getHitpoints()),
    setHitpoints: (value) => { hitpoints = value; },
    getHitpoints: () => hitpoints,
    performAnimation: (animation) => crab.log.push(`anim ${animation.getId()}`),
    getCombat: () => ({ attack: (target) => crab.attacked.push(target) }),
    getLocation: () => location,
    getSpawnPosition: () => spawn,
    blocked: false,
    getMovementQueue: () => ({ size: () => 0, isMovings: () => false, reset() {}, setBlockMovement: (value) => { crab.blocked = value; } }),
    isRegistered: () => hitpoints > 0,
    getCurrentDefinition: () => core.NpcDefinition.forId(crab.getId()),
    setMobileInteraction() {},
    isNpc: () => true,
    isPlayer: () => false,
  };
  return crab;
}

function createPlayer(x, y, { tolerant = false, npcs = [] } = {}) {
  const attributes = new Map();
  const log = [];
  return {
    log,
    performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
    getPacketSender: () => ({ sendSound: (id, volume, delay) => log.push(`sound ${id} ${delay}`) }),
    sendMessage: (text) => log.push(`message ${text}`),
    isPlayer: () => true,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getLocation: () => new Location(x, y, 0),
    getLocalNpcs: () => npcs,
    getAggressionTolerance: () => ({ finished: () => tolerant }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
}

const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };

test("the data: every crab pair as the cache names it", () => {
  const name = (id) => CacheDefinitions.getNpc(id).name;
  const disguises = { "Rock Crab": "Rocks", "Giant Rock Crab": "Boulder", "Sand Crab": "Sandy rocks", "Ammonite Crab": "Fossil Rock", "Swamp Crab": "Swampy log", "King Sand Crab": "Sandy Boulder" };
  for (const [dormant, { family, awakeId }] of dormantIds) {
    if (family.trigger !== "approach") continue;
    assert.equal(name(dormant), disguises[family.name], `${dormant}`);
    assert.equal(name(awakeId), family.name, `${awakeId}`);
  }
});

const readSpawns = () => JSON.parse(require("node:fs").readFileSync(path.resolve(__dirname, "../data/definitions/npc-spawns.json"), "utf8"));

test("disguises don't wander: every crab and zygomite cap spawns with wanderRadius 0 (wyrms slither)", () => {
  const still = new Set(["approach", "picked"]);
  const roaming = readSpawns().filter((spawn) => still.has(dormantIds.get(spawn.id)?.family.trigger) && spawn.wanderRadius !== 0);
  assert.deepEqual(roaming, []);
});

test("zygomites: Zanaris spawns only the Fungi, five of each kind on the captured tiles (issue 6867)", () => {
  const spawns = readSpawns();
  const at = (id) => spawns.filter((spawn) => spawn.id === id).map((spawn) => `${spawn.x},${spawn.y},${spawn.level}`).sort();
  assert.deepEqual(at(1023), ["2412,4370,0", "2416,4376,0", "2419,4374,0", "2420,4377,0", "2421,4370,0"], "rev 243 capture");
  assert.equal(at(536).length, 5);
  assert.deepEqual([...at(537), ...at(1024)], [], "the combat forms only come out of a picked cap");
});

test("zygomites: each placeholder shows a Fungi with Pick and rises as the Zygomite of its level", () => {
  const pairs = [...dormantIds].filter(([, { family }]) => family.trigger === "picked").map(([dormant, { awakeId }]) => [dormant, awakeId]);
  assert.deepEqual(pairs, [[536, 537], [1023, 1024]]);
  for (const [dormant, awakeId] of pairs) {
    const shown = CacheDefinitions.getNpc(dormant).transforms.map((id) => CacheDefinitions.getNpc(id));
    assert.ok(shown.some((type) => type.name === "Fungi" && type.actions[0] === "Pick"), `${dormant}`);
    assert.equal(CacheDefinitions.getNpc(awakeId).name, "Zygomite");
    assert.equal(CacheDefinitions.getNpc(awakeId).combatLevel, CacheDefinitions.getNpc(dormant).combatLevel);
  }
});

test("crab squares come from the spawns, and players are watched only inside them", () => {
  assert.ok(crabSquares.has(`${1750 >> 6},${3470 >> 6},0`), "Hosidius' sandy rocks");
  const hosidius = createPlayer(1750, 3470);
  const lumbridge = createPlayer(3222, 3218);
  track({ player: hosidius });
  track({ player: lumbridge });
  assert.deepEqual([...watched], [hosidius]);
});

test("a sand crab wakes for an adjacent player: its crab form and hitpoints, the rise, then the attack", () => {
  const crab = createCrab(5936, 1751, 3471);
  const player = createPlayer(1750, 3470, { npcs: [crab] });
  track({ player });
  runTicks();
  assert.equal(crab.getId(), 5935, "diagonal counts as next to");
  assert.equal(crab.getHitpoints(), 60);
  assert.deepEqual(crab.log, ["anim 1316"]);
  assert.deepEqual(crab.attacked, [], "it rises first (1316 lasts 74 cycles)");
  assert.equal(crab.blocked, true, "and doesn't walk while rising");
  runTicks(3);
  assert.deepEqual(crab.attacked, [player]);
  assert.equal(crab.blocked, false);
});

test("every crab beside the player rises, not just the first", () => {
  const crabs = [createCrab(5936, 1750, 3471), createCrab(7207, 1751, 3470), createCrab(5936, 1749, 3469)];
  const player = createPlayer(1750, 3470, { npcs: crabs });
  track({ player });
  runTicks(4);
  assert.deepEqual(crabs.map((crab) => crab.getId()), [5935, 7206, 5935]);
  assert.ok(crabs.every((crab) => crab.attacked[0] === player));
});

test("it stays scenery for a player two tiles off, or one it has become tolerant of", () => {
  const crab = createCrab(5936, 1750, 3472);
  track({ player: createPlayer(1750, 3470, { npcs: [crab] }) });
  runTicks();
  assert.equal(crab.getId(), 5936);
  watched.clear();
  const near = createCrab(5936, 1750, 3471);
  track({ player: createPlayer(1750, 3470, { tolerant: true, npcs: [near] }) });
  runTicks();
  assert.equal(near.getId(), 5936, "crabs can only be fought while aggressive (Wiki)");
});

test("::aggro keeps crabs waking for a player past tolerance (issue #1860)", () => {
  const AggressionToggle = require("../plugins/npcs/AggressionToggle.plugin");
  const commands = new Map();
  const toggleApi = PluginManager.createApi("AggressionToggle");
  toggleApi.registerCommand = (name, handler) => commands.set(name, handler);
  AggressionToggle.register(toggleApi);
  const crab = createCrab(5936, 1750, 3471);
  const player = createPlayer(1750, 3470, { tolerant: true, npcs: [crab] });
  player.sendMessage = () => {};
  commands.get("aggro")({ player });
  track({ player });
  runTicks();
  assert.equal(crab.getId(), 5935, "the crab rises although the player is tolerant");
  commands.get("aggro")({ player });
  watched.clear();
  const next = createCrab(5936, 1750, 3471);
  track({ player: Object.assign(player, { getLocalNpcs: () => [next] }) });
  runTicks();
  assert.equal(next.getId(), 5936, "toggled off, tolerance applies again");
});

test("a giant rock crab wakes with the crab's hitpoints, not the boulder's", () => {
  const crab = createCrab(2262, 2700, 3700);
  wake(crab, createPlayer(2700, 3701));
  assert.equal(crab.getHitpoints(), core.NpcDefinition.forId(2261).getHitpoints());
  assert.ok(crab.getHitpoints() > core.NpcDefinition.forId(2262).getHitpoints());
});

test("out of combat it rests, walks home, sinks and is scenery again, healed", () => {
  const crab = createCrab(5936, 1750, 3471);
  wake(crab, createPlayer(1750, 3470));
  crab.setHitpoints(12);
  inCombat.add(crab);
  runTicks(30);
  assert.equal(crab.getId(), 5935, "never rests while fighting");
  inCombat.clear();
  crab.moveTo(new Location(1752, 3471, 0));
  runTicks(20);
  assert.deepEqual(routes.at(-1), [1750, 3471], "walks back to where it lay");
  crab.moveTo(new Location(1750, 3471, 0));
  crab.log.length = 0;
  runTicks();
  assert.deepEqual(crab.log, ["anim 1314"]);
  runTicks();
  assert.equal(crab.getId(), 5936);
  assert.equal(crab.getHitpoints(), crab.getMaxHitpoints());
  assert.equal(awake.size, 0);
});

test("diary tasks: a sand crab kill, and the fifth rock crab", () => {
  const player = createPlayer(1750, 3470);
  const sand = createCrab(5936, 1750, 3471);
  sand.setNpcTransformationId(5935);
  killed({ killer: player, npc: sand });
  const rock = createCrab(101, 2700, 3720);
  rock.setNpcTransformationId(100);
  for (let i = 0; i < 5; i++) killed({ killer: player, npc: rock });
  assert.deepEqual(events.map((event) => `${event.diary}:${event.task}`), ["kourend:kill-a-sandcrab", "fremennik:kill-5-rock-crabs"]);
});

test("wyrms and wyrmlings: each dormant id rises as its awake form, as the cache names them", () => {
  const name = (id) => CacheDefinitions.getNpc(id).name;
  const pairs = [...dormantIds].filter(([, { family }]) => family.trigger === "attacked").map(([dormant, { awakeId }]) => [dormant, awakeId]);
  assert.deepEqual(pairs, [[8610, 8611], [13031, 13032], [16297, 16296]]);
  for (const [dormant, awakeId] of pairs) assert.equal(name(dormant), name(awakeId));
  assert.ok(![...crabSquares].some((square) => square === "40,159,0"), "wyrms aren't watched by approach");
});

test("a wyrm rises when attacked, doesn't fight back while rising, then attacks; it sinks after resting", () => {
  const wyrm = createCrab(8610, 1270, 10186);
  const player = createPlayer(1268, 10186);
  const event = { attacker: player, target: wyrm, allow: null };
  onAttack(event);
  assert.equal(event.allow, null, "the player's attack goes ahead");
  assert.equal(wyrm.getId(), 8611);
  assert.deepEqual(wyrm.log, ["anim 8268"], "wyrm_transition_up");
  const back = { attacker: wyrm, target: player, allow: null };
  onAttack(back);
  assert.equal(back.allow, false, "no attacking while it rises");
  runTicks(3);
  assert.deepEqual(wyrm.attacked, [player], "risen after 3 ticks (90 client cycles)");
  const later = { attacker: wyrm, target: player, allow: null };
  onAttack(later);
  assert.equal(later.allow, null);
  onAttack({ attacker: player, target: wyrm, allow: null });
  assert.equal(wyrm.log.length, 1, "an awake wyrm doesn't rise again");
  runTicks(19);
  wyrm.log.length = 0;
  runTicks();
  assert.deepEqual(wyrm.log, ["anim 8269"], "wyrm_transition_down after 20 ticks out of combat");
  runTicks();
  assert.equal(wyrm.getId(), 8611, "the sink lasts 2 ticks (60 client cycles)");
  runTicks();
  assert.equal(wyrm.getId(), 8610);
});

test("a dormant crab is not woken by an attack, and a wyrm not by walking past it", () => {
  const crab = createCrab(5936, 1751, 3471);
  onAttack({ attacker: createPlayer(1740, 3470), target: crab, allow: null });
  assert.equal(crab.getId(), 5936);
  const wyrm = createCrab(16297, 2600, 2203);
  const player = createPlayer(2601, 2203, { npcs: [wyrm] });
  track({ player });
  runTicks();
  assert.equal(wyrm.getId(), 16297);
});

test("zygomites: the pick plays the tick after arrival, the cap leaps out the next, can't be attacked while rising, then attacks", () => {
  const cap = createCrab(1023, 2412, 4370);
  const player = createPlayer(2413, 4370);
  assert.equal(pick({ player, npc: cap }), true);
  assert.deepEqual(player.log, [], "nothing on the arrival tick (capture: arrival t33, pick t34)");
  runTicks();
  assert.deepEqual(player.log, ["anim 3335", "sound 2581 0"], "human_fungicide_pick_zygomite and pick");
  assert.equal(cap.getId(), 1023, "still a cap on the pick's own tick");
  runTicks();
  assert.equal(cap.getId(), 1024);
  assert.equal(cap.getHitpoints(), core.NpcDefinition.forId(1024).getHitpoints());
  assert.deepEqual(cap.log, ["anim 12340"], "zygomite_leap_out_npc");
  assert.deepEqual(player.log.slice(2), ["sound 1963 0"], "zygo_grow");
  const early = { attacker: player, target: cap, allow: null };
  onAttack(early);
  assert.equal(early.allow, false, "its options are off until it has risen");
  assert.equal(cap.blocked, true);
  runTicks();
  assert.deepEqual(cap.attacked, []);
  runTicks();
  assert.deepEqual(cap.attacked, [player], "risen 2 ticks after the leap (56 client cycles)");
  const later = { attacker: player, target: cap, allow: null };
  onAttack(later);
  assert.equal(later.allow, null);
});

test("zygomites: picking while fighting is refused with the captured line", () => {
  const cap = createCrab(536, 2414, 4467);
  const player = createPlayer(2414, 4466);
  inCombat.add(player);
  assert.equal(pick({ player, npc: cap }), true);
  assert.deepEqual(player.log, ["message You should probably concentrate on the monster you're fighting!"]);
  runTicks(3);
  assert.equal(cap.getId(), 536);
});

test("zygomites: a cap rises once, for its first picker, and not if it is gone by then", () => {
  const cap = createCrab(1023, 2416, 4376);
  const first = createPlayer(2416, 4375);
  const second = createPlayer(2417, 4376);
  pick({ player: first, npc: cap });
  pick({ player: second, npc: cap });
  runTicks();
  assert.deepEqual(second.log, [], "ours: the second pick does nothing");
  runTicks(3);
  assert.deepEqual(cap.attacked, [first]);
  const gone = createCrab(1023, 2419, 4374);
  pick({ player: first, npc: gone });
  runTicks();
  gone.setHitpoints(0);
  runTicks(3);
  assert.equal(gone.getId(), 1023);
  assert.equal(picking.size, 0);
});

test("zygomites: ours, a picker who walks off before the pick doesn't pick", () => {
  const cap = createCrab(1023, 2420, 4377);
  let x = 2420;
  const player = Object.assign(createPlayer(2420, 4376), { getLocation: () => new Location(x, 4376, 0) });
  pick({ player, npc: cap });
  x = 2422;
  runTicks(3);
  assert.deepEqual(player.log, []);
  assert.equal(cap.getId(), 1023);
  assert.equal(picking.size, 0);
});

test("zygomites: one left on 0 hitpoints, waiting for its fungicide, still turns back into its cap, healed", () => {
  const cap = createCrab(1023, 2421, 4370);
  cap.isRegistered = () => true;
  cap.isDyingFunction = () => false;
  wake(cap, createPlayer(2421, 4371));
  runTicks(2);
  cap.setHitpoints(0);
  runTicks(21);
  assert.equal(cap.getId(), 1023);
  assert.equal(cap.getHitpoints(), cap.getMaxHitpoints());
  assert.deepEqual(events.filter((event) => event.name === "dormant-npcs:slept").map((event) => event.npc), [cap]);
  const dying = createCrab(1023, 2412, 4370);
  dying.isRegistered = () => true;
  dying.isDyingFunction = () => true;
  wake(dying, createPlayer(2412, 4371));
  runTicks(3);
  assert.equal(awake.has(dying), false, "a dying one is let go");
});

test("zygomites: Pick on another Fungi is left to other plugins", () => {
  const other = createCrab(533, 2400, 4400);
  assert.equal(pick({ player: createPlayer(2400, 4401), npc: other }), false);
});

test("zygomites: out of combat it walks home and is a cap again, healed, with no sink animation (ours)", () => {
  const cap = createCrab(536, 2419, 4467);
  wake(cap, createPlayer(2419, 4466));
  runTicks(2);
  cap.setHitpoints(10);
  cap.log.length = 0;
  runTicks(20);
  assert.deepEqual(cap.log, []);
  runTicks();
  assert.equal(cap.getId(), 536);
  assert.equal(cap.getHitpoints(), cap.getMaxHitpoints());
});
