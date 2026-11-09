// Run after `yarn build`: node --test tests/hardcore-world.test.cjs
//
// Hardcore Worlds (plugins/modes/HardcoreWorld.plugin.js): the world switch, a character's
// login, its start in Death's Office and the way out, the death broadcast and the death choice.
// The units run against a small fake core with a tick clock; the data's gameval names are checked
// against the real cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { resolveChatHighlights } = require('../dist/net/protocol/ClientProtocol');

const STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hardcore-world-')), 'hardcore-world.json');
process.env.HARDCORE_WORLD_FILE = STORE;

const Common = require('../plugins/modes/hardcoreworld/Common.HardcoreWorld');
const Account = require('../plugins/modes/hardcoreworld/Account.HardcoreWorld');
const Arrival = require('../plugins/modes/hardcoreworld/Arrival.HardcoreWorld');
const Death = require('../plugins/modes/hardcoreworld/Death.HardcoreWorld');
const Choice = require('../plugins/modes/hardcoreworld/Choice.HardcoreWorld');
const DATA = Common.DATA;

/** The cache ids the data names (checked against the real cache below). */
const IDS = {
  varbit: { hc_main: 16684, hc_first_time_leaving_tutorial_island: 16686, hc_died_date: 16687, hc_death_option: 16690, hc_reset_count: 16691 },
  obj: { tob_teleport: 22517, main_tutor_icon_dummy: 22567 },
  interface: { hc_death_choice: 982 },
  component: { 'hc_death_choice:reset_button': (982 << 16) | 15, 'hc_death_choice:transfer_button': (982 << 16) | 7 },
};

let tasks = [];
let events = [];
let prompts = [];
let online = new Map();
let saves = new Map();
let calls = [];
let config = {};
const world = { profile: 'main', type: null };

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    const due = tasks.filter((task) => --task.remaining <= 0);
    tasks = tasks.filter((task) => task.remaining > 0);
    for (const task of due) task.execute();
  }
}

class Task {
  constructor(delay) { this.remaining = delay; }
  stop() {}
}

const persistence = {
  exists: (name, profile) => saves.has(`${profile}:${name}`),
  delete: async (name, profile) => { calls.push(['delete', name, profile]); saves.delete(`${profile}:${name}`); },
  copyProfile: async (name, from, to, reason) => {
    calls.push(['copy', name, from, to, reason]);
    if (saves.has(`${to}:${name}`) || !saves.has(`${from}:${name}`)) return false;
    saves.set(`${to}:${name}`, saves.get(`${from}:${name}`));
    return true;
  },
  flush: async () => {},
};

const handlers = {};
const api = {
  getPluginConfig: (key, fallback) => (key in config ? config[key] : fallback),
  setWorldProfile: (profile) => { world.profile = profile; },
  setWorldType: (type) => { world.type = type; },
  emitCustomEvent: (name, payload) => {
    events.push([name, payload]);
    for (const handler of handlers[name] ?? []) handler(payload);
    if (name === 'league:area-at') payload.name = payload.x >= 3200 && payload.x < 3264 ? 'Misthalin' : payload.x >= 2816 && payload.x < 2880 ? 'Karamja' : null;
  },
  onCustomEvent: (name, handler) => { (handlers[name] ??= []).push(handler); },
  onPlayerLogin: (handler) => { handlers.login = [handler]; },
  onInterfaceActionButton: (ids, handler) => { handlers.button = [handler]; },
  persistAttribute() {},
  sendMultiChatboxPrompt: (player, title, ...pairs) => { prompts.push({ player, title, options: pairs.filter((_, i) => i % 2 === 0), pick: (label) => pairs[pairs.indexOf(label) + 1]() }); },
  core: {
    CacheDefinitions: {
      getVarbitId: (name) => IDS.varbit[name] ?? null,
      getObjId: (name) => IDS.obj[name] ?? null,
      getInterfaceId: (name) => IDS.interface[name] ?? null,
      getComponentId: (name) => IDS.component[name] ?? null,
    },
    Task,
    TaskManager: { submit: (task) => tasks.push(task) },
    World: {
      getPlayers: () => ({ forEach: (fn) => [...online.values()].forEach(fn) }),
      getPlayerByName: (name) => online.get(name) ?? null,
    },
    Location: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
    GameConstants: { PLAYER_PERSISTENCE: persistence },
    MAIN_PROFILE: 'main',
    Accounts: { key: (name) => String(name).toLowerCase() },
    resolveChatHighlights,
  },
};

function player(name = 'Fast Plank', { profile = 'hardcore', combat = 33, transparent = false } = {}) {
  const attributes = new Map();
  const varbits = new Map();
  const messages = [];
  const inventory = [];
  const p = {
    attributes, varbits, messages, inventory, interfaces: [], loggedOut: false,
    getUsername: () => name,
    getDisplayName: () => name,
    getProfile: () => profile,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(text),
    isRegistered: () => !p.loggedOut,
    getSkillManager: () => ({ getCombatLevel: () => combat }),
    getLocation: () => p.location ?? { getX: () => 3222, getY: () => 3218 },
    getInventory: () => ({ adds: (id, amount) => inventory.push([id, amount]), refreshItems() {} }),
    getInterfaceId: () => p.interfaces.at(-1) ?? -1,
    getDialogueManager: () => ({ getCurrent: () => null }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => varbits.set(id, value),
      getVarbit: (id) => (id === 4608 ? (transparent ? 1 : 0) : varbits.get(id) ?? 0),
      sendInterface: (id) => p.interfaces.push(id),
      sendInterfaceRemoval: () => p.interfaces.push(-1),
    }),
    requestLogout: () => { p.loggedOut = true; online.delete(name); },
  };
  online.set(name, p);
  return p;
}

function attachAll() {
  for (const key of Object.keys(handlers)) delete handlers[key];
  Account(api);
  Arrival(api);
  Death(api);
  Choice(api);
}

function said(name) {
  return events.filter(([event]) => event === name).map(([, payload]) => payload);
}

const waitFor = async (check) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
};

beforeEach(() => {
  tasks = []; events = []; prompts = []; online = new Map(); saves = new Map(); calls = [];
  config = { [DATA.config]: true };
  if (fs.existsSync(STORE)) fs.rmSync(STORE);
  Common.resetStoreCache();
  assert.equal(Common.init(api), true);
  attachAll();
});

before(async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

test('every gameval the data names is in the active cache', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  for (const [key, name] of Object.entries(DATA.varbits)) assert.equal(CacheDefinitions.getVarbitId(name), IDS.varbit[name], key);
  for (const [key, name] of Object.entries(DATA.objs)) assert.equal(CacheDefinitions.getObjId(name), IDS.obj[name], key);
  assert.equal(CacheDefinitions.getInterfaceId(DATA.deathChoice.interface), 982);
  assert.equal(CacheDefinitions.getComponentId(DATA.deathChoice.reset), IDS.component[DATA.deathChoice.reset]);
  assert.equal(CacheDefinitions.getComponentId(DATA.deathChoice.transfer), IDS.component[DATA.deathChoice.transfer]);
});

test('the config makes this a Hardcore world: its own profile and world type', () => {
  assert.equal(world.profile, 'hardcore');
  assert.deepEqual(world.type, { label: 'HARDCORE WORLD', flags: 0x800, activity: 'Hardcore World' });
  world.profile = 'main';
  world.type = null;
  config = {};
  assert.equal(Common.init(api), false, 'a plain world');
  assert.equal(world.profile, 'main');
  assert.equal(world.type, null);
  assert.equal(Common.isHardcore(player('Main Guy', { profile: 'main' })), false);
});

test('login: the welcome line, hc_main and the saved state', () => {
  const p = player();
  p.setAttribute(Common.DIED_DATE_ATTRIBUTE, 0);
  fs.writeFileSync(STORE, JSON.stringify({ characters: { 'fast plank': { resets: 2 } } }));
  Common.resetStoreCache();
  handlers.login[0]({ player: p, isNewAccount: false });
  assert.equal(p.varbits.get(16684), 1, 'hc_main');
  assert.equal(p.varbits.get(16691), 2, 'hc_reset_count outlives the resets');
  const greeting = { player: p, worldName: 'Old School RuneScape', text: 'Welcome to Old School RuneScape.' };
  Account.greeting(greeting);
  assert.equal(greeting.text, 'Welcome to Hardcore Old School RuneScape.', 'live');
});

test('a new character designs itself in Death\'s Office, and Death greets it once it is done (no Tutorial Island)', () => {
  const p = player();
  handlers.login[0]({ player: p, isNewAccount: true });
  p.interfaces.push(679); // the new account's character designer mounts after the login
  assert.equal(p.getAttribute(Common.ARRIVAL_ATTRIBUTE), 1);
  assert.equal(p.varbits.get(16686), 1, 'hc_first_time_leaving_tutorial_island');
  tick();
  assert.equal(said('deaths-office:enter').length, 1, 'in the office from the start');
  const greeting = { player: p, context: { login: true }, handled: false };
  for (const handler of handlers['deaths-office:greet']) handler(greeting);
  assert.equal(greeting.handled, true);
  tick(5);
  assert.equal(said('deaths-office:talk').length, 0, 'Death waits while the character is designed');
  for (const handler of handlers['interface:closed']) handler({ player: p, interfaceId: 679 });
  assert.equal(said('deaths-office:talk').length, 1);
  assert.equal(said('deaths-office:talk')[0].steps[0].npc, DATA.death.greeting.npc);
  for (const handler of handlers['interface:closed']) handler({ player: p, interfaceId: 679 });
  assert.equal(said('deaths-office:talk').length, 1, 'once');
});

test('without a designer Death greets as the character reaches him', () => {
  const p = player();
  handlers.login[0]({ player: p, isNewAccount: true });
  tick(3);
  assert.equal(said('deaths-office:enter').length, 1);
  const greeting = { player: p, context: { login: true }, handled: false };
  for (const handler of handlers['deaths-office:greet']) handler(greeting);
  assert.equal(said('deaths-office:talk').length, 1);
});

test('a relog before the start still starts it', () => {
  const p = player();
  p.setAttribute(Common.ARRIVAL_ATTRIBUTE, 1);
  handlers.login[0]({ player: p, isNewAccount: false });
  tick();
  assert.equal(said('deaths-office:enter').length, 1);
});

test('there are no Ironmen on a Hardcore world', () => {
  const p = player();
  for (const name of ['ironman:can-open-setup', 'ironman:change-mode']) {
    const query = { player: p, allowed: true, reason: null };
    for (const handler of handlers[name]) handler(query);
    assert.equal(query.allowed, false, name);
    assert.equal(query.reason, DATA.ours.noIronmen);
  }
  const main = { player: player('Main Guy', { profile: 'main' }), allowed: true };
  for (const handler of handlers['ironman:change-mode']) handler(main);
  assert.equal(main.allowed, true, 'only Hardcore characters');
});

test('with Tutorial Island the start waits for the island to be done', () => {
  handlers['tutorial:availability'] = [(query) => { query.available = true; }];
  const p = player();
  handlers.login[0]({ player: p, isNewAccount: true });
  assert.equal(p.getAttribute(Common.ARRIVAL_ATTRIBUTE), undefined);
  for (const handler of handlers['tutorial:completed']) handler({ player: p });
  tick();
  assert.equal(said('deaths-office:enter').length, 1);
});

test('Death greets a new soul, and his questions', () => {
  const p = player();
  p.setAttribute(Common.ARRIVAL_ATTRIBUTE, 1);
  const login = { player: p, context: { login: true }, handled: false };
  Arrival.greet(login);
  assert.equal(login.handled, true);
  const [arrive] = said('deaths-office:talk');
  assert.deepEqual(arrive.steps.map((step) => step.npc ?? step.text), [DATA.death.greeting.npc, DATA.messages.arrivalGuide]);
  assert.equal(arrive.steps[1].item, 22567, 'the guide box shows the tutor icon, as live');

  events = [];
  Arrival.greet({ player: p, context: { talk: true }, handled: false });
  const [talk] = said('deaths-office:talk');
  assert.deepEqual(talk.steps.map((step) => step.npc ?? step.player), ["Greetings, mortal. I've been expecting you.", 'You have?', 'Indeed... A new soul to partake in my challenge.']);
  talk.then();
  assert.deepEqual(prompts.at(-1).options, Object.values(DATA.death.options), 'live\'s five questions');
  prompts.at(-1).pick(DATA.death.options.more);
  const more = said('deaths-office:talk').at(-1);
  assert.equal(more.steps.length, 1 + DATA.death.more.length);
  more.then();
  assert.equal(prompts.at(-1).options.includes(DATA.death.options.more), false, 'heard, it leaves the menu (live)');

  const collect = { player: p, handled: false };
  for (const handler of handlers['deaths-office:collect']) handler(collect);
  assert.equal(collect.handled, true);
  assert.equal(said('deaths-office:talk').at(-1).steps[0].npc, 'You cannot reclaim anything from me.', 'live');

  const old = player('Old Hand');
  const query = { player: old, context: { talk: true }, handled: false };
  Arrival.greet(query);
  assert.equal(query.handled, false, 'a character past its start gets Death\'s usual words');
});

test('the way out leads to Lumbridge, with the Escape crystal two ticks after landing', () => {
  const p = player();
  p.setAttribute(Common.ARRIVAL_ATTRIBUTE, 1);
  const exit = { player: p, destination: 'entrance' };
  Arrival.exitDestination(exit);
  assert.deepEqual({ ...exit.destination }, { x: 3221, y: 3219, z: 0 });
  Arrival.left({ player: p, destination: exit.destination });
  assert.equal(p.getAttribute(Common.ARRIVAL_ATTRIBUTE), 0);
  assert.equal(p.varbits.get(16686), 0, 'the tick it lands');
  tick();
  assert.equal(p.inventory.length, 0);
  tick();
  assert.deepEqual(p.inventory, [[22517, 1]]);
  assert.deepEqual(p.messages, [DATA.messages.escapeCrystal]);
  assert.equal(said('deaths-office:talk').at(-1).steps[0].text, DATA.messages.welcomeLumbridge);

  const later = { player: p, destination: 'entrance' };
  Arrival.exitDestination(later);
  assert.equal(later.destination, 'entrance', 'only the first time');
});

function hit(damage, npcName = null) {
  const source = npcName ? { isNpc: () => true, getDefinition: () => ({ getName: () => npcName }) } : null;
  return { getDamage: () => damage, getSource: () => source };
}

test('the death broadcast reads as live\'s', () => {
  const p = player();
  const at = (x, y) => ({ getX: () => x, getY: () => y });
  assert.equal(Death.broadcastText(p, hit(10, 'TzHaar-Ket'), at(2840, 3200)), '@mes_hl_ora@TzHaar-Ket killed Fast Plank(33) with a 10 damage hit in Karamja.</col>');
  assert.equal(Death.broadcastText(p, hit(1), at(3222, 3218)), '@mes_hl_ora@Fast Plank(33) was killed by a 1 damage hit in Misthalin.</col>');
  assert.equal(Death.broadcastText(p, hit(1), at(1000, 1000)), '@mes_hl_ora@Fast Plank(33) was killed by a 1 damage hit.</col>', 'no area, no "in"');
});

test('a death that counts is told to everyone, each in their chatbox\'s colours', () => {
  const p = player();
  const reader = player('Reader', { transparent: true });
  p.getCombat = () => ({ getHitQueue: () => ({ getLastAppliedHit: () => hit(4, 'Giant spider') }) });
  for (const handler of handlers['player:died']) handler({ player: p, killer: null, itemsLost: true });
  assert.equal(p.messages[0], '<col=ff9040>Giant spider killed Fast Plank(33) with a 4 damage hit in Misthalin.</col>');
  assert.equal(reader.messages.length, 1);
  assert.equal(p.getAttribute(Common.CHOICE_PENDING_ATTRIBUTE), true);
  assert.ok(p.getAttribute(Common.DIED_DATE_ATTRIBUTE) > 8000, 'days since 27 February 2002');
  assert.equal(said('persistence:save').at(-1).reason, 'hardcore-death');
});

test('a safe death (a minigame) is neither told nor chosen over', () => {
  const p = player();
  for (const handler of handlers['player:died']) handler({ player: p, killer: null, itemsLost: false });
  assert.deepEqual(p.messages, []);
  assert.equal(p.getAttribute(Common.CHOICE_PENDING_ATTRIBUTE), undefined);
  const main = player('Visitor', { profile: 'main' });
  for (const handler of handlers['player:died']) handler({ player: main, killer: null, itemsLost: true });
  assert.deepEqual(main.messages, [], 'only Hardcore characters');
});

test('the choice opens after the death and stays until made; Reset deletes the life', async () => {
  const p = player();
  saves.set('hardcore:Fast Plank', { life: 1 });
  p.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, true);
  Choice.afterDeath(p);
  tick(2);
  assert.equal(p.getInterfaceId(), 982);
  assert.equal(p.varbits.get(16690), 0, 'nothing picked yet');
  p.interfaces.push(-1);
  tick(2);
  assert.equal(p.getInterfaceId(), 982, 'closing it brings it back');

  handlers.button[0]({ player: p, buttonId: (982 << 16) | 15 });
  assert.equal(p.varbits.get(16690), 1, 'Reset highlighted: the client shows its text');
  prompts.at(-1).pick(DATA.ours.chooseAgain);
  assert.equal(p.loggedOut, false);
  handlers.button[0]({ player: p, buttonId: (982 << 16) | 15 });
  prompts.at(-1).pick(DATA.ours.confirmReset);
  assert.equal(p.loggedOut, true);
  assert.equal(p.getAttribute(Common.SKIP_PERSISTENCE_ATTRIBUTE), true, 'the old life is not saved again');
  await waitFor(() => calls.length > 0);
  assert.deepEqual(calls, [['delete', 'Fast Plank', 'hardcore']]);
  Common.resetStoreCache();
  assert.equal(Common.resetCount('Fast Plank'), 1, 'written to the resets file');
});

test('Transfer makes the character the account\'s main one, unless it has one', async () => {
  const p = player();
  saves.set('hardcore:Fast Plank', { life: 1 });
  p.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, true);
  handlers.button[0]({ player: p, buttonId: (982 << 16) | 7 });
  assert.equal(p.varbits.get(16690), 2);
  prompts.at(-1).pick(DATA.ours.confirmTransfer);
  assert.equal(p.loggedOut, true);
  assert.equal(p.getAttribute(Common.CHOICE_PENDING_ATTRIBUTE), false, 'saved with nothing left to choose');
  await waitFor(() => calls.length > 1);
  assert.deepEqual(calls, [['copy', 'Fast Plank', 'hardcore', 'main', 'hardcore-transfer'], ['delete', 'Fast Plank', 'hardcore']]);
  assert.deepEqual(saves.get('main:Fast Plank'), { life: 1 });

  const q = player('Has Main');
  saves.set('main:Has Main', {});
  q.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, true);
  handlers.button[0]({ player: q, buttonId: (982 << 16) | 7 });
  prompts.at(-1).pick(DATA.ours.confirmTransfer);
  assert.equal(q.loggedOut, false);
  assert.deepEqual(q.messages, [DATA.ours.transferTaken]);
});

test('a choice left unmade is asked again at the next login', () => {
  const p = player();
  p.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, true);
  p.setAttribute(Common.DEATH_OPTION_ATTRIBUTE, 2);
  handlers.login[0]({ player: p, isNewAccount: false });
  tick(2);
  assert.equal(p.getInterfaceId(), 982);
  assert.equal(p.varbits.get(16690), 2, 'as it was left');
});

test('a Hardcore world respawns in Death\'s Office, where Death waits on the choice', () => {
  const p = player();
  const respawn = { player: p, killer: null, handled: false };
  for (const handler of handlers['player:respawn']) handler(respawn);
  assert.equal(respawn.handled, true);
  assert.equal(said('deaths-office:enter').length, 1);
  p.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, true);
  const greeting = { player: p, context: { login: true }, handled: false };
  for (const handler of handlers['deaths-office:greet']) handler(greeting);
  assert.equal(greeting.handled, true);
  assert.equal(said('deaths-office:talk').length, 0, 'Death says nothing over the choice');
  const taken = { player: player('Quest Guy'), handled: true };
  for (const handler of handlers['player:respawn']) handler(taken);
  assert.equal(said('deaths-office:enter').length, 1, 'a respawn another plugin took is left alone');
});

test('the choice opens the tick after the respawn and the world waits for it', () => {
  const p = player();
  p.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, true);
  Choice.afterDeath(p);
  tick();
  assert.equal(p.getInterfaceId(), 982);
  const walk = { player: p, packet: { type: 'move' }, handled: false };
  for (const handler of handlers['player:world-input']) handler(walk);
  assert.equal(walk.handled, true, 'no walking off before choosing');
  const other = { player: player('Alive'), packet: { type: 'move' }, handled: false };
  for (const handler of handlers['player:world-input']) handler(other);
  assert.equal(other.handled, false);
});

test('no presets and no PvP bots on a Hardcore world', () => {
  const presets = { player: player(), allow: true, message: null };
  for (const handler of handlers['presets:can-use']) handler(presets);
  assert.equal(presets.allow, false);
  assert.equal(presets.message, DATA.ours.noPresets);
  const bots = { allowed: true };
  for (const handler of handlers['bots:pvp-allowed']) handler(bots);
  assert.equal(bots.allowed, false);
});
