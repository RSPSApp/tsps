// Run after `yarn build`: node --test tests/colosseum.test.cjs
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const Shared = require('../plugins/minigames/colosseum/ColosseumShared');
const Waves = require('../plugins/minigames/colosseum/ColosseumWaves');
const Modifiers = require('../plugins/minigames/colosseum/ColosseumModifiers');
const Run = require('../plugins/minigames/colosseum/ColosseumRun');
const Lobby = require('../plugins/minigames/colosseum/Lobby.Colosseum');
const Arena = require('../plugins/minigames/colosseum/Arena.Colosseum');
const Enemies = require('../plugins/minigames/colosseum/Enemies.Colosseum');
const Effects = require('../plugins/minigames/colosseum/ModifierEffects.Colosseum');
const Hazards = require('../plugins/minigames/colosseum/ColosseumHazards');
const Sol = require('../plugins/minigames/colosseum/SolHeredit.Colosseum');
const Patterns = require('../plugins/minigames/colosseum/SolPatterns');

const hooks = { objects: {}, npcs: {}, buttons: [], prompts: [], dialogues: [], variants: [], custom: {}, login: [], death: [], drops: [], attack: [] };
const spawned = [];
let nextIndex = 1;

function fakeNpc(id, x, y) {
  const npc = {
    id, index: nextIndex++, location: new Location(x, y, 0), hp: 10, registered: true, chats: [], anims: [], target: null,
    getId: () => id,
    getIndex: () => npc.index,
    getLocation: () => npc.location,
    getHitpoints: () => npc.hp,
    setHitpoints(value) { npc.hp = value; },
    isRegistered: () => npc.registered,
    isPlayer: () => false,
    isNpc: () => true,
    getAsNpc: () => npc,
    setArea() {},
    forceChat(text) { npc.chats.push(text); },
    performAnimation(animation) { npc.anims.push(animation.getId?.() ?? animation.id); },
    performGraphic() {},
    slots: new Map(),
    performGraphicInSlot(slot, graphic) {
      if (graphic) npc.slots.set(slot, graphic.getId?.() ?? graphic.id);
      else npc.slots.delete(slot);
    },
    delay: 0,
    maxHp: 10,
    getMaxHitpoints: () => npc.maxHp,
    getSize: () => 1,
    getPrivateArea: () => null,
    flags: new Set(),
    moved: false,
    steps: 1,
    preserved: 0,
    setFlag(flag) { npc.flags.add(flag); },
    setMovementSteps(steps) { npc.steps = steps; },
    getMovementQueue: () => ({ didMoveThisCycle: () => npc.moved }),
    timers: new Map(),
    getTimers: () => ({ registers: (key, ticks) => npc.timers.set(key, ticks) }),
    getCombat: () => ({
      attack(target) { npc.target = target; },
      getTarget: () => npc.target,
      setAttackDelay(t) { npc.delay = t; },
      preserveMovementForTicks(t) { npc.preserved = t; },
    }),
  };
  return npc;
}

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onObjectInteraction: (name, actions) => { hooks.objects[name] = { ...(hooks.objects[name] ?? {}), ...actions }; },
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onNpcRoute: (handler) => (hooks.npcRoute ??= []).push(handler),
    onCombatHitRoll: () => {},
    registerNpcCombatMethodProvider: () => {},
    onInterfaceActionButton: (ids, handler) => hooks.buttons.push({ ids: [].concat(ids), handler }),
    onNpcDialogueVariant: (handler) => hooks.variants.push(handler),
    onCustomEvent: (name, handler) => (hooks.custom[name] ??= []).push(handler),
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onPlayerDeath: (handler) => hooks.death.push(handler),
    onPlayerDeathItemDrop: (handler) => hooks.drops.push(handler),
    onCanAttack: (handler) => hooks.attack.push(handler),
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    emitCustomEvent: (name, payload) => {
      if (name === 'npc-dialogue:start') {
        hooks.dialogues.push(payload.variant);
        payload.handled = true;
      }
    },
    spawnNpc: ({ id, x, y }) => {
      const npc = fakeNpc(id, x, y);
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { npc.registered = false; },
  };
}

/** Base and current levels by skill index, with the core's temporary cap on base levels. */
function fakeSkills() {
  const base = new Map();
  const current = new Map();
  const caps = new Map();
  const skills = {
    base, current, caps,
    getMaxLevel: (skill) => Math.min(base.get(skill.getIndex()) ?? 99, caps.get(skill.getIndex()) ?? Infinity),
    getCurrentLevel: (skill) => current.get(skill.getIndex()) ?? skills.getMaxLevel(skill),
    setCurrentLevel(skill, level) { current.set(skill.getIndex(), level); return skills; },
    decreaseCurrentLevel(skill, amount, minimum) {
      current.set(skill.getIndex(), Math.max(minimum, skills.getCurrentLevel(skill) - amount));
    },
    setMaxLevelCap(skill, cap) {
      if (cap == null) caps.delete(skill.getIndex());
      else caps.set(skill.getIndex(), cap);
      if (skills.getCurrentLevel(skill) > skills.getMaxLevel(skill)) current.set(skill.getIndex(), skills.getMaxLevel(skill));
      return skills;
    },
  };
  return skills;
}

function fakePlayer(name = 'Gladiator') {
  const varbits = new Map();
  const attributes = new Map();
  const skills = fakeSkills();
  const p = {
    skills, damage: [], splats: [], poison: [], venomed: false, inventories: {}, texts: {},
    getSkillManager: () => skills,
    getHitpoints: () => skills.getCurrentLevel(PluginManager.getCoreApi().Skill.HITPOINTS),
    getCombat: () => ({
      getHitQueue: () => ({ addPendingDamage: (hits) => p.damage.push(...hits.map((hit) => hit.getDamage())) }),
      getPoisonImmunityTimer: () => ({ finished: () => true }),
      getCastSpell: () => null,
      getAutocastSpell: () => null,
    }),
    showHitsplat: (damage, splat) => p.splats.push([damage, splat.mine]),
    prayers: [],
    getPrayerActive: () => p.prayers,
    equipment: [],
    getEquipment: () => ({ getItems: () => p.equipment }),
    isVenomed: () => p.venomed,
    setVenomed(value) { p.venomed = value; },
    // Already poisoned, so the core starts no poison task on this fake.
    isPoisoned: () => true,
    getPoisonDamage: () => p.poison.at(-1) ?? 0,
    setPoisonDamage(value) { p.poison.push(value); },
    location: new Location(1805, 9506, 0), area: null, messages: [], scripts: [], interfaces: [], statements: [],
    getUsername: () => name,
    getIndex: () => 7,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    isRegistered: () => true,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    getArea: () => p.area,
    setArea(area) { p.area = area; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => p.messages.push(message),
    getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendSubInterface: (uid, id) => { p.interfaces.push(id); return sender; },
        sendInterface: (id) => { p.interfaces.push(id); return sender; },
        sendInterfaceRemoval: () => { p.interfaces.push(-1); return sender; },
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendInterfaceFlagsRange: () => sender,
        sendGraphic: () => sender,
        sendProjectile: () => sender,
        sendPoisonType: () => sender,
        sendInventory: (id, capacity, items) => { p.inventories[id] = items.map(({ id: item, amount }) => [item, amount]); return sender; },
        sendString: (text, uid) => { p.texts[uid] = text; return sender; },
        sendObjectAnimation: () => sender,
      };
      return sender;
    },
    varbits,
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  // The fake NPCs here have no real movement queue to route.
  PluginManager.getCoreApi().PathFinder.calculateWalkRoute = () => {};
  const api = fakeApi();
  Lobby(api);
  Arena(api);
});

beforeEach(() => {
  hooks.prompts.length = 0;
  hooks.dialogues.length = 0;
});

// ------------------------------------------------------------------ waves

test('wave composition follows the Wiki breakdown', () => {
  const I = Waves.ids();
  const none = new Modifiers.ModifierSet();
  const count = (list, id) => list.filter((x) => x === id).length;
  const w1 = Waves.startingNpcs(1, none);
  assert.deepEqual(w1, [I.berserker, I.archer, I.seer, I.shaman], 'capture: the trio and a shaman');
  assert.equal(count(Waves.startingNpcs(3, none), I.javelin), 2);
  assert.equal(count(Waves.startingNpcs(4, none), I.manticore), 1);
  assert.equal(count(Waves.startingNpcs(9, none), I.manticore), 2);
  assert.equal(count(Waves.startingNpcs(7, none), I.shockwave), 1);
  assert.deepEqual(Waves.reinforcements(1, none), [I.jaguar]);
  assert.deepEqual(Waves.reinforcements(10, none), [I.shaman, I.minotaur]);
  const quartet = new Modifiers.ModifierSet();
  quartet.add(6);
  assert.equal(Waves.startingNpcs(1, quartet).filter((id) => Waves.isFremennik(id)).length, 4, 'Quartet adds a warbander');
});

test('the trio forms around a middle tile; the rest take distinct points away from the player', () => {
  const I = Waves.ids();
  const player = { getLocation: () => new Location(1811, 3104, 0) };
  const npcs = [I.berserker, I.archer, I.seer, I.shaman, I.javelin, I.manticore];
  for (let seed = 0; seed < 50; seed++) {
    let s = seed + 1;
    const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const placed = Waves.placeWave(npcs, player, random);
    const berserker = placed.find((p) => p.id === I.berserker);
    const archer = placed.find((p) => p.id === I.archer);
    const seer = placed.find((p) => p.id === I.seer);
    assert.deepEqual([archer.x - berserker.x, archer.y - berserker.y], [-1, -1]);
    assert.deepEqual([seer.x - berserker.x, seer.y - berserker.y], [1, -1]);
    const others = placed.slice(3);
    assert.equal(new Set(others.map((p) => `${p.x},${p.y}`)).size, others.length, 'distinct points');
    for (const p of others) assert.ok(Math.max(Math.abs(p.x - 1811), Math.abs(p.y - 3104)) > 4, 'not on the player');
  }
});

// ------------------------------------------------------------------ modifiers

test('modifiers come from the cache; wave 1 offers Blasphemy, Relentless and Frailty', () => {
  const blasphemy = Modifiers.byKey(4);
  assert.equal(blasphemy.name, 'Blasphemy');
  assert.equal(blasphemy.tiered, true);
  assert.equal(blasphemy.glory, 100, 'capture: varp 4135 became 100');
  assert.equal(Modifiers.byKey(13).name, 'Red Flag');
  assert.equal(Modifiers.byKey(13).tiered, false);
  const set = new Modifiers.ModifierSet();
  assert.deepEqual(set.offer(1), [4, 5, 12], 'capture: script 4931 got 4, 5, 12');
});

test('offers skip maxed modifiers and hold Red Flag and Dynamic Duo back until wave 7', () => {
  const set = new Modifiers.ModifierSet();
  for (let i = 0; i < 3; i++) set.add(4);
  set.add(6);
  for (let i = 0; i < 200; i++) {
    const offer = set.offer(3);
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer).size, 3);
    assert.ok(!offer.includes(4), 'Blasphemy (III) is maxed');
    assert.ok(!offer.includes(6), 'Quartet has no tiers');
    assert.ok(!offer.includes(13) && !offer.includes(9), 'not before wave 7');
  }
  assert.ok(Array.from({ length: 200 }, () => set.offer(7)).some((offer) => offer.includes(13)));
});

// ------------------------------------------------------------------ lobby

test("the tunnel waits for Minimus's introduction; then a warning and a choice", () => {
  const player = fakePlayer();
  Lobby.tunnel({ player, objectId: 50751 });
  assert.deepEqual(hooks.dialogues, ['attempting-to-enter-the-arena-before-talking-to-minimus']);
  assert.equal(hooks.variants[0]({ player, npcId: Shared.NPC.MINIMUS_LOBBY }), 'first-time-dialogue');
  assert.equal(player.varbits.get(Shared.VARBIT.INTRO), 1, 'capture: varbit 9807');
  assert.equal(hooks.variants[0]({ player, npcId: Shared.NPC.MINIMUS_LOBBY }), null, 'only once');
  Lobby.tunnel({ player, objectId: 50751 });
  assert.equal(player.statements.length, 1, 'the warning box');
});

test('the lobby bank chest is for Brawlers (2,000 Glory) and up', () => {
  const player = fakePlayer();
  assert.equal(Lobby.bankChest({ player, objectId: Shared.OBJECT.BANK_CHEST }), true);
  assert.deepEqual(hooks.dialogues, ['attempting-to-use-the-bank-chest-without-enough-glory']);
  player.setAttribute(Shared.ATTR.GLORY, 2000);
  assert.equal(Lobby.bankChest({ player, objectId: Shared.OBJECT.BANK_CHEST }), false, 'the bank opens');
  assert.equal(Lobby.bankChest({ player, objectId: 12345 }), false, 'other chests untouched');
});

test("Minimus's [rank] is the Glory title", () => {
  const player = fakePlayer();
  player.setAttribute(Shared.ATTR.GLORY, 8500);
  const request = { player, npcId: Shared.NPC.MINIMUS_LOBBY, text: 'Welcome, [rank].' };
  hooks.custom['npc-dialogue:line'][0](request);
  assert.equal(request.text, 'Welcome, Gladiator.');
});

// ------------------------------------------------------------------ a run

test('a run: Minimus greets, the screen offers the modifiers, and confirming starts wave 1', () => {
  const player = fakePlayer('Runner');
  const run = Run.start(player);
  assert.ok(Shared.inArena(player.location));
  assert.deepEqual([player.location.getX(), player.location.getY()], [1824, 3094], 'capture');
  const route = PluginManager.getCoreApi().PathFinder.calculateWalkRoute;
  const walked = [];
  PluginManager.getCoreApi().PathFinder.calculateWalkRoute = (who, x, y) => walked.push([who, x, y]);
  ticks(1);
  PluginManager.getCoreApi().PathFinder.calculateWalkRoute = route;
  assert.deepEqual(walked, [[player, 1824, 3104]], 'capture: then walks up to a tile short of Minimus');
  assert.deepEqual(run.minimus.chats, ['A Rookie approaches!']);
  ticks(2);
  assert.deepEqual(run.minimus.chats, ['A Rookie approaches!', 'Let me know when you want to begin.']);
  assert.equal(run.sol.getId(), Shared.NPC.SOL_SEATED);

  hooks.npcs.Minimus['Start-wave']({ player, npc: run.minimus });
  assert.ok(player.interfaces.includes(Shared.INTERFACE.INTERMISSION));
  const [script, ...args] = player.scripts.at(-1);
  assert.equal(script, 4931);
  assert.equal(args.length, 8, "this cache's 4931 takes 8 ints");
  assert.ok(args.every((arg) => Number.isInteger(arg)));
  assert.deepEqual([args[0], args[1], args[2], args[3], args[4], args[6], args[7]], [0, 4, 5, 12, 0, 0, 0],
    'waves done, the offer, the loot so far, (next wave), the last wave, 0');
  assert.deepEqual(player.inventories[844], [[28924, 80]], 'capture: wave 1 is worth 80 sunfire splinters');
  const click = (component) => hooks.buttons.find((b) => b.ids.includes((865 << 16) | component)).handler({ player, buttonId: (865 << 16) | component });
  click(15);
  assert.equal(player.varbits.get(Shared.VARBIT.SELECTED_MODIFIER), 1);
  assert.deepEqual(player.scripts.slice(-2), [[4934, 4, 5, 12, 0], [4932, 0]], 'the highlight and Continue redrawn');
  click(41);
  assert.equal(player.varbits.get(9790), 1, 'Blasphemy tier varbit');
  assert.equal(player.varbits.get('varp4135'), 100);
  assert.equal(run.minimus, null);
  ticks(4);
  assert.equal(run.stage, 'starting');
  ticks(1);
  assert.equal(run.stage, 'wave');
  assert.ok(player.messages.includes('<col=ef1020>Wave: 1</col>'));
  assert.equal(run.npcs.size, 4);
  assert.equal(player.varbits.get(Shared.VARBIT.HIGHEST_WAVE), 1);
  for (const npc of run.npcs) assert.equal(npc.target, player, 'they come for the player');

  for (const npc of run.npcs) npc.hp = 0;
  ticks(1);
  assert.equal(run.wave, 1);
  assert.equal(run.stage, 'intermission');
  assert.match(player.messages.at(-1), /^Wave 1 completed! Duration: /);
  assert.ok(run.minimus, 'Minimus is back');
  run.end('left');
});

test('reinforcements come through the nearest gate after 40 seconds', () => {
  const player = fakePlayer('Slow');
  const run = Run.start(player);
  hooks.npcs.Minimus['Start-wave']({ player, npc: run.minimus });
  run.selectModifier(2);
  run.confirm();
  ticks(5);
  const before = run.npcs.size;
  ticks(Waves.REINFORCEMENT_TICKS - 1);
  assert.equal(run.npcs.size, before);
  ticks(1);
  const jaguar = [...run.npcs].find((npc) => npc.getId() === Waves.ids().jaguar);
  assert.ok(jaguar, 'the jaguar warrior joins wave 1');
  assert.equal(jaguar.getLocation().getY(), 3091, 'the south gate, nearer the player');
  run.end('left');
});

test('leaving before wave 1 asks once; dying ends the run in the lobby', () => {
  const player = fakePlayer('Leaver');
  const run = Run.start(player);
  hooks.npcs.Minimus.Leave({ player, npc: run.minimus });
  assert.equal(hooks.prompts[0].title, 'Are you sure you wish to leave?');
  hooks.prompts[0].args[1]();
  assert.equal(run.stage, 'ended');
  ticks(2);
  assert.deepEqual([player.location.getX(), player.location.getY()], [1804, 9508]);

  const dier = fakePlayer('Dier');
  const second = Run.start(dier);
  const event = { player: dier, handled: false };
  hooks.death[0](event);
  assert.equal(event.handled, true);
  assert.equal(second.stage, 'ended');
  assert.equal(Run.runOf(dier), null);
  assert.deepEqual([dier.location.getX(), dier.location.getY()], [1804, 9508]);
});

// ------------------------------------------------------------------ phase 2: enemies

test('enemy numbers follow the Wiki', () => {
  const E = Enemies.ENEMY;
  assert.deepEqual([E.berserker.max, E.seer.max, E.archer.max], [29, 12, 14]);
  assert.deepEqual([E.berserker.range, E.seer.range, E.archer.range], [1, 1, 1], 'the trio fight in melee range');
  assert.deepEqual([E.shaman.max, E.shaman.range, E.shaman.speed], [27, 10, 5]);
  assert.deepEqual([E.jaguar.max, E.jaguar.hits], [47, 3]);
  assert.deepEqual([E.javelin.max, E.javelin.range], [48, 15]);
  assert.deepEqual([E.shockwave.max, E.shockwave.range], [56, 15]);
  assert.deepEqual([E.manticore.speed, E.manticore.range], [10, 15]);
  assert.deepEqual([E.minotaur.max, E.minotaur.hitDelay], [74, 2]);
});

test('every enemy waits 3 ticks after appearing; the trio then swing berserker, seer, archer', () => {
  const I = Waves.ids();
  const delays = [I.berserker, I.seer, I.archer, I.shaman].map((id) => {
    const npc = fakeNpc(id, 0, 0);
    Enemies.onSpawn(npc);
    return npc.delay;
  });
  assert.deepEqual(delays, [3, 4, 5, 3]);
});

test('the Javelin Colossus throws a javelin up every fifth attack; it lands 3 ticks later on that tile', () => {
  const { JavelinMethod } = Enemies.build();
  const method = new JavelinMethod();
  const npc = fakeNpc(Waves.ids().javelin, 1820, 3110);
  const target = fakePlayer('Javelined');
  target.location = new Location(1820, 3100, 0);
  target.hp = 99;
  target.getHitpoints = () => target.hp;
  target.getSize = () => 1;
  target.getPrivateArea = () => null;
  const damage = [];
  npc.__colosseumRun = { stage: 'wave', modifiers: new Modifiers.ModifierSet(), hurt: (amount) => damage.push(amount) };
  for (let i = 0; i < 4; i++) { method.start(npc, target); assert.equal(method.artillery, false); }
  method.start(npc, target);
  assert.equal(method.artillery, true);
  assert.equal(method.hits(npc, target).length, 0, 'no ordinary hit');
  assert.ok(npc.anims.includes(10893));
  ticks(3);
  assert.equal(damage.length, 1, 'still on the tile');
  assert.ok(damage[0] >= 0 && damage[0] <= 40);
  for (let i = 0; i < 5; i++) method.start(npc, target);
  target.location = new Location(1821, 3100, 0);
  ticks(3);
  assert.equal(damage.length, 1, 'moved off the tile');
});

test('the Manticore throws magic and ranged in either order, then melee, a tick apart from the sixth tick', () => {
  const { ManticoreMethod } = Enemies.build();
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const method = new ManticoreMethod();
    const thrown = [];
    method.throwOrb = (npc, target, style) => thrown.push([style, ticksNow]);
    let ticksNow = 0;
    const npc = fakeNpc(Waves.ids().manticore, 1820, 3110);
    method.start(npc, fakePlayer());
    assert.ok(npc.anims.includes(10868), 'charge');
    for (; ticksNow < 9; ticksNow++) ticks(1);
    assert.deepEqual(thrown.map(([, t]) => t), [5, 6, 7], 'ticks 6, 7 and 8');
    assert.equal(thrown[2][0], 'MELEE');
    seen.add(thrown.slice(0, 2).map(([style]) => style).join('-'));
    assert.deepEqual(method.hits(), [], 'the orbs carry the hits');
  }
  assert.deepEqual([...seen].sort(), ['MAGIC-RANGED', 'RANGED-MAGIC']);
});

test('a Minotaur away from the player heals damaged enemies within 6 tiles to full', () => {
  const I = Waves.ids();
  const minotaur = fakeNpc(I.minotaur, 1820, 3100);
  const near = fakeNpc(I.javelin, 1824, 3102);
  const far = fakeNpc(I.javelin, 1830, 3100);
  near.maxHp = far.maxHp = 220;
  near.hp = far.hp = 100;
  const player = fakePlayer();
  player.location = new Location(1810, 3100, 0);
  const run = { npcs: new Set([minotaur, near, far]), player };
  Enemies.tendMinotaurs(run, 5);
  assert.equal(near.hp, 220);
  assert.equal(far.hp, 100, 'out of range');
  near.hp = 100;
  player.location = new Location(1821, 3100, 0);
  Enemies.tendMinotaurs(run, 10);
  assert.equal(near.hp, 100, 'busy fighting in melee range');
});

test('the trio run to their own tiles beside the player, through other NPCs, skipping swings on the move', () => {
  const I = Waves.ids();
  const core = PluginManager.getCoreApi();
  const routes = [];
  const original = core.PathFinder.calculateWalkRoute;
  core.PathFinder.calculateWalkRoute = (npc, x, y) => routes.push([npc.getId(), x, y]);
  try {
    const player = fakePlayer();
    player.location = new Location(1820, 3100, 0);
    const berserker = fakeNpc(I.berserker, 1825, 3110);
    const seer = fakeNpc(I.seer, 1821, 3100);
    const quartet = fakeNpc(I.archer, 1826, 3110);
    quartet.__colosseumOffset = Waves.TRIO_OFFSETS.quartet;
    for (const npc of [berserker, seer, quartet]) Enemies.onSpawn(npc);
    assert.equal(berserker.steps, 2, 'they run');
    assert.ok(berserker.flags.has(core.NPC.WALK_THROUGH_ENTITIES_FLAG));
    Enemies.tendWarband({ player, npcs: new Set([berserker, seer, quartet]) });
    assert.deepEqual(routes, [[I.berserker, 1820, 3101], [I.archer, 1820, 3099]], 'the seer is already east');
    assert.equal(berserker.preserved, 1, 'no ordinary chase while routing');
  } finally {
    core.PathFinder.calculateWalkRoute = original;
  }
  const { forKind } = Enemies.build();
  const method = new (forKind('seer'))();
  const seer = fakeNpc(I.seer, 0, 0);
  assert.equal(method.canAttack(seer), true);
  seer.moved = true;
  assert.equal(method.canAttack(seer), false, 'moving: the swing is skipped');
  assert.equal(seer.delay, 6, 'and the next waits a full cycle');
});

test("the style each of the trio is weak to always hits for the player's maximum", () => {
  const I = Waves.ids();
  const { CombatType } = PluginManager.getCoreApi();
  const player = fakePlayer();
  const roll = (id, combatType) => {
    const target = fakeNpc(id, 0, 0);
    target.__colosseumRun = {};
    const event = { attacker: player, target, combatType, forceAccurate: false, forceMaxHit: false };
    Enemies.weakness(event);
    return event.forceAccurate && event.forceMaxHit;
  };
  assert.equal(roll(I.berserker, CombatType.MAGIC), true);
  assert.equal(roll(I.seer, CombatType.RANGED), true);
  assert.equal(roll(I.archer, CombatType.MELEE), true);
  assert.equal(roll(I.berserker, CombatType.MELEE), false);
  assert.equal(roll(I.shaman, CombatType.MAGIC), false);
});

test('Start-wave and Leave reach Minimus from anywhere in the arena', () => {
  const player = fakePlayer('Far');
  const run = Run.start(player);
  const event = { player, npc: run.minimus, range: 1 };
  hooks.npcRoute[0](event);
  assert.ok(event.range >= 30);
  const other = { player, npc: fakeNpc(1, 0, 0), range: 1 };
  hooks.npcRoute[0](other);
  assert.equal(other.range, 1, 'other NPCs are walked to as usual');
  run.end('left');
});

// ------------------------------------------------------------------ modifier effects

/** A run in the middle of a wave, with the given modifier tiers. */
function runWith(tiers, name = 'Modified') {
  const player = fakePlayer(name);
  const run = Run.start(player);
  for (const [id, tier] of Object.entries(tiers)) run.modifiers.tiers.set(Modifiers.byId(id).key, tier);
  run.stage = 'wave';
  run.removeMinimus();
  return { player, run };
}

test('damage taken: the wave total, Blasphemy drains prayer, Doom stacks and kills', () => {
  const { Skill } = PluginManager.getCoreApi();
  const { player, run } = runWith({ blasphemy: 2, doom: 3 });
  run.hurt(10);
  assert.equal(player.varbits.get('varp4134'), 10, 'damage this wave');
  assert.equal(player.skills.getCurrentLevel(Skill.PRAYER), 99 - 4, '40% of 10');
  for (let i = 0; i < 3; i++) run.hurt(5);
  assert.deepEqual(player.splats.map(([stacks, splat]) => [stacks, splat]), [[1, 73], [2, 73], [3, 73], [4, 73]]);
  assert.equal(player.damage.length, 4);
  run.hurt(1);
  assert.equal(player.damage.at(-1), player.getHitpoints(), 'the fifth stack kills at Doom III');
  run.completeWave();
  assert.equal(run.doomStacks, 0, 'stacks clear with the wave');
  run.end('left');
});

test('an enemy blow counts as damage taken; other blows do not', () => {
  const { player, run } = runWith({ blasphemy: 1 });
  const npc = fakeNpc(Waves.ids().berserker, 0, 0);
  npc.__colosseumRun = run;
  Effects.enemyHitLanded({ attacker: npc, target: player, hit: { getTotalDamage: () => 20 } });
  Effects.enemyHitLanded({ attacker: fakeNpc(1, 0, 0), target: player, hit: { getTotalDamage: () => 20 } });
  assert.equal(run.waveDamage, 20);
  run.end('left');
});

test('Relentless: higher max hits, and at III every blow hits', () => {
  const { CombatType } = PluginManager.getCoreApi();
  const { player, run } = runWith({ relentless: 3 });
  assert.equal(Effects.maxHitBonus(run), 6);
  const npc = fakeNpc(Waves.ids().berserker, 0, 0);
  npc.__colosseumRun = run;
  const event = { attacker: npc, target: player, combatType: CombatType.MELEE, forceAccurate: false };
  Effects.relentless(event);
  assert.equal(event.forceAccurate, true);
  run.modifiers.tiers.set(Modifiers.byId('relentless').key, 1);
  assert.equal(Effects.maxHitBonus(run), 1);
  run.end('left');
});

test('Myopia shortens the player\'s reach, but not a manual cast', () => {
  const { player, run } = runWith({ myopia: 2 });
  const event = { attacker: player, distance: 10, manualCast: false };
  Effects.myopia(event);
  assert.equal(event.distance, 6);
  const melee = { attacker: player, distance: 1, manualCast: false };
  Effects.myopia(melee);
  assert.equal(melee.distance, 1, 'never below 1');
  const cast = { attacker: player, distance: 10, manualCast: true };
  Effects.myopia(cast);
  assert.equal(cast.distance, 10);
  run.end('left');
});

test('Frailty lowers the Hitpoints level for the run, without overhealing', () => {
  const { Skill } = PluginManager.getCoreApi();
  const { player, run } = runWith({ frailty: 2 });
  Effects.picked(run);
  assert.equal(player.skills.getMaxLevel(Skill.HITPOINTS), 80, '99 less 20%, rounded down');
  assert.equal(player.getHitpoints(), 80);
  player.skills.setCurrentLevel(Skill.HITPOINTS, 90);
  Effects.tick(run);
  assert.equal(player.getHitpoints(), 80, 'no overheal');
  run.end('left');
  assert.equal(player.skills.getMaxLevel(Skill.HITPOINTS), 99, 'back after the run');
});

test('Quartet adds a random warbander', () => {
  const I = Waves.ids();
  const quartet = new Modifiers.ModifierSet();
  quartet.add(Modifiers.byId('quartet').key);
  const fourth = (roll) => Waves.startingNpcs(1, quartet, () => roll)[3];
  assert.deepEqual([fourth(0), fourth(0.5), fourth(0.9)], [I.berserker, I.archer, I.seer]);
});

test('Solarflare circles a pillar on its 16 open tiles', () => {
  for (const pillar of Hazards.PILLARS) {
    const path = Hazards.ring(pillar);
    assert.equal(path.length, 16);
    assert.equal(path.filter((tile) => tile.corner).length, 4);
    for (const tile of path) {
      assert.equal(RegionManager.getClipping(tile.x, tile.y, 0) & 0x1280100, 0, `${tile.x},${tile.y} is open`);
    }
    for (let x = pillar.x; x < pillar.x + 3; x++) {
      assert.notEqual(RegionManager.getClipping(x, pillar.y + 1, 0) & 0x1280100, 0, 'the pillar blocks');
    }
  }
});

test('hazards never hold a wave open: bees and the orb go when it is cleared', () => {
  const { run } = runWith({ bees: 2, solarflare: 1 });
  Hazards.waveStarted(run);
  assert.equal(run.hazards.size, 3);
  assert.deepEqual([...run.hazards].map((npc) => npc.getId()).sort(), [12823, 12823, 12826]);
  run.tick();
  assert.equal(run.stage, 'intermission', 'no enemies left: the wave is done');
  assert.ok([...run.hazards].length === 0 && spawned.filter((npc) => npc.getId() === 12823).every((npc) => !npc.registered));
  run.end('left');
});

test('a swarm under the player stings every tick, and a killed one comes back after 30 seconds', () => {
  const { player, run } = runWith({ bees: 1 });
  Hazards.waveStarted(run);
  const [bee] = run.bees;
  bee.npc.location = new Location(player.location.getX() - 1, player.location.getY(), 0);
  bee.npc.getSize = () => 2;
  run.waveTicks = 1;
  Hazards.tick(run);
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] >= 1 && player.damage[0] <= 10);
  bee.npc.hp = 0;
  Hazards.tick(run);
  assert.equal(bee.npc, null);
  run.waveTicks += 49;
  Hazards.tick(run);
  assert.equal(bee.npc, null);
  run.waveTicks += 1;
  Hazards.tick(run);
  assert.ok(bee.npc, 'back after 50 ticks');
  run.end('left');
});

test('Reentry leaves molten sand; from II it stays for the run', () => {
  const { player, run } = runWith({ reentry: 3 });
  const tile = { x: 1824, y: 3105 };
  Hazards.javelinLanded(run, tile);
  assert.deepEqual([...run.sand.keys()], ['1824,3105', '1823,3104', '1822,3104']);
  player.location = new Location(1823, 3104, 0);
  run.waveTicks = 2;
  Hazards.tick(run);
  assert.equal(player.damage.length, 1);
  run.completeWave();
  assert.equal(run.sand.size, 3, 'permanent');
  run.end('left');
  assert.equal(run.sand.size, 0);

  const first = runWith({ reentry: 1 }, 'Tier one');
  Hazards.javelinLanded(first.run, tile);
  assert.equal(first.run.sand.size, 1);
  first.run.completeWave();
  assert.equal(first.run.sand.size, 0, 'gone with the wave');
  first.run.end('left');
});

test('Volatility: a dead enemy explodes one tile past its size', () => {
  const { player, run } = runWith({ volatility: 1 });
  const npc = fakeNpc(Waves.ids().berserker, 1820, 3100);
  player.location = new Location(1821, 3101, 0);
  Hazards.enemyDied(run, npc, 'berserker');
  ticks(2);
  assert.equal(player.damage.length, 1, 'caught in it');
  player.location = new Location(1822, 3100, 0);
  Hazards.enemyDied(run, npc, 'berserker');
  ticks(2);
  assert.equal(player.damage.length, 1, 'two tiles away is clear at tier I');
  run.end('left');
});

test('Totemic: a wounded enemy gets a totem to its south-west that heals 30% at a time', () => {
  const { run } = runWith({ totemic: 1 });
  const enemy = fakeNpc(Waves.ids().javelin, 1825, 3110);
  enemy.maxHp = 100;
  enemy.hp = 50;
  run.npcs.add(enemy);
  run.waveTicks = 10;
  Hazards.tick(run);
  const record = run.totems.get(enemy);
  assert.ok(record?.totem);
  assert.deepEqual([record.totem.location.getX(), record.totem.location.getY()], [1824, 3109]);
  run.waveTicks = 15;
  Hazards.tick(run);
  assert.ok(record.totem.anims.includes(10828));
  ticks(2);
  assert.equal(enemy.hp, 80);
  enemy.hp = 0;
  run.tick();
  assert.equal(record.totem.registered, false, 'the totem goes with its enemy');
  run.end('left');
});

// ------------------------------------------------------------------ Sol Heredit

test("Sol's patterns: Spear 1 is 5x6 and two lines of 4; the Shields leave one safe ring", () => {
  const sol = { x: 1823, y: 3105 };
  const player = { x: 1822, y: 3107 };
  assert.equal(Patterns.directionTo(sol, player), 'W');
  const first = Patterns.spear(sol, player, false);
  assert.equal(first.length, 25 + 5 + 8);
  assert.ok(first.some((tile) => tile.x === 1821 && tile.y === 3106), 'the line from (x-2, y+1)');
  assert.ok(!first.some((tile) => tile.x === 1821 && tile.y === 3105), 'Spear 1 leaves the corner line gap');
  const second = Patterns.spear(sol, player, true);
  assert.equal(second.length, 25 + 5 + 12);
  const centre = { x: sol.x + 2, y: sol.y + 2 };
  const ring = (tiles, r) => tiles.some((tile) => Math.max(Math.abs(tile.x - centre.x), Math.abs(tile.y - centre.y)) === r);
  assert.equal(ring(Patterns.shield(sol, false), 4), false, 'Shield 1: safe at 9x9');
  assert.equal(ring(Patterns.shield(sol, false), 5), true);
  assert.equal(ring(Patterns.shield(sol, true), 5), false, 'Shield 2: safe at 11x11');
  for (const tile of Patterns.shield(sol, true)) assert.ok(Patterns.inside(tile.x, tile.y));
});

test('the barricade closes the gaps between the four pillars', () => {
  const tiles = Patterns.barricade();
  const blocked = (x, y) => tiles.some((tile) => tile.x === x && tile.y === y) ||
    (RegionManager.getClipping(x, y, 0) & 0x1280100) !== 0;
  const { minX, maxX, minY, maxY } = Patterns.BARRICADE;
  for (let x = minX; x <= maxX; x++) assert.ok(blocked(x, minY) && blocked(x, maxY), `x ${x}`);
  for (let y = minY; y <= maxY; y++) assert.ok(blocked(minX, y) && blocked(maxX, y), `y ${y}`);
});

/** A run at wave 12 with Sol landed. */
function solRun(name = 'Challenger') {
  const player = fakePlayer(name);
  const run = Run.start(player);
  run.removeMinimus();
  run.wave = 11;
  run.stage = 'sol-landing';
  Sol.land(run);
  const sol = run.solFight.npc;
  sol.maxHp = 1500;
  sol.hp = 1500;
  return { player, run, fight: run.solFight, sol };
}

test('wave 12: Sol greets by attempt, lands behind the barricade, and his death brings out the chest', () => {
  const player = fakePlayer('Twelve');
  const run = Run.start(player);
  run.removeMinimus();
  run.wave = 11;
  run.loot.future = Loot.roll(12, player);
  run.stage = 'starting';
  run.startWave();
  assert.equal(run.stage, 'sol', 'his greeting first');
  assert.equal(player.getAttribute(Sol.ATTR.ATTEMPTS), 1);
  assert.equal(player.statements.length, 1);
  run.stage = 'sol-landing';
  Sol.land(run);
  assert.equal(run.stage, 'wave');
  assert.equal(run.sol, null, 'the seated Sol is gone');
  const sol = run.solFight.npc;
  assert.equal(sol.getId(), Sol.SOL);
  assert.deepEqual(sol.chats, ["Let's start by testing your footwork."]);
  assert.ok(run.barricade.length > 40);
  assert.ok(run.npcs.has(sol));
  sol.hp = 0;
  run.tick();
  assert.equal(run.stage, 'won');
  assert.equal(player.getAttribute(Sol.ATTR.KILLS), 1);
  ticks(5);
  assert.equal(run.stage, 'finished');
  assert.ok(run.chest, 'the rewards chest');
  assert.deepEqual([run.minimus.location.getX(), run.minimus.location.getY()], [1830, 3103], 'Minimus beside it');
  assert.ok(run.loot.rewards.some(({ id }) => id === 28947), "Dizana's quiver");
  assert.ok(Shared.gloryOf(player) > 0, 'Glory kept');
  run.end('left');
  assert.equal(run.barricade.length, 0);
});

test("Sol opens with a Spear, and a second Spear or Shield in a row uses the second pattern", () => {
  const { run, fight, sol } = solRun();
  assert.equal(Sol.nextAttack(fight), 'spear');
  assert.equal(Sol.attack(sol), 7);
  assert.deepEqual([fight.last, fight.second], ['spear', false]);
  fight.forced = 'spear';
  Sol.attack(sol);
  assert.deepEqual([fight.last, fight.second], ['spear', true], 'Spear 2');
  fight.forced = 'spear';
  Sol.attack(sol);
  assert.equal(fight.second, false, 'then Spear 1 again');
  fight.forced = 'shield';
  assert.equal(Sol.attack(sol), 6);
  assert.equal(fight.second, false, 'a different attack resets');
  for (let i = 0; i < 50; i++) assert.ok(['spear', 'shield'].includes(Sol.nextAttack(fight)), 'no specials in phase 1');
  run.end('left');
});

test('a phase change: his line, beams that leave sand, a crystal, and a Spear next', () => {
  const { run, fight, sol, player } = solRun();
  sol.hp = 1300;
  run.waveTicks = 1;
  Sol.tick(run);
  assert.equal(fight.phase, 1);
  assert.equal(sol.chats.at(-1), 'Not bad. Let\'s try something else...');
  assert.equal(fight.crystals.length, 1);
  assert.equal(fight.forced, 'spear');
  assert.equal(run.sand.size, 0);
  ticks(2);
  assert.equal(run.sand.size, 6, 'six pools, one on the player');
  assert.ok(run.sand.has(`${player.location.getX()},${player.location.getY()}`));
  sol.hp = 100;
  Sol.tick(run);
  assert.equal(fight.phase, 5, 'straight to enraged');
  assert.equal(fight.crystals.length, 4, 'one per phase up to four');
  run.end('left');
});

test('the triple attack: Protect from Melee too early is turned off and the blow lands', () => {
  const core = PluginManager.getCoreApi();
  const { PrayerHandler } = core;
  const original = PrayerHandler.deactivatePrayer;
  PrayerHandler.deactivatePrayer = (player, id) => { player.prayers[id] = false; };
  try {
    const { run, fight, sol, player } = solRun();
    fight.phase = 1;
    fight.forced = 'triple';
    Sol.attack(sol);
    const melee = PrayerHandler.PROTECT_FROM_MELEE;
    ticks(2);
    player.prayers[melee] = true;
    ticks(1);
    assert.equal(player.damage.length, 0, 'prayed on the tick: blocked');
    ticks(1);
    assert.equal(player.prayers[melee], false, 'still on before the next one: turned off');
    assert.ok(player.messages.includes("Sol Heredit doesn't take kindly to your eager prayer."));
    ticks(2);
    assert.deepEqual(player.damage, [25], 'the second blow lands');
    run.end('left');
  } finally {
    PrayerHandler.deactivatePrayer = original;
  }
});

test('the grapple: defending in time blocks it, on the last tick it is a perfect parry', () => {
  const { Equipment, World } = PluginManager.getCoreApi();
  const { run, fight, sol, player } = solRun();
  fight.phase = 2;
  fight.forced = 'grapple';
  Sol.attack(sol);
  const grip = fight.grapple;
  assert.ok(sol.chats.at(-1).startsWith("I'LL"));
  const unequip = { player, slot: grip.slot, allow: null };
  Sol.defend(unequip);
  assert.equal(unequip.allow, false, 'the item stays on');
  grip.clickedAt = grip.started + 4;
  ticks(4);
  assert.ok(player.messages.includes("You perfectly parry Sol Heredit's grapple!"));
  const roll = { attacker: player, target: sol, forceAccurate: false, forceMaxHit: false };
  Sol.parried(roll);
  assert.deepEqual([roll.forceAccurate, roll.forceMaxHit], [true, true]);
  const again = { attacker: player, target: sol, forceAccurate: false, forceMaxHit: false };
  Sol.parried(again);
  assert.equal(again.forceMaxHit, false, 'only the next blow');

  fight.forced = 'grapple';
  Sol.attack(sol);
  const wrong = fight.grapple.slot === Equipment.BODY_SLOT ? Equipment.LEG_SLOT : Equipment.BODY_SLOT;
  Sol.defend({ player, slot: wrong, allow: null });
  assert.ok(player.messages.includes('You defended the wrong body part!'));
  ticks(4);
  assert.equal(player.damage.length, 1);
  assert.ok(player.damage[0] >= 20 && player.damage[0] <= 45);
  assert.match(player.messages.at(-1), /^Sol Heredit grabs hold of your \w+ and deals massive damage!$/);
  assert.ok(World.getProcessCycle() >= 0);
  run.end('left');
});

// ------------------------------------------------------------------ rewards and Glory

const Rewards = require('../plugins/minigames/colosseum/Rewards.Colosseum');
const Loot = require('../plugins/minigames/colosseum/ColosseumLoot');

test('the loot tables add up to the Wiki\'s odds', () => {
  const totals = Object.fromEntries(Object.entries(Loot.TABLES).map(([wave, table]) => [wave, table.reduce((sum, row) => sum + row[2], 0)]));
  assert.deepEqual(totals, { 2: 7, 3: 70, 4: 43400, 5: 19250, 6: 16800, 7: 45920, 8: 114240, 9: 21600, 10: 16000, 11: 2080, 12: 4800 });
  const player = fakePlayer('Fanatic');
  const first = Loot.roll(4, player, () => 0.9999);
  assert.ok(Loot.FANATIC_PIECES.includes(first[0].id), 'the last row: a fanatic piece');
  Loot.received(player, first);
  const second = Loot.roll(4, player, () => 0.9999);
  assert.notEqual(second[0].id, first[0].id, 'no duplicate before the set is done');
  assert.deepEqual(Loot.roll(12, player, () => 0).at(-1), { id: Loot.DIZANAS_QUIVER, amount: 1 });
});

test('a cleared wave banks its loot and earns Glory; dying loses the loot but keeps the Glory', () => {
  const { player, run } = runWith({ blasphemy: 1 }, 'Glorious');
  run.waveTicks = 50;
  run.wave = 0;
  run.completeWave();
  assert.deepEqual(run.loot.rewards, [{ id: 28924, amount: 80 }]);
  assert.deepEqual(run.loot.previous, [{ id: 28924, amount: 80 }]);
  assert.equal(run.loot.future.length, 1, 'wave 2 is rolled');
  assert.equal(run.glory, 100 + 100 + 100 + 450, 'completion, no damage, Blasphemy, 50 ticks');
  assert.equal(player.varbits.get('varp4132'), run.glory);
  run.stage = 'wave';
  run.hitByEnemy = true;
  run.waveTicks = 100;
  run.completeWave();
  assert.equal(run.glory, 750 + 200 + 100 + 800, 'no no-damage bonus when hit');
  run.end('death');
  assert.equal(Shared.gloryOf(player), 1850);
  assert.deepEqual(player.inventories[844], [], 'the preview is emptied');
});

test('forfeiting between waves brings out the chest; teleporting out loses it all', () => {
  const { player, run } = runWith({}, 'Forfeit');
  run.completeWave();
  run.finish();
  assert.equal(run.stage, 'finished');
  assert.equal(Rewards.openChest({ player }), true);
  assert.ok(player.interfaces.includes(246));
  assert.deepEqual(player.inventories[843], [[28924, 80]]);
  assert.equal(player.texts[(246 << 16) | 3], `Total Value: ${Rewards.valueOf(run.loot.rewards).toLocaleString('en-US')}`);
  run.end('left');

  const away = runWith({}, 'Teleporter');
  away.run.completeWave();
  const before = away.player.location;
  away.run.end('teleported', { fromArea: true });
  ticks(3);
  assert.equal(away.player.location, before, 'not pulled back to the lobby');
  assert.equal(Shared.gloryOf(away.player), 0, 'no Glory for a teleport');
});

test("a warbander whose tile is under a pillar takes a free side tile, never the player's", () => {
  const I = Waves.ids();
  const player = fakePlayer('Pillar');
  player.location = new Location(1817, 3112, 0); // the NW pillar fills (1816-1818, 3113-3115)
  const run = { player, area: null };
  const berserker = fakeNpc(I.berserker, 1820, 3108);
  const seer = fakeNpc(I.seer, 1821, 3108);
  const archer = fakeNpc(I.archer, 1819, 3108);
  const trio = [berserker, seer, archer];
  assert.deepEqual(Enemies.warbandTile(run, berserker, trio), { x: 1817, y: 3111 }, 'north is pillar: the unclaimed south');
  assert.deepEqual(Enemies.warbandTile(run, seer, trio), { x: 1818, y: 3112 }, 'its own east tile');
  const quartet = fakeNpc(I.berserker, 1820, 3107);
  quartet.__colosseumOffset = Waves.TRIO_OFFSETS.quartet;
  assert.equal(Enemies.warbandTile(run, berserker, [...trio, quartet]), null, 'every side claimed: it holds still');
});

test("the Manticore's charged orbs show on it in throwing order, each in its own slot, until thrown", () => {
  const { ManticoreMethod } = Enemies.build();
  const method = new ManticoreMethod();
  const npc = fakeNpc(Waves.ids().manticore, 1820, 3110);
  const player = fakePlayer('Flicker');
  method.start(npc, player);
  ticks(3);
  const ids = [...npc.slots.entries()].sort(([a], [b]) => a - b).map(([, id]) => id);
  assert.equal(ids.length, 3, 'three orbs at once, slots 1-3');
  assert.equal(ids[2], 2685, 'melee last');
  assert.deepEqual([...ids.slice(0, 2)].sort(), [2681, 2683], 'magic and ranged first');
  npc.slots.clear();
  ticks(2);
  assert.equal(npc.slots.size, 3, 'held orbs are shown again before their spin ends');
  player.skills.setCurrentLevel(PluginManager.getCoreApi().Skill.HITPOINTS, 0); // no throw, just the orbs leaving
  ticks(4);
  assert.equal(npc.slots.size, 0, 'each slot cleared as its orb goes');
});

test("reinforcements follow the Wiki's waves, and Sol Heredit's wave has none", () => {
  const I = Waves.ids();
  const none = new Modifiers.ModifierSet();
  assert.deepEqual(Waves.reinforcements(4, none), [I.jaguar, I.shaman]);
  assert.deepEqual(Waves.reinforcements(8, none), [I.minotaur]);
  assert.deepEqual(Waves.reinforcements(11, none), [I.shaman, I.minotaur]);
  assert.deepEqual(Waves.reinforcements(12, none), []);
});
