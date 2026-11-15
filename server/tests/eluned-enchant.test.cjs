// Run after `yarn build`: node --test tests/eluned-enchant.test.cjs
// Eluned's Enchant (Wiki: Teleport crystal, Crystal teleport seed, Transcript:Eluned): every carried
// crystal teleport seed becomes a teleport crystal (3), or (5) after the hard Western Provinces Diary,
// for 750 coins falling by 150 a seed to 150. Real engine: every plugin loaded, a real Player and the
// real transcript runner.
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
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");

const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Eluned = require("../plugins/npcs/ElunedEnchant.plugin");

/** eluned_prif: Talk-to, Enchant. */
const ELUNED = 9145;
const SEED = 6103;
const CRYSTAL_3 = 6100;
const CRYSTAL_5 = 13102;
const COINS = 995;
const CHANTED = "Although you can't hear anything, your crystals have been chanted.";
const NOTHING = "You don't seem to have any crystals I can enchant. Return when you do.";
let core;
let next = 7700;

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
  player.setUsername("eluned" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3229, 6061, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function completeWesternHard(player) {
  const diary = Diaries.BY_KEY.get("western");
  for (const tier of ["easy", "medium", "hard"]) {
    for (const task of diary.tiers[tier].tasks) DiaryProgress.completeTask(player, diary, task.key);
  }
}

/**
 * The conversation as shown: NPC lines and item boxes, continuing through each. A held entry (her
 * chant) is not continued: the game ticks until it moves on, and `ticks` records what each tick did.
 */
function shown(player, ticks = []) {
  const out = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof ActionDialogue) {
      out.push("held");
      for (let tick = 1; tick <= 20 && manager.getCurrent() === current; tick++) {
        const before = [count(player, SEED), count(player, COINS)];
        core.TaskManager.process();
        const after = [count(player, SEED), count(player, COINS)];
        if (before.some((v, k) => v !== after[k])) ticks.push({ tick, seeds: after[0], coins: after[1] });
        if (manager.getCurrent() !== current) ticks.push({ tick, box: true });
      }
      assert.notEqual(manager.getCurrent(), current, "the chant moves on by itself");
      continue;
    }
    if (current instanceof NpcDialogue) out.push(`npc:${current.getText().replace(/\s+/g, " ").trim()}`);
    if (current instanceof ItemStatementDialogue) out.push(`box:${current.getItemId?.() ?? current.itemId}:${current.getText?.() ?? current.text}`);
    manager.advance();
  }
  return out;
}

function enchant(player) {
  const npc = core.NPC.create(ELUNED, new core.Location(3229, 6062, 0));
  const definition = npc.getCurrentDefinition(player);
  const clickType = definition.getActions().indexOf("Enchant") + 1;
  assert.ok(clickType > 0, "eluned_prif has Enchant");
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getContentId(player), definition, clickType, handled: false,
  });
}

const give = (player, id, amount) => player.getInventory().add(new core.Item(id, amount), false);
const count = (player, id) => player.getInventory().getAmount(id);

test("the fee is 750 falling by 150 a seed to 150, each seed at its own place in the count", () => {
  const { feeFor } = Eluned._test;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(feeFor), [750, 600, 450, 300, 150, 150, 150]);
});

test("without a seed she has nothing to enchant and takes nothing", (t) => {
  const { player } = actor(t);
  give(player, COINS, 1000);
  assert.equal(enchant(player), true);
  assert.deepEqual(shown(player), [`npc:${NOTHING}`]);
  assert.equal(count(player, COINS), 1000);
});

test("one seed becomes a teleport crystal (3) for 750, then the next for 600", (t) => {
  const { player } = actor(t);
  give(player, COINS, 2000);
  give(player, SEED, 1);
  assert.equal(enchant(player), true);
  assert.deepEqual(shown(player), ["held", `box:${CRYSTAL_3}:${CHANTED}`]);
  assert.equal(count(player, SEED), 0);
  assert.equal(count(player, CRYSTAL_3), 1);
  assert.equal(count(player, COINS), 1250);
  give(player, SEED, 1);
  enchant(player);
  shown(player);
  assert.equal(count(player, COINS), 650);
  assert.equal(count(player, CRYSTAL_3), 2);
  assert.equal(player.getAttribute(Eluned._test.RECHARGES_ATTRIBUTE), 2);
});

test("every carried seed is enchanted, one a tick after the chant, paying 750 + 600 + 450", (t) => {
  // rsprox capture local 1000233: chant line, four ticks later one seed a tick, then the box.
  const { player } = actor(t);
  give(player, COINS, 1800);
  for (let i = 0; i < 3; i++) give(player, SEED, 1);
  enchant(player);
  const ticks = [];
  assert.deepEqual(shown(player, ticks), ["held", `box:${CRYSTAL_3}:${CHANTED}`]);
  const first = Eluned._test.CHANT_TICKS;
  assert.deepEqual(ticks, [
    { tick: first, seeds: 2, coins: 1050 },
    { tick: first + 1, seeds: 1, coins: 450 },
    { tick: first + 2, seeds: 0, coins: 0 },
    { tick: first + 3, box: true },
  ]);
  assert.equal(count(player, SEED), 0);
  assert.equal(count(player, CRYSTAL_3), 3);
  assert.equal(count(player, COINS), 0);
});

test("after the hard Western Provinces Diary the crystal holds 5 charges", (t) => {
  const { player } = actor(t);
  completeWesternHard(player);
  give(player, COINS, 750);
  give(player, SEED, 1);
  enchant(player);
  assert.deepEqual(shown(player), ["held", `box:${CRYSTAL_5}:${CHANTED}`]);
  assert.equal(count(player, CRYSTAL_5), 1);
  assert.equal(count(player, CRYSTAL_3), 0);
});

test("too few coins for every seed enchants none and she says there is not enough money", (t) => {
  // rsprox capture local 1000233: seeds, no coins, "I'm afraid you don't have enough money."
  const { player, messages } = actor(t);
  give(player, COINS, 1000);
  give(player, SEED, 1);
  give(player, SEED, 1);
  assert.equal(enchant(player), true);
  assert.deepEqual(shown(player), [`npc:${Eluned._test.TOO_FEW_COINS}`]);
  assert.equal(count(player, SEED), 2);
  assert.equal(count(player, COINS), 1000);
  assert.deepEqual(messages, []);
});

test("closing the chant stops it; the seeds already done stay done", (t) => {
  const { player } = actor(t);
  give(player, COINS, 1800);
  for (let i = 0; i < 3; i++) give(player, SEED, 1);
  enchant(player);
  const manager = player.getDialogueManager();
  assert.ok(manager.getCurrent() instanceof ActionDialogue, "the chant is showing");
  for (let i = 0; i < Eluned._test.CHANT_TICKS; i++) core.TaskManager.process();
  assert.equal(count(player, SEED), 2);
  manager.reset();
  for (let i = 0; i < 5; i++) core.TaskManager.process();
  assert.equal(count(player, SEED), 2);
  assert.equal(count(player, CRYSTAL_3), 1);
  assert.equal(count(player, COINS), 1050);
});
