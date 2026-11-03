// Run after `yarn build`: node --test tests/pest-control-bots.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Skill } = require("../dist/game/model/Skill");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { GameConstants } = require("../dist/game/GameConstants");
const { decodePluginMessagePayload } = require("../dist/net/protocol/ClientProtocol");
const plugin = require("../plugins/minigames/PestControl.plugin");
const Rewards = require("../plugins/minigames/pestcontrol/Rewards.PestControl");
const Bots = require("../plugins/minigames/pestcontrol/Bots.PestControl");

const { ROLES, assignRoles, equipRepairer } = Bots;
const {
  PestControlBot, squadPortal, chooseDefenderTarget, reachesOverWalls, chooseAttackTarget, nearestDamagedStructure,
  gateFor, gateClosed, gateOpen, repairerPost, optionIndex, trackProgress, insideFort, GATES, STUCK_TIMEOUT_MS, REPAIR_LOGS,
} = Bots._test;

const GAME_START = new Location(2657, 2611, 0);
const KNIGHT = new Location(2656, 2592, 0);
const SHIELD_ORDER = ["blue", "red", "yellow", "purple"];
const PORTAL_SPAWNS = { purple: [2631, 2592], blue: [2679, 2589], yellow: [2670, 2573], red: [2646, 2572] };

let objectHandler = null;
const npcHandlers = {};
const buttonHandlers = new Map();
const emitted = [];
const api = {
  core: PluginManager.getCoreApi(),
  registerShopCurrency() {},
  registerDefinitionSource() {},
  registerNpcCombatMethodProvider() {},
  getAreaManager: () => ({ areas: [] }),
  getObjectManager: () => ObjectManager,
  getRegionManager: () => RegionManager,
  getWorld: () => World,
  onPlayerLogin() {},
  onObjectInteraction(handler) { objectHandler = handler; },
  onNpcInteraction(name, options) { npcHandlers[name] = options; },
  onInterfaceActionButton(uid, handler) { buttonHandlers.set(uid, handler); },
  onCanAttack() {},
  onPlayerDealtDamage() {},
  onNpcDeath() {},
  onPlayerDeath() {},
  onShouldDropItemsOnDeath() {},
  onCanTeleport() {},
  onSpellDisabled() {},
  emitObjectInteraction(event) {
    emitted.push(event);
    objectHandler?.(event);
    return event.handled === true;
  },
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  RegionManager.loadMapFiles(2656, 2592);
  plugin.register(api);
});

function realPlayer(location, { bot = true } = {}) {
  const player = new Player(null);
  // Chainable: core sends `sender.sendVarbit(...).sendVarbit(...)`.
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.setLocation(location.clone());
  if (bot) player.setPlayerBot(true);
  return player;
}

function area() {
  return { token: "match-area" };
}

function fakeNpc({ x, y, type = "shifter", portal = "purple", hp = 10, area: privateArea, target = null, pending = false }) {
  const npc = {
    __pcType: type,
    __pcPortal: portal,
    getLocation: () => new Location(x, y, 0),
    getHitpoints: () => hp,
    isRegistered: () => true,
    getPrivateArea: () => privateArea,
    getCombat: () => ({ getTarget: () => target }),
    pending,
  };
  return npc;
}

function fakeKnight(privateArea, npcs) {
  return {
    __pcKind: "knight",
    getLocation: () => KNIGHT.clone(),
    getHitpoints: () => 200,
    getPrivateArea: () => privateArea,
    getCombat: () => ({
      getAttacker: () => npcs.find((npc) => npc.pending === "attacker") ?? null,
      getHitQueue: () => ({ hasPendingHitFrom: (npc) => npc.pending === true }),
    }),
  };
}

function portalState(key, { shielded = true, dead = false, hp = 200 } = {}) {
  const [spawnX, spawnY] = PORTAL_SPAWNS[key];
  const at = { purple: [2628, 2591], blue: [2680, 2588], yellow: [2669, 2570], red: [2645, 2569] }[key];
  return {
    key, shielded, dead, spawnX, spawnY,
    npc: { __pcKind: "portal", getLocation: () => new Location(at[0], at[1], 0), getHitpoints: () => hp },
  };
}

function portals(options = {}) {
  return new Map(SHIELD_ORDER.map((key) => [key, portalState(key, options[key] ?? {})]));
}

function gatePart(group, x, y, { open = false, damage = 0 } = {}) {
  const location = new Location(x, y, 0);
  return {
    kind: "gate", group, open, damage, maxDamage: 3,
    baseLocation: location,
    object: { getId: () => 14233, getLocation: () => location, getType: () => 0 },
  };
}

function fortStructures(overrides = {}) {
  const structures = new Map();
  const add = (key, part) => structures.set(key, part);
  add("w1", gatePart("west", 2643, 2592, overrides.west));
  add("w2", gatePart("west", 2643, 2593, overrides.west));
  add("e1", gatePart("east", 2670, 2592, overrides.east));
  add("e2", gatePart("east", 2670, 2593, overrides.east));
  add("s1", gatePart("south", 2656, 2585, overrides.south));
  add("s2", gatePart("south", 2657, 2585, overrides.south));
  return structures;
}

/** A match stand-in with just what the bot reads. */
function fakeMatch({ players = [], npcs = [], structures = fortStructures(), portalMap = portals(), privateArea = area() } = {}) {
  const match = {
    area: privateArea,
    npcs: new Set(npcs),
    players: new Map(players.map((player) => [player, {}])),
    structures,
    portals: portalMap,
    portalByNpc: new Map([...portalMap.values()].map((portal) => [portal.npc, portal])),
    shieldOrder: [...SHIELD_ORDER],
    knightLocation: () => [KNIGHT.getX(), KNIGHT.getY()],
  };
  match.knight = fakeKnight(privateArea, npcs);
  return match;
}

function botFor(match, player, assignment) {
  player.getPrivateArea = () => match.area;
  const bot = new PestControlBot(match, api, player, assignment);
  return bot;
}

function lastPoint(player) {
  const points = player.getMovementQueue().points.toArray();
  const last = points[points.length - 1];
  return last ? [last.position.getX(), last.position.getY()] : null;
}

// --- Roles -------------------------------------------------------------------------------

test("five bots: one defender and an attacker for every squad", () => {
  const roles = assignRoles(5);
  assert.equal(roles.length, 5);
  assert.equal(roles.filter((r) => r.role === ROLES.DEFENDER).length, 1);
  assert.equal(roles.filter((r) => r.role === ROLES.REPAIRER).length, 0);
  const squads = roles.filter((r) => r.role === ROLES.ATTACKER).map((r) => r.squad).sort();
  assert.deepEqual(squads, [0, 1, 2, 3]);
});

test("twenty-five bots: four defenders, two repairers, attackers spread over the squads", () => {
  const roles = assignRoles(25);
  assert.equal(roles.length, 25);
  assert.equal(roles.filter((r) => r.role === ROLES.DEFENDER).length, 4);
  assert.equal(roles.filter((r) => r.role === ROLES.REPAIRER).length, 2);
  const attackers = roles.filter((r) => r.role === ROLES.ATTACKER);
  assert.equal(attackers.length, 19);
  for (let squad = 0; squad < 4; squad++) {
    assert.ok(attackers.filter((r) => r.squad === squad).length >= 4, `squad ${squad} is manned`);
  }
  assert.deepEqual(new Set(roles.filter((r) => r.role === ROLES.DEFENDER).map((r) => r.post)).size, 4, "defenders take distinct posts");
});

test("a lone bot attacks, two bots split defender and attacker, none yields nothing", () => {
  assert.deepEqual(assignRoles(1).map((r) => r.role), [ROLES.ATTACKER]);
  assert.deepEqual(assignRoles(2).map((r) => r.role).sort(), [ROLES.ATTACKER, ROLES.DEFENDER]);
  assert.deepEqual(assignRoles(0), []);
});

// --- Portal choice -----------------------------------------------------------------------

test("each squad takes its portal in shield order and moves on when portals die", () => {
  const all = portals();
  SHIELD_ORDER.forEach((key, squad) => assert.equal(squadPortal(all, SHIELD_ORDER, squad).key, key));
  const twoDown = portals({ blue: { dead: true }, red: { dead: true } });
  assert.deepEqual([0, 1, 2, 3].map((squad) => squadPortal(twoDown, SHIELD_ORDER, squad).key), ["yellow", "purple", "yellow", "purple"]);
  const allDown = portals({ blue: { dead: true }, red: { dead: true }, yellow: { dead: true }, purple: { dead: true } });
  assert.equal(squadPortal(allDown, SHIELD_ORDER, 0), null);
});

test("an attacker outside kills the portal's spinner first, then the unshielded portal, then nearby pests", () => {
  const privateArea = area();
  const outsideWest = { getLocation: () => new Location(2634, 2592, 0) };
  const spinner = fakeNpc({ x: 2630, y: 2593, type: "spinner", portal: "purple", area: privateArea });
  const otherSpinner = fakeNpc({ x: 2633, y: 2592, type: "spinner", portal: "blue", area: privateArea });
  const shifter = fakeNpc({ x: 2636, y: 2592, type: "shifter", area: privateArea });
  const farPest = fakeNpc({ x: 2650, y: 2592, type: "ravager", area: privateArea });
  const knight = fakeKnight(privateArea, []);
  const npcs = [knight, otherSpinner, shifter, farPest, spinner];

  const shielded = portalState("purple", { shielded: true });
  assert.equal(chooseAttackTarget(outsideWest, shielded, npcs, privateArea), spinner, "its own portal's spinner, not another portal's");
  const open = portalState("purple", { shielded: false });
  assert.equal(chooseAttackTarget(outsideWest, open, [knight, shifter, farPest], privateArea), open.npc, "the portal once its shield is down");
  assert.equal(chooseAttackTarget(outsideWest, shielded, [knight, shifter, farPest], privateArea), shifter, "a pest in reach while the shield is up");
  assert.equal(chooseAttackTarget(outsideWest, shielded, [knight, farPest], privateArea), null, "nothing within six tiles");
  const dead = portalState("purple", { shielded: false, dead: true });
  assert.equal(chooseAttackTarget(outsideWest, dead, [knight], privateArea), null, "a dead portal is no target");

  // A torcher burning the bot from nine tiles: nothing nearer, so hit back rather than
  // reset the retaliation every tick.
  const torcher = fakeNpc({ x: 2625, y: 2592, type: "torcher", area: privateArea });
  const burnt = { getLocation: () => new Location(2634, 2592, 0), getCombat: () => ({ getAttacker: () => torcher }) };
  assert.equal(chooseAttackTarget(burnt, shielded, [knight, torcher, farPest], privateArea), torcher, "the pest hitting the bot");
  assert.equal(chooseAttackTarget(burnt, shielded, [knight, torcher, shifter], privateArea), shifter, "but a pest in reach first");
  const insideAttacker = fakeNpc({ x: 2650, y: 2592, type: "torcher", area: privateArea });
  const burntFromInside = { getLocation: () => new Location(2634, 2592, 0), getCombat: () => ({ getAttacker: () => insideAttacker }) };
  assert.equal(chooseAttackTarget(burntFromInside, shielded, [knight, insideAttacker], privateArea), null, "never one inside the fort");
});

test("an attacker inside the fort fights nothing: it heads for the gate", () => {
  const privateArea = area();
  const inside = { getLocation: () => new Location(2650, 2595, 0) };
  const shifter = fakeNpc({ x: 2652, y: 2594, type: "shifter", area: privateArea });
  assert.equal(chooseAttackTarget(inside, portalState("purple", { shielded: false }), [shifter], privateArea), null);
});

// --- Defenders ---------------------------------------------------------------------------

test("a defender picks the pest hitting the knight over a nearer idle one, and never the knight, squire or a portal", () => {
  const privateArea = area();
  const attacker = fakeNpc({ x: 2664, y: 2592, type: "torcher", area: privateArea, pending: true });
  attacker.getCombat = () => ({ getTarget: () => knight });
  const idle = fakeNpc({ x: 2658, y: 2592, type: "brawler", area: privateArea });
  const squire = { __pcKind: "squire", getLocation: () => new Location(2655, 2593, 0), getHitpoints: () => 50, isRegistered: () => true, getPrivateArea: () => privateArea };
  const portal = portalState("purple", { shielded: false }).npc;
  const knight = fakeKnight(privateArea, [attacker]);
  const npcs = [knight, squire, portal, idle, attacker];
  assert.equal(chooseDefenderTarget(knight, npcs), attacker);
  assert.equal(chooseDefenderTarget(knight, [knight, squire, portal, idle]), idle, "an approaching pest when nobody hits the knight");
  assert.equal(chooseDefenderTarget(knight, [knight, squire, portal]), null, "never the Void Knights or a portal");
  const far = fakeNpc({ x: 2640, y: 2592, type: "shifter", area: privateArea });
  assert.equal(chooseDefenderTarget(knight, [far]), null, "a pest outside the fort and out of range is left alone");
});

test("a melee defender leaves a torcher shooting the knight over the wall to the attackers; a mage takes it", () => {
  const privateArea = area();
  // South wall is y 2585; a torcher three tiles beyond it still reaches the knight (range 10).
  const torcher = fakeNpc({ x: 2656, y: 2582, type: "torcher", area: privateArea, pending: true });
  const inside = fakeNpc({ x: 2660, y: 2594, type: "brawler", area: privateArea });
  const knight = fakeKnight(privateArea, [torcher]);
  torcher.getCombat = () => ({ getTarget: () => knight });
  const npcs = [knight, torcher, inside];
  assert.equal(chooseDefenderTarget(knight, npcs), torcher, "unrestricted: the pest hitting the knight");
  const melee = (npc) => insideFort(npc.getLocation());
  assert.equal(chooseDefenderTarget(knight, npcs, Math.random, melee), inside, "melee: the brawler inside instead");
  assert.equal(chooseDefenderTarget(knight, [knight, torcher], Math.random, melee), null, "melee, nothing inside: hold the post");

  const player = realPlayer(new Location(2655, 2593, 0));
  const match = fakeMatch({ players: [player], npcs: [torcher], privateArea });
  torcher.getCombat = () => ({ getTarget: () => match.knight });
  const bot = botFor(match, player, { role: ROLES.DEFENDER, squad: null, post: 0 });
  const calls = [];
  let current = null;
  const combat = player.getCombat();
  combat.getTarget = () => current;
  combat.reset = () => { calls.push("reset"); current = null; };
  bot.attack = (target) => { calls.push("attack"); current = target; return "running"; };
  assert.equal(reachesOverWalls(player), false, "an unarmed bot punches");
  assert.equal(bot.defend({ nowMs: 1000 }), "failure", "a melee defender does not walk to the wall after it");
  assert.deepEqual(calls, []);
  current = torcher;
  assert.equal(bot.defend({ nowMs: 2000 }), "failure", "and drops it if auto-retaliate picked it up");
  assert.deepEqual(calls, ["reset"]);

  combat.setCastSpell({ spellId: () => 1 });
  assert.equal(reachesOverWalls(player), true, "a caster reaches over the wall");
  assert.equal(bot.defend({ nowMs: 3000 }), "running");
  assert.deepEqual(calls, ["reset", "attack"]);
  combat.setCastSpell(null);
});

test("a bot at 0 hp does nothing: no target, no walk", () => {
  const player = realPlayer(GAME_START);
  const match = fakeMatch({ players: [player] });
  const bot = botFor(match, player, { role: ROLES.ATTACKER, squad: 0, post: 0 });
  player.setHitpoints(0);
  assert.equal(bot.tick(1000), "failure");
  assert.equal(player.getMovementQueue().size(), 0);
  assert.equal(bot.state.destinationKey, null);
});

// --- Gates, walking and stuck handling -------------------------------------------------------

test("gates: the nearest gate per portal, rotated by detours; closed, open and wrecked states", () => {
  assert.equal(gateFor("purple"), "west");
  assert.equal(gateFor("blue"), "east");
  assert.equal(gateFor("yellow"), "south");
  assert.equal(gateFor("red"), "south");
  assert.equal(gateFor("purple", 1), "south");
  assert.equal(gateFor("purple", 2), "east");
  assert.equal(gateFor("purple", 3), "west");
  const closed = [gatePart("west", 2643, 2592), gatePart("west", 2643, 2593)];
  assert.equal(gateClosed(closed), true);
  assert.equal(gateOpen(closed), false);
  const open = [gatePart("west", 2643, 2592, { open: true }), gatePart("west", 2643, 2593, { open: true })];
  assert.equal(gateClosed(open), false);
  assert.equal(gateOpen(open), true);
  const wrecked = [gatePart("west", 2643, 2592, { damage: 3 }), gatePart("west", 2643, 2593, { damage: 3 })];
  assert.equal(gateClosed(wrecked), false, "a wrecked gate is passable");
  assert.equal(gateOpen(wrecked), false, "and needs no closing");
  assert.equal(insideFort(GAME_START), true);
  assert.equal(insideFort(KNIGHT), true);
  assert.equal(insideFort(new Location(2642, 2592, 0)), false);
  assert.equal(insideFort(new Location(2631, 2592, 0)), false);
  for (const gate of ["west", "east", "south"]) {
    for (let index = 0; index < 6; index++) {
      const [x, y] = repairerPost(gate, index);
      assert.equal(insideFort(new Location(x, y, 0)), false, `repairer post ${gate}/${index} is outside`);
      assert.ok(Math.max(Math.abs(x - GATES[gate].outside[0]), Math.abs(y - GATES[gate].outside[1])) >= 3, "and clear of the gateway");
    }
  }
  assert.deepEqual(repairerPost("south", 1), [2654, 2581]);
});

test("an attacker inside walks to its gate, opens it when adjacent, then walks out to its staging tile", () => {
  emitted.length = 0;
  const player = realPlayer(GAME_START);
  const match = fakeMatch({ players: [player], portalMap: portals() });
  const bot = botFor(match, player, { role: ROLES.ATTACKER, squad: 3, post: 0 }); // squad 3 -> purple -> west gate
  const movement = player.getMovementQueue();

  assert.equal(bot.goOut({ nowMs: 1000 }, bot.stagingTile()), "running");
  assert.ok(movement.size() > 0, "a route is queued");
  assert.deepEqual(lastPoint(player), GATES.west.inside, "towards the west gate's inside tile");
  assert.equal(emitted.length, 0, "no click from afar");

  player.setLocation(new Location(...GATES.west.inside, 0));
  movement.reset();
  assert.equal(bot.goOut({ nowMs: 2000 }, bot.stagingTile()), "running");
  assert.equal(emitted.length, 1, "the gate is clicked once adjacent");
  assert.equal(emitted[0].clickType, 1);
  assert.equal(emitted[0].object.getLocation().getY(), 2592, "the nearest leaf");
  assert.equal(bot.goOut({ nowMs: 2500 }, bot.stagingTile()), "running");
  assert.equal(emitted.length, 1, "no second click inside the cooldown");

  for (const part of match.structures.values()) if (part.group === "west") part.open = true;
  movement.reset();
  assert.equal(bot.goOut({ nowMs: 4000 }, bot.stagingTile()), "running");
  assert.equal(emitted.length, 1, "an open gate is not clicked again");
  const staging = bot.stagingTile();
  // The fake gate leaves the map's clipping shut, so the pather has nowhere nearer to go
  // than the bot's own tile; the destination it was asked for is what matters here.
  assert.equal(bot.state.destinationKey, `${staging[0]},${staging[1]}`, "walks on towards the staging tile");
  assert.ok(Math.max(Math.abs(staging[0] - 2631), Math.abs(staging[1] - 2592)) <= 3, `staging beside the purple portal's spawn (${staging})`);
  assert.equal(bot.state.gateToClose, "west");
});

test("a bot outside closes the gate behind it unless a teammate is about to pass", () => {
  emitted.length = 0;
  const player = realPlayer(new Location(...GATES.west.outside, 0));
  const teammate = realPlayer(new Location(2645, 2592, 0));
  const match = fakeMatch({ players: [player, teammate], structures: fortStructures({ west: { open: true } }) });
  const bot = botFor(match, player, { role: ROLES.ATTACKER, squad: 3, post: 0 });
  bot.state.gateToClose = "west";

  bot.closeGateBehind({ nowMs: 1000 });
  assert.equal(emitted.length, 0, "a teammate two tiles inside the gate keeps it open");
  assert.equal(bot.state.gateToClose, "west");

  teammate.setLocation(new Location(2650, 2600, 0));
  bot.closeGateBehind({ nowMs: 2000 });
  assert.equal(emitted.length, 1, "closed once the way is clear");
  assert.equal(emitted[0].clickType, 1);
  assert.equal(bot.state.gateToClose, null);

  bot.state.gateToClose = "west";
  player.setLocation(new Location(2635, 2592, 0));
  bot.closeGateBehind({ nowMs: 3000 });
  assert.equal(emitted.length, 1, "too far away: gives up instead of walking back");
  assert.equal(bot.state.gateToClose, null);
});

test("object options come from the cache names, with the known slots as fallback", () => {
  const gate = { getDefinition: () => ({ getInteractions: () => [null, "Open", "Close", "Repair"] }) };
  assert.equal(optionIndex(gate, "open", 1), 2);
  assert.equal(optionIndex(gate, "close", 1), 3);
  assert.equal(optionIndex(gate, "repair", 3), 4);
  assert.equal(optionIndex({ getDefinition: () => null }, "repair", 3), 3, "no definition: the known slot");
  assert.equal(optionIndex({}, "open", 1), 1);
});

test("a defender keeps a fight that is still worth having and drops one that strayed", () => {
  const privateArea = area();
  const player = realPlayer(new Location(2655, 2593, 0));
  const nearPest = fakeNpc({ x: 2658, y: 2593, type: "brawler", area: privateArea });
  const strayed = fakeNpc({ x: 2640, y: 2600, type: "brawler", area: privateArea });
  const match = fakeMatch({ players: [player], npcs: [nearPest, strayed], privateArea });
  const bot = botFor(match, player, { role: ROLES.DEFENDER, squad: null, post: 0 });
  const calls = [];
  let current = null;
  const combat = player.getCombat();
  combat.getTarget = () => current;
  combat.reset = () => { calls.push("reset"); current = null; };
  bot.attack = (target) => { calls.push(`attack ${target.getLocation().getX()}`); current = target; return "running"; };

  assert.equal(bot.defend({ nowMs: 1000 }), "running");
  assert.deepEqual(calls, ["attack 2658"], "picks the pest closing on the knight");
  assert.equal(bot.defend({ nowMs: 2000 }), "running");
  assert.deepEqual(calls, ["attack 2658"], "keeps hitting it rather than re-choosing");

  current = strayed;
  assert.equal(bot.defend({ nowMs: 3000 }), "running");
  assert.deepEqual(calls, ["attack 2658", "attack 2658"], "a target far from the knight is swapped for a real threat");

  match.npcs.clear();
  current = null;
  assert.equal(bot.defend({ nowMs: 4000 }), "failure", "nothing to fight: hold the post");
});

test("a stuck walk takes a detour: another gate inside, another staging tile outside", () => {
  const player = realPlayer(GAME_START);
  const match = fakeMatch({ players: [player] });
  const bot = botFor(match, player, { role: ROLES.ATTACKER, squad: 3, post: 0 });
  const movement = player.getMovementQueue();

  assert.equal(bot.goOut({ nowMs: 1000 }, bot.stagingTile()), "running");
  movement.reset();
  assert.equal(bot.goOut({ nowMs: 1000 + STUCK_TIMEOUT_MS - 1 }, bot.stagingTile()), "running", "still patient");
  movement.reset();
  assert.equal(bot.goOut({ nowMs: 1000 + STUCK_TIMEOUT_MS + 1 }, bot.stagingTile()), "stuck");
  assert.equal(bot.state.detours, 1);
  movement.reset();
  assert.equal(bot.goOut({ nowMs: 1000 + STUCK_TIMEOUT_MS + 700 }, bot.stagingTile()), "running");
  assert.deepEqual(lastPoint(player), GATES.south.inside, "the next gate in the rotation");

  const before = bot.stagingTile();
  bot.state.detours += 1;
  assert.notDeepEqual(bot.stagingTile(), before, "a detour outside picks another staging tile");
});

test("progress tracking: a new destination or a new tile resets the clock", () => {
  const state = {};
  const at = (x, y) => new Location(x, y, 0);
  assert.equal(trackProgress(state, at(1, 1), "a", 0, false), false);
  assert.equal(trackProgress(state, at(1, 1), "a", STUCK_TIMEOUT_MS + 1, false), true, "no move, no new tile: stuck");
  assert.equal(trackProgress(state, at(1, 1), "a", STUCK_TIMEOUT_MS + 2, false), false, "the clock restarted");
  assert.equal(trackProgress(state, at(2, 1), "a", STUCK_TIMEOUT_MS * 2 + 10, false), false, "moving a tile counts as progress");
  assert.equal(trackProgress(state, at(2, 1), "b", STUCK_TIMEOUT_MS * 4, false), false, "a new destination starts afresh");
  assert.equal(trackProgress(state, at(2, 1), "b", STUCK_TIMEOUT_MS * 5 + 1, true), false, "a queued route is never stuck");
});

// --- Repairers ---------------------------------------------------------------------------

test("a repairer gets a hammer and logs within its free slots, and repairs on its side of the wall", () => {
  const player = realPlayer(new Location(...GATES.west.outside, 0));
  const inventory = player.getInventory();
  for (let slot = 0; slot < 20; slot++) inventory.adds(ItemIdentifiers.SHARK, 1);
  const logs = equipRepairer(player);
  assert.equal(inventory.contains(ItemIdentifiers.HAMMER), true);
  assert.equal(logs, 7, "28 slots less 20 sharks and the hammer");
  assert.equal(inventory.getAmount(ItemIdentifiers.LOGS), 7);
  assert.equal(inventory.getFreeSlots(), 0);

  const roomy = realPlayer(GAME_START);
  assert.equal(equipRepairer(roomy), REPAIR_LOGS);

  const structures = fortStructures({ west: { damage: 1 }, east: { damage: 2 } });
  structures.set("barricade", { kind: "barricade", group: null, open: false, damage: 1, maxDamage: 2, baseLocation: new Location(2636, 2589, 0), object: { getId: () => 14227, getLocation: () => new Location(2636, 2589, 0) } });
  const fromOutsideWest = nearestDamagedStructure(player.getLocation(), structures);
  assert.equal(fromOutsideWest.group, "west", "the gate leaf in arm's reach, not the far east gate");
  const fromInside = nearestDamagedStructure(new Location(2660, 2592, 0), structures);
  assert.equal(fromInside.group, "east", "inside, the damaged east gate; the outside barricade is behind the wall");
  const fromFarOutside = nearestDamagedStructure(new Location(2630, 2589, 0), structures);
  assert.equal(fromFarOutside.kind, "barricade", "outside, the barricade; the gates are reachable too but farther");
});

test("a repairer walks to the damaged structure and clicks Repair when adjacent", () => {
  emitted.length = 0;
  const player = realPlayer(new Location(2640, 2592, 0));
  equipRepairer(player);
  const match = fakeMatch({ players: [player], structures: fortStructures({ west: { damage: 1 } }) });
  const bot = botFor(match, player, { role: ROLES.REPAIRER, squad: 3, post: 0 });
  assert.equal(bot.repair({ nowMs: 1000 }), "running");
  assert.equal(emitted.length, 0);
  assert.ok(player.getMovementQueue().size() > 0, "walks towards the leaf");
  player.setLocation(new Location(...GATES.west.outside, 0));
  player.getMovementQueue().reset();
  assert.equal(bot.repair({ nowMs: 2000 }), "running");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].clickType, 3, "Repair");
  player.getInventory().delete(ItemIdentifiers.LOGS, 28);
  assert.equal(bot.repair({ nowMs: 4000 }), "failure", "out of logs: back to fighting");
});

// --- The real match -----------------------------------------------------------------------

test("a real match assigns roles, ticks every bot from its own tick, and drops a bot that leaves", () => {
  const boat = plugin._test.BOATS[0];
  const bots = [];
  for (let index = 0; index < 5; index++) bots.push(realPlayer(boat.waitingLocation));
  const human = realPlayer(boat.waitingLocation, { bot: false });
  const match = new plugin._test.PestControlMatch(boat, [...bots, human], () => {});
  try {
    assert.equal(match.bots.size, 5, "one controller per bot, none for the player");
    const roles = bots.map((bot) => bot.getAttribute(Bots.BOT_ROLE_ATTRIBUTE));
    assert.equal(roles.filter((role) => role === ROLES.DEFENDER).length, 1);
    assert.equal(roles.filter((role) => role === ROLES.ATTACKER).length, 4);
    for (const bot of bots) {
      assert.equal(bot.getPrivateArea(), match.area);
      assert.equal(bot.getLocation().getX(), GAME_START.getX());
    }

    match.processBots();
    for (const bot of bots) assert.equal(bot.getMovementQueue().size(), 0, "no route while the landing teleport is pending");
    // The update cycle lands the teleport; routes are only accepted after that.
    for (const bot of bots) bot.setNeedsPlacement(false);
    match.processBots();
    for (const bot of bots) {
      const role = bot.getAttribute(Bots.BOT_ROLE_ATTRIBUTE);
      const end = lastPoint(bot);
      assert.ok(bot.getMovementQueue().size() > 0, `${role} starts walking on the first tick`);
      if (role === ROLES.ATTACKER) {
        const gate = GATES[gateFor(squadPortal(match.portals, match.shieldOrder, bot.getAttribute(Bots.BOT_SQUAD_ATTRIBUTE)).key)];
        assert.deepEqual(end, gate.inside, "an attacker heads for its gate, not the knight");
      } else {
        assert.ok(Math.max(Math.abs(end[0] - KNIGHT.getX()), Math.abs(end[1] - KNIGHT.getY())) <= 3, "the defender takes a post beside the knight");
      }
    }
    const nearKnight = bots.filter((bot) => lastPoint(bot) && Math.abs(lastPoint(bot)[0] - KNIGHT.getX()) <= 2 && Math.abs(lastPoint(bot)[1] - KNIGHT.getY()) <= 2);
    assert.equal(nearKnight.length, 1, "only the defender huddles at the knight");

    const leaver = bots[0];
    match.area.leave(leaver, false);
    assert.equal(match.bots.has(leaver), false, "a bot that leaves loses its controller");
    assert.equal(match.players.has(leaver), false);
    assert.equal(match.bots.size, 4);
  } finally {
    for (const player of [...match.players.keys()]) {
      player.getForcedLogoutTimer = () => ({ start() {} });
      player.requestLogout = () => {};
    }
    match.finish(false, "test over");
  }
  assert.equal(match.bots.size, 0, "finishing forgets every controller");
});

// --- Void Knights' Reward Options ---------------------------------------------------------

const REWARD_INTERFACE = 243;
const CONFIRM_UID = (REWARD_INTERFACE << 16) | 6;
const POINTS_VARP = 261;

function rewardPlayer({ points = 1000, level = 99 } = {}) {
  const player = new Player(null);
  const calls = [];
  player.getSession = () => ({ sendClientPacket: (packet) => calls.push(["sendClientPacket", packet]) });
  // Records every send; sendInterface also marks the modal open, as the real PacketSender does.
  const sender = new Proxy({}, { get: (_, name) => (...args) => {
    calls.push([name, ...args]);
    if (name === "sendInterface") player.setInterfaceId(args[0]);
    return sender;
  } });
  player.getPacketSender = () => sender;
  player.setLocation(new Location(2656, 2650, 0));
  for (const skill of Skill.values()) {
    player.getSkillManager().setMaxLevels(skill, level, false);
    player.getSkillManager().setCurrentLevel(skill, level, false);
  }
  player.setAttribute(Rewards.POINTS_ATTRIBUTE, points);
  return { player, calls };
}

function exchangeAndConfirm(player, option) {
  npcHandlers["Void Knight"].Exchange({ player });
  buttonHandlers.get(CONFIRM_UID)({ player, buttonId: CONFIRM_UID, slot: option });
}

test("Exchange opens the cache's reward interface with the points varp and Confirm transmitting", () => {
  const { player, calls } = rewardPlayer({ points: 123 });
  npcHandlers["Void Knight"].Exchange({ player });
  assert.equal(player.getInterfaceId(), REWARD_INTERFACE);
  assert.deepEqual(calls.find(([name, id]) => name === "sendConfig" && id === POINTS_VARP), ["sendConfig", POINTS_VARP, 123]);
  assert.deepEqual(calls.find(([name]) => name === "sendInterfaceFlagsRange"), ["sendInterfaceFlagsRange", CONFIRM_UID, 0, 31, 1 << 1]);
});

test("XP rewards: floor(level^2/600) x 35/32/18 per point, +1% for 10 and +10% for 100", () => {
  const { xpPerPoint } = Rewards._test;
  assert.equal(xpPerPoint(0, 25), 35);
  assert.equal(xpPerPoint(4, 25), 32);
  assert.equal(xpPerPoint(5, 25), 18);
  assert.equal(xpPerPoint(0, 99), 560);

  const { player } = rewardPlayer({ points: 200 });
  const before = player.getSkillManager().getExperience(Skill.ATTACK);
  exchangeAndConfirm(player, 2); // Attack XP (+10%): 100 points
  assert.equal(player.getSkillManager().getExperience(Skill.ATTACK) - before, 61600);
  assert.equal(Rewards.getPoints(player), 100);

  const low = rewardPlayer({ points: 20, level: 25 }).player;
  const prayer = low.getSkillManager().getExperience(Skill.PRAYER);
  exchangeAndConfirm(low, 19); // Prayer XP (+1%): 10 points at level 25 is 181.8 XP
  exchangeAndConfirm(low, 19);
  assert.equal(low.getSkillManager().getExperience(Skill.PRAYER) - prayer, 363, "the tenths are kept, 2 x 181.8");
  assert.equal(Rewards.getPoints(low), 0);
});

test("XP rewards and their displayed per-point values use the world's and player's multipliers", (t) => {
  const previous = GameConstants.EXPERIENCE_MULTIPLIER;
  t.after(() => { GameConstants.EXPERIENCE_MULTIPLIER = previous; });
  const message = (calls) => decodePluginMessagePayload(calls.filter(([name]) => name === "sendClientPacket").at(-1)[1].subarray(3));
  GameConstants.EXPERIENCE_MULTIPLIER = 100;
  for (const [option, skill, base] of [[0, Skill.ATTACK, 245], [3, Skill.STRENGTH, 245], [6, Skill.DEFENCE, 245],
    [9, Skill.RANGED, 224], [12, Skill.MAGIC, 224], [15, Skill.HITPOINTS, 245], [18, Skill.PRAYER, 126]]) {
    const { player, calls } = rewardPlayer({ points: 1, level: 65 });
    const before = player.getSkillManager().getExperience(skill);
    exchangeAndConfirm(player, option);
    assert.equal(player.getSkillManager().getExperience(skill) - before, base * 100, skill.getName());
    assert.equal(Rewards.getPoints(player), 0);
    assert.equal(message(calls).channel, "pest-control");
    assert.equal(message(calls).data.xpPerPoint[skill.getName()], base * 100);
    assert.ok(calls.findIndex(([name]) => name === "sendClientPacket") < calls.findIndex(([name]) => name === "sendInterface"), "send the displayed rewards before the client draws its rows");
  }
  const bulk = rewardPlayer({ points: 100, level: 65 });
  const bulkBefore = bulk.player.getSkillManager().getExperience(Skill.ATTACK);
  exchangeAndConfirm(bulk.player, 2);
  assert.equal(bulk.player.getSkillManager().getExperience(Skill.ATTACK) - bulkBefore, 2_695_000, "100-point bonus also receives the world multiplier");
  const nextReward = Rewards._test.xpPerPoint(0, bulk.player.getSkillManager().getMaxLevel(Skill.ATTACK)) * 100;
  assert.equal(message(bulk.calls).data.xpPerPoint.Attack, nextReward, "level-ups refresh the next reward's displayed XP");
  GameConstants.EXPERIENCE_MULTIPLIER = 1.5;
  t.mock.method(PluginManager, "emitCanGainExperience", () => ({ allow: null, multiplier: 2 }));
  const { player, calls } = rewardPlayer({ points: 10, level: 25 });
  const before = player.getSkillManager().getExperience(Skill.PRAYER);
  exchangeAndConfirm(player, 19);
  assert.equal(player.getSkillManager().getExperience(Skill.PRAYER) - before, 545);
  assert.equal(calls.find(([name]) => name === "sendExpDrop")[2], 545.4, "10-point bonus and tenths survive both multipliers");
  assert.equal(message(calls).data.xpPerPoint.Prayer, 54);
});

test("XP rewards refuse skills under 25 and rewards the player cannot afford", () => {
  const { player } = rewardPlayer({ points: 50, level: 24 });
  exchangeAndConfirm(player, 0);
  assert.equal(Rewards.getPoints(player), 50);
  const rich = rewardPlayer({ points: 50 }).player;
  exchangeAndConfirm(rich, 5); // 100 points
  assert.equal(Rewards.getPoints(rich), 50);
});

test("XP rewards preserve points while the ordinary lockxp command has locked experience", () => {
  const commands = new Map();
  require("../plugins/commands/PlayerCommands.plugin").register({
    core: { PlayerRights: require("../dist/game/model/rights/PlayerRights").PlayerRights },
    onInterfaceActionButton() {},
    getWorld() {}, getItemOnGroundManager() {}, getCombatFactory() {}, getPlayerPunishment() {},
    registerCommand: (name, handler) => commands.set(name, handler),
  });
  const { player, calls } = rewardPlayer({ points: 100 });
  const before = player.getSkillManager().getExperience(Skill.ATTACK);
  commands.get("lockxp")({ player });
  exchangeAndConfirm(player, 2);
  assert.equal(Rewards.getPoints(player), 100);
  assert.equal(player.getSkillManager().getExperience(Skill.ATTACK), before);
  assert.equal(calls.some(([name]) => name === "sendExpDrop"), false);
  commands.get("lockxp")({ player });
  exchangeAndConfirm(player, 2);
  assert.equal(Rewards.getPoints(player), 0);
  assert.equal(player.getSkillManager().getExperience(Skill.ATTACK) - before, 61600);
});

test("packs: herbs and minerals noted, seeds three rolls on the 1,061 table", () => {
  const { player } = rewardPlayer({ points: 60 });
  const inventory = player.getInventory();
  const noted = (id) => ItemDefinition.forId(id).getNoteId();
  exchangeAndConfirm(player, 22); // Mineral pack, 15 points
  assert.equal(inventory.getAmount(noted(ItemIdentifiers.COAL)), 25);
  assert.equal(inventory.getAmount(noted(ItemIdentifiers.IRON_ORE)), 18);
  exchangeAndConfirm(player, 21); // Herb pack, 30 points
  for (const [herb, min, max] of [[ItemIdentifiers.GRIMY_RANARR_WEED, 2, 3], [ItemIdentifiers.GRIMY_KWUARM, 1, 5]]) {
    const amount = inventory.getAmount(noted(herb));
    assert.ok(amount >= min && amount <= max, `herb ${herb}: ${amount}`);
  }
  exchangeAndConfirm(player, 23); // Seed pack, 15 points
  assert.equal(Rewards.getPoints(player), 0);
  const table = Rewards._test.seedTable();
  assert.equal(table.reduce((sum, [, , weight]) => sum + weight, 0) / 2, 1061);
  const seeds = table.reduce((sum, [id, amount]) => sum + inventory.getAmount(id) / amount, 0);
  assert.equal(seeds, 3);
});

test("void equipment needs 42 combat stats and 22 Prayer; Confirm does nothing once the interface closes", () => {
  const weak = rewardPlayer({ points: 250, level: 41 }).player;
  exchangeAndConfirm(weak, 25); // Void Knight Top
  assert.equal(weak.getInventory().getAmount(ItemIdentifiers.VOID_KNIGHT_TOP), 0);
  assert.equal(Rewards.getPoints(weak), 250);

  const { player } = rewardPlayer({ points: 260 });
  exchangeAndConfirm(player, 25);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.VOID_KNIGHT_TOP), 1);
  assert.equal(Rewards.getPoints(player), 10);
  player.setInterfaceId(-1);
  buttonHandlers.get(CONFIRM_UID)({ player, buttonId: CONFIRM_UID, slot: 31 });
  assert.equal(Rewards.getPoints(player), 10, "no seal without the interface open");
});

test("a defiler's and a torcher's shots hit as they land, scaled by distance (#1862)", () => {
  const { DefilerCombatMethod, TorcherCombatMethod } = plugin._test;
  const { Projectile, DamageFormulas, AccuracyFormulasDpsCalc } = api.core;
  const originalCreate = Projectile.createProjectile;
  const originalBounds = DamageFormulas.sourceHitBounds;
  const originalAccuracy = AccuracyFormulasDpsCalc.rollAccuracy;
  AccuracyFormulasDpsCalc.rollAccuracy = () => false;
  const sent = [];
  Projectile.createProjectile = (_source, _victim, id, delay, end) => ({ sendProjectile: () => sent.push({ id, delay, end }) });
  DamageFormulas.sourceHitBounds = () => ({ minimum: 0, maximum: 0 });
  try {
    for (const [Method, id, perTile] of [[DefilerCombatMethod, 656, 5], [TorcherCombatMethod, 647, 10]]) {
      for (const tiles of [1, 6]) {
        const mobile = (x) => ({
          isPlayer: () => false, isNpc: () => true, isRegistered: () => true, getHitpoints: () => 50,
          getLocation: () => new Location(2656 + x, 2600, 0), getSize: () => 1, getAttackAnim: () => -1,
        });
        const pest = mobile(0);
        const target = mobile(tiles);
        const method = new Method();
        sent.length = 0;
        method.start(pest, target);
        const end = 67 + perTile * tiles;
        assert.deepEqual(sent, [{ id, delay: 62, end }], `${id} at ${tiles} tiles`);
        assert.equal(method.hits(pest, target)[0].getDelay(), Projectile.ticksToLand(end), `${id} at ${tiles} tiles`);
      }
    }
  } finally {
    Projectile.createProjectile = originalCreate;
    DamageFormulas.sourceHitBounds = originalBounds;
    AccuracyFormulasDpsCalc.rollAccuracy = originalAccuracy;
  }
});
