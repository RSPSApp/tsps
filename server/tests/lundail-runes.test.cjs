// Run after `yarn build`: node --test tests/lundail-runes.test.cjs
//
// Lundail (NPC 1601, Mage Arena bank) gives one random catalytic rune type once a day for a Wilderness
// diary reward: 40 / 80 / 120 / 200 by tier (OSRS Wiki: Lundail, Transcript:Lundail). No RSProx capture
// includes him; the tier is the highest one claimed from the diary master (inferred, like the other
// diary allowances). Real engine: every plugin loaded, a real Player and Inventory, the real transcript
// runner and real NPC dispatch (Talk-to choice and the Claim-runes option).
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

const LUNDAIL = 1601;
const AMOUNTS = { easy: 40, medium: 80, hard: 120, elite: 200 };
const RUNES = {
  mind: 558, body: 559, nature: 561, chaos: 562, law: 563, cosmic: 564, death: 560,
};
const RUNE_IDS = Object.values(RUNES);
let core;
let next = 7300;

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
  player.setUsername("lundail" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2539, 4715, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

/** Claims every tier up to and including `tier` from the diary master. */
function claimUpTo(player, tier) {
  const diary = Diaries.BY_KEY.get("wilderness");
  for (const name of Diaries.TIERS.slice(0, Diaries.TIERS.indexOf(tier) + 1)) DiaryProgress.claimTier(player, diary, name);
}

const held = (player) => RUNE_IDS.map((id) => [id, player.getInventory().getAmount(id)]).filter(([, n]) => n > 0);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);

/** What is said, read from the real dialogue chain, stopping at a choice. */
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

function click(player, option) {
  const npc = core.NPC.create(LUNDAIL, new core.Location(2540, 4715, 0));
  const clickType = npc.getDefinition().getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `Lundail has a "${option}" option`);
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getId(), definition: npc.getDefinition(), clickType, handled: false,
  });
}

function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

const CLAIM_CHOICE = 3;

/** Talk-to, then the "Claim free runes." choice; returns what was said after the choice. */
function talkClaim(player) {
  assert.equal(click(player, "Talk-to"), true);
  spoken(player);
  assert.ok(pending(player), "the Talk-to menu is up");
  assert.equal(answer(player, CLAIM_CHOICE), true);
  return spoken(player).join("\n");
}

test("Lundail has the Claim-runes option the Wiki lists", () => {
  const npc = core.NPC.create(LUNDAIL, new core.Location(2540, 4715, 0));
  assert.ok(npc.getDefinition().getActions().includes("Claim-runes"));
});

test("no claimed Wilderness tier: Talk-to Claim free runes is refused and nothing is given", (t) => {
  const { player } = actor(t);
  const lines = talkClaim(player);
  assert.match(lines, /need to have completed the Easy Wilderness Achievement Diary/);
  assert.deepEqual(held(player), []);
});

for (const [tier, amount] of Object.entries(AMOUNTS)) {
  test(`${tier}: Talk-to Claim free runes gives ${amount} of one random rune and a message`, (t) => {
    const { player, messages } = actor(t);
    claimUpTo(player, tier);
    const lines = talkClaim(player);
    assert.match(lines, /There you go\. Come back tomorrow for some more!/);
    const got = held(player);
    assert.equal(got.length, 1, "exactly one rune type");
    assert.equal(got[0][1], amount);
    const [name] = Object.entries(RUNES).find(([, id]) => id === got[0][0]);
    assert.ok(messages.includes(`Lundail hands you ${amount} free ${name} runes.`), `message in ${JSON.stringify(messages)}`);
  });

  test(`${tier}: Claim-runes gives ${amount} once, then refuses until tomorrow`, (t) => {
    const { player, messages } = actor(t);
    claimUpTo(player, tier);
    assert.equal(click(player, "Claim-runes"), true);
    assert.match(spoken(player).join("\n"), /There you go/);
    assert.equal(held(player)[0][1], amount);
    assert.ok(messages.some((m) => /^Lundail hands you \d+ free \w+ runes\.$/.test(m)));
    assert.equal(click(player, "Claim-runes"), true);
    assert.match(spoken(player).join("\n"), /already claimed your free runes today/);
    assert.equal(held(player)[0][1], amount, "no second hand-out");
  });
}

test("the day's claim is shared by Talk-to and Claim-runes", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  talkClaim(player);
  assert.equal(click(player, "Claim-runes"), true);
  assert.match(spoken(player).join("\n"), /already claimed/);
  assert.equal(held(player)[0][1], 40);
});

test("a full inventory is refused without spending the day's claim", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  const inventory = player.getInventory();
  for (let slot = 0; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(1925, 1));
  assert.equal(click(player, "Claim-runes"), true);
  assert.match(spoken(player).join("\n"), /need more free space/);
  assert.deepEqual(held(player), []);
  inventory.deleteAtSlot(0, 1, false);
  assert.equal(click(player, "Claim-runes"), true);
  spoken(player);
  assert.equal(held(player)[0][1], 40, "the refused try did not use the day");
});

test("a full inventory holding only mind runes is refused: the roll could land on any rune", (t) => {
  for (let i = 0; i < 20; i++) {
    const { player, messages } = actor(t);
    claimUpTo(player, "easy");
    const inventory = player.getInventory();
    inventory.setItem(0, new core.Item(RUNES.mind, 100));
    for (let slot = 1; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(1925, 1));
    assert.equal(click(player, "Claim-runes"), true);
    assert.match(spoken(player).join("\n"), /need more free space/);
    assert.deepEqual(held(player), [[RUNES.mind, 100]], "nothing added");
    assert.ok(!messages.some((m) => /Lundail hands you/.test(m)), "no hand-out message");
    assert.equal(player.getAttribute("diary-rewards:daily")?.counts?.["lundail-runes"], undefined, "the day is not spent");
  }
});

test("a later claim after the day has turned works again", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  click(player, "Claim-runes");
  spoken(player);
  const state = player.getAttribute("diary-rewards:daily");
  player.setAttribute("diary-rewards:daily", { ...state, day: "2000-01-01" });
  click(player, "Claim-runes");
  spoken(player);
  const total = held(player).reduce((sum, [, n]) => sum + n, 0);
  assert.equal(total, 80);
});

test("the random pick reaches every one of the seven kinds, and never an elemental rune", (t) => {
  const seen = new Set();
  for (let i = 0; i < 400 && seen.size < 7; i++) {
    const { player } = actor(t);
    claimUpTo(player, "easy");
    click(player, "Claim-runes");
    spoken(player);
    seen.add(held(player)[0][0]);
    for (const elemental of [554, 555, 556, 557]) assert.equal(player.getInventory().getAmount(elemental), 0);
  }
  assert.equal(seen.size, 7);
});
