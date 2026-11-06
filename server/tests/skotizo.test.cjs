// Run after `yarn build`: node --test tests/skotizo.test.cjs
// Skotizo (Wiki: Skotizo, Dark totem, Ancient shard, Awakened Altar): his drop table, the totem
// pieces and shards from the Catacombs, and the altars' damage reduction.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
const Common = require("../plugins/bosses/skotizo/Common.Skotizo");
const Totems = require("../plugins/bosses/skotizo/Totems.Skotizo");
const { Fight, _test: FightTest } = require("../plugins/bosses/skotizo/Fight.Skotizo");
const CombatAchievements = require("../plugins/bosses/skotizo/CombatAchievements.Skotizo");

const BASE = 19679;
const MIDDLE = 19681;
const TOP = 19683;
const TOTEM = 19685;
const SHARD = 19677;
const WEAPON_SLOT = 3;

const emitted = [];
before(() => {
  __internals.loadDrops();
  Common.init({
    core: {
      ItemIdentifiers: { DARK_TOTEM_BASE: BASE, DARK_TOTEM_MIDDLE: MIDDLE, DARK_TOTEM_TOP: TOP, DARK_TOTEM: TOTEM, ANCIENT_SHARD: SHARD },
      Equipment: { WEAPON_SLOT },
    },
    emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
  });
});

function player({ inventory = {}, bank = {}, weapon = null } = {}) {
  const container = (items) => ({ getAmount: (id) => items[id] ?? 0 });
  const worn = [];
  worn[WEAPON_SLOT] = weapon ? { isValid: () => true, getDefinition: () => ({ getName: () => weapon }) } : null;
  return {
    getInventory: () => container(inventory),
    getBanks: () => [container(bank)],
    getEquipment: () => ({ getItems: () => worn }),
    getAttribute: () => undefined,
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function npc(name, x, y, hitpoints = 100) {
  const definition = { getName: () => name, getHitpoints: () => hitpoints };
  return {
    getLocation: () => new Location(x, y, 0),
    getDefinition: () => definition,
    getCurrentDefinition: () => definition,
    getMaxHitpoints: () => hitpoints,
  };
}

function withRandom(value, action) {
  const random = Math.random;
  Math.random = () => value;
  try {
    return action();
  } finally {
    Math.random = random;
  }
}

const skotizoTable = () => __internals.tablesByNpc.get(7286)[0];

test("Skotizo always drops one roll of ancient shards on top of his main table", () => {
  const table = skotizoTable();
  assert.equal(table.main_max_roll, 100);
  for (const [roll, shards] of [[0, 1], [0.8, 2], [0.92, 3], [0.97, 4], [0.995, 5]]) {
    const drops = withRandom(roll, () => __internals.rollTable(table, player(), null));
    const shardDrops = drops.filter((drop) => drop.itemId === SHARD);
    assert.equal(shardDrops.length, 1, `roll ${roll}`);
    assert.equal(shardDrops[0].amount, shards, `roll ${roll}`);
  }
});

test("his flat totem tertiaries are gone: the plugin rolls his totem table", () => {
  const ids = (skotizoTable().tertiary || []).map((entry) => entry.item_id);
  for (const id of [BASE, MIDDLE, TOP, TOTEM]) assert.equal(ids.includes(id), false);
});

test("a totem piece is the one the player has fewest of, base first on a tie", () => {
  const { nextPiece } = Totems._test;
  assert.equal(nextPiece(player()), BASE);
  assert.equal(nextPiece(player({ inventory: { [BASE]: 1 } })), MIDDLE);
  assert.equal(nextPiece(player({ inventory: { [BASE]: 1 }, bank: { [MIDDLE]: 1 } })), TOP);
  assert.equal(nextPiece(player({ inventory: { [BASE]: 2, [MIDDLE]: 1, [TOP]: 1 } })), MIDDLE);
});

test("Catacombs monsters but ghosts drop totem pieces and shards; elsewhere they don't", () => {
  const { addDrops } = Totems._test;
  const roll = (monster) => {
    const event = { player: player(), npc: monster, npcId: 1, drops: [] };
    withRandom(0, () => addDrops(event));
    return event.drops.map((drop) => drop.itemId);
  };
  assert.deepEqual(roll(npc("Hill Giant", 1660, 10040, 35)), [BASE, SHARD]);
  assert.deepEqual(roll(npc("Hill Giant", 1430, 9880, 35)), [BASE, SHARD], "Giants' Den");
  assert.deepEqual(roll(npc("Ghost", 1660, 10040, 25)), []);
  assert.deepEqual(roll(npc("Hill Giant", 3117, 9845, 35)), [], "Edgeville Dungeon");
});

test("each awake altar takes 25% off, 15% up to 60% with Arclight or Emberlight", () => {
  const fight = new Fight({ player: player() });
  for (const side of ["w", "e", "s", "n"]) fight.altars.set(side, { side, awake: false });
  const wake = (count) => [...fight.altars.values()].forEach((altar, index) => { altar.awake = index < count; });
  wake(0);
  assert.equal(fight.reductionPercent(player({ weapon: "Abyssal whip" })), 0);
  wake(2);
  assert.equal(fight.reductionPercent(player({ weapon: "Abyssal whip" })), 50);
  assert.equal(fight.reductionPercent(player({ weapon: "Arclight" })), 30);
  wake(4);
  assert.equal(fight.reductionPercent(player({ weapon: "Abyssal whip" })), 100);
  assert.equal(fight.reductionPercent(player({ weapon: "Emberlight" })), 60);
});

test("the altars' share comes off the max hit, so a low Skotizo can still be finished", () => {
  const fight = new Fight({ player: player() });
  fight.boss = { __skotizoLair: { fight } };
  for (const side of ["w", "e", "s", "n"]) fight.altars.set(side, { side, awake: false });
  [...fight.altars.values()].slice(0, 3).forEach((altar) => { altar.awake = true; });
  const attacker = (weapon, target) => ({ ...player({ weapon }), getCombat: () => ({ getTarget: () => target }) });
  assert.equal(FightTest.altarMaxHit(attacker("Abyssal whip", fight.boss), 40), 10);
  assert.equal(FightTest.altarMaxHit(attacker("Emberlight", fight.boss), 40), 22);
  assert.equal(FightTest.altarMaxHit(attacker("Abyssal whip", { }), 40), 40, "anything but Skotizo");
});

function achievementHitHook() {
  let resolved;
  CombatAchievements.attachCombatAchievements({
    onCombatHitResolved: (handler) => { resolved = handler; },
    onNpcHitModify() {},
    onCustomEvent() {},
  });
  return resolved;
}

test("Skotizo damage achievements ignore unrelated player fights, even those with their own stats", () => {
  const resolved = achievementHitHook(), target = player();
  const hit = { getTotalDamage: () => 12 };
  for (const fight of [{ player: target, stopped: false }, { player: target, stopped: false, stats: { damageTaken: 0 } }]) {
    target.getArea = () => ({ session: { fight } });
    assert.doesNotThrow(() => resolved({ target, hit }), "another boss's area must not enter Skotizo tracking");
    if (fight.stats) assert.equal(fight.stats.damageTaken, 0);
  }
  target.getArea = () => null;
  assert.doesNotThrow(() => resolved({ target, hit }));
  assert.doesNotThrow(() => resolved({ target: { isPlayer: () => false }, hit }));
});

test("Skotizo damage achievements still track positive hits only for their active fight's own player", () => {
  const resolved = achievementHitHook(), target = player(), fight = new Fight({ player: target });
  const area = { session: { fight } };
  target.getArea = () => area;
  const hit = (damage) => ({ getTotalDamage: () => damage });
  resolved({ target, hit: hit(12) });
  resolved({ target, hit: hit(0) });
  assert.equal(fight.stats.damageTaken, 12);
  const other = { ...player(), getArea: () => area };
  resolved({ target: other, hit: hit(7) });
  fight.stopped = true;
  resolved({ target, hit: hit(9) });
  assert.equal(fight.stats.damageTaken, 12, "stopped fights and another player cannot change the total");
  const before = emitted.length;
  CombatAchievements.judge(fight);
  assert.equal(emitted.slice(before).some(({ payload }) => payload.task === "Demon Evasion"), false);
});

test("the hellfire burst's hit lands on the tick the projectile does (#1862)", () => {
  const { Projectile } = require("../dist/game/model/Projectile");
  const previous = Common.core;
  const sent = [];
  class FakeProjectile {
    constructor(...args) { sent.push(args); }
    withAngle() { return this; }
    withProgress() { return this; }
    sendProjectile() {}
  }
  FakeProjectile.ticksToLand = Projectile.ticksToLand;
  Common.init({
    core: {
      ...previous,
      Location,
      Animation: class {},
      Graphic: class {},
      PendingHit: class { constructor(attacker, target, method, delay) { this.delay = delay; } },
      Projectile: FakeProjectile,
    },
    emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
  });
  try {
    const fight = new Fight({ player: player(), area: null });
    fight.boss = { getLocation: () => new Location(1690, 9880, 0), getSize: () => 5, performAnimation: () => {} };
    for (const tiles of [1, 4, 9]) {
      sent.length = 0;
      const target = {
        getLocation: () => new Location(1692 + tiles, 9882, 0),
        performGraphicInSlot: () => {},
        getPacketSender: () => ({ sendAreaSound: () => {} }),
      };
      const [hit] = fight.magic(target);
      const end = sent[0][5];
      assert.equal(end, Math.max(70, 30 + 10 * tiles), `${tiles} tiles: captured end`);
      assert.equal(hit.delay, Projectile.ticksToLand(end), `${tiles} tiles`);
      assert.ok(hit.delay * 30 >= end, `${tiles} tiles: no splat before the burst lands`);
    }
  } finally {
    Common.init({ core: previous, emitCustomEvent: (name, payload) => emitted.push({ name, payload }) });
  }
});

// Native Slayer task controls below use the existing cache and server plugin route.
const { CachePipeline: NativeCachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader: NativeNpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const Data = require("../plugins/skills/slayer/Data.Slayer");
const Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
const core = PluginManager.getCoreApi();
const taskId = (name) => [...Data.get().taskById.values()].find((task) => task.displayName === name).id;
const varp = (player, name) => player.getPacketSender().getVarp(CacheDefinitions.getVarpId(name));
function giveTask(player, master, name, amount) {
  const sender = player.getPacketSender();
  sender.sendConfig(CacheDefinitions.getVarpId("slayer_target"), taskId(name));
  sender.sendConfig(CacheDefinitions.getVarpId("slayer_count"), amount);
  sender.sendConfig(CacheDefinitions.getVarpId("slayer_count_original"), amount);
  sender.sendVarbit(CacheDefinitions.getVarbitId("slayer_master"), master);
}

test("Skotizo is a named black-demon substitute as well as a greater demon", async () => {
  await NativeCachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  new NativeNpcDefinitionLoader().load();
  Data.init({ core });
  const greater = taskId("Greater Demons"), black = taskId("Black Demons");
  const id = core.NpcIdentifiers.SKOTIZO, definition = CacheDefinitions.getNpc(id);
  assert.equal(id, 7286);
  assert.equal(definition.name, "Skotizo");
  assert.equal(Data.npcTaskId(id), greater, "active cache NPC param 50 is the greater-demon task");
  assert.equal(greater, 29); assert.equal(black, 30);
  assert.equal(Data.npcCountsFor(greater, id, definition.name), true, "greater-demon match control");
  assert.equal(Data.npcCountsFor(black, id, definition.name), true, "Skotizo also counts as a black demon");
});

// The real lair producer is used for setup. Damage attribution and lethal HP are
// seeded; NPCDeathTask and registered Slayer death hooks run on real World ticks.
test("native Skotizo lair deaths count for Konar's Catacombs demon assignments", async (t) => {
  const path = require("node:path");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const Lair = require("../plugins/bosses/skotizo/Lair.Skotizo");
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = core.TaskManager.submit;
  const oldError = console.error, errors = [], tasks = new Set(), actors = [], controls = [], sessions = [], ownedNpcs = new Set();
  const groundBefore = new Set(core.World.getItems());
  let started = false;
  process.env.DISABLE_PLAYER_BOTS = "1";
  t.after(() => {
    try {
      for (const task of tasks) if (task.isRunning()) task.stop();
      for (const session of sessions) for (const monster of session.area.getNpcs()) ownedNpcs.add(monster);
      for (const session of sessions) {
        if (!session.area.isDestroyed() && session.area.hasMember(session.player)) session.area.leave(session.player, false);
        if (!session.ended) session.end();
      }
      for (const monster of controls) if (monster.isRegistered()) core.World.getNpcs().removes(monster);
      for (const actor of actors) {
        PluginManager.emitPlayerLogout({ player: actor, username: actor.getUsername() });
        if (actor.isRegistered()) core.World.getPlayers().removes(actor);
      }
      for (const item of [...core.World.getItems()]) {
        if (!groundBefore.has(item) && actors.some((actor) => item.getOwner() === actor.getUsername())) core.ItemOnGroundManager.deregister(item);
      }
      core.ItemOnGroundManager.process();
      if (started) PluginManager.emitServerShutdown({});
      for (const task of tasks) if (task.isRunning()) task.stop();
      core.World.process();
      assert.ok(sessions.every((session) => session.ended && session.area.isDestroyed()), "fixture lairs are destroyed");
      assert.ok([...ownedNpcs].every((monster) => !monster.isRegistered() && !core.World.getAddNPCQueue().includes(monster)), "fixture lair NPCs are removed");
      assert.ok([...tasks].every((task) => !task.isRunning()), "fixture tasks are stopped");
      assert.equal(core.World.getItems().some((item) => !groundBefore.has(item) && actors.some((actor) => item.getOwner() === actor.getUsername())), false);
      assert.deepEqual(errors, [], "native execution and teardown have no hidden plugin errors");
    } finally {
      core.TaskManager.submit = oldSubmit; console.error = oldError;
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
  });
  core.TaskManager.submit = function (...args) { if (args[0]) tasks.add(args[0]); return oldSubmit.apply(this, args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); return oldError.apply(console, args); };
  await NativeCachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(1662, 10049);
  core.RegionManager.loadMapFiles(2257, 5650);
  PluginManager.emitServerStartup({}); started = true;
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name) {
    const player = new Player(new PlayerSession(channel())); actors.push(player);
    player.setUsername(name); player.setLongUsername(core.Misc.stringToLongBigInt(name));
    player.setAttribute("bot-skip-persistence", true);
    player.setLocation(new core.Location(1662, 10049, 0));
    assert.equal(core.World.getPlayers().add(player), true); player.needsPlacement = false;
    const skills = player.getSkillManager();
    skills.setExperience(core.Skill.SLAYER, SkillManager.getExperienceForLevel(99));
    skills.setMaxLevel(core.Skill.SLAYER, 99); skills.setCurrentLevel(core.Skill.SLAYER, 99, true);
    assert.equal(skills.getCurrentLevel(core.Skill.SLAYER), 99, "Bloodveld Slayer-level control");
    return player;
  }
  function trackLair(player) {
    const session = Lair.arrive(player); sessions.push(session);
    for (const monster of session.area.getNpcs()) ownedNpcs.add(monster);
    return session;
  }
  const area = [...Data.get().areas.values()].find((entry) => entry.id === 1);
  assert.equal(area.name, "Catacombs of Kourend");
  const greater = taskId("Greater Demons"), black = taskId("Black Demons");
  const konar = Data.get().masters.get(8);
  for (const id of [greater, black]) {
    const entry = konar.tasks.find((row) => row.task.id === id);
    assert.ok(entry && entry.areaRows.some((row) => Data.get().areas.get(row)?.id === area.id), "cache allows this Konar Catacombs assignment");
  }
  // Set the real task varps as fixture setup; this is not a master-dialogue test.
  function setTask(player, name, assignedArea = area, masterId = 8) {
    giveTask(player, masterId, name, 5);
    player.getPacketSender().sendConfig(CacheDefinitions.getVarpId("slayer_area"), assignedArea.id);
    assert.equal(Tasks.current(player).area.id, assignedArea.id);
  }
  function query(player, monster, extra = {}) {
    const request = { player, npc: monster, ...extra };
    PluginManager.emitCustomEvent("slayer:on-task", request); return request.onTask;
  }
  function bloodveld(x, y) {
    const monster = core.NPC.create(core.NpcIdentifiers.BLOODVELD, new core.Location(x, y, 0));
    controls.push(monster); monster.setScriptedMovement(true); monster.__skipDefaultRespawn = true;
    assert.equal(core.World.getNpcs().add(monster), true); monster.needsPlacement = false;
    return monster;
  }
  const player = actor("skgreater");
  setTask(player, "Bloodveld");
  const inside = bloodveld(1690, 10070), outside = bloodveld(3420, 3560);
  assert.equal(query(player, inside), true, "actual Catacombs Bloodveld is on task");
  assert.equal(query(player, outside), false, "actual Slayer Tower Bloodveld is outside the assigned area");
  const controlDeaths = [];
  PluginManager.createApi("SkotizoKonarControlObserve").onNpcDeath((event) => {
    if (event.npc === inside && event.killer === player) controlDeaths.push(event);
  });
  const beforeControlXp = player.getSkillManager().getExperience(core.Skill.SLAYER);
  inside.getCombat().addDamage(player, inside.getMaxHitpoints()); inside.setHitpoints(0);
  for (let i = 0; i < 60 && controlDeaths.length === 0; i++) core.World.process();
  assert.equal(controlDeaths.length, 1, "ordinary in-area NPCDeathTask reaches the registered Slayer handler");
  assert.equal(varp(player, "slayer_count"), 4, "ordinary in-area kill decrements the task");
  assert.ok(player.getSkillManager().getExperience(core.Skill.SLAYER) > beforeControlXp, "ordinary in-area kill awards Slayer XP");

  setTask(player, "Greater Demons");
  const session = trackLair(player);
  const boss = session.fight.boss, at = boss.getLocation().clone();
  assert.equal(Lair.sessionOf(player), session); assert.equal(boss.getPrivateArea(), session.area);
  assert.ok(session.inArena(at) && at.getX() >= 8192, "actual Skotizo stands in the allocated lair");
  assert.equal(boss.getId(), core.NpcIdentifiers.SKOTIZO);
  assert.equal(Data.npcTaskId(boss.getId()), greater);
  assert.equal(Data.npcCountsFor(greater, boss.getId(), "Skotizo"), true, "greater match before area target");
  assert.equal(Data.inArea(area, at), false, "allocated instance coordinates are outside the world box");
  const liveOnTask = query(player, boss);
  const numericOnTask = query(player, boss, { npcId: boss.getId(), location: boss.getLocation() });
  const deaths = [];
  PluginManager.createApi("SkotizoKonarNativeObserve").onNpcDeath((event) => {
    if (event.npc === boss && event.killer === player) deaths.push(event);
  });
  boss.getCombat().addDamage(player, boss.getMaxHitpoints()); boss.setHitpoints(0);
  for (let i = 0; i < 60 && deaths.length === 0; i++) core.World.process();
  assert.equal(deaths.length, 1, "real NPCDeathTask reports the owner and actual boss exactly once");
  assert.deepEqual(errors, [], "registered World and death hooks report no errors before the target");
  assert.equal(varp(player, "slayer_count"), 4, "the Skotizo death decrements the Catacombs greater-demon task once");
  assert.equal(liveOnTask, true, "actual NPC on-task query uses the same area rule");
  assert.equal(numericOnTask, true, "numeric query carrying the actual NPC uses the same area rule");
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [boss.getLocation().getX(), boss.getLocation().getY(), boss.getLocation().getZ()], "real NPC location is unchanged");

  const blackPlayer = actor("skblack"); setTask(blackPlayer, "Black Demons");
  const blackSession = trackLair(blackPlayer);
  const blackBoss = blackSession.fight.boss, blackAt = blackBoss.getLocation();
  assert.equal(blackBoss.getPrivateArea(), blackSession.area);
  assert.equal(Data.npcCountsFor(black, blackBoss.getId(), "Skotizo"), true);
  assert.equal(query(blackPlayer, blackBoss), true);
  assert.equal(query(blackPlayer, blackBoss, { npcId: blackBoss.getId(), location: blackAt }), true);
  const noNpc = { player: blackPlayer, npcId: blackBoss.getId(), location: blackAt };
  PluginManager.emitCustomEvent("slayer:on-task", noNpc);
  assert.equal(noNpc.onTask, false, "id-only request cannot inherit an instance area");
  assert.equal(Data.npcTaskId(core.NpcIdentifiers.BLACK_DEMON), black, "actual alternate NPC matches the black-demon task");
  assert.equal(query(blackPlayer, blackBoss, { npcId: core.NpcIdentifiers.BLACK_DEMON, location: blackAt }), false, "a different requested NPC id cannot borrow the lair");
  assert.equal(query(blackPlayer, blackBoss, { npcId: blackBoss.getId(), location: new core.Location(3420, 3560, 0) }), false, "explicit alternate location remains outside");
  const otherAreaRow = konar.tasks.find((entry) => entry.task.id === black).areaRows.find((row) => Data.get().areas.get(row)?.id !== area.id);
  const otherArea = Data.get().areas.get(otherAreaRow);
  assert.ok(otherArea?.boxes?.length);
  setTask(blackPlayer, "Black Demons", otherArea);
  assert.equal(query(blackPlayer, blackBoss), false, "a different Konar area remains excluded");
  assert.ok(Data.get().masters.get(7).tasks.some((entry) => entry.task.id === black), "Krystilia has black-demon assignments");
  setTask(blackPlayer, "Black Demons", area, 7);
  assert.equal(query(blackPlayer, blackBoss), false, "Krystilia's Wilderness restriction remains in force");
  setTask(blackPlayer, "Black Demons");
  const foreign = actor("skforeign"); setTask(foreign, "Black Demons");
  assert.equal(query(foreign, blackBoss), false, "another player cannot borrow the owner lair");
  blackBoss.getCombat().addDamage(blackPlayer, blackBoss.getMaxHitpoints()); blackBoss.setHitpoints(0);
  for (let i = 0; i < 60 && varp(blackPlayer, "slayer_count") === 5; i++) core.World.process();
  assert.equal(varp(blackPlayer, "slayer_count"), 4, "actual black-demon task decrements once");
  assert.equal(varp(player, "slayer_count"), 4, "later World ticks do not credit the first death twice");
  assert.deepEqual(errors, [], "native death and on-task paths report no hidden errors");
});
