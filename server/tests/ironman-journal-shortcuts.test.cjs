// Run after `yarn build`: node --test tests/ironman-journal-shortcuts.test.cjs
// The custom Character Summary's Teleports/Presets/Commands buttons are shortcuts for their ::commands,
// so they wait for a new tutorial-off character's account-type choice just as the commands do.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Journal = require("../plugins/interface/sidejournaldefaults/Layout.SideJournalDefaults");

const PENDING_ATTRIBUTE = "ironman:initial-setup-pending";
const DESIGNER = 679;
const SETUP = 890;
const SETUP_NONE = 21;
const TELEPORTS_INTERFACE = 30007;
let core;
let index = 1900;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  // The shortcuts belong to the opt-in custom Character Summary.
  const WorldDefinition = require("../dist/game/definition/WorldDefinition");
  const read = WorldDefinition.readWorldConfig;
  WorldDefinition.readWorldConfig = (...args) => {
    const world = read(...args) ?? {};
    return { ...world, plugins: { ...(world.plugins ?? {}), CustomCharacterSummary: true, TutorialIsland: false } };
  };
  try {
    PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  } finally {
    WorldDefinition.readWorldConfig = read;
  }
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const flush = () => new Promise(resolve => setImmediate(resolve));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)), c = new ClientConnection(channel);
  c.player = p;
  p.setUsername("journaliron" + index++);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3089, 3524, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.setNeedsPlacement(false);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.World.getPlayers().remove(p);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c };
}

async function send(f, packets) {
  await f.c.dispatch(packets);
  f.c.processTurnPackets();
  await flush();
}

async function chooseAppearance(f) {
  const look = f.p.getAppearance().getLook();
  await send(f, [{ type: "appearance", gender: look[0], kits: [1, 7, 2, 3, 4, 5, 6].map(i => look[i]), colors: [8, 9, 10, 11, 12].map(i => look[i]) }]);
}

const setupButton = (f, child) => send(f, [{ type: "widget_action", widgetId: (SETUP << 16) | child, groupId: SETUP, childId: child, buttonNum: 1, slot: -1, itemId: -1 }]);
const shortcut = (f, component) => send(f, [{ type: "widget_action", widgetId: Journal.uid(component), groupId: Journal.GROUP_ID, childId: component, buttonNum: 1, slot: -1, itemId: -1 }]);

test("journal Teleports/Presets/Commands shortcuts wait for the initial account-type choice, then work", async t => {
  const f = actor(t);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername(), isNewAccount: true });
  await flush();
  assert.equal(f.p.getInterfaceId(), DESIGNER, "PRE: the designer is up");
  assert.equal(f.p.getAttribute(PENDING_ATTRIBUTE), true);
  PM.emitCustomEvent("side-journal:mounted", { player: f.p, groupId: Journal.GROUP_ID });
  const { TELEPORTS, PRESETS, COMMANDS } = Journal.COMPONENT;

  for (const component of [TELEPORTS, PRESETS, COMMANDS]) {
    await shortcut(f, component);
    assert.equal(f.p.getInterfaceId(), DESIGNER, `designer kept (journal button ${component})`);
  }
  await chooseAppearance(f);
  assert.equal(f.p.getInterfaceId(), SETUP, "the account-type setup follows the designer");
  for (const component of [TELEPORTS, PRESETS, COMMANDS]) {
    await shortcut(f, component);
    assert.equal(f.p.getInterfaceId(), SETUP, `setup kept (journal button ${component})`);
  }
  assert.equal(f.p.getAttribute(PENDING_ATTRIBUTE), true);

  await setupButton(f, SETUP_NONE);
  assert.notEqual(f.p.getAttribute(PENDING_ATTRIBUTE), true);
  await send(f, [{ type: "interface_close" }]);
  await shortcut(f, TELEPORTS);
  assert.equal(f.p.getInterfaceId(), TELEPORTS_INTERFACE, "journal Teleports works after the choice");
});
