// Run after `yarn build`: node --test tests/forestry.test.cjs
//
// Forestry against the rsprox recordings (and the Wiki for spawns and rewards): when an event
// spawns and who it rewards, the Struggling Sapling and Rising Roots.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Common, Spawns, Sapling, Roots, Woodcutting, hooks, core;
const chopping = new Set();
const stopped = [];

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  core = PluginManager.getCoreApi();
  hooks = { objects: new Map(), events: new Map() };
  const api = {
    core,
    persistAttribute() {},
    onNpcInteraction() {},
    onNpcDialogueVariant() {},
    onNpcDialogueCondition() {},
    onItemOnNpc() {},
    onObjectInteraction: (name, actions) => { if (typeof name !== 'function') for (const [op, fn] of Object.entries(actions)) hooks.objects.set(`${name}:${op}`, fn); },
    onCustomEvent: (name, fn) => { (hooks.events.get(name) ?? hooks.events.set(name, []).get(name)).push(fn); },
    onPlayerLogout() {},
    onPlayerLogin: (fn) => {
      (hooks.logins ??= []).push(fn);
      hooks.login = (event) => hooks.logins.forEach((handler) => handler(event));
    },
    emitCustomEvent() {},
  };
  Woodcutting = require('../plugins/skills/Woodcutting.plugin');
  Woodcutting.isWoodcuttingActive = (player) => chopping.has(player);
  Woodcutting.stopWoodcutting = (player) => { chopping.delete(player); stopped.push(player); };
  Woodcutting.findBestUsableAxe = () => ({ id: 1359, tier: 5, animationId: 867 });
  require('../plugins/minigames/Forestry.plugin').register(api);
  Common = require('../plugins/minigames/forestry/Common.Forestry');
  Spawns = require('../plugins/minigames/forestry/Spawns.Forestry');
  Sapling = require('../plugins/minigames/forestry/Sapling.Forestry');
  Roots = require('../plugins/minigames/forestry/Roots.Forestry');
});

let random;
beforeEach(() => {
  random = Math.random;
  for (const event of [...Sapling.saplings]) Sapling.finish(event, false);
  for (const event of [...Spawns.active]) Spawns.active.delete(event);
  Spawns.choppers.clear();
  Spawns.heldTrees.clear();
  Spawns.readyAt.clear();
  Spawns.quiet.length = 0;
  chopping.clear();
  stopped.length = 0;
  ticks(20);
});

function container() {
  const slots = [];
  return {
    slots,
    add(item) { const slot = slots.find((s) => s.id === item.getId()); if (slot && item.getId() === 28134) slot.amount += item.getAmount(); else slots.push({ id: item.getId(), amount: item.getAmount() }); },
    adds(id, amount = 1) { this.add(new core.Item(id, amount)); },
    delete(id, amount = 1) { const slot = slots.find((s) => s.id === id && s.amount > 0); if (slot) slot.amount -= amount; },
    contains: (id) => slots.some((s) => s.id === id && s.amount > 0),
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getFreeSlots: () => 20,
    getAddableAmount: (item) => item.getAmount(),
    full() {},
  };
}

let index = 0;
function fakePlayer({ at = new Location(3085, 3233, 0), level = 70, kit = true } = {}) {
  const attributes = new Map();
  const id = ++index;
  const p = {
    location: at, messages: [], spam: [], anims: [], xp: {}, boxes: [], inventory: container(),
    getIndex: () => id, getUsername: () => `Tester${id}`, isPlayer: () => true, isRegistered: () => true,
    getLocation: () => p.location,
    getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v),
    getInventory: () => p.inventory,
    getEquipment: () => ({ contains: () => false }),
    sendMessage: (m) => p.messages.push(m),
    performAnimation: (a) => p.anims.push(a.getId()),
    setPositionToFace() {},
    getSkillManager: () => ({
      addExperience: (skill, amount) => { const n = String(skill.getName?.() ?? skill); p.xp[n] = (p.xp[n] ?? 0) + amount; },
      getCurrentLevel: () => level, getMaxLevel: () => level,
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.boxes.push(chain), reset() {} }),
    getPacketSender() {
      const sender = {
        sendTypedMessage: (type, text) => { p.spam.push(text); return sender; },
        sendSoundEffect: (id) => { (p.sounds ??= []).push(id); return sender; },
        sendAreaSound: () => sender, sendGraphic: () => sender, sendObjectAnimation: () => sender,
        sendVarbit: () => sender, sendInventory: () => sender,
      };
      return sender;
    },
  };
  if (kit) p.inventory.adds(28136, 1);
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

/** A willow in Draynor (the recorded sapling site, 227/00083). */
const WILLOW = { id: 10833, x: 3083, y: 3237 };

function tree({ id, x, y } = WILLOW) {
  return new core.GameObject(id, new Location(x, y, 0), 10, 0, null);
}

/** The player starts chopping `object` and chops for `count` ticks. */
function chop(player, object, count) {
  for (const fn of hooks.events.get('woodcutting:validate-tree')) fn({ player, object, allow: true });
  chopping.add(player);
  ticks(count);
}

function log(player) {
  for (const fn of hooks.events.get('woodcutting:success')) fn({ player, logId: 1519 });
}

const bark = (p) => p.inventory.getAmount(28134);
const xp = (p, skill) => p.xp[skill] ?? p.xp[skill.toUpperCase()] ?? 0;

/** Starts an event of `kind` at the willow, with `players` taking part. */
function startEvent(kind, players) {
  const record = { object: tree(), location: new Location(WILLOW.x, WILLOW.y, 0), name: 'Willow tree', size: 2 };
  return Spawns.spawn(record, players, kind);
}

// ------------------------------------------------------------------ spawns

test('an event needs an eligible tree, a kit, enough chopping, and none nearby; it comes the tick after a log', () => {
  const p = fakePlayer({ kit: false });
  Math.random = () => 0;
  chop(p, tree(), 25);
  log(p);
  ticks(1);
  assert.equal(Spawns.active.size, 0, 'no kit');

  p.inventory.adds(28136, 1);
  log(p);
  assert.equal(Spawns.active.size, 1, 'the spot is taken at once');
  assert.equal(Sapling.saplings.size + Roots.events.size, 0, 'the event itself waits a tick');
  ticks(1);
  Math.random = random;
  assert.equal(Sapling.saplings.size + Roots.events.size, 1);
  assert.deepEqual(stopped, [p], 'the chopping stopped');

  const q = fakePlayer();
  chop(q, tree({ id: 10833, x: 3100, y: 3240 }), 250);
  log(q);
  ticks(1);
  assert.equal(Spawns.active.size, 1, 'none within 30 tiles of another');
});

test('an equipped Forestry kit also enables events', () => {
  const p = fakePlayer({ kit: false });
  p.getEquipment = () => ({ contains: (id) => id === 28136 });
  Math.random = () => 0;
  chop(p, tree(), 25);
  log(p);
  ticks(1);
  Math.random = random;
  assert.equal(Sapling.saplings.size + Roots.events.size, 1);
});

test('a regular tree or too little chopping brings nothing', () => {
  const p = fakePlayer();
  Math.random = () => 0.999;
  chop(p, tree(), 5);
  log(p);
  ticks(1);
  assert.equal(Spawns.active.size, 0, 'not chopped long enough yet');
  Math.random = random;
  assert.equal(Spawns.eligibleTree('Tree'), false);
  assert.equal(Spawns.eligibleTree('Burnt tree'), false);
  assert.equal(Spawns.eligibleTree('Hollow tree'), false);
  assert.equal(Spawns.eligibleTree('Willow tree'), true);
});

test('a falling tree brings an event at once; then the buffer holds the next one off', () => {
  const p = fakePlayer();
  Math.random = () => 0.999;
  chop(p, tree(), 5);
  const falling = { player: p, object: tree(), handled: false };
  Spawns.treeFalling(falling);
  assert.equal(Spawns.active.size, 1, 'the fall brings one before the chopping time is up');
  ticks(1);
  Math.random = random;
  const [event] = [...Spawns.active];
  assert.equal(falling.handled, event.kind === 'sapling', "a sapling takes the stump's place");
  Math.random = () => 0.999;
  if (event.kind === 'sapling') Sapling.finish(event, false);
  else ticks(200);
  assert.equal(Spawns.active.size, 0);
  chop(p, tree(), 190);
  Math.random = random;
  Spawns.treeFalling({ player: p, object: tree(), handled: false });
  assert.equal(Spawns.active.size, 0, 'too soon after the last');
  ticks(15);
  Spawns.treeFalling({ player: p, object: tree(), handled: false });
  assert.equal(Spawns.active.size, 1, 'past the buffer');
});

test("a held tree doesn't fall while its sapling stands", () => {
  const p = fakePlayer();
  startEvent('sapling', [p]);
  const fell = { object: tree(), handled: false };
  Spawns.treeFalling(fell);
  assert.equal(fell.handled, true);
  const elsewhere = { object: tree({ id: 10833, x: 3200, y: 3200 }), handled: false };
  Spawns.treeFalling(elsewhere);
  assert.equal(elsewhere.handled, false);
});

// ------------------------------------------------------------------ the sapling

test("nutrition: 10, +30 a right slot, +10 a right ingredient in the wrong slot (every recorded value)", () => {
  assert.equal(Sapling.nutrition([0, 0, 4], [2, 3, 1]), 10);
  assert.equal(Sapling.nutrition([0, 0, 4], [4, 3, 1]), 20);
  assert.equal(Sapling.nutrition([0, 0, 4], [0, 3, 1]), 40);
  assert.equal(Sapling.nutrition([0, 0, 4], [0, 4, 1]), 50);
  assert.equal(Sapling.nutrition([0, 0, 4], [4, 0, 2]), 50);
  assert.equal(Sapling.nutrition([0, 0, 4], [4, 1, 0]), 30);
  assert.equal(Sapling.nutrition([0, 0, 4], [0, 4, 0]), 60);
  assert.equal(Sapling.nutrition([0, 0, 4], [0, 0, 1]), 70);
  assert.equal(Sapling.nutrition([0, 0, 4], [0, 0, 4]), 100);
});

function pileOf(event, ingredient) {
  return event.piles.find((pile) => pile.index === ingredient).object;
}

function collect(player, event, ingredient) {
  const object = pileOf(event, ingredient);
  const name = core.CacheDefinitions.getObject(object.getId()).name;
  return hooks.objects.get(`${name}:Collect`)({ player, object });
}

const addMulch = (player, event) => hooks.objects.get('Struggling sapling:Add-mulch')({ player, object: event.loc });

test('the sapling takes the tree, with its piles and meter; Collect builds the mulch as recorded', () => {
  const p = fakePlayer();
  const event = startEvent('sapling', [p]);
  assert.equal(event.loc.getId(), 47487, 'the 2x2 sapling');
  assert.equal(event.piles.length, 5);
  assert.equal(event.npc.getId(), 12165);
  for (const pile of event.piles) assert.ok(Common.distance(pile.object.getLocation(), event.loc.getLocation()) <= 5);

  addMulch(p, event);
  assert.equal(p.messages.at(-1), 'You need some mulch to add to the sapling.');
  collect(p, event, 2);
  assert.equal(p.spam.at(-1), 'You create some mulch using droppings as the first ingredient.');
  assert.equal(p.inventory.getAmount(28648), 1);
  addMulch(p, event);
  assert.equal(p.messages.at(-1), 'You think this mulch could do with some more ingredients first.');
  collect(p, event, 0);
  assert.equal(p.spam.at(-1), 'You add some rotting leaves to your mulch as the second ingredient.');
  collect(p, event, 4);
  assert.equal(p.spam.at(-1), 'You add some splintered bark to your mulch as the third ingredient.');
  assert.deepEqual([p.inventory.getAmount(28648), p.inventory.getAmount(28649), p.inventory.getAmount(28650)], [0, 0, 1]);
  collect(p, event, 1);
  assert.equal(p.messages.at(-1), "The mulch would be too sloppy to handle with any more ingredients. It's ready to add to the sapling.");
  assert.deepEqual(p.anims.slice(-3), [827, 827, 827]);
});

function feedWith(player, event, mulch) {
  for (const ingredient of mulch) collect(player, event, ingredient);
  addMulch(player, event);
}

test('feeding: the lines, the hint, the bark the next tick and the XP; a perfect mulch', () => {
  const p = fakePlayer({ level: 80 });
  const event = startEvent('sapling', [p]);
  event.recipe = [0, 0, 4];
  feedWith(p, event, [0, 3, 1]);
  assert.equal(p.spam.at(-1), 'You add the mulch to the sapling...');
  assert.deepEqual(p.messages.slice(-2), [
    'It seems to accept it. You estimate the nutritional value of the mulch to be <col=3366ff>40%</col>.',
    'The sapling seems to love <col=3366ff>rotting leaves</col> as the <col=3366ff>first ingredient</col>.',
  ]);
  assert.equal(event.progress, 24, 'the hitsplat is 0.6 x the nutrition');
  assert.equal(bark(p), 0, 'the bark comes the next tick');
  ticks(1);
  assert.ok(bark(p) >= 3 && bark(p) <= 4);
  assert.match(p.spam.at(-1), /^You've been awarded <col=3366ff>\d Anima-infused bark<\/col>\.$/);
  assert.ok(xp(p, 'Woodcutting') > 0 && xp(p, 'Farming') > 0);

  assert.deepEqual(p.sounds.slice(-3), [2427, 7009, 7012], 'the add, the accept and the hint');

  feedWith(p, event, [0, 4, 1]);
  assert.equal(p.messages.at(-1), 'It seems to like it. You estimate the nutritional value of the mulch to be <col=3366ff>50%</col>.', 'no hint for a slot already found');
  feedWith(p, event, [0, 0, 4]);
  // rsprox 227/00083: the love line, a hint for each slot found with it, and the box the first time.
  const love = 'It seems to love it! You estimate the nutritional value of the mulch to be <col=3366ff>100%</col>.';
  assert.deepEqual(p.messages.slice(-4), [
    love,
    'The sapling seems to love <col=3366ff>rotting leaves</col> as the <col=3366ff>second ingredient</col>.',
    'The sapling seems to love <col=3366ff>splintered bark</col> as the <col=3366ff>third ingredient</col>.',
    'The sapling seems to love this combination of ingredients!',
  ]);
  assert.equal(p.boxes.length, 1, 'the item box');
  const sent = p.messages.length;
  feedWith(p, event, [0, 0, 4]);
  assert.equal(p.messages.length, sent, 'a second love in a row is spam only');
  assert.equal(p.spam.at(-1), love);
  assert.equal(p.boxes.length, 1, 'no second box');
});

test('saved: the thriving sapling, then bark, leaves and bonus XP; the tree back 14 ticks on', () => {
  const p = fakePlayer({ level: 80 });
  const event = startEvent('sapling', [p]);
  event.recipe = [1, 2, 3];
  for (let i = 0; i < 15; i++) feedWith(p, event, [1, 2, 3]);
  assert.equal(Sapling.saplings.has(event), false);
  assert.equal(event.loc.getId(), 47489, 'the thriving sapling');
  assert.equal(p.messages.at(-1), "<col=3366ff>Well done, you've saved the sapling and allowed it to flourish! It appears to have a gift for you...</col>");
  assert.equal(Spawns.active.has(event), false);
  ticks(1);
  assert.ok(p.messages.some((m) => /^You've been awarded <col=3366ff>(1[89]\d|200) Anima-infused bark<\/col>\.$/.test(m)), 'the lump for 100%');
  assert.ok(p.messages.includes(`You've been awarded <col=3366ff>${p.inventory.getAmount(6024)}</col> piles of <col=3366ff>Willow leaves</col>.`));
  assert.ok(p.inventory.getAmount(6024) >= 15 && p.inventory.getAmount(6024) <= 20);
  const at = (id) => core.ObjectManager.objectsAt(new Location(WILLOW.x, WILLOW.y, 0)).some((o) => o.getId() === id);
  ticks(12);
  assert.equal(at(47489), true, 'still thriving 13 ticks on');
  const chopAttempt = { player: p, object: tree(), allow: true };
  Spawns.refuseHeldTree(chopAttempt);
  assert.equal(chopAttempt.allow, false, 'the tree under it is held until it is back');
  ticks(1);
  assert.equal(at(10833), true, 'the willow is back');
  assert.equal(at(47489), false);
  assert.equal(Spawns.heldTrees.size, 0, 'the tree is free again');
});

test('a sapling is harder with more players; a late joiner helps but gets nothing', () => {
  const [a, b, c] = [fakePlayer(), fakePlayer(), fakePlayer()];
  const event = startEvent('sapling', [a, b]);
  assert.equal(event.target, 1800);
  event.recipe = [1, 1, 1];
  feedWith(c, event, [1, 1, 1]);
  assert.equal(c.messages.filter((m) => /eligible/.test(m)).length, 1);
  assert.equal(c.messages.includes("<col=ff3045>As you weren't chopping near the event when it started, you aren't eligible for full rewards.</col>"), true);
  ticks(1);
  assert.equal(bark(c), 0);
  assert.equal(xp(c, 'Woodcutting'), 1);
  assert.equal(event.progress, 60, 'it still counts');
  feedWith(c, event, [1, 1, 1]);
  assert.equal(c.messages.filter((m) => /eligible/.test(m)).length, 1, 'told once');
});

test('not saved in 400 ticks: it withers', () => {
  const p = fakePlayer();
  const event = startEvent('sapling', [p]);
  ticks(399);
  assert.equal(Sapling.saplings.has(event), true);
  ticks(1);
  assert.equal(Sapling.saplings.has(event), false);
  assert.equal(p.messages.at(-1), '<col=ff3045>The sapling withers due to lack of nutrients.</col>');
});

// ------------------------------------------------------------------ rising roots

/** Records the area sounds and loc anims the roots send (no real players are in the world). */
function watchRoots() {
  for (const event of Roots.events) Object.assign(event, { over: true, elapsed: Infinity });
  ticks(1);
  const seen = { sounds: [], anims: [] };
  const { areaSound, locAnim } = Common;
  Common.areaSound = (at, id, radius) => seen.sounds.push({ at: `${at.getX()},${at.getY()}`, id, radius });
  Common.locAnim = (object, seq) => seen.anims.push({ at: `${object.getLocation().getX()},${object.getLocation().getY()}`, seq });
  seen.restore = () => Object.assign(Common, { areaSound, locAnim });
  return seen;
}

const tileOf = (root) => `${root.object.getLocation().getX()},${root.object.getLocation().getY()}`;

test('rising roots (rsprox 227/01850): six with their rise sounds; 2-4 sink 7 ticks before each 21-29 tick wave, which replaces only them', () => {
  const p = fakePlayer();
  const seen = watchRoots();
  try {
    const event = startEvent('roots', [p]);
    assert.equal(event.roots.size, 6);
    assert.ok([...event.roots].every((r) => r.kind === 'normal'));
    assert.deepEqual(seen.sounds.map((s) => [s.id, s.radius]), Array(6).fill([7002, 4]), 'a rise sound on each tile');
    assert.deepEqual(seen.sounds.map((s) => s.at).sort(), [...event.roots].map(tileOf).sort());
    assert.ok(event.nextWave >= 21 && event.nextWave <= 29);
    const firstWave = event.nextWave;
    ticks(firstWave - 8);
    assert.equal(event.sinking.length, 0);
    seen.sounds.length = 0;
    ticks(1);
    const sunk = [...event.sinking];
    assert.ok(sunk.length >= 2 && sunk.length <= 4);
    assert.deepEqual(seen.sounds.map((s) => [s.id, s.radius]), Array(sunk.length).fill([7007, 2]), 'a sink sound on each sinking root');
    assert.deepEqual(seen.anims.filter((a) => a.seq === 10086).map((a) => a.at).sort(), sunk.map(tileOf).sort());
    const kept = [...event.roots].filter((r) => !sunk.includes(r));
    ticks(6);
    assert.equal(event.waves, 1, 'no wave yet');
    ticks(1);
    assert.equal(event.waves, 2);
    assert.equal(event.roots.size, 6, 'as many rise as sank');
    assert.ok(sunk.every((r) => !event.roots.has(r)), 'the sunk roots are gone');
    assert.ok(kept.every((r) => event.roots.has(r)), 'the rest stay');
    const anima = [...event.roots].filter((r) => r.kind === 'anima');
    assert.equal(anima.length, 1);
    ticks(event.nextWave - event.elapsed - 7);
    assert.ok(event.sinking.includes(anima[0]), "the last wave's anima root sinks with the next");
  } finally {
    seen.restore();
  }
});

test('rising roots end: every root sinks at 199 and goes 7 ticks later', () => {
  const p = fakePlayer();
  const seen = watchRoots();
  try {
    const event = startEvent('roots', [p]);
    ticks(198);
    assert.equal(Roots.events.has(event), true);
    seen.anims.length = 0;
    ticks(1);
    assert.equal(Spawns.active.has(event), false, 'over at 199');
    assert.equal(event.roots.size, 6, 'still standing while they sink');
    assert.deepEqual(seen.anims.map((a) => a.at).sort(), [...event.roots].map(tileOf).sort());
    ticks(6);
    assert.equal(event.roots.size, 6);
    ticks(1);
    assert.equal(event.roots.size, 0);
    assert.equal(Roots.events.has(event), false);
  } finally {
    seen.restore();
  }
});

test('chopping a root: the swing, the anim again 2 ticks on and every 4, bark the tick after each; the root stays', () => {
  const p = fakePlayer({ level: 70 });
  const event = startEvent('roots', [p]);
  const root = [...event.roots][0];
  Math.random = () => 0;
  try {
    hooks.objects.get('Tree roots:Chop down')({ player: p, object: root.object });
    assert.equal(p.spam.at(-1), 'You swing your axe at the roots.');
    assert.deepEqual(p.anims, [867]);
    ticks(1);
    assert.deepEqual(p.anims, [867]);
    ticks(1);
    assert.deepEqual(p.anims, [867, 867], 'the anim 2 ticks after the swing');
    assert.equal(bark(p), 0, 'not the same tick');
    ticks(1);
    assert.ok(bark(p) >= 3 && bark(p) <= 4, 'normal root at 41+, the tick after');
    assert.equal(Math.round(xp(p, 'Woodcutting')), Math.round(70 * 0.55));
    assert.equal(event.roots.has(root), true, 'the root stays');
    ticks(3);
    assert.equal(p.anims.length, 3, 'every 4 ticks');
    ticks(1);
    assert.equal(p.spam.filter((m) => m.includes('Anima-infused bark')).length, 2);
    assert.equal(Roots.sessions.has(p), true, 'still chopping');
  } finally {
    Math.random = random;
  }
});

test('a boosted Woodcutting level past 99 still pays the top band', () => {
  const p = fakePlayer({ level: 105 });
  const event = startEvent('roots', [p]);
  const root = [...event.roots][0];
  Math.random = () => 0;
  hooks.objects.get('Tree roots:Chop down')({ player: p, object: root.object });
  ticks(3);
  Math.random = random;
  assert.equal(bark(p), 3, 'the 41+ band');
});

test('an anima root pays more; a late joiner gets 1 XP and no bark', () => {
  const p = fakePlayer({ level: 30 });
  const late = fakePlayer({ level: 30 });
  const event = startEvent('roots', [p]);
  ticks(event.nextWave);
  const anima = [...event.roots].find((r) => r.kind === 'anima');
  const other = [...event.roots].find((r) => r.kind === 'normal');
  Math.random = () => 0;
  hooks.objects.get('Anima-infused Tree roots:Chop down')({ player: p, object: anima.object });
  hooks.objects.get('Tree roots:Chop down')({ player: late, object: other.object });
  ticks(3);
  Math.random = random;
  assert.ok(bark(p) >= 8 && bark(p) <= 10);
  assert.equal(bark(late), 0);
  assert.equal(xp(late, 'Woodcutting'), 1);
});

// ------------------------------------------------------------------ review fixes

test("the buffer after an event holds for everyone nearby, and survives a relog", () => {
  const p = fakePlayer();
  const other = fakePlayer();
  Math.random = () => 0.999;
  const event = startEvent('roots', [p]);
  for (let i = 0; i < 206; i++) ticks(1);
  assert.equal(Roots.events.has(event), false);
  chop(other, tree({ id: 10833, x: 3090, y: 3240 }), 5);
  Spawns.treeFalling({ player: other, object: tree({ id: 10833, x: 3090, y: 3240 }), handled: false });
  assert.equal(Spawns.active.size, 0, 'not a non-participant either');
  Spawns.choppers.delete(p);
  chop(p, tree({ id: 10833, x: 3200, y: 3300 }), 5);
  Spawns.treeFalling({ player: p, object: tree({ id: 10833, x: 3200, y: 3300 }), handled: false });
  Math.random = random;
  assert.equal(Spawns.active.size, 0, 'nor the participant, after a relog, far away');
});

test("chopping a root stops the woodcutting; starting on a tree stops the root", () => {
  const p = fakePlayer();
  const event = startEvent('roots', [p]);
  chopping.add(p);
  stopped.length = 0;
  const root = [...event.roots][0];
  hooks.objects.get('Tree roots:Chop down')({ player: p, object: root.object });
  assert.deepEqual(stopped, [p]);
  assert.equal(Roots.sessions.has(p), true);
  for (const fn of hooks.events.get('woodcutting:validate-tree')) fn({ player: p, object: tree({ id: 10833, x: 3200, y: 3300 }), allow: true });
  assert.equal(Roots.sessions.has(p), false);
});

test("mulch goes with the sapling even when its maker walked off, and at login if it's gone", () => {
  const p = fakePlayer();
  const event = startEvent('sapling', [p]);
  collect(p, event, 0);
  p.location = new Location(3200, 3300, 0);
  Sapling.finish(event, false);
  assert.equal(p.inventory.getAmount(28648), 0);
  assert.equal(p.getAttribute(Sapling.MULCH_ATTRIBUTE), null);

  p.inventory.adds(28650, 1);
  hooks.login({ player: p });
  assert.equal(p.inventory.getAmount(28650), 0, 'no sapling near: gone at login');
});

// These service checks use the production packet dispatcher, dialogue runtime, account morph,
// cache stock and real player inventories, without opening a server socket.
test('Friendly Forester native NPC services', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const api = PluginManager.createApi('Forestry');
  Common.init(api);
  require('../plugins/minigames/forestry/Forester.Forestry').attachForester(api);
  require('../plugins/interface/Omnishop.plugin').register(PluginManager.createApi('Omnishop'));
  require('../plugins/npcs/NpcDialogues.plugin').register(PluginManager.createApi('NpcDialogues'));
  api.onCustomEvent('ironman:mode', (event) => { event.mode = event.player.getAttribute('ironman:mode') ?? 'none'; });
  const cache = core.CacheDefinitions;
  core.RegionManager.loadMapFiles(3096, 3238);
  const spawn = require('../data/definitions/npc-spawns.json').filter((row) => row.id === 12119);
  assert.equal(spawn.length, 1);
  assert.deepEqual([spawn[0].x, spawn[0].y, spawn[0].level, spawn[0].wanderRadius], [3096, 3238, 0, 0]);
  let nextIndex = 1800;

  function harness({ mode = 'none', level = 70 } = {}) {
    const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel);
    const player = new Player(session, new Location(3095, 3238, 0));
    session.setPlayer(player);
    player.setIndex(nextIndex++);
    player.setUsername('foresterproof');
    player.setRegistered(true);
    player.setAttribute('ironman:mode', mode);
    player.getPacketSender().sendVarbit(1777, mode === 'ultimate' ? 2 : mode === 'ironman' ? 1 : 0);
    player.getSkillManager().setMaxLevels(core.Skill.WOODCUTTING, level, false);
    const connection = new ClientConnection(channel);
    connection.player = player;
    const npc = PluginManager.spawnNpc({ id: 12119, x: 3096, y: 3238, z: 0, wanderRadius: 0 });
    const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
    const option = async (name) => {
      const actions = npc.getCurrentDefinition(player).getActions();
      assert.ok(actions.includes(name), name);
      await send({ type: 'npc_option', index: npc.getIndex(), clickType: actions.indexOf(name) + 1 });
    };
    const choose = async (text) => {
      const pending = core.MultiChatboxPrompt.getPending(player);
      assert.ok(pending, text);
      const index = pending.options.indexOf(text);
      assert.ok(index >= 0, `${text} in ${pending.options}`);
      await send({ type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
    };
    const click = (component, fields) => PluginManager.emitInterfaceActionClick({
      player, buttonId: cache.getComponentId(component), action: 2, slot: -1, handled: false, ...fields,
    });
    return { player, npc, send, option, choose, click,
      async conversation(choice = "I'd like to trade with you.") {
        for (let index = 0; index < 60 && player.getInterfaceId() !== 819; index++) {
          if (core.MultiChatboxPrompt.getPending(player)) await choose(choice);
          else if (player.getDialogueManager().isActive()) {
            const group = player.getPacketSender().getChatboxGroupId();
            await send({ type: 'dialogue_continue', widgetId: (group << 16) | (group === 229 ? 4 : 5), childIndex: -1 });
          } else { ticks(1); break; }
        }
      },
      buy(row, action = 2) {
        const shop = cache.getDbRow(player.getAttribute('omnishop:shop'));
        const stock = shop.column(cache.getDbColumn(shop.tableId, 'omnishop_shop_stock'));
        const index = stock.indexOf(cache.getDbRowId(row));
        assert.ok(index >= 0, row);
        click('omnishop_main:list', { slot: index * 12, action });
      },
      sell(id) { click('omnishop_side:items', { slot: player.getInventory().getSlotForItemId(id) }); },
      close() {
        player.setRegistered(false);
        PluginManager.removeNpc(npc);
        core.TaskManager.cancelTasks(player.getIndex());
      },
    };
  }

  await t.test('Draynor Trade opens the native cache shop and offers a free kit', async () => {
    const h = harness();
    try {
      assert.equal(h.npc.getContentId(h.player), 11427);
      await h.option('Trade');
      assert.equal(h.player.getInterfaceId(), 819);
      assert.equal(h.player.getAttribute('omnishop:shop'), cache.getDbRowId('forestry_shop'));
      h.buy('forestry_shop_stock_0');
      assert.equal(h.player.getInventory().getAmount(28136), 1);
      const description = { player: h.player, shop: 'forestry_shop', stock: 'forestry_shop_stock_0' };
      api.emitCustomEvent('omnishop:describe', description);
      assert.equal(description.description, cache.getItem(28136).params.get(1784));
    } finally { h.close(); }
  });

  await t.test('first and repeat Talk-to and the help branch open the shop', async () => {
    const h = harness();
    try {
      await h.option('Talk-to');
      await h.conversation();
      assert.equal(h.player.getInterfaceId(), 819, 'intro opens the shop after the transcript closes');
      assert.equal(h.player.getAttribute('forestry:met-forester'), true);
      h.player.getPacketSender().sendInterfaceRemoval();
      await h.option('Talk-to');
      await h.conversation();
      assert.equal(h.player.getInterfaceId(), 819, 'repeat Trade dialogue');
      h.player.getPacketSender().sendInterfaceRemoval();
      await h.option('Talk-to');
      for (let index = 0; index < 12 && !core.MultiChatboxPrompt.getPending(h.player); index++) h.player.getDialogueManager().advance();
      await h.choose('Could you tell me more about forestry?');
      await h.conversation('Yes please.');
      assert.equal(h.player.getInterfaceId(), 819, 'help then accept Trade');
    } finally { h.close(); }
  });

  await t.test('level-14 introduction ends safely; direct free-kit Trade still works', async () => {
    const h = harness({ level: 14 });
    try {
      await h.option('Talk-to');
      await h.conversation();
      assert.notEqual(h.player.getInterfaceId(), 819);
      await h.option('Trade');
      h.buy('forestry_shop_stock_0');
      assert.equal(h.player.getInventory().getAmount(28136), 1);
    } finally { h.close(); }
  });

  await t.test('a newer interface cancels the deferred dialogue shop opening', async () => {
    const h = harness();
    try {
      await h.option('Talk-to');
      for (let index = 0; index < 60 && h.player.getDialogueManager().isActive(); index++) {
        const group = h.player.getPacketSender().getChatboxGroupId();
        await h.send({ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 });
      }
      assert.equal(h.player.getDialogueManager().isActive(), false);
      h.player.getPacketSender().sendInterface(12);
      ticks(1);
      assert.equal(h.player.getInterfaceId(), 12);
    } finally { h.close(); }
  });

  await t.test('free worlds offer the kit and felling handle while refusing members rewards', async () => {
    const h = harness();
    const members = core.WorldDefinition.isMembersWorld;
    core.WorldDefinition.isMembersWorld = () => false;
    try {
      const inventory = h.player.getInventory();
      inventory.adds(28134, 12500); inventory.adds(1522, 500);
      await h.option('Trade');
      h.buy('forestry_shop_stock_0'); h.buy('forestry_shop_stock_18');
      assert.equal(inventory.getAmount(28136), 1); assert.equal(inventory.getAmount(28177), 1);
      h.buy('forestry_shop_stock_27');
      assert.equal(inventory.getAmount(28613), 0);
      assert.equal(inventory.getAmount(28134), 2500);
    } finally { core.WorldDefinition.isMembersWorld = members; h.close(); }
  });

  await t.test('Ultimate morph exposes one-way log storage, requires confirmation and saves both noted and unnoted logs', async () => {
    const h = harness({ mode: 'ultimate' });
    try {
      assert.equal(h.npc.getContentId(h.player), 6724);
      const inventory = h.player.getInventory();
      inventory.adds(1521, 2); inventory.adds(1522, 300); inventory.adds(1520, 300); inventory.adds(1351, 1);
      await h.option('Log-storage'); await h.choose('Deposit all logs');
      assert.equal(inventory.getAmount(1522), 300, 'nothing moves before confirmation');
      await h.choose('No');
      assert.equal(inventory.getAmount(1522), 300);
      await h.option('Log-storage'); await h.choose('Deposit all logs'); await h.choose('Yes, deposit all logs');
      assert.equal(inventory.getAmount(1521), 0); assert.equal(inventory.getAmount(1522), 0);
      assert.equal(inventory.getAmount(1351), 1, 'unrelated items stay put');
      assert.deepEqual(h.player.getAttribute('forestry:shop-logs'), { 1521: 302, 1519: 300 });
      inventory.adds(28134, 5000);
      await h.option('Trade');
      assert.equal(h.player.getAttribute('omnishop:shop'), cache.getDbRowId('forestry_shop_uim'));
      h.buy('forestry_shop_stock_7_uim');
      assert.equal(inventory.getAmount(28140), 1, 'spends saved logs');
      assert.equal(h.player.getAttribute('forestry:shop-logs')[1521], 2);
      assert.equal(h.player.getAttribute('forestry:shop-logs')[1519], 0);
      h.sell(28140);
      assert.equal(inventory.getAmount(28140), 1, 'UIM cannot refund its log basket');
    } finally { h.close(); }
  });

  await t.test('single-log amount input preserves notes and rejects stale, invalid and overflowing deposits', async () => {
    const h = harness({ mode: 'ultimate' });
    try {
      const inventory = h.player.getInventory();
      inventory.adds(1521, 5); inventory.adds(1522, 20);
      function prompt() {
        assert.equal(PluginManager.emitItemOnNpc({ player: h.player, target: h.npc, npcId: 6724,
          item: inventory.getItems()[inventory.getSlotForItemId(1522)], itemId: 1522,
          slot: inventory.getSlotForItemId(1522), handled: false }), true);
        return h.player.getEnteredAmountAction();
      }
      for (const value of [-1, 0, NaN, 1.5, Infinity]) prompt().execute(value);
      assert.equal(inventory.getAmount(1521), 5);
      const stale = prompt(); h.player.setLocation(new Location(3105, 3238, 0)); stale.execute(5);
      assert.equal(inventory.getAmount(1521), 5);
      h.player.setLocation(new Location(3095, 3238, 0));
      prompt();
      await h.send({ type: 'dialogue_amount', amount: 3 });
      assert.equal(inventory.getAmount(1521), 2); assert.equal(inventory.getAmount(1522), 20);
      h.player.setAttribute('forestry:shop-logs', { 1521: 2147483646 });
      prompt().execute(99);
      assert.equal(h.player.getAttribute('forestry:shop-logs')[1521], 2147483647);
      assert.equal(inventory.getAmount(1521), 1, 'overflowing logs stay in the inventory');
    } finally { h.close(); }
  });

  await t.test('mixed saved logs and notes can pay in a full inventory without false capacity', async () => {
    const h = harness({ mode: 'ultimate' });
    try {
      const inventory = h.player.getInventory();
      h.player.setAttribute('forestry:shop-logs', { 1521: 5, 1519: 5 });
      inventory.adds(1522, 5); inventory.adds(28134, 21);
      while (inventory.getFreeSlots()) inventory.adds(1351, 1);
      await h.option('Trade'); h.buy('forestry_shop_stock_1');
      assert.equal(inventory.getAmount(28159), 1);
      assert.equal(inventory.getAmount(28134), 1);
      assert.equal(inventory.getAmount(1522), 0);
      assert.equal(h.player.getAttribute('forestry:shop-logs')[1521], 0);
      assert.equal(h.player.getAttribute('forestry:shop-logs')[1519], 0);
    } finally { h.close(); }
  });

  await t.test('normal purchases and 80% refunds include the exact noted-log costs', async () => {
    const h = harness();
    try {
      const inventory = h.player.getInventory();
      inventory.adds(28134, 5000); inventory.adds(1522, 300); inventory.adds(1520, 299);
      await h.option('Trade'); h.buy('forestry_shop_stock_7');
      assert.equal(inventory.getAmount(28134), 5000, 'missing one currency takes nothing');
      assert.equal(inventory.getAmount(1522), 300);
      inventory.adds(1520, 1); h.buy('forestry_shop_stock_7');
      assert.equal(inventory.getAmount(28140), 1);
      h.sell(28140);
      assert.equal(inventory.getAmount(28140), 0);
      assert.equal(inventory.getAmount(28134), 4000);
      assert.equal(inventory.getAmount(1522), 240); assert.equal(inventory.getAmount(1520), 240);
    } finally { h.close(); }
  });

  await t.test('a sale refuses while its bark and log refunds would not all fit', async () => {
    const h = harness();
    try {
      // Review of #1990: a log basket, a noted oak stack and 26 fillers, with no bark or noted willow.
      const inventory = h.player.getInventory();
      inventory.adds(28140, 1); inventory.adds(1522, 1);
      while (inventory.getFreeSlots()) inventory.adds(1351, 1);
      await h.option('Trade');
      h.sell(28140);
      assert.equal(inventory.getAmount(28140), 1, 'the basket stays: bark and noted willow need two new slots');
      assert.equal(inventory.getAmount(28134), 0);
      assert.equal(inventory.getAmount(1520), 0);
      assert.equal(inventory.getAmount(1522), 1);

      inventory.delete(1351, 1);
      h.sell(28140);
      assert.equal(inventory.getAmount(28140), 0, 'with a second free slot the sale goes through');
      assert.equal(inventory.getAmount(28134), 4000);
      assert.equal(inventory.getAmount(1522), 241); assert.equal(inventory.getAmount(1520), 240);
    } finally { h.close(); }
  });

  await t.test('storage is account-wide across relog and Check paginates every saved log', async () => {
    const h = harness({ mode: 'ultimate' });
    const reloaded = harness({ mode: 'ultimate' });
    try {
      const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
      const saved = { 1521: 42, 1519: 17 };
      h.player.setAttribute('forestry:shop-logs', saved);
      h.player.setAttribute('forestry:met-forester', true);
      const snapshot = PlayerSave.fromPlayer(h.player);
      assert.deepEqual(snapshot.attributes['forestry:shop-logs'], saved);
      assert.equal(snapshot.attributes['forestry:met-forester'], true);
      snapshot.applyToPlayer(reloaded.player);
      PluginManager.emitPlayerLogin({ player: reloaded.player, username: reloaded.player.getUsername() });
      assert.equal(reloaded.player.getPacketSender().getVarbit(17231), 1);
      assert.deepEqual(reloaded.player.getAttribute('forestry:shop-logs'), saved);
      await reloaded.option('Log-storage'); await reloaded.choose('Check stored logs');
      const pages = [];
      for (let i = 0; i < 4 && reloaded.player.getDialogueManager().isActive(); i++) {
        const page = reloaded.player.getDialogueManager().getCurrent().getText();
        assert.ok(page.split('<br>').length <= 3);
        pages.push(page); reloaded.player.getDialogueManager().advance();
      }
      assert.equal(pages.length, 3);
      assert.ok(pages.join('<br>').includes('Oak logs: 42'));
      assert.ok(pages.join('<br>').includes('Willow logs: 17'));
      assert.deepEqual(reloaded.player.getAttribute('forestry:shop-logs'), saved, 'Check never withdraws logs');
    } finally { h.close(); reloaded.close(); }
  });

  await t.test('UIM cape refunds and transactions through a stale account-mode shop are refused', async () => {
    const h = harness({ mode: 'ultimate' });
    try {
      h.player.getInventory().adds(28613, 1);
      await h.option('Trade'); h.sell(28613);
      assert.equal(h.player.getInventory().getAmount(28613), 1);
      h.player.setAttribute('ironman:mode', 'none');
      h.buy('forestry_shop_stock_0');
      assert.equal(h.player.getInventory().getAmount(28136), 0);
    } finally { h.close(); }
  });
});
