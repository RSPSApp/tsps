// Run after `yarn build`: node --test tests/wilderness-level-difference-message.test.cjs
// Attacking a player outside your Wilderness level range sends one game message, as live does:
// "Your level difference is too great!<br>You need to move deeper into the Wilderness." (rsprox_transcripts/229/02787.txt
// ticks 805 and 807). Real engine: every plugin loaded, real Players, the attack through CombatFactory.canAttackPermission.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { CombatFactory, CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const Skill = () => core.Skill;

const LIVE = "Your level difference is too great!<br>You need to move deeper into the Wilderness.";
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
});
after(() => PM.emitServerShutdown({}));

let next = 9820;
function player(t, name, x, y) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, 0));
  p.messages = [];
  const sender = p.getPacketSender();
  const send = sender.sendMessage.bind(sender);
  sender.sendMessage = (text) => { p.messages.push(text); return send(text); };
  t.after(() => p.setRegistered(false));
  return p;
}

test("a target outside the Wilderness level range gets live's single two-line message", (t) => {
  const strong = player(t, "wildstrong", 3110, 3655);
  const weak = player(t, "wildweak", 3111, 3657);
  for (const skill of ["ATTACK", "STRENGTH", "DEFENCE", "HITPOINTS", "RANGED", "MAGIC", "PRAYER"].map((name) => Skill()[name])) {
    strong.getSkillManager().setCurrentLevel(skill, 99, false).setMaxLevels(skill, 99, false);
  }
  assert.ok(strong.getSkillManager().getCombatLevel() - weak.getSkillManager().getCombatLevel() > 30, "far outside the range");
  for (const p of [strong, weak]) AreaManager.process(p);
  const response = CombatFactory.canAttackPermission(strong, weak, false, null);
  assert.equal(response, CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.deepEqual(strong.messages.filter((text) => /level difference|deeper into the Wilderness/.test(text)), [LIVE]);
});
