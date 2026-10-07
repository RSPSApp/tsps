// Run after `yarn build`: node --test tests/inferno.test.cjs
// Drives the Inferno plugin against a small fake engine, so it runs without the game cache.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Location } = require('../dist/game/model/Location');
const { Area } = require('../dist/game/model/areas/Area');
const { AreaManager } = require('../dist/game/model/areas/AreaManager');
const { CombatType } = require('../dist/game/content/combat/CombatType');
const { NpcIdentifiers: Npcs } = require('../dist/util/NpcIdentifiers');
const { ItemIdentifiers: Items } = require('../dist/util/ItemIdentifiers');
const { ObjectIdentifiers: Objects } = require('../dist/util/ObjectIdentifiers');
const { waveAt, FINAL_WAVE } = require('../plugins/minigames/inferno/InfernoWaves');

const HITPOINTS = {
  [Npcs.JAL_NIB]: 10, [Npcs.JAL_MEJRAH]: 25, [Npcs.JAL_AK]: 40, [Npcs.JAL_AKREK_MEJ]: 15,
  [Npcs.JAL_AKREK_XIL]: 15, [Npcs.JAL_AKREK_KET]: 15, [Npcs.JAL_IMKOT]: 75, [Npcs.JAL_XIL]: 125,
  [Npcs.JAL_ZEK]: 220, [Npcs.JALTOK_JAD]: 350, [Npcs.YT_HURKOT_2]: 90, [Npcs.JAL_XIL_2]: 125,
  [Npcs.JAL_ZEK_2]: 220, [Npcs.JALTOK_JAD_2]: 350, [Npcs.YT_HURKOT_3]: 90, [Npcs.TZKAL_ZUK]: 1200,
  [Npcs.COL_00FFFF_ANCESTRAL_GLYPH_COL]: 600, [Npcs.JAL_MEJJAK]: 75,
  [Npcs.COL_00FFFF_ROCKY_SUPPORT_COL]: 255, [Npcs.COL_00FFFF_ROCKY_SUPPORT_COL_2]: 255,
};
const SIZES = {
  [Npcs.JAL_MEJRAH]: 2, [Npcs.JAL_AK]: 3, [Npcs.JAL_IMKOT]: 4, [Npcs.JAL_XIL]: 3, [Npcs.JAL_ZEK]: 4,
  [Npcs.JALTOK_JAD]: 5, [Npcs.JALTOK_JAD_2]: 5, [Npcs.TZKAL_ZUK]: 7, [Npcs.COL_00FFFF_ANCESTRAL_GLYPH_COL]: 3,
  [Npcs.COL_00FFFF_ROCKY_SUPPORT_COL]: 3, [Npcs.COL_00FFFF_ROCKY_SUPPORT_COL_2]: 3,
};
const SUPPORT_VARBIT = 9000;
const ENTRANCE_VARBIT = 5646;

function footprint(mob) {
  const tiles = [];
  for (let x = 0; x < mob.getSize(); x++) for (let y = 0; y < mob.getSize(); y++) tiles.push(mob.getLocation().transform(x, y));
  return tiles;
}

class FakeMob {
  constructor(location, hitpoints) {
    this.location = location;
    this.hitpoints = hitpoints;
    this.registered = true;
    this.animations = [];
    this.target = null;
    this.attackDelay = 0;
    const mob = this;
    this.combat = {
      attack(target) { mob.target = target; },
      getTarget: () => mob.target,
      reset() { mob.target = null; },
      setAttackDelay(ticks) { mob.attackDelay = ticks; },
      getLastAttack: () => ({ reset() {} }),
      getHitQueue: () => ({ addPendingDamage(hits) { for (const hit of hits) mob.hitpoints -= hit.damage; } }),
    };
    this.movement = {
      blocked: false, reset() {}, size: () => 0, setBlockMovement(value) { this.blocked = value; },
      addSteps(to) { mob.walkingTo = { x: to.getX(), y: to.getY() }; },
    };
  }

  getLocation() { return this.location; }
  getHitpoints() { return this.hitpoints; }
  setHitpoints(value) { this.hitpoints = value; return this; }
  getCombat() { return this.combat; }
  getMovementQueue() { return this.movement; }
  isRegistered() { return this.registered; }
  calculateDistance(other) { return Location.calculateDistance(footprint(this), footprint(other)); }
  moveTo(location) { this.location = location.clone(); return this; }
  performAnimation(animation) { this.animations.push(animation.id); }
  performGraphic() {}
  setMobileInteraction() {}
  setUntargetable(value) { this.untargetable = value; }
  setScriptedMovement(value) { this.scripted = value; }
}

class FakeNpc extends FakeMob {
  constructor(id, location) {
    super(location, HITPOINTS[id] ?? 10);
    this.id = id;
  }

  getId() { return this.id; }
  setScriptedMovement(value) { this.scripted = value; }
  setFlag(flag) { (this.flags ??= new Set()).add(flag); return this; }
  hasFlag(flag) { return this.flags?.has(flag) === true; }
  getSize() { return SIZES[this.id] ?? 1; }
  getDefinition() { return { getHitpoints: () => HITPOINTS[this.id] ?? 10 }; }
  heal(amount) { this.hitpoints = Math.min(this.getDefinition().getHitpoints(), this.hitpoints + amount); }
  isNpc() { return true; }
  isPlayer() { return false; }
}

class FakePlayer extends FakeMob {
  constructor(attributes = {}) {
    super(new Location(2495, 5111, 0), 99);
    this.attributes = new Map(Object.entries(attributes));
    this.messages = [];
    this.dialogues = [];
    this.varbits = new Map();
    this.items = new Map();
    this.cape = -1;
    this.runEnergy = 100;
    const player = this;
    this.packets = {
      sendVarbit(id, value) { player.varbits.set(id, value); return this; },
      sendRunEnergy() { return this; },
      sendObjectAnimation() { return this; },
      sendSubInterface(target, id) { player.overlay = id; return this; },
      closeSubInterface() { player.overlay = null; return this; },
    };
    this.inventory = {
      contains: (id) => (player.items.get(id) ?? 0) > 0,
      adds(id, amount) { player.items.set(id, (player.items.get(id) ?? 0) + amount); },
      delete(id, amount) { player.items.set(id, (player.items.get(id) ?? 0) - amount); },
      getFreeSlots: () => 28,
    };
  }

  getSize() { return 1; }
  getAttribute(key) { return this.attributes.get(key); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  sendMessage(message) { this.messages.push(message); }
  getPacketSender() { return this.packets; }
  getInventory() { return this.inventory; }
  getEquipment() { return { get: () => ({ getId: () => this.cape }) }; }
  getDialogueManager() { return { startDialogues: (chain) => this.dialogues.push(chain.lines) }; }
  getRunEnergy() { return this.runEnergy; }
  setRunEnergy(value) { this.runEnergy = value; }
  getArea() { return this.area; }
  setArea(area) { this.area = area; }
  isNpc() { return false; }
  isPlayer() { return true; }
}

class FakeTask {
  constructor(delay) { this.delay = delay; }
  stop() { this.stopped = true; }
}

class FakeArea {
  constructor() { this.destroyed = false; this.members = new Set(); }
  enter(mob) { this.add(mob); }
  add(mob) { this.members.add(mob); mob.area = this; }
  leave(mob) { this.members.delete(mob); }
  destroy() { this.destroyed = true; }
  isDestroyed() { return this.destroyed; }
}

function createWorld() {
  const world = { cycle: 0, tasks: [], npcs: [], objects: new Set(), removedObjects: [], hits: [], projectiles: 0, providers: new Map(), hooks: {}, random: 0 };
  const core = {
    World: { getProcessCycle: () => world.cycle },
    Location,
    Boundary: class {},
    PrivateArea: FakeArea,
    Misc: {
      getRandom: (max) => Math.min(max, world.random),
      randomInclusive: (min, max) => Math.min(max, Math.max(min, min + world.random)),
    },
    NpcIdentifiers: Npcs,
    ItemIdentifiers: Items,
    ObjectIdentifiers: Objects,
    CombatType,
    CombatMethod: class {},
    PendingHit: class {
      constructor(attacker, target, method, config) {
        Object.assign(this, { attacker, target, style: method.type(), rollAccuracy: config?.rollAccuracy ?? true });
      }
    },
    CombatFactory: { addPendingHit: (hit) => world.hits.push(hit) },
    PrayerHandler: { PROTECT_FROM_MAGIC: 16, PROTECT_FROM_MISSILES: 17, isActivated: (mob, prayer) => mob.prayers?.has(prayer) === true },
    Projectile: class {
      static createProjectile() { return { sendProjectile: () => world.projectiles++ }; }
      static arrivalCycles() { return 60; }
      static arrivalTicks() { return 2; }
      static centreOf(mob) { return mob.getLocation(); }
      sendProjectile() { world.projectiles++; }
    },
    Task: FakeTask,
    TaskManager: { submit: (task) => world.tasks.push({ task, remaining: task.delay }) },
    Animation: class { constructor(id) { this.id = id; } },
    Graphic: class { constructor(id) { this.id = id; } },
    HitDamage: class { constructor(damage) { this.damage = damage; } },
    HitMask: { RED: 1, BLUE: 0 },
    GameObject: class { constructor(id, location, type, face) { Object.assign(this, { id, location, type, face }); } },
    ObjectManager: {
      register: (object) => world.objects.add(object),
      deregister: (object) => { world.objects.delete(object); world.removedObjects.push(object.id); },
    },
    CacheDefinitions: {
      getObject: (id) => {
        if (id >= 30353 && id <= 30355) return { transforms: [30284, 30285, 30286, 30287, -1], transformVarbit: SUPPORT_VARBIT };
        if (id === 30352) return { transforms: [30281, 30281, 30282], transformVarbit: ENTRANCE_VARBIT }; // as in the cache
        return { actions: id === 30282 ? ['Jump-in'] : [null] };
      },
    },
    NpcDefinition: { forId: (id) => ({ getHitpoints: () => HITPOINTS[id] ?? 10 }) },
    ItemDefinition: { forId: () => ({ isStackable: () => true }) },
    Item: class {},
    ItemOnGroundManager: { registerLocation() {} },
    RegionManager: { blocked: () => false },
    PathFinder: { calculateWalkRoute: (npc, x, y) => { npc.walkingTo = { x, y }; } },
    DialogueChainBuilder: class { constructor() { this.lines = []; } add(entry) { if (entry.text) this.lines.push(entry.text); return this; } },
    NpcDialogue: class { constructor(index, npcId, text) { this.text = text; } },
    EndDialogue: class {},
    Equipment: { CAPE_SLOT: 1 },
  };
  const hook = (name) => (...args) => { (world.hooks[name] ??= []).push(args.at(-1)); };
  const api = {
    core,
    spawnNpc: ({ id, x, y }) => {
      const npc = new FakeNpc(id, new Location(x, y, 0));
      world.npcs.push(npc);
      return npc;
    },
    removeNpc: (npc) => { npc.registered = false; },
    registerNpcCombatMethodProvider: (ids, ctor) => { for (const id of [ids].flat()) world.providers.set(id, ctor); },
    persistAttribute: hook('persist'),
    sendMultiChatboxPrompt: (player, title, ...pairs) => { world.prompt = { title, pairs }; return true; },
    emitCustomEvent: () => {},
  };
  for (const name of ['onNpcDialogueCondition', 'onCustomEvent', 'onObjectFirstClick', 'onObjectSecondClick', 'onObjectRoute', 'onPlayerLogin', 'onPlayerLogout', 'onPlayerProcess',
    'onPlayerDeath', 'onShouldDropItemsOnDeath', 'onCanTeleport', 'onCanAttack', 'onNpcBeforeDeath', 'onCombatHitResolved',
    'registerCommand']) {
    api[name] = hook(name);
  }
  return { world, api };
}

// One plugin load per file: its modules keep their state at module scope.
const { world, api } = createWorld();
require('../plugins/minigames/Inferno.plugin').register(api);
const run = require('../plugins/minigames/inferno/InfernoRun');
const entry = require('../plugins/minigames/inferno/InfernoEntry');

function tick(player, ticks = 1) {
  for (let count = 0; count < ticks; count++) {
    world.cycle++;
    for (const scheduled of [...world.tasks]) {
      if (--scheduled.remaining > 0) continue;
      world.tasks.splice(world.tasks.indexOf(scheduled), 1);
      scheduled.task.execute();
    }
    run.processRun({ player });
  }
}

const living = (id) => world.npcs.filter((npc) => npc.id === id && npc.registered && npc.hitpoints > 0);
const kill = (npc) => npc.setHitpoints(0);
const killWave = (session) => [...session.npcs].forEach(kill);

function startAt(wave, attributes = {}) {
  const player = new FakePlayer({ [run.ATTR_WAVE]: wave, ...attributes });
  run.resumeRun({ player });
  return { player, session: run.sessionOf(player) };
}

test('the wave table has 69 waves built from the tier rule', () => {
  assert.equal(FINAL_WAVE, 69);
  assert.deepEqual(waveAt(1), { nibblers: 3, monsters: ['bat'] });
  for (const wave of [3, 8, 17, 34]) assert.deepEqual(waveAt(wave), { nibblers: 6, monsters: [] });
  assert.deepEqual(waveAt(62), { nibblers: 3, monsters: ['bat', 'bat', 'blob', 'meleer', 'ranger', 'mager'] });
  assert.deepEqual(waveAt(66), { nibblers: 3, monsters: ['mager', 'mager'] });
  assert.deepEqual(waveAt(67).monsters, ['jad']);
  assert.deepEqual(waveAt(68).monsters, ['jad', 'jad', 'jad']);
  assert.deepEqual(waveAt(69).monsters, ['zuk']);
  assert.equal(waveAt(70), null);
});

test('an area can declare itself multi-combat outside the Wilderness', () => {
  class MultiArea extends Area { isMulti() { return true; } }
  class SingleArea extends Area {}
  const at = new Location(2271, 5343, 0);
  assert.equal(AreaManager.inMulti({ getArea: () => new MultiArea([]), getLocation: () => at }), true);
  assert.equal(AreaManager.inMulti({ getArea: () => new SingleArea([]), getLocation: () => at }), false);
  assert.equal(AreaManager.inMulti({ getArea: () => null, getLocation: () => at }), false);
});

test('every creature has a combat method', () => {
  for (const id of [Npcs.JAL_MEJRAH, Npcs.JAL_AK, Npcs.JAL_AKREK_MEJ, Npcs.JAL_AKREK_XIL, Npcs.JAL_AKREK_KET,
    Npcs.JAL_IMKOT, Npcs.JAL_XIL, Npcs.JAL_ZEK, Npcs.JALTOK_JAD, Npcs.JAL_XIL_2, Npcs.JAL_ZEK_2, Npcs.JALTOK_JAD_2]) {
    assert.ok(world.providers.has(id), `no combat method for ${id}`);
  }
});

test('a run raises three supports and opens with Jal-Nib on a support and a bat on the player', () => {
  const player = new FakePlayer({ [entry.ATTR_SACRIFICED]: true });
  entry.jumpIn({ player });
  const session = run.sessionOf(player);
  assert.ok(session);
  assert.equal(session.supports.length, 3);
  assert.equal(player.varbits.get(SUPPORT_VARBIT), 0);
  assert.equal(player.getLocation().getX(), 2271);
  tick(player, 10);
  assert.ok(player.messages.some((message) => message.includes('Wave: 1')));
  const nibblers = [...session.npcs].filter((npc) => npc.id === Npcs.JAL_NIB);
  assert.equal(nibblers.length, 3);
  assert.ok(nibblers.every((npc) => npc.target === session.supports[0].npc));
  const bat = [...session.npcs].find((npc) => npc.id === Npcs.JAL_MEJRAH);
  assert.equal(bat.target, player);

  killWave(session);
  tick(player);
  assert.equal(player.getAttribute(run.ATTR_WAVE), 2);
  assert.deepEqual(player.getAttribute(run.ATTR_SUPPORTS), { west: 255, north: 255, south: 255 });
  tick(player, 8);
  assert.ok(player.messages.some((message) => message.includes('Wave: 2')));
  run.leave(player);
});

test('a damaged support draws a later stage, and collapses on whatever stands beside it', () => {
  const { player, session } = startAt(1);
  tick(player, 10);
  const support = session.supports[0];
  support.npc.setHitpoints(100);
  tick(player);
  assert.equal(player.varbits.get(SUPPORT_VARBIT), 2);

  const nibbler = [...session.npcs].find((npc) => npc.id === Npcs.JAL_NIB);
  nibbler.moveTo(support.npc.getLocation().transform(-1, 0));
  const bat = [...session.npcs].find((npc) => npc.id === Npcs.JAL_MEJRAH);
  bat.moveTo(support.npc.getLocation().transform(3, 0));
  support.npc.setHitpoints(0);
  tick(player);
  assert.equal(session.supports.length, 2);
  assert.ok(!world.objects.has(support.object));
  assert.equal(support.npc.isRegistered(), false);
  assert.equal(nibbler.getHitpoints(), 0);
  assert.equal(bat.getHitpoints(), 13);
  tick(player);
  const others = [...session.npcs].filter((npc) => npc.id === Npcs.JAL_NIB);
  assert.ok(others.every((npc) => npc.target !== support.npc));
  run.leave(player);
});

test('fallen supports stay down when a run resumes', () => {
  const { player, session } = startAt(10, { [run.ATTR_SUPPORTS]: { west: 0, north: 40, south: 255 } });
  assert.deepEqual(session.supports.map((support) => support.key), ['north', 'south']);
  assert.equal(session.supports[0].npc.getHitpoints(), 40);
  run.leave(player);
});

test('a Jal-Ak splits into three blobs that hold the wave open', () => {
  const { player, session } = startAt(4);
  tick(player, 10);
  const blob = [...session.npcs].find((npc) => npc.id === Npcs.JAL_AK);
  [...session.npcs].filter((npc) => npc !== blob).forEach(kill);
  kill(blob);
  tick(player);
  const blobs = [...session.npcs].map((npc) => npc.id).sort();
  assert.deepEqual(blobs, [Npcs.JAL_AKREK_MEJ, Npcs.JAL_AKREK_XIL, Npcs.JAL_AKREK_KET].sort());
  assert.equal(player.getAttribute(run.ATTR_WAVE), 4);
  killWave(session);
  tick(player);
  assert.equal(player.getAttribute(run.ATTR_WAVE), 5);
  run.leave(player);
});

test('Jal-Zek raises a fallen creature once, at half health', () => {
  const { player, session } = startAt(36);
  tick(player, 10);
  const bat = [...session.npcs].find((npc) => npc.id === Npcs.JAL_MEJRAH);
  const mager = [...session.npcs].find((npc) => npc.id === Npcs.JAL_ZEK);
  kill(bat);
  tick(player);
  assert.deepEqual(session.fallen, [Npcs.JAL_MEJRAH]);
  assert.equal(run.tryRevive(mager), false, 'not before its first cooldown');
  world.cycle += 60;
  assert.equal(run.tryRevive(mager), true);
  tick(player, 2);
  const revived = [...session.npcs].find((npc) => npc.id === Npcs.JAL_MEJRAH);
  assert.equal(revived.getHitpoints(), 12);
  assert.equal(revived.target, player);
  kill(revived);
  tick(player);
  assert.deepEqual(session.fallen, []);
  run.leave(player);
});

test('a meleer that cannot land a hit burrows up beside the player', () => {
  const { player, session } = startAt(9);
  tick(player, 10);
  const meleer = [...session.npcs].find((npc) => npc.id === Npcs.JAL_IMKOT);
  tick(player, 15);
  assert.equal(meleer.untargetable, true);
  assert.ok(meleer.animations.includes(7600));
  tick(player, 4);
  assert.equal(meleer.calculateDistance(player), 1, 'moved beside the player');
  assert.ok(!meleer.animations.includes(7601), 'not on the tick it teleports: it is out of view then');
  tick(player, 1);
  assert.equal(meleer.untargetable, false);
  assert.ok(meleer.animations.includes(7601), 'it rises the tick after');
  run.leave(player);
});

test('the Jad waves call healers at half health, then hand over to TzKal-Zuk', () => {
  const { player, session } = startAt(67);
  assert.equal(session.supports.length, 0);
  tick(player, 10);
  const jad = [...session.npcs].find((npc) => npc.id === Npcs.JALTOK_JAD);
  assert.equal(jad.attackDelay, 4);
  jad.setHitpoints(170);
  tick(player);
  assert.equal(living(Npcs.YT_HURKOT_2).length, 5);
  kill(jad);
  tick(player);
  assert.equal(living(Npcs.YT_HURKOT_2).length, 0);
  assert.equal(player.getAttribute(run.ATTR_WAVE), 68);
  tick(player, 8);
  const jads = [...session.npcs].filter((npc) => npc.id === Npcs.JALTOK_JAD);
  assert.deepEqual(jads.map((npc) => npc.attackDelay), [4, 7, 10]);
  killWave(session);
  tick(player);
  assert.equal(player.getAttribute(run.ATTR_WAVE), 69);
  tick(player, 2);
  assert.ok(session.zuk);
  run.leave(player);
});

test('TzKal-Zuk: the glyph shields, summons arrive on cue and his death wins the cape', () => {
  const { player, session } = startAt(69);
  tick(player, 10);
  const { zuk, glyph } = session.zuk;
  assert.equal(player.getMovementQueue().blocked, true);
  assert.ok(world.removedObjects.includes(30338));
  assert.equal(glyph.getHitpoints(), 600);
  assert.ok([zuk, glyph].every((npc) => npc.hasFlag('combat:no-retaliate')), 'a hit does not stop the glyph or turn either');
  assert.equal(player.varbits.get(6719), 2, 'the minimap dims while the prison breaks');
  assert.ok([30339, 30340, 30341, 30342].every((id) => [...world.objects].some((object) => object.id === id)), 'the wall is patched');
  tick(player, 11);
  assert.equal(player.getMovementQueue().blocked, false);
  assert.equal(player.overlay, 596, "Zuk's health overlay");
  assert.equal(player.varbits.get(5654), zuk.getDefinition().getHitpoints());
  assert.equal(player.varbits.get(5653), zuk.getHitpoints());
  assert.equal(player.varbits.get(6719), 0);

  glyph.moveTo(new Location(2270, 5361, 0));
  player.moveTo(new Location(2271, 5357, 0));
  const before = player.getHitpoints();
  world.random = 100;
  tick(player, 15 + 2);
  assert.equal(player.getHitpoints(), before, 'shielded behind the glyph');
  player.moveTo(new Location(2280, 5350, 0));
  tick(player, 10 + 2);
  assert.ok(player.getHitpoints() < before, 'struck when out in the open');
  world.random = 0;

  zuk.setHitpoints(470);
  tick(player);
  assert.equal(player.varbits.get(5653), 470, 'the overlay follows his hitpoints');
  const summonedJad = living(Npcs.JALTOK_JAD_2)[0];
  assert.equal(summonedJad.target, glyph);
  summonedJad.setHitpoints(170);
  tick(player);
  assert.equal(living(Npcs.YT_HURKOT_3).length, 3);
  zuk.setHitpoints(230);
  tick(player);
  assert.equal(living(Npcs.JAL_MEJJAK).length, 4);

  player.setHitpoints(99);
  kill(zuk);
  tick(player);
  assert.equal(living(Npcs.JAL_MEJJAK).length, 0);
  tick(player, 8);
  assert.equal(run.sessionOf(player), null);
  assert.equal(player.overlay, null, 'the overlay closes with the run');
  assert.equal(player.items.get(Items.INFERNAL_CAPE), 1);
  assert.equal(player.items.get(Items.TOKKUL), 16440);
  assert.equal(run.completions(player), 1);
  assert.equal(player.getAttribute(run.ATTR_WAVE), null);
  assert.equal(player.getLocation().getX(), 2495);
});

test('dying keeps the items and pays half the hitpoints of the waves cleared in TokKul', () => {
  const { player } = startAt(3);
  const event = { player, handled: false };
  run.runDeath(event);
  assert.equal(event.handled, true);
  // Waves 1 and 2: a bat, then two bats.
  assert.equal(player.items.get(Items.TOKKUL), Math.floor((25 * 3) / 2));
  assert.equal(run.sessionOf(player), null);
  const drop = { player, shouldDrop: null };
  run.keepItemsInRun(drop);
  assert.equal(drop.shouldDrop, null, 'only inside a run');
});

test('players cannot strike the supports or glyph, and only Jal-Nib go for supports', () => {
  const { player, session } = startAt(1);
  const support = session.supports[0].npc;
  const deny = (attacker, target) => {
    const event = { attacker, target, allow: null };
    run.guardPassives(event);
    return event.allow;
  };
  const nibbler = run.spawn(session, Npcs.JAL_NIB, { x: 2266, y: 5345 });
  const zuk = run.spawn(session, Npcs.TZKAL_ZUK, { x: 2268, y: 5364 });
  assert.equal(deny(player, support), false);
  assert.equal(deny(nibbler, support), null);
  assert.equal(deny(support, nibbler), false);
  assert.equal(deny(zuk, player), false);
  assert.equal(deny(player, zuk), null);
  run.leave(player);
});

test('TzHaar-Ket-Keh takes the fire cape and opens the chasm', () => {
  const definition = { getName: () => 'TzHaar-Ket-Keh' };
  const player = new FakePlayer();
  player.inventory.adds(Items.FIRE_CAPE, 1);
  const ask = (text) => entry.answerCondition({ player, definition, text });
  assert.equal(ask('If the player has not yet sacrificed a fire cape:'), true);
  assert.equal(ask('If the player has sacrificed a fire cape:'), false);
  assert.equal(ask('If the player has a fire cape in their inventory:'), true);
  assert.equal(ask('If the player does not have a fire cape:'), false);
  assert.equal(ask('If the player has not yet beaten the Inferno:'), true);
  assert.equal(entry.answerCondition({ player, definition: { getName: () => 'Banker' }, text: 'If the player has sacrificed a fire cape:' }), null);

  entry.jumpIn({ player });
  assert.equal(run.sessionOf(player), null, 'no entry before the sacrifice');

  const handOver = { player, definition, stepId: '9TOkei', handled: false };
  entry.handOverCape(handOver);
  assert.equal(player.items.get(Items.FIRE_CAPE), 1, 'the action announcement is not the hand-over');
  entry.handOverCape({ ...handOver, kind: 'message' });
  assert.equal(player.items.get(Items.FIRE_CAPE), 0);
  assert.equal(ask('If the player has sacrificed a fire cape:'), true);
  assert.equal(player.varbits.get(ENTRANCE_VARBIT), 2);
});

test('ranged and magic hits are rolled on impact, so the prayer up then is the one that counts', () => {
  const player = new FakePlayer();
  const bat = new FakeNpc(Npcs.JAL_MEJRAH, new Location(2270, 5340, 0));
  bat.registered = true;
  const method = new (world.providers.get(Npcs.JAL_MEJRAH))();
  world.hits.length = 0;
  method.start(bat, player);
  assert.deepEqual(method.hits(bat, player), []);
  assert.equal(world.hits.length, 0);
  tick(player, 2);
  assert.equal(world.hits.length, 1);
  assert.equal(world.hits[0].style, CombatType.RANGED);
  assert.equal(player.runEnergy, 97);
  assert.equal(method.attackDistance(bat), 3);
});

test('Jal-Ak attacks with the style the protection prayer does not cover', () => {
  const player = new FakePlayer();
  const blob = new FakeNpc(Npcs.JAL_AK, new Location(2270, 5330, 0));
  const method = new (world.providers.get(Npcs.JAL_AK))();
  const styleAgainst = (prayer) => {
    player.prayers = new Set(prayer == null ? [] : [prayer]);
    world.hits.length = 0;
    method.start(blob, player);
    method.hits(blob, player);
    tick(player, 4);
    return world.hits[0].style;
  };
  assert.equal(styleAgainst(16), CombatType.RANGED);
  assert.equal(styleAgainst(17), CombatType.MAGIC);
  assert.equal(method.type(), CombatType.RANGED, 'keeps its distance');
});

test('Jal-Xil keeps range between melee swings and reaches further on the Zuk wave', () => {
  const player = new FakePlayer();
  const Ranger = world.providers.get(Npcs.JAL_XIL);
  const method = new Ranger();
  const ranger = new FakeNpc(Npcs.JAL_XIL, new Location(2270, 5357, 0));
  player.moveTo(new Location(2273, 5357, 0));
  method.start(ranger, player);
  const hits = method.hits(ranger, player);
  assert.equal(method.type(), CombatType.RANGED);
  assert.equal(method.attackDistance(ranger), 14);
  assert.equal(method.attackDistance(new FakeNpc(Npcs.JAL_XIL_2, new Location(0, 0, 0))), 30);
  if (hits.length) assert.equal(hits[0].style, CombatType.MELEE);
});

test('the chasm is jumped into from the tip of the walkway, as its pit has no walkable edge', () => {
  const { routeToChasm } = require('../plugins/minigames/inferno/InfernoEntry');
  const route = (x) => {
    const event = { objectId: 30352, player: { getLocation: () => new Location(x, 5110, 0) } };
    routeToChasm(event);
    return event.destination;
  };
  assert.deepEqual(route(2496), { x: 2496, y: 5119, z: 0 });
  assert.deepEqual(route(2499), { x: 2497, y: 5119, z: 0 }, 'the nearer of the two tip tiles');
  const other = { objectId: 30283, player: { getLocation: () => new Location(2496, 5110, 0) } };
  routeToChasm(other);
  assert.equal(other.destination, undefined);
});

test('Jal-Nib leave the player alone while a support stands, then always hit them', () => {
  const { player, session } = startAt(1);
  tick(player, 20);
  const nibblers = [...session.npcs].filter((npc) => npc.id === Npcs.JAL_NIB);
  assert.ok(nibblers.length > 0);
  assert.ok(nibblers.every((npc) => npc.hasFlag('combat:no-retaliate')), 'hitting one does not turn it');
  const deny = (attacker, target) => {
    const event = { attacker, target, allow: null };
    run.guardPassives(event);
    return event.allow;
  };
  assert.equal(deny(nibblers[0], player), false);

  nibblers[0].target = player;
  tick(player);
  assert.ok(session.supports.some((support) => support.npc === nibblers[0].target), 'back onto a support');

  session.supports.length = 0;
  nibblers[0].target = null;
  tick(player);
  assert.equal(nibblers[0].target, player, 'with no support left it goes for the player');
  assert.equal(deny(nibblers[0], player), null);
  tick(player);
  assert.equal(nibblers[0].target, player, 'and stays on them');

  const method = new (world.providers.get(Npcs.JAL_NIB))();
  const strike = (target) => {
    method.start(nibblers[0], target);
    return method.hits(nibblers[0], target)[0];
  };
  const onPlayer = strike(player);
  assert.equal(onPlayer.style, CombatType.MELEE);
  assert.equal(onPlayer.rollAccuracy, false, 'every attack on the player lands');
  const support = new FakeNpc(Npcs.COL_00FFFF_ROCKY_SUPPORT_COL, new Location(2257, 5349, 0));
  assert.equal(strike(support).rollAccuracy, true, 'on a support it is rolled');
  run.leave(player);
});

test('::infernowave sets the next wave: after the one under way, or for the next run', () => {
  const player = new FakePlayer();
  run.setNextWave({ player, parts: ['infernowave', '70'] });
  assert.match(player.messages.at(-1), /^Usage/);
  run.setNextWave({ player, parts: ['infernowave', '30'] });
  run.enter(player);
  const session = run.sessionOf(player);
  assert.equal(session.wave, 30, 'the run starts there');

  tick(player, 20);
  assert.equal(session.nextWaveAt, -1, 'wave 30 is under way');
  run.setNextWave({ player, parts: ['infernowave', '67'] });
  assert.equal(session.wave, 30, 'the wave under way is finished first');
  for (const npc of [...session.npcs]) { npc.hitpoints = 0; session.npcs.delete(npc); }
  tick(player);
  assert.equal(session.wave, 67);
  assert.equal(session.supports.length, 0, 'the supports come down before the Jads');
  run.leave(player);
  assert.equal(run.sessionOf(player), null);
});

test('the cave exit, a map loc, can be walked to from inside the arena, and Quick-exit leaves', () => {
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  const { player, session } = startAt(1);
  const at = (z, area) => ({ getLocation: () => new Location(2269, 5325, z), getPrivateArea: () => area, getId: () => 30283, getType: () => 10 });
  const valid = (object) => MovementQueue.prototype.isInteractionObjectValid.call(
    { player: { getLocation: () => new Location(2271, 5330, 0), getPrivateArea: () => session.area } }, object, 30283, 10);
  assert.equal(valid(at(0, null)), true, 'shared by the arena laid over the map');
  assert.equal(valid(at(0, session.area)), true);
  assert.equal(valid(at(0, { other: true })), false, "another private area's loc");
  assert.equal(valid(at(1, null)), false, 'another plane');

  const entry = require('../plugins/minigames/inferno/InfernoEntry');
  assert.equal(entry.quickExit({ player }), true);
  assert.equal(run.sessionOf(player), null, 'out without being asked');
});

test('the supports the map has standing are removed when a run starts without them', () => {
  world.removedObjects.length = 0;
  const { player: jadPlayer } = startAt(67);
  assert.deepEqual([...world.removedObjects].sort(), [30353, 30354, 30355], 'none on the Jad waves');
  run.leave(jadPlayer);

  world.removedObjects.length = 0;
  const { player, session } = startAt(10, { [run.ATTR_SUPPORTS]: { west: 0, north: 200, south: 255 } });
  assert.deepEqual(world.removedObjects, [30353], 'a support that collapsed before the logout stays down');
  assert.equal(session.supports.length, 2);
  run.leave(player);
});

test('an NPC flagged to ignore clipping steps straight on (the glyph, over the pit before Zuk)', () => {
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  const step = (flagged) => MovementQueue.prototype.validatedStep.call(
    { character: { hasFlag: (flag) => flagged && flag === MovementQueue.IGNORE_CLIPPING_FLAG } },
    new Location(2270, 5361, 0), new Location(2257, 5361, 0));
  assert.deepEqual([step(true).getX(), step(true).getY()], [2269, 5361]);
  assert.equal(MovementQueue.IGNORE_CLIPPING_FLAG, 'movement:ignore-clipping', 'the flag the Zuk plugin sets');
});

test('logging out mid-wave ends the run as dying does; between waves the run is kept', () => {
  const { player: waiting, session: kept } = startAt(3);
  assert.notEqual(kept.nextWaveAt, -1, 'wave 3 has not begun');
  run.runLogout({ player: waiting });
  assert.equal(run.sessionOf(waiting), kept);
  assert.equal(waiting.getAttribute(run.ATTR_WAVE), 3);
  run.leave(waiting);

  const { player, session } = startAt(3);
  tick(player, 20);
  assert.equal(session.nextWaveAt, -1, 'wave 3 is under way');
  run.runLogout({ player });
  assert.equal(run.sessionOf(player), null);
  assert.equal(player.getAttribute(run.ATTR_WAVE), null, 'nothing to resume');
  assert.equal(player.items.get(Items.TOKKUL), Math.floor((25 * 3) / 2), 'the TokKul for waves 1 and 2');
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2495, 5111], 'back outside');
});

test("Zuk's ranger and mager come as a set, and not again while the last set stands", () => {
  const { player, session } = startAt(69);
  tick(player, 21 + 75);
  const set = () => [...living(Npcs.JAL_XIL_2), ...living(Npcs.JAL_ZEK_2)];
  assert.equal(set().length, 2, 'the first set, 45 seconds in');
  tick(player, 350);
  assert.equal(set().length, 2, 'no second set while the first is up');
  set().forEach(kill);
  tick(player, 350);
  assert.equal(set().length, 2, 'the next set once the last is down');

  session.zuk.zuk.setHitpoints(200);
  tick(player, 2); // the Jad, then the healers
  const healer = living(Npcs.JAL_MEJJAK)[0];
  assert.ok(healer.hasFlag('combat:no-retaliate'));
  const before = session.zuk.zuk.getHitpoints();
  tick(player, 10);
  const healed = session.zuk.zuk.getHitpoints() - before;
  assert.ok(healed > 0 && healed <= 4 * 4 * 24, 'healers heal 15-24 each, every 3 ticks (Wiki)');
  assert.ok(healer);
  run.leave(player);
});

test('Inferno NPCs block and die with their own animations, not ones guessed from what they play', () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  CachePipeline.initialize();
  new NpcDefinitionLoader().load();
  const anims = (id) => [NpcDefinition.forId(id).getDefenceAnim(), NpcDefinition.forId(id).getDeathAnim()];
  assert.deepEqual(anims(Npcs.COL_00FFFF_ANCESTRAL_GLYPH_COL), [-1, 7569], 'a hit on the glyph is not its collapse');
  assert.deepEqual(anims(Npcs.TZKAL_ZUK), [7565, 7562], 'a hit on Zuk is not his breakout (7563)');
  assert.deepEqual(anims(Npcs.JAL_MEJJAK), [2869, 2866], 'a hit on a healer is not its rising (2864)');
  assert.deepEqual(anims(Npcs.JAL_XIL_2), [7607, 7606], 'Jal-Xil does not die with its melee swing (7604)');
  assert.deepEqual(anims(Npcs.JAL_NIB), [7575, 7576]);
});
