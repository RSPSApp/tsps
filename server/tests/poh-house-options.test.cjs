// Run after `yarn build`: node --test tests/poh-house-options.test.cjs
// House Options (Settings tab): each button's line and whether the panel closes. Building mode
// On/Off says "Building mode is now on/off." and closes the panel; outside a house it refuses and
// stays open, as do the layout viewer outside building mode and the servant refusals. Expel Guests
// reports how many it expelled and closes the panel. The settings click a sound.
// Real engine: every plugin loaded, a real Player in a real owned house.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

let core, House, Instance, OPTIONS, SETTINGS;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.RegionManager.init();
  ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  OPTIONS = core.CacheDefinitions.getInterfaceId("poh_options");
  SETTINGS = core.CacheDefinitions.getInterfaceId("settings_side");
});
after(() => PM.emitServerShutdown({}));

let next = 9870;
function actor(t, name = "pohopts") {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername(name + next++); p.setAttribute("bot-skip-persistence", true);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setLocation(new core.Location(2954, 3224, 0)); p.setNeedsPlacement(false);
  p.setAttribute("construction:house", Instance.createDefaultHouseSave());
  assert.equal(core.World.getPlayers().add(p), true);
  t.after(() => {
    const taskIndex = p.getIndex();
    try { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
    finally {
      try { House.releaseHouse(p, true); } finally { core.World.getPlayers().remove(p); }
      core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(taskIndex);
    }
  });
  const messages = [], panels = [], strings = [], sounds = [];
  const sender = p.getPacketSender();
  const send = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (...args) => { messages.push(args[0]); return send(...args); });
  const sub = sender.sendSubInterface.bind(sender);
  t.mock.method(sender, "sendSubInterface", (target, id, ...rest) => { panels.push(id); return sub(target, id, ...rest); });
  const str = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (...args) => { strings.push(args[0]); return str(...args); });
  const snd = sender.sendSound.bind(sender);
  t.mock.method(sender, "sendSound", (...args) => { sounds.push(args[0]); return snd(...args); });
  return { p, messages, panels, strings, sounds };
}

function click(p, groupId, childId) {
  return PM.emitInterfaceActionClick({ player: p, buttonId: (groupId << 16) | childId, groupId, childId, action: 1, handled: false });
}
function openPanel(f) {
  assert.equal(click(f.p, SETTINGS, 31), true);
  assert.equal(f.panels.at(-1), OPTIONS, "House Options is shown");
  f.messages.length = 0;
}
const closed = (f) => f.panels.at(-1) === SETTINGS;
const press = (f, child) => { assert.equal(click(f.p, OPTIONS, child), true); return f.messages.slice(); };

test("outside a house: building mode, the viewer and Call Servant refuse and the panel stays open", (t) => {
  const f = actor(t);
  openPanel(f);
  assert.ok(f.strings.some(s => /^Number of rooms: \d+$/.test(s)), f.strings.join(" | "));
  assert.deepEqual(press(f, 5), ["Building mode really only helps if you're in a house."]);
  f.messages.length = 0;
  assert.deepEqual(press(f, 6), ["Building mode really only helps if you're in a house."]);
  f.messages.length = 0;
  assert.deepEqual(press(f, 1), ["The layout viewer is only for building mode."]);
  f.messages.length = 0;
  assert.deepEqual(press(f, 22), ["You're not in a house. You can't call your servant from here."]);
  assert.equal(closed(f), false);
});

test("in the house: On and Off say building mode is now on/off and close the panel", (t) => {
  const f = actor(t);
  assert.equal(House.enterHouse(f.p, false), true);
  openPanel(f);
  assert.deepEqual(press(f, 1), ["The layout viewer is only for building mode."], "the viewer still needs building mode");
  assert.equal(closed(f), false);
  f.messages.length = 0;
  assert.deepEqual(press(f, 5), ["Building mode is now on."]);
  assert.equal(closed(f), true);
  assert.equal(House.isBuildingMode(f.p), true);
  openPanel(f);
  assert.deepEqual(press(f, 6), ["Building mode is now off."]);
  assert.equal(closed(f), true);
  assert.equal(House.isBuildingMode(f.p), false);
});

test("building mode is refused with guests in the house or a follower out, and the panel closes", (t) => {
  const f = actor(t);
  assert.equal(House.enterHouse(f.p, false), true);
  const house = House.houseFor(f.p), guest = actor(t, "pohguest").p;
  const players = house.getPlayers.bind(house);
  const mock = t.mock.method(house, "getPlayers", () => [...players(), guest]);
  openPanel(f);
  assert.deepEqual(press(f, 5), ["You cannot enter building mode if there are other players in the house."]);
  assert.equal(closed(f), true);
  mock.mock.restore();
  f.p.setAttribute("pets:current", { isRegistered: () => true });
  openPanel(f);
  assert.deepEqual(press(f, 5), ["You should pick up your follower before entering building mode."]);
  f.p.setAttribute("pets:current", null);
  assert.equal(closed(f), true);
  assert.equal(House.isBuildingMode(f.p), false);
});

test("Expel Guests reports what it did and closes the panel", (t) => {
  const f = actor(t);
  assert.equal(House.enterHouse(f.p, false), true);
  openPanel(f);
  assert.deepEqual(press(f, 20), ["No guests were found in your house."]);
  assert.equal(closed(f), true);
  const house = House.houseFor(f.p), guest = actor(t, "pohguest");
  const players = house.getPlayers.bind(house);
  t.mock.method(house, "getPlayers", () => [...players(), guest.p]);
  openPanel(f);
  assert.deepEqual(press(f, 20), ["Attempted to expel one guest."]);
  assert.ok(guest.messages.includes("The house owner has expelled you."));
  assert.equal(closed(f), true);
});

test("Call Servant without a servant refuses; Leave House closes the panel; settings click", (t) => {
  const f = actor(t);
  assert.equal(House.enterHouse(f.p, false), true);
  openPanel(f);
  assert.deepEqual(press(f, 22), ["You must hire a servant from the Servants' Guild in Ardougne first."]);
  assert.equal(closed(f), false);
  f.p.getAttribute("construction:house").servant = { id: core.NpcIdentifiers.RICK, uses: 0 };
  f.messages.length = 0;
  assert.deepEqual(press(f, 22), ["You need a bell pull in your house to be able to call your servant like this."]);
  assert.equal(closed(f), false);
  for (const child of [8, 9, 11, 12, 14, 17, 19]) press(f, child);
  assert.deepEqual(f.sounds, [2266, 2266, 2266, 2266, 2266, 2266, 2266]);
  f.messages.length = 0;
  assert.deepEqual(press(f, 21), []);
  assert.equal(House.houseFor(f.p), null);
  assert.equal(closed(f), true);
});
