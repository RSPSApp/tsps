// Run after yarn build: node --test tests/webrtc-content.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ContentApi } = require('../dist/net/http/ContentApi');
const { WebRtcGameConnector } = require('../dist/net/webrtc/WebRtcGameConnector');

class Channel extends EventTarget {
  constructor(label = 'content') {
    super();
    this.label = label;
    this.ordered = true;
    this.maxRetransmits = this.maxPacketLifeTime = null;
    this.readyState = 'open';
    this.bufferedAmount = 0;
    this.frames = [];
  }
  send(frame) { this.frames.push(frame); }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  receive(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

function connect(channel = new Channel()) {
  let peerCloses = 0, gameAccepts = 0;
  // Construction does not connect to signalling or create a native peer.
  const connector = new WebRtcGameConnector('ws://unused.invalid', 'test', 'test', 'unused', [], () => gameAccepts++);
  const game = new Channel('game');
  const state = { peer: { close() { peerCloses++; } }, channel: game };
  connector.acceptDataChannel('test', state, channel);
  return { channel, game, state, connector, peerCloses: () => peerCloses, gameAccepts: () => gameAccepts };
}

function response(channel, request) {
  const first = channel.frames.length;
  channel.receive(JSON.stringify(request));
  return channel.frames.slice(first).map(frame => {
    assert.ok(frame.length <= 32_768, 'the actual client rejects larger serialized frames');
    return JSON.parse(frame);
  });
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin')._test.loadItemPrices();
  require('../plugins/interface/GrandExchange.plugin').register(PluginManager.createApi('webrtc-content-prices'));
});
after(() => ContentApi.clear());

test('the accepted content channel serves actual registered ordinary-item quotes', () => {
  const f = connect();
  assert.equal(f.channel.readyState, 'open');
  const frames = response(f.channel, { id: 1, path: '/api/item-prices' });
  assert.ok(frames.length > 0);
  assert.ok(frames.every(frame => frame.id === 1 && typeof frame.chunk === 'string' && !frame.error));
  assert.equal(frames.at(-1).done, true);
  assert.ok(frames.slice(0, -1).every(frame => frame.done === false));
  const actual = JSON.parse(frames.map(frame => frame.chunk).join(''));
  const raw = require('../data/definitions/item-prices.json').data['385'];
  const expected = Math.max(...[raw.high, raw.low].filter(value => Number.isSafeInteger(value) && value > 0));
  assert.ok(expected > 0, 'the committed ordinary shark quote is a real prerequisite');
  assert.equal(actual['385'], expected);
  assert.equal(f.game.readyState, 'open');
  assert.equal(f.peerCloses(), 0);
  assert.equal(f.gameAccepts(), 0, 'content is never treated as binary gameplay');
  f.channel.close();
});

test('escaped and non-ASCII bodies reassemble within the existing client frame limit', () => {
  const value = ('"\n\\\u0000\ud83d\ude00').repeat(8000);
  ContentApi.register('content-test-large', () => ({ value }));
  const f = connect();
  const frames = response(f.channel, { id: 2, path: '/api/content-test-large' });
  assert.ok(frames.length > 1);
  assert.equal(JSON.parse(frames.map(frame => frame.chunk).join('')).value, value);
  f.channel.close();
});

test('only local read-only resource paths are dispatched and missing resources return an error', () => {
  const f = connect();
  for (const path of ['https://example.invalid/api/item-prices', '/api/../item-prices', '/api/item-prices#fragment']) {
    assert.equal(response(f.channel, { id: 3, path })[0].error, 'Invalid content path');
  }
  assert.equal(response(f.channel, { id: 4, path: '/api/content-test-missing' })[0].error, 'Content request failed: 404');
  ContentApi.register('content-test-oversized', () => 'x'.repeat(2_000_000));
  assert.equal(response(f.channel, { id: 5, path: '/api/content-test-oversized' })[0].error, 'Content response too large');
  assert.equal(f.game.readyState, 'open');
  f.channel.close();
});

test('malformed, duplicate, unreliable and congested auxiliary channels leave gameplay open', () => {
  for (const raw of ['{', JSON.stringify({ id: -1, path: '/api/item-prices' }), ' '.repeat(16_385)]) {
    const f = connect();
    f.channel.receive(raw);
    assert.equal(f.channel.readyState, 'closed');
    assert.equal(f.game.readyState, 'open');
    assert.equal(f.peerCloses(), 0);
  }
  const f = connect();
  const duplicate = new Channel();
  f.connector.acceptDataChannel('test', f.state, duplicate);
  assert.equal(duplicate.readyState, 'closed');
  assert.equal(f.channel.readyState, 'open');
  f.channel.bufferedAmount = 8_000_000;
  response(f.channel, { id: 6, path: '/api/item-prices' });
  assert.equal(f.channel.readyState, 'closed');
  assert.equal(f.game.readyState, 'open');
  for (const channel of [Object.assign(new Channel(), { ordered: false }), new Channel('unknown')]) {
    const f = connect(channel);
    assert.equal(channel.readyState, 'closed');
    assert.equal(f.game.readyState, 'open');
    assert.equal(f.peerCloses(), 0);
  }
});
