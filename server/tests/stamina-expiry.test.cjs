// Run after `yarn build`: node --test tests/stamina-expiry.test.cjs
//
// rsprox captures (224/01440, 231/00391, 237/01087 and 170 more): 20 ticks before a stamina effect ends,
// "Your stamina enhancement is about to expire." with sound 3120 three times; at the end "Your stamina
// enhancement has expired." with sound 3424. A real Player through a stamina potion's Drink and the plugin's
// own per-tick stamina step, with the session's packets recorded.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const c = PluginManager.getCoreApi();
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { encodeSound } = require("../dist/net/protocol/ClientProtocol");
const Potions = require("../plugins/items/Potions.plugin");

const WARNING = "<col=8f4808>Your stamina enhancement is about to expire.</col>";
const EXPIRED = "<col=8f4808>Your stamina enhancement has expired.</col>";
const TICK = 600;

before(async () => {
  await c.CachePipeline.initialize(path.resolve(__dirname, ".."));
  Potions.register(new Proxy({}, { get: (_, key) => (key === "core" ? c : () => {}) }));
});

let nextIndex = 2700;
function runner(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new c.Location(3222, 3218));
  p.setIndex(nextIndex++); p.setUsername("stamina" + p.getIndex()); p.setRegistered(true); p.setNeedsPlacement(false);
  const sounds = [];
  const messages = [];
  p.getSession().sendClientPacket = (frame) => { if (frame[0] === 131) sounds.push(Buffer.from(frame)); return true; };
  t.mock.method(p, "sendMessage", (text) => { messages.push(text); return p; });
  t.after(() => p.setRegistered(false));
  return { p, sounds, messages };
}

function clock(t) {
  let now = 1_000_000_000;
  t.mock.method(Date, "now", () => now);
  return { advance: (ms) => { now += ms; } };
}

const drinkStamina = (p) => Potions._test.findPotionEntry(c.ItemIdentifiers.STAMINA_POTION_4_).potion.effect(p);

test("the warning comes 20 ticks before the end, once, and the end line when it runs out", (t) => {
  const time = clock(t);
  const { p, sounds, messages } = runner(t);
  drinkStamina(p);
  sounds.length = 0;

  time.advance(200 * TICK - 21 * TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [], "nothing at 21 ticks left");

  time.advance(TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [WARNING], "the warning at 20 ticks left");
  assert.deepEqual(sounds, [encodeSound(3120, { loops: 3, delay: 0 })]);

  time.advance(10 * TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [WARNING], "only once");

  time.advance(10 * TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [WARNING, EXPIRED], "the end line when it runs out");
  assert.deepEqual(sounds, [encodeSound(3120, { loops: 3, delay: 0 }), encodeSound(3424, { loops: 1, delay: 0 })]);
  assert.equal(p.getAttribute("potions:stamina:end"), null);

  time.advance(TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [WARNING, EXPIRED], "nothing more after it ended");
});

test("a dose after the warning re-arms it for the new effect", (t) => {
  const time = clock(t);
  const { p, messages } = runner(t);
  drinkStamina(p);
  time.advance(190 * TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [WARNING]);

  drinkStamina(p);
  time.advance(100 * TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [WARNING], "the new two minutes aren't near their end");
  time.advance(80 * TICK);
  Potions._test.processStamina(p);
  assert.deepEqual(messages, [WARNING, WARNING], "warned again before the new end");
});
