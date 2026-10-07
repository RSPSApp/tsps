// Run after `yarn build`: node --test tests/wyrmscraig.test.cjs
// Wyrmscraig: open access, the cave, the shortcuts' data, and the Mad Angel's data, drops and
// fight rules, each against the captures in docs/wyrmscraig.md.
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");
const Wyrmscraig = require("../plugins/areas/Wyrmscraig.plugin");
const AreaCommon = require("../plugins/areas/wyrmscraig/Common.Wyrmscraig");
const MadAngel = require("../plugins/bosses/MadAngel.plugin");
const Common = require("../plugins/bosses/madangel/Common.MadAngel");
const { Fight, quarter } = require("../plugins/bosses/madangel/Fight.MadAngel");
const { SHORTCUTS } = require("../plugins/skills/agility/shortcuts");

const core = PluginManager.getCoreApi();
const objectHooks = new Map();
const loginHooks = [];
const api = new Proxy({
  core,
  onObjectInteraction: (name, actions) => objectHooks.set(name, { ...(objectHooks.get(name) ?? {}), ...actions }),
  onPlayerLogin: (handler) => loginHooks.push(handler),
}, { get: (target, key) => target[key] ?? (() => {}) });

let gamevals = null;
const runTicks = (n = 1) => { for (let i = 0; i < n; i++) TaskManager.process(); };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  gamevals = new Gamevals();
  Wyrmscraig.register(api);
  MadAngel.register(api);
  NpcDrops.register(api);
});

function createPlayer({ x = 2530, y = 2205, prayers = [] } = {}) {
  const log = [];
  const hits = [];
  const attributes = new Map();
  const active = [];
  for (const prayer of prayers) active[prayer] = true;
  let location = new Location(x, y, 0);
  const sender = new Proxy({}, {
    get: (_target, method) => (...args) => {
      if (method === "sendVarbit" || method === "sendSoundEffect") log.push(`${method} ${args.slice(0, 3).join(" ")}`);
      if (method === "sendSubInterface") log.push(`fade ${args[3]?.postScripts?.[0]?.args?.[1]}`);
      if (method === "sendGraphic") log.push(`graphic ${args[0].id}`);
      return sender;
    },
  });
  return {
    log, hits, active,
    isPlayer: () => true,
    isRegistered: () => true,
    getLocation: () => location,
    moveTo: (to) => { location = to; log.push(`move ${to.getX()} ${to.getY()}`); },
    setLocation: (to) => { location = to; },
    setPositionToFace: () => {},
    performAnimation: (animation) => log.push(`anim ${animation.getId?.() ?? animation.id}`),
    performGraphic: (graphic) => log.push(`gfx ${graphic.id}`),
    performGraphicInSlot: (slot, graphic) => log.push(`gfx ${graphic.id}`),
    getMovementQueue: () => ({ reset() {} }),
    getPacketSender: () => sender,
    getPrayerActive: () => active,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (damage) => hits.push(...damage.map((d) => d.getDamage())) }) }),
  };
}

// ------------------------------------------------------------------ data

test("the data: every id is the cache's, under the names the captures print", () => {
  const loc = (id) => CacheDefinitions.getObject(id);
  const seq = gamevals.namesOf(GamevalKind.SEQ);
  const spotanim = gamevals.namesOf(GamevalKind.SPOTANIM);
  const varbit = gamevals.namesOf(GamevalKind.VARBIT);
  const { cave, openAccess } = AreaCommon.data;
  assert.deepEqual(openAccess.varbits.map(({ id }) => varbit.get(id)), ["ffg", "wyrmscraig_cliff_shortcut"]);
  assert.deepEqual([loc(cave.entrance.id).name, loc(cave.entrance.id).actions[0]], ["Cave", "Enter"]);
  assert.deepEqual([loc(cave.exit.id).name, loc(cave.exit.id).actions[0]], ["Cave", "Exit"]);

  const data = Common.data;
  for (const id of Object.values(data.npcs).filter((id) => id !== data.npcs.cathedral)) assert.equal(CacheDefinitions.getNpc(id).name, "Mad Angel");
  assert.equal(CacheDefinitions.getNpc(data.npcs.dormant).actions[0], "Wake");
  assert.equal(CacheDefinitions.getNpc(data.npcs.fighting).actions[1], "Attack");
  assert.deepEqual(loc(data.pew.climbId).actions.slice(0, 1), ["Climb"]);
  assert.deepEqual(loc(data.pew.exitId).actions.slice(0, 2), ["Exit", "Quick-exit"]);
  for (const id of data.doors.ids) assert.equal(loc(id).name, "Cathedral door");
  for (const id of [data.wake.anim, data.melee.anim, data.blast.anim, data.smite.anim, data.smite.enragedAnim, data.death.anim,
    ...Object.values(data.sweep.anims).flatMap(Object.values), ...Object.values(data.sweep.enragedAnims).flatMap(Object.values)]) {
    assert.match(seq.get(id), /^npc_mad_angel_/, `seq ${id}`);
  }
  for (const id of [data.wake.spotanim, data.blast.spotanim, data.blast.projectile, data.blast.bounceSpotanim, data.blast.explosion,
    data.smite.spotanim, data.smite.enragedSpotanim, data.smite.impact]) {
    assert.match(spotanim.get(id), /^vfx_mad_angel_/, `spotanim ${id}`);
  }
  assert.equal(gamevals.namesOf(GamevalKind.VARP).get(data.killCountVarp), "total_mad_angel_kills");
  assert.equal(NpcDefinition.forId(data.npcs.fighting).getDeathTicks(), 7, "the kill lands 7 ticks into the death animation");
  assert.equal(NpcDefinition.forId(1).getDeathTicks(), 2, "everything else keeps the usual 2");
});

test("the shortcuts: levels and ends as the Wiki and the capture have them", () => {
  const wyrmscraig = [62260, 62262, 62261, 62267, 62265].map((id) => SHORTCUTS.find((shortcut) => shortcut.object === id));
  assert.deepEqual(wyrmscraig.map((shortcut) => [shortcut.object, shortcut.level, shortcut.xp]),
    [[62260, 58, 5], [62262, 62, 5], [62261, 72, 5], [62267, 54, 5], [62265, 54, 5]]);
  const steps = (shortcut, x, y) => shortcut.steps({ pos: { x, y, z: 0 }, obj: { x, y, z: 0 } });
  const basalt = steps(wyrmscraig[0], 2584, 2286).filter((step) => step.move).map((step) => step.move.slice(0, 2));
  assert.deepEqual(basalt, [[2584, 2284], [2584, 2282], [2584, 2280]], "two tiles a jump, three jumps");
  const jump = steps(wyrmscraig[1], 2565, 2217).find((step) => step.move);
  assert.deepEqual([jump.anim, jump.delay, jump.speed, jump.ticks], [741, 15, [30, 45], 2], "as captured");
  const up = steps(wyrmscraig[3], 2554, 2209).find((step) => step.move);
  const down = steps(wyrmscraig[4], 2550, 2209).find((step) => step.move);
  assert.deepEqual([up.move.slice(0, 2), up.anim, down.move.slice(0, 2), down.anim], [[2550, 2209], 4435, [2554, 2209], 740]);
});

// ------------------------------------------------------------------ open access and the cave

test("open access: every login gets Fallen From Grace's finished state", () => {
  const player = createPlayer();
  for (const hook of loginHooks) hook({ player });
  assert.ok(player.log.includes("sendVarbit 15759 20"));
  assert.ok(player.log.includes("sendVarbit 15720 1"));
});

test("as captured: the cave - the crawl, the fade, the move 2 ticks in, and back out", () => {
  const { Enter, Exit } = objectHooks.get("Cave");
  const object = (id, x, y) => ({ objectId: id, object: { getLocation: () => new Location(x, y, 0) } });
  const player = createPlayer();
  assert.equal(Enter({ player, ...object(1234, 2529, 2206) }), false, "other caves are their own");
  assert.equal(Enter({ player, ...object(62219, 2529, 2206) }), true);
  assert.deepEqual(player.log.slice(0, 2), ["anim 2796", "sendSoundEffect 2454 3 4"]);
  assert.ok(player.log.includes("fade 255"));
  runTicks(2);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2564, 8630]);
  runTicks(1);
  assert.ok(player.log.includes("fade 0"));
  Exit({ player, ...object(62220, 2562, 8629) });
  runTicks(3);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2530, 2205]);
});

// ------------------------------------------------------------------ drops

test("the drop table, corrected: no quest crystal, a 1/25 teleport, the supply batch bundled, the Wiki's noted drops, 150 in all", () => {
  const { loadDrops, tablesByNpc } = NpcDrops.__internals;
  loadDrops();
  const table = [tablesByNpc.get(16305)].flat()[0];
  assert.ok(table, "the Mad Angel has its table");
  const entries = table.entries;
  assert.ok(!entries.some((entry) => entry.item_id === 34032), "the sunstone crystal is Fallen From Grace's");
  assert.equal(entries.find((entry) => entry.item_id === 34033).out_of, 25);
  const main = entries.filter((entry) => !entry.always && !entry.pre_roll && Number.isInteger(entry.weight)).reduce((sum, entry) => sum + entry.weight, 0);
  assert.equal(main, 150);
  assert.equal(table.main_max_roll, 150);
  const batch = entries.filter((entry) => entry.section === "Supply batch");
  assert.deepEqual(batch.map((entry) => [entry.name, entry.weight, entry.bonus_drops.map((bonus) => bonus.name)]), [
    ["Shark", 8, ["Prayer potion(2)", "Super combat potion(1)"]],
    ["Yellowfin", 8, ["Prayer potion(2)", "Super combat potion(1)"]],
  ]);
  assert.deepEqual(entries.filter((entry) => entry.noted).map((entry) => entry.name),
    ["Super combat potion(3)", "Raw monkfish", "Emerald", "Sapphire"], "as the Wiki marks them");
  for (const entry of entries.filter((entry) => entry.noted)) {
    const noteId = ItemDefinition.forId(entry.item_id).getNoteId();
    assert.ok(noteId >= 0 && ItemDefinition.forId(noteId).isNoted(), `${entry.name} has a noted form`);
  }
});

// ------------------------------------------------------------------ the fight's rules

test("as captured: each cleave hits the quarter between the front a step before and the sword's side", () => {
  // Every cleave in the capture: [front the step before, sword side, the quarter its dust covered].
  const cleaves = [["E", "right", "ES"], ["W", "left", "WS"], ["E", "right", "ES"], ["E", "right", "ES"], ["N", "left", "WN"],
    ["W", "right", "WN"], ["S", "right", "WS"], ["N", "right", "EN"], ["E", "right", "ES"], ["S", "right", "WS"]];
  for (const [front, side, expected] of cleaves) assert.equal(quarter(front, side), expected, `${front} ${side}`);
});

/** A fight against a fake angel in a fake cathedral (instance tiles = world tiles). */
function fightAt(player, { hitpoints = 755 } = {}) {
  let hp = hitpoints;
  const npcLog = [];
  const bossHits = [];
  const npc = {
    isNpc: () => true,
    getLocation: () => new Location(2532, 2215, 0),
    getHitpoints: () => hp,
    setHitpoints: (value) => { hp = value; },
    getDefinition: () => ({ getHitpoints: () => 755 }),
    setNpcTransformationId: (id) => npcLog.push(`transform ${id}`),
    performAnimation: (animation) => npcLog.push(`anim ${animation.getId?.() ?? animation.id}`),
    performGraphicInSlot: (slot, graphic) => npcLog.push(`gfx ${graphic.id}`),
    setPositionToFace: () => {},
    faceTile: (tile) => npcLog.push(`face ${tile.getX()} ${tile.getY()}`),
    forceChat: (text) => npcLog.push(`say ${text}`),
    setFlag: (flag, enabled = true) => npcLog.push(`flag ${flag} ${enabled}`),
    getMovementQueue: () => ({ setBlockMovement() { return this; }, reset() {} }),
    getCombat: () => ({
      attack: () => npcLog.push("attack"),
      reset: () => npcLog.push("out of combat"),
      setAttackDelay: (ticks) => npcLog.push(`delay ${ticks}`),
      getLastAttack: () => ({ reset() {} }),
      getHitQueue: () => ({ addPendingDamage: (damage) => bossHits.push(...damage.map((d) => d.getDamage())) }),
    }),
  };
  const session = {
    player,
    area: null,
    tile: ([x, y, z]) => new Location(x, y, z ?? 0),
    worldTile: (location) => [location.getX(), location.getY()],
  };
  const fight = new Fight(session, npc);
  fight.melee = () => { npcLog.push("melee"); fight.attacks++; return []; };
  fight.startTick = 0;
  return { fight, npc, npcLog, bossHits, step: (n = 1) => { for (let i = 0; i < n; i++) fight.process(); } };
}

test("the attack cycle: three swings, then a special in turn; the sweep holds its swings", () => {
  const player = createPlayer({ x: 2535, y: 2215 });
  const { fight, npcLog } = fightAt(player);
  for (let i = 0; i < 3; i++) fight.attack(player);
  assert.deepEqual(npcLog.filter((line) => line === "melee").length, 3);
  fight.attack(player);
  assert.equal(fight.special.kind, "sweep");
  assert.ok(npcLog.includes("anim 14429") || npcLog.includes("anim 14433"), "the wind-up, sword to one side");
  fight.attack(player);
  assert.equal(npcLog.filter((line) => line === "melee").length, 3, "no swing during the sweep");
  assert.ok(npcLog.includes("out of combat") && npcLog.includes("flag combat:no-retaliate true"),
    "it holds its facing: out of combat, hits included, until the sweep is over");
  assert.ok(npcLog.includes("face 2538 2216"), "turned to face the player (east), as a face-coordinate turn");
});

test("the sweep: in the quarter it hurts; out of it, beside the angel, the next hit is sure", () => {
  const caught = createPlayer({ x: 2535, y: 2215 });
  const one = fightAt(caught);
  one.fight.startSweep();
  one.fight.special.side = "right";
  one.step(6);
  assert.equal(caught.hits.length, 1, "east of the angel with the sword right: the south-east quarter");

  const dodger = createPlayer({ x: 2535, y: 2215 });
  const two = fightAt(dodger);
  two.fight.startSweep();
  two.fight.special.side = "right";
  dodger.setLocation(new Location(2534, 2219, 0));
  two.step(6);
  assert.equal(dodger.hits.length, 0);
  assert.equal(dodger.getAttribute("mad-angel:next-hit"), "accurate", "beside it, away from the sword");
});

test("the blast: stood on, it bounces back at the angel; missed, it blows up the floor", () => {
  const player = createPlayer({ x: 2530, y: 2215 });
  const { fight, step, bossHits } = fightAt(player);
  fight.startBlast();
  const target = fight.special.target;
  player.setLocation(target);
  step(6);
  assert.equal(fight.special.throws, 2, "bounced, and thrown again");
  step(2);
  assert.equal(bossHits.length, 1);
  assert.ok(bossHits[0] >= 18 && bossHits[0] <= 22);
  player.setLocation(new Location(2535, 2219, 0));
  step(4);
  assert.equal(fight.special, null);
  assert.equal(player.hits.length, 1, "the explosion");
  assert.ok(player.log.filter((line) => line === "graphic 4016").length >= 100, "over the whole floor");
});

test("the smite: Protect from Magic turned on as it lands blocks it and makes the next hit a max hit", () => {
  const { PROTECT_FROM_MAGIC } = core.PrayerHandler;
  const flicker = createPlayer();
  const flick = fightAt(flicker);
  flick.fight.startSmite();
  flick.step(5);
  flicker.active[PROTECT_FROM_MAGIC] = true;
  flick.step(1);
  assert.deepEqual(flicker.hits, [0]);
  assert.equal(flicker.getAttribute("mad-angel:next-hit"), "max");

  const steady = createPlayer({ prayers: [PROTECT_FROM_MAGIC] });
  const held = fightAt(steady);
  held.fight.startSmite();
  held.step(6);
  assert.ok(steady.hits[0] <= Math.floor(31 * 0.25), "a quarter through a prayer already up");
});

test("the enrage: at 350 hitpoints, '...!' at its next turn, then the smite, the blast and the sweep in a row", () => {
  const player = createPlayer({ x: 2535, y: 2215 });
  const { fight, npcLog, step } = fightAt(player, { hitpoints: 340 });
  step(1);
  fight.attack(player);
  assert.ok(npcLog.includes("say ...!"));
  fight.attack(player);
  assert.equal(fight.special.kind, "smite");
  assert.ok(npcLog.includes("anim 8543"), "the enraged smite");
});
