// Run after `yarn build`: node --test tests/random-event-tabs-restore.test.cjs
// A random event that hides the side tabs (Drill Demon, Pinball, Maze, Mime...) mounts them again when it ends. A bare
// re-mount drops the flags the login gave each tab, so inventory options and drag, the quiver slot, settings and the
// quest journal stopped responding until relog. Live re-sends `if_setevents 149:0 0-27` (rsprox_transcripts/227/01846.txt).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { encodeGameframeTabSetup, resolveGameframeRoot } = require("../dist/net/protocol/ClientProtocol");
const Teleports = require("../plugins/npcs/random-events/Teleports.RandomEvents");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("ending a hidden-tabs stay re-sends each tab's setup after it is mounted again", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session);
  session.setPlayer(p);
  p.setIndex(9900);
  p.setUsername("tabsrestore");
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  // The event NPC that invited the player (it vanishes in smoke when the stay begins).
  const npc = new core.NPC(core.NpcIdentifiers.DRILL_DEMON ?? 6743, new core.Location(3222, 3219, 0));
  const stay = Teleports.begin({ player: p, npc, definition: {} }, { kind: "tabs-test", arrive: { x: 3222, y: 3220 }, hideTabs: true });
  const sent = [];
  const original = session.sendClientPacket.bind(session);
  t.mock.method(session, "sendClientPacket", (frame) => { sent.push(Buffer.from(frame)); return original(frame); });
  Teleports.finish(stay, { back: false });
  const hex = sent.map((frame) => frame.toString("hex"));
  for (const group of [149, 387, 116, 629, 320, 216]) {
    const setup = encodeGameframeTabSetup(group, resolveGameframeRoot(p)).map((frame) => frame.toString("hex"));
    if (!setup.length) continue;
    const mount = hex.findIndex((frame) => frame.includes(group.toString(16).padStart(4, "0")));
    assert.ok(mount >= 0, `group ${group} is mounted again`);
    for (const frame of setup) assert.ok(hex.indexOf(frame, mount) > mount, `group ${group}'s setup follows its mount`);
  }
});
