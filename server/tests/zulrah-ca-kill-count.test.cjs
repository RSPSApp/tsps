// Run after `yarn build`: node --test tests/zulrah-ca-kill-count.test.cjs
//
// Before #3577 Combat Achievements counted each Zulrah kill twice, and the doubled count was saved.
// The shrine's own count was never doubled, so at login it is the Zulrah count. Native fixture:
// real plugins and a real Player, logged in through PluginManager.emitPlayerLogin.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Kills = require("../plugins/achievements/combatachievements/Kills.CombatAchievements");
const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");

const SHRINE_KILLS = "zulrah:kills";
let core;
let next = 6100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function login(t, attributes) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("zulrahca" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  for (const [key, value] of Object.entries(attributes)) p.setAttribute(key, value);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  PM.emitPlayerLogin({ player: p, username: p.getUsername(), isNewAccount: false });
  return p;
}

const zulrahCount = (p) => Kills.killCount(p, Data.monsterNamed("Zulrah"));

test("a doubled saved Zulrah count comes down to the shrine's at login; other counts keep theirs", (t) => {
  const doubled = login(t, { [SHRINE_KILLS]: 10, [Kills.KILLS_ATTRIBUTE]: { Zulrah: 20, "King Black Dragon": 12 } });
  assert.equal(zulrahCount(doubled), 10, "the shrine's 10 kills, not the doubled 20");
  assert.equal(Kills.killCount(doubled, Data.monsterNamed("King Black Dragon")), 12, "another monster's count is untouched");

  const behind = login(t, { [SHRINE_KILLS]: 10, [Kills.KILLS_ATTRIBUTE]: { Zulrah: 4 } });
  assert.equal(zulrahCount(behind), 10, "a lower saved count still catches up");

  const unknown = login(t, { [Kills.KILLS_ATTRIBUTE]: { Zulrah: 7 } });
  assert.equal(zulrahCount(unknown), 7, "with no shrine count there is nothing to correct it by");
});
