// Run after `yarn build`: node --test tests/varrock-diary.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");

const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const AchievementDiaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Varrock = require("../plugins/achievements/diaries/VarrockDiary.plugin");

const DIARY = Data.BY_KEY.get("varrock");
const TASK = Varrock._test.TASK;

let core;
let dispatch;
let condition;
let kudos = 0;

test.before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const handlers = new Map();
  dispatch = (name, event) => {
    if (name === "museum:get-kudos") event.kudos = kudos;
    for (const handler of handlers.get(name) ?? []) handler(event);
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onPlayerLogin() {},
    onNpcDialogueCondition(handler) { condition = handler; },
    onCustomEvent(name, handler) {
      const entries = handlers.get(name) ?? [];
      entries.push(handler);
      handlers.set(name, entries);
    },
    emitCustomEvent: dispatch,
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Progress(api);
  api.onCustomEvent("diary:task", AchievementDiaries._test.onTask);
  Varrock.register(api);
  PluginManager.emitCustomEvent = dispatch;
});

let index = 2000;
function fixture(t, { at = [3200, 3400, 0], privateArea = null } = {}) {
  const player = new Player(null);
  player.setIndex(index++);
  player.setUsername("varrock-diary-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.setLocation(new core.Location(...at));
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getPrivateArea = () => privateArea;
  player.sendMessage = () => {};
  const varbits = new Map();
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : () => sender });
  player.getPacketSender = () => sender;
  player.setHitpoints(10);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  t.after(() => {
    core.TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
  });
  return { player, varbits };
}

const completed = (player, task) => Progress.doneTasks(player, DIARY).has(task);
const definition = (name) => ({ getDefinition: () => ({ getName: () => name }) });

test("Varrock easy location actions credit only the real rock, tree and fish", (t) => {
  const { player } = fixture(t, { at: [3285, 3369, 0] });
  dispatch("mining:attempt", { player, object: definition("Iron rocks"), oreId: core.ItemIdentifiers.IRON_ORE, success: true });
  assert.equal(completed(player, TASK.iron), true);

  const wrongOre = fixture(t, { at: [3285, 3369, 0] }).player;
  dispatch("mining:attempt", { player: wrongOre, object: definition("Iron rocks"), oreId: core.ItemIdentifiers.COAL, success: true });
  assert.equal(completed(wrongOre, TASK.iron), false, "another ore at the same rocks does not count");

  const elsewhere = fixture(t, { at: [3200, 3400, 0] }).player;
  dispatch("mining:attempt", { player: elsewhere, object: definition("Iron rocks"), oreId: core.ItemIdentifiers.IRON_ORE, success: true });
  assert.equal(completed(elsewhere, TASK.iron), false, "iron outside the south-east mine does not count");

  const lumber = fixture(t, { at: [3298, 3500, 0] }).player;
  dispatch("woodcutting:attempt", { player: lumber, object: definition("Dying tree"), success: true });
  assert.equal(completed(lumber, TASK.dyingTree), true);

  const river = fixture(t, { at: [3104, 3424, 0] }).player;
  dispatch("fishing:success", { player: river, itemId: core.ItemIdentifiers.RAW_TROUT });
  assert.equal(completed(river, TASK.trout), true);

  const wrongFish = fixture(t, { at: [3104, 3424, 0] }).player;
  dispatch("fishing:success", { player: wrongFish, itemId: core.ItemIdentifiers.RAW_SALMON });
  assert.equal(completed(wrongFish, TASK.trout), false);

  const fence = fixture(t, { at: [3240, 3331, 0] }).player;
  dispatch("agility:obstacle", { player: fence, shortcut: "Fence (Varrock)" });
  assert.equal(completed(fence, TASK.fence), true);

  const wrongFence = fixture(t, { at: [3200, 3400, 0] }).player;
  dispatch("agility:obstacle", { player: wrongFence, shortcut: "Fence (Varrock)" });
  assert.equal(completed(wrongFence, TASK.fence), false);
});

test("Varrock earth runes credit both the easy task and the 100-rune elite task", (t) => {
  const easy = fixture(t).player;
  dispatch("runecrafting:success", { player: easy, runeId: core.ItemIdentifiers.EARTH_RUNE, rolls: 1, amountPerEssence: 1 });
  assert.equal(completed(easy, TASK.earthRunes), true);
  assert.equal(completed(easy, TASK.earthRunes100), false);

  const elite = fixture(t).player;
  dispatch("runecrafting:success", { player: elite, runeId: core.ItemIdentifiers.EARTH_RUNE, rolls: 25, amountPerEssence: 4 });
  assert.equal(completed(elite, TASK.earthRunes100), true);

  const air = fixture(t).player;
  dispatch("runecrafting:success", { player: air, runeId: core.ItemIdentifiers.AIR_RUNE, rolls: 100, amountPerEssence: 1 });
  assert.equal(completed(air, TASK.earthRunes), false);
});

test("the yew task needs a Varrock chop, the church top, and resets on another task", (t) => {
  const { player } = fixture(t, { at: [3266, 3493, 0] });
  dispatch("woodcutting:attempt", { player, object: definition("Yew tree"), success: true });
  assert.equal(completed(player, TASK.yewBurn), false, "chopping alone does not complete the task");

  dispatch("firemaking:success", { player, itemId: core.ItemIdentifiers.YEW_LOGS });
  assert.equal(completed(player, TASK.yewBurn), false, "burning away from the church top does not count");

  player.setLocation(new core.Location(3255, 3480, 3));
  dispatch("firemaking:success", { player, itemId: core.ItemIdentifiers.YEW_LOGS });
  assert.equal(completed(player, TASK.yewBurn), true);

  const reset = fixture(t, { at: [3266, 3493, 0] }).player;
  dispatch("woodcutting:attempt", { player: reset, object: definition("Yew tree"), success: true });
  dispatch("diary:task", { player: reset, diary: "varrock", task: TASK.iron });
  reset.setLocation(new core.Location(3255, 3480, 3));
  dispatch("firemaking:success", { player: reset, itemId: core.ItemIdentifiers.YEW_LOGS });
  assert.equal(completed(reset, TASK.yewBurn), false, "another diary task resets the chop (Wiki)");
});

test("Varrock and Paddewwa teleports credit on the real spell arrival only", (t) => {
  const varrock = fixture(t).player;
  dispatch("spell:teleport-arrival", { player: varrock, name: "varrock teleport" });
  assert.equal(completed(varrock, TASK.varrockTeleport), true);

  const paddewwa = fixture(t).player;
  dispatch("spell:teleport-arrival", { player: paddewwa, name: " Paddewwa Teleport " });
  assert.equal(completed(paddewwa, TASK.paddewwa), true);

  const other = fixture(t).player;
  dispatch("spell:teleport-arrival", { player: other, name: "camelot teleport" });
  assert.equal(completed(other, TASK.varrockTeleport), false);
});

test("spirit tree, balloon and digsite pendant events credit their tasks", (t) => {
  const tree = fixture(t, { at: [3184, 3509, 0] }).player;
  dispatch("spirit-trees:travelled", { player: tree, tree: "Tree Gnome Village" });
  assert.equal(completed(tree, TASK.spiritTree), true);

  const awayTree = fixture(t, { at: [2542, 3170, 0] }).player;
  dispatch("spirit-trees:travelled", { player: awayTree, tree: "Tree Gnome Village" });
  assert.equal(completed(awayTree, TASK.spiritTree), false);

  const balloon = fixture(t, { at: [3299, 3482, 0] }).player;
  dispatch("balloon-transport:passenger-arrival", {
    player: balloon, station: "castle", origin: { station: "varrock", isPublic: true }, opensRoute: false,
  });
  assert.equal(completed(balloon, TASK.balloon), true);

  const pendant = fixture(t).player;
  dispatch("jewellery:teleport-arrival", { player: pendant, key: "digsite", label: "Digsite" });
  assert.equal(completed(pendant, TASK.digsitePendant), true);
  dispatch("jewellery:teleport-arrival", { player: pendant, key: "digsite", label: "Fossil Island" });
  assert.equal(completed(pendant, TASK.digsitePendant), true, "the Digsite label is the one that counts");
});

test("the four Stronghold emotes need all four distinct slots", (t) => {
  const { player } = fixture(t);
  for (const slot of [28, 29, 30]) dispatch("player:emote", { player, slot, sequence: 0 });
  assert.equal(completed(player, TASK.emotes), false);
  dispatch("player:emote", { player, slot: 30, sequence: 0 });
  assert.equal(completed(player, TASK.emotes), false, "a repeated emote does not count");
  dispatch("player:emote", { player, slot: 31, sequence: 0 });
  assert.equal(completed(player, TASK.emotes), true);
});

test("Thessalia's shop and Benny's newspaper credit their easy tasks", (t) => {
  const thessalia = fixture(t).player;
  dispatch("npc-dialogue:action", { player: thessalia, action: "open_shop", target: "Thessalia's Fine Clothes." });
  assert.equal(completed(thessalia, TASK.browseThessalia), true);

  const poor = fixture(t).player;
  poor.getInventory().adds(core.ItemIdentifiers.COINS, 49);
  assert.equal(condition({ player: poor, npcId: core.NpcIdentifiers.BENNY, text: "If the player has at least 50 coins:" }), false);
  dispatch("npc-dialogue:action", { player: poor, action: "receive", npcId: core.NpcIdentifiers.BENNY, text: "Newspaper" });
  assert.equal(poor.getInventory().getAmount(core.ItemIdentifiers.NEWSPAPER), 0);
  assert.equal(completed(poor, TASK.newspaper), false);

  const buyer = fixture(t).player;
  buyer.getInventory().adds(core.ItemIdentifiers.COINS, 50);
  assert.equal(condition({ player: buyer, npcId: core.NpcIdentifiers.BENNY, text: "If the player has at least 50 coins:" }), true);
  dispatch("npc-dialogue:action", { player: buyer, action: "receive", npcId: core.NpcIdentifiers.BENNY, text: "Newspaper" });
  assert.equal(buyer.getInventory().getAmount(core.ItemIdentifiers.NEWSPAPER), 1);
  assert.equal(buyer.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(completed(buyer, TASK.newspaper), true);
});

test("the pottery bowl needs a Barbarian Village spin and firing", (t) => {
  const { player } = fixture(t, { at: [3087, 3409, 0] });
  dispatch("skills:produced", { player, itemId: core.ItemIdentifiers.UNFIRED_BOWL, kind: "pottery" });
  assert.equal(completed(player, TASK.bowl), false);
  dispatch("skills:produced", { player, itemId: core.ItemIdentifiers.BOWL, kind: "pottery" });
  assert.equal(completed(player, TASK.bowl), true);
});

test("the elite skilling tasks check their location and item", (t) => {
  const bank = fixture(t, { at: [3186, 3438, 0] }).player;
  dispatch("herblore:made", { player: bank, itemId: core.ItemIdentifiers.SUPER_COMBAT_POTION_4_ });
  assert.equal(completed(bank, TASK.superCombat), true);

  const wrongBank = fixture(t, { at: [3200, 3400, 0] }).player;
  dispatch("herblore:made", { player: wrongBank, itemId: core.ItemIdentifiers.SUPER_COMBAT_POTION_4_ });
  assert.equal(completed(wrongBank, TASK.superCombat), false);

  const guild = fixture(t, { at: [3143, 3453, 1] }).player;
  dispatch("cooking:success", { player: guild, itemId: core.ItemIdentifiers.SUMMER_PIE });
  assert.equal(completed(guild, TASK.summerPie), true);

  const darts = fixture(t, { at: [3186, 3438, 0] }).player;
  dispatch("skills:produced", { player: darts, kind: "smith", itemId: core.ItemIdentifiers.RUNE_DART_TIP, amount: 10 });
  assert.equal(completed(darts, TASK.runeDarts), false, "tips alone do not complete it");
  dispatch("fletching:made", { player: darts, itemId: core.ItemIdentifiers.RUNE_DART, amount: 10 });
  assert.equal(completed(darts, TASK.runeDarts), true);
});

test("Haig Halen and Orlando Smith need their Kudos thresholds", (t) => {
  kudos = 49;
  const haig = fixture(t).player;
  dispatch("npc-dialogue:line", { player: haig, npcId: core.NpcIdentifiers.CURATOR_HAIG_HALEN });
  assert.equal(completed(haig, TASK.haigHalem), false);
  kudos = 50;
  dispatch("npc-dialogue:line", { player: haig, npcId: core.NpcIdentifiers.CURATOR_HAIG_HALEN });
  assert.equal(completed(haig, TASK.haigHalem), true);

  kudos = 152;
  const orlando = fixture(t).player;
  dispatch("npc-dialogue:line", { player: orlando, npcId: core.NpcIdentifiers.ORLANDO_SMITH });
  assert.equal(completed(orlando, TASK.orlando), false);
  kudos = 153;
  dispatch("npc-dialogue:line", { player: orlando, npcId: core.NpcIdentifiers.ORLANDO_SMITH });
  assert.equal(completed(orlando, TASK.orlando), true);
});

test("Lunar Plank Make credits twenty mahogany planks in one Lumber Yard cast", (t) => {
  const { player } = fixture(t, { at: [3302, 3492, 0] });
  player.setSpellbook(core.MagicSpellbook.LUNAR);
  player.getSkillManager().setCurrentLevels(core.Skill.MAGIC, 99, false);
  player.getSkillManager().setMaxLevel(core.Skill.DEFENCE, 99);
  player.getInventory().adds(core.ItemIdentifiers.MAHOGANY_LOGS, 20);
  player.getInventory().adds(core.ItemIdentifiers.COINS, 20 * 1050);
  for (const [id, amount] of [[9075, 500], [561, 500], [557, 500], [556, 500], [555, 500], [554, 500]]) {
    player.getInventory().adds(id, amount);
  }
  const slot = player.getInventory().getItems().findIndex((item) => item?.getId?.() === core.ItemIdentifiers.MAHOGANY_LOGS);
  assert.ok(slot >= 0, "the mahogany logs are in the inventory");
  assert.equal(LunarSpells.handleItemTarget(player, core.ItemIdentifiers.MAHOGANY_LOGS, slot, "plank make"), true);
  for (let tick = 0; tick < 200; tick++) core.TaskManager.process();
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.MAHOGANY_PLANK), 20);
  assert.equal(completed(player, TASK.lunarPlanks), true);
});

test("Plank Make only counts mahogany converted in one Lumber Yard batch", (t) => {
  const setup = (at) => {
    const { player } = fixture(t, { at });
    player.setSpellbook(core.MagicSpellbook.LUNAR);
    player.getSkillManager().setCurrentLevels(core.Skill.MAGIC, 99, false);
    player.getSkillManager().setMaxLevel(core.Skill.DEFENCE, 99);
    for (const [id, amount] of [[9075, 500], [561, 500], [557, 500]]) player.getInventory().adds(id, amount);
    return player;
  };
  const cast = (player, logs) => {
    player.getInventory().adds(core.ItemIdentifiers.MAHOGANY_LOGS, logs);
    player.getInventory().adds(core.ItemIdentifiers.COINS, logs * 1050);
    const slot = player.getInventory().getItems().findIndex((item) => item?.getId?.() === core.ItemIdentifiers.MAHOGANY_LOGS);
    assert.ok(slot >= 0);
    assert.equal(LunarSpells.handleItemTarget(player, core.ItemIdentifiers.MAHOGANY_LOGS, slot, "plank make"), true);
    for (let tick = 0; tick < 200; tick++) core.TaskManager.process();
  };

  const elsewhere = setup([3213, 3424, 0]);
  cast(elsewhere, 20);
  assert.equal(completed(elsewhere, TASK.lunarPlanks), false, "planks outside the Lumber Yard do not count");

  const split = setup([3302, 3492, 0]);
  cast(split, 10);
  assert.equal(completed(split, TASK.lunarPlanks), false);
  cast(split, 10);
  assert.equal(completed(split, TASK.lunarPlanks), false, "a second cast does not carry the first batch over");

  const fresh = setup([3302, 3492, 0]);
  cast(fresh, 20);
  assert.equal(completed(fresh, TASK.lunarPlanks), true, "one fresh 20-plank batch completes it");
});

// Review regression: each one-log cast must end its own batch.
test("separate one-log Plank Make casts never accumulate", (t) => {
  const { player } = fixture(t, { at: [3302, 3492, 0] });
  player.setSpellbook(core.MagicSpellbook.LUNAR);
  player.getSkillManager().setCurrentLevels(core.Skill.MAGIC, 99, false);
  player.getSkillManager().setMaxLevel(core.Skill.DEFENCE, 99);
  for (const [id, amount] of [[9075, 500], [561, 500], [557, 500]]) player.getInventory().adds(id, amount);
  player.getInventory().adds(core.ItemIdentifiers.COINS, 21000);
  for (let i = 0; i < 20; i++) {
    player.getInventory().adds(core.ItemIdentifiers.MAHOGANY_LOGS, 1);
    const slot = player.getInventory().getItems().findIndex(item => item?.getId?.() === core.ItemIdentifiers.MAHOGANY_LOGS);
    LunarSpells.handleItemTarget(player, core.ItemIdentifiers.MAHOGANY_LOGS, slot, "plank make");
    for (let tick = 0; tick < 10; tick++) core.TaskManager.process();
  }
  assert.equal(completed(player, TASK.lunarPlanks), false);
});

test("one bar of ten rune dart tips followed by ten darts completes the task", (t) => {
  const { player } = fixture(t, { at: [3186, 3438, 0] });
  dispatch("skills:produced", { player, kind: "smith", itemId: core.ItemIdentifiers.RUNE_DART_TIP, amount: 10 });
  dispatch("fletching:made", { player, itemId: core.ItemIdentifiers.RUNE_DART, amount: 10 });
  assert.equal(completed(player, TASK.runeDarts), true);
});
