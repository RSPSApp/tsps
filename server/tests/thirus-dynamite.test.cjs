// Run after `yarn build`: node --test tests/thirus-dynamite.test.cjs
//
// Thirus (Lovakengj, multinpc 8627) hands out free dynamite once a day for the Kourend & Kebos diary:
// 20 / 40 / 80 by medium / hard / elite (OSRS Wiki: Thirus, Transcript:Thirus). The Claim option is on
// 8547, which 8627 shows once varbit kourend_medium_reward is set (cache). Real engine: every plugin
// loaded, a real Player, Inventory and VarManager, the real transcript runner and real NPC dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/pvp-mode-on.cjs");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");

const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const THIRUS = 8627;
/** Noted (cert_lovakengj_dynamite_fused): unnoted dynamite does not stack. */
const DYNAMITE = 13574;
const FREE_DYNAMITE_VARBIT = 7939;
const AMOUNTS = { medium: 20, hard: 40, elite: 80 };
let core;
let next = 7400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("thirus" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(1517, 3833, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function claimUpTo(player, tier) {
  const diary = Diaries.BY_KEY.get("kourend");
  for (const name of Diaries.TIERS.slice(0, Diaries.TIERS.indexOf(tier) + 1)) DiaryProgress.claimTier(player, diary, name);
}

function spoken(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) {
      lines.push(current.getText().replace(/\s+/g, " ").trim());
    }
    if (current instanceof OptionDialogue) break;
    manager.advance();
  }
  return lines.join("\n");
}

/** Clicks an option of the spawned multinpc as this player sees it. */
function click(player, option) {
  const npc = core.NPC.create(THIRUS, new core.Location(1517, 3834, 0));
  const definition = npc.getCurrentDefinition(player);
  const clickType = definition.getActions().indexOf(option) + 1;
  if (clickType === 0) return null;
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getContentId(player), definition, clickType, handled: false,
  });
}

const held = (player) => player.getInventory().getAmount(DYNAMITE);
const freeVarbit = (player) => player.getPacketSender().getVarbit(FREE_DYNAMITE_VARBIT);

test("before the medium reward Thirus shows no Claim option", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  assert.equal(click(player, "Claim"), null);
});

for (const [tier, amount] of Object.entries(AMOUNTS)) {
  test(`${tier}: Claim gives ${amount} dynamite once, then refuses until tomorrow`, (t) => {
    const { player } = actor(t);
    claimUpTo(player, tier);
    assert.equal(click(player, "Claim"), true);
    assert.equal(spoken(player), `There you go, ${amount} free dynamite. Return tomorrow for some more.`);
    assert.equal(held(player), amount);
    assert.equal(freeVarbit(player), 1);
    assert.equal(click(player, "Claim"), true);
    assert.equal(spoken(player), "I've already given you your free allowance for today. Come back to me tomorrow for some more.");
    assert.equal(held(player), amount, "no second hand-out");
  });
}

test("a full inventory without dynamite is refused without spending the day", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "medium");
  const inventory = player.getInventory();
  for (let slot = 0; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(1925, 1));
  assert.equal(click(player, "Claim"), true);
  assert.equal(spoken(player), "");
  assert.equal(held(player), 0);
  assert.ok(messages.some((m) => /inventory space/.test(m)), JSON.stringify(messages));
  inventory.setItem(0, new core.Item(DYNAMITE, 5));
  click(player, "Claim");
  spoken(player);
  assert.equal(held(player), 25, "the stack takes the claim");
});

test("the day turning allows another claim", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "elite");
  click(player, "Claim");
  spoken(player);
  const state = player.getAttribute("diary-rewards:daily");
  player.setAttribute("diary-rewards:daily", { ...state, day: "2000-01-01" });
  click(player, "Claim");
  assert.match(spoken(player), /There you go, 80 free dynamite/);
  assert.equal(held(player), 160);
});
