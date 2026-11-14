// Run after `yarn build`: node --test tests/peer-the-seer-deposit.test.cjs
//
// Peer the Seer (NPC 3895) is a bank deposit box once the easy Fremennik Diary is complete (OSRS Wiki:
// Peer the Seer, Fremennik Diary). rsprox index rec 1757: Deposit-items opens bank_depositbox (192).
// Before the easy tier, Deposit-items plays the Wiki transcript's refusal. Real engine: every plugin
// loaded, a real Player, real NPC dispatch and the real transcript runner.
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
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Peer = require("../plugins/items/diaryrewards/PeerTheSeer.DiaryRewards");

const PEER = 3895;
const DEPOSIT_BOX = 192;
const REFUSAL = "I cannot do that for you until you have completed the easy tier of the Fremennik achievement diary.";
const AFTER_TRIALS = "standard-dialogue-after-the-fremennik-trials-without-a-skeletal-piece";
let core;
let next = 7600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
});

function actor() {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("peer" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2633, 3666, 0));
  player.needsPlacement = false;
  return player;
}

function completeEasy(player) {
  const diary = Diaries.BY_KEY.get("fremennik");
  for (const task of diary.tiers.easy.tasks) Progress.completeTask(player, diary, task.key ?? task);
  assert.equal(Progress.isTierComplete(player, diary, "easy"), true);
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
  return lines;
}

function depositItems(player) {
  const npc = core.NPC.create(PEER, new core.Location(2634, 3666, 0));
  const clickType = npc.getDefinition().getActions().indexOf("Deposit-items") + 1;
  assert.ok(clickType > 0, "Peer has a Deposit-items option");
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: PEER, definition: npc.getDefinition(), clickType, handled: false,
  });
}

/** The after-trials Talk-to, then its "Can you bank my stuff?" choice. */
function bankMyStuff(player) {
  const event = { player, npcId: PEER, variant: AFTER_TRIALS, exact: true, handled: false };
  PluginManager.emitCustomEvent("npc-dialogue:start", event);
  spoken(player);
  const pending = core.MultiChatboxPrompt.getPending(player);
  assert.ok(pending, "the Talk-to menu is up");
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 2, action: 2,
  });
}

test("without the easy Fremennik Diary, Deposit-items is refused with the transcript line", () => {
  const player = actor();
  assert.equal(depositItems(player), true);
  assert.deepEqual(spoken(player), [REFUSAL]);
  assert.notEqual(player.getInterfaceId(), DEPOSIT_BOX);
});

test("with the easy Fremennik Diary, Deposit-items opens the deposit box and says nothing", () => {
  const player = actor();
  completeEasy(player);
  assert.equal(depositItems(player), true);
  assert.equal(player.getInterfaceId(), DEPOSIT_BOX);
  assert.equal(player.getDialogueManager().isActive(), false);
});

test("Talk-to's Can you bank my stuff? follows the same diary rule", () => {
  const without = actor();
  assert.equal(bankMyStuff(without), true);
  assert.deepEqual(spoken(without).filter((line) => line !== "Can you bank my stuff?"), [REFUSAL]);
  assert.notEqual(without.getInterfaceId(), DEPOSIT_BOX);

  const done = actor();
  completeEasy(done);
  assert.equal(bankMyStuff(done), true);
  spoken(done);
  assert.equal(done.getInterfaceId(), DEPOSIT_BOX);
});

test("the refusal variant is the transcript's", () => {
  assert.match(Peer._test.REFUSAL_VARIANT, /before-completing-the-easy-fremennik-diary$/);
});
