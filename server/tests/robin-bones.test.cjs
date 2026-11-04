// Run after `yarn build`: node --test tests/robin-bones.test.cjs
//
// Robin (NPC 2995, the Green Ghost, Port Phasmatys) turns bones into bonemeal and buckets of slime for a
// Morytania diary reward: 13 / 26 / 39 a day (medium / hard / elite; Wiki: Robin, Morytania Diary rewards).
// Evidence:
//  - rsprox 703 (rev 229) and 1857 (rev 227): the third option (Claim-slime) with the player's bones: the bones
//    become that kind's bonemeal in their own slots, one bucket of slime per bone goes to the next free slots,
//    varbit 4543 (MORYTANIA_SLIME_CLAIMED) counts up by one per bone, the game message "You have claimed 11/39
//    buckets of slime and bonemeal today." then the item box "Robin hands you some buckets of slime and
//    bonemeal." (items 4286 and 4255). 1857: with no bones Robin says "You do not have any bones for me to
//    convert for you."; claims of 10, 10, 10 and 9 reach 39/39.
//  - NOT captured: the diary refusal, the daily-limit and no-space lines (the Wiki transcript's), a claim
//    with more bones than the day has left (taken up to what is left: inferred), noted, preset or restricted
//    bones (not accepted: inferred from the Wiki), the tier (the highest claimed from the diary master:
//    inferred; the captured player had the elite one) and the midnight reset online (the varbit goes back to 0
//    at 00:00 UTC: from the Wiki's daily limit).
//  - Left out on purpose: the capture also logs the box text as a mesbox chat message; the server shows the
//    box only.
// Real engine: every plugin loaded, a real Player and Inventory, the real transcript runner, real NPC
// dispatch for Claim-slime, the real TaskManager for the reset.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Rewards = require("../plugins/items/diaryrewards/Common.DiaryRewards");

const ROBIN = 2995;
const SLIME_VARBIT = 4543;
const BUCKET_OF_SLIME = 4286;
const BONEMEAL = 4255;
const DAILY_KEY = "robin-slime";
const LIMITS = { medium: 13, hard: 26, elite: 39 };
let core;
let I;
let next = 7100;

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
  player.setUsername("robin" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3675, 3493, 0));
  player.needsPlacement = false;
  const messages = [];
  const varbits = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  t.mock.method(player.getPacketSender(), "sendVarbit", (id, value) => {
    varbits.push([id, value]);
    return player.getPacketSender();
  });
  return { player, messages, varbits };
}

function claimUpTo(player, tier) {
  const diary = Diaries.BY_KEY.get("morytania");
  for (const name of Diaries.TIERS.slice(0, Diaries.TIERS.indexOf(tier) + 1)) DiaryProgress.claimTier(player, diary, name);
}

const inventory = (player) => player.getInventory();
const slots = (player) => inventory(player).getItems().map((item) => (item && item.getId() > 0 ? item.getId() : null));
const slotsOf = (player, id) => slots(player).flatMap((value, slot) => (value === id ? [slot] : []));
const give = (player, id, amount = 1) => { for (let i = 0; i < amount; i++) inventory(player).add(new core.Item(id, 1), false); };
const used = (player) => Rewards.dailyUses(player, DAILY_KEY);

/** The counter varbit's sends only: claiming a diary tier also sends its own reward varbits. */
const slimeVarbits = (varbits) => varbits.filter(([id]) => id === SLIME_VARBIT);

/** The production login and logout events carry the username; hooks drop events without it. */
const login = (player) => PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
const logout = (player) => PluginManager.emitPlayerLogout({ player, username: player.getUsername() });

/** Puts the claim's results away, as the capture's player did between claims (a bank trip). */
function bankResults(player) {
  for (const id of [BUCKET_OF_SLIME, ...BONEMEAL_IDS()]) inventory(player).deleteNumber(id, 28);
  inventory(player).refreshItems();
}

const BONEMEAL_IDS = () => ["BONEMEAL", "BIG_BONEMEAL", "BAT_BONEMEAL", "DRAGON_BONEMEAL"].map((name) => I[name]);

function preset(item) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const made = Presets._test.spawnPresetItem(item, Presets.getGlobalPresetPool()[0]);
  assert.equal(made.isPresetItem(), true, "the producer marked the item");
  return made;
}

/** What Robin says, read from the real dialogue chain. */
function spoken(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue) lines.push(current.getText().replace(/\s+/g, " ").trim());
    if (current instanceof DoubleItemStatementDialogue) break;
    manager.advance();
  }
  return lines;
}

function claimSlime(player) {
  const npc = core.NPC.create(ROBIN, new core.Location(3675, 3492, 0));
  const clickType = npc.getDefinition().getActions().indexOf("Claim-slime") + 1;
  assert.ok(clickType > 0, 'Robin has a "Claim-slime" option');
  assert.equal(clickType, 3, "as captured, the third option");
  return PluginManager.emitNpcInteraction({
    player, npc, npcId: npc.getId(), definition: npc.getDefinition(), clickType, handled: false,
  });
}

const claimed = (n, limit) => `You have claimed ${n}/${limit} buckets of slime and bonemeal today.`;
const NO_BONES = "You do not have any bones for me to convert for you.";
const NO_DIARY = "Sorry, my orders are that I can only give slime to those who have completed the Morytania medium, hard or elite diaries.";
const LIMIT_REACHED = "You have already claimed your daily slime and bonemeal. Come back again tomorrow for some more.";
const NO_SPACE = "You do not have enough space for both bonemeal and slime. Come back to me when you have space.";

test("as captured (rsprox 703): 11 dragon bones become dragon bonemeal in their own slots, with 11 buckets of slime after", (t) => {
  const { player, messages, varbits } = actor(t);
  claimUpTo(player, "elite");
  give(player, I.DRAGON_BONES, 11);
  const boneSlots = slotsOf(player, I.DRAGON_BONES);
  assert.equal(boneSlots.length, 11);
  assert.equal(claimSlime(player), true);
  assert.deepEqual(slotsOf(player, I.DRAGON_BONEMEAL), boneSlots, "bonemeal replaces each bone in place");
  assert.deepEqual(slotsOf(player, BUCKET_OF_SLIME), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], "slime fills the next free slots");
  assert.equal(slotsOf(player, I.DRAGON_BONES).length, 0);
  assert.deepEqual(slimeVarbits(varbits), Array.from({ length: 11 }, (_, i) => [SLIME_VARBIT, i + 1]), "the counter climbs one per bone");
  assert.ok(messages.includes(claimed(11, 39)), "the game message");
  const box = player.getDialogueManager().getCurrent();
  assert.ok(box instanceof DoubleItemStatementDialogue, "then the item box");
  assert.deepEqual(box.getItemIds(), [BUCKET_OF_SLIME, BONEMEAL]);
  assert.equal(box.getText(), "Robin hands you some buckets of slime and bonemeal.");
  assert.equal(used(player), 11);
});

test("as captured (rsprox 703): a second claim the same day reads 22/39", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "elite");
  give(player, I.DRAGON_BONES, 11);
  claimSlime(player);
  player.getDialogueManager().reset?.();
  bankResults(player);
  give(player, I.DRAGON_BONES, 11);
  claimSlime(player);
  assert.ok(messages.includes(claimed(22, 39)));
  assert.equal(slotsOf(player, I.DRAGON_BONEMEAL).length, 11, "the first 11 were banked; the second claim made 11");
});

for (const [tier, limit] of Object.entries(LIMITS)) {
  test(`${tier}: the day's limit is ${limit}`, (t) => {
    const { player, messages } = actor(t);
    claimUpTo(player, tier);
    give(player, I.BONES, 3);
    claimSlime(player);
    assert.ok(messages.includes(claimed(3, limit)));
  });
}

test("the highest claimed tier decides the limit", (t) => {
  const { player, messages } = actor(t);
  const diary = Diaries.BY_KEY.get("morytania");
  DiaryProgress.claimTier(player, diary, "medium");
  DiaryProgress.claimTier(player, diary, "hard");
  give(player, I.BONES, 1);
  claimSlime(player);
  assert.ok(messages.includes(claimed(1, 26)));
});

test("bones of any kind: each becomes its own bonemeal", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES);
  give(player, I.BIG_BONES);
  give(player, I.BAT_BONES);
  claimSlime(player);
  assert.deepEqual(slots(player).slice(0, 3), [I.BONEMEAL, I.BIG_BONEMEAL, I.BAT_BONEMEAL]);
  assert.deepEqual(slotsOf(player, BUCKET_OF_SLIME), [3, 4, 5]);
});

test("as captured (rsprox 1857): no bones, Robin says so and nothing changes", (t) => {
  const { player, varbits } = actor(t);
  claimUpTo(player, "elite");
  claimSlime(player);
  assert.deepEqual(spoken(player), [NO_BONES]);
  assert.equal(used(player), 0);
  assert.deepEqual(slimeVarbits(varbits), []);
});

test("without the medium diary claimed: the transcript's refusal, nothing taken", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "easy");
  give(player, I.BONES, 3);
  claimSlime(player);
  assert.deepEqual(spoken(player), [NO_DIARY, "There's a diary master in Canifis, go and speak to her."]);
  assert.equal(slotsOf(player, I.BONES).length, 3);
  assert.equal(used(player), 0);
});

test("noted bones are not accepted", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "medium");
  const noted = ItemDefinition.forId(I.BONES).getNoteId();
  inventory(player).add(new core.Item(noted, 5), false);
  claimSlime(player);
  assert.deepEqual(spoken(player), [NO_BONES]);
  assert.equal(inventory(player).getAmount(noted), 5);
});

test("a preset bone is not accepted and keeps its restrictions; a clean bone beside it is", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "medium");
  inventory(player).add(preset(new core.Item(I.BONES, 1)), false);
  claimSlime(player);
  assert.deepEqual(spoken(player), [NO_BONES]);
  assert.equal(inventory(player).getItems()[0].isPresetItem(), true);
  player.getDialogueManager().reset?.();
  give(player, I.BONES);
  claimSlime(player);
  assert.equal(inventory(player).getItems()[0].getId(), I.BONES, "the preset bone is untouched");
  assert.equal(inventory(player).getItems()[1].getId(), I.BONEMEAL, "the clean one was converted");
  assert.equal(used(player), 1);
});

test("the daily limit reached: the transcript's line and nothing taken", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES, 13);
  claimSlime(player);
  assert.equal(used(player), 13);
  player.getDialogueManager().reset?.();
  give(player, I.BONES, 2);
  claimSlime(player);
  assert.deepEqual(spoken(player), [LIMIT_REACHED]);
  assert.equal(slotsOf(player, I.BONES).length, 2);
  assert.equal(used(player), 13);
});

test("more bones than the day has left: only what is left is converted (inferred)", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES, 10);
  claimSlime(player);
  player.getDialogueManager().reset?.();
  bankResults(player);
  give(player, I.BONES, 10);
  claimSlime(player);
  assert.ok(messages.includes(claimed(13, 13)));
  assert.equal(used(player), 13);
  assert.equal(slotsOf(player, I.BONES).length, 7, "seven bones are left over");
});

test("not enough free slots for the slime: the transcript's line, nothing taken, allowance kept", (t) => {
  const { player } = actor(t);
  claimUpTo(player, "elite");
  give(player, I.BONES, 10);
  for (let id = 1038; inventory(player).getFreeSlots() > 9; id += 2) inventory(player).add(new core.Item(id, 1), false);
  assert.equal(inventory(player).getFreeSlots(), 9, "setup: one slot short of ten buckets");
  claimSlime(player);
  assert.deepEqual(spoken(player), [NO_SPACE]);
  assert.equal(slotsOf(player, I.BONES).length, 10);
  assert.equal(slotsOf(player, BUCKET_OF_SLIME).length, 0);
  assert.equal(used(player), 0);
});

test("enough slots exactly: ten bones, ten free slots", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "elite");
  give(player, I.BONES, 10);
  for (let id = 1038; inventory(player).getFreeSlots() > 10; id += 2) inventory(player).add(new core.Item(id, 1), false);
  claimSlime(player);
  assert.ok(messages.includes(claimed(10, 39)));
  assert.equal(inventory(player).getFreeSlots(), 0);
});

/** Game ticks through the real TaskManager. */
function tick(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

const BEFORE_MIDNIGHT = Date.UTC(2026, 10, 3, 23, 59, 0);
const AFTER_MIDNIGHT = Date.UTC(2026, 10, 4, 0, 0, 1);

test("the UTC day: used at 23:00, claimable again after 00:00 UTC, and the counter varbit goes back to 0 online", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: BEFORE_MIDNIGHT });
  const { player, varbits } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES, 13);
  claimSlime(player);
  assert.equal(used(player), 13);
  varbits.length = 0;
  t.mock.timers.setTime(AFTER_MIDNIGHT);
  tick(120);
  assert.deepEqual(slimeVarbits(varbits).at(-1), [SLIME_VARBIT, 0], "the counter is cleared without a relog");
  assert.equal(used(player), 0);
  player.getDialogueManager().reset?.();
  give(player, I.BONES, 1);
  claimSlime(player);
  assert.equal(used(player), 1);
  logout(player);
});

test("ordinary travel cancelling the player's tasks does not cancel the midnight reset", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: BEFORE_MIDNIGHT });
  const { player, varbits } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES, 2);
  claimSlime(player);
  TaskManager.cancelTasks(player);
  varbits.length = 0;
  t.mock.timers.setTime(AFTER_MIDNIGHT);
  tick(120);
  assert.deepEqual(slimeVarbits(varbits).at(-1), [SLIME_VARBIT, 0]);
  logout(player);
});

test("logging out cancels the reset", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: BEFORE_MIDNIGHT });
  const { player, varbits } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES, 2);
  claimSlime(player);
  logout(player);
  varbits.length = 0;
  t.mock.timers.setTime(AFTER_MIDNIGHT);
  tick(120);
  assert.deepEqual(varbits, [], "nothing is sent to a player who has gone");
});

test("login sends today's count, and a repeat login or claim leaves exactly one reset", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: BEFORE_MIDNIGHT });
  const { player, varbits } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES, 4);
  claimSlime(player);
  varbits.length = 0;
  login(player);
  login(player);
  assert.deepEqual(slimeVarbits(varbits).at(-1), [SLIME_VARBIT, 4], "login sends today's count");
  varbits.length = 0;
  t.mock.timers.setTime(AFTER_MIDNIGHT);
  tick(120);
  assert.equal(slimeVarbits(varbits).filter(([, value]) => value === 0).length, 1, "one reset fired, not two");
  logout(player);
});

test("giant, bull and sun-kissed bones are not accepted and stay put", (t) => {
  const { player, varbits } = actor(t);
  claimUpTo(player, "elite");
  const excluded = [core.CacheDefinitions.getObjId("giant_bones"), core.CacheDefinitions.getObjId("bull_bones"), I.SUN_KISSED_BONES];
  for (const id of excluded) {
    assert.ok(Number.isInteger(id) && id > 0, `bone ${id} resolves`);
    give(player, id);
  }
  claimSlime(player);
  assert.deepEqual(spoken(player), [NO_BONES]);
  assert.deepEqual(slots(player).slice(0, 3), excluded, "all three are untouched");
  assert.equal(slotsOf(player, BUCKET_OF_SLIME).length, 0);
  assert.equal(used(player), 0);
  assert.deepEqual(slimeVarbits(varbits), []);
});

test("excluded bones beside accepted ones are left while the accepted are converted", (t) => {
  const { player, messages } = actor(t);
  claimUpTo(player, "elite");
  give(player, I.SUN_KISSED_BONES);
  give(player, I.BONES);
  claimSlime(player);
  assert.deepEqual(slots(player).slice(0, 3), [I.SUN_KISSED_BONES, I.BONEMEAL, BUCKET_OF_SLIME]);
  assert.ok(messages.includes(claimed(1, 39)));
});

test("the day's count survives a save and reload, login sends it, and the allowance is kept", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 4, 12, 0, 0) });
  const { player } = actor(t);
  claimUpTo(player, "medium");
  give(player, I.BONES, 5);
  claimSlime(player);
  const snapshot = PlayerSave.fromPlayer(player);
  const reloaded = actor(t);
  snapshot.applyToPlayer(reloaded.player);
  assert.equal(used(reloaded.player), 5, "the allowance used came back");
  assert.deepEqual(slimeVarbits(reloaded.varbits), [], "nothing is sent before login");
  login(reloaded.player);
  assert.deepEqual(slimeVarbits(reloaded.varbits).at(-1), [SLIME_VARBIT, 5], "login sends the count");
  give(reloaded.player, I.BONES, 9);
  claimSlime(reloaded.player);
  assert.ok(reloaded.messages.includes(claimed(13, 13)), "the tier and the used count both came back: 8 more of 13");
  assert.equal(used(reloaded.player), 13);
  logout(reloaded.player);
  logout(player);
});

test("a saved state from an earlier UTC day sends nothing at login and the full allowance is back", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 4, 12, 0, 0) });
  const { player, messages, varbits } = actor(t);
  claimUpTo(player, "medium");
  player.setAttribute(Rewards.DAILY_ATTRIBUTE, { day: "2026-11-03", counts: { [DAILY_KEY]: 13 } });
  varbits.length = 0;
  login(player);
  assert.deepEqual(slimeVarbits(varbits), [], "yesterday's count is not sent");
  give(player, I.BONES, 13);
  claimSlime(player);
  assert.ok(messages.includes(claimed(13, 13)));
  logout(player);
});
