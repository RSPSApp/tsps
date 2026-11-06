// node --test tests/nex.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const events = [];
const FAKE_TABLE = [
  { item_id: 532, always: true },
  { item_id: 565, amount: 100 },
  { item_id: 26235, separate_roll: true, section: "Uniques" },
  { item_id: 12073, section: "Tertiary" },
];
const fakeApi = {
  core: {
    Location: class {
      constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
      getX() { return this.x; }
      getY() { return this.y; }
      getZ() { return this.z; }
      transform(dx, dy) { return new this.constructor(this.x + dx, this.y + dy, this.z); }
    },
    ItemIdentifiers: new Proxy({ BIG_BONES: 532, CLUE_SCROLL_ELITE_: 12073, NEXLING: 26348 }, {
      get: (target, name) => target[name] ?? 1000 + String(name).length,
    }),
    ItemDefinition: { forId: (id) => ({ getName: () => ({ 1: "Ancient d'hide body", 2: "Ancient hilt", 3: "Torva platebody", 4: "Rune platebody", 5: "Zaryte vambraces", 6: "Ring of endurance", 7: "Gloves of darkness" })[id] ?? "" }) },
  },
  emitCustomEvent(name, payload) {
    events.push([name, payload]);
    // A stand-in for NpcDrops: every entry the filter keeps drops once.
    if (name === "npc-drops:roll-table") {
      for (const entry of FAKE_TABLE.filter((each) => !payload.entryFilter || payload.entryFilter(each))) {
        payload.drops.push({ itemId: entry.item_id, amount: entry.amount ?? 1, noted: false });
      }
    }
  },
};

const Common = require("../plugins/bosses/nex/Common.Nex");
Common.init(fakeApi);
const Loot = require("../plugins/bosses/nex/Loot.Nex");
const { Fight } = require("../plugins/bosses/nex/Fight.Nex");
const Specials = require("../plugins/bosses/nex/Specials.Nex");
const CombatAchievements = require("../plugins/bosses/nex/CombatAchievements.Nex");
const { Instance } = require("../plugins/bosses/nex/Instance.Nex");

test("Zarosian items by name, the ancient hilt excepted", () => {
  assert.equal(Common.isZarosian("Ancient d'hide body"), true);
  assert.equal(Common.isZarosian("Torva platebody"), true);
  assert.equal(Common.isZarosian("Zaryte vambraces"), true);
  assert.equal(Common.isZarosian("Gloves of darkness"), true);
  assert.equal(Common.isZarosian("Ring of endurance"), false);
  assert.equal(Common.isZarosian("Ancient hilt"), false);
  assert.equal(Common.isZarosian("Rune platebody"), false);
});

test("the prison aggression rule requires Zarosian equipment, not a ring of endurance", () => {
  const Prison = require("../plugins/bosses/nex/Prison.Nex");
  let area;
  const api = new Proxy({
    registerArea(value) { area = value; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  fakeApi.core.Area = class {};
  fakeApi.core.Boundary = class {};
  Prison.attachPrison(api);
  // IDs in fakeApi.core.ItemDefinition above, not cache IDs.
  const enduranceRing = 6;
  const ancientBody = 1;
  const equipment = [];
  const player = { getEquipment: () => ({ getItems: () => equipment.map((id) => ({ getId: () => id })) }) };
  const follower = { getId: () => Common.data.npcs.followers[0][0] };
  assert.equal(area.npcAggression(player, follower), true, "no god item: aggressive");
  equipment.push(enduranceRing);
  assert.equal(area.npcAggression(player, follower), true, "endurance is Saradomin, not Zaros");
  equipment.push(ancientBody);
  assert.equal(area.npcAggression(player, follower), false, "ancient d'hide still protects alongside the ring");
  equipment.shift();
  assert.equal(area.npcAggression(player, follower), false, "ancient d'hide protects by itself");
});

test("shares: present players over 1% of the damage, the MVP the biggest", () => {
  const [a, b, c, gone] = [{}, {}, {}, {}];
  const contribution = new Map([[a, 600], [b, 395], [c, 5], [gone, 1000]]);
  const { owed, mvp } = Loot.shares(contribution, [a, b, c]);
  assert.deepEqual(owed.map((entry) => entry.player), [a, b]);
  assert.equal(mvp, a);
  assert.equal(owed[0].share, 0.3);
});

test("loot: the MVP alone gets the big bones, the lump split by share, share-scaled rolls", () => {
  const [a, b] = [{}, {}];
  const loot = Loot.rollLoot(new Map([[a, 700], [b, 300]]), [a, b], () => 0.5);
  const of = (player) => loot.find((entry) => entry.player === player).drops;
  const ids = (player) => of(player).map((drop) => drop.itemId);
  assert.equal(ids(a).includes(532), true);
  assert.equal(ids(b).includes(532), false);
  // Two rolls of the main table (100 blood runes each): 70% (+10% MVP) and 30%.
  assert.equal(of(a).filter((drop) => drop.itemId === 565).reduce((sum, drop) => sum + drop.amount, 0), 2 * Math.floor(100 * 0.7 * 1.1));
  assert.equal(of(b).filter((drop) => drop.itemId === 565).reduce((sum, drop) => sum + drop.amount, 0), 2 * 30);
  // random() = 0.5: kept for the 70% player (0.77 for the unique), not for the 30% one.
  assert.equal(ids(a).includes(26235), true);
  assert.equal(ids(b).includes(26235), false);
});

/** A fight without the engine: the parts act() and the phase rules use. */
function bareFight() {
  const fight = Object.create(Fight.prototype);
  Object.assign(fight, {
    tick: 100, phaseIndex: 0, autosSinceSpecial: 0, specialDue: true, lane: 0, events: [], stage: "fighting",
    attacksOnTarget: 0, meleeChain: 0, noMeleeNext: false, curse: { form: null, attacks: 0, index: -1 },
    target: null, record: { siphonHealed: false, hitBy: new Map(), coughing: new Set() },
  });
  return fight;
}

test("specials: every sixth attack, alternating, the next phase carrying on the lane", () => {
  const ran = [];
  const original = Specials.run;
  Specials.run = (fight, name) => { ran.push(name); return 4; };
  const Attacks = require("../plugins/bosses/nex/Attacks.Nex");
  const originalAttack = Attacks.attack;
  Attacks.attack = () => true;
  try {
    const fight = bareFight();
    for (let i = 0; i < 12; i++) fight.act();
    assert.deepEqual(ran, ["virus", "dash"]);
    assert.equal(fight.autosSinceSpecial, 5);
    // The last was the dash: the shadow phase opens in its lane, with Shadow Smash.
    fight.say = () => {};
    fight.mages = new Map();
    fight.startPhase(1, 0);
    fight.act();
    assert.equal(ran.at(-1), "smash");
  } finally {
    Specials.run = original;
    Attacks.attack = originalAttack;
  }
});

test("the phases' calls and floors are the captured ones", () => {
  const phases = Common.data.fight.phases;
  assert.deepEqual(phases.map((phase) => [phase.call, phase.floor]), [[0.8, 0.75], [0.6, 0.55], [0.4, 0.35], [0.2, 0.15], [0, 0]]);
  assert.deepEqual(phases.map((phase) => phase.specials), [["virus", "dash"], ["darkness", "smash"], ["siphon", "sacrifice"], ["prison", "containment"], []]);
});

test("a hit takes her down to the phase's floor and no further", () => {
  const fight = bareFight();
  let hp = 2600;
  fight.immuneUntil = 0;
  fight.siphonUntil = 0;
  fight.contribution = new Map();
  fight.boss = { getHitpoints: () => hp };
  fight.arena = { players: () => [] };
  fight.areaSound = () => {};
  fight.centre = () => null;
  const parts = [{ damage: 80, getDamage() { return this.damage; }, setDamage(value) { this.damage = value; } }];
  const hit = { getAttacker: () => null, getTotalDamage: () => parts.reduce((sum, part) => sum + part.damage, 0), getHits: () => parts, updateTotalDamage() {} };
  fight.hitBoss(hit);
  assert.equal(parts[0].damage, 50);
  hp = 2550;
  parts[0].damage = 30;
  fight.hitBoss(hit);
  assert.equal(parts[0].damage, 0);
});

test("Zaros curses: Soul Split first, Deflect Melee four attacks later, then none", () => {
  const fight = bareFight();
  const forms = [];
  fight.transform = (id) => forms.push(id);
  fight.areaSound = () => {};
  for (let i = 0; i < 9; i++) fight.rotateCurse();
  const { npcs } = Common.data;
  assert.deepEqual(forms, [npcs.soulSplit, npcs.deflect, npcs.nex]);
});

test("the Combat Achievements judged after a clean duo kill", () => {
  events.length = 0;
  const fight = bareFight();
  fight.deaths = 0;
  fight.startPlayers = 2;
  const player = {};
  CombatAchievements.judge(fight, [player]);
  const tasks = events.filter(([name]) => name === "combat-achievements:complete").map(([, payload]) => payload.task);
  assert.deepEqual(tasks, ["Nex Survivors", "Nex Trio", "Nex Duo", "A siphon will solve this", "Contain this!", "There is no escape!", "Shadows Move...", "Perfect Nex"]);
  events.length = 0;
  fight.record.hitBy.set(player, new Set(["dash"]));
  fight.record.coughing.add(player);
  CombatAchievements.judge(fight, [player]);
  const second = events.map(([, payload]) => payload.task);
  assert.equal(second.includes("There is no escape!"), false);
  assert.equal(second.includes("Perfect Nex"), false);
  assert.equal(second.includes("I should see a doctor"), true);
});

test("an instance maps the real chamber onto its copy and back", () => {
  const instance = Object.create(Instance.prototype);
  instance.area = {
    getBaseX: () => 8000,
    getBaseY: () => 1600,
    tile: (x, y, z) => new fakeApi.core.Location(8000 + x, 1600 + y, z),
    contains: () => true,
  };
  const copy = instance.tile(Common.data.chamber.nexTile);
  assert.deepEqual([copy.getX(), copy.getY()], [8000 + 2924 - 360 * 8, 1600 + 5202 - 648 * 8]);
  assert.deepEqual(instance.real(copy), [2924, 5202]);
  assert.equal(instance.inChamber(copy), true);
  assert.equal(instance.inChamber(instance.tile([2905, 5203, 0])), false);
});

test("the data names every special and phase mage", () => {
  const { specials, fight, npcs, chamber } = Common.data;
  for (const phase of fight.phases) {
    for (const name of phase.specials) {
      assert.ok(Specials.SPECIALS[name], name);
      assert.ok(specials[name], name);
    }
    if (phase.mage) {
      assert.ok(npcs.mages[phase.mage]);
      assert.ok(chamber.mages[phase.mage]);
    }
  }
  assert.equal(chamber.aisles.length, 4);
});

test("the mages' and reavers' hits land with their projectiles (#1862)", (t) => {
  require("../dist/Server").Server.installProductionPathResolver();
  const { Projectile } = require("../dist/game/model/Projectile");
  const { Location } = require("../dist/game/model/Location");
  const added = {
    Projectile,
    Animation: class {},
    CombatType: { MAGIC: "magic" },
    CombatMethod: class {},
    CombatFactory: { applyStyleDamage: () => {} },
    PendingHit: class {
      constructor(attacker, target, method, delay) { this.delay = delay; }
      getDelay() { return this.delay; }
    },
  };
  Object.assign(fakeApi.core, added);
  t.after(() => { for (const key of Object.keys(added)) delete fakeApi.core[key]; });
  const sent = [];
  t.mock.method(Projectile.prototype, "sendProjectile", function () { sent.push(this); });
  const providers = new Map();
  const registrar = new Proxy({
    registerNpcCombatMethodProvider: (ids, method) => { for (const id of [].concat(ids)) providers.set(id, method); },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require("../plugins/bosses/nex/Mages.Nex").attachMages(registrar);
  Specials.attachSpecials(registrar);
  const mobile = (x, y) => ({
    getLocation: () => new Location(x, y, 0), getSize: () => 1, getPrivateArea: () => null,
    getIndex: () => 1, isPlayer: () => false, performAnimation: () => {},
  });
  const { npcs } = Common.data;
  const cases = [
    ["fumus", npcs.mages.fumus, (npc) => { npc.__nexMage = "fumus"; }],
    ["glacies", npcs.mages.glacies, (npc) => { npc.__nexMage = "glacies"; }],
    ["reaver", [].concat(npcs.reaver)[0], () => {}],
  ];
  for (const [name, id, setup] of cases) {
    for (const tiles of [1, 8]) {
      const npc = mobile(2925, 5203);
      setup(npc);
      const player = mobile(2925 + tiles, 5203);
      const method = new (providers.get(id))();
      const before = sent.length;
      method.start(npc, player);
      assert.equal(sent.length, before + 1, `${name} sends a projectile`);
      const shot = sent.at(-1);
      assert.ok(shot.speed > shot.delay + 1, `${name} lands after it launches`);
      assert.equal(method.hits(npc, player)[0].getDelay(), Math.max(1, Math.ceil(shot.speed / 30)), `${name} at ${tiles} tiles`);
    }
  }
});

test("Nex's loot roll is marked as loot, not a second kill: the fight counts the kill", () => {
  const player = { sendMessage() {} };
  const original = fakeApi.core.ItemDefinition.forId;
  fakeApi.getItemOnGroundManager = () => ({ registerLocation() {} });
  fakeApi.core.Item = class { constructor(itemId, amount) { this.itemId = itemId; this.amount = amount; } };
  fakeApi.core.ItemDefinition.forId = (id) => ({ ...original(id), getNoteId: () => -1, isNoted: () => false, isStackable: () => true });
  try {
    const fight = { boss: {}, arena: { area: {} }, contribution: new Map([[player, 100]]) };
    const before = events.length;
    Loot.reward(fight, [player], {});
    const rolls = events.slice(before).filter(([name]) => name === "npc-drops:roll").map(([, payload]) => payload);
    assert.equal(rolls.length, 1);
    assert.equal(rolls[0].countKill, false);
    assert.equal(rolls[0].npc, fight.boss);
  } finally {
    fakeApi.core.ItemDefinition.forId = original;
  }
});

test("an eligible Ironman keeps a personal Nex reward after a shared kill", async (t) => {
  // Exercise the real hit queue and Nex's registered death/reward path without running a server.
  // One-damage test hits and a deterministic table are fixture inputs, not OSRS rate claims.
  const path = require("node:path");
  const { Server } = require("../dist/Server");
  Server.installProductionPathResolver();
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  const native = PluginManager.getCoreApi();
  const core = { ...native, ItemDefinition: { forId: () => ({
    getNoteId: () => -1, isNoted: () => false, isStackable: () => true,
  }) } };
  const hooks = new Map(), custom = new Map(), tasks = [], placed = [], rolls = [], spawned = [];
  const add = (map, name, fn) => { if (!map.has(name)) map.set(name, []); map.get(name).push(fn); };
  const dispatch = (name, event) => { for (const fn of hooks.get(name) ?? []) fn(event); };
  const api = new Proxy({
    core,
    persistAttribute() {}, registerNpcCombatMethodProvider() {}, registerArea() {},
    onCustomEvent: (name, fn) => add(custom, name, fn),
    emitCustomEvent(name, event) {
      if (name === "npc-drops:roll-table") {
        for (const entry of FAKE_TABLE.filter((item) => !event.entryFilter || event.entryFilter(item))) {
          event.drops.push({ itemId: entry.item_id, amount: entry.amount ?? 1, noted: false });
        }
      }
      const roll = name === "npc-drops:roll" ? { player: event.player, before: event.drops.map((d) => d.itemId), countKill: event.countKill } : null;
      for (const fn of custom.get(name) ?? []) fn(event);
      if (roll) { roll.after = event.drops.map((d) => d.itemId); rolls.push(roll); }
    },
    getItemOnGroundManager: () => ({ registerLocation: (owner, item) => placed.push({ owner, id: item.getId() }) }),
    removeNpc: (npc) => npc.setRegistered(false),
  }, { get: (target, name) => target[name] ?? ((...args) => {
    const fn = args.at(-1);
    if (typeof fn === "function") add(hooks, name, fn);
  }) });
  const ironCommonPath = require.resolve("../plugins/modes/ironman/Common.Ironman");
  const ironLootPath = require.resolve("../plugins/modes/ironman/Loot.Ironman");
  const previousIronCommon = require.cache[ironCommonPath], previousIronLoot = require.cache[ironLootPath];
  let fight, participants = [];
  t.after(() => {
    fight?.stop();
    for (const task of tasks) if (task.isRunning?.()) task.stop();
    for (const npc of spawned) { npc.getCombat().getHitQueue().clear(); npc.setRegistered(false); }
    for (const player of participants) { player.getCombat().getHitQueue().clear(); player.setRegistered(false); }
    if (previousIronCommon) require.cache[ironCommonPath] = previousIronCommon;
    else delete require.cache[ironCommonPath];
    if (previousIronLoot) require.cache[ironLootPath] = previousIronLoot;
    else delete require.cache[ironLootPath];
    Common.init(fakeApi);
  });
  delete require.cache[ironCommonPath]; delete require.cache[ironLootPath];
  const Iron = require(ironCommonPath);
  Iron.init(api);
  require(ironLootPath)(api);
  require("../plugins/bosses/Nex.plugin").register(api);
  for (const [gameval, key] of [["nex", "nex"], ["nex_spawning", "spawning"], ["nex_soulsplit", "soulSplit"], ["nex_deflect", "deflect"], ["nex_dying", "dying"]]) {
    assert.equal(core.CacheDefinitions.getNpcId(gameval), Common.data.npcs[key], `${gameval} matches the active cache`);
  }
  let cycle = 0, ended = false;
  t.mock.method(native.World, "getProcessCycle", () => cycle);
  t.mock.method(native.World, "getRemoveNPCQueue", () => []);
  t.mock.method(native.World, "markNpcCombatActive", () => {});
  t.mock.method(native.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });
  t.mock.method(PluginManager, "emitNpcHitModify", (npc, hit) => { const event = { npc, hit }; dispatch("onNpcHitModify", event); return event.hit; });
  t.mock.method(PluginManager, "emitNpcBeforeDeath", (event) => { dispatch("onNpcBeforeDeath", event); return event.preventDeath; });
  t.mock.method(PluginManager, "emitNpcDeath", (event) => dispatch("onNpcDeath", event));
  t.mock.method(PluginManager, "emitPlayerDealtDamage", (event) => dispatch("onPlayerDealtDamage", event));
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => api.emitCustomEvent(name, event));
  t.mock.method(Common, "say", () => {});
  t.mock.method(Common, "areaSound", () => {});
  t.mock.method(Common, "projectile", () => {});
  t.mock.method(Common, "damage", () => {});
  const tile = (coords) => new core.Location(...coords);
  for (const name of ["iron", "main", "observer"]) {
    const player = new Player(null, tile(Common.data.chamber.aisles[0].end));
    participants.push(player);
    const sender = new Proxy({}, { get: (_, key) => key === "getVarbit" || key === "getVarp" ? () => 0 : () => sender });
    player.getPacketSender = () => sender;
    player.messages = [];
    player.sendMessage = (message) => player.messages.push(message);
    player.setUsername(name); player.setRegistered(true); player.setNeedsPlacement(false); player.setHitpoints(99);
  }
  const [iron, main, observer] = participants;
  iron.setAttribute("ironman:mode", "ironman");
  const arena = {
    area: {}, tile, players: () => participants,
    spawn(id, coords) {
      const npc = core.NPC.create(id, tile(coords));
      spawned.push(npc);
      npc.setRegistered(true); npc.setNeedsPlacement(false);
      npc.__skipDefaultRespawn = true;
      t.mock.method(npc.getCombat(), "attack", () => {});
      return npc;
    },
    ended: (_fight, killed) => { ended = killed; },
  };
  fight = new Fight(arena);
  // Suppress unrelated boss attacks and visuals; retain source phase transitions and death callbacks.
  fight.pickTarget = () => {}; fight.move = () => {}; fight.act = () => {}; fight.blast = () => {};
  for (let i = 0; i <= Common.data.spawn.firstAttackTick && (fight.stage === "spawning" || fight.tick < fight.immuneUntil); i++) fight.process();
  assert.equal(fight.stage, "fighting");
  assert.ok(fight.tick >= fight.immuneUntil);
  const method = new (class extends core.CombatMethod { type() { return core.CombatType.RANGED; } })();
  let nextPlayer = 0;
  function hit(target) {
    const attacker = [iron, main][nextPlayer++ % 2];
    const pending = new core.PendingHit(attacker, target, method, {
      delay: 0, damage: 1, rollAccuracy: false, experience: false, handleAfterHitEffects: false,
    });
    core.CombatFactory.addPendingHit(pending);
    target.getCombat().getHitQueue().process(++cycle);
    fight.process();
  }
  while (fight.phase().mage) {
    const phase = fight.phase();
    const floor = Math.floor(Common.data.fight.hitpoints * phase.floor);
    const bossHits = fight.boss.getHitpoints() - floor;
    for (let i = 0; i < bossHits; i++) hit(fight.boss);
    assert.equal(fight.boss.getHitpoints(), floor);
    const mage = fight.mages.get(phase.mage);
    assert.ok(fight.vulnerable.has(phase.mage));
    const mageHits = mage.getHitpoints();
    for (let i = 0; i < mageHits; i++) hit(mage);
    assert.equal(mage.getHitpoints(), 0);
    const death = tasks.find((task) => task instanceof NPCDeathTask && task.npc === mage);
    assert.ok(death, "the real mage death task was scheduled");
    death.execute(); death.execute();
    const previous = fight.phaseIndex;
    for (let i = 0; i <= Common.data.fight.nextPhaseTicks && fight.phaseIndex === previous; i++) fight.process();
    assert.equal(fight.phaseIndex, previous + 1);
  }
  const finalHits = fight.boss.getHitpoints();
  for (let i = 0; i < finalHits; i++) hit(fight.boss);
  assert.equal(fight.stage, "dying", "NPC.appendDeath reached Nex's registered before-death hook");
  const owed = Loot.shares(fight.contribution, participants).owed.map((entry) => entry.player);
  assert.ok(owed.includes(iron) && owed.includes(main));
  assert.ok(!owed.includes(observer));
  for (let i = 0; i <= Common.data.wrath.damageTick && !fight.stopped; i++) fight.process();
  assert.equal(fight.stopped, true);
  assert.equal(ended, true);
  const ironRoll = rolls.find((roll) => roll.player === iron);
  const mainRoll = rolls.find((roll) => roll.player === main);
  assert.ok(ironRoll.before.includes(565), "Nex produced the Ironman's personal fixture reward");
  assert.equal(ironRoll.countKill, false);
  assert.ok(mainRoll.after.includes(565) && placed.some((drop) => drop.owner === main && drop.id === 565), "normal Nex participant receives the same fixture reward");
  assert.ok(!rolls.some((roll) => roll.player === observer), "a participant without a share gets no roll");
  assert.ok(ironRoll.after.includes(565) && placed.some((drop) => drop.owner === iron && drop.id === 565), "the Ironman's personal reward survives the shared-kill filter");
  assert.ok(!iron.messages.includes(Iron.message("sharedKill")), "no shared-kill refusal for an eligible Nex reward");
});
