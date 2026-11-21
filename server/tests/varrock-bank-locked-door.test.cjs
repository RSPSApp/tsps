// Run after `yarn build`: node --test tests/varrock-bank-locked-door.test.cjs
//
// Varrock West Bank's locked back door (fai_varrock_bank_locked_door, 3186,3446) against
// rsprox.net rec 3213 (rev 232, ticks 4464-5070, five knocks): Knock-at gives the player's
// "I don't think I'm ever going to be allowed in there." with chatbored1 (562), every time.
// On a real Player with its real DialogueManager and PacketSender.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let Misthalin, core;
const hooks = {};

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  Misthalin = require('../plugins/areas/Misthalin.plugin');
  Misthalin.register({
    core,
    persistAttribute: () => {},
    onObjectRoute: () => {},
    onObjectInteraction: (name, actions) => { hooks[name] = { ...(hooks[name] ?? {}), ...actions }; },
    onItemOnObject: () => {},
    onPlayerLogin: () => {},
    emitCustomEvent: () => {},
  });
});

function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(79);
  p.texts = [];
  p.anims = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'isRegistered', () => true);
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendString', (text, id) => { p.texts.push(text); return sender; });
  t.mock.method(sender, 'sendInterfaceAnimation', (id, anim) => { p.anims.push(anim); return sender; });
  return p;
}

const C = () => core.CacheDefinitions;
const knock = (p, objectId) => hooks.Door['Knock-at']({ player: p, objectId, option: 'knock-at', location: { x: 3186, y: 3446, z: 0 } });

test('the cache door is "Door" with a single Knock-at', () => {
  const id = C().getLocId('fai_varrock_bank_locked_door');
  assert.equal(id, 11788);
  const def = C().getObject(id);
  assert.equal(def.name, 'Door');
  assert.equal(def.actions[0], 'Knock-at');
});

test('Knock-at gives the recorded player line with chatbored1, every knock', (t) => {
  const p = realPlayer(t);
  for (let i = 0; i < 2; i++) {
    p.texts.length = 0;
    p.anims.length = 0;
    assert.equal(knock(p, 11788), true);
    assert.ok(p.texts.includes("I don't think I'm ever going to be allowed in there."), JSON.stringify(p.texts));
    assert.ok(p.anims.includes(562), JSON.stringify(p.anims));
    p.getDialogueManager().reset?.();
  }
});

test('other locs are left to their own handlers', (t) => {
  const p = realPlayer(t);
  assert.equal(knock(p, C().getLocId('fai_varrock_ladder')), false);
  assert.deepEqual(p.texts, []);
});
