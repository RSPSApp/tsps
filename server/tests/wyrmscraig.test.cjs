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
const { DialogueManager } = require("../dist/game/model/dialogues/DialogueManager");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");
const Wyrmscraig = require("../plugins/areas/Wyrmscraig.plugin");
const AreaCommon = require("../plugins/areas/wyrmscraig/Common.Wyrmscraig");
const MadAngel = require("../plugins/bosses/MadAngel.plugin");
const Common = require("../plugins/bosses/madangel/Common.MadAngel");
const { Fight, quarter, sweepTiles } = require("../plugins/bosses/madangel/Fight.MadAngel");
const { SHORTCUTS } = require("../plugins/skills/agility/shortcuts/Shortcuts.Agility");

const core = PluginManager.getCoreApi();
const objectHooks = new Map();
const loginHooks = [];
const customHooks = new Map();
const spawnedNpcs = [];
const deathHooks = [];
const api = new Proxy({
  core,
  onObjectInteraction: (name, actions) => objectHooks.set(name, { ...(objectHooks.get(name) ?? {}), ...actions }),
  onPlayerLogin: (handler) => loginHooks.push(handler),
  onCustomEvent: (name, handler) => customHooks.set(name, [...(customHooks.get(name) ?? []), handler]),
  emitCustomEvent: (name, event) => { for (const handler of customHooks.get(name) ?? []) handler(event); },
  spawnNpc: (definition) => {
    const npc = {
      ...definition,
      getId: () => definition.id,
      getRealId: () => definition.id,
      getLocation: () => new Location(definition.x, definition.y, definition.z ?? 0),
      log: [],
      setArea() {},
      getArea: () => null,
      setNpcTransformationId(id) { npc.log.push(`transform ${id}`); },
      performAnimation(animation) { npc.log.push(`anim ${animation.getId?.() ?? animation.id}`); },
      performGraphicInSlot(slot, graphic) { npc.log.push(`gfx ${graphic.id}`); },
      faceTile() {},
      getSize: () => 3,
      isRegistered: () => true,
    };
    spawnedNpcs.push(npc);
    return npc;
  },
  removeNpc: () => {},
  onNpcDeath: (handler) => deathHooks.push(handler),
  sendMultiChatboxPrompt: (player, title, ...pairs) => { player.prompt = { title, pairs }; return true; },
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
      if (method === "sendInterface") log.push(`interface ${args[0]}`);
      if (method === "sendInterfaceScript") log.push(`script ${args[0]} ${JSON.stringify(args[1])}`);
      return sender;
    },
  });
  return {
    log, hits, active,
    isPlayer: () => true,
    isRegistered: () => true,
    getLocation: () => location,
    moveTo: (to) => { location = to; log.push(`move ${to.getX()} ${to.getY()}`); },
    sendMessage: (message) => log.push(`message ${message}`),
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
    setEnteredAmountAction(value) { this.amountAction = value; },
    getEnteredAmountAction() { return this.amountAction; },
    setInterfaceId(value) { this.interfaceId = value; },
    getInterfaceId() { return this.interfaceId; },
    getDialogueManager() { return (this.dialogues ??= new DialogueManager(this)); },
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (damage) => hits.push(...damage.map((d) => d.getDamage())) }) }),
  };
}

// ------------------------------------------------------------------ data

test("the data: every id is the cache's, under the names the captures print", () => {
  const loc = (id) => CacheDefinitions.getObject(id);
  const seq = gamevals.namesOf(GamevalKind.SEQ);
  const spotanim = gamevals.namesOf(GamevalKind.SPOTANIM);
  const { cave } = AreaCommon.data;
  assert.deepEqual([loc(cave.entrance.id).name, loc(cave.entrance.id).actions[0]], ["Cave", "Enter"]);
  assert.deepEqual([loc(cave.exit.id).name, loc(cave.exit.id).actions[0]], ["Cave", "Exit"]);

  const data = Common.data;
  for (const id of Object.values(data.npcs).filter((id) => id !== data.npcs.cathedral)) assert.equal(CacheDefinitions.getNpc(id).name, "Mad Angel");
  assert.deepEqual(data.questNpcs, { dormant: 16306, waking: 16311, fighting: 16309, dead: 16312 });
  assert.equal(NpcDefinition.forId(data.questNpcs.fighting).getHitpoints(), 565, "quest fight hp");
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

test("Wyrmscraig leaves the quest and mined shortcut state to Fallen From Grace", () => {
  const player = createPlayer();
  for (const hook of loginHooks) hook({ player });
  assert.equal(player.log.some((line) => line.startsWith("sendVarbit 15720")), false,
    "Fallen From Grace owns the mined shortcut state");
  assert.equal(player.log.some((line) => line.startsWith("sendVarbit 15759")), false,
    "Fallen From Grace owns 15759; Wyrmscraig must not force its finished state");
});

test("as captured: the Mad Angel door is claimed by Fallen From Grace until its lock is picked", () => {
  const namedObjects = new Map();
  const custom = new Map();
  const doorApi = new Proxy({
    core,
    onObjectInteraction: (name, actions) => {
      if (typeof name === "string") namedObjects.set(name, { ...(namedObjects.get(name) ?? {}), ...actions });
    },
    onCustomEvent: (name, fn) => custom.set(name, [...(custom.get(name) ?? []), fn]),
    emitCustomEvent: (name, event) => { for (const fn of custom.get(name) ?? []) fn(event); },
    sendMultiChatboxPrompt: (player, title, ...pairs) => { player.prompt = { title, pairs }; return true; },
  }, { get: (target, key) => target[key] ?? (() => {}) });

  MadAngel.register(doorApi);
  require("../plugins/quests/quests/FallenFromGrace.Quest")(doorApi);
  const ffg = require("../plugins/quests/QuestRuntime").getRegisteredQuests()
    .filter((quest) => quest.key === "fallen_from_grace").at(-1);
  const door = namedObjects.get("Cathedral door").Open;

  const locked = createPlayer({ x: 2542, y: 2215 });
  ffg.setStage(locked, 18);
  const random = Math.random;
  Math.random = () => 7152.5 / 7776; // the captured second 811 session's code
  assert.equal(door({ player: locked, objectId: 62368 }), true);
  assert.equal(locked.prompt?.title, "You attempt to open the doors, but they appear to be locked.");
  locked.prompt.pairs[1](locked);
  Math.random = random;
  assert.ok(locked.log.includes("interface 811"), 'the real 5-pin lock UI opens');
  assert.ok(locked.log.some((line) => line.startsWith("script 6994")), 'the 811 renderer runs');
  assert.ok(locked.amountAction, 'the real amount callback is armed');
  assert.equal(locked.log.some((line) => line.startsWith("anim 4282")), false, "FFG claims the first pick, no movement");
  assert.equal(locked.getLocation().getX(), 2542);
  locked.amountAction.execute(7152); // captured second 811 session, P2 tick 621
  assert.ok(locked.getDialogueManager().getCurrent()?.getText?.().includes("successfully pick the lock"));
  assert.ok(locked.getAttribute('quest.fallen_from_grace.flags') & (1 << 7), 'CATHEDRAL_OPENED set by the lock');

  assert.equal(door({ player: locked, objectId: 62368 }), true);
  assert.ok(locked.log.some((line) => line.startsWith("anim 4282")), "the opened door falls through to MadAngel");
  runTicks(1);
  assert.notEqual(locked.getLocation().getX(), 2542, "the default door movement runs once FFG releases it");

  const finished = createPlayer({ x: 2542, y: 2215 });
  ffg.setStage(finished, 20);
  assert.equal(door({ player: finished, objectId: 62368 }), true);
  assert.ok(finished.log.some((line) => line.startsWith("anim 4282")), "post-quest door is ordinary MadAngel access");
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

test("the drop table, corrected: the sunstone crystal always, a 1/25 teleport, the supply batch bundled, the Wiki's noted drops, 150 in all", () => {
  const { loadDrops, tablesByNpc } = NpcDrops.__internals;
  loadDrops();
  const table = [tablesByNpc.get(16305)].flat()[0];
  assert.ok(table, "the Mad Angel has its table");
  const entries = table.entries;
  const crystal = entries.find((entry) => entry.item_id === 34032);
  assert.ok(crystal?.always, "the sunstone crystal is on the 100% table (Wiki; dropped by the quest's kill, rsprox P2 tick 431)");
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

test("quest Mad Angel instance spawns raw 16306 and uses the 16311/16309/16312 chain", () => {
  const Instance = require("../plugins/bosses/madangel/Instance.MadAngel");
  Common.init(api);
  customHooks.set("madangel:instance-variant", [(request) => { request.variant = "quest"; }]);
  const questPlayer = createPlayer({ x: 2532, y: 2215 });
  const questSession = Instance.open(questPlayer);
  assert.equal(questSession.variant, "quest");
  assert.equal(spawnedNpcs.at(-1).getId(), 16306, "instance starts from the captured raw dormant base");
  assert.equal(questSession.npcs.fighting, 16309);

  customHooks.delete("madangel:instance-variant");
  const normalPlayer = createPlayer({ x: 2532, y: 2215 });
  const normalSession = Instance.open(normalPlayer);
  assert.equal(normalSession.variant, "normal");
  assert.equal(spawnedNpcs.at(-1).getId(), 16305, "ordinary boss spawn is unchanged");
  assert.equal(normalSession.npcs.fighting, 16305);
});

test("the quest fight transforms to 16311 then 16309 and resets HP to 565; ordinary stays 755", () => {
  const quest = fightAt(createPlayer(), { hitpoints: 755, maxHitpoints: 565, npcs: Common.data.questNpcs });
  quest.fight.wake();
  assert.ok(quest.npcLog.includes("transform 16311"), "quest waking form");
  quest.fight.begin();
  assert.ok(quest.npcLog.includes("transform 16309"), "quest fighting form");
  assert.equal(quest.npc.getHitpoints(), 565, "quest fight HP from the 16309 definition");

  const normal = fightAt(createPlayer(), { npcs: Common.data.npcs });
  normal.fight.wake();
  normal.fight.begin();
  assert.ok(normal.npcLog.includes("transform 16307"), "ordinary waking form");
  assert.ok(normal.npcLog.includes("transform 16305"), "ordinary fighting form");
  assert.equal(normal.npc.getHitpoints(), 755, "ordinary boss HP unchanged");
});

// ------------------------------------------------------------------ the fight's rules

test("as captured: each cleave hits the quarter between the front a step before and the sword's side", () => {
  // Every cleave in the capture: [front the step before, sword side, the quarter its dust covered].
  const cleaves = [["E", "right", "ES"], ["W", "left", "WS"], ["E", "right", "ES"], ["E", "right", "ES"], ["N", "left", "WN"],
    ["W", "right", "WN"], ["S", "right", "WS"], ["N", "right", "EN"], ["E", "right", "ES"], ["S", "right", "WS"]];
  for (const [front, side, expected] of cleaves) assert.equal(quarter(front, side), expected, `${front} ${side}`);
});

/** A fight against a fake angel in a fake cathedral (instance tiles = world tiles). */
function fightAt(player, { hitpoints = 755, maxHitpoints = 755, npcs = Common.data.npcs, variant = "normal" } = {}) {
  let hp = hitpoints;
  const npcLog = [];
  const bossHits = [];
  const npc = {
    isNpc: () => true,
    getLocation: () => new Location(2532, 2215, 0),
    getHitpoints: () => hp,
    setHitpoints: (value) => { hp = value; },
    getMaxHitpoints: () => maxHitpoints,
    getDefinition: () => ({ getHitpoints: () => 755 }),
    setNpcTransformationId: (id) => npcLog.push(`transform ${id}`),
    performAnimation: (animation) => npcLog.push(`anim ${animation.getId?.() ?? animation.id}`),
    performGraphicInSlot: (slot, graphic) => npcLog.push(`gfx ${graphic.id} slot ${slot}`),
    setPositionToFace: () => {},
    setMobileInteraction: () => {},
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
    npcs,
    variant,
    area: null,
    tile: ([x, y, z]) => new Location(x, y, z ?? 0),
    worldTile: (location) => [location.getX(), location.getY()],
  };
  const fight = new Fight(session, npc);
  fight.melee = () => { npcLog.push("melee"); fight.attacks++; return []; };
  fight.startTick = 0;
  // Its blows land in the player's turn, after their clicks; then the area samples the prayer.
  const blows = [];
  fight.blow = (kind) => blows.push(kind);
  const playerTurn = () => {
    for (const kind of blows.splice(0)) {
      let damage = 0;
      fight.resolveBlow({ setTotalDamage: (value) => { damage = value; } }, kind);
      player.hits.push(damage);
    }
    fight.samplePrayer();
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      fight.process();
      playerTurn();
    }
  };
  return { fight, npc, npcLog, bossHits, step, setHitpoints: (value) => { hp = value; } };
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
  assert.ok(npcLog.includes("face 2537 2215"), "turned to face the player (east), as a face-coordinate turn (sent a tile down-left: the client offsets it by the angel's size)");
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

test("Fallen From Grace's angel enrages at 255 (Wiki walkthrough), not the post-quest 350", () => {
  const above = fightAt(createPlayer({ x: 2535, y: 2215 }), { hitpoints: 300, maxHitpoints: 565, npcs: Common.data.questNpcs, variant: "quest" });
  above.step(1);
  above.fight.attack(above.fight.player);
  assert.equal(above.npcLog.includes("say ...!"), false, "300 is above the quest angel's threshold");
  const below = fightAt(createPlayer({ x: 2535, y: 2215 }), { hitpoints: 250, maxHitpoints: 565, npcs: Common.data.questNpcs, variant: "quest" });
  below.step(1);
  below.fight.attack(below.fight.player);
  assert.ok(below.npcLog.includes("say ...!"));
});

test("as captured: each cleave covers its diagonal's half of the floor, the angel's own tiles too", () => {
  const rows = Common.data.arena.rows;
  // Every captured cleave: its half, the angel's south-west tile, and how many tiles its dust covered.
  const cleaves = [["ES", 2532, 2215, 55], ["WS", 2532, 2215, 56], ["ES", 2532, 2215, 55], ["ES", 2532, 2215, 55], ["WN", 2531, 2217, 25],
    ["WN", 2531, 2217, 25], ["WS", 2531, 2217, 66], ["EN", 2531, 2217, 37], ["ES", 2531, 2217, 78], ["WS", 2531, 2217, 66]];
  for (const [key, x, y, count] of cleaves) assert.equal(sweepTiles(key, [x + 1, y + 1], rows).length, count, `${key} at ${x},${y}`);

  const first = new Map(sweepTiles("ES", [2533, 2216], rows).map(([x, y, delay]) => [`${x},${y}`, delay]));
  assert.equal(first.get("2533,2216"), 0, "the dust starts on the angel's centre");
  assert.equal(first.get("2534,2215"), 2, "then under the angel");
  assert.equal(first.get("2535,2215"), 4, "and a tile every 2 cycles");
  assert.equal(first.get("2537,2210"), undefined, "never off the floor");
  assert.ok(first.has("2536,2219") && !first.has("2531,2214"), "the dividing diagonal only at its counter-clockwise end");

  // In the middle of the floor the north-west half reaches the far corner (its captured dust was cut off by the walls).
  const middle = new Set(sweepTiles("WN", [2533, 2215], rows).map(([x, y]) => `${x},${y}`));
  assert.ok(middle.has("2529,2221") && middle.has("2529,2213") && !middle.has("2537,2215"));
});

test("as captured: the enrage cry is a 4-tick turn, then smite, blast, sweep and the smite again", () => {
  const player = createPlayer({ x: 2535, y: 2215 });
  const { fight, npcLog, step } = fightAt(player);
  fight.rotation = 2; // a sweep and a blast before it, as captured
  fight.enragePending = true;
  fight.attack(player);
  assert.ok(npcLog.includes("say ...!") && npcLog.includes("delay 4"));
  const kinds = [];
  for (let i = 0; i < 4; i++) {
    fight.attack(player);
    kinds.push(fight.special.kind);
    fight.special = null;
  }
  assert.deepEqual(kinds, ["smite", "blast", "sweep", "smite"]);
  step(1);
});

test("as captured: the smite holds the turn its last strike lands on; the sweep gives a swing's length back, enraged too", () => {
  const player = createPlayer({ x: 2535, y: 2215 });
  const one = fightAt(player);
  one.fight.startSmite();
  one.step(6);
  assert.equal(player.hits.length, 1, "struck");
  assert.equal(one.fight.special?.kind, "smite", "its turn on the strike's tick still waits");
  assert.deepEqual(one.fight.attack(player), []);
  one.step(1);
  assert.equal(one.fight.special, null);

  const two = fightAt(createPlayer({ x: 2535, y: 2215 }));
  two.fight.enraged = true;
  two.fight.startSweep();
  two.step(4 * 6);
  assert.equal(two.fight.special, null);
  const faces = two.npcLog.filter((line) => line.startsWith("face")).length;
  assert.equal(faces, 6, "a turn with the wind-up and each cleave but the last");
  assert.ok(!two.npcLog.includes("attack"), "it holds still after the last cleave");
  two.step(3);
  assert.ok(two.npcLog.includes("attack") && two.npcLog.includes("delay 3"), "back on the player 3 ticks later, its swing 6 after the last cleave");
});

test("as captured: woken, its first swing comes a tick after it turns; a bounce lights up the angel", () => {
  const player = createPlayer({ x: 2535, y: 2215 });
  const { fight, npcLog, step } = fightAt(player);
  fight.startTick = -1;
  fight.wake();
  step(3);
  assert.ok(npcLog.includes("transform 16305") && npcLog.includes("attack") && npcLog.includes("delay 1"));

  fight.startBlast();
  assert.ok(npcLog.includes(`face ${fight.special.target.getX() - 1} ${fight.special.target.getY() - 1}`), "turned to the ball's tile");
  player.setLocation(fight.special.target);
  step(6);
  assert.ok(npcLog.includes("gfx 4017 slot 11"), "the bounce's graphic on the angel");
  assert.ok(!player.log.includes("gfx 4017"));
});

test("dying, it calls off what it started: no cleave, smite or explosion lands after its last hitpoint", () => {
  const player = createPlayer({ x: 2535, y: 2215 });
  const { fight, step, setHitpoints } = fightAt(player);
  fight.startSmite();
  fight.startSweep();
  step(2);
  setHitpoints(0);
  step(12);
  assert.deepEqual(player.hits, []);
  assert.equal(fight.special, null);
  assert.equal(fight.tick, 14, "its clock runs on to the kill, for the fight's duration");
});

test("a sweep or smite never starts on a step: it stands still and starts 2 ticks later", () => {
  const player = createPlayer({ x: 2535, y: 2215 });
  const { fight, npc, step } = fightAt(player);
  fight.attacks = 3;
  let walking = { id: 2 };
  npc.getWalkingDirection = () => walking;
  assert.deepEqual(fight.attack(player), []);
  assert.equal(fight.special.kind, "settle", "it stepped this tick: it waits, holding its turns");
  walking = { id: -1 };
  assert.deepEqual(fight.attack(player), [], "no swing while it settles");
  step(2);
  assert.equal(fight.special.kind, "sweep", "then the sweep it was due");
  assert.equal(fight.rotation, 1);

  const blaster = fightAt(createPlayer({ x: 2535, y: 2215 }));
  blaster.fight.attacks = 3;
  blaster.fight.rotation = 1;
  blaster.npc.getWalkingDirection = () => ({ id: 2 });
  blaster.fight.attack(player);
  assert.equal(blaster.fight.special.kind, "blast", "the blast lets it move, so it goes ahead");
});

test("a flicked smite is queued at 0: the player's Ring of life isn't spent on a dummy roll", (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { Equipment } = require("../dist/game/model/container/impl/Equipment");
  const { Skill } = require("../dist/game/model/Skill");
  require("../plugins/items/RingOfLife.plugin").register(PluginManager.createApi("RingOfLifeMadAngelTest"));
  const teleports = [];
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (...args) => teleports.push(args));

  const player = new Player(null);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true }));
  player.setLocation(new Location(2530, 2205, 0));
  player.getSkillManager().setMaxLevel(Skill.HITPOINTS, 99);
  player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 10, false);
  player.getEquipment().getItems()[Equipment.RING_SLOT] = new core.Item(core.ItemIdentifiers.RING_OF_LIFE);
  const npc = new NPC(Common.data.npcs.fighting, new Location(2532, 2215, 0));

  new Fight({ player }, npc).blow("smite");

  assert.equal(player.getEquipment().getItems()[Equipment.RING_SLOT].getId(), core.ItemIdentifiers.RING_OF_LIFE, "the ring is kept");
  assert.equal(teleports.length, 0, "no teleport");
});

test("a scripted Mad Angel blow reaches Elysian and incoming equipment after it is resolved", (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { attachFight } = require("../plugins/bosses/madangel/Fight.MadAngel");
  const { Equipment, ItemIdentifiers, Skill } = core;
  const api = PluginManager.createApi("MadAngelImpactOrderRegression");
  Common.init(api);
  attachFight(api);

  const channel = { isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel), new Location(2530, 2205, 0));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.setRegistered(true);
  player.setHitpoints(99);
  player.setAutoRetaliate(false);
  player.getSkillManager().setMaxLevel(Skill.HITPOINTS, 99);
  player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 99, false);
  player.getEquipment().set(Equipment.SHIELD_SLOT, new core.Item(ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD));

  const npc = new NPC(Common.data.npcs.fighting, new Location(2532, 2215, 0));
  npc.setRegistered(true);
  npc.setHitpoints(1000);
  const fight = new Fight({ player }, npc);
  npc.__madAngel = { player, fight };

  let incoming = 0;
  api.registerIncomingDamageModifier((victim, hit) => {
    if (victim === player && hit.getDamage() > 0) incoming++;
  });
  t.mock.method(Math, "random", () => 0.5);

  const originalAdd = core.CombatFactory.addPendingHit;
  let queued = null;
  core.CombatFactory.addPendingHit = (hit) => { queued = hit; };
  try {
    fight.blow("sweep");
  } finally {
    core.CombatFactory.addPendingHit = originalAdd;
  }
  assert.ok(queued, "the producer queued its zero placeholder");

  core.CombatFactory.executeHit(queued);
  assert.equal(queued.getTotalDamage(), 12, "the 16 sweep is cut by the 25% Elysian proc");
  assert.equal(incoming, 1, "equipment reactions see the scripted damage once");

  player.getCombat().getHitQueue().process(core.World.getProcessCycle() + 1);
  assert.equal(player.getHitpoints(), 87, "the Elysian-reduced blow lands");
});

// ------------------------------------------------------------------ Fallen From Grace's angel

test("Fallen From Grace: the pew asks first, the quest angel wakes 3 ticks after the move, and its kill leaves the corpse and the climbable pew (P2 ticks 314-469)", () => {
  const Instance = require("../plugins/bosses/madangel/Instance.MadAngel");
  Common.init(api);
  const { Climb } = objectHooks.get("Church pew");
  let defeated = false;
  customHooks.set("madangel:pew-climb", [(request) => { request.prompt = true; }]);
  customHooks.set("madangel:instance-variant", [(request) => { request.variant = "quest"; request.defeated = defeated; }]);
  try {
    const player = createPlayer({ x: 2539, y: 2215 });
    let area = null;
    player.setArea = (value) => { area = value; };
    player.getArea = () => area;
    player.getIndex = () => 77;
    player.isNpc = () => false;
    player.getAsPlayer = () => player;
    const pew = { getLocation: () => new Location(2538, 2215, 0) };
    assert.equal(Climb({ player, objectId: 62250, object: pew }), true);
    assert.equal(player.prompt?.title, "Climb over the pew?");
    assert.equal(Instance.sessionOf(player), null, "nothing happens before the answer");
    player.prompt.pairs[1](player);
    assert.ok(player.log.includes("anim 832"));
    runTicks(2);
    const session = Instance.sessionOf(player);
    assert.ok(session, "in the player's own cathedral");
    assert.equal(session.variant, "quest");
    assert.equal(session.boss.getId(), 16306, "dormant until it wakes");
    runTicks(2);
    assert.equal(session.fight, null);
    runTicks(1);
    assert.ok(session.fight, "woken with no Wake click, 3 ticks after the move (P2 tick 322)");
    assert.ok(session.boss.log.includes("transform 16311"), "the quest waking form");

    // The kill: the kill count, no fight-duration line, the corpse stays and the pew is climbable again.
    player.log.length = 0;
    const event = { npc: session.boss, killer: player, remains: null };
    for (const hook of deathHooks) hook(event);
    assert.ok(session.boss.log.includes("transform 16312"));
    assert.equal(session.defeated, true);
    assert.ok(event.remains.ticks > 1000, "the corpse lies there");
    assert.equal(player.log.some((line) => line.includes("Fight duration")), false);
    runTicks(40);
    assert.equal(spawnedNpcs.filter((npc) => npc.__madAngel === session).length, 1, "no new angel comes back");

    // Climbing the pew from inside now leaves at once, with no question.
    player.prompt = null;
    assert.equal(Climb({ player, objectId: 62250, object: pew }), true);
    assert.equal(player.prompt, null);
    runTicks(2);
    assert.equal(Instance.sessionOf(player), null, "back outside");

    // Going back in at stages 18-19: the corpse, nothing to wake.
    defeated = true;
    Climb({ player, objectId: 62250, object: pew });
    player.prompt.pairs[1](player);
    runTicks(6);
    const again = Instance.sessionOf(player);
    assert.equal(again.defeated, true);
    assert.equal(again.boss.getId(), 16312);
    assert.equal(again.fight, null);
    Instance.leave(player);
  } finally {
    customHooks.delete("madangel:pew-climb");
    customHooks.delete("madangel:instance-variant");
  }
});
