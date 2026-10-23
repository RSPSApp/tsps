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
  core.AccuracyFormulasDpsCalc.rollAccuracy = (_attacker, _target, _style, defenceType, rangedDefenceType) => {
    assert.equal(defenceType, core.CombatType.RANGED);
    assert.equal(rangedDefenceType, "heavy", "cannonballs use heavy defence regardless of the held weapon");
    return true;
  };
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
  assert.deepEqual(p.getAttribute(Cannon.LOST_ATTRIBUTE), { kind: "plain", stage: 4, steel: 30, granite: 0 });
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
  assert.equal(data.restrictions.length, 72);
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

test("Combat Achievements raises capacity for setup, Fire, and Load X: medium35 hard45 elite60", () => {
  for (const [tier, capacity] of [[null, 30], ["Medium", 35], ["Hard", 45], ["Elite", 60]]) {
    Cannon.init({ core, emitCustomEvent: (name, request) => {
      if (name === "combat-achievements:tier") request.unlocked = request.tier === tier;
    } });
    const p = gunner();
    assert.equal(Cannon.capacity(p), capacity);
    const cannon = built(p);
    assert.equal(cannon.steel, capacity, "setup auto-load respects tier");
    cannon.steel = 0;
    Ammo.setLoadX(p, 999);
    assert.equal(p.getAttribute(Cannon.LOAD_X_ATTRIBUTE), capacity);
    Ammo.loadX({ player: p, object: cannon.object });
    assert.equal(cannon.steel, capacity, "Load X respects tier");
    cannon.steel = 0;
    Ammo.fire({ player: p, object: cannon.object });
    assert.equal(cannon.steel, capacity, "Fire respects tier");
    Cannon.forget(cannon);
  }
  Cannon.init({ core, emitCustomEvent() {} });
});

test("Nulodion's generated transcript sells the750k six-item set and validates at payment", () => {
  const p = gunner({ parts: [], steel: 0 });
  const inventory = p.getInventory();
  const event = { npcId: core.NpcIdentifiers.NULODION, player: p, kind: "message", text: Nulodion.SELLS_CANNON };
  const condition = (text) => Nulodion.answerCondition({ ...event, text });
  assert.equal(condition("If the player does not have at least 750,000 coins:"), true);
  Nulodion.sellCannon(event);
  assert.equal(inventory.getAmount(Items.CANNON_BASE), 0);
  inventory.add(new core.Item(Items.COINS, Nulodion.CANNON_PRICE), false);
  assert.equal(condition("If the player has at least 750,000 coins and enough inventory space:"), true);
  Nulodion.sellCannon(event);
  assert.equal(inventory.getAmount(Items.COINS), 0);
  for (const id of [...Cannon.KINDS.plain.parts, Items.AMMO_MOULD, Items.INSTRUCTION_MANUAL]) assert.equal(inventory.getAmount(id), 1);
  Nulodion.sellCannon(event);
  assert.equal(inventory.getAmount(Items.CANNON_BASE), 1, "no duplicate set without another payment");
  inventory.add(new core.Item(Items.COINS, Nulodion.CANNON_PRICE), false);
  for (let i = 0; i < 22; i++) inventory.add(new core.Item(Items.SPADE, 1), false);
  assert.equal(condition("If the player has less than six free inventory space:"), true);
  Nulodion.sellCannon(event);
  assert.equal(inventory.getAmount(Items.COINS), Nulodion.CANNON_PRICE, "no payment with insufficient space");
});

test("Nulodion revalidates replacement space and a still-deployed cannon", () => {
  const p = gunner();
  const cannon = built(p);
  p.setAttribute(Cannon.LOST_ATTRIBUTE, { kind: "plain", stage: 4 });
  const event = { npcId: core.NpcIdentifiers.NULODION, player: p, kind: "message", text: Nulodion.GIVES_CANNON };
  Nulodion.giveCannon(event);
  assert.ok(p.getAttribute(Cannon.LOST_ATTRIBUTE), "cannot reclaim while a cannon stands");
  Cannon.forget(cannon);
  for (let i = 0; i < 26; i++) p.getInventory().add(new core.Item(Items.SPADE, 1), false);
  Nulodion.giveCannon(event);
  assert.ok(p.getAttribute(Cannon.LOST_ATTRIBUTE), "cannot lose replacement to a full inventory");
});

test("firing zones match all49 tiles in the Wiki Cannon Double Shot.png diagram", () => {
  // Wiki https://oldschool.runescape.wiki/images/Cannon_Double_Shot.png, centred on the barrel.
  // Green=2 shots/revolution, grey=1, red/centre=0. Rows north to south.
  const expected = [
    [1, 1, 2, 1, 2, 1, 1],
    [1, 1, 2, 1, 2, 1, 1],
    [2, 2, 1, 0, 1, 2, 2],
    [1, 1, 0, 0, 0, 1, 1],
    [2, 2, 1, 0, 1, 2, 2],
    [1, 1, 2, 1, 2, 1, 1],
    [1, 1, 2, 1, 2, 1, 1],
  ];
  for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
    const shots = Data.DIRECTIONS.filter((_, direction) => Data.inZone(direction, col - 3, 3 - row)).length;
    assert.equal(shots, expected[row][col], `Wiki tile ${col - 3},${3 - row}`);
  }
});

test("new restricted outlines use existing content bounds and the Wiki Hair of the Dog polygon", () => {
  for (const [name, x, y, z] of [
    ["Callisto's Den", 3359, 10335, 0], ["Vet'ion's Rest", 3295, 10203, 1],
    ["Silk Chasm", 3423, 10212, 2], ["Ancient Prison", 2856, 5225, 0],
    ["Scurrius' Lair", 3300, 9865, 0], ["Ungael", 2272, 4064, 0],
    ["Kraken Cove", 2270, 10010, 0], ["Hair of the Dog", 3495, 3475, 0],
  ]) {
    const restriction = Restrictions.load().restrictions.find((entry) => entry.name === name);
    assert.equal(Restrictions.restrictionAt(new core.Location(x, y, z)), restriction.message, name);
  }
  assert.equal(Restrictions.restrictionAt(new core.Location(3495, 3467, 0)), null, "outside the pub polygon");
  assert.equal(Restrictions.restrictionAt(new core.Location(3295, 10203, 0)), null, "Vet'ion plane is respected");
});

test("sailing boats reject cannon setup through the actual boarded boat state", () => {
  const p = gunner();
  const original = core.BoatManager.getBoatAboard;
  try {
    core.BoatManager.getBoatAboard = () => ({});
    assert.equal(Setup.refusal(p, 'plain'), Restrictions.load().default);
  } finally {
    core.BoatManager.getBoatAboard = original;
  }
});

test("Nulodion preserves decayed cannon ammunition, loaded in the next cannon exactly once", () => {
  const p = gunner({ steel: 0, granite: 12 });
  const cannon = built(p);
  cannon.age = Data.LOSE_TICKS - 1;
  runTicks(p, 1);
  Nulodion.giveCannon({ npcId: core.NpcIdentifiers.NULODION, player: p, kind: 'message', text: Nulodion.GIVES_CANNON });
  assert.deepEqual(p.getAttribute(Cannon.RECOVERED_AMMO_ATTRIBUTE), { steel: 0, granite: 12 });
  const restored = built(p);
  assert.equal(restored.granite, 12);
  assert.equal(restored.steel, 0);
  assert.equal(p.getAttribute(Cannon.RECOVERED_AMMO_ATTRIBUTE), null);
  assert.equal(p.getAttribute(Cannon.LOST_ATTRIBUTE), null);
  Decay.pickUp({ player: p, object: restored.object });
  assert.equal(p.getInventory().getAmount(Items.GRANITE_CANNONBALL), 12);
});

test("Wiki source polygons, source map regions and canonical content bounds cover the remaining proven areas", () => {
  for (const [name, x, y, z] of [
    ['Feldip Hills jungle hunter area', 2558, 2911, 0], ['Brutus arena', 3261, 3287, 0],
    ['Fight Arena interior', 2603, 3156, 0], ['Forthos Dungeon', 1840, 9900, 0],
    ['Lizardman Caves', 1307, 9951, 0], ['Mogre Camp', 2960, 9512, 1],
    ['Ruins of Tapoyauik', 1602, 9631, 0], ['Tonali Cavern', 1311, 9382, 0],
    ['Vanstrom Klause', 3575, 3352, 0], ['Uzer Mastaba', 3850, 4578, 0],
    ['Uzer Mastaba', 3892, 4714, 0], ['Abyssal Area', 3040, 4896, 0],
    ['Barbarian Assault', 1888, 5440, 0], ['Barbarian Assault', 2592, 5280, 0],
    ['Jiggig Dungeon', 2477, 9436, 2], ['Jiggig Dungeon', 2446, 9418, 0],
    ['Fossil Island bank chest island', 3765, 3899, 0], ['Scabaras Dungeon', 3410, 9239, 0],
    ['Scabaras Dungeon', 3372, 9248, 0], ['Scabaras Dungeon', 3445, 9248, 2],
    ['Shellbane Gryphon Cave', 3179, 8876, 0],
  ]) {
    const entry = Restrictions.load().restrictions.find((r) => r.name === name);
    assert.equal(Restrictions.restrictionAt(new core.Location(x, y, z)), entry.message, name);
  }
  assert.equal(Restrictions.restrictionAt(new core.Location(3733, 3893, 0)), null, 'Fossil Island mainland remains allowed');
  assert.equal(Restrictions.restrictionAt(new core.Location(3765, 3899, 1)), null, 'bank island is on the surface');
  assert.equal(Restrictions.restrictionAt(new core.Location(2617, 2911, 0)), null, 'outside the Wiki hunter polygon');
  assert.equal(Restrictions.restrictionAt(new core.Location(2988, 4896, 0)), null, 'outside the exact Abyssal Area source region');
});

test("Karuulm restriction covers the two wyrm rooms and Alchemical Hydra, preserving normal hydras and other floors", () => {
  const entry = Restrictions.load().restrictions.find((r) => r.name === 'Karuulm Slayer Dungeon');
  for (const [x, y] of [[1259, 10154], [1268, 10191], [1364, 10265]]) {
    assert.equal(Restrictions.restrictionAt(new core.Location(x, y, 0)), entry.message);
  }
  assert.equal(Restrictions.restrictionAt(new core.Location(1304, 10260, 0)), null, 'normal hydras allow cannons');
  assert.equal(Restrictions.restrictionAt(new core.Location(1308, 10253, 1)), null, 'drakes allow cannons');
});

test("Tower of Magic restriction applies only during Ascent of Arceuus, through the quest stage event", () => {
  let stage = 0;
  const player = gunner();
  const location = new core.Location(1589, 3819, 0);
  Cannon.init({ core, emitCustomEvent: (name, request) => {
    if (name === 'quest:get-stage' && request.key === 'the_ascent_of_arceuus' && request.player === player) request.stage = stage;
  } });
  try {
    assert.equal(Restrictions.restrictionAt(location, null, player), null);
    for (stage of [1, 5, 13]) assert.equal(Restrictions.restrictionAt(location, null, player), "You can't set up a cannon here.");
    stage = 14;
    assert.equal(Restrictions.restrictionAt(location, null, player), null, 'completed quest permits setup');
    assert.equal(Restrictions.restrictionAt(location.transform(0, 0, 2), null, player), null, 'unrelated plane');
  } finally { Cannon.init({ core, emitCustomEvent() {} }); }
});

test("cache-derived room restrictions match closed walkable components and cannot include another valid cannon room", () => {
  const rooms = [
    ['Fight Arena interior', 2603, 3156, 0, 382, [2583, 3152, 2606, 3170]],
    ['Karuulm Slayer Dungeon', 1259, 10154, 0, 299, [1251, 10147, 1276, 10170]],
    ['Karuulm Slayer Dungeon', 1268, 10191, 0, 603, [1256, 10175, 1301, 10206]],
    ['Karuulm Slayer Dungeon', 1364, 10265, 0, 472, [1356, 10257, 1377, 10278]],
    ['Scabaras Dungeon', 3410, 9239, 0, 578, [3406, 9220, 3439, 9275]],
    ['Scabaras Dungeon', 3372, 9248, 0, 102, [3368, 9244, 3389, 9252]],
    ['Scabaras Dungeon', 3390, 9248, 0, 90, [3390, 9243, 3405, 9253]],
    ['Scabaras Dungeon', 3445, 9248, 2, 73, [3433, 9243, 3445, 9253]],
    ['Scabaras Dungeon', 3427, 9248, 2, 34, [3421, 9247, 3432, 9249]],
    ['Scabaras Dungeon', 3411, 9251, 2, 116, [3407, 9244, 3420, 9252]],
    ['Shellbane Gryphon Cave', 3179, 8876, 0, 275, [3167, 8865, 3190, 8882]],
  ];
  for (const [name, startX, startY, z, count, box] of rooms) {
    core.RegionManager.loadMapFiles(startX, startY);
    const queue = [[startX, startY]], seen = new Set([`${startX},${startY}`]);
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (seen.has(key) || !core.RegionManager.canMove(x, y, nx, ny, z, 1, 1, null)) continue;
        assert.ok(Math.abs(nx - startX) < 140 && Math.abs(ny - startY) < 140, `${name}: component must close naturally`);
        seen.add(key); queue.push([nx, ny]);
      }
    }
    assert.equal(queue.length, count, name);
    assert.deepEqual([Math.min(...queue.map(([x]) => x)), Math.min(...queue.map(([, y]) => y)), Math.max(...queue.map(([x]) => x)), Math.max(...queue.map(([, y]) => y))], box, name);
    const entry = Restrictions.load().restrictions.find((r) => r.name === name);
    for (const [x, y] of queue) assert.equal(Restrictions.restrictionAt(new core.Location(x, y, z)), entry.message, `${name}: ${x},${y}`);
    for (let x = box[0] + 1; x < box[2]; x++) for (let y = box[1] + 1; y < box[3]; y++) {
      if (seen.has(`${x},${y}`)) continue;
      assert.ok(Setup.footprint(new core.Location(x - 1, y - 1, z)).some((tile) => core.RegionManager.blocked(tile, null)), `${name}: no unrelated valid cannon centre at ${x},${y}`);
    }
  }
});
