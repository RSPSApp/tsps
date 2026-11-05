// Run after `yarn build`: node --test tests/magic-carpet-poison-death.test.cjs
//
// A rider can die aloft: poison ticks on its own and the ride opens nothing to pause it. The respawn
// must stand. Native fixture: the Rug Merchant's menu through the NPC hook with a stand-in definition,
// the answer through ClientConnection.dispatch, and real poison from CombatFactory.poisonEntity on the
// real tasks, with the hit queues swept as World's tick does. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
const CARPETS = require("../plugins/world/data/magic-carpets.json");
const { DIARIES } = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DESTINATION = "pollnivneach-north";
const POISON = 20;
const RIDE_ATTRIBUTE = "magic-carpets:ride";
const FARE = CARPETS.fare.coins;
const HIDE_CARPETS_VARBIT = 1773;
// This route is one the Desert Diary counts, so a trip's arrival shows there. Uzer is the other, behind The Golem.
const DIARY_TASK = "travel-from-the-shantay-pass-to-pollnivneach-by";

let core;
let I;
let next = 6700;
let cycle = 1;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...CARPETS.stations[0].takeoff);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const station = () => CARPETS.stations[0];
const route = () => CARPETS.routes.find((entry) => entry.from === station().key && entry.to === DESTINATION);
/** Its place in the menu, which leaves out destinations behind a quest this player hasn't done. */
const menuOption = () => station().travel
  .filter((key) => !CARPETS.stations.find((entry) => entry.key === key).quest)
  .indexOf(DESTINATION) + 1;

function actor(t, hitpoints) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("carpetqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(station().takeoff[0], station().takeoff[1], 0));
  p.needsPlacement = false;
  p.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, hitpoints, false);
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, c, inv: p.getInventory() };
}

function tick() {
  core.TaskManager.process();
  HitQueue.processAll(++cycle);
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];
const blocked = (f) => f.p.getMovementQueue().isMovementBlocked();
const riding = (f) => f.p.getAttribute(RIDE_ATTRIBUTE) != null;
const credited = (f) =>
  Progress.doneTasks(f.p, DIARIES.find((diary) => diary.key === "desert")).has(DIARY_TASK);

/** What the sender is told from here on: the carpets varbit's values, camera resets and restored tabs. */
function watch(t, f) {
  const sender = f.p.getPacketSender();
  const seen = { carpets: [], resets: 0, tabs: [] };
  const sendVarbit = sender.sendVarbit;
  t.mock.method(sender, "sendVarbit", function (id, value, ...rest) {
    if (id === HIDE_CARPETS_VARBIT) seen.carpets.push(value);
    return sendVarbit.call(this, id, value, ...rest);
  });
  const sendCameraReset = sender.sendCameraReset;
  t.mock.method(sender, "sendCameraReset", function (...args) {
    seen.resets++;
    return sendCameraReset.apply(this, args);
  });
  const sendTabInterface = sender.sendTabInterface;
  t.mock.method(sender, "sendTabInterface", function (tab, ...rest) {
    seen.tabs.push(tab);
    return sendTabInterface.call(this, tab, ...rest);
  });
  return seen;
}

async function board(f) {
  f.inv.setItem(0, new core.Item(I.COINS, FARE));
  const definition = { getName: () => "Rug Merchant", getActions: () => ["Talk-to", "Travel"] };
  const location = new core.Location(station().takeoff[0], station().takeoff[1], 0);
  PM.emitNpcInteraction({
    player: f.p,
    npc: { getLocation: () => location, getId: () => 1, getCurrentDefinition: () => definition },
    npcId: 1,
    definition,
    clickType: 2,
    handled: false,
  });
  assert.ok(core.MultiChatboxPrompt.getPending(f.p), "the menu is open");
  await f.c.dispatch([{ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: menuOption() }]);
  f.c.processTurnPackets();
  assert.equal(riding(f), true, "the ride has begun");
  assert.equal(f.inv.getAmount(I.COINS), 0, "and is paid for");
  tick();
}

test("poison lands on a rider aloft, who still arrives if it doesn't kill them", async (t) => {
  const f = actor(t, 50);
  await board(f);
  CombatFactory.poisonEntity(f.p, POISON);
  let hitAt = null;
  for (let i = 0; i < route().land && hitAt === null; i++) {
    tick();
    if (f.p.getHitpoints() < 50) hitAt = i;
  }
  assert.notEqual(hitAt, null, "the poison hits before the landing");
  assert.equal(riding(f), true, "aloft when it does");
  for (let i = 0; i < route().land + 12 && riding(f); i++) tick();
  assert.deepEqual(at(f), route().walkOff, "control: arrives at the far end");
  assert.equal(blocked(f), false, "control: free");
  assert.equal(credited(f), true, "control: the diary counts the trip");
});

test("a rider killed by poison aloft respawns as the same death with no ride does", async (t) => {
  const still = actor(t, 1);
  const stillSeen = watch(t, still);
  CombatFactory.poisonEntity(still.p, POISON);
  for (let i = 0; i < 50; i++) tick();
  assert.equal(still.p.getHitpoints() > 0, true, "control: respawned");
  const respawn = at(still);
  assert.notDeepEqual(respawn, station().takeoff, "control: away from where they died");
  assert.notDeepEqual(respawn, route().walkOff, "control: and not at the far end");

  const f = actor(t, 1);
  await board(f);
  CombatFactory.poisonEntity(f.p, POISON);
  let diedAt = null;
  for (let i = 0; i < route().land && diedAt === null; i++) {
    tick();
    if (f.p.isDyingReturn()) diedAt = i;
  }
  assert.notEqual(diedAt, null, "the poison kills before the landing");
  assert.equal(riding(f), true, "aloft when it does");
  assert.notEqual(f.p.getRenderAnimations(), null, "and flying");
  const seen = watch(t, f);
  for (let i = 0; i < route().land + 12; i++) tick();
  t.diagnostic(`died on tick ${diedAt} of ${route().land}; respawn ${respawn}; rider ${at(f)}; far end ${route().walkOff}`);
  assert.deepEqual(at(f), respawn, "the respawn stands");
  assert.equal(blocked(f), blocked(still), "free as the same death leaves them");
  assert.equal(riding(f), false, "and the ride is over");
  assert.equal(f.p.getRenderAnimations(), null, "the flying pose is gone");
  assert.equal(f.p.getDisplayedEquipment(), null, "and so is the carpet in hand");
  assert.deepEqual(seen.carpets, [0], "the map's carpets come back, once");
  // Plugins reset the camera on any death; the ride's own comes on top of those.
  assert.ok(seen.resets > stillSeen.resets, `the camera is reset: ${seen.resets} against ${stillSeen.resets} with no ride`);
  assert.ok(seen.tabs.includes(0) && seen.tabs.includes(6), `the hidden tabs come back: ${seen.tabs}`);
  assert.equal(credited(f), false, "and a trip that never arrived earns no diary task");
});
