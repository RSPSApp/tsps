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

const floorTitles = [
  [
    '101 Ways to Impress Your Mates with Magic', 'The Dark Arts of Magical Wands',
    "Fire, Earth and Water ~ What's it all About?", 'How to become the Ultimate Wizard of the Universe',
    'The Life & Times of a Thingummywut by Traiborn the Wizard', "Life With a Wizard Husband ~ a Housewife's Story",
    "So You Think You're a Mage? Volume 28", 'Wind Strike for Beginners',
  ],
  [
    '101 Ways to Impress your Mates with Magic', 'The Dark Arts of Magical Wands',
    "Fire, Earth and Water - What's it all about?", 'How to become the Ultimate Wizard of the Universe',
    'The Life & Times of a Thingummywut by Traiborn the Wizard', "Living with a Wizard Husband - A housewife's Story",
    "So you think you're a Mage? Volume 28", 'Wind Strike for Beginners',
  ],
];

for (const [floor, expected] of floorTitles.entries()) test(`floor ${floor} Search offers all Wiki titles in a three-page dialogue`, (t) => {
  for (let i = 0; i < 8; i++) {
    t.mock.method(Math, 'random', () => (i + 0.5) / 8);
    const { p, sent } = player(t);
    const location = floor === 0 ? { x: 3113, y: 3160, z: 0 } : { x: 3110, y: 3163, z: 1 };
    const event = { player: p, objectId: core.CacheDefinitions.getLocId('fai_wiztower_bookcase'), location };
    assert.equal(search(event), true);
    const dm = p.getDialogueManager();
    assert.match(dm.getCurrent().getText(), /^There's a large selection of books/);
    dm.advance();
    assert.equal(dm.getCurrent().getText(), `'${expected[i]}'`);
    dm.advance();
    assert.equal(dm.getCurrent().getText(), 'Interesting...');
    dm.advance();
    assert.ok(sent.some(([name]) => name === 'sendInterfaceRemoval'));
    t.mock.restoreAll();
  }
});

test('other bookcases and the basement remain unhandled', (t) => {
  const { p, sent } = player(t);
  const towerId = core.CacheDefinitions.getLocId('fai_wiztower_bookcase');
  const wallId = core.CacheDefinitions.getLocId('fai_wiztower_bookcase_wall');
  for (const event of [
    { objectId: towerId, location: { x: 3113, y: 9560, z: 0 } },
    { objectId: towerId, location: { x: 3113, y: 3160, z: 2 } },
    { objectId: wallId, location: { x: 3113, y: 9560, z: 0 } },
    { objectId: wallId, location: { x: 3104, y: 3158, z: 2 } },
    { objectId: core.CacheDefinitions.getLocId('hauntedbookcasel'), location: { x: 3113, y: 3160, z: 0 } },
  ]) assert.equal(search({ player: p, ...event }), false);
  assert.deepEqual(sent, []);
});

test('the mapped wall bookcase opens the library dialogue', (t) => {
  const { p } = player(t);
  t.mock.method(Math, 'random', () => 0);
  assert.equal(search({ player: p, objectId: core.CacheDefinitions.getLocId('fai_wiztower_bookcase_wall'),
    location: { x: 3104, y: 3158, z: 0 } }), true);
  const dm = p.getDialogueManager();
  assert.match(dm.getCurrent().getText(), /^There's a large selection of books/);
  dm.advance();
  assert.equal(dm.getCurrent().getText(), `'${floorTitles[0][0]}'`);
  dm.advance();
  assert.equal(dm.getCurrent().getText(), 'Interesting...');
});
