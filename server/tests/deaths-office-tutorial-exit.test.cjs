// Run after `yarn build`: node --test tests/deaths-office-tutorial-exit.test.cjs
// The Death's Office portal after the first-death tutorial leads to the player's own respawn point (Wiki Spawning,
// Respawn point), not always Lumbridge. Every plugin loaded, a real Player, and the RespawnPoints plugin's answer.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Entrances = require("../plugins/areas/deathsoffice/Entrances.DeathsOffice");

let core;
let exitOverride = null;
const tutorial = new Set();
before(async () => {
  // The tutorial's portal destination, as Tutorial.DeathsOffice hands it to the office's exit portal.
  const set = Entrances.setExitOverride;
  Entrances.setExitOverride = (override) => { exitOverride = override; return set(override); };
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  // The grave plugin says whether the player is still in the tutorial; this test pins it.
  PM.createApi("DeathsOfficeTutorialExitTest").onCustomEvent("gravestones:state", (query) => {
    if (tutorial.has(query.player)) query.inTutorial = true;
  });
});
after(() => PM.emitServerShutdown({}));

let next = 9850;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("office" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  t.after(() => { tutorial.delete(p); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

const at = (location) => [location.getX(), location.getY(), location.getZ()];

test("after the tutorial the portal leads to the player's own respawn point (Edgeville)", (t) => {
  assert.equal(typeof exitOverride, "function");
  const player = actor(t);
  tutorial.add(player);
  player.setAttribute("respawn-point:unlocked", ["edgeville"]);
  player.setAttribute("respawn-point:point", "edgeville");
  assert.deepEqual(at(exitOverride(player)), [3094, 3469, 0]);
});

test("with no respawn point set the tutorial's portal leads to Lumbridge, and outside the tutorial it is not overridden", (t) => {
  const player = actor(t);
  tutorial.add(player);
  const lumbridge = core.GameConstants.DEFAULT_LOCATION;
  assert.deepEqual(at(exitOverride(player)), at(lumbridge));
  assert.notEqual(exitOverride(player), lumbridge, "a copy, not the shared constant");
  tutorial.delete(player);
  player.setAttribute("respawn-point:point", "edgeville");
  assert.equal(exitOverride(player), null);
});
