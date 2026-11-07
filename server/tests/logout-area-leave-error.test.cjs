// Run after `yarn build`: node --test tests/logout-area-leave-error.test.cjs
// Player.onLogout called the area's leave directly; a plugin's postLeave that threw stopped the logout there, so no
// logout hooks ran, the player's tasks kept running and nothing was saved. Real Player, real onLogout.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { TaskManager } = require("../dist/game/task/TaskManager");

before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); });

test("an area whose leave throws doesn't stop the logout: its hooks still run and the tasks are cancelled", (t) => {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true, getChannel: () => null });
  p.setUsername("leave-throws");
  p.setAttribute("bot-skip-persistence", true);
  p.setArea({ leave() { throw new Error("a plugin's postLeave failed"); }, getName: () => "broken" });
  const logouts = t.mock.method(PluginManager, "emitPlayerLogout", () => {});
  const cancelled = t.mock.method(TaskManager, "cancelTasks", () => {});
  t.mock.method(console, "error", () => {});
  assert.doesNotThrow(() => p.onLogout());
  assert.equal(logouts.mock.callCount(), 1, "the logout hooks ran");
  assert.ok(cancelled.mock.calls.some((call) => call.arguments[0] === p), "and the player's tasks were cancelled");
});
