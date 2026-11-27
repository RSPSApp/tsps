// Run after `yarn build`: node --test tests/killerwatt-plane.test.cjs
// The Killerwatt plane's portal (docs/killerwatt-plane.md). Real engine: every plugin loaded, a real Player, and
// real click and dialogue packets on the map's own locs. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const KillerwattPlane = require("../plugins/areas/KillerwattPlane.plugin");
const DIALOGUES = require("../data/definitions/npc-dialogues.json");

const T = KillerwattPlane._test;
/** draynor_killerwatt_portal_hidden, the multiloc the map places; draynor_killerwatt_portal2, the way back. */
const PORTAL_LOC = 11355;
const PORTAL_TILE = [3110, 3362, 2];
const PORTAL_HOME_LOC = 11356;
const PORTAL_HOME_TILE = [2678, 5214, 2];
/** Where a player stands near each: two steps from the portal, and the plane's landing. */
const ROOM_TILE = [3111, 3364, 2];
const PLANE_TILE = [2677, 5214, 2];

let core;
let quest;
let next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(PORTAL_TILE[0], PORTAL_TILE[1]);
  core.RegionManager.loadMapFiles(PORTAL_HOME_TILE[0], PORTAL_HOME_TILE[1]);
  PM.emitServerStartup({ timestamp: Date.now() });
  quest = QuestRuntime.questNamed("Ernest the Chicken");
});
after(() => PM.emitServerShutdown({}));

function actor(t, [x, y, z], { complete = false, boots = false } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("wattqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, z));
  p.needsPlacement = false;
  if (complete) quest.complete(p, { scroll: false, announce: false });
  if (boots) p.getEquipment().set(core.Equipment.FEET_SLOT, new core.Item(core.ItemIdentifiers.INSULATED_BOOTS, 1));
  const connection = new ClientConnection(channel);
  connection.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, connection };
}

function login(f) {
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername(), isNewAccount: false });
}

const portalVarbit = (f) => f.p.getPacketSender().getVarbit(T.PORTAL_VARBIT);
const seenPortal = (f) => core.ObjectDefinition.forPlayer(PORTAL_LOC, f.p)?.getName() ?? null;
const talking = (f) => Boolean(f.p.getDialogueManager().getCurrent());
const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];

async function tick(f) {
  f.connection.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function enter(f, id, [x, y]) {
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType: 1 }]);
  await tick(f);
}

async function resume(f, choice) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{
    type: "dialogue_continue",
    widgetId: choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    childIndex: choice ?? -1,
  }]);
  await tick(f);
}

async function choose(f, text) {
  for (let i = 0; i < 10; i++) {
    const options = core.MultiChatboxPrompt.getPending(f.p)?.options;
    if (options) {
      const index = options.indexOf(text);
      assert.ok(index >= 0, `"${text}" in ${options}`);
      return resume(f, index + 1);
    }
    assert.ok(talking(f), `the warning is still open before "${text}"`);
    await resume(f);
  }
  return assert.fail(`no menu with "${text}"`);
}

async function finish(f) {
  for (let i = 0; i < 10 && talking(f); i++) await resume(f);
}

test("the portal stays hidden until Ernest the Chicken is complete, and follows a reset", (t) => {
  const f = actor(t, ROOM_TILE);
  login(f);
  assert.equal(portalVarbit(f), 0);
  assert.equal(seenPortal(f), null, "nothing between the machines");
  quest.complete(f.p, { scroll: false, announce: false });
  assert.equal(portalVarbit(f), 1, "completing the quest opens it at once");
  assert.equal(seenPortal(f), "Interdimensional rift");
  quest.setStage(f.p, 0);
  assert.equal(portalVarbit(f), 0, "a reset hides it again");
  assert.equal(seenPortal(f), null);
});

test("a player who completed the quest sees the portal after logging in", (t) => {
  const f = actor(t, ROOM_TILE, { complete: true });
  f.p.getPacketSender().sendVarbit(T.PORTAL_VARBIT, 0);
  login(f);
  assert.equal(portalVarbit(f), 1);
  assert.equal(seenPortal(f), "Interdimensional rift");
});

test("Slayer's saved varp 661, which the portal shares, neither hides it at login nor loses Slayer's points", (t) => {
  const SLAYER_VARP = 661; // slayer_killerwatt_var: the portal is bit 0, slayer_master bits 2-5, slayer_points bits 6-22
  const varbit = (f, name) => f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name));
  const f = actor(t, ROOM_TILE, { complete: true });
  f.p.setAttribute("slayer:varps", { [SLAYER_VARP]: (10 << 6) | (3 << 2) });
  f.p.getPacketSender().sendVarbit(T.PORTAL_VARBIT, 0);
  login(f);
  assert.equal(portalVarbit(f), 1);
  assert.equal(varbit(f, "slayer_points"), 10);
  assert.equal(varbit(f, "slayer_master"), 3);
  // A snapshot saved while the portal showed does not show it once the quest is reset.
  const reset = actor(t, ROOM_TILE);
  reset.p.setAttribute("slayer:varps", { [SLAYER_VARP]: (10 << 6) | 1 });
  login(reset);
  assert.equal(portalVarbit(reset), 0);
  assert.equal(varbit(reset, "slayer_points"), 10);
});

test("Enter with insulated boots worn goes straight to the plane", async (t) => {
  const f = actor(t, ROOM_TILE, { complete: true, boots: true });
  login(f);
  await enter(f, PORTAL_LOC, PORTAL_TILE);
  assert.deepEqual(at(f), [...T.PLANE_LANDING]);
  assert.equal(talking(f), false, "no warning");
});

test("insulated boots only carried still get the warning", async (t) => {
  const f = actor(t, ROOM_TILE, { complete: true });
  f.p.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.INSULATED_BOOTS, 1));
  login(f);
  await enter(f, PORTAL_LOC, PORTAL_TILE);
  assert.equal(talking(f), true);
  assert.notDeepEqual(at(f), [...T.PLANE_LANDING]);
});

for (const [route, answers] of [
  ["not scared", ["Thanks for the warning, but I'm not scared of any monster."]],
  ["after asking about armour", ["Where can I get insulated armour from?", "I don't want to run around after Slayer Masters, I'm going through."]],
]) {
  test(`without insulated boots, Oddenstein warns first; going on anyway (${route}) goes to the plane`, async (t) => {
    const f = actor(t, ROOM_TILE, { complete: true });
    login(f);
    await enter(f, PORTAL_LOC, PORTAL_TILE);
    assert.notDeepEqual(at(f), [...T.PLANE_LANDING], "the click itself moves no one");
    for (const answer of answers) await choose(f, answer);
    await finish(f);
    assert.deepEqual(at(f), [...T.PLANE_LANDING]);
    assert.equal(talking(f), false, "the warning is closed");
  });
}

for (const answers of [
  ["Thanks, I think I'll stay here for a while then."],
  ["Where can I get insulated armour from?", "Thanks, I'll do that."],
]) {
  test(`without insulated boots, answering "${answers.at(-1)}" stays in the room`, async (t) => {
    const f = actor(t, ROOM_TILE, { complete: true });
    login(f);
    await enter(f, PORTAL_LOC, PORTAL_TILE);
    const from = at(f);
    for (const answer of answers) await choose(f, answer);
    await finish(f);
    assert.deepEqual(at(f), from);
  });
}

test("a quest reset while the warning is open keeps the player in the room", async (t) => {
  const f = actor(t, ROOM_TILE, { complete: true });
  login(f);
  await enter(f, PORTAL_LOC, PORTAL_TILE);
  const from = at(f);
  quest.setStage(f.p, 0);
  await choose(f, "Thanks for the warning, but I'm not scared of any monster.");
  await finish(f);
  assert.deepEqual(at(f), from);
});

test("before the quest, the hidden portal takes no click", async (t) => {
  const f = actor(t, ROOM_TILE, { boots: true });
  login(f);
  await enter(f, PORTAL_LOC, PORTAL_TILE);
  assert.notDeepEqual(at(f), [...T.PLANE_LANDING]);
  assert.equal(talking(f), false);
});

test("Portal Home's Enter goes back to Professor Oddenstein's room", async (t) => {
  const f = actor(t, PLANE_TILE, { complete: true });
  login(f);
  await enter(f, PORTAL_HOME_LOC, PORTAL_HOME_TILE);
  assert.deepEqual(at(f), [...T.ROOM_LANDING]);
});

test("both landings are walkable, beside the loc they lead from", () => {
  for (const [x, y, z] of [T.PLANE_LANDING, T.ROOM_LANDING]) {
    assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false, `${x},${y},${z}`);
  }
});

test("the warning and its two going-through answers are in the generated transcript", () => {
  const steps = DIALOGUES["Professor Oddenstein"]?.variants?.[T.WARNING_VARIANT] ?? [];
  const actions = JSON.stringify(steps).split(JSON.stringify(T.GO_THROUGH_ACTION)).length - 1;
  assert.equal(steps[0]?.npc, "Errr, just before you go through there...");
  assert.equal(actions, 2);
});

test("the plugin is members only", () => {
  assert.equal(KillerwattPlane.members, true);
});
