// Run after `yarn build`: node --test tests/lesser-fanatic-ecumenical-keys.test.cjs
//
// The Lesser Fanatic buys ecumenical keys for 61,500 coins each once the hard Wilderness reward is
// claimed (OSRS Wiki: Wilderness Diary, Transcript:Lesser Fanatic). Real engine: every plugin loaded, a
// real Player and Inventory, the real transcript runner and real NPC dispatch.
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

const FANATIC = 5514;
const KEY = 11942;
const COINS = 995;
const SELL = "I'd like to sell ecumenical keys.";
let core;
let next = 7600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  assert.equal(core.CacheDefinitions.getNpcId("lesser_fanatic_diary"), FANATIC);
  assert.equal(core.ItemDefinition.forId(KEY).getName(), "Ecumenical key");
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("fanatic" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3091, 3477, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function claimUpTo(player, tier) {
  const diary = Diaries.BY_KEY.get("wilderness");
  for (const name of Diaries.TIERS.slice(0, Diaries.TIERS.indexOf(tier) + 1)) DiaryProgress.claimTier(player, diary, name);
}

/** Lines shown until the next menu (or the end), item boxes as "box <ids>: text"; returns them and the menu's options. */
function read(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40; i++) {
    const pending = core.MultiChatboxPrompt.getPending(player);
    if (pending) return { lines, options: pending.options };
    if (!manager.isActive()) break;
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) {
      lines.push(current.getText().replace(/\s+/g, " ").trim());
    } else if (typeof current?.getItemIds === "function") {
      lines.push(`box ${current.getItemIds().join(",")}: ${current.getText()}`);
    }
    if (current instanceof OptionDialogue) return { lines, options: current.getOptions() };
    manager.advance();
  }
  return { lines, options: null };
}

function choose(player, options, wanted) {
  const index = options.indexOf(wanted);
  assert.ok(index >= 0, `missing ${wanted}: ${JSON.stringify(options)}`);
  const P = core.MultiChatboxPrompt;
  assert.equal(P.handleInterfaceActionClick({ player, buttonId: P.OPTIONS_WIDGET_ID, groupId: 219, slot: index + 1 }), true);
}

function talk(player) {
  const npc = core.NPC.create(FANATIC, new core.Location(3091, 3478, 0));
  const definition = npc.getCurrentDefinition(player);
  const clickType = definition.getActions().indexOf("Talk-to") + 1;
  assert.ok(clickType > 0);
  assert.equal(PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getContentId(player), definition, clickType, handled: false,
  }), true);
  return read(player);
}

const held = (player, id) => player.getInventory().getAmount(id);
function give(player, count) {
  for (let i = 0; i < count; i++) player.getInventory().adds(KEY, 1);
}

test("before the hard reward he only says hello and buys nothing", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "medium");
  give(player, 2);
  const { lines, options } = talk(player);
  assert.deepEqual(lines, ["Hello!"]);
  assert.ok(options.includes("Who are you?"), JSON.stringify(options));
  assert.ok(!options.includes(SELL), JSON.stringify(options));
});

test("with the hard reward and no key he refuses", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "hard");
  const first = talk(player);
  assert.match(first.lines[0], /^Hello again! .*sell me ecumenical keys\?$/);
  assert.ok(!first.options.includes("Who are you?"), JSON.stringify(first.options));
  choose(player, first.options, SELL);
  const { lines } = read(player);
  assert.deepEqual(lines, [SELL, "You should bring them to me, if so. I'm not buying something I can't see you carrying."]);
  assert.equal(held(player, COINS), 0);
});

test("one key: Confirm sells it for 61,500 coins in a key and coins box, Cancel keeps it", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "hard");
  give(player, 1);
  choose(player, talk(player).options, SELL);
  let confirm = read(player);
  assert.deepEqual(confirm.options, ["Confirm", "Cancel"]);
  choose(player, confirm.options, "Cancel");
  assert.equal(held(player, KEY), 1);
  assert.equal(held(player, COINS), 0);

  choose(player, talk(player).options, SELL);
  confirm = read(player);
  choose(player, confirm.options, "Confirm");
  const after = read(player);
  assert.deepEqual(after.lines, [`box ${KEY},${COINS}: You sell the key to the Fanatic.`]);
  assert.ok(after.options.includes(SELL), JSON.stringify(after.options));
  assert.equal(held(player, KEY), 0);
  assert.equal(held(player, COINS), 61500);
  assert.ok(!messages.some((m) => /You sell/.test(m)), JSON.stringify(messages));
});

test("one key gone before Confirm sells nothing", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "elite");
  give(player, 1);
  choose(player, talk(player).options, SELL);
  const confirm = read(player);
  player.getInventory().deleteNumber(KEY, 1);
  choose(player, confirm.options, "Confirm");
  read(player);
  assert.equal(held(player, COINS), 0);
  assert.ok(!messages.includes("You sell the key to the Fanatic."), JSON.stringify(messages));
});

test("several keys: the count input sells up to the keys held, then the box and the first menu", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "hard");
  give(player, 3);
  choose(player, talk(player).options, SELL);
  const { lines } = read(player);
  assert.deepEqual(lines, [SELL]);
  const prompt = player.getEnteredAmountAction();
  assert.ok(prompt, "count input open");
  prompt.execute(2);
  assert.equal(held(player, KEY), 1);
  assert.equal(held(player, COINS), 123000);
  const after = read(player);
  assert.deepEqual(after.lines, [`box ${KEY},${COINS}: You sell 2 keys to the Fanatic.`]);
  assert.ok(after.options.includes(SELL) && after.options.includes("Can I have another sword?"), JSON.stringify(after.options));
  assert.ok(!messages.some((m) => /You sell/.test(m)), JSON.stringify(messages));

  give(player, 2);
  choose(player, talk(player).options, SELL);
  read(player);
  player.getEnteredAmountAction().execute(10);
  assert.equal(held(player, KEY), 0);
  assert.equal(held(player, COINS), 123000 + 3 * 61500);
  assert.deepEqual(read(player).lines, [`box ${KEY},${COINS}: You sell 3 keys to the Fanatic.`]);
});

test("a count of 0 sells nothing, and the coin stack cannot overflow", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "hard");
  give(player, 2);
  choose(player, talk(player).options, SELL);
  read(player);
  player.getEnteredAmountAction().execute(0);
  assert.equal(held(player, KEY), 2);

  player.getInventory().adds(COINS, 2147483647 - 100000);
  choose(player, talk(player).options, SELL);
  read(player);
  player.getEnteredAmountAction().execute(2);
  assert.equal(held(player, KEY), 2);
  assert.equal(held(player, COINS), 2147483647 - 100000);
  assert.ok(messages.includes("You don't have enough inventory space."), JSON.stringify(messages));
});

test("a count answered after moving away sells nothing", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "hard");
  give(player, 2);
  choose(player, talk(player).options, SELL);
  read(player);
  const prompt = player.getEnteredAmountAction();
  assert.ok(prompt, "count input open");
  player.setLocation(new core.Location(3222, 3218, 0));
  prompt.execute(2);
  assert.equal(held(player, KEY), 2);
  assert.equal(held(player, COINS), 0);
  assert.ok(!messages.some((m) => /You sell/.test(m)), JSON.stringify(messages));
});
