// node --test tests/wizards-tower-books.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');

let core, search;
before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  require('../plugins/areas/Misthalin.plugin').register({
    core, onObjectInteraction: (name, ops) => { if (name === 'Bookcase') search = ops.Search; },
    persistAttribute: () => {}, onObjectRoute: () => {}, onItemOnObject: () => {}, onPlayerLogin: () => {},
  });
});

function player(t) {
  const p = new Player(null);
  const sent = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  for (const name of ['sendTypedMessage', 'sendChatboxInterface', 'sendString', 'sendClientScript', 'sendInterfaceFlagsRange', 'sendInterfaceRemoval']) {
    t.mock.method(sender, name, (...args) => { sent.push([name, ...args]); return sender; });
  }
  return { p, sent };
}

test('library Search offers the complete three-page dialogue and every Wiki title', (t) => {
  const titles = new Set();
  for (let i = 0; i < 8; i++) {
    t.mock.method(Math, 'random', () => (i + 0.5) / 8);
    const { p, sent } = player(t);
    const event = { player: p, objectId: core.CacheDefinitions.getLocId('fai_wiztower_bookcase'), location: { x: 3113, y: 3160, z: i % 2 } };
    assert.equal(search(event), true);
    const dm = p.getDialogueManager();
    assert.match(dm.getCurrent().getText(), /^There's a large selection of books/);
    dm.advance();
    const title = dm.getCurrent().getText();
    assert.match(title, /^'.+'$/);
    titles.add(title);
    dm.advance();
    assert.equal(dm.getCurrent().getText(), 'Interesting...');
    dm.advance();
    assert.ok(sent.some(([name]) => name === 'sendInterfaceRemoval'));
    t.mock.restoreAll();
  }
  assert.equal(titles.size, 8);
  assert.ok(titles.has("'Living with a Wizard Husband - A housewife's Story'"));
});

test('other bookcases and the basement remain unhandled', (t) => {
  const { p, sent } = player(t);
  const towerId = core.CacheDefinitions.getLocId('fai_wiztower_bookcase');
  for (const event of [
    { objectId: towerId, location: { x: 3113, y: 9560, z: 0 } },
    { objectId: towerId, location: { x: 3113, y: 3160, z: 2 } },
    { objectId: core.CacheDefinitions.getLocId('hauntedbookcasel'), location: { x: 3113, y: 3160, z: 0 } },
  ]) assert.equal(search({ player: p, ...event }), false);
  assert.deepEqual(sent, []);
});
