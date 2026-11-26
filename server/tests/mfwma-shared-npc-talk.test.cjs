// Run after `yarn build`: node --test tests/mfwma-shared-npc-talk.test.cjs
// Making Friends with My Arm hooks Talk-to on shared names ("Larry", "Burntmeat") and loads before
// the other plugins that answer them. A bare return counts as handled (PluginManager), so its
// "not mine" exits swallowed their Talk-to (issue 6834). Real engine: every plugin, a real Player.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, next = 9710;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = (key) => require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === key);

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("mfwmatalk" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2827, 3693, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.getDialogueManager().reset(); p.setRegistered(false); });
  return p;
}

function talk(p, id) {
  const npc = core.NPC.create(id, p.getLocation().clone());
  const definition = npc.getCurrentDefinition(p);
  const clickType = definition.getActions().indexOf("Talk-to") + 1;
  assert.ok(clickType > 0, `${definition.getName()} has Talk-to`);
  return PM.emitNpcInteraction({ player: p, npc, npcId: npc.getContentId(p), definition, clickType, handled: false });
}

test("My Arm's Big Adventure still answers Burntmeat before Making Friends with My Arm is possible", (t) => {
  const p = actor(t);
  quest("my_arms_big_adventure").setStage(p, 40); // started; Making Friends needs it complete
  assert.equal(quest("making_friends_with_my_arm").getStage(p), 0);
  assert.equal(talk(p, core.NpcIdentifiers.BURNTMEAT), true);
  assert.equal(p.getDialogueManager().isActive(), true, "Burntmeat speaks instead of a swallowed click");
});

test("before the quest, its own Larrys still fall through to their other dialogue", (t) => {
  for (const id of [827, 828, 829, 2197]) {
    const p = actor(t);
    assert.equal(talk(p, id), true);
    assert.equal(p.getDialogueManager().isActive(), true, `Larry ${id} speaks for a fresh player`);
  }
});

test("a Larry that isn't the quest's Rellekka boatman reaches his own plugin", (t) => {
  const p = actor(t);
  assert.equal(talk(p, 10418), true, "Mahogany Homes' Falador client");
  assert.equal(p.getDialogueManager().getCurrent().getText(), "Hello there. Mahogany Homes looks after my house, you know.");
});
