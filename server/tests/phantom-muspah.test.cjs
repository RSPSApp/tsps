// node --test tests/phantom-muspah.test.cjs
const previousBotsSetting = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Common = require("../plugins/bosses/phantommuspah/Common.PhantomMuspah");

const ITEMS = { FROZEN_CACHE: 27622, ANCIENT_ICON: 27627, VENATOR_SHARD: 27614, ANCIENT_ESSENCE: 27616, CHARGED_ICE: 27643 };
const hooks = { custom: {} };
const fakeApi = {
  core: { ItemIdentifiers: new Proxy(ITEMS, { get: (items, name) => items[name] ?? 1000 + String(name).length }) },
  persistAttribute() {},
  onPlayerLogin() {},
  onNpcDeath() {},
  onItemAction() {},
  onCustomEvent(name, handler) {
    (hooks.custom[name] ??= []).push(handler);
  },
  emitCustomEvent(name, payload) {
    for (const handler of hooks.custom[name] ?? []) handler(payload);
  },
};
Common.init(fakeApi);

const Loot = require("../plugins/bosses/phantommuspah/Loot.PhantomMuspah");
const { SpikeField } = require("../plugins/bosses/phantommuspah/Spikes.PhantomMuspah");
Loot.attachLoot(fakeApi);

const key = ([x, y]) => `${x},${y}`;

test("the arena is every tile a captured shockwave reached, plus the centre", () => {
  const { tiles, kind } = Common.arena();
  assert.equal(kind.size, 433);
  assert.ok(Common.onArena(Common.data.boss.centre));
  assert.ok(tiles.length >= kind.size);
  // The open floor (the lair's collision adds nothing past what the shockwaves covered).
  assert.ok(Common.onArena([2858, 4265]));
  assert.ok(Common.onArena([2838, 4255]));
});

test("every teleport and shockwave tile puts the Muspah's centre on the arena", () => {
  for (const [x, y] of [...Common.data.clouds.loop, Common.data.shockwave.tile, Common.data.boss.tile]) {
    assert.ok(Common.onArena([x + 2, y + 2]), `${x},${y}`);
  }
  assert.deepEqual(Common.data.shockwave.tile.slice(0, 2).map((value, i) => value + 2), Common.data.boss.centre);
});

test("lair tiles map into the instance and back", () => {
  const area = {
    getBaseX: () => 6400, getBaseY: () => 1600,
    tile: (x, y, z) => ({ getX: () => 6400 + x, getY: () => 1600 + y, getZ: () => z }),
  };
  const at = Common.tileIn(area, [2859, 4259, 0]);
  assert.deepEqual([at.getX(), at.getY()], [6400 + 43, 1600 + 35]);
  assert.deepEqual(Common.lairTile(area, at), [2859, 4259, 0]);
});

test("fight durations print as m:ss.SS, as captured", () => {
  assert.equal(Loot.formatTicks(108), "1:04.80");
  assert.equal(Loot.formatTicks(32), "0:19.20");
  assert.equal(Loot.formatTicks(311), "3:06.60");
});

test("the frozen cache gives one of its Wiki rewards", () => {
  const essence = Common.data.frozenCache.entries.find((entry) => entry.essence).essence;
  for (let i = 0; i < 2000; i++) {
    const reward = Loot.rollCache();
    assert.ok(Number.isInteger(reward.itemId) && reward.amount >= 1);
    if (reward.itemId !== ITEMS.ANCIENT_ESSENCE) continue;
    assert.ok(essence.some(([min, max, step]) => reward.amount >= min && reward.amount <= max && (reward.amount - min) % step === 0));
  }
});

function fakePlayer({ ownsIce = false } = {}) {
  const messages = [];
  return {
    messages,
    sendMessage: (text) => messages.push(text),
    getInventory: () => ({ getAmount: (id) => (ownsIce && id === ITEMS.CHARGED_ICE ? 1 : 0) }),
    getBanks: () => [],
  };
}

test("a kill under 3:00 adds Charged ice, unless the player has one", () => {
  const roll = (player, lootTicks) => {
    const event = { npc: { __muspahFight: { lootTicks } }, player, drops: [] };
    fakeApi.emitCustomEvent("npc-drops:roll", event);
    return event.drops.map((drop) => drop.itemId);
  };
  const quick = fakePlayer();
  assert.deepEqual(roll(quick, 299), [ITEMS.CHARGED_ICE]);
  assert.match(quick.messages[0], /Untradeable drop: Charged ice/);
  assert.deepEqual(roll(fakePlayer(), 300), []);
  assert.deepEqual(roll(fakePlayer({ ownsIce: true }), 100), []);
});

test("a Venator shard comes without the main table's loot", () => {
  const event = {
    npc: { __muspahFight: { lootTicks: 999 } },
    player: fakePlayer(),
    drops: [
      { itemId: ITEMS.VENATOR_SHARD, amount: 1 },
      { itemId: 1201, amount: 3, noted: true }, // Rune kiteshield, main table
      { itemId: ITEMS.ANCIENT_ESSENCE, amount: 560 }, // separate roll
      { itemId: 2722, amount: 1 }, // hard clue, tertiary
    ],
  };
  fakeApi.emitCustomEvent("npc-drops:roll", event);
  assert.deepEqual(event.drops.map((drop) => drop.itemId), [ITEMS.VENATOR_SHARD, ITEMS.ANCIENT_ESSENCE, 2722]);
});

test("a spike shelters the tiles behind it from the centre, not those beside it", () => {
  const field = Object.create(SpikeField.prototype);
  field.spikes = new Map([[key([2845, 4263]), {}], [key([2846, 4263]), {}]]);
  const centre = Common.data.boss.centre;
  // Captured: (2845, 4267) behind the pair took no shockwave; (2848, 4264) beside it did.
  assert.equal(field.shelters(centre, [2845, 4267]), true);
  assert.equal(field.shelters(centre, [2844, 4266]), true);
  assert.equal(field.shelters(centre, [2848, 4264]), false);
  assert.equal(field.shelters(centre, [2838, 4258]), false);
});

test("corruption drains 3, 6 and 9 prayer at 11, 21 and 31 ticks, as captured", () => {
  const tasks = [];
  const core = fakeApi.core;
  core.Task = class {
    constructor(delay) { this.delay = delay; }
    stop() { this.stopped = true; }
  };
  core.TaskManager = { submit: (task) => tasks.push({ task, at: now + task.delay }) };
  core.Skill = { PRAYER: "prayer" };
  let now = 0;
  let prayer = 99;
  const varbits = {};
  const events = [];
  const player = {
    isRegistered: () => true,
    sendMessage: (text) => events.push([now, text]),
    getPacketSender: () => ({ sendVarbit: (id, value) => { varbits[id] = value; } }),
    getSkillManager: () => ({
      getCurrentLevel: () => prayer,
      setCurrentLevel: (_skill, level) => { prayer = level; },
    }),
    showHitsplat: (amount) => events.push([now, `drain ${amount}`]),
  };
  const Corruption = require("../plugins/bosses/phantommuspah/Corruption.PhantomMuspah");
  Corruption.corrupt(player, 3);
  assert.deepEqual([varbits[12142], varbits[12141], varbits[12140]], [3, 1, 3]);
  for (now = 1; now <= 40; now++) {
    for (const entry of tasks.filter((t) => t.at === now)) entry.task.execute();
  }
  assert.deepEqual(events.filter(([, text]) => text.startsWith("drain")), [[11, "drain 3"], [21, "drain 6"], [31, "drain 9"]]);
  assert.equal(prayer, 99 - 18);
  assert.equal(events.at(-2)[1], Common.data.corruption.end);
  assert.deepEqual([varbits[12142], varbits[12141], varbits[12140]], [0, 0, 0]);
});

test("the Muspah's attackable forms hold a freeze for 66% of its base duration", () => {
  fakeApi.core.CombatMethod = class {};
  fakeApi.core.CombatType = { RANGED: 0 };
  fakeApi.registerNpcCombatMethodProvider = () => {};
  fakeApi.onNpcHitModify = () => {};
  fakeApi.onNpcBeforeDeath = () => {};
  const Fight = require("../plugins/bosses/phantommuspah/Fight.PhantomMuspah");
  Fight.attachFight(fakeApi);
  for (const form of ["ranged", "melee", "shielded", "final"]) {
    const freeze = { target: { getId: () => Common.data.npcs[form] }, ticks: 20 };
    fakeApi.emitCustomEvent("combat:freeze-duration", freeze);
    assert.equal(freeze.ticks, 20 * 0.66, form);
  }
  const teleport = { target: { getId: () => Common.data.npcs.teleport }, ticks: 20 };
  fakeApi.emitCustomEvent("combat:freeze-duration", teleport);
  assert.equal(teleport.ticks, 20);
});

// These integration cases use the real registered specials, NPC level state and hit queue.
// Fight's scene and tick scheduling are adapted; the test drives the actual scheduled callbacks.
const path = require("node:path");
const { before, after } = require("node:test");
after(() => {
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});
let nativeCore, nativeApi;
before(async () => {
  require("../dist/Server").Server.installProductionPathResolver();
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(path.resolve(__dirname, ".."));
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
  const { PluginManager } = require("../dist/plugins/PluginManager");
  nativeCore = PluginManager.getCoreApi();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  nativeCore.RegionManager.init();
  nativeCore.RegionManager.loadMapFiles(3222, 3218);
  nativeApi = PluginManager.createApi("MuspahDefenceFloorTest");
  require("../plugins/items/TonalzticsOfRalos.plugin").register(nativeApi);
  for (const name of ["DragonWarhammer", "ElderMaul", "BandosGodsword", "TonalzticsOfRalos"]) {
    require(`../plugins/combat/specials/${name}.SpecialAttack`)(nativeApi);
  }
  Common.init(nativeApi);
  require("../plugins/bosses/phantommuspah/Fight.PhantomMuspah").attachFight(nativeApi);
  Common.init(fakeApi);
});

function nativeFight(t) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const tasks = [], errors = [], originalSubmit = nativeCore.TaskManager.submit, originalError = console.error;
  let fight, npc, session;
  const originalCycle = nativeCore.World.processCycle;
  console.error = function (...args) { errors.push(args.map(String).join(" ")); originalError.apply(console, args); };
  nativeCore.TaskManager.submit = (task) => { task.setRunning(true); tasks.push(task); };
  t.after(() => {
    try {
      for (const task of tasks) task.stop();
      try {
        (fight ?? session?.fight)?.stop();
      } finally {
        if (npc) { npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); }
        try {
          if (player.isRegistered()) PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
        } finally {
          player.getMovementQueue().reset();
          nativeCore.TaskManager.cancelTasks(player.getIndex());
          player.setRegistered(false);
          Common.init(fakeApi);
        }
      }
    } finally {
      for (const task of tasks) task.stop();
      nativeCore.World.processCycle = originalCycle;
      nativeCore.TaskManager.submit = originalSubmit;
      console.error = originalError;
    }
    assert.ok(tasks.every((task) => !task.isRunning()), "all captured tasks stopped");
    assert.deepEqual(errors, [], "no swallowed hook, task or teardown errors");
  });
  player.setIndex(6401); player.setUsername("MuspahFloorTest"); player.setRights(nativeCore.PlayerRights.NONE);
  player.setRegistered(true); player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new nativeCore.Location(3222, 3218, 0)); player.setNeedsPlacement(false);
  for (const skill of [nativeCore.Skill.HITPOINTS, nativeCore.Skill.ATTACK, nativeCore.Skill.STRENGTH, nativeCore.Skill.DEFENCE, nativeCore.Skill.RANGED]) {
    player.getSkillManager().setMaxLevel(skill, 99); player.getSkillManager().setCurrentLevel(skill, 99);
  }
  player.setHitpoints(99);
  t.mock.method(SpikeField.prototype, "spawnWave", () => {}); // no instance map or spike placement
  t.mock.method(SpikeField.prototype, "switchWave", () => {});
  Common.init(nativeApi);
  session = { player, ended: false, fight: null,
    tile: () => new nativeCore.Location(3223, 3218, 0), area: { add() {} } };
  const originalSpawn = PluginManager.spawnNpc;
  t.mock.method(PluginManager, "spawnNpc", function (...args) {
    const spawned = originalSpawn.apply(this, args);
    npc ??= spawned;
    return spawned;
  });
  require("../plugins/bosses/phantommuspah/Fight.PhantomMuspah").start(session);
  fight = session.fight; npc = fight.muspah;
  assert.ok(npc?.isRegistered(), "real Fight.start spawns a registered NPC");
  npc.setNeedsPlacement(false);
  t.mock.method(npc.getCombat(), "attack", () => {}); // fight's attackability event, not an NPC attack
  const attackable = fight.events.find((entry) => entry.tick === Common.data.boss.attackableTicks);
  assert.ok(attackable); attackable.action();
  assert.equal(npc.isUntargetable(), false);
  t.mock.method(fight, "showHitpoints", () => {});
  t.mock.method(fight, "showShield", () => {});
  return { fight, npc, player };
}

function queuedSpecial(fixture, id, amount, miss = false) {
  const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  const method = CombatSpecial.getById(id).getCombatMethod();
  const hit = new nativeCore.PendingHit(fixture.player, fixture.npc, method,
    { damage: amount, rollAccuracy: miss, experience: false });
  assert.equal(hit.isAccurate(), !miss);
  assert.equal(hit.getTotalDamage(), miss ? 0 : amount);
  nativeCore.CombatFactory.addPendingHit(hit);
  const queue = fixture.npc.getCombat().getHitQueue();
  assert.equal(queue.hasPendingHitFrom(fixture.player), true, "the real special was queued");
  const due = nativeCore.World.getProcessCycle() + hit.getDelay() + nativeCore.CombatFactory.hitProcessingDelay(hit);
  nativeCore.World.processCycle = due;
  queue.process(due);
  assert.equal(queue.hasPendingHitFrom(fixture.player), false, "the queue resolved the special");
}

test("active cache names the five actual Muspah forms", () => {
  const cache = require("../dist/game/cache/CacheDefinitions").CacheDefinitions;
  for (const [name, form] of [["muspah", "ranged"], ["muspah_melee", "melee"],
    ["muspah_teleport", "teleport"], ["muspah_soulsplit", "shielded"], ["muspah_final", "final"]]) {
    assert.equal(cache.getNpcId(name), Common.data.npcs[form], name);
  }
});

test("a real ordinary NPC still drains below 125 through queued warhammer hits", t => {
  const f = nativeFight(t), { PluginManager } = require("../dist/plugins/PluginManager");
  const cache = require("../dist/game/cache/CacheDefinitions").CacheDefinitions;
  assert.equal(cache.getNpcId("slayer_basilisk"), 417, "active cache agrees with the pinned symbol");
  const ordinary = PluginManager.spawnNpc({ id: 417, x: 3223, y: 3219, z: 0, wanderRadius: 0 });
  t.after(() => { if (ordinary) { ordinary.getCombat().getHitQueue().clear(); PluginManager.removeNpc(ordinary); } });
  assert.ok(ordinary?.isRegistered()); ordinary.setNeedsPlacement(false);
  assert.equal(ordinary.getDefenceLevel(), 75, "loaded ordinary NPC definition");
  const target = { ...f, npc: ordinary };
  queuedSpecial(target, "dragon_warhammer", 20); assert.equal(ordinary.getDefenceLevel(), 53);
  queuedSpecial(target, "dragon_warhammer", 20); assert.equal(ordinary.getDefenceLevel(), 38);
  queuedSpecial(target, "dragon_warhammer", 1); assert.equal(ordinary.getDefenceLevel(), 27);
});

test("real queued warhammer hits respect the Muspah floor and report the effective drain", t => {
  const f = nativeFight(t), defence = nativeCore.Skill.DEFENCE;
  const messages = [];
  t.mock.method(f.player, "sendMessage", (message) => messages.push(message));
  assert.equal(f.npc.getMaxLevel(defence), 200);
  queuedSpecial(f, "dragon_warhammer", 20);
  assert.equal(f.npc.getDefenceLevel(), 140);
  queuedSpecial(f, "dragon_warhammer", 20);
  assert.equal(f.npc.getDefenceLevel(), 125);
  assert.match(messages.at(-1), /by 15, from 140 to 125/);
  queuedSpecial(f, "dragon_warhammer", 20);
  assert.equal(f.npc.getDefenceLevel(), 125);
  assert.match(messages.at(-1), /by 0, from 125 to 125/);
});

test("real queued maul and Ralos hits use the same floor", t => {
  const f = nativeFight(t), defence = nativeCore.Skill.DEFENCE;
  queuedSpecial(f, "elder_maul", 20);
  assert.equal(f.npc.getDefenceLevel(), 130);
  queuedSpecial(f, "tonalztics_of_ralos", 20);
  assert.equal(f.npc.getDefenceLevel(), 125);
  queuedSpecial(f, "elder_maul", 20);
  assert.equal(f.npc.getDefenceLevel(), 125, "a further accurate maul hit cannot pass the floor");
  assert.equal(f.npc.previewCurrentLevel(defence, 100), 125, "charged Ralos predicts the same floor");
});

test("charged Ralos second accuracy uses the projected Muspah floor", t => {
  const f = nativeFight(t), { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  queuedSpecial(f, "dragon_warhammer", 20);
  queuedSpecial(f, "bandos_godsword", 15);
  assert.equal(f.npc.getDefenceLevel(), 125, "a legal producer sequence reaches the floor");
  const weapon = new nativeCore.Item(nativeCore.ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  weapon.setMetaValue("tonalztics-of-ralos:charges", 5);
  f.player.getEquipment().setItem(nativeCore.Equipment.WEAPON_SLOT, weapon);
  const charged = { player: f.player, action: "read", charged: false };
  nativeApi.emitCustomEvent("tonalztics:shot", charged);
  assert.equal(charged.charged, true, "the registered item plugin reads the equipped charge");
  require("../dist/game/content/combat/WeaponInterfaceManager").WeaponInterfaceManager.assign(f.player);
  const special = CombatSpecial.getById("tonalztics_of_ralos");
  f.player.setCombatSpecial(special); f.player.setSpecialPercentage(100); f.player.setSpecialActivated(true);
  const accuracy = nativeCore.AccuracyFormulasDpsCalc, projected = [];
  const originalAccuracy = accuracy.rollAccuracy;
  t.mock.method(accuracy, "rollAccuracy", function (...args) {
    if (args[0] === f.player && args[1] === f.npc) { projected.push(args[5]); return true; }
    return originalAccuracy.apply(this, args);
  });
  const originalDamage = nativeCore.CombatFactory.getHitDamage;
  t.mock.method(nativeCore.CombatFactory, "getHitDamage", function (...args) {
    if (args[0] === f.player && args[1] === f.npc) return new nativeCore.HitDamage(20, nativeCore.HitMask.RED);
    return originalDamage.apply(this, args);
  });
  // The item plugin reads real equipped charge metadata. Calling the registered method directly
  // supplies the attack; energy consumption, projectile launch and the full combat turn are not modeled.
  const hits = special.getCombatMethod().hits(f.player, f.npc);
  assert.equal(hits.length, 1); assert.equal(hits[0].getHits().length, 2);
  assert.deepEqual(projected, [undefined, 134], "the second roll sees 125 + 9, not a sub-floor drain");
  assert.equal(f.npc.getDefenceLevel(), 125, "projecting is non-mutating");
  nativeCore.CombatFactory.addPendingHit(hits[0]);
  const queue = f.npc.getCombat().getHitQueue();
  assert.equal(queue.hasPendingHitFrom(f.player), true);
  const due = nativeCore.World.getProcessCycle() + hits[0].getDelay() + nativeCore.CombatFactory.hitProcessingDelay(hits[0]);
  nativeCore.World.processCycle = due;
  queue.process(due);
  assert.equal(queue.hasPendingHitFrom(f.player), false);
  assert.equal(f.npc.getDefenceLevel(), 125, "both damaging impacts respect the same floor");
});

test("the actual queued weapon eligibility distinguishes a miss from accurate zero", t => {
  const f = nativeFight(t);
  queuedSpecial(f, "dragon_warhammer", 0);
  assert.equal(f.npc.getDefenceLevel(), 200, "an accurate zero does not trigger DWH");
  queuedSpecial(f, "elder_maul", 0);
  assert.equal(f.npc.getDefenceLevel(), 130, "Elder maul accepts an accurate zero");
  t.mock.method(nativeCore.AccuracyFormulasDpsCalc, "rollAccuracy", () => false);
  queuedSpecial(f, "elder_maul", 20, true);
  assert.equal(f.npc.getDefenceLevel(), 130, "a miss does not drain");
});

test("Warstrike cannot spill to Strength while Defence remains at its floor", t => {
  const f = nativeFight(t), defence = nativeCore.Skill.DEFENCE, strength = nativeCore.Skill.STRENGTH;
  queuedSpecial(f, "dragon_warhammer", 20);
  queuedSpecial(f, "bandos_godsword", 15);
  assert.equal(f.npc.getDefenceLevel(), 125);
  const previousStrength = f.npc.getCurrentLevel(strength);
  queuedSpecial(f, "bandos_godsword", 150);
  assert.equal(f.npc.getCurrentLevel(strength), previousStrength, "no secondary spill while Defence cannot reach zero");
  assert.equal(f.npc.getCurrentLevel(defence), 125);
});

test("the actual form and shield callbacks preserve then reset the drained Defence", t => {
  const f = nativeFight(t), defence = nativeCore.Skill.DEFENCE;
  queuedSpecial(f, "dragon_warhammer", 20);
  assert.equal(f.npc.getDefenceLevel(), 140);
  f.fight.events.length = 0;
  f.fight.switchForm();
  assert.equal(f.fight.events.length, 1);
  f.fight.events[0].action();
  assert.equal(f.npc.getDefenceLevel(), 140, "ranged/melee switch preserves Defence");
  const returnForm = f.fight.form;
  f.fight.setForm("teleport");
  assert.equal(f.npc.getDefenceLevel(), 140, "teleport form preserves Defence");
  f.fight.setForm(returnForm);
  const wave = Common.data.shockwave;
  f.npc.setHitpoints(wave.hitpoints - 1);
  assert.ok(f.npc.getHitpoints() < wave.hitpoints);
  assert.equal(f.fight.pendingSkip, null);
  f.fight.events.length = 0;
  f.fight.turn(); // actual below-threshold branch schedules the shockwave sequence
  assert.equal(f.fight.shockwaveStarted, true);
  const due = f.fight.tick + wave.teleportTicks + wave.windupTicks + wave.releaseTicks + wave.shieldTicks;
  const shieldEvent = f.fight.events.find((event) => event.tick === due);
  assert.ok(shieldEvent); shieldEvent.action(); // real scheduled raise; earlier scene phases are adapted
  assert.equal(f.fight.form, "shielded");
  assert.equal(f.npc.getMaxLevel(defence), 200, "loaded shield-form base Defence");
  assert.equal(f.npc.getDefenceLevel(), 200, "raising the shield restores Defence");
});
