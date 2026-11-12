// Run after `yarn build`: node --test tests/hemenster-chest-relock.test.cjs
// The Hemenster chest relocks for 90 seconds after it is looted (Wiki), per account: logging out and back in does
// not reset it. Real engine: every plugin loaded, real Players (a relog is a fresh Player with the same username),
// real Inventory and skills, and the Kandarin Diary plugin's own chest handler.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9920;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("coffer" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}
const Kandarin = require("../plugins/achievements/diaries/KandarinDiaryFinish.AchievementDiaries")._test;

function thief(t, username) {
  const f = actor(t);
  f.p.setUsername(username);
  f.p.getSkillManager().setMaxLevels(core.Skill.THIEVING, 99, false).setCurrentLevels(core.Skill.THIEVING, 99, false);
  f.inv.setItem(0, new core.Item(I.LOCKPICK, 1));
  return f;
}

const chest = { getLocation: () => new core.Location(Kandarin.HEMENSTER_CHEST.x, Kandarin.HEMENSTER_CHEST.y, Kandarin.HEMENSTER_CHEST.z) };
const open = (f) => Kandarin.hemensterChest({ player: f.p, objectId: Kandarin.HEMENSTER_CHEST_ID, object: chest });

test("a relog does not reset the Hemenster chest's relock", (t) => {
  const first = thief(t, "hemenster-relog-test");
  open(first);
  assert.equal(first.inv.getAmount(I.COINS), 20);
  open(first);
  assert.equal(first.inv.getAmount(I.COINS), 20, "relocked in the same session");
  const relogged = thief(t, "hemenster-relog-test");
  open(relogged);
  assert.equal(relogged.inv.getAmount(I.COINS), 0, "still relocked after logging back in");
  assert.equal(relogged.messages.at(-1), "The chest is empty.");
});

test("the relock is per account: another player can still loot it", (t) => {
  thief(t, "hemenster-first");
  open(thief(t, "hemenster-first"));
  const other = thief(t, "hemenster-other");
  open(other);
  assert.equal(other.inv.getAmount(I.COINS), 20);
});
