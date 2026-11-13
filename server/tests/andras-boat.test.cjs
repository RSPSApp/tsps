// Run after `yarn build`: node --test tests/andras-boat.test.cjs
// Andras's boat between Port Phasmatys and Slepe (rsprox 231/372, 231/392, 237/1149; Wiki: Andras).
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { Location } = require("../dist/game/model/Location");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const Ferries = require("../plugins/world/Ferries.plugin");

const { Common, Voyages, Andras } = Ferries._test;
const PHASMATYS = [3671, 3542, 0];
const SLEPE = [3661, 3277, 0];
const FADE_OVERLAY = 174;

let core;
let index = 3000;
const cleanups = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PM.getCoreApi();
  require("../plugins/npcs/NpcDialogues.plugin").register(PM.createApi("AndrasDialogue"));
  Ferries.register(PM.createApi("AndrasFerries"));
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const coins = (player) => player.getInventory().getAmount(ItemIdentifiers.COINS);

/** A real player beside the Andras (or row boat) with this gameval, recording what is sent. */
function actor(gameval, tile, { coins: carried = 0, permanent = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...tile));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("andras" + index);
  if (carried) p.getInventory().adds(ItemIdentifiers.COINS, carried);
  if (permanent) p.setAttribute(Andras.PERMANENT_ATTRIBUTE, true);
  const connection = new ClientConnection(channel); connection.player = p;
  const npc = gameval ? core.NPC.create(CacheDefinitions.getNpcId(gameval), new Location(...tile)) : null;
  const sent = { subs: [], closed: [], varbits: [], sounds: [], items: [], lines: [] };
  const sender = p.getPacketSender();
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendSubInterface", (uid, id) => sent.subs.push(id));
  wrap("closeSubInterface", (uid) => sent.closed.push(uid));
  wrap("sendVarbit", (id, value) => sent.varbits.push([id, value]));
  wrap("sendSound", (id) => sent.sounds.push(id));
  wrap("sendItemOnInterfaces", (uid, item) => sent.items.push(item));
  wrap("sendString", (text) => sent.lines.push(text));
  cleanups.push(() => { Voyages.landNow({ player: p }); p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const next = () => send({ type: "dialogue_continue", widgetId: (p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  async function choose(text) {
    for (let n = 0; !MultiChatboxPrompt.getPending(p) && n < 60; n++) {
      assert.ok(p.getDialogueManager().getCurrent(), `dialogue ended before ${text}`);
      await next();
    }
    const prompt = MultiChatboxPrompt.getPending(p);
    assert.ok(prompt?.options.includes(text), `${text}: ${JSON.stringify(prompt?.options)}`);
    await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: prompt.options.indexOf(text) + 1 });
  }
  async function finish() {
    for (let n = 0; p.getDialogueManager().getCurrent() && n < 60; n++) await next();
  }
  const tick = (count = 1) => { for (let n = 0; n < count; n++) core.TaskManager.process(); };
  const talk = () => PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), action: "Talk-to", clickType: 1, handled: false });
  const travel = () => PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), action: "Travel", clickType: 3, handled: false });
  return { p, npc, sent, choose, finish, next, tick, talk, travel };
}

function boat(gameval, tile, player) {
  const id = CacheDefinitions.getLocNames ? [...CacheDefinitions.getLocNames()].find(([, name]) => name === gameval)[0] : -1;
  const object = new core.GameObject(id, new Location(...tile), 10, 0);
  return PM.emitObjectInteraction({ player, object, objectId: id, location: { x: tile[0], y: tile[1], z: tile[2] }, clickType: 1, handled: false });
}

test("the Port Phasmatys Andras plays the fare talk until access is bought; the Slepe one the return talk", () => {
  const variant = (gameval, permanent) => {
    const { p } = actor(null, PHASMATYS, { permanent });
    return Andras.selectVariant({ player: p, npcId: CacheDefinitions.getNpcId(gameval) })?.variant;
  };
  assert.equal(variant("slepe_boatman", false), Andras.VARIANTS.before);
  assert.equal(variant("slepe_boatman", true), Andras.VARIANTS.after);
  assert.equal(variant("slepe_boatman_return", false), Andras.VARIANTS.slepe);
});

test("Talk-to, Yes please: 10,000 coins, then the fade, Slepe two ticks later facing west, fade in at four, closed at six", async () => {
  const f = actor("slepe_boatman", PHASMATYS, { coins: 12500 });
  assert.equal(f.talk(), true);
  await f.choose("Yes please.");
  await f.finish();
  assert.equal(coins(f.p), 2500, "the fare is taken once");
  assert.equal(Common.travelling(f.p), true);
  assert.deepEqual(f.sent.subs, [FADE_OVERLAY]);
  f.tick(1);
  assert.deepEqual(at(f.p), PHASMATYS);
  f.tick(1);
  assert.deepEqual(at(f.p), SLEPE);
  const face = f.p.getPositionToFace();
  assert.deepEqual([face.getX(), face.getY()], [3660, 3277], "face_angle 512 on landing (rsprox 231/372)");
  f.tick(2);
  assert.deepEqual(f.sent.subs, [FADE_OVERLAY, FADE_OVERLAY], "fade in");
  assert.equal(Common.travelling(f.p), false);
  const closed = f.sent.closed.length;
  f.tick(1);
  assert.equal(f.sent.closed.length, closed, "the overlay stays a tick after the fade in");
  f.tick(1);
  assert.equal(f.sent.closed.length, closed + 1, "overlay closed");
});

test("Talk-to without 10,000 coins: his not-enough line and no trip", async () => {
  const f = actor("slepe_boatman", PHASMATYS, { coins: 9999 });
  f.talk();
  await f.choose("Yes please.");
  await f.finish();
  assert.equal(coins(f.p), 9999);
  assert.equal(Common.travelling(f.p), false);
  assert.deepEqual(at(f.p), PHASMATYS);
});

test("1,000,000 coins buy permanent access: the coin box with sound 2114, the varbit, then free trips", async () => {
  const f = actor("slepe_boatman", PHASMATYS, { coins: 1000500 });
  f.talk();
  await f.choose("I'll give you 1,000,000 coins for permanent access.");
  await f.choose("Yes. Here's 1,000,000 coins.");
  for (let n = 0; n < 4 && coins(f.p) !== 500; n++) await f.next();
  assert.equal(coins(f.p), 500);
  assert.equal(f.p.getAttribute(Andras.PERMANENT_ATTRIBUTE), true);
  assert.deepEqual(f.sent.varbits.filter(([id]) => id === CacheDefinitions.getVarbitId("andras_perm_unlock")).at(-1), [CacheDefinitions.getVarbitId("andras_perm_unlock"), 1]);
  assert.ok(f.sent.sounds.includes(2114));
  assert.ok(f.sent.items.includes(CacheDefinitions.getObjId("coins_10000")), "the item box shows coins_10000");
  assert.ok(f.sent.lines.includes("You pay Andras 1,000,000 coins for for permanent access to his boat."));
  await f.choose("Yes please.");
  await f.finish();
  assert.equal(coins(f.p), 500, "the trip after paying for access is free");
  f.tick(2);
  assert.deepEqual(at(f.p), SLEPE);
});

test("not enough for permanent access: he asks again and nothing is taken", async () => {
  const f = actor("slepe_boatman", PHASMATYS, { coins: 999999 });
  f.talk();
  await f.choose("I'll give you 1,000,000 coins for permanent access.");
  await f.choose("No thank you.");
  await f.finish();
  assert.equal(coins(f.p), 999999);
  assert.notEqual(f.p.getAttribute(Andras.PERMANENT_ATTRIBUTE), true);
});

test("with access, Where's Slepe? then Yes please goes free through the shared fare branch", async () => {
  const f = actor("slepe_boatman", PHASMATYS, { permanent: true });
  f.talk();
  await f.choose("Where's Slepe?");
  await f.choose("Yes please.");
  await f.finish();
  assert.equal(Common.travelling(f.p), true);
  f.tick(2);
  assert.deepEqual(at(f.p), SLEPE);
});

test("Travel: free with access, 10,000 coins without, his not-enough line with less", () => {
  const free = actor("slepe_boatman", PHASMATYS, { permanent: true, coins: 50 });
  assert.equal(free.travel(), true);
  assert.equal(coins(free.p), 50);
  assert.equal(Common.travelling(free.p), true);

  const paying = actor("slepe_boatman", PHASMATYS, { coins: 10000 });
  paying.travel();
  assert.equal(coins(paying.p), 0);
  assert.equal(Common.travelling(paying.p), true);
  paying.tick(2);
  assert.deepEqual(at(paying.p), SLEPE);

  const poor = actor("slepe_boatman", PHASMATYS, { coins: 10 });
  poor.travel();
  assert.equal(Common.travelling(poor.p), false);
  assert.equal(coins(poor.p), 10);
  assert.ok(poor.p.getDialogueManager().getCurrent(), "his refusal plays");
});

test("from Slepe: Talk-to and Travel take the player back to Port Phasmatys for nothing", async () => {
  const talk = actor("slepe_boatman_return", [3662, 3279, 0], { coins: 5 });
  talk.talk();
  await talk.choose("Yes please.");
  await talk.finish();
  talk.tick(2);
  assert.deepEqual(at(talk.p), PHASMATYS);
  assert.equal(coins(talk.p), 5);

  const travel = actor("slepe_boatman_return", [3662, 3279, 0]);
  travel.travel();
  travel.tick(2);
  assert.deepEqual(at(travel.p), PHASMATYS);
});

test("the row boats' Travel: Port Phasmatys charges the fare, Slepe's goes back free", () => {
  const phasmatys = actor(null, PHASMATYS, { coins: 10000 });
  assert.equal(boat("slepe_boat", [3671, 3545, 0], phasmatys.p), true);
  assert.equal(coins(phasmatys.p), 0);
  phasmatys.tick(2);
  assert.deepEqual(at(phasmatys.p), SLEPE);

  const poor = actor(null, PHASMATYS);
  assert.equal(boat("slepe_boat", [3671, 3545, 0], poor.p), true);
  assert.equal(Common.travelling(poor.p), false);

  const slepe = actor(null, [3662, 3279, 0]);
  assert.equal(boat("slepe_boat_return", [3661, 3279, 0], slepe.p), true);
  slepe.tick(2);
  assert.deepEqual(at(slepe.p), PHASMATYS);
});

test("login sends the permanent-access varbit", () => {
  const { p, sent } = actor(null, PHASMATYS, { permanent: true });
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  const varbit = CacheDefinitions.getVarbitId("andras_perm_unlock");
  assert.deepEqual(sent.varbits.filter(([id]) => id === varbit).at(-1), [varbit, 1]);
});
