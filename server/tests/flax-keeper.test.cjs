// Run after `yarn build`: node --test tests/flax-keeper.test.cjs
//
// The flax keeper (NPC 5522, Seers' Village flax fields) swaps noted flax for noted bow strings once a
// day for a Kandarin diary reward: 30 / 60 / 120 / 250 by tier. Evidence: the OSRS Wiki (Flax keeper,
// Kandarin Diary rewards, Transcript:Flax keeper). Text searches of the RSProx archive find none of his
// lines and archives 1034 and 1035 (which list NPC 5522) were decoded without his dialogue, so the words
// are the transcript's in npc-dialogues.json and the tier is taken from the diary tiers claimed from Toby
// (inferred; the Wiki says "completing the ... tasks").
// Real engine: every plugin loaded, a real Player and Inventory, the real transcript runner and
// prompt, real NPC dispatch (Talk-to and Exchange), the real preset producer.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Rewards = require("../plugins/items/diaryrewards/Common.DiaryRewards");

const FLAX_KEEPER = 5522;
const FLAX = 1779;
const BOW_STRING = 1777;
const AMOUNTS = { easy: 30, medium: 60, hard: 120, elite: 250 };
let core;
let NOTED_FLAX;
let NOTED_BOW_STRING;
let next = 6100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  NOTED_FLAX = ItemDefinition.forId(FLAX).getNoteId();
  NOTED_BOW_STRING = ItemDefinition.forId(BOW_STRING).getNoteId();
  assert.ok(NOTED_FLAX > 0 && NOTED_BOW_STRING > 0, "flax and bow string have noted forms in the cache");
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("flax" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2743, 3443, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

/** Claims every tier up to and including `tier` from Toby, as the diary's reward step does. */
function claimUpTo(player, tier) {
  const diary = Diaries.BY_KEY.get("kandarin");
  for (const name of Diaries.TIERS.slice(0, Diaries.TIERS.indexOf(tier) + 1)) DiaryProgress.claimTier(player, diary, name);
}

const inventory = (player) => player.getInventory();
const count = (player, id) => inventory(player).getAmount(id);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);
const notedFlax = (n) => new core.Item(NOTED_FLAX, n);

function preset(item) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const made = Presets._test.spawnPresetItem(item, Presets.getGlobalPresetPool()[0]);
  assert.equal(made.isPresetItem(), true, "the producer marked the item");
  return made;
}

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

function keeper() {
  return core.NPC.create(FLAX_KEEPER, new core.Location(2744, 3443, 0));
}

function click(player, option) {
  const npc = keeper();
  const clickType = npc.getDefinition().getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `the keeper has a "${option}" option`);
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getId(), definition: npc.getDefinition(), clickType, handled: false,
  });
}

function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

const AGREE = 1;
const DECLINE = 2;
const USED_UP = /I'm afraid I won't be able to exchange any more flax for bowstrings today/;

test("no claimed Kandarin tier: the keeper only chats and nothing is exchanged", (t) => {
  const { player } = actor(t);
  inventory(player).add(notedFlax(30), false);
  assert.equal(click(player, "Talk-to"), true);
  const lines = spoken(player).join("\n");
  assert.match(lines, /I tend to the flax fields/);
  assert.equal(pending(player), null, "no offer");
  assert.equal(count(player, NOTED_FLAX), 30);
});

for (const [tier, amount] of Object.entries(AMOUNTS)) {
  test(`${tier}: Talk-to offers ${amount}, Agree swaps ${amount} noted flax for ${amount} noted bow strings`, (t) => {
    const { player, messages } = actor(t);
    claimUpTo(player, tier);
    inventory(player).add(notedFlax(amount + 5), false);
    assert.equal(click(player, "Talk-to"), true);
    assert.match(spoken(player).join("\n"), new RegExp(`I'll exchange ${amount} for you today`));
    assert.equal(pending(player)?.title, `Swap ${amount} flax notes for bowstrings?`);
    assert.equal(count(player, NOTED_BOW_STRING), 0, "nothing is credited before Agree");
    assert.equal(count(player, NOTED_FLAX), amount + 5, "nothing is taken before Agree");
    assert.equal(answer(player, AGREE), true);
    assert.equal(count(player, NOTED_FLAX), 5);
    assert.equal(count(player, NOTED_BOW_STRING), amount);
    assert.equal(Rewards.dailyUses(player, "flax-keeper"), 1, "today's allowance is used");
    // The result is the transcript's message box: flax and bow string, with its words, not a chat line.
    const box = player.getDialogueManager().getCurrent();
    assert.ok(box instanceof DoubleItemStatementDialogue, "the swap is shown as the double item box");
    assert.deepEqual(box.getItemIds(), [FLAX, BOW_STRING]);
    assert.equal(box.getText(), "The flax keeper exchanges your flax for bowstrings.");
    assert.doesNotMatch(messages.join("\n"), /exchanges your flax/, "and not also as a chat message");
  });
}

test("the highest claimed tier decides the amount", (t) => {
  const { player } = actor(t);
  const diary = Diaries.BY_KEY.get("kandarin");
  DiaryProgress.claimTier(player, diary, "easy");
  DiaryProgress.claimTier(player, diary, "hard");
  inventory(player).add(notedFlax(200), false);
  click(player, "Talk-to");
  spoken(player);
  assert.equal(pending(player)?.title, "Swap 120 flax notes for bowstrings?");
});

test("a second Talk-to the same day gets the used-up line and no offer", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(60), false);
  click(player, "Talk-to");
  spoken(player);
  answer(player, AGREE);
  player.getDialogueManager().reset?.();
  click(player, "Talk-to");
  assert.match(spoken(player).join("\n"), USED_UP);
  assert.equal(pending(player), null);
  assert.equal(count(player, NOTED_BOW_STRING), 30, "only one swap");
  assert.equal(count(player, NOTED_FLAX), 30);
});

test("Decline changes nothing and leaves the allowance", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(30), false);
  click(player, "Talk-to");
  spoken(player);
  assert.equal(answer(player, DECLINE), true);
  assert.equal(count(player, NOTED_FLAX), 30);
  assert.equal(count(player, NOTED_BOW_STRING), 0);
  assert.equal(Rewards.dailyUses(player, "flax-keeper"), 0);
});

test("too little noted flax: the transcript's refusal and no offer", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(29), false);
  click(player, "Talk-to");
  const lines = spoken(player).join("\n");
  assert.match(lines, /I didn't actually bring 30 flax banknotes with me\./);
  assert.match(lines, /if you fetch that many flax banknotes/);
  assert.equal(pending(player), null);
  assert.equal(count(player, NOTED_FLAX), 29);
});

test("unnoted flax does not count", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(new core.Item(FLAX, 1), false);
  inventory(player).add(notedFlax(29), false);
  click(player, "Talk-to");
  spoken(player);
  assert.equal(pending(player), null);
});

test("the Exchange option: short of flax it names today's amount; with flax it offers the swap", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "medium");
  assert.equal(click(player, "Exchange"), true);
  assert.match(spoken(player).join("\n"),
    /Today I can exchange 60 flax banknotes for bowstrings, if you bring me enough flax banknotes\./);
  assert.equal(pending(player), null);
  inventory(player).add(notedFlax(60), false);
  player.getDialogueManager().reset?.();
  click(player, "Exchange");
  spoken(player);
  assert.equal(pending(player)?.title, "Swap 60 flax notes for bowstrings?");
  answer(player, AGREE);
  assert.equal(count(player, NOTED_BOW_STRING), 60);
  assert.equal(count(player, NOTED_FLAX), 0);
});

test("the Exchange option with no claimed tier plays the chat, not a swap", (t) => {
  const { player } = actor(t);
  inventory(player).add(notedFlax(30), false);
  click(player, "Exchange");
  assert.match(spoken(player).join("\n"), /I tend to the flax fields/);
  assert.equal(pending(player), null);
});

test("flax spent between the offer and Agree: nothing credited, allowance kept", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(30), false);
  click(player, "Talk-to");
  spoken(player);
  inventory(player).deleteNumber(NOTED_FLAX, 30);
  answer(player, AGREE);
  assert.equal(count(player, NOTED_BOW_STRING), 0);
  assert.equal(Rewards.dailyUses(player, "flax-keeper"), 0);
});

test("the allowance used between the offer and Agree: nothing credited or taken", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(30), false);
  click(player, "Talk-to");
  spoken(player);
  Rewards.useDaily(player, "flax-keeper");
  answer(player, AGREE);
  assert.equal(count(player, NOTED_BOW_STRING), 0);
  assert.equal(count(player, NOTED_FLAX), 30);
});

/** Fills the inventory with distinct items until no slot is free. */
function fillUp(player) {
  for (let id = 1038; inventory(player).getFreeSlots() > 0; id += 2) inventory(player).add(new core.Item(id, 1), false);
  assert.equal(inventory(player).getFreeSlots(), 0, "setup: a full inventory");
}

const NO_ROOM_TALK = "Um... Actually, you seem to have so much stuff that you can't hold the bowstrings.";
const NO_ROOM_EXCHANGE = "Sorry, your inventory's too full of stuff.";

for (const [option, line] of [["Talk-to", NO_ROOM_TALK], ["Exchange", NO_ROOM_EXCHANGE]]) {
  test(`${option}: no room for the bow strings says the transcript's line, takes nothing and keeps the allowance`, (t) => {
    const { player } = actor(t);
    claimUpTo(player, "easy");
    // A flax stack larger than the swap stays in place, so there is no slot for the strings.
    inventory(player).add(notedFlax(31), false);
    fillUp(player);
    click(player, option);
    spoken(player);
    assert.equal(pending(player)?.title, "Swap 30 flax notes for bowstrings?");
    answer(player, AGREE);
    assert.ok(spoken(player).includes(line), `says "${line}"`);
    assert.equal(count(player, NOTED_FLAX), 31);
    assert.equal(count(player, NOTED_BOW_STRING), 0);
    assert.equal(Rewards.dailyUses(player, "flax-keeper"), 0);
  });
}

test("a flax stack that the swap empties frees the slot: a full inventory still swaps", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(30), false);
  fillUp(player);
  click(player, "Talk-to");
  spoken(player);
  answer(player, AGREE);
  assert.equal(count(player, NOTED_FLAX), 0);
  assert.equal(count(player, NOTED_BOW_STRING), 30);
  assert.equal(Rewards.dailyUses(player, "flax-keeper"), 1);
});

test("a bow string stack with other metadata on a full inventory: nothing is lost", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(new core.Item(NOTED_BOW_STRING, 5).setMetaValue(core.Item.UNTRADEABLE_META, true), false);
  inventory(player).add(notedFlax(31), false);
  fillUp(player);
  click(player, "Talk-to");
  spoken(player);
  answer(player, AGREE);
  assert.equal(count(player, NOTED_FLAX), 31, "no flax is taken");
  assert.equal(count(player, NOTED_BOW_STRING), 5, "and no strings were added to the restricted stack");
  assert.equal(Rewards.dailyUses(player, "flax-keeper"), 0, "the allowance is kept");
});

test("a bow string stack near the cap on a full inventory: nothing is lost", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(new core.Item(NOTED_BOW_STRING, 2147483640), false);
  inventory(player).add(notedFlax(31), false);
  fillUp(player);
  click(player, "Talk-to");
  spoken(player);
  answer(player, AGREE);
  assert.equal(count(player, NOTED_FLAX), 31);
  assert.equal(count(player, NOTED_BOW_STRING), 2147483640);
  assert.equal(Rewards.dailyUses(player, "flax-keeper"), 0);
});

/** Runs a swap with the clock at `iso`. */
function swapAt(t, player, iso) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(iso) });
  click(player, "Talk-to");
  spoken(player);
  answer(player, AGREE);
}

test("the allowance is the UTC day: used at 23:59 UTC, offered again from 00:00 UTC", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(90), false);
  swapAt(t, player, "2026-11-04T23:59:30Z");
  assert.equal(count(player, NOTED_BOW_STRING), 30);
  player.getDialogueManager().reset?.();
  t.mock.timers.setTime(Date.parse("2026-11-04T23:59:59Z"));
  click(player, "Talk-to");
  assert.match(spoken(player).join("\n"), USED_UP, "still the same UTC day");
  player.getDialogueManager().reset?.();
  t.mock.timers.setTime(Date.parse("2026-11-05T00:00:00Z"));
  click(player, "Talk-to");
  spoken(player);
  assert.equal(pending(player)?.title, "Swap 30 flax notes for bowstrings?", "offered again on the new UTC day");
  answer(player, AGREE);
  assert.equal(count(player, NOTED_BOW_STRING), 60);
});

test("an offer opened before midnight UTC and agreed after swaps once and counts for the new day", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(90), false);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-04T23:59:50Z") });
  click(player, "Talk-to");
  spoken(player);
  assert.equal(pending(player)?.title, "Swap 30 flax notes for bowstrings?");
  t.mock.timers.setTime(Date.parse("2026-11-05T00:00:05Z"));
  answer(player, AGREE);
  assert.equal(count(player, NOTED_BOW_STRING), 30, "swapped once");
  assert.equal(Rewards.dailyUses(player, "flax-keeper"), 1);
  assert.equal(player.getAttribute(Rewards.DAILY_ATTRIBUTE).day, "2026-11-05", "counted for the new day");
  player.getDialogueManager().reset?.();
  click(player, "Talk-to");
  assert.match(spoken(player).join("\n"), USED_UP);
});

test("the day's allowance survives a save and reload, and a different day clears it", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(notedFlax(30), false);
  swapAt(t, player, "2026-11-04T12:00:00Z");
  const reloaded = new Player(null);
  PlayerSave.fromPlayer(player).applyToPlayer(reloaded);
  assert.equal(Rewards.dailyUses(reloaded, "flax-keeper"), 1, "used today after reload");
  t.mock.timers.setTime(Date.parse("2026-11-05T00:00:01Z"));
  assert.equal(Rewards.dailyUses(reloaded, "flax-keeper"), 0, "unused on the next UTC day");
});

test("preset noted flax cannot be swapped for clean bow strings", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(preset(notedFlax(30)), false);
  click(player, "Talk-to");
  spoken(player);
  assert.equal(pending(player), null, "restricted flax is not flax the keeper can take");
  assert.equal(count(player, NOTED_BOW_STRING), 0);
  assert.equal(count(player, NOTED_FLAX), 30);
});

test("a clean stack is taken when a preset stack sits beside it, and the preset one is left", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  inventory(player).add(preset(notedFlax(30)), false);
  inventory(player).add(notedFlax(30), false);
  click(player, "Talk-to");
  spoken(player);
  answer(player, AGREE);
  const left = inventory(player).getItems().filter((item) => item && item.getId() === NOTED_FLAX);
  assert.equal(left.length, 1, "one flax stack remains");
  assert.equal(left[0].isPresetItem(), true, "the preset one was not consumed");
  assert.equal(count(player, NOTED_BOW_STRING), 30);
});
