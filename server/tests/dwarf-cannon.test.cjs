// Run after `yarn build`: node --test tests/dwarf-cannon.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { World } = require("../dist/game/World");
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");

const Cannon = require("../plugins/items/dwarfcannon/Common.DwarfCannon");
const Data = require("../plugins/items/dwarfcannon/Data.DwarfCannon");
const Setup = require("../plugins/items/dwarfcannon/Setup.DwarfCannon");
const Ammo = require("../plugins/items/dwarfcannon/Ammo.DwarfCannon");
const Firing = require("../plugins/items/dwarfcannon/Firing.DwarfCannon");
const Decay = require("../plugins/items/dwarfcannon/Decay.DwarfCannon");
const Nulodion = require("../plugins/items/dwarfcannon/Nulodion.DwarfCannon");
const Ornament = require("../plugins/items/dwarfcannon/Ornament.DwarfCannon");
const Restrictions = require("../plugins/items/dwarfcannon/Restrictions.DwarfCannon");

let core;
let Items;
/** Open ground with a wall row five tiles south (the line-of-sight test uses it). */
let CENTRE;
const npcs = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  Items = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3260, 3260);
  core.RegionManager.loadMapFiles(3165, 3490);
  CENTRE = new core.Location(3260, 3260, 0);
  Cannon.init({ core, emitCustomEvent: () => {} });
});

afterEach(() => {
  for (const cannon of [...Cannon.cannons.values()]) Cannon.forget(cannon);
  for (const npc of npcs.splice(0)) World.getNpcs().remove(npc);
});

/** A real player whose packets are recorded per tick. */
function gunner({ at = CENTRE, parts = Cannon.KINDS.plain.parts, steel = 2641, granite = 0 } = {}) {
  const p = new Player(null);
  p.setUsername(`gunner${Math.random()}`);
  p.setLocation(at.clone());
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const varbits = new Map();
  const varps = new Map();
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "sendVarbit") return (id, value) => (varbits.set(id, value), log(`varbit ${id}=${value}`), sender);
      if (key === "sendConfig") return (id, value) => (varps.set(id, value), log(`varp ${id}=${value}`), sender);
      if (key === "sendMessage") return (text) => (log(text), sender);
      if (key === "sendEnterAmountPrompt") return (title) => (log(`prompt ${title}`), sender);
      if (key === "sendSound") return (id) => (log(`synth ${id}`), sender);
      return () => sender;
    },
  });
  p.getPacketSender = () => sender;
  p.sendMessage = (text) => log(text);
  p.performAnimation = (animation) => log(`anim ${animation.getId()}`);
  p.isRegistered = () => true;
  for (const part of parts) p.getInventory().add(new core.Item(part, 1), false);
  if (steel) p.getInventory().add(new core.Item(Items.STEEL_CANNONBALL, steel), false);
  if (granite) p.getInventory().add(new core.Item(Items.GRANITE_CANNONBALL, granite), false);
  return Object.assign(p, { ticks, varbits, varps, log, nextTick: () => ticks.push([]) });
}

/** Runs world ticks after the current one: tasks, then hits landing (as World.process orders them). */
function runTicks(p, count) {
  for (let i = 0; i < count; i++) {
    p.nextTick();
    World.processCycle = (World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    HitQueue.processAll(World.processCycle);
  }
  return p.ticks;
}

/** Records the cannon's loc animations and area sounds in the owner's log. */
function watch(p) {
  const animate = Cannon.animate;
  const areaSound = Cannon.areaSound;
  Cannon.animate = (cannon, id) => p.log(`loc anim ${id}`);
  Cannon.areaSound = (at, id) => p.log(`sound ${id}`);
  return () => {
    Cannon.animate = animate;
    Cannon.areaSound = areaSound;
  };
}

function locAt(location) {
  return (MapObjects.mapObjects.get(MapObjects.getHash(location.getX(), location.getY(), location.getZ())) ?? []).map((o) => o.getId());
}

function spawnNpc(id, x, y) {
  const npc = new core.NPC(id, new core.Location(x, y, 0));
  World.getNpcs().add(npc, true);
  npcs.push(npc);
  return npc;
}

/** A cannon fully set up at CENTRE for `p`, loaded as on the furnace tick + 1. */
function built(p) {
  Setup.setUp({ player: p, itemId: Items.CANNON_BASE });
  runTicks(p, 11);
  return Cannon.cannonOf(p);
}

test("setting up: the captured ticks, messages, sounds, locs and vars, then 30 balls", () => {
  const p = gunner();
  const stop = watch(p);
  try {
    Setup.setUp({ player: p, itemId: Items.CANNON_BASE });
    assert.deepEqual(p.ticks[0], ["varbit 12393=1"]);
    runTicks(p, 11);
    const at = (tick) => p.ticks[tick];
    const sw = CENTRE.transform(-1, -1);
    // Tick 2: the base, the player runs off to the tile south of the south-west corner.
    assert.ok(at(2).includes("varbit 12393=0") && at(2).includes("You place the cannon base on the ground."));
    assert.ok(at(2).includes("anim 827") && at(2).includes("sound 2876"));
    assert.ok(at(2).includes(`varp 4=${Cannon.packCoord(sw)}`) && at(2).includes("varp 2=1"));
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [sw.getX(), sw.getY() - 1]);
    assert.ok(at(4).includes("You add the stand.") && at(4).includes("varp 2=2"), "the stand 2 ticks later");
    assert.ok(at(7).includes("You add the barrels."), "the barrels 3 ticks later");
    assert.ok(at(10).includes("You add the furnace.") && at(10).includes("varp 2=4"), "the furnace 3 ticks later");
    assert.ok(at(11).includes("You load the cannon with 30 cannonballs.") && at(11).includes("varp 3=30"), "loaded the tick after");
    assert.ok(locAt(sw).includes(core.ObjectIdentifiers.DWARF_MULTICANNON));
    assert.equal(p.getInventory().getAmount(Items.STEEL_CANNONBALL), 2611);
    for (const part of Cannon.KINDS.plain.parts) assert.equal(p.getInventory().contains(part), false);
  } finally {
    stop();
  }
});

test("setting up is refused: a second cannon, missing or mixed parts, no room, a restricted area", () => {
  const p = gunner();
  built(p);
  const again = gunner({ at: CENTRE.transform(6, 0) });
  again.setUsername(p.getUsername());
  Setup.setUp({ player: again, itemId: Items.CANNON_BASE });
  assert.ok(again.ticks[0].includes(Setup.MESSAGE.ONE_ONLY));
  const mixed = gunner({ at: CENTRE.transform(6, 0), parts: [Items.CANNON_BASE, Items.CANNON_STAND_OR_, Items.CANNON_BARRELS, Items.CANNON_FURNACE] });
  Setup.setUp({ player: mixed, itemId: Items.CANNON_BASE });
  assert.ok(mixed.ticks[0].includes(Setup.MESSAGE.PARTS));
  const cramped = gunner({ at: CENTRE.transform(-6, -6) });
  Setup.setUp({ player: cramped, itemId: Items.CANNON_BASE });
  assert.ok(cramped.ticks[0].includes(Setup.MESSAGE.SPACE), "next to the wall row");
  const exchange = gunner({ at: new core.Location(3165, 3490, 0) });
  Setup.setUp({ player: exchange, itemId: Items.CANNON_BASE });
  assert.ok(exchange.ticks[0].includes("The Grand Exchange staff prefer not to have heavy artillery operated around their premises."));
});

test("firing: the flag the next tick, then a turn a tick; a target is shot before the turn, the hit lands next tick", () => {
  const p = gunner();
  const cannon = built(p);
  const bat = spawnNpc(core.NpcIdentifiers.GIANT_BAT, 3260, 3262);
  const stop = watch(p);
  const { rollAccuracy } = core.AccuracyFormulasDpsCalc;
  const random = Math.random;
  core.AccuracyFormulasDpsCalc.rollAccuracy = () => true;
  Math.random = () => 0.5;
  try {
    const start = p.ticks.length - 1;
    const hitpointsXp = p.getSkillManager().getExperience(core.Skill.HITPOINTS);
    Ammo.fire({ player: p, object: cannon.object });
    runTicks(p, 3);
    assert.ok(p.ticks[start + 1].includes(`varp 1=${Data.FIRING_FLAG}`), "the firing flag the next tick");
    // Facing north at the bat: fire (506), then turn to NE (515), in one tick.
    const shot = p.ticks[start + 2];
    assert.deepEqual(shot.filter((x) => x.startsWith("loc anim") || x.startsWith("sound")), ["loc anim 506", "sound 1667", "sound 2877", "loc anim 515"]);
    assert.ok(shot.includes("varp 3=29"));
    assert.equal(bat.getHitpoints(), 32 - 15, "15 damage, the tick after the shot");
    assert.equal(p.getSkillManager().getExperience(core.Skill.RANGED), 30, "2 Ranged XP per damage");
    assert.equal(p.getSkillManager().getExperience(core.Skill.HITPOINTS), hitpointsXp, "no Hitpoints XP");
    const turns = [];
    runTicks(p, 7).slice(start + 3, start + 10).forEach((t) => turns.push(...t.filter((x) => x.startsWith("loc anim"))));
    assert.deepEqual(turns, ["loc anim 516", "loc anim 517", "loc anim 518", "loc anim 519", "loc anim 520", "loc anim 521", "loc anim 514"], "E, SE, S, SW, W, NW, N");
    assert.ok(p.ticks[start + 10].includes("loc anim 506"), "round again, it fires north at the bat once more");
  } finally {
    core.AccuracyFormulasDpsCalc.rollAccuracy = rollAccuracy;
    Math.random = random;
    stop();
  }
});

test("targeting: singles only what fights you; never through walls or at cannon-immune monsters", () => {
  const p = gunner();
  const cannon = built(p);
  const bat = spawnNpc(core.NpcIdentifiers.GIANT_BAT, 3260, 3262);
  assert.equal(Firing.targetFor(cannon, p), bat);
  const other = spawnNpc(core.NpcIdentifiers.GIANT_BAT, 3270, 3270);
  bat.getCombat().setUnderAttack(other);
  assert.equal(Firing.canTarget(p, bat), false, "fighting someone else, in singles");
  bat.getCombat().setUnderAttack(p);
  assert.equal(Firing.canTarget(p, bat), true, "fighting the owner");
  cannon.direction = 4;
  const behindWall = spawnNpc(core.NpcIdentifiers.GIANT_BAT, 3260, 3253);
  assert.equal(Data.inZone(4, 0, -7), true);
  assert.notEqual(Firing.targetFor(cannon, p), behindWall, "the wall row blocks the shot");
  const kurask = core.NpcDefinition.forId(core.NpcIdentifiers.KURASK);
  assert.ok(Data.NO_CANNON_NPCS.includes(kurask.getName()), "Kurask by its cache name");
});

test("the captured shots fall in their directions' zones (at the NPC's south-west tile)", () => {
  assert.equal(Data.inZone(Data.DIRECTIONS.indexOf("n"), 0, 2), true, "an ent 2 north (shot 1)");
  assert.equal(Data.inZone(Data.DIRECTIONS.indexOf("sw"), -3, -3), true, "an ent 3 south-west (shot 2)");
});

test("ammo: granite goes in first and steel waits for it; Empty gives the captured message", () => {
  const p = gunner({ steel: 100, granite: 5 });
  const cannon = built(p);
  assert.equal(cannon.granite, 5);
  assert.equal(cannon.steel, 0, "no steel while granite is in");
  cannon.granite = 0;
  cannon.steel = 28;
  cannon.firing = true;
  Ammo.empty({ player: p, object: cannon.object });
  const now = p.ticks[p.ticks.length - 1];
  assert.ok(now.includes("You unload your cannon and receive Steel cannonball x 28.") && now.includes("varp 3=0"));
  runTicks(p, 1);
  assert.ok(p.ticks[p.ticks.length - 1].includes("varp 1=0"), "firing stops the tick after");
});

test("Load X: asks once (captured prompt and message), then loads that many", () => {
  const p = gunner();
  const cannon = built(p);
  cannon.steel = 0;
  Ammo.loadX({ player: p, object: cannon.object });
  assert.ok(p.ticks[p.ticks.length - 1].includes("prompt Set load-x cannonballs (1 - 30):"));
  p.getEnteredAmountAction().execute(10);
  assert.equal(p.varbits.get(Data.VARBIT.LOAD_X), 10);
  assert.ok(p.ticks[p.ticks.length - 1].includes("You will now load 10 cannonballs when using Load-x."));
  Ammo.loadX({ player: p, object: cannon.object });
  assert.equal(cannon.steel, 10);
  assert.ok(p.ticks[p.ticks.length - 1].includes("You load the cannon with 10 cannonballs."));
});

test("Pick-up: the captured message, vars cleared, parts and balls back, the loc gone", () => {
  const p = gunner();
  const cannon = built(p);
  const sw = cannon.sw;
  Decay.pickUp({ player: p, object: cannon.object });
  const now = p.ticks[p.ticks.length - 1];
  assert.ok(now.includes("You pick up the cannon. It's really heavy.") && now.includes("synth 2581"));
  assert.ok(now.includes("varp 3551=-1") && now.includes("varp 2=0") && now.includes("varp 3=0"));
  for (const part of Cannon.KINDS.plain.parts) assert.ok(p.getInventory().contains(part));
  assert.equal(p.getInventory().getAmount(Items.STEEL_CANNONBALL), 2641);
  assert.equal(locAt(sw).includes(core.ObjectIdentifiers.DWARF_MULTICANNON), false);
  assert.equal(Cannon.cannonOf(p), null);
});

test("someone else's cannon: 'This isn't your cannon.'", () => {
  const p = gunner();
  const cannon = built(p);
  const stranger = gunner({ at: CENTRE.transform(4, 0) });
  assert.equal(Ammo.fire({ player: stranger, object: cannon.object }), true);
  assert.ok(stranger.ticks[0].includes(Ammo.MESSAGE.NOT_YOURS));
});

test("decay: broken at 25 minutes, Repair; gone 10 minutes on, and Nulodion gives it back", () => {
  const p = gunner();
  const cannon = built(p);
  cannon.age = Data.BREAK_TICKS - 1;
  runTicks(p, 1);
  assert.equal(cannon.broken, true);
  assert.ok(locAt(cannon.sw).includes(core.ObjectIdentifiers.BROKEN_MULTICANNON_2));
  Decay.repair({ player: p, object: cannon.object });
  assert.ok(locAt(cannon.sw).includes(core.ObjectIdentifiers.DWARF_MULTICANNON));
  cannon.age = Data.LOSE_TICKS - 1;
  runTicks(p, 1);
  assert.equal(Cannon.cannonOf(p), null);
  assert.deepEqual(p.getAttribute(Cannon.LOST_ATTRIBUTE), { kind: "plain", stage: 4 });
  const ask = (text) => Nulodion.answerCondition({ npcId: core.NpcIdentifiers.NULODION, player: p, text });
  assert.equal(ask("If the player's cannon is still set-up somewhere:"), false);
  assert.equal(ask("If the player has lost their cannon by world-hopping or letting it despawn:"), true);
  assert.equal(ask("If the player still has their cannon:"), false);
  Nulodion.giveCannon({ npcId: core.NpcIdentifiers.NULODION, player: p, kind: "message", text: Nulodion.GIVES_CANNON });
  for (const part of Cannon.KINDS.plain.parts) assert.ok(p.getInventory().contains(part));
  assert.equal(p.getAttribute(Cannon.LOST_ATTRIBUTE), null);
});

test("logging out mid-setup leaves the parts so far; the cannon stays up for its owner's return", () => {
  const p = gunner();
  Setup.setUp({ player: p, itemId: Items.CANNON_BASE });
  runTicks(p, 3);
  const cannon = Cannon.cannonOf(p);
  assert.equal(cannon.stage, 1);
  Decay.detach({ player: p });
  runTicks(p, 8);
  assert.equal(cannon.stage, 1, "no more parts without the owner");
  Decay.reattach({ player: p });
  assert.equal(cannon.player, p);
  assert.ok(p.ticks[p.ticks.length - 1].includes("varp 2=1"), "its vars again on login");
});

test("a cannon saved on a player but not in the world (a restart) is lost to Nulodion on login", () => {
  const p = gunner();
  p.setAttribute(Cannon.STATE_ATTRIBUTE, { kind: "ornament", x: 3259, y: 3259, z: 0, stage: 2, steel: 0, granite: 0 });
  Decay.reattach({ player: p });
  assert.deepEqual(p.getAttribute(Cannon.LOST_ATTRIBUTE), { kind: "ornament", stage: 2 });
  assert.ok(p.ticks[0].includes(Decay.MESSAGE.LOST));
});

test("the ornament kit on each part, Dismantle back; an ornament cannon uses its own locs", () => {
  const p = gunner({ parts: [...Cannon.KINDS.plain.parts], steel: 0 });
  for (const part of Cannon.KINDS.plain.parts) {
    p.getInventory().add(new core.Item(Items.SHATTERED_CANNON_ORNAMENT_KIT, 1), false);
    Ornament.applyKit({ player: p, usedItemId: Items.SHATTERED_CANNON_ORNAMENT_KIT, usedWithItemId: part });
  }
  for (const part of Cannon.KINDS.ornament.parts) assert.ok(p.getInventory().contains(part));
  const slot = p.getInventory().getSlot(Items.CANNON_BASE_OR_);
  Ornament.dismantle({ player: p, itemId: Items.CANNON_BASE_OR_, slot });
  assert.ok(p.getInventory().contains(Items.CANNON_BASE) && p.getInventory().contains(Items.SHATTERED_CANNON_ORNAMENT_KIT));
  const q = gunner({ parts: Cannon.KINDS.ornament.parts });
  Setup.setUp({ player: q, itemId: Items.CANNON_BASE_OR_ });
  runTicks(q, 11);
  const cannon = Cannon.cannonOf(q);
  assert.equal(cannon.kind, "ornament");
  assert.ok(locAt(cannon.sw).includes(core.ObjectIdentifiers.DWARF_MULTICANNON_7));
});

test("restrictions: every Wiki area has its message; outlines are polygons; instances refuse", () => {
  const data = Restrictions.load();
  assert.equal(data.restrictions.length, 71);
  for (const r of data.restrictions) {
    assert.ok(r.name && r.message, r.name);
    for (const area of r.areas ?? []) assert.ok(area.points.length >= 3 && r.source, r.name);
  }
  assert.equal(Restrictions.restrictionAt(new core.Location(3165, 3490, 0)), "The Grand Exchange staff prefer not to have heavy artillery operated around their premises.");
  assert.equal(Restrictions.restrictionAt(new core.Location(3200, 10100, 0)), "You can't set up a cannon here.", "the Revenant Caves");
  assert.equal(Restrictions.restrictionAt(CENTRE), null);
  assert.equal(Restrictions.restrictionAt(CENTRE, {}), data.default, "an instance");
});

test("every id the cannon uses is in the cache", () => {
  for (const kind of Object.values(Cannon.KINDS)) {
    for (const loc of [...kind.locs, kind.broken]) assert.ok(CacheDefinitions.getObject(loc)?.name, `loc ${loc}`);
    for (const part of kind.parts) assert.ok(CacheDefinitions.getItem(part)?.name, `item ${part}`);
  }
  assert.deepEqual(CacheDefinitions.getObject(core.ObjectIdentifiers.DWARF_MULTICANNON).actions.slice(0, 4), ["Fire", "Pick-up", "Empty", "Load X"]);
  assert.deepEqual(CacheDefinitions.getObject(core.ObjectIdentifiers.BROKEN_MULTICANNON_2).actions.slice(0, 2), ["Repair", "Pick-up"]);
  const { CacheIndexDat2 } = require("../dist/game/cache/codec/rs/cache/CacheIndex");
  const { ConfigType } = require("../dist/game/cache/codec/rs/cache/ConfigType");
  const { IndexType } = require("../dist/game/cache/codec/rs/cache/IndexType");
  const seqs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore()).getArchive(ConfigType.DAT2.seqs);
  for (const kind of Object.values(Cannon.KINDS)) {
    for (let d = 0; d < 8; d++) {
      assert.ok(seqs.getFile(kind.fire + d)?.data, `fire ${kind.fire + d}`);
      assert.ok(seqs.getFile(kind.turn + d)?.data, `turn ${kind.turn + d}`);
    }
  }
});
