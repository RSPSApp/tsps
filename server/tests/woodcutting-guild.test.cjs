// Run after `yarn build`: node --test tests/woodcutting-guild.test.cjs
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
const { World } = require("../dist/game/World");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const ObstacleRunner = require("../plugins/skills/agility/ObstacleRunner");
const Guild = require("../plugins/skills/woodcutting/Guild.Woodcutting");
const EntTrunk = require("../plugins/skills/woodcutting/EntTrunk.Woodcutting");
const Shrine = require("../plugins/skills/woodcutting/Shrine.Woodcutting");
const GuildData = require("../plugins/skills/woodcutting/GuildData.Woodcutting");

const core = PluginManager.getCoreApi();
const events = [];
const placed = [];
const api = new Proxy({
  core,
  getTaskManager: () => TaskManager,
  emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
}, { get: (target, key) => target[key] ?? (() => {}) });
const helpers = {
  findBestUsableAxe: (player) => (player.axe ? { id: 6739, tier: 7, animationId: 2846 } : null),
  calculateCutChance: () => 1,
  lumberjackXpMultiplier: () => 1,
  maybeDropBirdNest: () => {},
};
let DATA = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObstacleRunner.init(api);
  Guild.attach(api);
  EntTrunk.attach(api, helpers);
  Shrine.attach(api);
  DATA = GuildData.load(core);
  core.ObjectManager.register = (object) => placed.push({ id: object.getId(), x: object.getLocation().getX(), y: object.getLocation().getY(), face: object.getFace() });
  core.ObjectManager.deregister = (object) => placed.push({ removed: object.getId() });
});

beforeEach(() => {
  events.length = 0;
  placed.length = 0;
});

function createPlayer(x, y, { level = 99, items = [], axe = true, npcs = [] } = {}) {
  const log = [];
  const attributes = new Map();
  const inventory = items.map((id) => ({ getId: () => id, getAmount: () => 1 }));
  let location = new Location(x, y, 0);
  const sender = new Proxy({}, { get: (_t, method) => (...args) => {
    if (method === "sendSound") log.push(`sound ${args[0]}`);
    return sender;
  } });
  const flags = new Set();
  const player = {
    log, axe, attributes, flags,
    setFlag: (flag, on = true) => (on ? flags.add(flag) : flags.delete(flag)),
    hasFlag: (flag) => flags.has(flag),
    isPlayer: () => true,
    getHitpoints: () => 99,
    isRegistered: () => true,
    getLocation: () => location,
    setLocation: (to) => { location = to; },
    moveTo: (to) => { location = to; log.push(`move ${to.getX()},${to.getY()}`); },
    getLocalNpcs: () => npcs,
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log.push(message),
    performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
    setWalkingDirection() {},
    setSkillAnimation() {},
    setForceMovement() {},
    getForceMovement: () => null,
    getUpdateFlag: () => ({ flag() {} }),
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {}, handleRegionChange() {} }),
    getSkillManager: () => ({
      getCurrentLevel: () => level,
      getMaxLevel: () => level,
      addExperiences: (skill, xp) => log.push(`xp ${skill.getName?.() ?? skill} ${xp}`),
    }),
    getInventory: () => ({
      get: (slot) => inventory[slot],
      setItem: (slot, item) => { inventory[slot] = item; },
      refreshItems() {},
      getFreeSlots: () => 28 - inventory.length,
      contains: (id) => inventory.some((item) => item.getId() === id),
      adds: (id, amount) => inventory.push({ getId: () => id, getAmount: () => amount }),
      items: inventory,
    }),
  };
  return player;
}

const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };
const gate = (player, x, y, objectId = 28851) => {
  const request = { player, objectId, location: { x, y, z: 0 }, handled: false };
  Guild.guildGate(request);
  return request;
};

test("the data: every id as the cache names it", () => {
  const loc = (id) => CacheDefinitions.getObject(id).name;
  const npc = (id) => CacheDefinitions.getNpc(id).name;
  const item = (id) => CacheDefinitions.getItem(id).name;
  assert.deepEqual(DATA.gates.ids.map(loc), ["Gate", "Gate"]);
  assert.deepEqual([loc(DATA.cave.id), loc(DATA.vine.id), loc(DATA.shrine.id)], ["Cave", "Vine", "Shrine"]);
  assert.deepEqual(DATA.roots.ids.map(loc), ["Root", "Root"]);
  assert.equal(npc(DATA.gates.guard), "Berry");
  for (const id of Object.keys(DATA.ents.npcs)) assert.equal(npc(Number(id)), "Ent");
  assert.ok(npc(DATA.ents.trunk).includes("Ent trunk"));
  for (const log of DATA.ents.logs) assert.equal(item(log.id), log.name);
  for (const id of Object.keys(DATA.shrine.eggs)) assert.equal(item(Number(id)), "Bird's egg");
  assert.equal(item(DATA.shrine.nest), "Bird nest");
  assert.deepEqual(DATA.shrine.evilChicken.pieces.map(item).sort(), ["Evil chicken feet", "Evil chicken head", "Evil chicken legs", "Evil chicken wings"]);
});

test("as captured: Ents attack (12506), block (12504) and die (12508) with their own animations", () => {
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  new NpcDefinitionLoader().load();
  for (const id of Object.keys(DATA.ents.npcs)) {
    const definition = core.NpcDefinition.forId(Number(id));
    assert.deepEqual([definition.getAttackAnim(), definition.getDefenceAnim(), definition.getDeathAnim(), definition.getDeathSound()], [12506, 12504, 12508, 824]);
  }
});

test("as captured: the east gate - refused below 60; at 60 the gates open, the guard welcomes, the player steps in, the gates shut", () => {
  const low = createPlayer(1658, 3505, { level: 59 });
  assert.equal(gate(low, 1657, 3505).handled, true);
  assert.deepEqual(low.log, ["You need a Woodcutting level of 60 to enter the Woodcutting Guild."]);

  const said = [];
  const berry = { getId: () => 7235, getLocation: () => new Location(1657, 3506, 0), forceChat: (text) => said.push(text) };
  const player = createPlayer(1658, 3505, { npcs: [berry] });
  assert.equal(gate(player, 1657, 3505).handled, true);
  runTicks();
  assert.deepEqual(placed.slice(0, 4), [
    { id: 38848, x: 1657, y: 3504, face: 2 }, { id: 28854, x: 1658, y: 3504, face: 3 },
    { id: 38848, x: 1657, y: 3505, face: 2 }, { id: 28853, x: 1658, y: 3505, face: 1 },
  ]);
  assert.ok(player.log.includes("sound 62"));
  assert.deepEqual(said, ["Welcome to the Woodcutting Guild, adventurer."]);
  assert.equal(player.getLocation().getX(), 1657, "one step in");
  assert.deepEqual(events.map((event) => event.task), ["enter-the-woodcutting-guild"]);
  runTicks(2);
  assert.deepEqual(placed.slice(-4).map((entry) => entry.removed ?? entry.id), [28854, 28853, 28852, 28851]);
});

test("leaving needs no level, and the west gate opens inwards", () => {
  const leaving = createPlayer(1657, 3504, { level: 1 });
  gate(leaving, 1657, 3504, 28852);
  runTicks(2);
  assert.equal(leaving.getLocation().getX(), 1658);
  assert.deepEqual(events, [], "only going in counts for the diary");
  const west = createPlayer(1562, 3488);
  gate(west, 1562, 3488);
  runTicks(2);
  assert.equal(west.getLocation().getX(), 1563);
  assert.ok(placed.some((entry) => entry.id === 28853 && entry.x === 1563));
});

test("as captured: the cave, the vine and the roots", () => {
  const player = createPlayer(1601, 3507);
  assert.equal(Guild.enterCave({ player, objectId: 28855 }), true);
  runTicks();
  assert.deepEqual(player.log, ["move 1596,9900"]);
  player.log.length = 0;
  Guild.climbVine({ player, objectId: 28856 });
  assert.deepEqual(player.log, ["anim 828"]);
  runTicks();
  assert.deepEqual(player.log.at(-1), "move 1606,3508");

  const hopper = createPlayer(1590, 9899);
  Guild.stepOverRoot({ player: hopper, objectId: 26721, location: { x: 1589, y: 9899, z: 0 } });
  assert.ok(hopper.log.includes("sound 2461") && hopper.log.includes("anim 1603"));
  runTicks(3);
  assert.deepEqual([hopper.getLocation().getX(), hopper.getLocation().getY()], [1588, 9899]);

  // The root's other half (26720) works too.
  const other = createPlayer(1588, 9900);
  Guild.stepOverRoot({ player: other, objectId: 26720, location: { x: 1589, y: 9900, z: 0 } });
  runTicks(3);
  assert.deepEqual([other.getLocation().getX(), other.getLocation().getY()], [1590, 9900]);
});

function deadEnt(id, killer) {
  let transform = -1;
  const npc = { getId: () => (transform >= 0 ? transform : id), setNpcTransformationId: (value) => { transform = value; }, isRegistered: () => true, transform: () => transform };
  const event = { killer, npc, npcId: id, remains: null };
  EntTrunk.entDied(event);
  return { npc, event };
}

test("as captured: a dead Ent stays, becomes its trunk, and only its killer chops it for noted logs", () => {
  const killer = createPlayer(1590, 9890);
  const { npc, event } = deadEnt(7234, killer);
  assert.deepEqual(event.remains, { ticks: 103, respawnTicks: 50 }, "trunk 4 ticks after the fall, for 101 ticks, then 50 to respawn");
  runTicks(2);
  assert.equal(npc.getId(), 9474);

  const other = createPlayer(1590, 9890);
  EntTrunk.chopTrunk({ player: other, npc });
  assert.deepEqual(other.log, [], "someone else's trunk");

  const noAxe = createPlayer(1590, 9890, { axe: false });
  EntTrunk.trunks.get(npc).killer = noAxe;
  EntTrunk.chopTrunk({ player: noAxe, npc });
  assert.deepEqual(noAxe.log, ["You don't have an axe which you can use."]);

  EntTrunk.trunks.get(npc).killer = killer;
  EntTrunk.chopTrunk({ player: killer, npc });
  assert.deepEqual(killer.log, ["You swing your axe at the Ent trunk.", "anim 2846"]);
  assert.equal(killer.hasFlag("combat:no-retaliate"), true, "being attacked doesn't stop the chopping");
  runTicks(3);
  const yields = killer.log.filter((line) => line.startsWith("The ent carcass yields: 1 x "));
  assert.equal(yields.length, 1);
  assert.ok(killer.log.includes("xp Woodcutting 25"));
  const logIds = killer.getInventory().items.map((item) => item.getId());
  assert.ok([1514, 1516, 1518, 1520, 1522].includes(logIds[0]), "a noted log");
  killer.setLocation(new Location(1591, 9890, 0));
  runTicks();
  assert.equal(killer.hasFlag("combat:no-retaliate"), false, "walking off ends it, and retaliation is back");
});

test("a Wilderness Ent's trunk gives two logs a success, and respawns 15 ticks after", () => {
  const killer = createPlayer(3300, 3700);
  const { npc, event } = deadEnt(6594, killer);
  assert.equal(event.remains.respawnTicks, 15);
  runTicks(2);
  EntTrunk.chopTrunk({ player: killer, npc });
  runTicks(3);
  assert.ok(killer.log.some((line) => line.startsWith("The ent carcass yields: 2 x ")));
  assert.equal(killer.getInventory().items[0].getAmount(), 2);
  EntTrunk.sessions.clear();
});

test("logs follow base level (Wiki): no plain logs from 45, yew from 61, magic from 75", () => {
  const axe = { tier: 7 };
  const seen = (level) => new Set(Array.from({ length: 400 }, () => EntTrunk.rollLog(level, axe).name));
  const low = seen(40);
  assert.ok(low.has("Logs") && !low.has("Maple logs") && !low.has("Yew logs"));
  const mid = seen(70);
  assert.ok(!mid.has("Logs") && mid.has("Yew logs") && !mid.has("Magic logs"));
  assert.ok(seen(99).has("Magic logs"));
});

test("as captured: an egg on the shrine becomes a seed nest, with the offering count, the projectile and 100 Prayer XP", () => {
  const sent = [];
  const send = core.Projectile.prototype.sendProjectile;
  core.Projectile.prototype.sendProjectile = function () { sent.push(this); };
  try {
    const player = createPlayer(1613, 3512, { items: [5076, 5078] });
    const offer = (slot, itemId) => Shrine.offerEgg({ player, objectId: 29088, itemId, itemSlot: slot, location: { x: 1612, y: 3513, z: 0 } });
    offer(0, 5076);
    offer(1, 5078);
    const items = player.getInventory().items.map((item) => item.getId());
    assert.ok(items.every((id) => id === 22798 || DATA.shrine.evilChicken.pieces.includes(id)));
    assert.deepEqual(player.log.filter((line) => line.startsWith("You ")), [
      "You offer your bird's egg to the shrine and receive a reward.", "You have made <col=ff0000>one</col> offering.",
      "You offer your bird's egg to the shrine and receive a reward.", "You have made <col=ff0000>2</col> offerings.",
    ]);
    assert.ok(player.log.includes("xp Prayer 100") && player.log.includes("anim 3705") && player.log.includes("sound 3047"));
    assert.equal(sent.length, 2);
  } finally {
    core.Projectile.prototype.sendProjectile = send;
  }
});

test("chopping a redwood counts for Kourend & Kebos elite; other logs don't", () => {
  const player = createPlayer(1570, 3485);
  Guild.redwoodChopped({ player, logId: 1513 });
  Guild.redwoodChopped({ player, logId: 19669 });
  assert.deepEqual(events.map((event) => event.task), ["chop-some-redwood-logs"]);
});

test("core: an npc whose death handler leaves remains stays, then goes and respawns", () => {
  const hooks = PluginManager.npcDeathHooks;
  const removed = World.getRemoveNPCQueue();
  const before = removed.length;
  const respawned = [];
  const submit = TaskManager.submit;
  const killer = createPlayer(1590, 9890);
  const npc = {
    getMovementQueue: () => ({ setBlockMovement() { return { reset() {} }; } }),
    getCombat: () => ({ getKiller: () => killer, reset() {}, setUnderAttack() {} }),
    performAnimation() {},
    getCurrentDefinition: () => ({ getDeathAnim: () => 12508, getDeathSound: () => 0, getDeathTicks: () => 2 }),
    getDefinition: () => ({ getRespawn: () => 25 }),
    setMobileInteraction() {},
    getId: () => 7234,
    getLocation: () => new Location(1590, 9890, 0),
    getArea: () => null,
    setDying() {},
    setNpcTransformationId() {},
    clone() { return this; },
  };
  hooks.push({ pluginName: "test", handler: (event) => { if (event.npc === npc) event.remains = { ticks: 5, respawnTicks: 50 }; } });
  TaskManager.submit = (task) => { if (task.constructor.name === "NPCRespawnTask") respawned.push(task); submit(task); };
  try {
    TaskManager.submit(new NPCDeathTask(npc));
    runTicks(4);
    assert.equal(removed.length, before, "still there as remains");
    runTicks(5);
    assert.equal(removed.at(-1), npc);
    assert.equal(respawned.length, 1);
  } finally {
    hooks.pop();
    TaskManager.submit = submit;
  }
});
