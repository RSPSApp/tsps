// Run after `yarn build`: node --test tests/cromperty-essence.test.cjs
//
// Wizard Cromperty (East Ardougne, multinpc 5314) gives free pure essence once a day for the Ardougne
// diary: 100 / 150 / 250 by medium / hard / elite (OSRS Wiki: Wizard Cromperty, Transcript:Wizard
// Cromperty). 5314 shows 8481 (with Claim) once varbit ardougne_medium_reward is set (cache). Real
// engine: every plugin loaded, a real Player, Inventory and VarManager, the real transcript runner
// and real NPC dispatch.
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

const CROMPERTY = 5314;
/** Noted pure essence (cert_blankrune_high). */
const NOTED_ESSENCE = 7937;
const FREE_ESSENCE_VARBIT = 4547;
const AMOUNTS = { medium: 100, hard: 150, elite: 250 };
const ALREADY = "I've already given you your free allowance for today. Come back to me tomorrow for some more.";
let core;
let next = 7600;

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
  player.setUsername("cromperty" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2683, 3325, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function claimUpTo(player, tier) {
  const diary = Diaries.BY_KEY.get("ardougne");
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
  const npc = core.NPC.create(CROMPERTY, new core.Location(2683, 3326, 0));
  const definition = npc.getCurrentDefinition(player);
  const clickType = definition.getActions().indexOf(option) + 1;
  if (clickType === 0) return null;
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getContentId(player), definition, clickType, handled: false,
  });
}

const held = (player) => player.getInventory().getAmount(NOTED_ESSENCE);
const freeVarbit = (player) => player.getPacketSender().getVarbit(FREE_ESSENCE_VARBIT);

test("before the medium reward Cromperty shows no Claim option", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  assert.equal(click(player, "Claim"), null);
});

for (const [tier, amount] of Object.entries(AMOUNTS)) {
  test(`${tier}: Claim gives ${amount} noted pure essence once, then refuses until tomorrow`, (t) => {
    const { player } = actor(t);
    claimUpTo(player, tier);
    assert.equal(click(player, "Claim"), true);
    assert.equal(spoken(player), `There you go, ${amount} free pure essence. Return tomorrow for some more.`);
    assert.equal(held(player), amount);
    assert.equal(freeVarbit(player), 1);
    assert.equal(click(player, "Claim"), true);
    assert.equal(spoken(player), ALREADY);
    assert.equal(held(player), amount, "no second hand-out");
  });
}

test("a full inventory without noted essence is refused without spending the day", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "medium");
  const inventory = player.getInventory();
  for (let slot = 0; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(1925, 1));
  assert.equal(click(player, "Claim"), true);
  assert.equal(spoken(player), "");
  assert.equal(held(player), 0);
  assert.ok(messages.some((m) => /inventory space/.test(m)), JSON.stringify(messages));
  inventory.setItem(0, new core.Item(NOTED_ESSENCE, 5));
  click(player, "Claim");
  spoken(player);
  assert.equal(held(player), 105, "the noted stack takes the claim");
});

test("the day turning allows another claim", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "elite");
  click(player, "Claim");
  spoken(player);
  const state = player.getAttribute("diary-rewards:daily");
  player.setAttribute("diary-rewards:daily", { ...state, day: "2000-01-01" });
  click(player, "Claim");
  assert.match(spoken(player), /There you go, 250 free pure essence/);
  assert.equal(held(player), 500);
});
