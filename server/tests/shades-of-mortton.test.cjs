// Run after `yarn build`: node --test tests/shades-of-mortton.test.cjs
//
// Shades of Mort'ton's minigame against the rsprox recordings (232/03119: shadows rising and sinking,
// their remains; 227/01858: the catacombs' entrance, a tomb door and a chest) and the Wiki (the
// chests' loot and coins).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Common, Shades, Catacombs, Pyres, hooks, core;

function chain(map, key, fn) {
  const prior = map.get(key);
  map.set(key, prior ? (event) => prior(event) || fn(event) : fn);
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  core = PluginManager.getCoreApi();
  hooks = { objects: new Map(), events: { emitted: [] }, npcHit: [], npcDeath: [], spawned: [] };
  const itemOnObjectFns = [];
  const logoutFns = [];
  const api = {
    core,
    onObjectInteraction: (name, actions) => { for (const [op, fn] of Object.entries(actions)) chain(hooks.objects, `${name}:${op}`, fn); },
    onNpcHitModify: (fn) => hooks.npcHit.push(fn),
    onNpcDeath: (fn) => hooks.npcDeath.push(fn),
    onCustomEvent: (name, fn) => { hooks.events[name] = fn; },
    // As PluginManager.emitItemOnObject: every hook sees the event until one handles it.
    onItemOnObject: (fn) => {
      itemOnObjectFns.push(fn);
      hooks.itemOnObject = (event) => { for (const f of itemOnObjectFns) if (!event.handled) f(event); };
    },
    // The real PluginManager spawn and removal: a real NPC, in the real World.
    spawnNpc: (definition) => { const npc = PluginManager.spawnNpc(definition, "Shades of Mort'ton"); hooks.spawned.push(npc); return npc; },
    removeNpc: (npc) => PluginManager.removeNpc(npc),
    onPlayerLogout: (fn) => {
      logoutFns.push(fn);
      hooks.logout = (event) => { for (const f of logoutFns) f(event); };
    },
    emitCustomEvent: (name, payload) => {
      if (name === 'quest:get-stage') payload.stage = payload.player.stage ?? 0;
      else if (name === 'diary:is-complete') payload.complete = payload.diary === 'morytania' && payload.player.diaries?.has(payload.tier) === true;
      else hooks.events.emitted.push([name, payload]);
    },
  };
  require('../plugins/minigames/ShadesOfMortton.plugin').register(api);
  Common = require('../plugins/minigames/shadesofmortton/Common.ShadesOfMortton');
  Shades = require('../plugins/minigames/shadesofmortton/Shades.ShadesOfMortton');
  Catacombs = require('../plugins/minigames/shadesofmortton/Catacombs.ShadesOfMortton');
  Pyres = require('../plugins/minigames/shadesofmortton/Pyres.ShadesOfMortton');
});

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

function container(capacity = 28) {
  const slots = [];
  return {
    slots,
    add(item) { slots.push({ id: item.getId(), amount: item.getAmount() }); },
    delete(id, amount = 1) { for (const s of slots) { if (s.id !== id || amount <= 0) continue; const n = Math.min(s.amount, amount); s.amount -= n; amount -= n; } },
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getFreeSlots: () => capacity - slots.filter((s) => s.amount > 0).length,
    getValidItems: () => slots.filter((s) => s.amount > 0).map((s) => ({ getId: () => s.id, getAmount: () => s.amount })),
    // ItemContainer.getAddableAmount: a held stack takes up to its cap, a new one needs a slot.
    getAddableAmount(item) {
      const held = this.getAmount(item.getId());
      const stacks = core.ItemDefinition.forId(item.getId())?.isStackable?.() === true;
      if (!stacks) return Math.min(item.getAmount(), this.getFreeSlots());
      if (held > 0) return Math.min(item.getAmount(), 0x7fffffff - held);
      return this.getFreeSlots() > 0 ? item.getAmount() : 0;
    },
    refreshItems() {},
  };
}

function fakePlayer(at = new Location(3485, 3321, 0)) {
  const p = {
    location: at, messages: [], pages: [], inventory: container(),
    getLocation: () => p.location, moveTo(l) { p.location = l; },
    getInventory: () => p.inventory, sendMessage: (m) => p.messages.push(m), performAnimation() {},
    getPacketSender: () => ({ sendSound() {}, sendInterfaceRemoval() {} }),
    getDialogueManager: () => ({
      startDialogues(builder) { for (const page of builder.getDialogues().values()) if (page.getText) p.pages.push(page.getText()); },
      reset() {},
    }),
  };
  return p;
}

const key = (metal, colour) => Common.objId(`shadekey_${metal}_${colour}`);
const loc = (name, x, y, face = 0) => new core.GameObject(Common.locId(name), new Location(x, y, 0), 0, face, null);

function fakeShadow(id) {
  const npc = { id, transform: null, anims: [], target: null, hp: 38,
    getId: () => id, setNpcTransformationId(t) { npc.transform = t; }, performAnimation(a) { npc.anims.push(a.getId()); },
    getCombat: () => ({ getTarget: () => npc.target }), getHitpoints: () => npc.hp };
  return npc;
}

test('every shade drops its own remains, and only them (Loar remains from a Loar shadow or shade)', () => {
  const roll = (npcId) => { const event = { npcId, drops: [{ itemId: 526, amount: 1 }] }; hooks.events['npc-drops:roll'](event); return event.drops; };
  assert.deepEqual(roll(Common.npcId('shadeshadow_level1')), [{ itemId: Common.objId('shade_bones1'), amount: 1 }]);
  assert.deepEqual(roll(Common.npcId('shade_level3')), [{ itemId: Common.objId('shade_bones3'), amount: 1 }]);
  assert.deepEqual(roll(Common.npcId('shadeshadow_level6')), [{ itemId: Common.objId('shade_bones6'), amount: 1 }]);
});

test('a shadow rises into its shade when hit or fighting (shade_rise), and sinks back 68 ticks after its last fight', () => {
  const hit = fakeShadow(Common.npcId('shadeshadow_level1'));
  for (const fn of hooks.npcHit) fn({ npc: hit });
  assert.equal(hit.transform, Common.npcId('shade_level1'));
  assert.deepEqual(hit.anims, [1288]);
  const fighter = fakeShadow(Common.npcId('shadeshadow_level2'));
  fighter.target = {};
  Shades.watch([fighter]);
  Shades.process();
  assert.equal(fighter.transform, Common.npcId('shade_level2'), 'it rose to fight');
  fighter.target = null;
  for (let i = 0; i < 67; i++) Shades.process();
  assert.equal(fighter.transform, Common.npcId('shade_level2'));
  Shades.process();
  assert.equal(fighter.transform, -1, 'back to its shadow');
});

test("the hillside's wooden doors: refused without a key; with one, \"You use your Shade key...\" and inside 2 ticks on", () => {
  const door = loc('shadelairentrancel', 3485, 3320);
  const p = fakePlayer();
  hooks.objects.get('Wooden doors:Open')({ player: p, object: door });
  assert.ok(p.messages.includes('You need a key to open this door.'));
  p.inventory.add(new core.Item(key('bronze', 'bloodred'), 1));
  hooks.objects.get('Wooden doors:Open')({ player: p, object: door });
  assert.ok(p.messages.includes('You use your Shade key to unlock the door.'));
  ticks(2);
  assert.deepEqual([p.location.getX(), p.location.getY()], [3493, 9725]);
  assert.equal(p.inventory.getAmount(key('bronze', 'bloodred')), 1, 'the key is kept');
});

test('tomb doors: a key of the metal or better takes you through; back needs none; a lesser key is refused', () => {
  const bronze = loc('shadelair_bronzedoor', 3504, 9723, 2);
  const p = fakePlayer(new Location(3504, 9723, 0));
  p.inventory.add(new core.Item(key('steel', 'brown'), 1));
  hooks.objects.get('Solid bronze door:Open')({ player: p, object: bronze });
  assert.ok(p.messages.includes('You open the ominous tomb door.'));
  assert.deepEqual([p.location.getX(), p.location.getY()], [3505, 9723]);
  hooks.objects.get('Solid bronze door:Open')({ player: p, object: bronze });
  assert.ok(p.messages.includes('You walk back through the ominous door.'));
  assert.deepEqual([p.location.getX(), p.location.getY()], [3504, 9723]);
  const black = loc('shadelair_blackdoor', 3504, 9723, 2);
  hooks.objects.get('Solid black door:Open')({ player: p, object: black });
  assert.equal(p.messages.at(-1), 'You need a key to open this door.');
});

test("chests: another key is refused with the recorded line; its own key dissolves into treasure, coins and swamp paste", () => {
  const p = fakePlayer(new Location(3510, 9723, 0));
  p.inventory.add(new core.Item(key('bronze', 'bloodred'), 1));
  hooks.objects.get('Bronze Chest:Open')({ player: p, object: loc('shadechest_bronze_brown', 3511, 9723) });
  assert.equal(p.messages.at(-1), "You don't have the correct key.<br>You need a bronze key with a brown trim to open this chest.");
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    hooks.objects.get('Bronze Chest:Open')({ player: p, object: loc('shadechest_bronze_bloodred', 3511, 9724) });
  } finally {
    Math.random = random;
  }
  assert.equal(p.inventory.getAmount(key('bronze', 'bloodred')), 0, 'the key dissolves');
  assert.equal(p.inventory.getAmount(Common.objId('swamppaste')), 10);
  assert.ok(p.inventory.getAmount(995) > 0);
  assert.match(p.pages[0], /^You find some treasure and \d+ gold coins\. The key strangely dissolves into the chest lock\.$/);
  assert.equal(p.pages[1], 'You find 10 doses of swamp paste at the bottom of the chest.');
});

test("coins are a third of what the roll leaves over the loot's value (Wiki)", () => {
  const random = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(Catacombs.coinsFor('bronze', null), Math.floor(400 / 3));
    const gold = core.CacheDefinitions.getItem(2357).price;
    assert.equal(Catacombs.coinsFor('bronze', { id: 2357, amount: 1 }), Math.max(0, Math.floor((400 - gold) / 3)));
  } finally {
    Math.random = random;
  }
});

// ------------------------------------------------------------------ pyres

function burner({ stage = 85 } = {}) {
  const p = fakePlayer(new Location(3507, 3278, 0));
  Object.assign(p, {
    stage, xp: [], anims: [],
    getUsername: () => 'Burner', getPrivateArea: () => null, isRegistered: () => true,
    performAnimation: (a) => p.anims.push(a.getId()),
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      // SkillManager.addExperience keeps tenths and drops the rest: floor(x * 10 + 1e-6) / 10.
      addExperience: (skill, amount) => { p.xp.push([skill.getName(), Math.floor(amount * 10 + 1e-6) / 10]); },
    }),
  });
  return p;
}

const pyre = (name) => new core.GameObject(Common.locId(name), new Location(3507, 3276, 0), 10, 0, null);

test('a funeral pyre: logs, then remains, then Light; the fire, the experience, the Shade Spirit and the reward', () => {
  const p = burner();
  p.inventory.add(new core.Item(Common.objId('magic_logs_pyre'), 1));
  p.inventory.add(new core.Item(Common.objId('shade_bones1'), 1));
  p.inventory.add(new core.Item(Common.objId('tinderbox'), 1));
  hooks.events.emitted.length = 0;
  hooks.itemOnObject({ player: p, object: pyre('temple_pyre'), itemId: Common.objId('magic_logs_pyre'), handled: false });
  assert.ok(p.messages.includes('You put some logs on the pyre.'));
  assert.equal(p.inventory.getAmount(Common.objId('magic_logs_pyre')), 0);
  hooks.itemOnObject({ player: p, object: pyre('temple_pyre_magic'), itemId: Common.objId('shade_bones1'), handled: false });
  assert.ok(p.messages.includes("You place the shade's remains on the logs."));
  hooks.objects.get('Magic Pyre:Light')({ player: p, object: pyre('temple_pyre_bones_magic') });
  assert.ok(p.messages.includes('You attempt to light the funeral pyre.'));
  assert.equal(p.anims.at(-1), 733);
  ticks(3);
  // Wiki "Cremating shade remains": Loar remains on magic pyre logs give 35 Prayer experience (not the flat 25).
  assert.deepEqual(p.xp, [['Prayer', 35], ['Firemaking', 404.5]]);
  ticks(2 + 4 + 1);
  const names = hooks.events.emitted.map(([name]) => name);
  assert.deepEqual(names, ['shades-of-mortton:pyre-logs', 'shades-of-mortton:cremated'], 'the quest hears of both');
  const reward = hooks.events.emitted[1][1].reward;
  assert.ok(reward.id === 995 || Common.keyOf(reward.id)?.metal === 'bronze', 'Loar remains give coins or a bronze key');
});

test('remains need wood good enough (Riyl: willow or better), and the quest step comes first', () => {
  const p = burner();
  p.inventory.add(new core.Item(Common.objId('logs_pyre'), 1));
  p.inventory.add(new core.Item(Common.objId('shade_bones3'), 1));
  hooks.itemOnObject({ player: p, object: pyre('temple_pyre'), itemId: Common.objId('logs_pyre'), handled: false });
  hooks.itemOnObject({ player: p, object: pyre('temple_pyre_logs'), itemId: Common.objId('shade_bones3'), handled: false });
  assert.equal(p.messages.at(-1), Common.message('weakLogs'));
  assert.equal(p.inventory.getAmount(Common.objId('shade_bones3')), 1);
  const early = burner({ stage: 60 });
  early.inventory.add(new core.Item(Common.objId('logs_pyre'), 1));
  hooks.itemOnObject({ player: early, object: new core.GameObject(Common.locId('temple_pyre'), new Location(3477, 3268, 0), 10, 0, null), itemId: Common.objId('logs_pyre'), handled: false });
  assert.equal(early.messages.at(-1), Common.message('needQuest'));
});

test('the reward (Wiki): a key from the remains\' groups, else 21% coins', () => {
  const remains = { keys: Common.data.pyres.remains.shade_bones2.keys, coins: [400, 500] };
  const random = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(Common.keyOf(Pyres.rewardFor(remains).id).metal, 'bronze', 'Phrin: the 12.5% bronze group first');
    Math.random = () => 0.5;
    assert.equal(Common.keyOf(Pyres.rewardFor(remains).id).metal, 'steel');
    Math.random = () => 0.9;
    assert.equal(Pyres.rewardFor(remains).id, 995);
  } finally {
    Math.random = random;
  }
});

test('a chest without room for all its treasure (3 mithril bars, coins, paste) keeps the key and gives nothing', () => {
  const p = fakePlayer(new Location(3510, 9723, 0));
  for (let i = 0; i < 25; i++) p.inventory.add(new core.Item(1511, 1));
  p.inventory.add(new core.Item(key('bronze', 'bloodred'), 1));
  const open = () => hooks.objects.get('Bronze Chest:Open')({ player: p, object: loc('shadechest_bronze_bloodred', 3511, 9724) });
  const random = Math.random;
  Math.random = () => 0.43; // the mithril bars on the bronze table
  try {
    open();
    assert.equal(p.messages.at(-1), Common.message('noRoom'));
    assert.equal(p.inventory.getAmount(key('bronze', 'bloodred')), 1, 'the key is kept');
    assert.equal(p.inventory.getAmount(2359), 0);
    for (let i = 0; i < 3; i++) p.inventory.delete(1511, 1);
    open();
  } finally {
    Math.random = random;
  }
  assert.equal(p.inventory.getAmount(key('bronze', 'bloodred')), 0, 'with room, the key dissolves');
  assert.equal(p.inventory.getAmount(2359), 3);
  assert.ok(p.inventory.getAmount(Common.objId('swamppaste')) > 0);
});

function loaded(p, at = pyre('temple_pyre')) {
  Pyres.pyres.clear(); // the pyres earlier tests left loaded
  p.inventory.add(new core.Item(Common.objId('magic_logs_pyre'), 1));
  p.inventory.add(new core.Item(Common.objId('shade_bones1'), 1));
  p.inventory.add(new core.Item(Common.objId('tinderbox'), 1));
  hooks.itemOnObject({ player: p, object: at, itemId: Common.objId('magic_logs_pyre'), handled: false });
  hooks.itemOnObject({ player: p, object: pyre('temple_pyre_magic'), itemId: Common.objId('shade_bones1'), handled: false });
}

test('a pyre burns once: Light again while it burns is refused, and the experience comes once', () => {
  const p = burner();
  loaded(p);
  const ready = pyre('temple_pyre_bones_magic');
  hooks.objects.get('Magic Pyre:Light')({ player: p, object: ready });
  hooks.objects.get('Magic Pyre:Light')({ player: p, object: ready });
  assert.equal(p.messages.filter((m) => m === 'You attempt to light the funeral pyre.').length, 1);
  assert.equal(p.messages.at(-1), Common.message('pyreBusy'));
  ticks(3 + 2 + 4);
  assert.deepEqual(p.xp, [['Prayer', 35], ['Firemaking', 404.5]]);
  assert.equal(Pyres.pyres.size, 0, 'the pyre is free again');
});

// Wiki "Cremating shade remains" Prayer table (base column) and the Morytania Hard diary column (+50%, tenths dropped).
const WIKI_PRAYER = [
  // [pyre logs, remains, base, hard diary]
  ['logs_pyre', 'shade_bones1', 25, 37.5], ['logs_pyre', 'shade_bones2', 37.5, 56.2],
  ['oak_logs_pyre', 'shade_bones1', 33, 49.5], ['oak_logs_pyre', 'shade_bones2', 45.5, 68.2],
  ['willow_logs_pyre', 'shade_bones3', 61, 91.5], ['teak_logs_pyre', 'shade_bones3', 61.2, 91.8],
  ['arctic_pine_logs_pyre', 'shade_bones1', 33.9, 50.8], ['maple_logs_pyre', 'shade_bones2', 46.5, 69.7],
  ['mahogany_logs_pyre', 'shade_bones1', 34.3, 51.4], ['yew_logs_pyre', 'shade_bones4', 79.5, 119.2],
  ['camphor_logs_pyre', 'shade_bones2', 47.5, 71.2], ['magic_logs_pyre', 'shade_bones4', 80, 120],
  ['magic_logs_pyre', 'shade_bones5', 100, 150], ['ironwood_logs_pyre', 'shade_bones4', 80.5, 120.7],
  ['redwood_logs_pyre', 'shade_bones5', 100.5, 150.7], ['redwood_logs_pyre', 'shade_bones6', 120.5, 180.7],
  ['rosewood_logs_pyre', 'shade_bones4', 80.6, 120.9], ['rosewood_logs_pyre', 'shade_bones6', 120.5, 180.7],
];

function cremate(logs, remains, diaries = []) {
  const p = burner();
  p.diaries = new Set(diaries);
  Pyres.pyres.clear();
  p.inventory.add(new core.Item(Common.objId(logs), 1));
  p.inventory.add(new core.Item(Common.objId(remains), 1));
  p.inventory.add(new core.Item(Common.objId('tinderbox'), 1));
  const wood = logs.replace(/_logs_pyre$/, '').replace(/^logs_pyre$/, 'logs');
  hooks.itemOnObject({ player: p, object: pyre('temple_pyre'), itemId: Common.objId(logs), handled: false });
  hooks.itemOnObject({ player: p, object: pyre(`temple_pyre_${wood}`), itemId: Common.objId(remains), handled: false });
  hooks.objects.get(`${Common.core.CacheDefinitions.getObject(Common.locId(`temple_pyre_${wood}`)).name}:Light`)({ player: p, object: pyre(`temple_pyre_bones_${wood}`) });
  ticks(3 + 2 + 4 + 1);
  return p.xp;
}

test('Prayer experience depends on the remains and the log (Wiki table), and the Hard diary adds 50%', () => {
  for (const [logs, remains, base, hard] of WIKI_PRAYER) {
    assert.equal(cremate(logs, remains)[0][1], base, `${remains} on ${logs}`);
    assert.equal(cremate(logs, remains, ['hard'])[0][1], hard, `${remains} on ${logs} with the Hard diary`);
  }
});

test('the Elite Morytania diary adds 50% Firemaking experience, and the Hard one does not', () => {
  assert.deepEqual(cremate('magic_logs_pyre', 'shade_bones1', ['elite']), [['Prayer', 35], ['Firemaking', 606.7]]);
  assert.deepEqual(cremate('redwood_logs_pyre', 'shade_bones6', ['hard', 'elite']), [['Prayer', 180.7], ['Firemaking', 750]]);
  assert.deepEqual(cremate('magic_logs_pyre', 'shade_bones1', ['hard']), [['Prayer', 52.5], ['Firemaking', 404.5]]);
});

test('a burner who logs out leaves the pyre empty for the next player, and a lit burn stops', () => {
  const gone = burner();
  loaded(gone);
  hooks.logout({ player: gone });
  assert.equal(Pyres.pyres.size, 0);
  const next = burner();
  next.inventory.add(new core.Item(Common.objId('magic_logs_pyre'), 1));
  hooks.itemOnObject({ player: next, object: pyre('temple_pyre'), itemId: Common.objId('magic_logs_pyre'), handled: false });
  assert.ok(next.messages.includes('You put some logs on the pyre.'), 'not held for the one who left');
  hooks.logout({ player: next });
  const lit = burner();
  loaded(lit);
  hooks.objects.get('Magic Pyre:Light')({ player: lit, object: pyre('temple_pyre_bones_magic') });
  hooks.logout({ player: lit });
  ticks(3 + 2 + 4);
  assert.deepEqual(lit.xp, [], 'nothing more of a burn given up');
});

test('a coin stack at its cap keeps the key: the chest would award coins the stack cannot take', () => {
  const p = fakePlayer(new Location(3510, 9723, 0));
  p.inventory.add(new core.Item(995, 0x7fffffff));
  p.inventory.add(new core.Item(key('bronze', 'bloodred'), 1));
  const random = Math.random;
  Math.random = () => 0.99; // coins and paste
  try {
    hooks.objects.get('Bronze Chest:Open')({ player: p, object: loc('shadechest_bronze_bloodred', 3511, 9724) });
  } finally {
    Math.random = random;
  }
  assert.equal(p.messages.at(-1), Common.message('noRoom'));
  assert.equal(p.inventory.getAmount(key('bronze', 'bloodred')), 1, 'the key is kept');
  assert.equal(p.inventory.getAmount(995), 0x7fffffff);
  assert.equal(p.inventory.getAmount(Common.objId('swamppaste')), 0);
  assert.equal(p.pages.length, 0);
});

test('a spare key does not cost the room: the dissolving key always frees its own slot', () => {
  const p = fakePlayer(new Location(3510, 9723, 0));
  for (let i = 0; i < 23; i++) p.inventory.add(new core.Item(1511, 1));
  p.inventory.add(new core.Item(key('bronze', 'bloodred'), 1));
  p.inventory.add(new core.Item(key('bronze', 'bloodred'), 1));
  assert.equal(p.inventory.getFreeSlots(), 3);
  const random = Math.random;
  Math.random = () => 0.43; // 3 mithril bars and paste: 4 slots, 3 free plus the key's
  try {
    hooks.objects.get('Bronze Chest:Open')({ player: p, object: loc('shadechest_bronze_bloodred', 3511, 9724) });
  } finally {
    Math.random = random;
  }
  assert.notEqual(p.messages.at(-1), Common.message('noRoom'));
  assert.equal(p.inventory.getAmount(key('bronze', 'bloodred')), 1, 'one key dissolves, the spare stays');
  assert.equal(p.inventory.getAmount(2359), 3);
  assert.ok(p.inventory.getAmount(Common.objId('swamppaste')) > 0);
});

// ------------------------------------------------------------------ the Undead Zealot and the Altar of the Damned
// Wiki (Undead Zealot, Altar (Shade Catacombs)). No rsprox capture exists for any of it (NPC
// 10591/10592 and object 41222 searches return nothing). Still a harness: the hook registry above
// (not PluginManager's), fake players for the chest and altar, and no real combat for the zealot.
// Real: PluginManager.spawnNpc / removeNpc, a real NPC in the real World, the real cache names.

const ZEALOT = 10591;
const ZEALOT_2 = 10592;
const BLEACHED_BONES = 25422;
const ALTAR_OF_THE_DAMNED = 41222;

test('the cache names of the zealot, the bleached bones and the altar resolve to the Wiki ids', () => {
  assert.equal(Common.npcId('shades_undead_zealot_1'), ZEALOT);
  assert.equal(Common.npcId('shades_undead_zealot_2'), ZEALOT_2);
  assert.equal(Common.objId('shade_bleached_bones'), BLEACHED_BONES);
  assert.equal(Common.locId('shade_lair_temple_altar'), ALTAR_OF_THE_DAMNED);
});

function openBronzeChest(p, random) {
  p.inventory.add(new core.Item(key('bronze', 'bloodred'), 1));
  const original = Math.random;
  Math.random = () => random;
  try {
    hooks.objects.get('Bronze Chest:Open')({ player: p, object: loc('shadechest_bronze_bloodred', 3511, 9724) });
  } finally {
    Math.random = original;
  }
}

test('opening a chest raises an Undead Zealot 1 time in 20, owned by the opener alone (Wiki, Mod Ash)', () => {
  hooks.spawned.length = 0;
  const lucky = fakePlayer(new Location(3510, 9723, 0));
  openBronzeChest(lucky, 0.0499);
  assert.equal(lucky.inventory.getAmount(key('bronze', 'bloodred')), 0, 'the chest still opened');
  assert.equal(hooks.spawned.length, 1);
  const zealot = hooks.spawned[0];
  assert.ok(zealot, 'a real NPC was created');
  assert.equal(zealot.getId(), ZEALOT);
  assert.equal(zealot.getOwner(), lucky, 'only the opener may attack it');
  assert.equal(zealot.isOwnerOnly(), false, 'the Wiki does not hide it from others');
  PluginManager.removeNpc(zealot);
  const unlucky = fakePlayer(new Location(3510, 9723, 0));
  openBronzeChest(unlucky, 0.05);
  assert.equal(hooks.spawned.length, 1, 'no zealot at 1 in 20 and above');
});

test('no zealot when the chest does not open (wrong key)', () => {
  hooks.spawned.length = 0;
  const p = fakePlayer(new Location(3510, 9723, 0));
  p.inventory.add(new core.Item(key('bronze', 'brown'), 1));
  const original = Math.random;
  Math.random = () => 0;
  try {
    hooks.objects.get('Bronze Chest:Open')({ player: p, object: loc('shadechest_bronze_bloodred', 3511, 9724) });
  } finally {
    Math.random = original;
  }
  assert.equal(hooks.spawned.length, 0);
});

test('an unkilled zealot is removed when its opener logs out, and only then', () => {
  hooks.spawned.length = 0;
  const opener = fakePlayer(new Location(3510, 9723, 0));
  const other = fakePlayer(new Location(3510, 9723, 0));
  openBronzeChest(opener, 0);
  const zealot = hooks.spawned[0];
  assert.ok(zealot, 'a real NPC was created');
  assert.equal(zealot.isRegistered(), true, 'it is in the world');
  hooks.logout({ player: other });
  assert.equal(zealot.isRegistered(), true, 'another player leaving does not remove it');
  hooks.logout({ player: opener });
  assert.equal(zealot.isRegistered(), false, 'removed from the world');
  hooks.logout({ player: opener });
});

test('an Undead Zealot always drops bleached bones, and keeps its other drops', () => {
  for (const npcId of [ZEALOT, ZEALOT_2]) {
    const event = { npcId, drops: [{ itemId: 6807, amount: 1 }] };
    hooks.events['npc-drops:roll'](event);
    assert.deepEqual(event.drops, [{ itemId: 6807, amount: 1 }, { itemId: BLEACHED_BONES, amount: 1 }]);
  }
  const other = { npcId: Common.npcId('shade_level1'), drops: [] };
  hooks.events['npc-drops:roll'](other);
  assert.ok(!other.drops.some((d) => d.itemId === BLEACHED_BONES), 'a shade drops no bleached bones');
});

function prayerPlayer(current) {
  const p = burner();
  const levels = { current, max: 99 };
  p.getSkillManager = () => ({
    getCurrentLevel: () => levels.current,
    getMaxLevel: () => levels.max,
    setCurrentLevels: (skill, level) => { levels.current = level; },
    updateSkill() {},
    addExperience: (skill, amount) => { p.xp.push([skill.getName(), amount]); },
  });
  p.prayer = () => levels.current;
  return p;
}

const altar = () => new core.GameObject(ALTAR_OF_THE_DAMNED, new Location(3492, 9694, 0), 10, 0, null);
const onAltar = (p, itemId) => {
  const event = { player: p, object: altar(), objectId: ALTAR_OF_THE_DAMNED, itemId, handled: false };
  hooks.itemOnObject(event);
  return event;
};

test('bleached bones on the Altar of the Damned restore full Prayer, use up one bone and give no experience (Wiki)', () => {
  const p = prayerPlayer(10);
  p.inventory.add(new core.Item(BLEACHED_BONES, 1));
  const event = onAltar(p, BLEACHED_BONES);
  assert.equal(event.handled, true);
  assert.equal(p.prayer(), 99);
  assert.equal(p.inventory.getAmount(BLEACHED_BONES), 0);
  assert.deepEqual(p.xp, [], 'no Prayer experience');
});

test('bones dropped on the way to the altar restore nothing on arrival', () => {
  const p = prayerPlayer(10);
  const event = onAltar(p, BLEACHED_BONES);
  assert.equal(event.handled, false, 'left to the engine');
  assert.equal(p.prayer(), 10);
});

test('at full Prayer the altar leaves the event to the engine and keeps the bone', () => {
  const p = prayerPlayer(99);
  p.inventory.add(new core.Item(BLEACHED_BONES, 1));
  const event = onAltar(p, BLEACHED_BONES);
  assert.equal(event.handled, false);
  assert.equal(p.inventory.getAmount(BLEACHED_BONES), 1);
  assert.deepEqual(p.messages, []);
});

test('other bones are not taken by the Altar of the Damned', () => {
  const p = prayerPlayer(10);
  p.inventory.add(new core.Item(526, 1));
  const event = onAltar(p, 526);
  assert.equal(event.handled, false);
  assert.equal(p.prayer(), 10);
  assert.equal(p.inventory.getAmount(526), 1);
});
