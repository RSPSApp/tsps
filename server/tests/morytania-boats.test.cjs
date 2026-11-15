// Run after `yarn build`: node --test tests/morytania-boats.test.cjs
// The boats between Burgh de Rott, Meiyerditch, the Icyene Graveyard and Slepe after Sins of the
// Father (rsprox 231/392 ticks 5337-8060, 239/4266 tick 786; docs/morytania-boats.md).
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { Location } = require("../dist/game/model/Location");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const Ferries = require("../plugins/world/Ferries.plugin");

const { Common } = Ferries._test;
const FADE_OVERLAY = 174;
const MESSAGEBOX = 229;
const SOTF_VARBIT = 7255;
const SOTF_COMPLETE = 138;
const DOH_BOAT_VARBIT = 2587;
const SLEPE_DOCK = [3663, 3277, 0];
const ICYENE_DOCK = [3684, 3176, 0];
const BURGH_DOCK = [3525, 3170, 0];
const MEIYERDITCH_BOAT = [3605, 3161, 1];
const MEIYERDITCH_ROCK = [3605, 3163, 1];

let core;
let index = 3400;
const complete = new WeakSet();
const cleanups = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PM.getCoreApi();
  const api = PM.createApi("MorytaniaBoatsQuests");
  api.onCustomEvent("quest:is-complete", (request) => {
    if (request.key === "sins_of_the_father" && complete.has(request.player)) request.complete = true;
  });
  Ferries.register(PM.createApi("MorytaniaBoatsFerries"));
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const locId = (gameval) => [...CacheDefinitions.getLocNames()].find(([, name]) => name === gameval)[0];

/** A real player at `tile`, Sins of the Father done (or not), recording what is sent. */
function actor(tile, { done = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(...tile));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("moryboat" + index);
  if (done) complete.add(p);
  const sender = p.getPacketSender();
  sender.sendVarbit(SOTF_VARBIT, done ? SOTF_COMPLETE : 0);
  sender.sendVarbit(DOH_BOAT_VARBIT, 1);
  const connection = new ClientConnection(channel); connection.player = p;
  const sent = { subs: [], closed: [], varbits: [], songs: [], jingles: [], sounds: [], soundDelays: [], messages: [], strings: [], animations: [], animationDelays: [], log: [] };
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendSubInterface", (uid, id) => { sent.subs.push(id); sent.log.push(`sub ${id}`); });
  wrap("closeSubInterface", (uid) => sent.closed.push(uid));
  wrap("sendVarbit", (id, value) => sent.varbits.push([id, value]));
  wrap("sendSong", (id) => sent.songs.push(id));
  wrap("sendJingle", (id) => sent.jingles.push(id));
  wrap("sendSoundEffect", (id, loops, delay) => { sent.sounds.push(id); sent.soundDelays.push(delay); });
  wrap("sendString", (text) => sent.strings.push(text));
  const performAnimation = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { sent.animations.push(animation.getId()); sent.animationDelays.push(animation.getDelay()); return performAnimation(animation); };
  const sendMessage = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { sent.messages.push(text); sent.log.push(`message ${text}`); return sendMessage(text, ...rest); };
  cleanups.push(() => { Ferries._test.Voyages.landNow({ player: p }); p.closeInterruptibleInterfaces(); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  async function choose(text) {
    const prompt = MultiChatboxPrompt.getPending(p);
    assert.ok(prompt?.options.includes(text), `${text}: ${JSON.stringify(prompt?.options)}`);
    await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: prompt.options.indexOf(text) + 1 });
  }
  const tick = (count = 1) => { for (let n = 0; n < count; n++) core.TaskManager.process(); };
  /** Op1 on the loc `gameval` at `tile`, with the variant the player sees, as the packet listener emits it. */
  const click = (gameval, tile) => {
    const id = locId(gameval);
    const object = new core.GameObject(id, new Location(...tile), 10, 0);
    const definition = ObjectDefinition.forPlayer(id, p);
    const event = { player: p, object, objectId: id, definition, location: { x: tile[0], y: tile[1], z: tile[2] }, clickType: 1, handled: false };
    PM.emitObjectInteraction(event);
    return event;
  };
  return { p, sent, choose, tick, click };
}

test("each dock's Board lists the other three docks, in the captured order", () => {
  const cases = [
    ["myq5_slepe_boat", [3663, 3274, 0], SLEPE_DOCK, ["Burgh de Rott.", "Meiyerditch.", "Icyene Graveyard."]],
    ["ig_boat", [3681, 3174, 0], ICYENE_DOCK, ["Burgh de Rott.", "Meiyerditch.", "Slepe."]],
    ["sang_boat_water_multiloc", [3522, 3169, 0], BURGH_DOCK, ["Meiyerditch.", "Icyene Graveyard.", "Slepe."]],
    ["sang_boat_edge_jump", MEIYERDITCH_BOAT, MEIYERDITCH_ROCK, ["Burgh de Rott.", "Icyene Graveyard.", "Slepe."]],
  ];
  for (const [gameval, tile, stand, options] of cases) {
    const f = actor(stand);
    const event = f.click(gameval, tile);
    assert.equal(event.definition?.getName?.(), "Boat", `${gameval} shows its Boat`);
    assert.equal(event.handled, true, gameval);
    const prompt = MultiChatboxPrompt.getPending(f.p);
    assert.equal(prompt?.title, "Where would you like to go?");
    assert.deepEqual(prompt?.options, options, gameval);
  }
});

test("Slepe to the Icyene Graveyard: fade, empty box, song 147 and jingle 137; the line at 1; landing at 10 facing north; fade in at 12", async () => {
  const f = actor(SLEPE_DOCK);
  f.click("myq5_slepe_boat", [3663, 3274, 0]);
  await f.choose("Icyene Graveyard.");
  assert.equal(Common.travelling(f.p), true);
  assert.deepEqual(f.sent.subs.filter((id) => id === FADE_OVERLAY).length, 1, "faded out on the pick");
  assert.equal(f.p.getPacketSender().getChatboxGroupId(), MESSAGEBOX, "the empty message box");
  assert.ok(f.sent.strings.includes(""), "no text, no continue");
  assert.deepEqual(f.sent.songs, [147]);
  assert.deepEqual(f.sent.jingles, [137]);
  assert.deepEqual(f.sent.messages, []);
  f.tick(1);
  assert.deepEqual(f.sent.messages, ["You board the boat and sail to the Icyene Graveyard."]);
  const minimap = CacheDefinitions.getVarbitId("minimap_state");
  assert.deepEqual(f.sent.varbits.filter(([id]) => id === minimap), [[minimap, 2]], "minimap off with the line");
  f.tick(8);
  assert.deepEqual(at(f.p), SLEPE_DOCK, "still at Slepe on tick 9");
  f.tick(1);
  assert.deepEqual(at(f.p), ICYENE_DOCK, "landed on tick 10");
  const face = f.p.getPositionToFace();
  assert.deepEqual([face.getX(), face.getY()], [3684, 3177], "face_angle 1024");
  f.tick(1);
  assert.equal(f.sent.subs.filter((id) => id === FADE_OVERLAY).length, 1);
  f.tick(1);
  assert.equal(f.sent.subs.filter((id) => id === FADE_OVERLAY).length, 2, "fade in on tick 12");
  assert.equal(f.p.getPacketSender().getChatboxGroupId(), -1, "the box closes with the fade in");
  assert.deepEqual(f.sent.varbits.filter(([id]) => id === minimap).at(-1), [minimap, 0]);
  assert.equal(Common.travelling(f.p), false);
});

test("each destination lands on its captured tile and line", async () => {
  const cases = [
    ["Burgh de Rott.", "ig_boat", [3681, 3174, 0], ICYENE_DOCK, BURGH_DOCK, "Burgh de Rott", [3526, 3170]],
    ["Meiyerditch.", "sang_boat_water_multiloc", [3522, 3169, 0], BURGH_DOCK, MEIYERDITCH_BOAT, "Meiyerditch", [3605, 3162]],
    ["Slepe.", "ig_boat", [3681, 3174, 0], ICYENE_DOCK, SLEPE_DOCK, "Slepe", [3662, 3277]],
  ];
  for (const [option, gameval, tile, stand, to, place, face] of cases) {
    const f = actor(stand);
    f.click(gameval, tile);
    await f.choose(option);
    f.tick(10);
    assert.deepEqual(at(f.p), to, option);
    assert.deepEqual(f.sent.messages, [`You board the boat and sail to ${place}.`]);
    const faced = f.p.getPositionToFace();
    assert.deepEqual([faced.getX(), faced.getY()], face, option);
    f.tick(4);
  }
});

test("Meiyerditch from the rock: the jump onto the boat on the pick's tick, the trip two ticks after (239/4266)", async () => {
  const f = actor(MEIYERDITCH_ROCK);
  f.click("sang_boat_edge_jump", MEIYERDITCH_BOAT);
  await f.choose("Slepe.");
  assert.deepEqual(at(f.p), MEIYERDITCH_BOAT, "on the boat (exactmove) on the pick's tick");
  const slide = f.p.getForceMovement();
  assert.ok(slide, "the jump is a forced move");
  assert.deepEqual([slide.getSpeed(), slide.getReverseSpeed(), slide.getDirection()], [28, 40, 2]);
  assert.deepEqual(f.sent.animations, [CacheDefinitions.getSeqId("human_steppingstonejump")]);
  assert.deepEqual(f.sent.animationDelays, [0]);
  assert.equal(CacheDefinitions.getSeqId("human_steppingstonejump"), 769);
  assert.deepEqual(f.sent.sounds, [2461]);
  assert.deepEqual(f.sent.soundDelays, [10]);
  assert.equal(Common.travelling(f.p), false);
  f.tick(1);
  assert.equal(Common.travelling(f.p), false);
  assert.deepEqual(f.sent.jingles, []);
  f.tick(1);
  assert.equal(Common.travelling(f.p), true, "the trip starts on the second tick after the pick");
  assert.deepEqual(f.sent.jingles, [137]);
  f.tick(1);
  assert.deepEqual(f.sent.messages, ["You board the boat and sail to Slepe."]);
  f.tick(9);
  assert.deepEqual(at(f.p), SLEPE_DOCK);
});

test("Meiyerditch from the boat tile sails at once; Jump-onto takes the player back to the rock", async () => {
  const f = actor(MEIYERDITCH_BOAT);
  const rock = f.click("sang_boat_jump_rock", MEIYERDITCH_ROCK);
  assert.equal(rock.handled, true);
  assert.deepEqual(at(f.p), MEIYERDITCH_ROCK);
  const slide = f.p.getForceMovement();
  assert.deepEqual([slide?.getSpeed(), slide?.getReverseSpeed(), slide?.getDirection()], [58, 70, 0], "north, angle 1024, rev 231's cycles");
  assert.deepEqual(f.sent.sounds, [2461]);
  assert.deepEqual(f.sent.soundDelays, [30]);
  assert.deepEqual(f.sent.animationDelays, [30]);
  f.tick(1);
  assert.deepEqual(f.sent.messages, []);
  f.tick(1);
  assert.deepEqual(f.sent.messages, ["You jump onto the rocky wall."]);

  const g = actor(MEIYERDITCH_BOAT);
  g.click("sang_boat_edge_jump", MEIYERDITCH_BOAT);
  await g.choose("Burgh de Rott.");
  assert.equal(Common.travelling(g.p), true);
  assert.deepEqual(g.sent.sounds, [], "no jump from the boat itself");
});

test("before Sins of the Father is complete the docks are left to the quests", () => {
  const f = actor(BURGH_DOCK, { done: false });
  const event = f.click("sang_boat_water_multiloc", [3522, 3169, 0]);
  assert.equal(event.handled, false);
  assert.equal(MultiChatboxPrompt.getPending(f.p), null);
  const slepe = f.click("myq5_slepe_boat", [3663, 3274, 0]);
  assert.equal(slepe.definition, null, "no boat at Slepe before stage 80");
  assert.equal(slepe.handled, false);
});

test("a second pick while jumping onto the Meiyerditch boat does not start two trips", async () => {
  const f = actor(MEIYERDITCH_ROCK);
  f.click("sang_boat_edge_jump", MEIYERDITCH_BOAT);
  await f.choose("Slepe.");
  const again = f.click("sang_boat_edge_jump", MEIYERDITCH_BOAT);
  assert.equal(again.handled, true);
  assert.equal(MultiChatboxPrompt.getPending(f.p), null, "no second menu mid-jump");
  f.tick(2);
  assert.deepEqual(f.sent.jingles, [137]);
});


test("the boat and the rock are used from each other's tile, with no walk", () => {
  const { Morytania } = Ferries._test;
  const routeFrom = (tile, gameval, target) => {
    const f = actor(tile);
    const id = locId(gameval);
    const event = { player: f.p, object: new core.GameObject(id, new Location(...target), 10, 0), objectId: id, clickType: 1, destination: null };
    Morytania.route(event);
    return event.destination;
  };
  assert.deepEqual(routeFrom(MEIYERDITCH_BOAT, "sang_boat_jump_rock", MEIYERDITCH_ROCK), { x: 3605, y: 3161, z: 1 });
  assert.deepEqual(routeFrom(MEIYERDITCH_ROCK, "sang_boat_edge_jump", MEIYERDITCH_BOAT), { x: 3605, y: 3163, z: 1 });
  assert.equal(routeFrom([3600, 3170, 1], "sang_boat_jump_rock", MEIYERDITCH_ROCK), null, "elsewhere the normal route");
});

test("Jump-onto while already on the rock: You're standing there!", () => {
  const f = actor(MEIYERDITCH_ROCK);
  const event = f.click("sang_boat_jump_rock", MEIYERDITCH_ROCK);
  assert.equal(event.handled, true);
  assert.deepEqual(f.sent.messages, ["You're standing there!"]);
  assert.deepEqual(at(f.p), MEIYERDITCH_ROCK);
  assert.deepEqual(f.sent.sounds, []);
});
