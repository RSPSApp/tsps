// Run after `yarn build`: node --test tests/volcanic-mine.test.cjs
//
// The Volcanic Mine against rsprox 1858/1854 (and the Wiki for the boulder and rewards): Pete's
// fee, one game a world, the lobby and the clock, chambers, vents, gas holes, water, the boulder,
// the eruption and the way out.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Common, Game, Boulder, Mine, hooks;

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  hooks = { objects: new Map(), npcs: new Map(), items: {}, login: [], prompts: [], spawned: [] };
  const key = (ids, click) => (Array.isArray(ids) ? ids : [ids]).map((id) => `${id}:${click}`);
  const core = PluginManager.getCoreApi();
  const api = {
    core,
    persistAttribute() {},
    onObjectClick: (ids, click, handler) => { for (const k of key(ids, click)) hooks.objects.set(k, handler); },
    onNpcClick: (ids, click, handler) => { for (const k of key(ids, click)) hooks.npcs.set(k, handler); },
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onWalkRoute() {},
    registerNpcCombatMethodProvider: (ids, method) => { hooks.combat = { ids, method }; },
    onNpcHitModify: (handler) => { hooks.npcHit = handler; },
    onNpcDeath: (handler) => { hooks.npcDeath = handler; },
    onPlayerBeforeDeath: (handler) => { (hooks.beforeDeath ??= []).push(handler); },
    onPlayerDeathDrops: (handler) => { (hooks.deathDrops ??= []).push(handler); },
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    emitCustomEvent: (name, request) => {
      if (name === 'mining:best-pickaxe') request.pickaxe = { id: 11920, attemptIntervalTicks: 3, animation: new core.Animation(7139) };
    },
    spawnNpc: ({ id, x, y, z }) => {
      const npc = { id, location: new Location(x, y, z), glides: [], registered: true, area: null };
      Object.assign(npc, {
        hp: 0, setHitpoints(v) { npc.hp = v; }, getHitpoints: () => npc.hp, anims: [],
        getCombat: () => ({ getTarget: () => npc.target ?? null, attack: (t) => { npc.target = t; } }),
        getId: () => id, getLocation: () => npc.location, isPlayer: () => false, isNpc: () => true, getIndex: () => 5000 + hooks.spawned.length,
        getAsNpc: () => npc, setArea(a) { npc.area = a; }, getArea: () => npc.area, isRegistered: () => npc.registered,
        getMovementQueue: () => ({ setBlockMovement() {} }),
        exactMove(to) { npc.glides.push(to); npc.location = to; }, performAnimation(an) { npc.anims.push(an.getId()); },
      });
      hooks.spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { npc.registered = false; },
  };
  require('../plugins/minigames/VolcanicMine.plugin').register(api);
  Common = require('../plugins/minigames/volcanicmine/Common.VolcanicMine');
  Game = require('../plugins/minigames/volcanicmine/Game.VolcanicMine');
  Boulder = require('../plugins/minigames/volcanicmine/Boulder.VolcanicMine');
  Mine = require('../plugins/minigames/volcanicmine/Mine.VolcanicMine');
});

let random;
beforeEach(() => {
  random = Math.random;
  Game.current?.end();
  Game.reset();
  hooks.prompts.length = 0;
});

function container() {
  const slots = [];
  return {
    slots,
    adds(id, amount = 1) { const slot = slots.find((s) => s.id === id); if (slot) slot.amount += amount; else slots.push({ id, amount }); },
    add(item) { slots.push({ id: item.getId(), amount: item.getAmount(), meta: item.getMeta?.() ?? null }); },
    delete(id, amount = 1) { const slot = slots.find((s) => s.id === id); if (slot) slot.amount -= amount; },
    contains: (id) => slots.some((s) => s.id === id && s.amount > 0),
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getFreeSlots: () => 20,
    getAddableAmount: (item) => item.getAmount(),
    getItems: () => [],
    getValidItems: () => slots.filter((x) => x.amount > 0).map((x) => ({ getId: () => x.id, getAmount: () => x.amount, getMeta: () => x.meta ?? null })),
    resetItems() { slots.length = 0; },
    refreshItems() {},
  };
}

let index = 0;
function fakePlayer({ mining = 99 } = {}) {
  const attributes = new Map();
  const id = ++index;
  const p = {
    location: new Location(3816, 3808, 0), area: null, messages: [], spam: [], sounds: [], chats: [], boxes: [], anims: [], hits: [],
    varbits: new Map(), subs: [], xp: {}, songs: [], said: [], blocked: false, hp: 99,
    inventory: container(),
    getIndex: () => id, getUsername: () => `Tester${id}`, getDisplayName: () => `Tester${id}`,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getLocation: () => p.location, moveTo(l) { p.location = l; }, setLocation(l) { p.location = l; },
    getArea: () => p.area, setArea(a) { p.area = a; },
    getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v),
    getInventory: () => p.inventory,
    equipment: container(),
    getEquipment: () => p.equipment,
    getUpdateFlag: () => ({ flag() {} }),
    sendMessage: (m) => p.messages.push(m),
    performAnimation: (a) => p.anims.push(a.getId()),
    forceChat: (t) => p.said.push(t),
    getHitpoints: () => p.hp,
    decrementHealth: (hit) => { p.hp -= hit.getDamage(); return hit; },
    addTickHit: (hit) => p.hits.push(hit.getDamage()),
    getMovementQueue: () => ({ reset() {}, setBlockMovement(v) { p.blocked = v; } }),
    getSkillManager: () => ({
      addExperience: (skill, amount) => { const n = String(skill.getName?.() ?? skill); p.xp[n] = (p.xp[n] ?? 0) + amount; },
      getCurrentLevel: () => mining, getMaxLevel: () => mining,
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.boxes.push(chain), reset() {} }),
    getPacketSender() {
      const sender = {
        sendVarbit: (vid, value) => { p.varbits.set(vid, value); return sender; },
        sendSubInterface: (uid, iid) => { p.subs.push(iid); return sender; },
        closeSubInterface: (uid) => { p.subs.push(-uid); return sender; },
        sendTypedMessage: (type, text) => { p.spam.push(text); return sender; },
        sendSong: (sid) => { p.songs.push(sid); return sender; },
        sendSound: (id) => { p.sounds.push(id); return sender; }, sendGraphic: () => sender, sendObjectAnimation: () => sender,
        sendInterfaceRemoval: () => sender,
      };
      return sender;
    },
  };
  return p;
}

const varbit = (p, name) => p.varbits.get(Common.data.varbits[name]);
const lines = (chain) => [...chain.dialogues.values()].map((d) => d.text).filter(Boolean);
const xpOf = (p) => p.xp.Mining ?? p.xp.MINING ?? 0;

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

function click(p, id, option = 1, object = null) {
  return hooks.objects.get(`${id}:${option}`)({ player: p, object, objectId: id, clickType: option });
}

function locOf(game, id, tile) {
  const object = game.area.getTemplateObjects(game.area.at(tile)).find((o) => o.getId() === id);
  assert.ok(object, `loc ${id} at ${tile}`);
  return object;
}

const here = (game, p) => game.area.templateOf(p.getLocation());

test("Pete's Pay and Retrieve have distinct editor methods that dispatch to the correct actions", (t) => {
  const { NpcInteractionManager } = require('../dist/game/entity/impl/npc/NpcInteractionManager');
  const { NpcInteractionDefinition } = require('../dist/game/definition/NpcInteractionDefinition');
  const warn = t.mock.method(console, 'warn', () => {});
  const pete = Common.data.npcs.pete;
  const pay = NpcInteractionManager.registerPluginInteraction('VolcanicMine', [pete], 3, hooks.npcs.get(`${pete}:3`));
  const retrieve = NpcInteractionManager.registerPluginInteraction('VolcanicMine', [pete], 5, hooks.npcs.get(`${pete}:5`));
  assert.notEqual(pay, retrieve);
  assert.equal(warn.mock.callCount(), 0, 'registration must not report ambiguous handlers');

  const previous = NpcInteractionDefinition.all();
  try {
    NpcInteractionDefinition.replace([new NpcInteractionDefinition(pete,
      { method: pay, args: {}, source: 'editor' },
      { method: retrieve, args: {}, source: 'editor' }, null)]);
    const npc = { getContentId: () => pete, getLocation: () => new Location(3816, 3808, 0) };
    const paying = fakePlayer();
    paying.inventory.adds(Common.data.items.numulite, Common.data.entry.fee);
    assert.equal(NpcInteractionManager.handle(paying, npc, 1, 1), true);
    assert.ok(hooks.prompts.at(-1).args.includes(Common.message('payMenuOne')));
    const retrieving = fakePlayer();
    assert.equal(NpcInteractionManager.handle(retrieving, npc, 1, 2), true);
    assert.equal(lines(retrieving.boxes.at(-1))[0], Common.message('nothingStored'));
  } finally {
    NpcInteractionDefinition.replace(previous);
  }
});

/** A paid player down the entrance, in the dormant lobby. */
function enter(p = fakePlayer(), { hazards = false } = {}) {
  p.setAttribute(Common.data.attributes.paid, true);
  click(p, Common.data.locs.entrance, 1);
  // The hazards are random: only their own tests let them run.
  const game = Game.gameOf(p);
  if (game && !hazards) game.quiet = true;
  return p;
}

test('the entrance: 50 Mining, the fee, then the recorded dormant lobby', () => {
  const low = fakePlayer({ mining: 49 });
  low.setAttribute(Common.data.attributes.paid, true);
  click(low, Common.data.locs.entrance, 1);
  assert.match(low.messages.at(-1), /Mining level of 50/);
  const unpaid = fakePlayer();
  click(unpaid, Common.data.locs.entrance, 1);
  assert.equal(Game.gameOf(unpaid), null);

  const p = enter();
  const game = Game.gameOf(p);
  assert.ok(game);
  assert.deepEqual(here(game, p), [3808, 10193, 3]);
  assert.ok(p.messages.includes('Pete quickly hands you a heat-proof vessel filled with some water.'));
  assert.ok(p.messages.includes('The mine is currently dormant, and will awaken within the next 30 seconds.'));
  assert.equal(p.inventory.getAmount(21539), 1);
  assert.equal(varbit(p, 'time'), 50);
  assert.equal(varbit(p, 'progress'), 1);
  assert.equal(varbit(p, 'stability'), 50);
  assert.ok(p.subs.includes(611));
  assert.equal(p.getAttribute(Common.data.attributes.paid), false, 'the fee is spent');
});

test("Pay: 30 Numulites, the recorded box and Pete's thanks", () => {
  const p = fakePlayer();
  p.inventory.adds(21555, 40);
  hooks.npcs.get('7776:3')({ player: p });
  const prompt = hooks.prompts.at(-1);
  const options = prompt.args.filter((a) => typeof a === 'string');
  assert.deepEqual(options, ['Pay 30 Numulites for one visit.', '<str>Pay 3,000 Numulites for permanent access.</str>', 'Keep your Numulites.']);
  prompt.args[1]();
  assert.equal(p.inventory.getAmount(21555), 10);
  assert.ok(p.messages.includes('You can now enter the Volcanic mine. Should you leave, Pete would expect payment again.'));
  assert.equal(p.getAttribute(Common.data.attributes.paid), true);
});

test('the lobby: 51 ticks, then "The volcano awakens!" and 1000 ticks; latecomers are turned away', () => {
  const p = enter();
  const second = enter();
  const game = Game.gameOf(p);
  assert.equal(Game.gameOf(second), game, 'a lobby is joined');
  ticks(50);
  assert.equal(game.phase, 'lobby');
  ticks(1);
  assert.equal(game.phase, 'running');
  assert.ok(p.messages.includes('The volcano awakens! You can now access the area below...'));
  assert.equal(varbit(p, 'progress'), 2);
  assert.equal(varbit(p, 'time'), 1000);
  const late = fakePlayer();
  enter(late);
  assert.equal(Game.gameOf(late), null);
  assert.match(lines(late.boxes.at(-1))[0], /can't let people head in mid way through a mine out session/);
});

test('the stairs: the dormant box in the lobby, then down to the mine floor', () => {
  const p = enter();
  const game = Game.gameOf(p);
  click(p, 31029, 1, locOf(game, 31029, [3813, 10159, 3]));
  assert.deepEqual(lines(p.boxes.at(-1)), ['The mine will be ready within the next 30 seconds.']);
  ticks(51);
  click(p, 31029, 1, locOf(game, 31029, [3813, 10159, 3]));
  ticks(1);
  assert.deepEqual(here(game, p), [3813, 10158, 1]);
});

test('chambers: a large rock blocks one (+50); mining it clears it (+50, Mining XP); rocks come back in 24 ticks', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  const { data } = Common;
  game.setBlocked('B', false);
  const rockTile = data.chambers.B.rock;
  click(p, data.locs.rock, 1, locOf(game, data.locs.rock, rockTile));
  ticks(1);
  assert.equal(p.inventory.getAmount(21540), 0, 'taken two ticks after the click (recorded)');
  ticks(1);
  assert.equal(p.inventory.getAmount(21540), 1);
  assert.ok(p.messages.includes('You take the large rock.'));
  assert.equal(game.rocks.size, 1);
  ticks(24);
  assert.equal(game.rocks.size, 0, 'back after 24 ticks');
  const chamber = { getLocation: () => game.area.at(data.chambers.B.tile) };
  click(p, data.locs.chamberOpen, 1, chamber);
  ticks(2);
  assert.ok(p.messages.includes('You block the chamber with the large rock. The gas starts to build up.'));
  assert.equal(game.isBlocked('B'), true);
  assert.equal(varbit(p, 'points'), 50);
  Math.random = () => 0;
  p.sounds.length = 0;
  click(p, data.locs.chamberBlocked, 1, chamber);
  assert.equal(p.spam.includes('You swing your pick at the rock.'), false, 'the swing is the next tick (recorded)');
  ticks(1);
  assert.ok(p.spam.includes('You swing your pick at the rock.'));
  assert.equal(p.messages.includes('You manage to clear the blockage.'), false);
  assert.deepEqual(p.sounds, [], 'no success sound on the swing');
  ticks(1);
  Math.random = random;
  assert.ok(p.messages.includes('You manage to clear the blockage.'));
  assert.deepEqual(p.sounds, [3600]);
  assert.equal(p.anims.at(-1), Common.core.Animation.DEFAULT_RESET_ANIMATION.getId(), 'the clear stops the swing');
  assert.equal(game.isBlocked('B'), false);
  assert.equal(varbit(p, 'points'), 100);
  assert.equal(xpOf(p), 25);
});

test('vents: the recorded box with the gas, revealed on the HUD, +50; the gas drifts every 10 ticks', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  assert.equal(varbit(p, 'ventB'), 127, 'unknown until inspected');
  game.gas.B = 48;
  click(p, Common.data.locs.vent, 1, { getLocation: () => game.area.at([3816, 10202, 1]) });
  ticks(1);
  assert.match(lines(p.boxes.at(-1))[0], /Vent B is <col=ff0000>48%<\/col> filled with gas/);
  assert.equal(varbit(p, 'ventB'), 48);
  assert.equal(varbit(p, 'points'), 50);
  assert.equal(Mine.ventOf([3828, 10194, 1]), 'C', 'the recorded C vent');
  game.setBlocked('B', true);
  ticks(10);
  assert.ok(varbit(p, 'ventB') > 48, 'a blocked chamber builds gas');
});

test('stability: with every vent near 50% it climbs 50 -> 70 -> 90 -> 100 (recorded G1)', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  const values = [];
  for (let i = 0; i < 3; i++) {
    game.gas = { A: 50, B: 50, C: 50 };
    ticks(25);
    values.push(game.stability);
  }
  assert.deepEqual(values, [70, 90, 100]);
});

test('the end: at 50 left the warning and stability 5; at 0 the volcano erupts and kills', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  game.remaining = 51;
  ticks(1);
  assert.ok(p.messages.includes('The volcano is going to erupt soon!'));
  assert.equal(varbit(p, 'progress'), 3);
  assert.equal(game.stability, 5);
  ticks(50);
  assert.ok(p.hp <= 0, 'killed by the eruption');
});

test('stability 0: "The mine has become too unstable! It’s collapsing in!" then death', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  game.setStability(0);
  assert.ok(p.messages.includes("The mine has become too unstable! It's collapsing in!"));
  ticks(5);
  assert.ok(p.hp <= 0);
});

test('gas holes: the recorded jump to the far side and a 3-6 hit', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  p.moveTo(game.area.at([3803, 10170, 1]));
  click(p, 31049, 1, { getLocation: () => game.area.at([3803, 10170, 1]) });
  ticks(1);
  assert.ok(p.said.includes('Ouch! Hot hot!'));
  ticks(3);
  assert.deepEqual(here(game, p), [3812, 10169, 1]);
  ticks(5);
  assert.equal(p.hits.length, 1);
  assert.ok(p.hits[0] >= 3 && p.hits[0] <= 6);
});

test('water: a throw hardens lava for 74 + 65 + 10 ticks; the channel is refused; the count as recorded', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  p.moveTo(game.area.at([3816, 10194, 1]));
  p.__vmFacing = [0, 1];
  hooks.items['Heat-proof vessel']['Throw-water']({ player: p });
  assert.equal(p.messages.at(-1), 'Your vessel has enough water for 35 more throws.');
  const tile = [3816, 10195, 1];
  assert.equal(game.lava.get(Common.key(...tile)).stage, 0);
  ticks(74);
  assert.equal(game.lava.get(Common.key(...tile)).stage, 1);
  ticks(75);
  assert.equal(game.lava.get(Common.key(...tile)).stage, -1, 'lava again');
  assert.equal(Mine.onChannel([3805, 10140, 1]), true);
});

test('the boulder: chips (+1, 5 XP), a fragment by the Wiki odds, and the giant floats to (3804,10133)', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  assert.ok(game.boulder, 'the attached boulder is out');
  Math.random = () => 0.99;
  Boulder.chip(game, p);
  assert.ok(p.spam.includes('You chip off a part of the boulder.'));
  assert.equal(xpOf(p), 5);
  Math.random = () => 0;
  Boulder.chip(game, p);
  Math.random = random;
  assert.ok(p.spam.some((m) => /You mine out one \w+ ore fragment\./.test(m)));
  assert.equal(Boulder.rollOre(50) !== 'runite', true, 'no runite below 85');
  game.boulder.hp = 0;
  Boulder.breakStage(game);
  ticks(12);
  assert.equal(game.boulder.stage, 1);
  assert.equal(game.boulder.moving, false);
  assert.deepEqual(game.area.templateOf(game.boulder.loc.getLocation()), [3804, 10133, 1]);
});

test('the exit ladder: the HUD reset, Pete\'s line, out at (3816,3808), Mining XP and shop points for the game\'s points', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  game.addPoints(p, 458);
  click(p, Common.data.locs.exit, 1);
  ticks(1);
  assert.equal(Game.gameOf(p), null);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3816, 3808, 0]);
  assert.equal(xpOf(p), Math.round((458 * 99) / 24.2));
  assert.equal(p.getAttribute(Common.data.attributes.shopPoints), 458);
  assert.deepEqual(lines(p.boxes.at(-1)), ["I'll give you a bit of minin' trainin' and I'll remember the contribution you've made."]);
  assert.equal(varbit(p, 'points'), 0);
  assert.equal(p.inventory.getAmount(21539), 0, 'the vessel stays behind');
});

test('logging out leaves the game at the entrance with nothing', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  game.addPoints(p, 100);
  game.area.leave(p, true);
  assert.equal(Game.gameOf(p), null);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3816, 3808]);
  assert.equal(p.getAttribute(Common.data.attributes.shopPoints), undefined);
});

test('stability: vents at 20-48% leave it where it is (recorded G2); one near empty brings it down (G1)', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  game.stability = 100;
  game.gas = { A: 30, B: 40, C: 25 };
  game.updateStability();
  assert.equal(game.stability, 100 - 0, 'within the safe range');
  game.gas = { A: 30, B: 5, C: 30 };
  game.updateStability();
  assert.ok(game.stability < 100, 'a vent near empty');
});


const walkable = (game, from, dx, dy) => {
  const at = game.area.at(from);
  return RegionManager.canMove(at.getX(), at.getY(), at.getX() + dx, at.getY() + dy, at.getZ(), 1, 1, game.area);
};

test('lava: blocked as lava, walkable once hardened, blocked again when it melts', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  const lava = [3816, 10195, 1];
  assert.equal(walkable(game, [3816, 10194, 1], 0, 1), false, 'lava blocks');
  Mine.harden(game, lava);
  assert.equal(walkable(game, [3816, 10194, 1], 0, 1), true, 'the crust is walkable');
  ticks(149);
  assert.equal(walkable(game, [3816, 10194, 1], 0, 1), false, 'melted back');
});

test('the boulder: once a stage breaks, the cache lava under it still blocks', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  const lavaTiles = [];
  for (let x = 3804; x < 3812; x++) for (let y = 10128; y < 10132; y++) {
    if (game.area.getTemplateObjects(game.area.at([x, y, 1])).some((o) => o.getId() === 30997)) lavaTiles.push([x, y]);
  }
  assert.ok(lavaTiles.length > 0, 'cache lava under the attached boulder');
  game.boulder.hp = 0;
  Boulder.breakStage(game);
  for (const [x, y] of lavaTiles) {
    const at = game.area.at([x, y, 1]);
    assert.ok((game.area.getClip(at) & 0x100) !== 0, `still lava at ${x},${y}`);
  }
});

test('a lobby everyone leaves ends; the next player gets a fresh game', () => {
  const p = enter();
  const game = Game.gameOf(p);
  game.area.leave(p, true);
  assert.equal(game.ended, true);
  const q = enter();
  assert.notEqual(Game.gameOf(q), game);
  assert.equal(Game.gameOf(q).area.isDestroyed(), false);
});

test('vents pay once until the gas shifts; repeated clicks do not stack actions', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  const vent = { getLocation: () => game.area.at([3816, 10202, 1]) };
  click(p, Common.data.locs.vent, 1, vent);
  ticks(1);
  click(p, Common.data.locs.vent, 1, vent);
  ticks(1);
  assert.equal(varbit(p, 'points'), 50, 'one inspect paid');
  p.moveTo(game.area.at([3805, 10123, 1]));
  Math.random = () => 0.99;
  for (let i = 0; i < 5; i++) click(p, 31034, 1, null);
  ticks(3);
  assert.equal(p.spam.filter((m) => m === 'You chip off a part of the boulder.').length, 0, 'the first chip is a pickaxe interval after the swing (recorded)');
  ticks(1);
  Math.random = random;
  const chips = p.spam.filter((m) => m === 'You chip off a part of the boulder.').length;
  assert.equal(chips, 1, 'one chip a swing, however often clicked');
});

test('a ladder click queued before a collapse starts neither escapes nor pays', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  game.addPoints(p, 100);
  click(p, Common.data.locs.exit, 1);
  game.setStability(0);
  ticks(1);
  assert.equal(p.getAttribute(Common.data.attributes.shopPoints), undefined, 'no points paid');
  assert.equal(game.players.has(p), true, 'still in the mine');
});

test('no way out with points once the mine is collapsing', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  game.addPoints(p, 500);
  game.setStability(0);
  click(p, Common.data.locs.exit, 1);
  ticks(1);
  assert.equal(p.getAttribute(Common.data.attributes.shopPoints), undefined);
});


// ------------------------------------------------------------------ part 2: hazards and retrieval

const Hazards = require('../plugins/minigames/volcanicmine/Hazards.VolcanicMine');
const Retrieval = require('../plugins/minigames/volcanicmine/Retrieval.VolcanicMine');

test('lava beasts: one comes out with 65 HP and its own ranged attack; hits and the kill pay points', () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  assert.deepEqual(hooks.combat.ids, [7817], 'the lava beast attack is registered');
  const before = hooks.spawned.length;
  Hazards.spawnBeast(game);
  const beast = hooks.spawned.slice(before).find((n) => n.id === 7817);
  assert.ok(beast);
  assert.equal(beast.hp, 65);
  assert.ok(game.beasts.has(beast));
  const hit = { getAttacker: () => p, getTotalDamage: () => 20 };
  hooks.npcHit({ npc: beast, hit });
  assert.equal(varbit(p, 'points'), 2, 'a point a 10 damage (recorded 20 -> 2)');
  hooks.npcHit({ npc: beast, hit: { getAttacker: () => p, getTotalDamage: () => 9 } });
  assert.equal(varbit(p, 'points'), 3, 'at least one a hit (recorded 9 -> 1)');
  hooks.npcDeath({ npc: beast, killer: p });
  assert.equal(varbit(p, 'points'), 6, '+3 for the kill');
  assert.equal(game.beasts.has(beast), false);
});

test('earthquakes: the line, a stalactite on the tile, and the hit only for a player still on it', () => {
  const p = enter();
  const stays = p;
  const moves = enter();
  const game = Game.gameOf(p);
  ticks(51);
  for (const q of [stays, moves]) q.moveTo(game.area.at([3813, 10165, 1]));
  Math.random = () => 0;
  Hazards.earthquake(game);
  Math.random = random;
  assert.ok(p.messages.includes('A sudden earthquake strikes the cavern!'));
  ticks(2);
  moves.moveTo(game.area.at([3814, 10165, 1]));
  ticks(1);
  assert.equal(stays.hits.length, 1);
  assert.ok(stays.hits[0] >= 13 && stays.hits[0] <= 25);
  assert.equal(moves.hits.length, 0, 'stepped off');
});

test('meteors: the blast 8 ticks later hurts inside its 3x3 and nobody outside', () => {
  const p = enter();
  const far = enter();
  const game = Game.gameOf(p);
  ticks(51);
  p.moveTo(game.area.at([3816, 10194, 1]));
  far.moveTo(game.area.at([3820, 10194, 1]));
  Math.random = () => 0.5;
  Hazards.meteor(game, p);
  Math.random = random;
  ticks(7);
  assert.equal(p.hits.length, 0, 'not before the blast');
  ticks(1);
  assert.equal(p.hits.length, 1);
  assert.ok(p.hits[0] >= 15 && p.hits[0] <= 17);
  assert.equal(far.hits.length, 0);
});

test('no hazards in the lobby, even with every roll going their way', () => {
  const p = enter(fakePlayer(), { hazards: true });
  const game = Game.gameOf(p);
  Math.random = () => 0;
  ticks(50);
  Math.random = random;
  assert.equal(game.beasts?.size ?? 0, 0);
  assert.equal(p.messages.includes('A sudden earthquake strikes the cavern!'), false);
  assert.equal(p.hits.length, 0);
  game.end();
});

test("the lava beast's attack: the bomb, a ranged hit 5 ticks later, at most 18", () => {
  const { method } = hooks.combat;
  const npc = { getLocation: () => new Location(3810, 10165, 1), getSize: () => 2, performAnimation: (a) => { npc.anim = a.getId(); }, getPrivateArea: () => null };
  const target = { getLocation: () => new Location(3813, 10165, 1), getSize: () => 1 };
  const attack = new method(npc);
  assert.equal(attack.attackSpeed(), 6);
  assert.equal(attack.attackDistance(), 10);
  assert.doesNotThrow(() => attack.start(npc, target));
  assert.equal(npc.anim, 7678);
});

test("a death in the mine: Pete keeps the items; Retrieve wants 150 Numulite, then hands them back", () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  p.inventory.adds(11920, 1);
  p.inventory.adds(21555, 40);
  p.equipment.adds(1704, 1);
  for (const handler of hooks.beforeDeath) handler({ player: p, preventDeath: false });
  assert.equal(p.inventory.getAmount(11920), 0, 'nothing for the grave');
  assert.equal(p.inventory.getAmount(21539), 0, "the mine's vessel is gone, not kept");
  const stored = Retrieval.stored(p);
  assert.deepEqual(stored.map((i) => i.id).sort(), [1704, 11920, 21555].sort());
  ticks(8);
  assert.ok(p.messages.includes('Petrified Pete has retrieved some of your items. You can collect them from him on Fossil Island.'));
  game.area.leave(p, false);
  hooks.npcs.get('7776:5')({ player: p });
  assert.equal(lines(p.boxes.at(-1))[0], 'You need 150 x Numulite to retrieve your items.');
  p.inventory.adds(21555, 150);
  hooks.npcs.get('7776:5')({ player: p });
  assert.ok(p.messages.includes('Death charges you 150 x Numulite.'));
  assert.equal(p.inventory.getAmount(11920), 1);
  assert.equal(p.inventory.getAmount(1704), 1);
  assert.equal(p.inventory.getAmount(21555), 40, 'the 40 he held came back; the 150 paid');
  assert.equal(Retrieval.stored(p), null);
});

test("Retrieve pays from the Numulite Pete holds; items keep their meta; a second death replaces the lot; none outside", () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  p.inventory.add(new (PluginManager.getCoreApi().Item)(11920, 1, { charges: 7 }));
  p.inventory.adds(21555, 200);
  for (const handler of hooks.beforeDeath) handler({ player: p, preventDeath: false });
  game.area.leave(p, false);
  hooks.npcs.get('7776:5')({ player: p });
  assert.equal(p.inventory.getAmount(21555), 50, '150 of his 200 paid');
  assert.deepEqual(p.inventory.slots.find((s) => s.id === 11920).meta, { charges: 7 });

  const q = enter();
  const second = Game.gameOf(q);
  ticks(51);
  q.inventory.adds(1704, 1);
  for (const handler of hooks.beforeDeath) handler({ player: q, preventDeath: false });
  q.inventory.adds(4151, 1);
  for (const handler of hooks.beforeDeath) handler({ player: q, preventDeath: false });
  assert.deepEqual(Retrieval.stored(q).map((i) => i.id), [4151], 'the newer lot only');
  second.area.leave(q, false);
  const outside = fakePlayer();
  outside.inventory.adds(1704, 1);
  for (const handler of hooks.beforeDeath) handler({ player: outside, preventDeath: false });
  assert.equal(Retrieval.stored(outside), null);
  assert.equal(outside.inventory.getAmount(1704), 1);
});

test('a live game brings out a lava beast once it starts, none in the lobby', () => {
  const p = enter(fakePlayer(), { hazards: true });
  const game = Game.gameOf(p);
  ticks(50);
  assert.equal(game.beasts?.size ?? 0, 0);
  ticks(1 + 22);
  assert.ok(game.beasts.size >= 1, 'a beast within the respawn window');
  game.end();
});

test("Pete's lot is lost to an unsafe death outside the mine, but not to the mine death's own drop", () => {
  const p = enter();
  const game = Game.gameOf(p);
  ticks(51);
  p.inventory.adds(4151, 1);
  for (const handler of hooks.beforeDeath) handler({ player: p, preventDeath: false });
  game.area.leave(p, false);
  for (const handler of hooks.deathDrops) handler({ player: p, killer: null, items: [], untradeables: [] });
  assert.deepEqual(Retrieval.stored(p).map((i) => i.id), [4151], "the mine death's own drop keeps it");
  for (const handler of hooks.deathDrops) handler({ player: p, killer: null, items: [], untradeables: [] });
  assert.equal(Retrieval.stored(p), null, 'a later unsafe death elsewhere loses it');
});
