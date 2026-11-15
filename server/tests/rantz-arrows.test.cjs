// Run after `yarn build`: node --test tests/rantz-arrows.test.cjs
//
// Rantz (Feldip Hills, multinpc 1470) hands out free ogre arrows once a day for the Western Provinces
// diary: 25 / 50 / 100 / 150 by easy / medium / hard / elite (OSRS Wiki: Rantz, Transcript:Rantz).
// Claim-arrows is op3 of both forms 1470 shows (cache: 14793, 14794). Real engine: every plugin loaded,
// a real Player, Inventory and VarManager, the real transcript runner and real NPC dispatch.
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

const RANTZ = 1470;
const OGRE_ARROW = 2866;
const ARROWS_VARBIT = 4563;
const AMOUNTS = { easy: 25, medium: 50, hard: 100, elite: 150 };
const GIVE = "Hav' da stabbies. More toe'morrow if you come see Rantz.";
const CLAIMED = "You's already claimed da stabbies today 'uman. Come toe'morrow for mor'";
const NO_ROOM = "No space 'uman. Make some for da stabbies.";
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
  player.setUsername("rantz" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2628, 2979, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function claimUpTo(player, tier) {
  const diary = Diaries.BY_KEY.get("western");
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
  const npc = core.NPC.create(RANTZ, new core.Location(2628, 2980, 0));
  const definition = npc.getCurrentDefinition(player);
  const clickType = definition.getActions().indexOf(option) + 1;
  if (clickType === 0) return null;
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getContentId(player), definition, clickType, handled: false,
  });
}

const held = (player) => player.getInventory().getAmount(OGRE_ARROW);
const arrowsVarbit = (player) => player.getPacketSender().getVarbit(ARROWS_VARBIT);

test("the arrows are the cache's ogre arrows and Claim-arrows is on Rantz without a diary", () => {
  assert.equal(core.CacheDefinitions.getObjId("ogre_arrow"), OGRE_ARROW);
  assert.equal(core.CacheDefinitions.getVarbitId("western_rantz_arrows"), ARROWS_VARBIT);
});

test("without a Western Provinces tier Claim-arrows gives nothing", (t) => {
  const { player, messages } = actor(t);
  assert.equal(click(player, "Claim-arrows"), true);
  assert.equal(spoken(player), "");
  assert.equal(held(player), 0);
  assert.equal(arrowsVarbit(player), 0);
  assert.ok(messages.some((m) => /Western Provinces Diary/.test(m)), JSON.stringify(messages));
});

for (const [tier, amount] of Object.entries(AMOUNTS)) {
  test(`${tier}: Claim-arrows gives ${amount} ogre arrows once, then refuses until tomorrow`, (t) => {
    const { player } = actor(t);
    claimUpTo(player, tier);
    assert.equal(click(player, "Claim-arrows"), true);
    assert.equal(spoken(player), GIVE);
    assert.equal(held(player), amount);
    assert.equal(arrowsVarbit(player), 1);
    assert.equal(click(player, "Claim-arrows"), true);
    assert.equal(spoken(player), CLAIMED);
    assert.equal(held(player), amount, "no second hand-out");
  });
}

test("a higher tier finished after the day's claim waits for the next day", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  click(player, "Claim-arrows");
  spoken(player);
  claimUpTo(player, "hard");
  click(player, "Claim-arrows");
  assert.equal(spoken(player), CLAIMED);
  assert.equal(held(player), 25);
  const state = player.getAttribute("diary-rewards:daily");
  player.setAttribute("diary-rewards:daily", { ...state, day: "2000-01-01" });
  click(player, "Claim-arrows");
  assert.equal(spoken(player), GIVE);
  assert.equal(held(player), 125);
});

test("a full inventory without ogre arrows gets the no-space line and keeps the day", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "medium");
  const inventory = player.getInventory();
  for (let slot = 0; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(1925, 1));
  assert.equal(click(player, "Claim-arrows"), true);
  assert.equal(spoken(player), NO_ROOM);
  assert.equal(held(player), 0);
  assert.equal(arrowsVarbit(player), 0);
  inventory.setItem(0, new core.Item(OGRE_ARROW, 5));
  click(player, "Claim-arrows");
  assert.equal(spoken(player), GIVE);
  assert.equal(held(player), 55, "the stack takes the claim");
});

test("a claim on a new day clears yesterday's varbit before the hand-out", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "elite");
  click(player, "Claim-arrows");
  spoken(player);
  const state = player.getAttribute("diary-rewards:daily");
  player.setAttribute("diary-rewards:daily", { ...state, day: "2000-01-01" });
  const sent = [];
  const sender = player.getPacketSender();
  const original = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => {
    if (id === ARROWS_VARBIT) sent.push(value);
    return original(id, value);
  });
  click(player, "Claim-arrows");
  spoken(player);
  assert.deepEqual(sent, [0, 1]);
  assert.equal(held(player), 300);
});
