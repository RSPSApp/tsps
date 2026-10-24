// Run after `yarn build`: node --test tests/dagannoth-kings.test.cjs
// Dagannoth Kings: the ids against the cache's gamevals, the two lairs and the
// ladder, the three fights' styles, projectiles and speeds, the spinolyp magic
// and dive, and the ::teleports entry, each against the captures and Wiki facts
// in docs/dagannoth-kings.md.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const DagannothKings = require("../plugins/bosses/DagannothKings.plugin");
const Common = require("../plugins/bosses/dagannothkings/Common.DagannothKings");
const FightPrime = require("../plugins/bosses/dagannothkings/Fight.Prime.DagannothKings");
const FightSupreme = require("../plugins/bosses/dagannothkings/Fight.Supreme.DagannothKings");
const FightRex = require("../plugins/bosses/dagannothkings/Fight.Rex.DagannothKings");
const FightSpinolyp = require("../plugins/bosses/dagannothkings/Fight.Spinolyp.DagannothKings");
const Dive = require("../plugins/bosses/dagannothkings/Dive.Spinolyp.DagannothKings");
const Area = require("../plugins/bosses/dagannothkings/Area.DagannothKings");
const Entrance = require("../plugins/bosses/dagannothkings/Entrance.DagannothKings");
const Hud = require("../plugins/bosses/dagannothkings/Hud.DagannothKings");
const Teleports = require("../plugins/interface/TeleportInterface.plugin");

const core = PluginManager.getCoreApi();
const areas = [];
const combatProviders = [];
const hitRollHandlers = [];
const canAttackHandlers = [];
const hitResolvedHandlers = [];
const deathHandlers = [];
const objectClicks = {};
const customEvents = [];
let slayerTask = null;
const api = new Proxy(
  {
    core,
    persistAttribute: () => {},
    registerArea: (area) => areas.push(area),
    registerNpcCombatMethodProvider: (ids, method, options) => combatProviders.push({ ids, method, options }),
    onCombatHitRoll: (handler) => hitRollHandlers.push(handler),
    onCanAttack: (handler) => canAttackHandlers.push(handler),
    onCombatHitResolved: (handler) => hitResolvedHandlers.push(handler),
    onNpcDeath: (handler) => deathHandlers.push(handler),
    onObjectClick: (ids, clickType, handler) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) objectClicks[`${id}:${clickType}`] = handler;
    },
    emitCustomEvent: (name, payload) => {
      customEvents.push({ name, payload });
      if (name === "slayer:current-task") payload.task = slayerTask;
    },
  },
  { get: (target, key) => target[key] ?? (() => {}) }
);

let gamevals = null;
const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  gamevals = new Gamevals();
  DagannothKings.register(api);
});

function fakeNpc(id, x = 2906, y = 4448) {
  return {
    getId: () => id,
    getLocation: () => new Location(x, y, 0),
    getSize: () => 3,
    getHitpoints: () => 255,
    getDefinition: () => ({ getHitpoints: () => 255 }),
    isRegistered: () => true,
    isNpc: () => true,
    getPlayersWithinDistance: () => [],
    getPrivateArea: () => null,
  };
}

// ------------------------------------------------------------------ the cache

test("the ids are the cache's dagannoth gamevals", () => {
  const npc = gamevals.namesOf(GamevalKind.NPC);
  assert.equal(npc.get(Common.SUPREME_ID), "dagcave_ranged_boss");
  assert.equal(npc.get(Common.PRIME_ID), "dagcave_magic_boss");
  assert.equal(npc.get(Common.REX_ID), "dagcave_melee_boss");
  const seq = gamevals.namesOf(GamevalKind.SEQ);
  assert.equal(seq.get(Common.ANIM.defend), "dagannoth_meganoth_defend");
  assert.equal(seq.get(Common.ANIM.rexMelee), "dagannoth_meganoth_attack_melee");
  assert.equal(seq.get(Common.ANIM.primeMagic), "dagannoth_meganoth_attack_mage");
  assert.equal(seq.get(Common.ANIM.supremeRange), "dagannoth_meganoth_attack_range");
  assert.equal(seq.get(Common.ANIM.death), "dagannoth_meganoth_death");
  assert.equal(seq.get(Common.ANIM.spinolypAttack), "dagannoth_water_creature_attack");
  assert.equal(seq.get(Common.ANIM.spinolypDefend), "dagannoth_water_creature_defend");
  assert.equal(seq.get(Common.ANIM.spinolypDeath), "dagannoth_water_creature_death");
  assert.equal(seq.get(Common.ANIM.spinolypEmerge), "dagannoth_water_creature_spring_up");
  const spotanim = gamevals.namesOf(GamevalKind.SPOTANIM);
  assert.equal(spotanim.get(Common.PROJECTILE.prime), "waterwave_travel");
  assert.equal(spotanim.get(Common.PROJECTILE.supreme), "dagannoth_spine_spotanim_travel");
  assert.equal(spotanim.get(Common.PROJECTILE.spinolypRanged), "dagannoth_spine_spotanim_travel2");
  assert.equal(spotanim.get(Common.PROJECTILE.spinolypMagic), "earthbolt_travel");
  assert.equal(spotanim.get(Common.PROJECTILE.primeImpact), "dagannoth_whirlpool");
  const loc = gamevals.namesOf(GamevalKind.LOC);
  assert.equal(loc.get(Common.LADDER_ID), "dagexp_bossroomladder_down");
  assert.equal(loc.get(Common.EXIT_LADDER_ID), "dagexp_bossroomladder_up");
  assert.equal(core.NpcIdentifiers.DAGANNOTH_SUPREME, Common.SUPREME_ID);
  assert.equal(core.NpcIdentifiers.DAGANNOTH_PRIME, Common.PRIME_ID);
  assert.equal(core.NpcIdentifiers.DAGANNOTH_REX, Common.REX_ID);
  assert.equal(DagannothKings.members, true);
});

test("their stats and combat definitions match the captures", () => {
  assert.equal(CacheDefinitions.getNpc(Common.SUPREME_ID).hitpoints, 255);
  assert.equal(CacheDefinitions.getNpc(Common.SUPREME_ID).size, 3);
  const defs = require("../data/definitions/npc-combat-defs.json").npcs;
  assert.deepEqual(defs[String(Common.PRIME_ID)].anims, { attack: 2854, block: 2852, death: 2856 });
  assert.deepEqual(defs[String(Common.SUPREME_ID)].anims, { attack: 2855, block: 2852, death: 2856 });
  assert.deepEqual(defs[String(Common.REX_ID)].anims, { attack: 2853, block: 2852, death: 2856 });
  // Wiki: 150-tick (90s) respawn, 5-tick death everywhere.
  for (const id of Common.KING_IDS) {
    assert.equal(defs[String(id)].respawn, 150);
    assert.equal(defs[String(id)].deathTicks, 5);
  }
  assert.equal(defs[String(Common.PRIME_ID)].projectile, 162);
  assert.equal(defs[String(Common.SUPREME_ID)].projectile, 475);
  // Wiki: spinolyps respawn in 10 ticks (6s).
  for (const id of Common.SPINOLYP_IDS) {
    assert.equal(defs[String(id)].respawn, 10);
  }
  // Max hits come from the engine (monsters-complete), matching the data record.
  const NpcDefinition = require("../dist/game/definition/NpcDefinition").NpcDefinition;
  assert.equal(NpcDefinition.forId(Common.SUPREME_ID).getMaxHit(), 30);
  assert.equal(NpcDefinition.forId(Common.PRIME_ID).getMaxHit(), 50);
  assert.equal(NpcDefinition.forId(Common.REX_ID).getMaxHit(), 26);
  assert.deepEqual(Common.DATA.combat.maxHit, { supreme: 30, prime: 50, rex: 26, spinolyp: 10 });
});

test("both lairs, the landing tiles and the teleport agree with the logs", () => {
  assert.deepEqual([...Common.DATA.lairs.public.spawnTile], [2900, 4449, 0]);
  assert.deepEqual([...Common.DATA.lairs.task.spawnTile], [2900, 4385, 0]);
  assert.ok(Common.inPublicLair(new Location(2900, 4449, 0)));
  assert.ok(!Common.inPublicLair(new Location(2900, 4385, 0)));
  assert.ok(Common.inTaskLair(new Location(2900, 4385, 0)));
  assert.ok(!Common.inTaskLair(new Location(2900, 4449, 0)));
  const free = ([x, y]) => !RegionManager.blocked(new Location(x, y, 0), null);
  assert.ok(free(Common.TELEPORT_TILE), "teleport landing blocked");
  assert.ok(free(Common.PUBLIC_SPAWN), "public spawn blocked");
  assert.ok(free(Common.TASK_SPAWN), "task spawn blocked");
  assert.ok(free(Common.OUTSIDE_TILE), "ladder tile blocked");
  const entry = Teleports._test.Destinations.byKey("dagannoth-kings");
  assert.ok(entry?.tabs.includes(Teleports._test.TAB.BOSSES), "missing ::teleports entry");
  assert.deepEqual(entry.tile, [1908, 4367, 0]);
});

// ------------------------------------------------------------------ the fights

test("each king fights its own style at its own range and speed", () => {
  assert.equal(combatProviders.length, 4);
  const byId = new Map();
  for (const { ids, method } of combatProviders) for (const id of ids) byId.set(id, method);
  const prime = new (byId.get(Common.PRIME_ID))();
  assert.equal(prime.type(), core.CombatType.MAGIC);
  assert.equal(prime.attackDistance(), Common.PRIME_DISTANCE);
  assert.equal(prime.attackSpeed(), 4);
  const supreme = new (byId.get(Common.SUPREME_ID))();
  assert.equal(supreme.type(), core.CombatType.RANGED);
  assert.equal(supreme.attackDistance(), Common.SUPREME_DISTANCE);
  assert.equal(supreme.attackSpeed(), 4);
  const rex = new (byId.get(Common.REX_ID))();
  assert.equal(rex.type(), core.CombatType.MELEE);
  assert.equal(rex.attackDistance(), 1);
  assert.equal(rex.attackSpeed(), 4);
  assert.ok(Common.SPINOLYP_IDS.every((id) => byId.has(id)), "every spinolyp form needs the method");
  // Spinolyps share a room and attack on the same tick, so each needs its own method
  // instance (this.style lives on it between start and the landing hit).
  const spinolypRegistration = combatProviders.find(({ ids }) => ids.includes(Common.SPINOLYP_IDS[0]));
  assert.deepEqual(spinolypRegistration.options, { singleton: false });
  for (const { ids, options } of combatProviders) {
    if (ids.some((id) => Common.KING_IDS.includes(id))) assert.equal(options, undefined);
  }
});

test("Prime splashes his 3x3 around the target", () => {
  const at = (x, y) => new Location(x, y, 0);
  const seen = new Map();
  const fetched = [];
  const npc = {
    ...fakeNpc(Common.PRIME_ID, 2911, 4451),
    getPlayersWithinDistance: (radius) => {
      fetched.push(radius);
      return [...seen.values()];
    },
    getPrivateArea: () => null,
  };
  const target = { getLocation: () => at(2900, 4449), getHitpoints: () => 99, getPrivateArea: () => null };
  const nextTo = { getLocation: () => at(2901, 4449), getHitpoints: () => 99, getPrivateArea: () => null };
  const far = { getLocation: () => at(2905, 4449), getHitpoints: () => 99, getPrivateArea: () => null };
  for (const [name, player] of [["target", target], ["nextTo", nextTo], ["far", far]]) seen.set(name, player);
  // Fetching covers the target's splash zone, not just the king's own tile: the
  // target can stand a full attack range away (bug: fetching only radius 1 here
  // used to miss everyone except players hugging the boss).
  const victims = Common.playersAround(npc, target.getLocation(), Common.PRIME_SPLASH_RADIUS, Common.PRIME_DISTANCE + Common.PRIME_SPLASH_RADIUS);
  assert.deepEqual(fetched, [Common.PRIME_DISTANCE + Common.PRIME_SPLASH_RADIUS]);
  assert.ok(victims.includes(target));
  assert.ok(victims.includes(nextTo));
  assert.ok(!victims.includes(far));
});

test("Rex only reaches edge-adjacent tiles", () => {
  const base = new Location(2913, 4445, 0);
  assert.equal(Common.edgeDistance(base, 3, new Location(2912, 4445, 0)), 1);
  assert.equal(Common.edgeDistance(base, 3, new Location(2916, 4444, 0)), 1);
  assert.ok(Common.edgeDistance(base, 3, new Location(2910, 4445, 0)) > 1);
});

test("aggression follows the Wiki ranges from the south-west tile", () => {
  assert.equal(areas.length, 1);
  assert.equal(areas[0].isMulti(), true);
  const area = areas[0];
  const playerAt = (x, y) => ({ getLocation: () => new Location(x, y, 0) });
  const kingAt = (id, x, y) => ({ getId: () => id, getLocation: () => new Location(x, y, 0) });
  // Rex: 5 tiles.
  assert.equal(area.npcAggression(playerAt(2908, 4445), kingAt(Common.REX_ID, 2913, 4445)), true);
  assert.equal(area.npcAggression(playerAt(2907, 4445), kingAt(Common.REX_ID, 2913, 4445)), false);
  // Prime/Supreme: 7 tiles.
  assert.equal(area.npcAggression(playerAt(2904, 4445), kingAt(Common.PRIME_ID, 2911, 4451)), true);
  assert.equal(area.npcAggression(playerAt(2903, 4445), kingAt(Common.PRIME_ID, 2911, 4451)), false);
  assert.equal(area.npcAggression(playerAt(2899, 4448), kingAt(Common.SUPREME_ID, 2906, 4448)), true);
  assert.equal(area.npcAggression(playerAt(2898, 4448), kingAt(Common.SUPREME_ID, 2906, 4448)), false);
  // Non-kings are left to the engine.
  assert.equal(area.npcAggression(playerAt(2899, 4448), { getId: () => 5947, getLocation: () => new Location(2906, 4448, 0) }), null);
  assert.equal(area.npcAggressionTolerance(playerAt(2899, 4448), kingAt(Common.REX_ID, 2913, 4445)), true);
  assert.equal(area.npcAggressionTolerance(playerAt(2899, 4448), { getId: () => 5947 }), null);
});

test("spinolyp magic rolls ranged defence and drains prayer", () => {
  const method = new ((() => {
    for (const { ids, method } of combatProviders) if (ids.includes(Common.SPINOLYP_IDS[0])) return method;
    throw new Error("spinolyp method missing");
  })())();
  assert.equal(method.accuracyDefenceType(core.CombatType.MAGIC), core.CombatType.RANGED);
  const drained = [];
  const player = {
    isPlayer: () => true,
    getHitpoints: () => 99,
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ decreaseCurrentLevel: (skill, amount) => drained.push(amount) }),
  };
  method.style = core.CombatType.MAGIC;
  method.handleAfterHitEffects({ getTarget: () => player, isAccurate: () => true, getTotalDamage: () => 6 });
  assert.deepEqual(drained, [1]);
  // Ranged hits never drain.
  drained.length = 0;
  method.style = core.CombatType.RANGED;
  method.handleAfterHitEffects({ getTarget: () => player, isAccurate: () => true, getTotalDamage: () => 6 });
  assert.deepEqual(drained, []);
  // Misses never drain either.
  method.style = core.CombatType.MAGIC;
  method.handleAfterHitEffects({ getTarget: () => player, isAccurate: () => false, getTotalDamage: () => 0 });
  assert.deepEqual(drained, []);
});

test("spinolyps dive and re-emerge, and water cannot be attacked", () => {
  assert.deepEqual([...Common.DIVE_PAIRS], Common.SPINOLYP_IDS.map((id, index) => [id, Common.WATER_IDS[index]]));
  const moved = [];
  const transformed = [];
  const npc = {
    ...fakeNpc(5947, 2904, 4439),
    getHitpoints: () => 100,
    getMovementQueue: () => ({ reset: () => {} }),
    getCombat: () => ({ reset: () => {} }),
    performAnimation: () => {},
    moveTo: (tile) => moved.push(tile),
    setNpcTransformationId: (id) => transformed.push(id),
  };
  Dive.dive(npc);
  runTicks(2);
  assert.deepEqual(transformed, [Common.WATER_IDS[0]]);
  runTicks(6);
  assert.deepEqual(transformed, [Common.WATER_IDS[0], 5947]);
  assert.equal(moved.length, 1);
  // Submerged water refuses attacks with the live line.
  const said = [];
  const denyEvent = {
    attacker: { isPlayer: () => true, sendMessage: (line) => said.push(line) },
    target: { isNpc: () => true, getId: () => Common.WATER_IDS[0] },
    allow: null,
  };
  for (const handler of canAttackHandlers) handler(denyEvent);
  assert.equal(denyEvent.allow, false);
  assert.ok(said.includes("You can't attack this npc."));
  // Surfaced spinolyps attack like anything else.
  const allowEvent = {
    attacker: { isPlayer: () => true, sendMessage: () => {} },
    target: { isNpc: () => true, getId: () => 5947 },
    allow: null,
  };
  for (const handler of canAttackHandlers) handler(allowEvent);
  assert.equal(allowEvent.allow, null);
});

test("the ladder takes players down, gates the task lair, and peeks", () => {
  // The interaction carries the multiloc id 3831 (verified live: entry, gate and
  // Peek all fired on it). A name hook cannot work here - the server-side definition
  // has no name or options; those live on the resolved children, client-side only.
  assert.deepEqual(
    Object.keys(objectClicks).sort(),
    [`${Common.EXIT_LADDER_ID}:1`, `${Common.LADDER_ID}:1`, `${Common.LADDER_ID}:2`, `${Common.LADDER_ID}:3`, `${Common.LADDER_ID}:4`].sort()
  );
  const moved = [];
  const player = {
    getLocation: () => new Location(1910, 4367, 0),
    moveTo: (tile) => moved.push(tile),
    sendMessage: () => {},
  };
  const atLadder = { x: 1911, y: 4367 };
  assert.equal(Entrance.goPublic({ player, location: atLadder, objectId: Common.LADDER_ID }), true);
  assert.deepEqual([moved[0].getX(), moved[0].getY()], [2900, 4449]);
  // Slayer option without a task is refused; with one it lands in the task lair.
  const said = [];
  const taskPlayer = { ...player, sendMessage: (line) => said.push(line) };
  slayerTask = null;
  assert.equal(Entrance.goTask({ player: taskPlayer, location: atLadder, objectId: Common.LADDER_ID }), true);
  assert.equal(moved.length, 1);
  assert.ok(said.join(" ").toLowerCase().includes("slayer task"));
  slayerTask = { name: "dagannoth kings" };
  assert.equal(Entrance.goTask({ player: taskPlayer, location: atLadder, objectId: Common.LADDER_ID }), true);
  assert.deepEqual([moved[1].getX(), moved[1].getY()], [2900, 4385]);
  slayerTask = null;
  // Wrong ladder or far away: untouched.
  assert.equal(Entrance.goPublic({ player, location: { x: 3000, y: 3000 }, objectId: Common.LADDER_ID }), false);
  // Peek counts the public lair.
  const seen = [];
  assert.equal(Entrance.peek({ player: { sendMessage: (line) => seen.push(line) }, location: atLadder, objectId: Common.LADDER_ID }), true);
  assert.deepEqual(seen, ["You peek down the ladder and see no adventurers inside."]);
  // Exit ladders walk back to the dungeon side.
  const out = [];
  assert.equal(Entrance.climbOut({ player: { ...player, moveTo: (tile) => out.push(tile) }, location: { x: 2899, y: 4449, z: 0 }, objectId: Common.EXIT_LADDER_ID }), true);
  assert.deepEqual([out[0].getX(), out[0].getY()], [1910, 4367]);
});

test("the boss HUD follows each king", () => {
  const player = { isPlayer: () => true, getHitpoints: () => 99 };
  const npc = { ...fakeNpc(Common.PRIME_ID, 2911, 4451), getCurrentDefinition: () => ({ getHitpoints: () => 255 }) };
  Hud.engaged(npc, player);
  assert.ok(customEvents.some((event) => event.name === "boss-hud:show" && event.payload.npcId === Common.PRIME_ID && event.payload.maximum === 255));
  Hud.died({ npc });
  assert.ok(customEvents.some((event) => event.name === "boss-hud:hide"));
  customEvents.length = 0;
  Hud.engaged(npc, player);
  Hud.hideForLeaver(player);
  assert.ok(customEvents.some((event) => event.name === "boss-hud:hide"));
  assert.ok(!customEvents.some((event) => event.name === "boss-hud:show" && event.payload.npcId === Common.SUPREME_ID));
});
