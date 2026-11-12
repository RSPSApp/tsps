// Run after `yarn build`: node --test tests/escape-crystal.test.cjs
//
// The escape crystal outside the two raids (plugins/items/EscapeCrystal.plugin.js): Teleport, Auto-afk
// and the ring of life firing on a hit, the activities that take the player out, the Wilderness up to
// level 30, a Hardcore World's "anywhere" and cleanse, and the line live says.
const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const Common = require('../plugins/items/escapecrystal/Common.EscapeCrystal');
const Activation = require('../plugins/items/escapecrystal/Activation.EscapeCrystal');
const HardcoreCrystal = require('../plugins/modes/hardcoreworld/EscapeCrystal.HardcoreWorld');
const HardcoreCommon = require('../plugins/modes/hardcoreworld/Common.HardcoreWorld');

const CRYSTAL = 22517;
const RING_SLOT = 12;
const SAVED = 'Your escape crystal saves you and is destroyed in the process.';

let handlers = {};
let events = [];
let cycle = 100;
let wildernessLevel = 0;
let teleportAllowed = true;

const api = {
  core: {
    CacheDefinitions: { getObjId: (name) => (name === 'tob_teleport' ? CRYSTAL : null) },
    Equipment: { RING_SLOT },
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } getId() { return this.id; } getAmount() { return this.amount; } },
    World: { getProcessCycle: () => cycle },
    Skill: { HITPOINTS: 3 },
    Wilderness: { isInLocation: () => wildernessLevel > 0, levelAt: () => wildernessLevel },
    TeleportHandler: { checkReqs: () => teleportAllowed, confirm: (player, destination, go, level, { item } = {}) => go(item) },
    GameConstants: { DEFAULT_LOCATION: { clone: () => ({ spawn: true }) } },
  },
  emitCustomEvent: (name, payload) => {
    events.push([name, payload]);
    for (const handler of handlers[name] ?? []) handler(payload);
  },
  onCustomEvent: (name, handler) => { (handlers[name] ??= []).push(handler); },
  onPlayerLogin() {},
  onItemAction() {},
};

function player({ crystals = 1, worn = false, hitpoints = 99, max = 99, moving = false, profile = 'main' } = {}) {
  let count = crystals;
  let ring = worn ? { getId: () => CRYSTAL, getAmount: () => 1, setAmount() {} } : null;
  const p = {
    messages: [], moved: null, poison: 6, venomed: true, lastInputCycle: cycle,
    getLocation: () => ({ getX: () => 3100, getY: () => 3600 }),
    getInventory: () => ({ contains: (id) => id === CRYSTAL && count > 0, delete: (id, n) => { count -= n; }, getAmount: () => count }),
    getEquipment: () => ({ getItems: () => { const items = []; items[RING_SLOT] = ring; return items; }, setItem: () => { ring = null; }, refreshItems() {} }),
    getMovementQueue: () => ({ isMovings: () => moving, reset() {} }),
    getSkillManager: () => ({ getMaxLevel: () => max }),
    getHitpoints: () => hitpoints,
    getProfile: () => profile,
    getAttribute: () => undefined,
    isPlayer: () => true,
    sendMessage: (text) => p.messages.push(text),
    moveTo: (to) => { p.moved = to; },
    setPoisonDamage: (n) => { p.poison = n; },
    setVenomed: (v) => { p.venomed = v; },
    crystals: () => count,
    wearing: () => !!ring,
  };
  p.getAsPlayer = () => p;
  return p;
}

function settings(values) {
  handlers['escape-crystal:settings'] = [(request) => Object.assign(request, values)];
}

beforeEach(() => {
  handlers = {}; events = []; cycle = 100; wildernessLevel = 0; teleportAllowed = true;
  Common.bind(api);
  Activation(api);
});

const said = (name) => events.filter(([event]) => event === name).map(([, payload]) => payload);

test('an activity takes the player out its own way; the crystal is used up with live\'s line', () => {
  handlers['escape-crystal:escape'] = [(request) => { request.handled = true; request.escaped = true; }];
  const p = player();
  assert.equal(Activation.teleport({ player: p }), true);
  assert.equal(p.crystals(), 0);
  assert.deepEqual(p.messages, [SAVED]);
  assert.equal(said('escape-crystal:escaped')[0].cause, 'teleport');
  assert.equal(p.moved, null, 'the activity moved them, not the crystal');
});

test('the Theatre of Blood and the Tombs of Amascut keep their own crystals', () => {
  handlers['escape-crystal:claimed'] = [(query) => { query.claimed = true; }];
  const p = player();
  assert.equal(Activation.teleport({ player: p }), false, 'falls through to the raid\'s own Teleport');
  assert.equal(p.crystals(), 1);
});

test('outside the activities: the Wilderness up to level 30, to the respawn point', () => {
  const p = player();
  Activation.teleport({ player: p });
  assert.deepEqual(p.messages, [Activation.NOT_HERE], 'in town, on a normal world');
  wildernessLevel = 31;
  Activation.teleport({ player: p });
  assert.equal(p.crystals(), 1, 'too deep');
  wildernessLevel = 30;
  Activation.teleport({ player: p });
  assert.equal(p.crystals(), 0);
  assert.deepEqual(p.moved, { spawn: true }, 'no respawn policy: the world\'s spawn');
  assert.equal(p.messages.at(-1), SAVED);
  assert.equal(said('player:respawn')[0].escape, true);
});

test('a respawn policy (a Hardcore World\'s Death\'s Office) takes the crystal\'s player too', () => {
  wildernessLevel = 5;
  handlers['player:respawn'] = [(event) => { event.handled = true; }];
  const p = player();
  Activation.teleport({ player: p });
  assert.equal(p.moved, null);
  assert.equal(p.crystals(), 0);
});

test('a teleport the rules refuse (teleblock, an area) keeps the crystal', () => {
  wildernessLevel = 5;
  teleportAllowed = false;
  const p = player();
  Activation.teleport({ player: p });
  assert.equal(p.crystals(), 1);
  assert.deepEqual(p.messages, []);
});

test('worn, it must come off to teleport', () => {
  const p = player({ crystals: 0, worn: true });
  Activation.teleport({ player: p });
  assert.deepEqual(p.messages, ['You need to take the crystal off to teleport with it.']);
});

test('Auto-afk fires on a hit once idle past its timer, never while moving; the hit is spared', () => {
  wildernessLevel = 10;
  settings({ afk: true, delay: 2 });
  const p = player();
  const hit = { damage: 5, getDamage() { return this.damage; }, setDamage(n) { this.damage = n; } };
  cycle = 101;
  Activation.damageApplied({ target: p, hit });
  assert.equal(p.crystals(), 1, 'just active');
  cycle = 110;
  const moving = player({ moving: true });
  Activation.damageApplied({ target: moving, hit });
  assert.equal(moving.crystals(), 1, 'never while moving');
  Activation.damageApplied({ target: p, hit });
  assert.equal(p.crystals(), 0);
  assert.equal(hit.damage, 0);
  assert.equal(said('escape-crystal:escaped').at(-1).cause, 'afk');
});

test('worn as a ring of life it fires at 10% or less, not on a killing hit', () => {
  wildernessLevel = 10;
  settings({ ring: true });
  const p = player({ crystals: 0, worn: true, hitpoints: 20, max: 99 });
  const hit = (damage) => ({ getDamage: () => damage, setDamage() {} });
  Activation.damageApplied({ target: p, hit: hit(5) });
  assert.equal(p.wearing(), true, '15 left: above 10%');
  Activation.damageApplied({ target: p, hit: hit(20) });
  assert.equal(p.wearing(), true, 'a killing hit is the death\'s');
  Activation.damageApplied({ target: p, hit: hit(12) });
  assert.equal(p.wearing(), false);
  assert.equal(said('escape-crystal:escaped').at(-1).cause, 'ring');
});

test('on a Hardcore World it works anywhere and cleanses poison, venom and burn', () => {
  HardcoreCommon.init({
    getPluginConfig: (key, fallback) => (key === HardcoreCommon.DATA.config ? true : fallback),
    setWorldProfile() {}, setWorldType() {}, emitCustomEvent: api.emitCustomEvent,
    core: { CacheDefinitions: { getVarbitId: () => 1, getObjId: () => 1, getInterfaceId: () => 982, getComponentId: () => 1 } },
  });
  HardcoreCrystal(api);
  const hardcore = player({ profile: 'hardcore' });
  Activation.teleport({ player: hardcore });
  assert.equal(hardcore.crystals(), 0, 'in town');
  assert.equal(hardcore.poison, 0);
  assert.equal(hardcore.venomed, false);
  assert.equal(said('combat:clear-burn')[0].target, hardcore);
  const main = player();
  Activation.teleport({ player: main });
  assert.equal(main.crystals(), 1, 'a main character keeps the Wiki\'s places');
});
