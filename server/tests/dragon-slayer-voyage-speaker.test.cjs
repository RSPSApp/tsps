// Run after `yarn build`: node --test tests/dragon-slayer-voyage-speaker.test.cjs
//
// The voyage plays one transcript through Ned's scene NPC, and each line's speaker is on request.step. The scene is
// begun by the real dialogue action. Bots off. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const NED_SCENE_ID = 824;
const JENKINS_SCENE_ID = 826;
const STAGE_NED_READY = 8;

let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});
after(() => PM.emitServerShutdown({}));

function line(player, speaker, text) {
  const request = { player, npcId: NED_SCENE_ID, step: { type: "line", speaker, text }, text, pages: [], skip: false };
  PM.emitCustomEvent("npc-dialogue:line", request);
  return request;
}

test("Dragon Slayer I: voyage lines get their speaker's scene NPC", (t) => {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(7510);
  p.setUsername("voyageqa");
  p.setRegistered(true);
  p.setLocation(new core.Location(3047, 3204, 0));
  p.needsPlacement = false;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "dragon_slayer_i").setStage(p, STAGE_NED_READY);
  PM.emitCustomEvent("npc-dialogue:action", {
    player: p, npcId: core.NpcIdentifiers.CAPTAIN_NED, stepId: "1nn6tK", handled: false, end: false,
  });

  // Control: only the voyage scene hangs a camera on this line, so the scene is up.
  const camera = line(p, "Captain Ned", "Ah, it's good to feel");
  assert.equal(typeof camera.before, "function", "the voyage scene is running");

  assert.equal(line(p, "Cabin Boy Jenkins", "x").speakerId, JENKINS_SCENE_ID);
  assert.equal(line(p, "Captain Ned", "x").speakerId, NED_SCENE_ID);
});
