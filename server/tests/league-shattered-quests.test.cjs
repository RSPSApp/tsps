// Run after `yarn build`: node --test tests/league-shattered-quests.test.cjs
// Shattered Relics' quest packs (docs/leagues.md "Shattered Relics") against every quest plugin:
// which of the Wiki's names this server registers, and what completing every pack hands out.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

let core;
let Unlocks;
let QuestRuntime;
const prompts = [];
const tasks = [];
const custom = {};
const data = require("../plugins/modes/data/league-shattered.json").unlocks.quests;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // Deferred rewards (a prompt a tick on) are run by hand.
  core.TaskManager.submit = (task) => tasks.push(task);
  const api = new Proxy({
    core,
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value),
    getPluginConfig: (key, fallback) => fallback,
    sendMultiChatboxPrompt: (player, title) => prompts.push(title),
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/modes/league/Common.LeagueMode").init(api);
  require("../plugins/quests/Quests.plugin").register(api);
  Unlocks = require("../plugins/modes/league/Unlocks.LeagueMode");
  QuestRuntime = require("../plugins/quests/QuestRuntime");
});

test("every pack's quests are registered quests, but Recipe for Disaster's subquests and three miniquests", () => {
  const names = [...new Set(Object.values(data.packs).flatMap((pack) => pack.quests))];
  assert.deepEqual(names.filter((name) => !QuestRuntime.questNamed(name)).sort(), [
    "Alfred Grimhand's Barcrawl", "Architectural Alliance",
    "Freeing Awowogei", "Freeing Pirate Pete", "Freeing Sir Amik Varze", "Freeing Skrach Uglogwee",
    "Freeing the Goblin generals", "Freeing the Mountain Dwarf", "The Frozen Door",
  ], "the names docs/leagues.md and the data say are skipped");
  assert.equal(QuestRuntime.questNamed("Song of the Elves")?.name, "Song of the Elves", "Elf III's main quest");
  assert.equal(QuestRuntime.questNamed("Dragon Slayer II")?.name, "Dragon Slayer II", "Myths' main quest");
});

test("completing every pack hands out the final rewards but no experience item, prompt or scroll", () => {
  const player = new Player(null);
  player.setUsername("every-pack");
  const opened = [];
  const sender = new Proxy({}, {
    get: (target, key) => key === "sendInterface" ? (group) => (opened.push(group), sender)
      : key === "sendJingle" ? (...args) => (opened.push(["jingle", ...args]), sender) : () => sender,
  });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const banked = (id) => player.getBanks().reduce((sum, bank) => sum + (bank?.getAmount(id) ?? 0), 0);
  const held = (id) => player.getInventory().getAmount(id) + banked(id);
  for (const name of Object.keys(data.packs)) Unlocks._test.completeQuests(player, name);
  for (let round = 0; round < 3 && tasks.length; round++) {
    for (const task of tasks.splice(0)) (task.execute ?? task.run).call(task);
  }
  const registered = [...new Set(Object.values(data.packs).flatMap((pack) => pack.quests))]
    .map((name) => QuestRuntime.questNamed(name)).filter(Boolean);
  assert.deepEqual(registered.filter((quest) => !quest.isComplete(player)).map((quest) => quest.name), [], "all complete");
  assert.deepEqual(data.experienceItems.filter((id) => held(id) > 0), [], "no lamp or tome is left");
  assert.deepEqual(prompts, [], "The Fremennik Isles offers no combat XP");
  assert.deepEqual(opened, [], "no completion scroll (153) or jingle");
  for (const [id, label] of [[19564, "Monkey Madness II's royal seed pod"], [22400, "A Taste of Hope's Drakan's medallion"], [4212, "Roving Elves' crystal bow"]]) {
    assert.equal(held(id) > 0, true, `${label}: rewards past a full inventory go to the bank`);
  }
  assert.equal(player.getInventory().getFreeSlots(), 0, "the inventory filled up on the way");
});

/** A real player whose packets go nowhere. */
function fresh(name) {
  const player = new Player(null);
  player.setUsername(name);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  return player;
}

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

test("rewards neither the inventory nor a full bank can take go to the floor, not nowhere", () => {
  const { Item, Bank, ItemOnGroundManager } = core;
  const player = fresh("bank-full");
  player.setLocation(new core.Location(2809, 3440, 0));
  for (let slot = 0; slot < 28; slot++) player.getInventory().adds(1511, 1);
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
    const bank = player.getBank(tab);
    bank.setItems(Array.from({ length: bank.capacity() }, (_, slot) => new Item(4000 + tab * 400 + slot, 1)));
  }
  assert.equal(player.getBank(Bank.getTabForItem(player, 1458)).getFreeSlots(), 0, "every tab full");
  Unlocks._test.completeQuests(player, "Troll I");
  assert.equal(QuestRuntime.questNamed("Troll Stronghold").isComplete(player), true);
  assert.equal(player.getInventory().getAmount(1511), 28, "its own logs");
  const ground = ItemOnGroundManager.getGroundItem(player.getUsername(), 1458, player.getLocation(), player.getPrivateArea());
  assert.equal(ground?.getItem().getAmount(), 1, "Troll Stronghold's law talisman lies at its feet");
});

test("a capped coin stack keeps the part it can take and the rest goes to the floor", () => {
  const { Item, Bank, ItemOnGroundManager } = core;
  const MAX = 2147483647;
  const player = fresh("capped");
  player.setLocation(new core.Location(2810, 3440, 0));
  player.getInventory().adds(995, MAX - 50);
  player.getBank(Bank.getTabForItem(player, 995)).add(new Item(995, MAX), false);
  Unlocks._test.completeQuests(player, "Kourend I");
  assert.equal(QuestRuntime.questNamed("X Marks the Spot").isComplete(player), true);
  assert.equal(player.getInventory().getAmount(995), MAX, "50 of X Marks the Spot's 200 coins fit the stack");
  const ground = ItemOnGroundManager.getGroundItem(player.getUsername(), 995, player.getLocation(), player.getPrivateArea());
  assert.equal(ground?.getItem().getAmount(), 150, "the bank's stack is capped, so the other 150 are dropped");
});

test("a pack's quests pay no post-quest XP, even after a save and reload: Ellen's and Daero's training", async () => {
  const { Skill, NpcIdentifiers: N } = core;
  const player = fresh("withheld");
  Unlocks._test.completeQuests(player, "Myths");
  Unlocks._test.completeQuests(player, "Gnome I");
  const again = fresh("withheld");
  PlayerSave.fromPlayer(player).applyToPlayer(again);
  const ds2 = QuestRuntime.questNamed("Dragon Slayer II");
  const mm1 = QuestRuntime.questNamed("Monkey Madness I");
  assert.equal(ds2.isComplete(again) && ds2.experienceWithheld(again), true, "the marker survives the reload");
  assert.equal(mm1.experienceWithheld(again), true);

  const opened = [];
  custom["xpreward:open"] = [(request) => opened.push(request)];
  const ellen = (who) => emit("npc-dialogue:action", { player: who, npcId: N.ELLEN, stepId: "P2tord", handled: false });
  const daero = (who) => emit("npc-dialogue:action", { player: who, npcId: N.DAERO, stepId: "KpGxV1", handled: false });
  const before = [Skill.ATTACK, Skill.STRENGTH].map((skill) => again.getSkillManager().getExperience(skill));
  ellen(again);
  daero(again);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(opened, [], "Ellen offers no 25,000 XP reward");
  assert.deepEqual([Skill.ATTACK, Skill.STRENGTH].map((skill) => again.getSkillManager().getExperience(skill)), before, "Daero's training pays nothing");

  const played = fresh("played");
  ds2.complete(played);
  mm1.complete(played);
  ellen(played);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened.length, 1, "a quest actually played still has Ellen's reward");
  opened[0].onConfirm(Skill.ATTACK, "Attack");
  assert.ok(played.getSkillManager().getExperience(Skill.ATTACK) >= 25000);
  const strength = played.getSkillManager().getExperience(Skill.STRENGTH);
  daero(played);
  assert.ok(played.getSkillManager().getExperience(Skill.STRENGTH) >= strength + 35000, "and Daero's training");
});

test("a character's own inventory is kept through a pack's completion", () => {
  const player = new Player(null);
  player.setUsername("own-items");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getInventory().adds(1351, 1);
  player.getInventory().adds(995, 1000);
  Unlocks._test.completeQuests(player, "Troll I");
  assert.equal(player.getInventory().getAmount(1351), 1, "the axe it carried");
  assert.equal(player.getInventory().getAmount(995), 1000, "its coins (Troll I's quests pay none)");
  assert.equal(player.getInventory().getAmount(1458), 1, "Troll Stronghold's law talisman joins them");
  assert.equal(QuestRuntime.questNamed("Death Plateau").isComplete(player), true);
});

test("league:complete-quests: Demonic Pacts' area lists, requirements first, unknown names left out", () => {
  const player = new Player(null);
  player.setUsername("area-quests");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const order = [];
  const shilo = QuestRuntime.questNamed("Shilo Village");
  const potion = QuestRuntime.questNamed("Jungle Potion");
  const karamja = require("../plugins/modes/data/league-areas.json").leagues["6"].quests["2"];
  assert.deepEqual(karamja, ["Shilo Village", "Jungle Potion"], "the Wiki's Karamja list, the requirement under its quest");
  const watch = (quest) => {
    const complete = quest.complete.bind(quest);
    quest.complete = (target, options) => (order.push(quest.name), complete(target, options));
    return () => { delete quest.complete; };
  };
  const unwatch = [watch(shilo), watch(potion)];
  try {
    Unlocks._test.completeNamedQuests({ player, quests: [...karamja, "Recipe for Disaster/Freeing Pirate Pete"] });
  } finally {
    unwatch.forEach((fn) => fn());
  }
  assert.deepEqual(order, ["Jungle Potion", "Shilo Village"]);
  assert.equal(shilo.isComplete(player), true);
});

test("league:complete-quests gives none of the quests' experience: Varlamore's, as live starts a Demonic Pacts character", () => {
  const player = new Player(null);
  player.setUsername("varlamore-quests");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const varlamore = require("../plugins/modes/data/league-areas.json").leagues["6"].quests["21"];
  // Unlocks' experience hook, as the plugin attaches it, on the real experience pipeline.
  const hooks = PluginManager.canGainExperienceHooks;
  const attached = hooks.length;
  Unlocks(new Proxy({ core, onCanGainExperience: (handler) => hooks.push({ handler }) }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const skills = player.getSkillManager();
  const { Skill } = PluginManager.getCoreApi();
  const before = ["SLAYER", "RUNECRAFTING", "HUNTER", "FISHING", "THIEVING"].map((name) => skills.getExperience(Skill[name]));
  Unlocks._test.completeNamedQuests({ player, quests: varlamore });
  assert.equal(QuestRuntime.questNamed("Perilous Moons").isComplete(player), true);
  assert.deepEqual(["SLAYER", "RUNECRAFTING", "HUNTER", "FISHING", "THIEVING"].map((name) => skills.getExperience(Skill[name])), before,
    "Perilous Moons' 40,000 Slayer and Twilight's Promise's Thieving held back");
  hooks.length = attached;
});

test("league:complete-quests with items: false: Demonic Pacts' start quests hand no item (live's new character holds only the starter kit, 237/01098)", () => {
  const startQuests = require("../plugins/modes/data/leagues.json").leagues["6"].startQuests;
  const named = (quests) => quests.map((name) => QuestRuntime.questNamed(name)).filter(Boolean);
  const fresh = (name) => {
    const player = new Player(null);
    player.setUsername(name);
    const sender = new Proxy({}, { get: () => () => sender });
    player.getPacketSender = () => sender;
    player.sendMessage = () => {};
    return player;
  };
  const held = (player) => player.getInventory().getValidItems().length
    + player.getBanks().reduce((sum, bank) => sum + (bank?.getValidItems().length ?? 0), 0);
  const player = fresh("start-quests");
  Unlocks._test.completeNamedQuests({ player, quests: startQuests, items: false });
  for (const task of tasks.splice(0)) (task.execute ?? task.run).call(task);
  assert.ok(named(startQuests).every((quest) => quest.isComplete(player)), "every start quest complete");
  assert.equal(held(player), 0, "no Air talisman, Elemental shield, Wolfbane or any other reward");
  const { ItemIdentifiers: I } = core;
  const rewarded = fresh("start-quests-items");
  Unlocks._test.completeNamedQuests({ player: rewarded, quests: ["Rune Mysteries", "Elemental Workshop I", "Priest in Peril"] });
  for (const id of [I.AIR_TALISMAN, I.ELEMENTAL_SHIELD, I.WOLFBANE]) {
    assert.ok(rewarded.getInventory().getAmount(id) > 0, `a pack (items kept) still gives item ${id}`);
  }
});
