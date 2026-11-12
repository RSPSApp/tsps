// Run after `yarn build`: node --test tests/feud-champion-reward-full-inventory.test.cjs
// The Feud: the Bandit champion's willow blackjack is given by the quest's death handler (the drop table leaves it to
// it), with a bare `adds`; on a full inventory it reached neither the pack nor the floor, and the champion cannot be
// fought again. Real engine: every plugin loaded, a real Player at the champion stage, the quest's own death handler.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

let core;
let I;
let QuestRuntime;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("the champion's blackjack lands under a player with a full inventory", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8990); p.setUsername("feud8990"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3364, 2972, 0));
  t.after(() => p.setRegistered(false));
  QuestRuntime.questNamed("The Feud").setStage(p, 25);
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.LOGS, 1));
  const dropped = [];
  t.mock.method(ItemOnGroundManager, "registers", (player, item) => { dropped.push(item.getId()); return null; });
  const npc = core.NPC.create(core.NpcIdentifiers.BANDIT_CHAMPION, new core.Location(3365, 2972, 0));
  PM.emitNpcDeath({ npc, npcId: core.NpcIdentifiers.BANDIT_CHAMPION, killer: p, player: p });
  assert.deepEqual(dropped, [I.WILLOW_BLACKJACK], "the blackjack, not nothing");
});
