// Run after `yarn build`: node --test tests/forestry-members.test.cjs
//
// Forestry's members events against the rsprox recordings (and the Wiki for rewards): Pheasant
// Control, Poachers and the Enchantment Ritual.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Spawns, Pheasant, Poachers, Ritual, hooks, core;

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  core = PluginManager.getCoreApi();
  hooks = { objects: new Map(), npcs: new Map(), prompts: [] };
  const api = {
    core,
    persistAttribute() {},
    onNpcDialogueVariant() {},
    onNpcDialogueCondition() {},
    onItemOnNpc() {},
    onObjectInteraction: (name, actions) => { if (typeof name !== 'function') for (const [op, fn] of Object.entries(actions)) hooks.objects.set(`${name}:${op}`, fn); },
    onNpcInteraction: (name, actions) => { if (typeof name !== 'function') for (const [op, fn] of Object.entries(actions)) hooks.npcs.set(`${name}:${op}`, fn); },
    onCustomEvent() {},
    onPlayerLogout() {},
    onPlayerLogin() {},
    emitCustomEvent() {},
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push(args),
  };
  const Woodcutting = require('../plugins/skills/Woodcutting.plugin');
  Woodcutting.isWoodcuttingActive = () => false;
  Woodcutting.stopWoodcutting = () => {};
  require('../plugins/minigames/Forestry.plugin').register(api);
  require('../plugins/minigames/ForestryMembers.plugin').register(api);
  Spawns = require('../plugins/minigames/forestry/Spawns.Forestry');
  Pheasant = require('../plugins/minigames/forestry/Pheasant.Forestry');
  Poachers = require('../plugins/minigames/forestry/Poachers.Forestry');
  Ritual = require('../plugins/minigames/forestry/Ritual.Forestry');
});

let random;
beforeEach(() => {
  random = Math.random;
  ticks(260);
  for (const event of [...Spawns.active]) Spawns.active.delete(event);
  Spawns.quiet.length = 0;
  hooks.prompts.length = 0;
});

function container() {
  const slots = [];
  return {
    slots,
    add(item) { const slot = slots.find((s) => s.id === item.getId()); if (slot) slot.amount += item.getAmount(); else slots.push({ id: item.getId(), amount: item.getAmount() }); },
    delete(id, amount = 1) { const slot = slots.find((s) => s.id === id && s.amount > 0); if (slot) slot.amount -= amount; },
    contains: (id) => slots.some((s) => s.id === id && s.amount > 0),
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getFreeSlots: () => 20,
    getAddableAmount: (item) => item.getAmount(),
    full() {},
  };
}

let index = 0;
function fakePlayer({ at = new Location(3085, 3233, 0), level = 70 } = {}) {
  const id = ++index;
  const timers = new Map();
  const p = {
    location: at, messages: [], spam: [], sounds: [], anims: [], xp: {}, chats: [], graphics: [], inventory: container(),
    getIndex: () => id, getUsername: () => `Tester${id}`, getDisplayName: () => `Tester${id}`, isPlayer: () => true, isRegistered: () => true,
    getLocation: () => p.location,
    getAttribute: () => null, setAttribute() {},
    getInventory: () => p.inventory,
    getEquipment: () => ({ contains: () => false }),
    sendMessage: (m) => p.messages.push(m),
    performAnimation: (a) => p.anims.push(a.getId()),
    performGraphic: (g) => p.graphics.push(g.getId()),
    setPositionToFace() {},
    getMovementQueue: () => ({ reset() {} }),
    getTimers: () => ({ registers: (key, ticks) => timers.set(key, ticks), has: (key) => (timers.get(key) ?? 0) > 0 }),
    unstun: () => timers.clear(),
    getSkillManager: () => ({
      addExperience: (skill, amount) => { const n = String(skill.getName?.() ?? skill); p.xp[n] = (p.xp[n] ?? 0) + amount; },
      getCurrentLevel: () => level, getMaxLevel: () => level,
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.chats.push(chain), reset() {} }),
    getPacketSender() {
      const sender = {
        sendTypedMessage: (type, text) => { p.spam.push(text); return sender; },
        sendSoundEffect: (id) => { p.sounds.push(id); return sender; },
        sendAreaSound: () => sender, sendGraphic: () => sender, sendObjectAnimation: () => sender,
      };
      return sender;
    },
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

const WILLOW = { id: 10833, x: 3083, y: 3237 };
function startEvent(kind, players) {
  const object = new core.GameObject(WILLOW.id, new Location(WILLOW.x, WILLOW.y, 0), 10, 0, null);
  return Spawns.spawn({ object, location: object.getLocation().clone(), name: 'Willow tree', size: 2 }, players, kind);
}

const bark = (p) => p.inventory.getAmount(28134);
const xp = (p, skill) => p.xp[skill] ?? p.xp[skill.toUpperCase()] ?? 0;
const lines = (chain) => [...chain.dialogues.values()].map((d) => d.text).filter(Boolean);

// ------------------------------------------------------------------ pheasant control

function retrieve(player, nest) {
  return hooks.objects.get('Pheasant Nest:Retrieve-egg')({ player, object: nest.object });
}

test('pheasants: the forester, three birds on four nests; the egg the tick after the reach, one at a time', () => {
  const p = fakePlayer();
  const event = startEvent('pheasant', [p]);
  assert.equal(event.forester.getId(), 12536);
  assert.equal(event.nests.length, 4);
  assert.equal(event.pheasants.length, 3);
  assert.equal(event.nests.filter((n) => n.occupied).length, 3);
  const empty = event.nests.find((n) => !n.occupied);
  assert.equal(empty.object.getId(), 49937);
  Math.random = () => 0.9;
  retrieve(p, empty);
  assert.deepEqual(p.anims.slice(-1), [827]);
  assert.equal(p.inventory.getAmount(28661), 0, 'the reach first');
  ticks(1);
  Math.random = random;
  assert.equal(p.inventory.getAmount(28661), 1);
  assert.equal(p.spam.at(-1), 'You collect a pheasant egg.');
  assert.deepEqual(p.sounds, [7542]);
  retrieve(p, empty);
  assert.equal(p.messages.at(-1), 'You should hand in the egg you have before collecting another.');
});

test('the occupied nest attacks the tick after the reach: block, stun graphic, sounds, then "stunned" (spam)', () => {
  const p = fakePlayer();
  const event = startEvent('pheasant', [p]);
  const occupied = event.nests.find((n) => n.occupied);
  retrieve(p, occupied);
  ticks(1);
  assert.equal(p.messages.at(-1), "The nest's inhabitant attacks you.");
  assert.deepEqual(p.anims.slice(-1), [397]);
  assert.deepEqual(p.graphics, [245]);
  assert.deepEqual(p.sounds, [2727, 2727]);
  ticks(1);
  assert.equal(p.spam.at(-1), "You've been stunned!");
  retrieve(p, event.nests.find((n) => !n.occupied));
  ticks(1);
  assert.equal(p.spam.at(-1), "You're stunned!");
  assert.equal(p.inventory.getAmount(28661), 0, 'nothing while stunned');
});

test('a pheasant flies to the empty nest every 8 or 12 ticks; an egg taken mid-flight is lost when it lands', () => {
  const p = fakePlayer();
  const event = startEvent('pheasant', [p]);
  const empty = event.nests.find((n) => !n.occupied);
  ticks(8);
  assert.equal(empty.incoming, true, 'a pheasant is on its way');
  retrieve(p, empty);
  ticks(1);
  assert.equal(p.inventory.getAmount(28661), 1);
  ticks(1);
  assert.equal(empty.occupied, true);
  assert.equal(p.messages.at(-1), "The nest's inhabitant attacks you, causing you to drop all your pheasant eggs.");
  assert.equal(p.inventory.getAmount(28661), 0);
  assert.equal(event.nests.filter((n) => n.occupied).length, 3);
});

test('the hand-in pays bark and XP; ineligible pays 1 XP; the end at 200 ticks', () => {
  const p = fakePlayer({ level: 80 });
  const late = fakePlayer();
  const event = startEvent('pheasant', [p]);
  for (const player of [p, late]) {
    player.inventory.add(new core.Item(28661, 1));
    event.eggTakers.add(player);
    hooks.npcs.get('Freaky Forester:Talk-to')({ player, npc: event.forester });
    assert.deepEqual(lines(player.chats.at(-1)), ['I have an egg for you.']);
    assert.equal(player.inventory.getAmount(28661), 0);
  }
  assert.ok(bark(p) === 8 || bark(p) === 9);
  assert.ok(xp(p, 'Woodcutting') >= 80 && xp(p, 'Woodcutting') <= 96);
  assert.equal(xp(p, 'Thieving'), 40);
  assert.equal(bark(late), 0);
  assert.equal(xp(late, 'Woodcutting'), 1);

  hooks.npcs.get('Freaky Forester:Talk-to')({ player: p, npc: event.forester });
  assert.deepEqual(lines(p.chats.at(-1)), ["Hello, what's going on?", `Hey, ${p.getUsername()}, can you help me with some pheasants?`]);
  ticks(199);
  assert.equal(Pheasant.events.has(event), true);
  ticks(1);
  assert.equal(Pheasant.events.has(event), false);
  assert.equal(Spawns.active.has(event), false);
});

// ------------------------------------------------------------------ poachers

const disarm = (player, trap) => hooks.npcs.get('<col=00ffff>Fox trap</col>:Disarm')({ player, npc: trap.npc });

/** Records the area sounds and tile graphics the units send (fake players aren't in the World). */
function recordEffects() {
  const Common = require('../plugins/minigames/forestry/Common.Forestry');
  const { areaSound, tileGraphic } = Common;
  const log = { area: [], tile: [] };
  Common.areaSound = (at, id, radius = 10, delay = 0) => log.area.push({ at: at.clone(), id, radius, delay });
  Common.tileGraphic = (at, id) => log.tile.push({ at: at.clone(), id });
  log.restore = () => Object.assign(Common, { areaSound, tileGraphic });
  return log;
}

/** The fox walks onto the trap (npcs don't move in this harness). */
const foxOnto = (event, trap) => event.fox.setLocation(trap.at.clone());

test('poachers: spawn sounds; a trap 2 ticks after the arm seq, on the poacher\'s tile, with map_anim 2343 and sound 2386', () => {
  const effects = recordEffects();
  try {
    const p = fakePlayer({ level: 70 });
    Math.random = () => 0;
    const event = startEvent('poachers', [p]);
    Math.random = random;
    assert.equal(event.fox.getId(), 12559);
    assert.deepEqual(event.poachers.map((n) => n.getId()), [12553, 12554, 12555]);
    assert.deepEqual(effects.area.filter((s) => s.at.equals(event.fox.getLocation())).map((s) => [s.id, s.radius]), [[1930, 5], [7530, 5]]);
    for (const npc of event.poachers) {
      assert.deepEqual(effects.area.filter((s) => s.at.equals(npc.getLocation())).map((s) => [s.id, s.delay]), [[1930, 0], [7540, 25]]);
    }
    ticks(4);
    assert.equal(event.set, 1, 'the first trap is armed 4-8 ticks in');
    assert.equal(event.poachers.filter((npc) => npc.getAnimation().getId() === 10554).length, 1, 'with the arm seq');
    assert.equal(event.traps.size, 0, 'not yet down');
    ticks(1);
    assert.equal(event.traps.size, 0);
    ticks(1);
    assert.equal(event.traps.size, 1);
    const [trap] = event.traps;
    assert.ok(event.poachers.some((npc) => npc.getLocation().equals(trap.at)), "on a poacher's tile");
    assert.deepEqual(effects.tile.filter((g) => g.at.equals(trap.at)).map((g) => g.id), [2343]);
    assert.deepEqual(effects.area.filter((s) => s.at.equals(trap.at) && s.id === 2386).map((s) => s.radius), [7]);
  } finally {
    effects.restore();
  }
});

test('Disarm takes 9 ticks: synth 2387 at the start and end, the trap seq and a complaint a tick before, the end line as spam', () => {
  const p = fakePlayer({ level: 70 });
  Math.random = () => 0;
  const event = startEvent('poachers', [p]);
  ticks(6);
  Math.random = random;
  const [trap] = event.traps;
  disarm(p, trap);
  assert.equal(p.spam.at(-1), 'You start disarming the trap...');
  assert.equal(p.anims.at(-1), 10551);
  assert.deepEqual(p.sounds, [2387]);
  foxOnto(event, trap);
  ticks(7);
  assert.equal(event.traps.has(trap), true, "the fox on it doesn't spring it while it's disarmed");
  ticks(1);
  assert.equal(trap.npc.getAnimation().getId(), 10557);
  assert.ok(['Oi, leave those traps alone!', "Hey, don't touch that!", "Hey, you're not a fox!"].some((line) => event.poachers.some((npc) => npc.getForcedChat() === line)), 'a poacher grumbles');
  assert.equal(event.traps.has(trap), true);
  assert.equal(p.spam.includes('You successfully disarm the trap.'), false);
  ticks(1);
  assert.equal(event.traps.has(trap), false);
  assert.equal(p.spam.at(-1), 'You successfully disarm the trap.');
  assert.equal(p.messages.includes('You successfully disarm the trap.'), false, 'spam, not a game message');
  assert.equal(p.anims.at(-1), 10552);
  assert.deepEqual(p.sounds, [2387, 2387]);
  ticks(1);
  assert.equal(bark(p), 11);
  assert.equal(xp(p, 'Woodcutting'), 105);
  assert.equal(xp(p, 'Hunter'), 35);
});

test('a trap springs when the fox has stood on it 2 ticks: sounds 7541 and 2387 a tick later, gone after 2', () => {
  const effects = recordEffects();
  try {
    const p = fakePlayer();
    Math.random = () => 0;
    const event = startEvent('poachers', [p]);
    ticks(6);
    Math.random = random;
    const [trap] = event.traps;
    ticks(10);
    assert.equal(event.traps.has(trap), true, 'no timer: it waits for the fox');
    foxOnto(event, trap);
    effects.area.length = 0;
    ticks(2);
    assert.equal(event.traps.has(trap), true);
    ticks(1);
    assert.equal(event.traps.has(trap), false, 'sprung');
    assert.equal(trap.npc.getAnimation().getId(), 10556);
    assert.equal(event.fox.getAnimation().getId(), 6569);
    assert.ok(event.foxHp === 66 || event.foxHp === 67);
    const at = () => effects.area.filter((s) => s.at.equals(trap.at)).map((s) => [s.id, s.radius]);
    assert.deepEqual(at(), []);
    ticks(1);
    assert.deepEqual(at(), [[7541, 10], [2387, 10]]);
  } finally {
    effects.restore();
  }
});

test('left alone, three sprung traps lose the fox', () => {
  const p = fakePlayer();
  const event = startEvent('poachers', [p]);
  for (let i = 0; i < 200 && Poachers.events.has(event); i++) {
    const [oldest] = event.traps;
    if (oldest) foxOnto(event, oldest);
    ticks(1);
  }
  assert.equal(Poachers.events.has(event), false);
  assert.ok(event.foxHp <= 0, 'lost before the end');
  assert.equal(p.messages.at(-1), "<col=ff3045>Unfortunately you weren't able to save the fox from the poachers...</col>");
});

test('saving the fox: synth 7531 and the line, the gift a tick later for a disarmer who was there; none for a late one', () => {
  const effects = recordEffects();
  try {
    const p = fakePlayer({ level: 99 });
    const late = fakePlayer();
    const event = startEvent('poachers', [p]);
    let turn = 0;
    for (let i = 0; i < 200 && Poachers.events.has(event); i++) {
      for (const trap of event.traps) {
        if (!trap.disarming && ![...Poachers.sessions.keys()].some((pl) => Poachers.sessions.get(pl).event === event && pl === (turn % 2 ? late : p))) {
          disarm(turn++ % 2 ? late : p, trap);
        }
      }
      const [oldest] = event.traps;
      if (oldest) foxOnto(event, oldest);
      ticks(1);
    }
    assert.ok(event.foxHp > 0);
    assert.ok(p.messages.includes("<col=3366ff>Well done, you've saved the fox from the poachers! The fox has left you a gift...</col>"));
    assert.equal(p.sounds.at(-1), 7531);
    assert.ok(!p.messages.includes("You've been awarded <col=3366ff>160 Anima-infused bark</col>."), 'the lump comes a tick later');
    assert.deepEqual(effects.area.filter((s) => s.at.equals(event.site.location)).map((s) => [s.id, s.radius, s.delay]), [[7538, 7, 0], [2386, 7, 50]]);
    assert.deepEqual(effects.tile.filter((g) => g.id === 2369).length, 1);
    ticks(1);
    assert.ok(p.messages.includes("You've been awarded <col=3366ff>160 Anima-infused bark</col>."));
    assert.ok(late.messages.includes("<col=3366ff>Well done, you've saved the fox from the poachers!</col>"));
    assert.equal(bark(late), 0);
  } finally {
    effects.restore();
  }
});

// ------------------------------------------------------------------ enchantment ritual

test('the circles: exactly one whose colour and shape are both unique', () => {
  for (let i = 0; i < 50; i++) {
    const { odd, others } = Ritual.pickCircles();
    const all = [odd, ...others];
    const unique = all.filter(([c, s]) => all.filter(([c2]) => c2 === c).length === 1 && all.filter(([, s2]) => s2 === s).length === 1);
    assert.deepEqual(unique, [odd]);
  }
});

const SPOTANIMS = [[2583, 2584, 2585, 2586], [2587, 2588, 2589, 2590], [2591, 2592, 2593, 2594], [2595, 2596, 2597, 2598]];
const fill = (npc) => npc.getHeadbars().find((bar) => bar.id === 17)?.fill;

test('the ritual: stand on the odd circle as the step closes; eight steps, then the gift', () => {
  const effects = recordEffects();
  try {
    const p = fakePlayer({ level: 80 });
    const event = startEvent('ritual', [p]);
    assert.equal(event.dryad.getId(), 12519);
    assert.equal(event.circles.length, 5);
    assert.deepEqual(effects.area.map((s) => [s.id, s.radius]), [[7540, 5], [7549, 5]], 'at the Dryad, then the circles');
    assert.ok(effects.area[0].at.equals(event.dryad.getLocation()));
    assert.ok(effects.area[1].at.equals(event.site.location), 'the circles sound at the tree');
    const fills = [];
    for (let step = 0; step < 8; step++) {
      assert.deepEqual(effects.tile.map((g) => g.id).sort(), event.circles.map((c) => SPOTANIMS[c.shape][c.colour]).sort(), "each circle's spotanim");
      effects.tile.length = 0;
      ticks(5);
      assert.equal(fill(event.dryad), [0, 8, 15, 23, 30, 37, 45, 52][step], 'resent every 5 ticks');
      ticks(15);
      const odd = event.odd;
      p.location = odd.at.clone();
      ticks(7);
      assert.equal(event.steps.get(p), step + 1);
      assert.equal(p.graphics.at(-1), SPOTANIMS[odd.shape][odd.colour]);
      assert.equal(p.sounds.at(-1), 7535);
      fills.push(fill(event.dryad));
      ticks(3);
    }
    assert.deepEqual(fills, [8, 15, 23, 30, 37, 45, 52, 60]);
    assert.equal(Ritual.events.has(event), false);
    assert.equal(p.sounds.at(-1), 7531);
    assert.deepEqual(effects.area.filter((s) => s.at.equals(event.dryad.getLocation())).map((s) => s.id), [7540, 7540], 'as she comes and as she goes');
  } finally {
    effects.restore();
  }
});

test('the ritual end pays the gift', () => {
  const p = fakePlayer({ level: 80 });
  const event = startEvent('ritual', [p]);
  for (let step = 0; step < 8; step++) {
    ticks(20);
    p.location = event.odd.at.clone();
    ticks(10);
  }
  assert.equal(Ritual.events.has(event), false);
  assert.ok(p.messages.includes('<col=3366ff>Well done, you completed 8 steps of the ritual! The Dryad has left you a gift...</col>'));
  assert.ok(p.messages.includes("You've been awarded <col=3366ff>143 Anima-infused bark</col>."));
  assert.ok(bark(p) >= 143 + 8 * 20);
  assert.equal(Math.round(xp(p, 'Woodcutting')), 8 * (2 * 80 + 60) + (2 * 8 * 80 + 55));
});

test('Talk-to: chatquiz1 / chathap2 heads; "Sure, How can I help?" goes straight to her explanation', () => {
  const p = fakePlayer();
  const event = startEvent('ritual', [p]);
  hooks.npcs.get('Dryad:Talk-to')({ player: p, npc: event.dryad });
  const chain = p.chats.at(-1);
  assert.deepEqual(lines(chain), ["Hello, what's going on?", 'Greetings, I am trying to rejuvenate the forests with a ritual. Would you like to help?']);
  assert.deepEqual([...chain.dialogues.values()].filter((d) => d.text).map((d) => d.expression), [554, 568]);
  const end = [...chain.dialogues.values()].at(-1);
  end.action.execute();
  const [, , yes, sure] = hooks.prompts.at(-1);
  assert.equal(yes, 'Sure, How can I help?');
  sure();
  assert.deepEqual(lines(p.chats.at(-1)), ['If you could help block the odd ritual circles by standing on them, I will be able to power up the ritual.']);
  assert.deepEqual([...p.chats.at(-1).dialogues.values()].filter((d) => d.text).map((d) => d.expression), [568]);
});

test('off the odd circle, a step is missed', () => {
  const p = fakePlayer();
  const event = startEvent('ritual', [p]);
  const wrong = event.circles.find((c) => c !== event.odd);
  p.location = wrong.at.clone();
  ticks(27);
  assert.equal(event.steps.get(p) ?? 0, 0);
  assert.equal(bark(p), 0);
});

// ------------------------------------------------------------------ review fixes

test("switching traps mid-disarm frees the first to spring", () => {
  const p = fakePlayer();
  // Pinned rolls: traps down at ticks 6 and 18, and no fox on them, so two stand at tick 24.
  Math.random = () => 0;
  const event = startEvent('poachers', [p]);
  ticks(24);
  Math.random = random;
  assert.equal(event.traps.size, 2);
  const [a, b] = event.traps;
  disarm(p, a);
  disarm(p, b);
  assert.equal(a.disarming, false);
  assert.equal(b.disarming, true);
  const other = fakePlayer();
  disarm(other, a);
  assert.equal(Poachers.sessions.get(other).trap, a, 'someone else can take it on');
});

test("an egg from another pheasant event isn't taken", () => {
  const p = fakePlayer();
  const event = startEvent('pheasant', [p]);
  p.inventory.add(new core.Item(28661, 1));
  hooks.npcs.get('Freaky Forester:Talk-to')({ player: p, npc: event.forester });
  assert.equal(p.inventory.getAmount(28661), 1, 'kept: not one of these nests');
  assert.equal(bark(p), 0);
});

test("a ritual that can't place its circles ends instead of wedging", () => {
  const p = fakePlayer();
  const event = startEvent('ritual', [p]);
  const Common = require('../plugins/minigames/forestry/Common.Forestry');
  const freeTiles = Common.freeTiles;
  Common.freeTiles = () => [];
  ticks(30);
  Common.freeTiles = freeTiles;
  assert.equal(Ritual.events.has(event), false);
  assert.equal(Spawns.active.has(event), false);
});
