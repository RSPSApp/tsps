// Run after `yarn build`: node --test tests/tob-entry-reward-login.test.cjs
// A save whose solo Entry Mode raid is complete with the reward unclaimed logs in back in the reward room
// (Entry.restoreCompletedRaid). The party raid's login hook, registered after it, ejected anyone standing in the
// theatre, so it put that player straight back outside. Real engine: every plugin loaded, a real Player and the real
// login event.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Shared = require("../plugins/minigames/tob/Shared.TheatreOfBlood");
const Entry = require("../plugins/minigames/tob/Entry.TheatreOfBlood");

const TREASURE_READY = "tob:entry-treasure-ready";
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(name, index, x, y) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index); p.setUsername(name); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, 0)); p.needsPlacement = false;
  return p;
}

for (const [where, x, y] of [["inside the theatre", 3168, 4303], ["outside it", 3677, 3217]]) {
  test(`a login ${where} with an Entry Mode reward ready stays in the reward room`, (t) => {
    const p = player(`tobreward${x}`, 9791 + (x % 7), x, y);
    t.after(() => { Entry._test.RAIDS.delete(p); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
    p.setAttribute(TREASURE_READY, true);
    PM.emitPlayerLogin({ player: p, username: p.getUsername() });
    const [rx, ry, rz] = Entry._test.ROOMS[5].entry;
    const at = p.getLocation();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], [rx, ry, rz], "in Verzik's room, by the treasure entrance");
    assert.equal(Shared.inTheatre(at), true);
    assert.equal(Entry._test.RAIDS.has(p), true, "the completed raid is restored");
    assert.equal(p.getAttribute(TREASURE_READY), true, "reward still unclaimed");
  });
}

test("a login in the theatre with no reward ready is still put outside", (t) => {
  const p = player("tobnoreward", 9799, 3168, 4303);
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(Shared.inTheatre(p.getLocation()), false);
  assert.equal(Entry._test.RAIDS.has(p), false);
});
