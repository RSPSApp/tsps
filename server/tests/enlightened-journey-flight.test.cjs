// From server/: node --test tests/enlightened-journey-flight.test.cjs (after yarn build).
//
// Enlightened Journey's first flight, Entrana to Taverley, at the balloon controls (the
// "taverley" route, transcribed from the Wiki's Balloon path images): the Wiki's solution lands
// on Taverley's target and moves the quest on, with no route opened or XP; a bail over Entrana
// lands there; a crash loses the logs and keeps the balloon, coming down where the quest's
// transcript says (Entrana, the sea, the woods), with Auguste's words and the plank and dirt
// ways out; a logout at the controls loses the logs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;

const STAGE_KEY = 'quest.enlightened_journey.stage';
const BALLOON_READY = 6;
const LANDED = 7;
const PICCARD_VARBIT = 2868;
const AUGUSTE = core.NpcIdentifiers.AUGUSTE;

let Common, Controls, tasks;
const bus = new Map();
const variants = [];
const objects = {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/world/balloontransport/Common.BalloonTransport');
  Controls = require('../plugins/world/balloontransport/Controls.BalloonTransport');
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      World: { getNpcs: () => [] },
    },
    getWorld: () => ({ getNpcs: () => [] }),
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') event.complete = false;
      for (const fn of bus.get(name) ?? []) fn(event);
    },
    onCustomEvent(name, fn) {
      if (!bus.has(name)) bus.set(name, []);
      bus.get(name).push(fn);
    },
    onNpcDialogueVariant: (fn) => variants.push(fn),
    onObjectInteraction: (name, actions) => { objects[name] = actions; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  require('../plugins/world/balloontransport/Storage.BalloonTransport').attach(api);
  Controls.attach(api);
  require('../plugins/quests/quests/EnlightenedJourney.Quest')(api);
});

beforeEach(() => {
  tasks = [];
});

const loc = (x, y) => new core.Location(x, y, 0);
const xy = (location) => [location.getX(), location.getY()];
const crashSite = (key) => Controls.data().crashSites[key];
const taverley = () => Common.data.stations.find((entry) => entry.key === 'taverley');

function fakePlayer({ stage = BALLOON_READY, logs = 10, stored = 0 } = {}) {
  let tile = loc(2808, 3354);
  const inventory = new Map([[I.LOGS, logs], [I.TINDERBOX, 1]]);
  const equipment = Array.from({ length: 14 }, () => new core.Item(-1, 0));
  const noop = () => {};
  const player = {
    attributes: { [STAGE_KEY]: stage, 'balloon-transport:stored-logs': { logs: stored } },
    varbits: {}, messages: [], chains: [], registered: true, xp: 0,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => player.registered,
    getUsername: () => 'ejflight',
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    sendMessage: (m) => player.messages.push(m),
    getSkillManager: () => ({ addExperience: (skill, amount) => { player.xp += amount; } }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      delete: (id, n) => inventory.set(id, (inventory.get(id) ?? 0) - n),
      deleteNumber: (id, n) => inventory.set(id, (inventory.get(id) ?? 0) - n),
      getItems: () => [...inventory].filter(([, n]) => n > 0).map(([id, n]) => new core.Item(id, n)),
      getFreeSlots: () => 20,
      refreshItems: noop,
    }),
    inventory,
    getEquipment: () => ({ get: (slot) => equipment[slot], getItems: () => equipment }),
    getBanks: () => [],
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
    setInterfaceId: (id) => { if (id === -1) player.down = true; },
    getMovementQueue: () => ({ setBlockMovement() { return this; }, reset() { return this; } }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.chains.push(chain), getCurrent: () => player.chains.at(-1) }),
    getPacketSender: () => new Proxy({
      sendVarbit: (id, v) => { player.varbits[id] = v; },
      sendTypedMessage: (type, line) => player.messages.push(line),
    }, { get: (target, key) => target[key] ?? noop }),
  };
  return player;
}

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    const due = tasks;
    tasks = [];
    for (const task of due) if (task.tick()) tasks.push(task);
  }
}

/** Plays the dialogue started for the player to its end, every line continued: its words. */
function playThrough(player) {
  const words = [];
  for (let next = 0; next < player.chains.length; next++) {
    for (const dialogue of player.chains[next].getDialogues().values()) {
      const text = dialogue.getText?.();
      if (text) words.push((Array.isArray(text) ? text.join(' ') : String(text)).replace(/\s+/g, ' '));
      dialogue.action?.execute?.();
    }
  }
  return words;
}

/** Auguste's "fly" pick (the transcript's open_interface steps); the balloon takes off a tick later. */
function fly(player, stepId = '_G1qps') {
  const event = { player, npcId: AUGUSTE, stepId, handled: false };
  for (const fn of bus.get('npc-dialogue:action')) fn(event);
  assert.equal(atControls(player), false, 'not while the conversation closes');
  tick(1);
  return event;
}

/** Flying the balloon: the flight outlasts the controls until it has set the player down. */
function atControls(player) {
  return Controls.inFlight(player) && !player.down;
}

function press(player, button) {
  const uid = core.CacheDefinitions.getComponentId(`zep_interface_side:${button}`);
  Controls.controlClick({ player, buttonId: uid, groupId: uid >>> 16, childId: uid & 0xffff, handled: false });
}

const MOVES = { S: 'zep_btn_sandbags', L: 'zep_btn_logs', R: 'zep_btn_relax', N: 'zep_btn_tug', E: 'zep_btn_tug_emerg' };

/** Flies "R3 L2 ..." one move per two ticks; stops the moment the balloon is down (no ticks after). */
function flySolution(player, solution) {
  for (const step of solution.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < Number(step.slice(1)); i++) {
      press(player, MOVES[step[0]]);
      if (!atControls(player)) return;
      tick(2);
    }
  }
}

/** The Wiki's Enlightened Journey solution, screen by screen. */
const [FIRST, SECOND, THIRD] = ['S1 L1 R9 E1 R2 N1 R5', 'L1 R1 L1 R10 L1 R5', 'R7 E1 N1 R3 L1 R4 N1'];
/** Straight down: the emergency rope until the balloon hits the ground. */
const DIVE = 'E5';

test("the Wiki's solution lands on Taverley's target: stage 7, Auguste there, no route or XP", () => {
  const player = fakePlayer();
  const event = fly(player);
  assert.equal(event.handled, true);
  assert.equal(atControls(player), true, 'at the controls');
  assert.equal(player.inventory.get(I.LOGS), 0, 'the ten logs on the fire');
  flySolution(player, `${FIRST} | ${SECOND} | ${THIRD}`);
  assert.equal(atControls(player), false);
  assert.equal(player.attributes[STAGE_KEY], BALLOON_READY, 'still in the air until the landing');
  tick(5);
  assert.ok(player.messages.includes('You arrive safely in Taverley.'));
  assert.deepEqual(xy(player.getLocation()), taverley().land);
  assert.equal(player.attributes[STAGE_KEY], LANDED);
  assert.equal(player.varbits[PICCARD_VARBIT], 1, 'Auguste at Taverley');
  assert.equal(player.xp, 0, 'the quest gives its XP at the end');
  assert.equal(Number(player.attributes[Common.ROUTES_ATTRIBUTE]) || 0, 0, 'no route bit');
  tick(3);
  assert.equal(Controls.inFlight(player), false, 'set down');
});

test('the logs come from storage when chosen, from the inventory if storage has too few', () => {
  const stored = fakePlayer({ logs: 0, stored: 12 });
  fly(stored, 'UrzuZs');
  assert.equal(atControls(stored), true);
  assert.equal(stored.inventory.get(I.LOGS), 0, 'no inventory logs required');
  assert.equal(stored.attributes['balloon-transport:stored-logs'].logs, 2);
  Controls.logout({ player: stored });

  const short = fakePlayer({ stored: 3 });
  fly(short, 'RS5ufp');
  assert.equal(atControls(short), true);
  assert.equal(short.inventory.get(I.LOGS), 0);
  assert.equal(short.attributes['balloon-transport:stored-logs'].logs, 3);
  Controls.logout({ player: short });
});

test('no flight before the balloon is ready, after landing, or without the logs', () => {
  for (const player of [fakePlayer({ stage: 5 }), fakePlayer({ stage: LANDED }), fakePlayer({ logs: 9 })]) {
    fly(player);
    assert.equal(atControls(player), false);
  }
});

test('bailing over Entrana lands safely there; the logs are gone and the balloon still waits', () => {
  const player = fakePlayer();
  fly(player);
  flySolution(player, 'S1 L1 R2');
  press(player, 'zep_btn_close');
  assert.ok(player.messages.includes('You bail, but land safely on Entrana.'));
  tick(2);
  assert.deepEqual(xy(player.getLocation()), crashSite('entrana'));
  assert.equal(player.attributes[STAGE_KEY], BALLOON_READY);
  assert.equal(player.inventory.get(I.LOGS), 0);
  assert.equal(player.chains.length, 0, 'no crash talk');
});

test('a crash on the second screen comes down at sea with Auguste; the plank swims back to Entrana', () => {
  const player = fakePlayer();
  fly(player);
  flySolution(player, `${FIRST} | ${DIVE}`);
  assert.equal(atControls(player), false);
  tick(1);
  assert.deepEqual(xy(player.getLocation()), crashSite('ocean'));
  assert.equal(player.chains.length, 0, 'Auguste waits for the fade back in');
  tick(3);
  assert.equal(player.attributes[STAGE_KEY], BALLOON_READY, 'the balloon is kept');
  const words = playThrough(player);
  assert.equal(player.messages.filter((m) => m === 'The balloon crashes.').length, 1, 'said once');
  assert.ok(words.includes('Great Scott! Ocean! Ahhh!'), words.join(' / '));
  assert.ok(words.some((w) => w.includes('Use the plank')));

  player.chains.length = 0;
  const event = { player, objectId: core.ObjectIdentifiers.PLANK_13, clickType: 1 };
  assert.notEqual(objects.Plank.Use(event), false);
  playThrough(player);
  assert.ok(player.messages.includes('You climb onto the plank and swim to shore.'));
  assert.ok(player.messages.includes('You manage to swim back to shore.'));
  assert.deepEqual(xy(player.getLocation()), [2808, 3354], 'ashore on Entrana');
  assert.equal(objects.Plank.Use({ player, objectId: core.ObjectIdentifiers.PLANK, clickType: 1 }), false, 'other planks are left alone');
});

test('a crash on the final screen comes down in the woods; the dirt leads out east of Falador', () => {
  const player = fakePlayer();
  fly(player);
  flySolution(player, `${FIRST} | ${SECOND} | ${DIVE}`);
  tick(4);
  assert.deepEqual(xy(player.getLocation()), crashSite('woods'));
  const words = playThrough(player);
  assert.ok(words.includes("Well, that didn't go as planned."), words.join(' / '));

  player.chains.length = 0;
  assert.notEqual(objects.Dirt.Leave({ player, objectId: core.ObjectIdentifiers.DIRT, clickType: 1 }), false);
  const leaving = playThrough(player);
  assert.ok(player.messages.includes('You walk away from the crash site.'));
  assert.deepEqual(xy(player.getLocation()), crashSite('falador'));
  assert.ok(leaving.some((w) => w.includes("I'm near Falador!")), leaving.join(' / '));
  assert.equal(player.attributes[STAGE_KEY], BALLOON_READY);
});

test("the crash sites' Auguste talks about the crash, not a flight", () => {
  const player = fakePlayer();
  const pick = (npcId) => variants.map((fn) => fn({ npcId, player })).find(Boolean)?.variant;
  assert.equal(pick(core.NpcIdentifiers.AUGUSTE_3), 'getting-ready-for-first-flight-failing-on-the-second-stage');
  assert.equal(pick(core.NpcIdentifiers.AUGUSTE_4), 'getting-ready-for-first-flight-failing-on-the-final-stage');
  assert.equal(pick(AUGUSTE), 'getting-ready-for-first-flight');
});

test('a logout at the controls loses the logs; the balloon still waits on Entrana', () => {
  const player = fakePlayer();
  fly(player);
  flySolution(player, FIRST);
  Controls.logout({ player });
  assert.equal(Controls.inFlight(player), false);
  assert.equal(player.inventory.get(I.LOGS), 0);
  assert.equal(player.attributes[STAGE_KEY], BALLOON_READY);
  assert.deepEqual(xy(player.getLocation()), [2808, 3354]);
});
