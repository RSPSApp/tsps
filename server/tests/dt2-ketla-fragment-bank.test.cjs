// Run after `yarn build`: node --test tests/dt2-ketla-fragment-bank.test.cjs
//
// Desert Treasure II: Ketla's reclaim step replaces a lost blackstone fragment, but not one that is
// banked, in any tab. Real plugins, a real Player, Inventory and Bank; the step is the real
// npc-dialogue:action the transcript runner emits. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const STAGE_CHAPTERS = 7;
const LASSAR_ATTRIBUTE = "desert-treasure-ii:lassar";
/** Ketla's reclaim transcript action ("the-whisperer-talking-to-ketla-with-the-ring-of-visibility-reclaiming-..."). */
const RECLAIM_STEP = "WWa1TU";
let core;
let index = 7660;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(2648, 6442, 0));
  p.needsPlacement = false;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "desert_treasure_ii").setStage(p, STAGE_CHAPTERS);
  p.setAttribute(LASSAR_ATTRIBUTE, { cameTo: true, ringShown: true, blackstone: true });
  return p;
}

const fragments = (p) => p.getInventory().getAmount(core.ItemIdentifiers.BLACKSTONE_FRAGMENT);

test("Ketla replaces a lost fragment once, but not one in a bank tab", (t) => {
  const lost = player(t, "ketlaqa1");
  PM.emitCustomEvent("npc-dialogue:action", { player: lost, npcId: core.NpcIdentifiers.KETLA, stepId: RECLAIM_STEP });
  assert.equal(fragments(lost), 1, "a lost fragment comes back");
  PM.emitCustomEvent("npc-dialogue:action", { player: lost, npcId: core.NpcIdentifiers.KETLA, stepId: RECLAIM_STEP });
  assert.equal(fragments(lost), 1, "no second while one is carried");

  const banked = player(t, "ketlaqa2");
  banked.getBank(2).add(new core.Item(core.ItemIdentifiers.BLACKSTONE_FRAGMENT, 1));
  PM.emitCustomEvent("npc-dialogue:action", { player: banked, npcId: core.NpcIdentifiers.KETLA, stepId: RECLAIM_STEP });
  assert.equal(fragments(banked), 0, "the banked fragment is still owned");

  const placeholder = player(t, "ketlaqa3");
  placeholder.getBank(0).add(new core.Item(core.ItemIdentifiers.BLACKSTONE_FRAGMENT, 0));
  PM.emitCustomEvent("npc-dialogue:action", { player: placeholder, npcId: core.NpcIdentifiers.KETLA, stepId: RECLAIM_STEP });
  assert.equal(fragments(placeholder), 1, "a placeholder is not a fragment");
});
