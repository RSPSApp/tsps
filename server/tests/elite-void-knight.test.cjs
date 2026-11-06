// Run after `yarn build`: node --test tests/elite-void-knight.test.cjs
//
// The Elite Void Knight (NPC 5513, the Void Knights' Outpost) upgrades a Void knight top or robe to the
// elite one for 200 Commendation points once the Hard Western Provinces diary is done. Evidence:
//  - rsprox 4016 (rev 237.1): the talk-to menu and lines, "Very well. Hand me the top or robe you
//    wish me to upgrade...", the elite top used on her answers "I'm afraid that cannot be upgraded.",
//    another item (a Void seal) answers "No thank you.". NOT captured: a successful upgrade (the
//    capturing player was already elite), the diary refusal, and what happens with too few points.
//  - the rest is the Wiki rule and the transcript in npc-dialogues.json ("Pay 200 Commendation points
//    to upgrade it?", "The Elite Void Knight upgrades your armour. Commendation points remaining: [number]").
// Real engine: every plugin loaded, a real Player, the real transcript runner and prompt, the real
// preset producer.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const PestRewards = require("../plugins/minigames/pestcontrol/Rewards.PestControl");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const ELITE_VOID_KNIGHT = 5513;
const COST = 200;
let core;
let I;
let next = 5100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("elitevoid" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2667, 2649, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function knight() {
  return core.NPC.create(ELITE_VOID_KNIGHT, new core.Location(2667, 2648, 0));
}

function finishHardWestern(player) {
  const diary = Diaries.BY_KEY.get("western");
  for (const task of diary.tiers.hard.tasks) DiaryProgress.completeTask(player, diary, task.key);
  assert.equal(DiaryProgress.isTierComplete(player, diary, "hard"), true, "the Hard Western Provinces diary is complete");
}

const points = (player) => PestRewards.getPoints(player);

/** The collection log's own answers, through its real event consumer. */
function logged(itemId) {
  const request = { itemId, logged: null };
  PluginManager.emitCustomEvent("collection-log:is-item", request);
  return request.logged === true;
}

function obtained(player, itemId) {
  const query = { player, itemId, count: 0 };
  PluginManager.emitCustomEvent("collection-log:obtained", query);
  return query.count ?? 0;
}
const real = (id) => new core.Item(id, 1);
const give = (player, ...items) => items.forEach((item) => player.getInventory().add(item, false));
const slotOf = (player, item) => player.getInventory().getItems().findIndex((entry) => entry && entry.equals(item));
const stored = (player, item) => {
  const slot = slotOf(player, item);
  assert.ok(slot >= 0, "the item is in the inventory");
  return player.getInventory().getItems()[slot];
};
const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0);
const ids = (player) => held(player).map((item) => item.getId()).sort((a, b) => a - b);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);

function preset(id) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const item = Presets._test.spawnPresetItem(new core.Item(id, 1), Presets.getGlobalPresetPool()[0]);
  assert.equal(item.isPresetItem(), true, "the producer marked the item");
  return item;
}

/** What the knight says, read from the real dialogue chain, stopping at a choice. */
function spoken(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue) lines.push(current.getText().replace(/\s+/g, " ").trim());
    if (current instanceof OptionDialogue) break;
    manager.advance();
  }
  return lines;
}

function talk(player) {
  const npc = knight();
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getId(), definition: npc.getDefinition(), clickType: 1, handled: false,
  });
}

function useOnKnight(player, itemValue) {
  const npc = knight();
  const item = stored(player, itemValue);
  return PluginManager.emitItemOnNpc({
    player, target: npc, definition: npc.getDefinition(), npcId: npc.getId(), item, itemId: item.getId(),
    slot: slotOf(player, item), handled: false,
  });
}

function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

function swapIn(player, original, replacement) {
  const slot = slotOf(player, original);
  assert.ok(slot >= 0, "the item to swap out is in the inventory");
  player.getInventory().deleteAtSlot(slot, 1, false);
  assert.equal(slotOf(player, original), -1, "the original is gone");
  player.getInventory().add(replacement, false);
  assert.ok(slotOf(player, replacement) >= 0, "the replacement is in");
}

test("before the Hard Western Provinces diary the knight refuses (transcript text)", (t) => {
  const { player } = actor(t);
  assert.equal(talk(player), true, "talking to her is answered");
  const lines = spoken(player);
  assert.match(lines.join("\n"), /I'm afraid I cannot offer to upgrade any Void Knight armour for you/);
  assert.doesNotMatch(lines.join("\n"), /Do you wish me to upgrade/);
});

test("after the diary she offers the upgrade (captured line)", (t) => {
  const { player } = actor(t);
  finishHardWestern(player);
  talk(player);
  assert.equal(spoken(player)[0], "Do you wish me to upgrade any Void Knight armour for you?");
});

for (const [name, plain, elite] of [["top", 8839, 13072], ["robe", 8840, 13073]]) {
  test(`${name}: asks first, and Okay upgrades that very ${name} and takes ${COST} points`, (t) => {
    const { player, messages } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(plain));
    const instance = stored(player, real(plain));
    assert.equal(useOnKnight(player, real(plain)), true, "the use is handled");
    assert.equal(pending(player)?.title, "Pay 200 Commendation points to upgrade it?");
    assert.equal(instance.getId(), plain, "nothing happens before the answer");
    assert.equal(points(player), 400);
    assert.equal(answer(player, 1), true, "Okay");
    assert.equal(player.getInventory().getItems()[slotOf(player, real(elite))], instance, "the same item instance was upgraded");
    assert.deepEqual(ids(player), [elite]);
    assert.equal(points(player), 400 - COST);
    assert.match(messages.join("\n"), /The Elite Void Knight upgrades your armour\. Commendation points remaining: 200/);
  });

  test(`${name}: a successful upgrade is recorded in the collection log, and nothing else is`, (t) => {
    const { player } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(plain));
    assert.equal(logged(elite), true, `the elite ${name} (${elite}) is an item of the cache's Pest Control log`);
    assert.equal(obtained(player, elite), 0, "not obtained yet");
    useOnKnight(player, real(plain));
    assert.equal(obtained(player, elite), 0, "asking is not obtaining");
    answer(player, 2);
    assert.equal(obtained(player, elite), 0, "Cancel is not obtaining");
    useOnKnight(player, real(plain));
    answer(player, 1);
    assert.equal(obtained(player, elite), 1, "the upgrade is logged once");
  });

  test(`${name}: a refused or failed upgrade is not logged`, (t) => {
    const { player } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, COST - 1);
    give(player, real(plain));
    useOnKnight(player, real(plain));
    assert.equal(obtained(player, elite), 0, "too few points");
    PestRewards.setPoints(player, 400);
    useOnKnight(player, real(plain));
    PestRewards.setPoints(player, 100);
    answer(player, 1);
    assert.equal(obtained(player, elite), 0, "points spent before Okay");
    const other = actor(t).player;
    finishHardWestern(other);
    PestRewards.setPoints(other, 400);
    give(other, preset(plain));
    useOnKnight(other, held(other)[0]);
    assert.equal(obtained(other, elite), 0, "a preset copy");
  });

  test(`${name}: Cancel changes nothing`, (t) => {
    const { player } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(plain));
    useOnKnight(player, real(plain));
    assert.equal(answer(player, 2), true, "Cancel");
    assert.deepEqual(ids(player), [plain]);
    assert.equal(points(player), 400);
  });

  test(`${name}: with fewer than ${COST} points there is no prompt and nothing is taken`, (t) => {
    const { player, messages } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, COST - 1);
    give(player, real(plain));
    useOnKnight(player, real(plain));
    assert.equal(pending(player), null, "no prompt is offered");
    assert.deepEqual(ids(player), [plain]);
    assert.equal(points(player), COST - 1);
    assert.ok(messages.length >= 1, "the player is told");
  });

  test(`${name}: before the diary the knight refuses and nothing is taken`, (t) => {
    const { player } = actor(t);
    PestRewards.setPoints(player, 400);
    give(player, real(plain));
    useOnKnight(player, real(plain));
    assert.equal(pending(player), null);
    assert.match(spoken(player).join("\n"), /do not satisfy the order's requirements|cannot offer to upgrade/);
    assert.deepEqual(ids(player), [plain]);
    assert.equal(points(player), 400);
  });

  test(`${name}: points spent between the prompt and Okay mean no upgrade and no success message`, (t) => {
    const { player, messages } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(plain));
    useOnKnight(player, real(plain));
    PestRewards.setPoints(player, 100);
    answer(player, 1);
    assert.deepEqual(ids(player), [plain]);
    assert.equal(points(player), 100);
    assert.doesNotMatch(messages.join("\n"), /upgrades your armour/);
  });

  test(`${name}: a preset ${name} is refused and keeps its restrictions`, (t) => {
    const { player, messages } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, preset(plain));
    useOnKnight(player, held(player)[0]);
    assert.equal(pending(player), null, "no prompt for a preset item");
    assert.deepEqual(ids(player), [plain]);
    assert.equal(held(player)[0].isPresetItem(), true);
    assert.equal(points(player), 400);
    assert.ok(messages.length >= 1);
  });

  test(`${name}: with a preset and a real ${name}, the one used is the one upgraded`, (t) => {
    const { player } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    const presetItem = preset(plain);
    give(player, presetItem, real(plain));
    useOnKnight(player, real(plain));
    answer(player, 1);
    const left = held(player);
    assert.deepEqual(left.map((item) => item.getId()).sort((a, b) => a - b), [plain, elite].sort((a, b) => a - b));
    assert.equal(left.find((item) => item.getId() === plain).isPresetItem(), true, "the preset one is untouched");
    assert.equal(left.find((item) => item.getId() === elite).isPresetItem(), false);
  });

  test(`${name}: a preset ${name} swapped in after the prompt is not upgraded at Okay`, (t) => {
    const { player, messages } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(plain));
    useOnKnight(player, real(plain));
    swapIn(player, real(plain), preset(plain));
    answer(player, 1);
    assert.deepEqual(ids(player), [plain]);
    assert.equal(held(player)[0].isPresetItem(), true);
    assert.equal(points(player), 400);
    assert.doesNotMatch(messages.join("\n"), /upgrades your armour/);
  });

  test(`${name}: the ${name} dropped after the prompt means no upgrade and no points taken`, (t) => {
    const { player } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(plain));
    useOnKnight(player, real(plain));
    player.getInventory().deleteAtSlot(slotOf(player, real(plain)), 1, false);
    answer(player, 1);
    assert.deepEqual(ids(player), []);
    assert.equal(points(player), 400);
  });
}

test("an elite top or robe cannot be upgraded again (captured with the elite top)", (t) => {
  for (const id of [13072, 13073]) {
    const { player } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(id));
    useOnKnight(player, real(id));
    assert.equal(pending(player), null);
    assert.deepEqual(spoken(player), ["I'm afraid that cannot be upgraded."]);
    assert.deepEqual(ids(player), [id]);
    assert.equal(points(player), 400);
  }
});

test("an ornamented void top or robe cannot be upgraded either", (t) => {
  for (const id of [I.VOID_KNIGHT_TOP_OR_, I.VOID_KNIGHT_ROBE_OR_]) {
    const { player } = actor(t);
    finishHardWestern(player);
    PestRewards.setPoints(player, 400);
    give(player, real(id));
    useOnKnight(player, real(id));
    assert.deepEqual(spoken(player), ["I'm afraid that cannot be upgraded."]);
    assert.deepEqual(ids(player), [id]);
    assert.equal(points(player), 400);
  }
});

test("any other item gets 'No thank you.' (captured with a Void seal)", (t) => {
  const { player } = actor(t);
  finishHardWestern(player);
  PestRewards.setPoints(player, 400);
  give(player, real(11667));
  useOnKnight(player, real(11667));
  assert.deepEqual(spoken(player), ["No thank you."]);
  assert.deepEqual(ids(player), [11667]);
  assert.equal(points(player), 400);
});
