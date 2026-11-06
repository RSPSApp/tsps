// Run after `yarn build`: node --test tests/hallowed-sepulchre.test.cjs
//
// The Hallowed Sepulchre against rsprox 1862 and 3299 (and the Wiki for the loot and levels):
// the entry, the floors' instances and layouts, the timer, the obstacles, the coffins and leaving.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Common, Run, hooks;
const collectionObtains = [];

/** Whether the test player has done Sins of the Father (the Sepulchre's quest). */
let questDone = true;

before(async () => {
  await CachePipeline.initialize();
  RegionManager.init();
  hooks = { objects: new Map(), npcs: new Map(), items: {}, login: [], prompts: [], spawned: [], removed: [] };
  const key = (ids, click) => (Array.isArray(ids) ? ids : [ids]).map((id) => `${id}:${click}`);
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onObjectClick: (ids, click, handler) => { for (const k of key(ids, click)) hooks.objects.set(k, handler); },
    onNpcClick: (ids, click, handler) => { for (const k of key(ids, click)) hooks.npcs.set(k, handler); },
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onPlayerLogout: (handler) => (hooks.logout ??= []).push(handler),
    onObjectRoute: (handler) => { hooks.route = handler; },
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    emitCustomEvent: (name, request) => {
      if (name === 'quest:is-complete' && request.key === 'sins_of_the_father') request.complete = questDone;
      if (name === 'collection-log:obtain') collectionObtains.push(request);
    },
    spawnNpc: ({ id, x, y, z }) => fakeNpc(id, new Location(x, y, z)),
    removeNpc: (npc) => { npc.registered = false; hooks.removed.push(npc); },
  };
  require('../plugins/minigames/HallowedSepulchre.plugin').register(api);
  Common = require('../plugins/minigames/hallowedsepulchre/Common.HallowedSepulchre');
  Run = require('../plugins/minigames/hallowedsepulchre/Run.HallowedSepulchre');
});

let random;
beforeEach(() => {
  random = Math.random;
  hooks.prompts.length = 0;
  collectionObtains.length = 0;
});

/** A trap NPC: where it is, its glides and seqs. */
function fakeNpc(id, location) {
  const npc = {
    id, location, registered: true, glides: [], anims: [], area: null,
    getId: () => id, getLocation: () => npc.location, isRegistered: () => npc.registered,
    isPlayer: () => false, isNpc: () => true, getIndex: () => 1000 + hooks.spawned.length, getAsNpc: () => npc,
    setArea(area) { npc.area = area; }, getArea: () => npc.area,
    getMovementQueue: () => ({ setBlockMovement() {} }),
    exactMove(to) { npc.glides.push([npc.location, to]); npc.location = to; return npc; },
    performAnimation(a) { npc.anims.push(a.getId()); },
  };
  hooks.spawned.push(npc);
  return npc;
}

function container() {
  const slots = [];
  return {
    slots,
    adds(id, amount = 1) { const slot = slots.find((s) => s.id === id); if (slot) slot.amount += amount; else slots.push({ id, amount }); },
    delete(id, amount = 1) { const slot = slots.find((s) => s.id === id); if (slot) slot.amount -= amount; },
    contains: (id) => slots.some((s) => s.id === id && s.amount > 0),
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getAddableAmount: (item) => item.getAmount(),
    getItems: () => [],
  };
}

function fakePlayer({ agility = 99, thieving = 99, ring = null } = {}) {
  const attributes = new Map();
  const p = {
    location: new Location(2387, 5982, 0), area: null, messages: [], spam: [], boxes: [], anims: [], graphics: [],
    varbits: new Map(), scripts: [], subs: [], xp: {}, songs: [], forced: [], registered: true,
    inventory: container(),
    getIndex: () => 1, getUsername: () => 'Tester', getDisplayName: () => 'Tester',
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => p.registered,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    setLocation(location) { p.location = location; },
    getArea: () => p.area, setArea(area) { p.area = area; },
    getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v),
    getInventory: () => p.inventory,
    getEquipment: () => {
      const items = [];
      if (ring) items[Common.core.Equipment.RING_SLOT] = { getId: () => ring };
      return { getItems: () => items };
    },
    sendMessage: (m) => p.messages.push(m),
    performAnimation: (a) => p.anims.push(a.getId()),
    performGraphic: (g) => p.graphics.push(g.getId()),
    setRunEnergy() {},
    hits: [], decrements: [], blocked: false,
    getMovementQueue: () => ({ reset() {}, setBlockMovement(v) { p.blocked = v; } }),
    getCombat: () => ({ reset() {} }),
    decrementHealth: (hit) => { p.decrements.push(hit.getDamage()); return hit; },
    addTickHit: (hit) => p.hits.push(hit.getDamage()),
    setForceMovement: (f) => { if (f) p.forced.push(f); },
    getForceMovement: () => null,
    getSkillManager: () => ({
      addExperience: (skill, amount) => { const name = String(skill.getName?.() ?? skill); p.xp[name] = (p.xp[name] ?? 0) + amount; },
      getCurrentLevel: (skill) => (String(skill.getName?.() ?? skill).toUpperCase().includes('THIEV') ? thieving : agility),
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.boxes.push(chain), reset() {} }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { p.varbits.set(id, value); return sender; },
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendSubInterface: (uid, id) => { p.subs.push(id); return sender; },
        closeSubInterface: (uid) => { p.subs.push(-uid); return sender; },
        sendTypedMessage: (type, text) => { p.spam.push(text); return sender; },
        sendSong: (id) => { p.songs.push(id); return sender; },
        sendJingle: () => sender,
        sendSound: () => sender,
        sendObjectAnimation: (object, anim) => { (p.locAnims ??= []).push([object.getId(), anim.getId()]); return sender; },
        sendGraphic: (graphic, location) => { (p.tileGraphics ??= []).push([graphic.id, location]); return sender; },
        sendInterfaceRemoval: () => sender,
      };
      return sender;
    },
  };
  return p;
}

const varbit = (p, name) => p.varbits.get(Common.data.varbits[name]) ?? 0;
const boxText = (chain) => [...chain.dialogues.values()][0].text;

function ticks(count) {
  for (let i = 0; i < count; i++) {
    TaskManager.process();
    for (const run of [...runs()]) if (run.area) run.tick(run.area);
  }
}

const live = new Set();
function* runs() { for (const p of live) { const run = Run.runOf(p); if (run) yield run; } }

/** Into a run past the entry, on floor 1 with layout `variant`. */
function startRun(p, variant = 0) {
  live.add(p);
  p.setAttribute(Common.data.attributes.tutorial, true);
  p.setAttribute(Common.data.attributes.entryCheck, true);
  Math.random = () => (variant + 0.5) / Common.data.floors[0].variants.length;
  click(p, Common.data.lobby.stairs, 1);
  const run = Run.runOf(p);
  for (let i = 0; i < 20 && !p.subs.includes(668); i++) ticks(1);
  Math.random = random;
  return run;
}

function click(p, id, option = 1, object = null) {
  const handler = hooks.objects.get(`${id}:${option}`);
  return handler({ player: p, object, objectId: id, clickType: option });
}

/** The instance copy of template loc `id` at `tile`. */
function locOf(run, id, tile) {
  const object = run.area.getTemplateObjects(run.area.at(tile)).find((o) => o.getId() === id);
  assert.ok(object, `loc ${id} at ${tile}`);
  return object;
}

test('the stairs: the Stranger first, then the recorded warning box and its menu', () => {
  const p = fakePlayer();
  click(p, Common.data.lobby.stairs);
  assert.equal(p.boxes.length, 1, 'the Stranger stops you before his tutorial');
  assert.equal(Run.runOf(p), null);
  p.setAttribute(Common.data.attributes.tutorial, true);
  click(p, Common.data.lobby.stairs);
  assert.equal(boxText(p.boxes[1]), 'You are about to enter the Hallowed Sepulchre. Dying during this activity will not be considered a safe death. Are you sure you wish to enter?');
  [...p.boxes[1].dialogues.values()][1].action.execute();
  const prompt = hooks.prompts.at(-1);
  assert.equal(prompt.title, 'Are you sure you wish to enter?');
  assert.deepEqual(prompt.args.filter((a) => typeof a === 'string'), ['Yes.', "Yes, and don't ask again.", 'No.']);
  live.add(p);
  prompt.args[3]();
  assert.equal(varbit(p, 'hallowed_entry_check'), 1, "don't ask again is saved");
  assert.ok(Run.runOf(p));
  Run.runOf(p).finish();
});

test('without Sins of the Father neither the stairs nor a shard lets you in', () => {
  const p = fakePlayer();
  p.setAttribute(Common.data.attributes.tutorial, true);
  p.setAttribute(Common.data.attributes.entryCheck, true);
  p.inventory.adds(Common.data.items.shard, 1);
  questDone = false;
  try {
    click(p, Common.data.lobby.stairs);
    assert.equal(Run.runOf(p), null);
    assert.equal(p.messages.at(-1), 'You need to have completed Sins of the Father to enter the Hallowed Sepulchre.');
    hooks.items['Hallowed crystal shard'].Activate({ player: p });
    assert.equal(p.inventory.getAmount(Common.data.items.shard), 1, 'the shard is kept');
    assert.equal(p.messages.at(-1), 'You need to have completed Sins of the Father to enter the Hallowed Sepulchre.');
  } finally {
    questDone = true;
  }
});

test('below 52 Agility the stairs refuse', () => {
  const p = fakePlayer({ agility: 51 });
  p.setAttribute(Common.data.attributes.tutorial, true);
  click(p, Common.data.lobby.stairs);
  assert.equal(Run.runOf(p), null);
  assert.match(p.messages.at(-1), /Agility level of 52/);
});

test('floor 1: an instance of its source, the start tile, the layout varbits, 202 ticks', () => {
  const p = fakePlayer();
  const run = startRun(p, 0);
  assert.equal(run.floorNumber, 1);
  assert.deepEqual(run.area.templateOf(p.getLocation()), [2253, 6018, 2]);
  assert.equal(varbit(p, 'hallowed_ranged_state'), 1);
  assert.ok(p.messages.includes('You venture down into the Hallowed Sepulchre.'));
  assert.ok(p.songs.includes(674));
  assert.ok(p.subs.includes(668), 'the timer HUD');
  // The cache map's own locs are in the copy, at their template tiles.
  locOf(run, 39622, [2274, 5983, 1]);
  assert.equal(varbit(p, 'hallowed_time_remaining'), 202);
  run.finish();
});

test('the timer: one a tick, the recorded warnings, sealed at 1 with the door line', () => {
  const p = fakePlayer();
  const run = startRun(p);
  ticks(1);
  assert.equal(varbit(p, 'hallowed_time_remaining'), 201);
  assert.deepEqual(p.scripts.at(-1), [3442, 201]);
  run.remaining = 102;
  ticks(1);
  assert.ok(p.messages.includes('<col=ef1020>Time remaining: 1:00'));
  run.remaining = 2;
  ticks(1);
  assert.equal(run.remaining, 1);
  assert.equal(run.expired, false);
  ticks(1);
  assert.equal(run.expired, true);
  assert.equal(p.messages.at(-1), '<col=ef1020>You hear a loud rumbling noise as the door to the next floor closes.');
  ticks(3);
  assert.equal(run.remaining, 1, 'it stays at 1');
  run.finish();
});

test('a drop: the jump-down, the landing a plane lower the next tick, 25 Agility XP', () => {
  const p = fakePlayer();
  const run = startRun(p, 0);
  const object = locOf(run, 38462, [2281, 5988, 2]);
  click(p, 38462, 1, object);
  assert.equal(p.anims.at(-1), Common.seq('jumpDown'));
  ticks(1);
  assert.deepEqual(run.area.templateOf(p.getLocation()), [2282, 5985, 1]);
  ticks(1);
  assert.equal(p.xp.Agility ?? p.xp.AGILITY, 25);
  run.finish();
});

test('a platform: two hops two ticks apart, the line and the timer stopped; back is refused', () => {
  const p = fakePlayer();
  const run = startRun(p, 0);
  const object = locOf(run, 38458, [2279, 5984, 1]);
  p.moveTo(run.area.at([2281, 5984, 1]));
  click(p, 38458, 1, object);
  assert.ok(p.spam.includes('You jump across the platform.'));
  assert.equal(run.paused, true);
  assert.equal(varbit(p, 'hallowed_block_climbover'), 1);
  assert.deepEqual(p.scripts.at(-1), [3443, run.remaining]);
  const first = p.forced.at(-1);
  assert.equal(first.getEnd().getX(), -2);
  assert.equal(first.getReverseSpeed(), 27);
  assert.equal(first.getDirection(), 3, 'facing west');
  const remaining = run.remaining;
  ticks(2);
  assert.equal(p.forced.length, 2);
  ticks(2);
  assert.equal(run.remaining, remaining, 'the timer has stopped');
  p.moveTo(run.area.at([2277, 5984, 1]));
  click(p, 38458, 1, object);
  assert.equal(p.messages.at(-1), "You don't see any reason to go back that way.");
  run.finish();
});

test('the floor stairs: the completion, time and PB lines, the XP, and floor 2 with 200 more ticks', () => {
  const p = fakePlayer();
  const run = startRun(p, 0);
  run.floorSpent = 80;
  run.pause();
  const remaining = run.remaining;
  click(p, 39622, 1, locOf(run, 39622, [2274, 5983, 1]));
  ticks(2);
  assert.ok(p.messages.includes('You have completed Floor 1 of the Hallowed Sepulchre! Total completions: <col=ff0000>1</col>.'));
  assert.ok(p.messages.includes('Floor 1 time: <col=ff0000>0:48</col> (new personal best)'), p.messages.join('|'));
  assert.equal(p.varbits.get(10406), 80);
  ticks(4);
  assert.equal(run.floorNumber, 2);
  assert.equal(run.remaining, remaining + 200);
  assert.ok(p.messages.includes('You venture further down into the Hallowed Sepulchre.'));
  run.finish();
});

test('the obelisk: Exit asks, credits a finished floor and resets to the lobby', () => {
  const p = fakePlayer();
  const run = startRun(p, 0);
  run.pause();
  const obelisk = locOf(run, 38451, [2277, 5982, 1]);
  click(p, 38451, 2, obelisk);
  const prompt = hooks.prompts.at(-1);
  assert.equal(prompt.title, 'Are you sure you wish to leave?');
  prompt.args[1]();
  assert.match(p.messages.at(-1), /completed Floor 1/);
  ticks(2);
  assert.equal(p.messages.at(-1), 'The obelisk teleports you back to the lobby of the Hallowed Sepulchre.');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2400, 5982, 0]);
  assert.equal(Run.runOf(p), null);
  assert.equal(varbit(p, 'hallowed_time_remaining'), 0);
});

test('a coffin: the picklock, the disarm with Thieving XP, the lid, then the Wiki loot once', () => {
  const p = fakePlayer();
  const run = startRun(p, 2);
  const coffin = locOf(run, 39544, [2272, 5972, 1]);
  Math.random = () => 0;
  click(p, 39544, 1, coffin);
  ticks(5);
  assert.ok(p.spam.includes('You successfully disarm the trap on the coffin!'));
  ticks(1);
  assert.ok(p.spam.includes('You push the coffin lid aside.'));
  ticks(2);
  Math.random = random;
  assert.equal(p.inventory.getAmount(24711), 1, 'floor 1: one Hallowed mark');
  assert.ok(collectionObtains.some((event) => event.player === p && event.itemId === 24711 && event.amount === 1),
    'the mark is credited to the collection log');
  assert.ok(p.messages.includes('<col=005f00>Tester received a drop: Hallowed mark</col>'));
  assert.equal(varbit(p, 'hallowed_current_floor_looted'), 1);
  click(p, 39544, 1, coffin);
  assert.equal(p.messages.at(-1), 'You have already looted this coffin.');
  run.finish();
});

test('the loot tables: marks by floor and one tier roll from the Wiki tables', () => {
  const Coffins = require('../plugins/minigames/hallowedsepulchre/Coffins.HallowedSepulchre');
  for (let floor = 1; floor <= 5; floor++) {
    for (let i = 0; i < 50; i++) {
      const drops = Coffins.coffinLoot(floor);
      const [min, max] = Common.data.loot.marks[floor];
      assert.equal(drops[0][0], 24711);
      assert.ok(drops[0][1] >= min && drops[0][1] <= max);
      const all = [...Common.data.loot.low, ...Common.data.loot.mid, ...Common.data.loot.high].map(([id]) => id);
      assert.ok(all.includes(drops[1][0]));
    }
  }
});

test('a crystal shard ends the run in the lobby; a token adds a minute, not outside', () => {
  const p = fakePlayer();
  p.inventory.adds(24719, 2);
  hooks.items['Hallowed token'].Activate({ player: p });
  assert.equal(p.messages.at(-1), 'The Hallowed token can only be used inside the Hallowed Sepulchre minigame.');
  const run = startRun(p);
  const before = run.remaining;
  hooks.items['Hallowed token'].Activate({ player: p });
  assert.equal(run.remaining, before + 100);
  p.inventory.adds(24709, 1);
  hooks.items['Hallowed crystal shard'].Activate({ player: p });
  ticks(3);
  assert.equal(Run.runOf(p), null);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2399, 5981]);
});

test('logging out mid-run puts the player in the lobby', () => {
  const p = fakePlayer();
  const run = startRun(p);
  run.area.leave(p, true);
  assert.equal(Run.runOf(p), null);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2400, 5982]);
});

/** Puts the run on `floor` with layout `variant`, the player at template `tile`. */
function onFloor(run, p, floor, variant, tile) {
  const spec = Common.data.floors[floor - 1];
  run.move(spec, spec.variants[variant]);
  run.states = {};
  p.moveTo(run.area.at(tile));
}

const moves = (p, run, from) => p.forced.slice(from).map((f) => {
  const start = run.area.templateOf(f.getStart());
  return [start[0], start[1], start[0] + f.getEnd().getX(), start[1] + f.getEnd().getY()];
});

test('the grapple pillars reproduce the recorded F3 swing: 2413 -> 2408 -> 2403 at y 5868', () => {
  const p = fakePlayer();
  const run = startRun(p);
  onFloor(run, p, 3, 0, [2413, 5868, 2]);
  p.inventory.adds(24721, 1);
  const before = p.forced.length;
  click(p, 39524, 1, locOf(run, 39524, [2408, 5869, 2]));
  ticks(3);
  assert.ok(p.spam.includes('You fire your grapple at the pillar...'));
  ticks(6);
  assert.deepEqual(moves(p, run, before), [[2413, 5868, 2408, 5868], [2408, 5868, 2403, 5868]]);
  assert.ok(p.spam.includes('...and swing safely to the other side.'));
  assert.equal(varbit(p, 'hallowed_ranged_xp_earned'), 1);
  run.finish();
});

test('the bridge reproduces the recorded F1 crossing: 5981 -> 5975 at x 2262, after the repair', () => {
  const p = fakePlayer();
  const run = startRun(p, 2);
  onFloor(run, p, 1, 2, [2262, 5981, 1]);
  click(p, 39527, 1, locOf(run, 39527, [2262, 5980, 1]));
  assert.match(p.messages.at(-1), /two planks, five nails/);
  p.inventory.adds(960, 2);
  p.inventory.adds(1539, 5);
  p.inventory.adds(8794, 1);
  p.inventory.adds(2347, 1);
  click(p, 39527, 1, locOf(run, 39527, [2262, 5980, 1]));
  ticks(2);
  assert.ok(p.spam.includes('You repair the broken bridge.'));
  assert.equal(varbit(p, 'hallowed_construction_state'), 2);
  assert.equal(p.inventory.getAmount(1539), 0);
  const before = p.forced.length;
  click(p, 39527, 1, locOf(run, 39527, [2262, 5980, 1]));
  assert.deepEqual(moves(p, run, before), [[2262, 5981, 2262, 5975]]);
  assert.equal(p.forced.at(-1).getReverseSpeed(), 115);
  ticks(4);
  assert.ok(p.spam.includes('You rapidly make your way across the bridge.'));
  run.finish();
});

test('the portal reproduces the recorded F3 pass: x 2386, 5839 -> 5843, once powered', () => {
  const p = fakePlayer();
  const run = startRun(p);
  onFloor(run, p, 3, 1, [2386, 5839, 2]);
  run.states.hallowed_magic_state = 2;
  const before = p.forced.length;
  click(p, 39533, 1, locOf(run, 39533, [2384, 5841, 2]));
  assert.equal(p.anims.at(-1), Common.seq('floatUp'));
  ticks(1);
  assert.deepEqual(moves(p, run, before), [[2386, 5839, 2386, 5843]]);
  assert.ok(p.spam.includes('You pass through the portal and end up on the other side.'));
  run.finish();
});

test("every drop lands by its face, the rule the unrecorded F4 north drop's landing comes from", () => {
  const { getTemplateRegion } = require('../dist/game/collision/TemplateRegionData');
  const byFace = { 0: [1, -3], 1: [-3, 1], 2: [1, 3], 3: [3, 1] };
  for (const [key, to] of Object.entries(Common.data.drops)) {
    if (key.startsWith('_')) continue;
    const [x, y, z] = key.split(',').map(Number);
    const region = getTemplateRegion(((x >> 6) << 8) | (y >> 6));
    const loc = region.chunks.flat().find((l) => l && l.localX === (x & 63) && l.localY === (y & 63) && l.plane === z && Common.data.dropIds.includes(l.id));
    assert.ok(loc, `a drop at ${key}`);
    assert.deepEqual(to, [x + byFace[loc.face][0], y + byFace[loc.face][1], z - 1], `drop ${loc.id} at ${key}`);
  }
});

test('a second click on the floor stairs, or an Exit meanwhile, credits nothing more', () => {
  const p = fakePlayer();
  const run = startRun(p, 0);
  run.pause();
  const stairs = locOf(run, 39622, [2274, 5983, 1]);
  click(p, 39622, 1, stairs);
  click(p, 39622, 1, stairs);
  click(p, 38451, 3, locOf(run, 38451, [2277, 5982, 1]));
  ticks(10);
  assert.equal(p.messages.filter((m) => m.startsWith('You have completed Floor')).length, 1);
  assert.equal(run.floorNumber, 2);
  assert.equal(run.ended, false);
  run.finish();
});

test('leaving clears the fade and the minimap, even in the middle of one', () => {
  const p = fakePlayer();
  const run = startRun(p);
  click(p, 39622, 1, locOf(run, 39622, [2274, 5983, 1]));
  run.pause();
  run.finish();
  assert.equal(varbit(p, 'minimap_state'), 0);
  assert.ok(p.subs.includes(-((161 << 16) | 1)), 'the fade closed');
});

test('teleporting away before floor 1 ends the run instead of pulling the player in', () => {
  const p = fakePlayer();
  live.add(p);
  p.setAttribute(Common.data.attributes.tutorial, true);
  p.setAttribute(Common.data.attributes.entryCheck, true);
  click(p, Common.data.lobby.stairs, 1);
  p.moveTo(new Location(3222, 3218, 0));
  ticks(8);
  assert.equal(Run.runOf(p), null);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3222, 3218]);
});

test("from floor 3's layout A start the pillars are used from the recorded end (2413), the one that can be walked to", () => {
  const p = fakePlayer();
  const run = startRun(p);
  onFloor(run, p, 3, 0, [2404, 5856, 2]);
  const event = { player: p, object: locOf(run, 39524, [2408, 5869, 2]), objectId: 39524, destination: null };
  hooks.route(event);
  const dest = run.area.templateOf(new Location(event.destination.x, event.destination.y, event.destination.z));
  assert.deepEqual(dest, [2413, 5868, 2]);
  run.finish();
});

test('floor 5: the barriers by the Grand Hallowed Coffin let the player through until the timer runs out', () => {
  const { RegionManager } = PluginManager.getCoreApi();
  const p = fakePlayer();
  const run = startRun(p);
  const spec = Common.data.floors[4];
  run.move(spec, spec.variants[0]);
  run.setBarriers(false);
  const from = run.area.at([2272, 5857, 0]);
  const through = () => RegionManager.canMove(from.getX(), from.getY(), from.getX(), from.getY() - 1, 0, 1, 1, run.area);
  assert.equal(through(), true, 'inactive: walk on to the coffin');
  run.expire();
  assert.equal(through(), false, 'active once the barrier activates');
  run.finish();
});


// ------------------------------------------------------------------ part 2: the traps

const Traps = require('../plugins/minigames/hallowedsepulchre/Traps.HallowedSepulchre');

/** A run on `floor` (layout `variant`) with its traps built, the player at template `tile`. */
function trapFloor(floor, variant, tile, ring = null) {
  const p = fakePlayer({ ring });
  const run = startRun(p);
  onFloor(run, p, floor, variant, tile);
  run.lastLanding = Common.data.floors[floor - 1].variants[variant].start;
  Traps.build(run);
  run.traps.prev = tile;
  Traps.tick(run);
  return { p, run };
}

/** Runs the traps until their clock reads `tick` (0 is the floor's start). */
function trapsTo(run, tick) {
  while (run.traps.tick < tick) Traps.tick(run);
}

test('fire: every active floor 1 statue pairs with the blast tile in front of it (recorded corridor 2281-2283)', () => {
  const { run } = trapFloor(1, 0, [2253, 6018, 2]);
  assert.ok(run.traps.fires.length >= 30, `${run.traps.fires.length} fire traps`);
  const fire = run.traps.fires.find((f) => f.at.join() === '2279,5992,2');
  assert.ok(fire, 'the north corridor statue');
  assert.deepEqual(fire.tiles, [[2281, 5992, 2], [2282, 5992, 2], [2283, 5992, 2]]);
  run.finish();
});

test('fire: standing in a blast on its first tick is a hit; then the death, the fade and the recorded checkpoint', () => {
  const { p, run } = trapFloor(1, 0, [2282, 5992, 2]);
  // Floors 1-2: ready at 1 mod 8, the blast starts 3 ticks later.
  trapsTo(run, 3);
  assert.equal(p.hits.length, 0);
  Traps.tick(run);
  assert.equal(p.hits.length, 1, 'hit on the blast start tick');
  assert.ok(p.hits[0] >= 1 && p.hits[0] <= 3, 'tier 1 damage');
  ticks(2);
  assert.equal(p.anims.at(-1), Common.seq('human_death'));
  ticks(2);
  assert.deepEqual(run.area.templateOf(p.getLocation()), [2282, 6000, 2], 'recorded respawn (1862 T19074, hit T19070)');
  run.finish();
});

test('the Hallowed ring negates damage and skips normal recovery at the checkpoint', () => {
  for (const ring of [Common.core.ItemIdentifiers.HALLOWED_RING, Common.core.ItemIdentifiers.HALLOWED_RING_2]) {
    const { p, run } = trapFloor(1, 0, [2282, 5992, 2], ring);
    try {
      trapsTo(run, 3);
      Traps.tick(run);
      assert.equal(p.decrements.length, 0, `no damage with ring ${ring}`);
      assert.equal(p.hits.length, 0, `no hitsplat with ring ${ring}`);
      assert.deepEqual(run.area.templateOf(p.getLocation()), [2282, 6000, 2], 'returns to the modeled checkpoint');
      assert.equal(run.traps.recovering, false, 'the ordinary recovery hold is skipped');
      assert.equal(p.blocked, false, 'movement is available without a separate stun');
      assert.ok(!p.anims.includes(Common.seq('human_death')), 'the normal death animation is skipped');
    } finally {
      run.finish();
    }
  }
});

test('crossbows: the recorded lane (2264,6002) shoots from 2260 to 2246 three tiles a tick', () => {
  const { p, run } = trapFloor(1, 0, [2253, 6018, 2]);
  const statue = run.traps.crossbows.find((c) => c.lanes.some((l) => l.tile.join() === '2264,6002,2'));
  assert.ok(statue);
  const random = Math.random;
  Math.random = () => 0.5;
  trapsTo(run, statue.ready);
  Math.random = random;
  statue.fired = [statue.lanes.find((l) => l.tile.join() === '2264,6002,2')];
  const before = hooks.spawned.length;
  trapsTo(run, statue.ready + 2);
  const bolt = hooks.spawned.slice(before).find((n) => n.id === 9672 && run.area.templateOf(n.getLocation())[1] === 6002);
  assert.ok(bolt, 'a bolt on the lane');
  const path = () => bolt.glides.map(([, to]) => run.area.templateOf(to)[0]);
  assert.deepEqual(path(), [2260]);
  trapsTo(run, statue.ready + 7);
  assert.deepEqual(path(), [2260, 2257, 2254, 2251, 2248, 2246], 'recorded 1862 T19065-T19070');
  trapsTo(run, statue.ready + 8);
  assert.equal(bolt.registered, false, 'deleted the tick after its end');
  run.finish();
});

test("swords: the owl's sword goes out from 5997 to 6007 and back to 5995, the statue thrown meanwhile", () => {
  const { run } = trapFloor(1, 0, [2253, 6018, 2]);
  const owl = run.traps.swords.find((s) => s.at.join() === '2237,5992,2');
  assert.ok(owl);
  const before = hooks.spawned.length;
  trapsTo(run, owl.ready + 2);
  const sword = hooks.spawned.slice(before).find((n) => n.id === 9669 && run.area.templateOf(n.getLocation())[0] === 2237);
  assert.ok(sword, "the owl's sword");
  trapsTo(run, owl.ready + 2 + owl.path.length + 1);
  const ys = sword.glides.map(([, to]) => run.area.templateOf(to)[1]);
  assert.equal(ys[0], 5997, 'recorded add tile (1862 T19029)');
  assert.equal(Math.max(...ys), 6007, 'the far point');
  assert.equal(ys.at(-1), 5995, 'back at the block in front');
  assert.equal(sword.registered, false, 'deleted 2 ticks after it is back');
  run.finish();
});

test('lightning: the recorded floor 4 patch in front of (2496,5837) and a 2-tick stun, no damage', () => {
  const { p, run } = trapFloor(4, 0, [2502, 5838, 2]);
  const statue = run.traps.lightning.find((l) => l.at.join() === '2496,5837,2');
  assert.ok(statue);
  const tiles = statue.tiles.map((t) => t.join()).sort();
  assert.deepEqual(tiles, ['2501,5837,2', '2501,5839,2', '2502,5838,2', '2503,5837,2', '2503,5839,2']);
  trapsTo(run, statue.start + 2);
  assert.ok(p.spam.includes('You are stunned!'));
  assert.equal(p.hits.length, 0);
  assert.equal(p.blocked, true);
  run.finish();
});

test('a ring recovery does not clear an independently active lightning stun', () => {
  const { p, run } = trapFloor(4, 0, [2502, 5838, 2], Common.core.ItemIdentifiers.HALLOWED_RING);
  try {
    const statue = run.traps.lightning.find((l) => l.at.join() === '2496,5837,2');
    assert.ok(statue, 'the cache-backed lightning producer exists');
    trapsTo(run, statue.start + 2);
    assert.equal(run.traps.stunned, true, 'the actual lightning producer stuns');
    assert.equal(p.blocked, true);
    const stunAnimation = p.anims.at(-1);
    // Model a coincident environmental hit at the shared pending-hit consumer.
    run.traps.pendingHit = [1, [2502, 5838, 2]];
    Traps.tick(run);
    assert.equal(run.traps.recovering, false, 'ring recovery completes');
    assert.equal(run.traps.stunned, true, 'the independent stun remains active');
    assert.equal(p.blocked, true, 'the independent stun still blocks movement');
    assert.equal(p.anims.at(-1), stunAnimation, 'the stun animation is not reset');
    for (let i = 0; i < Common.data.traps.lightning.stunTicks + 1; i++) TaskManager.process();
    assert.equal(run.traps.stunned, false, 'the real scheduled stun release runs');
    assert.equal(p.blocked, false, 'movement releases after the independent stun');
  } finally {
    run.finish();
  }
});

test('pads: a forward pad pushes the player on the way they were going, a backward one back', () => {
  const { p, run } = trapFloor(2, 0, [2532, 5984, 2]);
  const pad = run.traps.pads.find((x) => x.forward);
  assert.ok(pad);
  run.traps.lastMove = [0, 0];
  const random = Math.random;
  Math.random = () => 0.99;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    run.traps.prev = [pad.tile[0] - dx, pad.tile[1] - dy, pad.tile[2]];
    p.moveTo(run.area.at(pad.tile));
    run.traps.pendingPad = null;
    pad.last = run.traps.tick + 1;
    Traps.tick(run);
    Traps.tick(run);
    const here = run.area.templateOf(p.getLocation());
    if (here.join() !== pad.tile.join()) {
      assert.ok(Math.sign(here[0] - pad.tile[0]) === dx && Math.sign(here[1] - pad.tile[1]) === dy, `pushed along ${dx},${dy}`);
      Math.random = random;
      run.finish();
      return;
    }
  }
  Math.random = random;
  assert.fail('no direction let the pad push');
});

test('a hit picks the nearest recorded zone, and floor 3 layout B uses the west landing', () => {
  const { run } = trapFloor(3, 1, [2396, 5856, 2]);
  assert.deepEqual(Traps.checkpoint(run, [2400, 5840, 1]), [2398, 5828, 1]);
  run.variant = Common.data.floors[2].variants[0];
  assert.deepEqual(Traps.checkpoint(run, [2400, 5840, 1]), [2402, 5828, 1]);
  assert.deepEqual(Traps.checkpoint(run, [2360, 5900, 2]), run.lastLanding, 'no zone near: the last landing');
  run.finish();
});

test('fire: stepping into a burning blast hits the tick after; a jump onto it does not count as stepping in', () => {
  const { p, run } = trapFloor(1, 0, [2282, 5991, 2]);
  trapsTo(run, 3);
  p.moveTo(run.area.at([2282, 5992, 2]));
  Traps.tick(run);
  assert.equal(p.hits.length, 0, 'not on the tick of the step');
  Traps.tick(run);
  assert.equal(p.hits.length, 1, 'the tick after');
  run.finish();

  const second = trapFloor(1, 0, [2282, 5985, 1]);
  trapsTo(second.run, 3);
  second.p.moveTo(second.run.area.at([2282, 5992, 2]));
  Traps.tick(second.run);
  Traps.tick(second.run);
  assert.equal(second.p.hits.length, 0, 'a plane change is a teleport, not a step through the corridor');
  second.run.finish();
});

test("a trap's hold never carries to the next floor", () => {
  const { p, run } = trapFloor(1, 0, [2282, 5992, 2]);
  trapsTo(run, 4);
  assert.equal(p.blocked, true, 'held while the hit plays out');
  const spec = Common.data.floors[1];
  run.move(spec, spec.variants[0]);
  assert.equal(p.blocked, false);
  assert.equal(run.traps, null, "the old floor's traps are gone");
  run.finish();
});

test('native environmental recovery is faster with the equipped Hallowed ring', async (t) => {
  const path = require('node:path');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { SkillManager } = require('../dist/game/content/skill/SkillManager');
  const core = PluginManager.getCoreApi();
  const oldBots = process.env.DISABLE_PLAYER_BOTS, oldSubmit = core.TaskManager.submit, oldError = console.error;
  const tasks = new Set(), actors = [], ownedRuns = [], ownedAreas = [], ownedNpcs = new Set(), errors = [];
  let started = false;
  process.env.DISABLE_PLAYER_BOTS = '1';
  function observeOwned() {
    for (const run of ownedRuns) if (run.area) {
      for (const npc of run.area.spawned) ownedNpcs.add(npc);
      for (const npc of run.area.getNpcs()) ownedNpcs.add(npc);
    }
  }
  function closeRun(run) {
    if (!run || run.ended) return;
    const area = run.area, player = run.player;
    observeOwned();
    if (area && player.getArea() === area) {
      run.moving = true;
      try {
        if (area.hasMember(player)) area.leave(player, false);
        player.moveTo(Common.toLocation(Common.data.lobby.exitTile));
      } finally { run.moving = false; }
    }
    run.finish();
  }
  t.after(() => {
    try {
      for (const player of actors) {
        const run = Run.runOf(player);
        if (run && !ownedRuns.includes(run)) ownedRuns.push(run);
        if (run?.area && !ownedAreas.includes(run.area)) ownedAreas.push(run.area);
      }
      observeOwned();
      for (const run of ownedRuns) closeRun(run);
      for (const player of actors) if (player.isRegistered()) core.World.getPlayers().removes(player);
      if (started) PluginManager.emitServerShutdown({});
      for (const task of tasks) if (task.isRunning()) task.stop();
      core.World.process();
      assert.ok(ownedRuns.every((run) => run.ended), 'fixture runs ended');
      assert.ok(ownedAreas.every((area) => area.isDestroyed()), 'fixture floor instances destroyed');
      assert.ok([...ownedNpcs].every((npc) => !npc.isRegistered() && !core.World.getAddNPCQueue().includes(npc)), 'fixture trap NPCs removed');
      assert.ok([...tasks].every((task) => !task.isRunning()), 'fixture tasks stopped');
      assert.deepEqual(errors, [], 'native execution and teardown have no hidden errors');
    } finally {
      core.TaskManager.submit = oldSubmit; console.error = oldError;
      if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = oldBots;
    }
  });
  core.TaskManager.submit = function (...args) { if (args[0]) tasks.add(args[0]); return oldSubmit.apply(this, args); };
  console.error = (...args) => { errors.push(args.map(String).join(' ')); return oldError.apply(console, args); };
  const earlierFakeApi = Common.api;
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  assert.notEqual(Common.api, earlierFakeApi, 'real Hallowed plugin registration replaced the legacy fake API');
  PluginManager.emitServerStartup({}); started = true;
  const { World, Item, ItemIdentifiers: I, Equipment, Skill } = core;
  const channel = () => ({ kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function tick() { World.process(); observeOwned(); }
  function actor(name, mode) {
    assert.match(name, /^[a-z0-9]{1,12}$/, 'fixture actor has a legal username');
    const player = new Player(new PlayerSession(channel())); actors.push(player);
    player.setUsername(name); player.setLongUsername(core.Misc.stringToLongBigInt(name));
    player.setAttribute('bot-skip-persistence', true);
    player.setLocation(Common.toLocation(Common.data.lobby.exitTile));
    assert.equal(World.getPlayers().add(player), true, 'real player joins World'); player.needsPlacement = false;
    const agility = Common.data.floors[0].agility, skills = player.getSkillManager();
    skills.setExperience(Skill.AGILITY, SkillManager.getExperienceForLevel(agility));
    skills.setMaxLevel(Skill.AGILITY, agility); skills.setCurrentLevel(Skill.AGILITY, agility, true);
    assert.equal(skills.getCurrentLevel(Skill.AGILITY), agility, 'actor meets the actual floor requirement');
    if (mode === 'equipped') player.getEquipment().setItem(Equipment.RING_SLOT, new Item(I.HALLOWED_RING, 1));
    if (mode === 'inventory') player.getInventory().add(new Item(I.HALLOWED_RING, 1), true);
    if (mode === 'equipped') {
      assert.equal(player.getEquipment().getItems()[Equipment.RING_SLOT].getId(), I.HALLOWED_RING);
      const definition = core.CacheDefinitions.getItem(I.HALLOWED_RING);
      assert.equal(definition.wearPos, Equipment.RING_SLOT, 'active cache assigns the ring slot');
      assert.ok(definition.inventoryActions.includes('Wear'), 'active cache offers Wear');
      assert.equal(definition.placeholderTemplate, -1, 'the native test uses the wearable item');
    }
    return player;
  }
  function trial(name, mode, hp, watchTicks = 0) {
    const player = actor(name, mode);
    player.setHitpoints(hp);
    assert.equal(player.getHitpoints(), hp, 'fixture starts at the intended hitpoints');
    // Direct run start is fixture setup; actual scheduled descent, instance and trap ticks follow.
    const run = Run.start(player, 0); ownedRuns.push(run);
    for (let i = 0; i < 24 && !(run.running && run.traps && run.area); i++) tick();
    assert.ok(run.running && run.traps && run.area, 'real floor and timer start');
    const area = run.area; ownedAreas.push(area);
    assert.equal(run.floorNumber, 1);
    const fire = run.traps.fires.find((entry) => entry.at.join() === '2279,5992,2');
    assert.ok(fire, 'active cache contains the recorded fire statue');
    assert.deepEqual(fire.tiles, [[2281, 5992, 2], [2282, 5992, 2], [2283, 5992, 2]]);
    const animations = [], fadeOpens = [], perform = player.performAnimation.bind(player);
    player.performAnimation = (animation, ...args) => { animations.push(animation.getId()); return perform(animation, ...args); };
    const sender = player.getPacketSender(), sendSub = sender.sendSubInterface.bind(sender);
    sender.sendSubInterface = (...args) => {
      if (args[1] === Common.data.interfaces.fade) fadeOpens.push(args);
      return sendSub(...args);
    };
    const fireTile = [2282, 5992, 2], checkpoint = [2282, 6000, 2];
    player.moveTo(area.at(fireTile));
    const initialRemaining = run.remaining;
    let hit = false;
    for (let i = 0; i < 24; i++) {
      tick();
      if (run.traps.recovering || area.templateOf(player.getLocation()).join() !== fireTile.join()) { hit = true; break; }
    }
    assert.equal(hit, true, 'the real fire producer reaches an environmental hit');
    assert.ok(run.remaining < initialRemaining, 'the real floor timer continues');
    const tookDamage = player.getHitpoints() < hp;
    const recoveryRemaining = run.remaining;
    let releaseTicks = 0;
    while (run.traps.recovering && releaseTicks < 20) { tick(); releaseTicks++; }
    assert.equal(run.traps.recovering, false, 'the recovery hold ends');
    if (releaseTicks) assert.ok(run.remaining < recoveryRemaining, 'timer continues during ordinary recovery');
    assert.equal(player.getMovementQueue().isMovementBlocked(), false, 'the player can move after recovery');
    assert.deepEqual(area.templateOf(player.getLocation()), checkpoint, 'the modeled recorded corridor checkpoint is used');
    assert.equal(run.traps.pendingHit, null); assert.equal(run.traps.pendingPad, null);
    const watchRemaining = run.remaining;
    for (let i = 0; i < watchTicks; i++) tick();
    if (watchTicks) {
      assert.ok(run.remaining < watchRemaining, 'timer continues after the ring return');
      assert.equal(player.getHitpoints(), hp, 'no delayed damage after the ring return');
      assert.deepEqual(area.templateOf(player.getLocation()), checkpoint, 'no stale recovery moves the player');
      assert.equal(player.getMovementQueue().isMovementBlocked(), false, 'no stale recovery blocks movement');
    }
    const result = { tookDamage, hp: player.getHitpoints(), releaseTicks, animations, fadeOpens, remaining: run.remaining };
    closeRun(run);
    return result;
  }
  const normal = trial('hsnormal', 'none', 10);
  assert.equal(normal.tookDamage, true, 'control: an unprotected fire hit deals damage');
  assert.ok(normal.releaseTicks > 0, 'control: ordinary recovery holds movement');
  assert.ok(normal.animations.includes(Common.seq('human_death')), 'control: ordinary recovery uses the death animation');
  assert.ok(normal.fadeOpens.length > 0, 'control: ordinary recovery opens the recorded fade');
  const bag = trial('hsbag', 'inventory', 10);
  assert.equal(bag.tookDamage, true, 'a ring in inventory alone does not protect');
  assert.equal(bag.releaseTicks, normal.releaseTicks, 'inventory-only recovery uses the ordinary sequence');
  const ring = trial('hsring', 'equipped', 1, normal.releaseTicks + 2);
  assert.equal(ring.tookDamage, false, 'equipped ring prevents the hit');
  assert.equal(ring.hp, 1, 'one-hitpoint player survives and returns');
  assert.ok(ring.releaseTicks < normal.releaseTicks, 'equipped ring releases control sooner');
  assert.ok(!ring.animations.includes(Common.seq('human_death')), 'ring recovery does not run the ordinary death animation');
  assert.equal(ring.fadeOpens.length, 0, 'no delayed normal recovery fade opens');
  assert.deepEqual(errors, [], 'real run and trap callbacks do not report hidden errors');
});
