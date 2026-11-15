// Run after `yarn build`: node --test tests/ratcatchers-rat-pit-manholes.test.cjs
//
// Wiki (Rat Pits): each pit opens during Ratcatchers. Varrock's manhole (3267,3400; the same loc as Port Sarim's)
// opens once Hooknosed Jack, back from the King Rat, says "See that manhole over there? Climb down it to enter the
// Varrock Rat Pits." (Transcript:Ratcatchers); before then he says "Step away from that manhole, you've no business
// down there." (Transcript:Hooknosed Jack). Port Sarim's stays The Face's, at stage 17. Real plugins and a real
// Player; the climb claim goes through PluginManager's "ladders:climb". No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core;
let index = 7720;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name, stage) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername(name); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); });
  QuestRuntime.questNamed("Ratcatchers").setStage(p, stage);
  return p;
}

/** A click on the manhole at (x, y), as Ladders asks before it climbs. */
function climb(p, x, y) {
  p.setLocation(new core.Location(x, y + 1, 0));
  const object = new GameObject(core.ObjectIdentifiers.MANHOLE_5, new core.Location(x, y, 0), 10, 0, null);
  const request = { player: p, object, objectId: core.ObjectIdentifiers.MANHOLE_5, clickType: 1, handled: false };
  PM.emitCustomEvent("ladders:climb", request);
  return request.handled;
}

const VARROCK = [3267, 3400];
const PORT_SARIM = [3018, 3232];

test("Varrock's manhole turns the player away until Jack has sent them down (stage 14)", (t) => {
  for (const stage of [0, 8, 13]) {
    const p = player(t, `ratpitv${stage}`, stage);
    assert.equal(climb(p, ...VARROCK), true, `stage ${stage}: refused`);
    assert.equal(p.getDialogueManager().isActive(), true, `stage ${stage}: Jack's line plays`);
  }
  for (const stage of [14, 15, 22]) {
    assert.equal(climb(player(t, `ratpitv${stage}`, stage), ...VARROCK), false, `stage ${stage}: the climb goes ahead`);
  }
});

test("Port Sarim's manhole still opens at 17; another tile with the same loc is not guarded", (t) => {
  assert.equal(climb(player(t, "ratpitp15", 15), ...PORT_SARIM), true);
  assert.equal(climb(player(t, "ratpitp17", 17), ...PORT_SARIM), false);
  assert.equal(climb(player(t, "ratpito0", 0), 3100, 3300), false);
});
