// Run after `yarn build`: node --test tests/ernest-puzzle-levers.test.cjs
// Issue #2270: the lever pull in Ernest's oil room, as recorded in rsprox archive 3209 (rev 232,
// four pulls of levers A and B at cycles 10899, 10906, 11574 and 11594): the message names the lever
// and its new position, then "You hear a clunk."; down plays sequence 2140, up 2139; synth_sound 2400
// then synth_sound 1565 with delay 5, whether or not a door changes. oploc2 only reports the lever:
// "The lever is down." (cycle 10903) or "The lever is up." (cycle 10887) No door crossing is in that capture, so doors have no sound here.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
});

const { PluginManager } = require('../dist/plugins/PluginManager');

const LEVERS_ATTRIBUTE = 'ernest-the-chicken.levers';
const LEVER_A = 146;
const LEVER_B = 147;

function scene() {
  const objects = [];
  const noop = () => {};
  const apiMethods = new Set(Object.keys(PluginManager.createApi('ErnestLevers')));
  const base = {
    core: PluginManager.getCoreApi(),
    onObjectRoute: noop,
    onObjectInteraction: (h) => { if (typeof h === 'function') objects.push(h); },
    persistAttribute: noop,
    onCustomEvent: noop,
    emitCustomEvent: noop,
  };
  const api = new Proxy(base, { get(target, prop) {
    if (prop in target) return target[prop];
    if (apiMethods.has(prop)) return noop;
    throw Error('Unknown PluginApi member: ' + String(prop));
  } });
  require('../plugins/quests/quests/ErnestTheChicken.Quest')(api);
  const attributes = new Map();
  const messages = [];
  const animations = [];
  const sounds = [];
  const sender = new Proxy({}, { get: (_, name) => (...args) => { if (name === 'sendSoundEffect') sounds.push(args); return sender; } });
  const { Location } = api.core;
  const player = {
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender, getPrivateArea: () => null,
    getUsername: () => 'T', getDisplayName: () => 'T', isPlayer: () => true, getAsPlayer: () => player,
    getLocation: () => new Location(3000, 3000, 0), // outside the basement: no loc packets
    sendMessage: (text) => messages.push(text),
    performAnimation: (animation) => animations.push(animation.getId()),
  };
  const pull = (objectId, clickType = 1) => {
    const event = { player, objectId, clickType, location: { x: 3118, y: 9752, z: 0 } };
    objects.forEach((h) => h(event));
    return event;
  };
  return { player, attributes, messages, animations, sounds, pull };
}

test('pulling a lever down names it, plays the pull and sounds 2400 then 1565 delayed 5', () => {
  const env = scene();
  const event = env.pull(LEVER_B);
  assert.equal(event.handled, true);
  assert.deepEqual(env.messages, ['You pull lever B down.', 'You hear a clunk.']);
  assert.deepEqual(env.animations, [2140]);
  assert.deepEqual(env.sounds.map(([id, loops, delay]) => [id, loops, delay]), [[2400, 1, 0], [1565, 1, 5]]);
  assert.equal(env.attributes.get(LEVERS_ATTRIBUTE), 2);
});

test('pulling it back up plays the up pull', () => {
  const env = scene();
  env.pull(LEVER_B);
  env.messages.length = 0; env.animations.length = 0; env.sounds.length = 0;
  env.pull(LEVER_B);
  assert.deepEqual(env.messages, ['You pull lever B up.', 'You hear a clunk.']);
  assert.deepEqual(env.animations, [2139]);
  assert.deepEqual(env.sounds.map(([id, loops, delay]) => [id, loops, delay]), [[2400, 1, 0], [1565, 1, 5]]);
  assert.equal(env.attributes.get(LEVERS_ATTRIBUTE), 0);
});

test('lever A is named A', () => {
  const env = scene();
  env.pull(LEVER_A);
  assert.deepEqual(env.messages, ['You pull lever A down.', 'You hear a clunk.']);
});

test('the second option on a lowered lever only reports it and does not pull', () => {
  const env = scene();
  env.pull(LEVER_B);
  env.messages.length = 0; env.animations.length = 0; env.sounds.length = 0;
  const event = env.pull(LEVER_B, 2);
  assert.equal(event.handled, true);
  assert.deepEqual(env.messages, ['The lever is down.']);
  assert.deepEqual(env.animations, []);
  assert.deepEqual(env.sounds, []);
  assert.equal(env.attributes.get(LEVERS_ATTRIBUTE), 2);
});

test('the second option on a raised lever reports it is up and does not pull', () => {
  const env = scene();
  const event = env.pull(LEVER_B, 2);
  assert.equal(event.handled, true);
  assert.deepEqual(env.messages, ['The lever is up.']);
  assert.deepEqual(env.animations, []);
  assert.deepEqual(env.sounds, []);
  assert.equal(env.attributes.get(LEVERS_ATTRIBUTE) ?? 0, 0);
});
