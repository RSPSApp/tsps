// Run after `yarn build`: node --test tests/league-relics-demonic-pacts.test.cjs
// Demonic Pacts' relics (docs/leagues.md, Wiki Demonic_Pacts_League/Relics): the catalog's items
// from the cache, the unlock's bank-or-Leagues-Tutor rule and lines (237/01098, 01102), the relic
// effect toggles (237/01104), and each relic's effect: it works for a Demonic Pacts character who
// chose it, and not for one without it, a Raging Echoes character with the same slots, or a main
// character. The skills' lookups are answered as their plugins answer them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");

const DP = 6;
// Demonic Pacts' slots (tier index -> slot), as the cache's league struct 6436 orders them.
const ENDLESS_HARVEST = { 0: 1 };
const BARBARIAN_GATHERING = { 0: 2 };
const ABUNDANCE = { 0: 3 };
const HOTFOOT = { 1: 1 };
const FRIENDLY_FORAGER = { 1: 2 };
const WOODSMAN = { 1: 3 };
const BANK_HEIST = { 2: 1 };
const CONNIVING_CLUES = { 3: 2 };
const NATURES_ACCORD = { 4: 1 };
const LARCENIST = { 4: 2 };
const SOUL_HARVEST = { 4: 3 };
const GRIMOIRE = { 5: 1 };
const ETERNAL_SUSTENANCE = { 5: 2 };
const CULLING_SPREE = { 5: 3 };
const FLOW_STATE = { 6: 1 };
const RELOADED = { 6: 2 };
const EVIL_EYE = { 2: 2 };
const MAP_OF_ALACRITY = { 2: 3 };
const EXECUTIONER = { 7: 1 };
const FLASK_OF_FERVOUR = { 7: 3 };
const TRANSMUTE = { 3: 1 };

let core;
let I;
let Common;
let Unlock;
const hooks = {};
const custom = {};
const itemActions = new Map();
/** Chatbox menus sent: { player, title, entries: [[label, action], ...] }. */
const prompts = [];
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      for (const attached of lists[name]) attached(event);
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? DP : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMagicAttackAccuracyModifier() {},
    registerMagicDamageBonusModifier() {},
    registerMeleeAttackAccuracyModifier() {},
    registerRangedAttackAccuracyModifier() {},
    registerMeleeDefenseModifier() {},
    registerMagicDefenseModifier() {},
    registerWeaponProfile() {},
    registerRangedAmmoHandler() {},
    onItemAction: (name, actions) => itemActions.set(name, { ...itemActions.get(name), ...actions }),
    sendMultiChatboxPrompt: (player, title, ...flat) => {
      const entries = [];
      for (let index = 0; index < flat.length; index += 2) entries.push([flat[index], flat[index + 1]]);
      prompts.push({ player, title, entries });
    },
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  Common = require("../plugins/modes/leaguerelics/Common.LeagueRelics");
  Unlock = require("../plugins/modes/leaguerelics/Unlock.LeagueRelics");
  require("../plugins/skills/smithing/Data.Smithing").load(core);
  custom["smithing:bar-for-ore"] = [require("../plugins/skills/smithing/Smelting.Smithing").answerBarForOre];
  custom["cooking:cooked"] = [(request) => { if (request.rawId === I.RAW_SHRIMPS) Object.assign(request, { cookedId: I.SHRIMPS, xp: 30 }); }];
  custom["firemaking:log-xp"] = [(request) => { if (request.logId === I.LOGS) request.xp = 40; }];
});

afterEach(() => {
  Math.random = realRandom;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A real player of `profile`, logged in, with the given picks; its messages and varps are kept. */
function character(name, profile, picks = {}, leagueType = DP) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  player.setRegistered(true);
  const sent = { messages: [], configs: new Map() };
  const sender = new Proxy({}, {
    get: (target, key) => (key === "sendConfig" ? (id, value) => (sent.configs.set(id, value), sender) : () => sender),
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  if (profile === "league") {
    player.setAttribute("league:type", leagueType);
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return Object.assign(player, { sent });
}

/** The owner, a Demonic Pacts character without it, a Raging Echoes character with the same slots, a main character. */
function cases(picks) {
  return {
    relic: character("relic", "league", picks),
    without: character("without", "league", {}),
    other: character("other", "league", picks, 5),
    main: character("main", "main"),
  };
}

function others(who) {
  return [who.without, who.other, who.main];
}

function banked(player, itemId) {
  return player.getBank(core.Bank.getTabForItem(player, itemId)).getAmount(itemId);
}

function xp(player, skill) {
  return player.getSkillManager().getExperience(skill);
}

function gather(player, itemId, amount, skill, experience = 0) {
  return emit("storage:gather", { player, itemId, amount, stored: 0, skill, xp: experience });
}

/** The toggles component's script trigger for a cache toggle row, its argument a zigzag varint. */
function toggle(player, rowName) {
  let value = core.CacheDefinitions.getDbRowId(rowName) << 1;
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  hooks[`button:${(655 << 16) | 38}`]({ player, scriptTrigger: true, argsData: Int8Array.from(bytes) });
}

test("the catalog's items are the relic structs' (param 2049), unlocked only in a bank or by the Leagues Tutor, with live's lines", () => {
  const tiers = Common.catalog(DP).tiers;
  const grants = (tier, slot) => tiers[tier].relics[slot - 1].grants;
  assert.deepEqual(grants(0, 1), [], "Endless Harvest hands out nothing");
  assert.deepEqual(grants(0, 2), [I.KNAPSACK]);
  assert.deepEqual(grants(1, 1), [I.SEARING_BOOTS]);
  assert.deepEqual(grants(1, 2), [I.FORAGERS_POUCH]);
  assert.deepEqual(grants(2, 1), [I.BANKERS_BRIEFCASE]);
  assert.deepEqual(grants(2, 2), [I.EVIL_EYE]);
  assert.deepEqual(grants(2, 3), [I.MAP_OF_ALACRITY]);
  assert.deepEqual(grants(3, 1), [I.TRANSMUTATION_LEDGER]);
  assert.deepEqual(grants(3, 3), [I.BUTLERS_BELL]);
  assert.deepEqual(grants(4, 1), [I.FAIRY_MUSHROOM]);
  assert.deepEqual(grants(5, 1), [I.ARCANE_GRIMOIRE]);
  assert.deepEqual(grants(7, 1), [I.SAGES_AXE]);
  assert.deepEqual(grants(7, 2), [I.MINION_WHISTLE]);
  assert.deepEqual(grants(7, 3), [I.FLASK_OF_FERVOUR]);
  assert.equal(tiers[1].relics[0].requiresBank, true);

  const player = character("unlock", "league");
  assert.equal(Unlock.unlock(player, 0, 2, { bankOpen: false }), false);
  assert.equal(player.sent.messages.at(-1), "You must be within a bank or near the Leagues Tutor to unlock this as it gives you items.", "237/01102");
  assert.equal(player.getInventory().contains(I.KNAPSACK), false);
  const tutor = { getDefinition: () => ({ getName: () => "Leagues Tutor" }), getLocation: () => new Location(3203, 3200, 0) };
  player.getLocalNpcs = () => [tutor];
  assert.equal(Unlock.unlock(player, 0, 2, { bankOpen: false }), true, "near the Leagues Tutor");
  assert.equal(player.getInventory().contains(I.KNAPSACK), true);
  assert.ok(player.sent.messages.includes("Congratulations, you've unlocked a new Relic: <col=FE206A>Barbarian Gathering</col>."), "237/01098");

  const banker = character("banker", "league");
  assert.equal(Unlock.unlock(banker, 0, 3, { bankOpen: false }), true, "a relic with no item needs no bank");
  assert.deepEqual(Common.chosen(banker), { 0: 3 });
});

test("the relic toggles flip their cache bit for a holder only, in the row's words, and gate the effect", () => {
  const who = cases(ENDLESS_HARVEST);
  const varp = core.CacheDefinitions.getVarpId("league_relic_effect_toggle_1");
  const row = "league_relic_endless_harvest_toggle_bank";
  toggle(who.relic, row);
  assert.equal(who.relic.sent.configs.get(varp), 1, "bit 0");
  assert.equal(who.relic.sent.messages.at(-1), "<col=ff3045>Endless Harvest - All resources gathered will now be put into your inventory.");
  toggle(who.relic, row);
  assert.equal(who.relic.sent.configs.get(varp), 0);
  assert.equal(who.relic.sent.messages.at(-1), "<col=229628>Endless Harvest - All resources gathered will now be put into your bank.");
  toggle(who.without, row);
  assert.equal(who.without.sent.configs.get(varp), 0, "without the relic the varp is sent back unchanged");
  assert.equal(who.without.sent.messages.length, 0);
  // An inverted row (Transmute's bank toggle) starts off.
  const Toggles = require("../plugins/modes/leaguerelics/Toggles.LeagueRelics");
  assert.equal(Toggles.on(who.relic, "league_relic_transmutation_bank_toggle"), false);
  assert.equal(Toggles.on(who.relic, row), true);
});

test("Endless Harvest (Demonic Pacts): doubled with XP, banked while the toggle is on, and endless rocks and trees", () => {
  const who = cases(ENDLESS_HARVEST);
  const request = gather(who.relic, I.IRON_ORE, 1, Skill.MINING, 35);
  assert.equal(request.stored, 1);
  assert.equal(banked(who.relic, I.IRON_ORE), 2);
  toggle(who.relic, "league_relic_endless_harvest_toggle_bank");
  const unbanked = gather(who.relic, I.IRON_ORE, 1, Skill.MINING, 35);
  assert.equal(unbanked.stored, 0, "the skill hands the ore over");
  assert.equal(who.relic.getInventory().getAmount(I.IRON_ORE), 1, "the extra to the inventory");
  assert.equal(emit("woodcutting:deplete-tree", { player: who.relic, handled: false }).handled, true);
  assert.equal(emit("mining:deplete-rock", { player: who.relic, handled: false }).handled, true);
  for (const player of others(who)) {
    assert.equal(gather(player, I.IRON_ORE, 1, Skill.MINING, 35).stored, 0);
    assert.equal(emit("mining:deplete-rock", { player, handled: false }).handled, false);
  }
  const trailblazer = character("trailblazer", "league", { 0: 2 }, 4);
  if (Common.hasRelic(trailblazer, "endless-harvest")) {
    assert.equal(emit("mining:deplete-rock", { player: trailblazer, handled: false }).handled, false, "Trailblazer Reloaded's rocks deplete");
  }
});

test("Barbarian Gathering: a second 50% chance, 10% Strength and Agility XP, and bare hands that fish", () => {
  const who = cases(BARBARIAN_GATHERING);
  Math.random = () => 0.4;
  assert.equal(emit("mining:attempt", { player: who.relic, success: false }).success, true);
  assert.equal(emit("woodcutting:attempt", { player: who.relic, success: false }).success, true);
  emit("skills:experience-gained", { player: who.relic, skill: Skill.FISHING, experience: 100, multiplied: true });
  assert.equal(xp(who.relic, Skill.STRENGTH), 10);
  assert.equal(xp(who.relic, Skill.AGILITY), 10);
  const variants = [{ ids: [I.CRYSTAL_HARPOON], level: 71, bonus: 10 }, { ids: [I.HARPOON], level: 35 }];
  assert.equal(emit("fishing:tool", { player: who.relic, variants, variant: null }).variant.level, 1);
  for (const player of others(who)) {
    assert.equal(emit("mining:attempt", { player, success: false }).success, false);
    emit("skills:experience-gained", { player, skill: Skill.FISHING, experience: 100, multiplied: true });
    assert.equal(xp(player, Skill.STRENGTH), 0);
    assert.equal(emit("fishing:tool", { player, variants, variant: null }).variant, null);
  }
});

test("Abundance: +10 to non-combat skills, 2 more XP a drop, and 2 coins an XP to the inventory (the bank when toggled)", () => {
  const who = cases(ABUNDANCE);
  const boost = (player, skill) => emit("skills:level-boost", { player, skill, boost: 0 }).boost;
  assert.equal(boost(who.relic, Skill.COOKING), 10);
  assert.equal(boost(who.relic, Skill.ATTACK), 0, "combat skills are not boosted");
  const before = xp(who.relic, Skill.COOKING);
  emit("skills:experience-gained", { player: who.relic, skill: Skill.COOKING, experience: 10.5, multiplied: true });
  assert.ok(xp(who.relic, Skill.COOKING) >= before + 2, "2 more XP");
  assert.equal(who.relic.getInventory().getAmount(I.COINS), 21);
  toggle(who.relic, "league_relic_abundance_toggle_coins_inv");
  emit("skills:experience-gained", { player: who.relic, skill: Skill.COOKING, experience: 5, multiplied: true });
  assert.equal(banked(who.relic, I.COINS), 10, "toggled off: the bank");
  for (const player of others(who)) {
    assert.equal(boost(player, Skill.COOKING), 0);
    emit("skills:experience-gained", { player, skill: Skill.COOKING, experience: 10, multiplied: true });
    assert.equal(player.getInventory().getAmount(I.COINS), 0);
  }
});

test("Hotfoot: the worn boots cook fish and smelt ore (banked by Endless Harvest too); laps count twice, Agility and Cooking never fail", () => {
  const who = cases(HOTFOOT);
  who.relic.getEquipment().set(core.Equipment.FEET_SLOT, new core.Item(I.SEARING_BOOTS, 1));
  const fish = gather(who.relic, I.RAW_SHRIMPS, 1, Skill.FISHING, 10);
  assert.equal(fish.stored, 1);
  assert.equal(who.relic.getInventory().getAmount(I.SHRIMPS), 1);
  assert.ok(xp(who.relic, Skill.COOKING) > 0);
  gather(who.relic, I.IRON_ORE, 1, Skill.MINING, 35);
  assert.equal(who.relic.getInventory().getAmount(I.IRON_BAR), 1);
  assert.equal(gather(who.relic, I.COAL, 1, Skill.MINING, 50).stored, 0, "coal stays coal");
  assert.equal(emit("agility:roll", { player: who.relic, success: false }).success, true);
  assert.equal(emit("cooking:burn", { player: who.relic, burn: true }).burn, false);
  const lap = emit("agility:lap-reward", { player: who.relic, count: 1, xp: 100 });
  assert.deepEqual([lap.count, lap.xp], [2, 125]);

  const both = character("both", "league", { ...HOTFOOT, ...ENDLESS_HARVEST });
  both.getEquipment().set(core.Equipment.FEET_SLOT, new core.Item(I.SEARING_BOOTS, 1));
  assert.equal(gather(both, I.IRON_ORE, 1, Skill.MINING, 35).stored, 1);
  assert.equal(banked(both, I.IRON_BAR), 2, "Endless Harvest banks two bars");
  const bare = character("bare", "league", HOTFOOT);
  assert.equal(gather(bare, I.RAW_SHRIMPS, 1, Skill.FISHING, 10).stored, 0, "no boots, no cooking");
  for (const player of others(who)) {
    player.getEquipment().set(core.Equipment.FEET_SLOT, new core.Item(I.SEARING_BOOTS, 1));
    assert.equal(gather(player, I.RAW_SHRIMPS, 1, Skill.FISHING, 10).stored, 0);
  }
  // Raging Echoes' slot is Corner Cutter, whose Agility also never fails.
  for (const player of [who.without, who.main]) assert.equal(emit("agility:roll", { player, success: false }).success, false);
});

test("Friendly Forager (Demonic Pacts): Herblore all at once; Raging Echoes' keeps its one at a time", () => {
  const who = cases(FRIENDLY_FORAGER);
  const actions = (player) => emit("skills:actions-per-cycle", { player, skill: Skill.HERBLORE, kind: "clean", actions: 1 }).actions;
  assert.equal(actions(who.relic), 28);
  const slot = Common.catalog(5).tiers[1].relics.findIndex((relic) => relic.key === "friendly-forager") + 1;
  const echoes = character("echoes", "league", { 1: slot }, 5);
  assert.equal(Common.hasRelic(echoes, "friendly-forager"), true, "Raging Echoes' tier 2");
  assert.equal(actions(echoes), 1);
  assert.equal(actions(who.without), 1);
  assert.equal(actions(who.main), 1);
});

test("Woodsman: Fletching at once (ammunition 10), logs burnt while toggled, Hunter catches sure, faster, doubled and banked", () => {
  const who = cases(WOODSMAN);
  const actions = (player, kind) => emit("skills:actions-per-cycle", { player, skill: Skill.FLETCHING, kind, actions: 1 }).actions;
  assert.deepEqual([actions(who.relic, "logs"), actions(who.relic, "arrows")], [28, 10]);
  assert.equal(gather(who.relic, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 1, "burnt");
  assert.ok(xp(who.relic, Skill.FIREMAKING) > 0);
  assert.equal(emit("storage:room", { player: who.relic, itemId: I.LOGS, skill: Skill.WOODCUTTING, room: false }).room, true);
  toggle(who.relic, "league_relic_woodsman_toggle_burn");
  assert.equal(gather(who.relic, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 0, "toggled off: kept");
  assert.equal(emit("hunter:catch-chance", { player: who.relic, chance: 0.2 }).chance, 1);
  assert.equal(emit("hunter:lure-interval", { player: who.relic, kind: "bird", ticks: 5 }).ticks, 2);
  const rewards = emit("hunter:rewards", { player: who.relic, kind: "bird", rewards: [[I.RAW_BIRD_MEAT, 1]], xp: 34 });
  assert.deepEqual([rewards.rewards, rewards.xp], [[], 68]);
  assert.equal(banked(who.relic, I.RAW_BIRD_MEAT), 2);
  assert.equal(emit("hunter:jar-kept", { player: who.relic, kept: false }).kept, true);
  for (const player of others(who)) {
    assert.equal(actions(player, "logs"), 1);
    assert.equal(gather(player, I.LOGS, 1, Skill.WOODCUTTING, 25).stored, 0);
    assert.equal(emit("hunter:catch-chance", { player, chance: 0.2 }).chance, 0.2);
    assert.equal(emit("hunter:rewards", { player, kind: "bird", rewards: [[I.RAW_BIRD_MEAT, 1]], xp: 34 }).xp, 34);
  }
});

test("Bank Heist, Grimoire, Reloaded and Nature's Fairy mushroom answer for Demonic Pacts' holders", () => {
  const effects = Common.data.effects;
  const heist = cases(BANK_HEIST);
  assert.equal(Common.effectActive(heist.relic, effects.bankHeist), true);
  assert.ok(itemActions.get("Banker's briefcase")?.Teleport);
  for (const player of [heist.without, heist.main]) assert.equal(Common.effectActive(player, effects.bankHeist), false);

  const grimoire = cases(GRIMOIRE);
  const bypass = (player) => emit("prayer:unlocks-bypass", { player, prayer: "PIETY", bypass: false }).bypass;
  assert.equal(bypass(grimoire.relic), true, "every prayer");
  assert.equal(emit("magic:spell-unlocked", { player: grimoire.relic, unlocked: false }).unlocked, true);
  const echoes = character("echoes-grimoire", "league", { 6: 2 }, 5);
  assert.equal(Common.hasRelic(echoes, "grimoire"), true);
  assert.equal(bypass(echoes), false, "Raging Echoes' Grimoire leaves the prayers alone");
  for (const player of others(grimoire)) assert.equal(bypass(player), false);

  const accord = cases(NATURES_ACCORD);
  assert.equal(Common.effectActive(accord.relic, effects.fairysFlight), true, "the Fairy mushroom");
  assert.equal(Common.effectActive(accord.without, effects.fairysFlight), false);

  const reloaded = character("reloaded", "league", { ...RELOADED, 4: 1 });
  assert.equal(Unlock.unlock(reloaded, 4, 2, { bankOpen: false }), true, "a second tier 5 relic");
  assert.equal(Common.hasRelic(reloaded, "larcenist"), true);
  const late = character("reloaded-late", "league", { ...RELOADED, 7: 1 });
  assert.equal(Unlock.unlock(late, 7, 3, { bankOpen: true }), false, "not tier 8");
});

test("Conniving Clues: the clue perks, no items at emote, Falo and Charlie steps, contracts and a scroll box from caskets", () => {
  const who = cases(CONNIVING_CLUES);
  assert.equal(emit("hunter:impling-clue-chance", { player: who.relic, oneIn: 100 }).oneIn, 15);
  assert.equal(emit("treasure-trails:vessel-chance", { player: who.relic, multiplier: 1 }).multiplier, 10);
  assert.equal(emit("treasure-trails:requirement-waived", { player: who.relic, kind: "charlie", waived: false }).waived, true);
  Math.random = () => 0;
  emit("treasure-trails:casket-opened", { player: who.relic, tier: "hard" });
  assert.equal(who.relic.getInventory().getAmount(I.CLUE_CONTRACT), 1);
  assert.equal(who.relic.getInventory().getAmount(I.SCROLL_BOX_HARD_), 1);
  Math.random = () => 0.99;
  emit("treasure-trails:casket-opened", { player: who.relic, tier: "master" });
  assert.equal(who.relic.getInventory().getAmount(I.CLUE_CONTRACT), 1, "two in three caskets give none");
  Math.random = () => 0;
  for (const player of others(who)) {
    emit("treasure-trails:casket-opened", { player, tier: "hard" });
    assert.equal(player.getInventory().getAmount(I.CLUE_CONTRACT), 0);
    assert.equal(emit("hunter:impling-clue-chance", { player, oneIn: 100 }).oneIn, 100);
  }
  assert.ok(itemActions.get("Clue contract")?.["Teleport-to-clue"]);
  const contract = character("contract", "league", CONNIVING_CLUES);
  const event = { player: contract, handled: false };
  itemActions.get("Clue contract")["Teleport-to-clue"](event);
  assert.equal(contract.sent.messages.at(-1), "Read a Clue Scroll to allow the contract to find its location.", "the cache's line");
});

test("Nature's Accord: ten times the yield, noted, with its XP; crops never die and a seed is kept 20% of the time", () => {
  const who = cases(NATURES_ACCORD);
  const pick = emit("farming:pick", { player: who.relic, itemId: I.POTATO, amount: 1, experience: 9, stored: 0 });
  assert.deepEqual([pick.itemId, pick.amount, pick.experience], [Common.noted(I.POTATO), 10, 90]);
  Math.random = () => 0.1;
  const rules = emit("farming:plant-rules", { player: who.relic, seedId: I.POTATO_SEED, keepSeed: false, undying: false, message: null });
  assert.deepEqual([rules.undying, rules.keepSeed], [true, true]);
  for (const player of others(who)) {
    assert.equal(emit("farming:pick", { player, itemId: I.POTATO, amount: 1, experience: 9, stored: 0 }).amount, 1);
    assert.equal(emit("farming:plant-rules", { player, seedId: I.POTATO_SEED, keepSeed: false, undying: false }).undying, false);
  }
});

test("Nature's Accord: no Farming level to plant, make a seedling or a scarecrow (farming:level-rules)", (t) => {
  require("../plugins/skills/farming/Core.Farming").init({ core });
  const Patches = require("../plugins/skills/farming/Patches.Farming");
  t.mock.method(core.PluginManager, "emitCustomEvent", emit);
  const who = cases(NATURES_ACCORD);
  for (const player of [who.relic, ...others(who)]) player.getSkillManager().setCurrentLevel(Skill.FARMING, 1, false);
  for (const kind of ["plant", "seedling", "scarecrow"]) {
    assert.equal(Patches.hasLevel(who.relic, 85, kind), true, `${kind} with the relic`);
    for (const player of others(who)) assert.equal(Patches.hasLevel(player, 85, kind), false, `${kind} without it`);
  }
  assert.equal(who.relic.sent.messages.some((line) => line.includes("Farming")), false);
  assert.ok(who.without.sent.messages.includes("You need level 85 Farming."), "the refusal");
  who.main.getSkillManager().setCurrentLevel(Skill.FARMING, 85, false);
  assert.equal(Patches.hasLevel(who.main, 85, "plant"), true, "the level itself still does");
});

test("Larcenist: sure pickpockets, ten times the pouches, loot noted and tenfold, repeats, stalls that stay stocked", () => {
  const who = cases(LARCENIST);
  const target = emit("thieving:pickpocket-target", { player: who.relic, target: {}, alwaysSucceeds: false, pouchLimit: 28 });
  assert.deepEqual([target.alwaysSucceeds, target.pouchLimit], [true, 280]);
  const loot = emit("thieving:loot", { player: who.relic, loot: [{ id: I.LOGS, amount: 1 }] });
  assert.deepEqual(loot.loot, [{ id: Common.noted(I.LOGS), amount: 10 }]);
  assert.equal(emit("thieving:done", { player: who.relic, kind: "stall", again: false }).again, true);
  assert.equal(emit("thieving:deplete-stall", { player: who.relic, handled: false }).handled, true);
  who.relic.getInventory().adds(I.LOGS, 1);
  emit("thieving:success", { player: who.relic, method: "stall", itemId: I.LOGS });
  assert.deepEqual([who.relic.getInventory().getAmount(I.LOGS), who.relic.getInventory().getAmount(Common.noted(I.LOGS))], [0, 10]);
  for (const player of others(who)) {
    assert.equal(emit("thieving:pickpocket-target", { player, target: {}, alwaysSucceeds: false, pouchLimit: 28 }).pouchLimit, 28);
    assert.equal(emit("thieving:deplete-stall", { player, handled: false }).handled, false);
  }
});

test("Larcenist: guards never catch the relic's owner at a stall (thieving:stall-watch)", () => {
  const who = cases(LARCENIST);
  assert.equal(emit("thieving:stall-watch", { player: who.relic, object: {}, unseen: false }).unseen, true);
  for (const player of others(who)) assert.equal(emit("thieving:stall-watch", { player, object: {}, unseen: false }).unseen, false);
});

test("Soul Harvest: dropped bones and ashes become soul shards in the inventory (while toggled), crops come as shards", () => {
  const who = cases(SOUL_HARVEST);
  const drops = [{ itemId: I.BIG_BONES, amount: 1, noted: false }, { itemId: I.COINS, amount: 5, noted: false }, { itemId: I.VILE_ASHES, amount: 1, noted: false }];
  emit("npc-drops:generated", { player: who.relic, drops });
  assert.deepEqual(drops.map((drop) => drop.itemId), [I.COINS]);
  assert.equal(who.relic.getInventory().getAmount(I.SOUL_SHARD), 32, "12 for big bones, 20 for vile ashes");
  const pick = emit("farming:pick", { player: who.relic, itemId: I.POTATO, amount: 1, experience: 10, stored: 0 });
  assert.deepEqual([pick.itemId, pick.amount], [I.SOUL_SHARD, 2]);
  const next = emit("farming:pick", { player: who.relic, itemId: I.POTATO, amount: 1, experience: 1, stored: 0 });
  assert.equal(next.stored, 1, "3 XP owed: no shard, no potato");
  toggle(who.relic, "league_relic_soul_harvest_toggle_bones");
  const kept = [{ itemId: I.BONES, amount: 1, noted: false }];
  emit("npc-drops:generated", { player: who.relic, drops: kept });
  assert.equal(kept.length, 1, "toggled off: bones as usual");
  for (const player of others(who)) {
    const list = [{ itemId: I.BIG_BONES, amount: 1, noted: false }];
    emit("npc-drops:generated", { player, drops: list });
    assert.equal(list[0].itemId, I.BIG_BONES);
  }
});

test("Soul Harvest: a health check's Farming XP comes as shards too, a shard per 4 XP", () => {
  const who = cases(SOUL_HARVEST);
  emit("farming:check-health", { player: who.relic, crop: "MAGIC_TREE", type: "TREE", experience: 13768.3 });
  assert.equal(who.relic.getInventory().getAmount(I.SOUL_SHARD), 3442);
  for (const player of others(who)) {
    emit("farming:check-health", { player, crop: "MAGIC_TREE", type: "TREE", experience: 13768.3 });
    assert.equal(player.getInventory().getAmount(I.SOUL_SHARD), 0);
  }
});

test("Soul Harvest: soul shards bind as pure essence at the altars that take it (runecrafting:essence)", () => {
  const altars = {};
  const api = new Proxy({
    core,
    onObjectInteraction: (name, actions) => (altars[name] = { ...altars[name], ...actions }),
    emitCustomEvent: emit,
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/skills/Runecrafting.plugin").register(api);
  const who = cases(SOUL_HARVEST);
  const craft = (player, objectId) => {
    player.getSkillManager().setCurrentLevel(Skill.RUNECRAFTING, 99, false);
    player.getInventory().resetItems();
    player.getInventory().adds(I.SOUL_SHARD, 20).adds(I.PURE_ESSENCE, 2);
    const event = { player, objectId, handled: false };
    altars.Altar["Craft-rune"](event);
    assert.equal(event.handled, true);
    return player.getInventory();
  };
  const nature = craft(who.relic, core.ObjectIdentifiers.ALTAR_46);
  assert.deepEqual([nature.getAmount(I.SOUL_SHARD), nature.getAmount(I.PURE_ESSENCE), nature.getAmount(I.NATURE_RUNE)], [0, 0, 44], "22 essence, 2 runes each at 99");
  for (const player of others(who)) {
    const kept = craft(player, core.ObjectIdentifiers.ALTAR_46);
    assert.deepEqual([kept.getAmount(I.SOUL_SHARD), kept.getAmount(I.NATURE_RUNE)], [20, 4], "only the pure essence");
  }
});

test("Eternal Sustenance: the food eaten is back in its slot", () => {
  const who = cases(ETERNAL_SUSTENANCE);
  for (const player of [who.relic, ...others(who)]) {
    player.getInventory().setItem(3, new core.Item(I.SHARK, 1));
    hooks.onCanEat({ player, itemId: I.SHARK, allow: null });
    player.getInventory().deleteAtSlot(3, 1, false);
    emit("food:eaten", { player, itemId: I.SHARK, heal: 20 });
  }
  assert.equal(who.relic.getInventory().getItems()[3]?.getId(), I.SHARK);
  for (const player of others(who)) assert.notEqual(player.getInventory().getItems()[3]?.getId(), I.SHARK);
});

test("Culling Spree: free Slayer rewards, and 1-3 elite clues from every superior", () => {
  const who = cases(CULLING_SPREE);
  assert.equal(emit("slayer:reward-cost", { player: who.relic, kind: "unlock", cost: 100 }).cost, 0);
  assert.equal(emit("slayer:reward-cost", { player: who.relic, kind: "buy", itemId: I.HERB_SACK, cost: 750 }).cost, 0);
  assert.equal(emit("slayer:reward-cost", { player: who.relic, kind: "buy", itemId: I.ENCHANTED_GEM, cost: 1 }).cost, 1);
  Math.random = () => 0.99;
  const drops = [];
  emit("slayer:superior-rewards", { player: who.relic, drops });
  assert.deepEqual(drops, [{ itemId: I.SCROLL_BOX_ELITE_, amount: 3, noted: false }]);
  for (const player of others(who)) {
    assert.equal(emit("slayer:reward-cost", { player, kind: "unlock", cost: 100 }).cost, 100);
    const none = [];
    emit("slayer:superior-rewards", { player, drops: none });
    assert.equal(none.length, 0);
  }
});

test("Culling Spree: a slain superior brings another half the time (slayer:superior-again)", () => {
  const Superiors = require("../plugins/skills/slayer/Superiors.Slayer");
  const spawned = [];
  Superiors.init({ core, emitCustomEvent: emit, spawnNpc: (definition) => (spawned.push(definition), { getCombat: () => ({ attack() {} }) }) });
  const superiorId = Superiors.resolve().get("bloodveld");
  const superior = {
    getId: () => superiorId,
    getLocation: () => new Location(3420, 3560, 0),
    getCurrentDefinition: () => ({ getName: () => core.CacheDefinitions.getNpc(superiorId).name }),
  };
  const who = cases(CULLING_SPREE);
  assert.ok(Superiors.superiorAgain(who.relic, superior, () => 0.49));
  assert.equal(Superiors.superiorAgain(who.relic, superior, () => 0.5), null, "50%");
  assert.deepEqual(spawned.map(({ id, x, y, owner }) => [id, x, y, owner]), [[superiorId, 3420, 3560, who.relic]], "the same superior where it died");
  for (const player of others(who)) assert.equal(Superiors.superiorAgain(player, superior, () => 0), null);
  assert.equal(spawned.length, 1);
});

test("Culling Spree: the Slayer helmet (i)'s boosts and protection without one (slayer:helmet)", () => {
  const modifiers = {};
  const register = (key) => (fn) => (modifiers[key] = fn);
  const answers = (name, request) => {
    if (name === "slayer:on-task") request.onTask = true;
    emit(name, request);
  };
  require("../plugins/items/SlayerHelmet.plugin").register(new Proxy({
    core,
    emitCustomEvent: answers,
    registerMeleeHitModifier: register("melee"),
    registerRangedHitModifier: register("ranged"),
    registerMagicHitModifier: register("magic"),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const Equipment = require("../plugins/skills/slayer/Equipment.Slayer");
  Equipment.init({ core, emitCustomEvent: emit });
  const banshee = Equipment.GEAR.monsters.find((monster) => monster.names.includes("Banshee"));
  const basilisk = Equipment.GEAR.monsters.find((monster) => monster.names.includes("Basilisk"));
  const who = cases(CULLING_SPREE);
  const target = { isNpc: () => true, getAsNpc: () => ({}) };
  const fighting = (player) => Object.assign(player, { getCombat: () => ({ getTarget: () => target }) });
  const entity = (player) => ({ isPlayer: () => true, getAsPlayer: () => fighting(player) });
  assert.deepEqual([modifiers.melee(entity(who.relic), 60), modifiers.ranged(entity(who.relic), 40), modifiers.magic(entity(who.relic), 40)], [70, 46, 46]);
  assert.equal(Equipment.protectedFrom(who.relic, banshee), true, "the helmet covers earmuffs");
  assert.equal(Equipment.protectedFrom(who.relic, basilisk), false, "not a mirror shield");
  for (const player of others(who)) {
    assert.deepEqual([modifiers.melee(entity(player), 60), modifiers.magic(entity(player), 40)], [60, 40]);
    assert.equal(Equipment.protectedFrom(player, banshee), false);
  }
});

test("Flow State: catches roll every 2 ticks", () => {
  const who = cases(FLOW_STATE);
  assert.equal(emit("fishing:interval", { player: who.relic, ticks: 5 }).ticks, 2);
  for (const player of others(who)) assert.equal(emit("fishing:interval", { player, ticks: 5 }).ticks, 5);
});

test("Flow State: every listed skill's loop paces at 2 ticks (skills:action-interval), smelting but not anvil work", () => {
  const who = cases(FLOW_STATE);
  const pace = (player, skill, kind, ticks) => emit("skills:action-interval", { player, skill, kind, ticks }).ticks;
  const loops = [
    [Skill.MINING, "mine"], [Skill.WOODCUTTING, "chop"], [Skill.COOKING, "cook"], [Skill.FIREMAKING, "light"],
    [Skill.FIREMAKING, "tend"], [Skill.PRAYER, "offer"], [Skill.FLETCHING, "logs"], [Skill.SMITHING, "smelt"],
    [Skill.CRAFTING, "leather"], [Skill.CRAFTING, "smelt"], [Skill.FARMING, "rake"], [Skill.FARMING, "harvest"],
    [Skill.MAGIC, "alchemy"], [Skill.MAGIC, "superheat"], [Skill.MAGIC, "enchant"],
  ];
  for (const [skill, kind] of loops) {
    assert.equal(pace(who.relic, skill, kind, 5), 2, `${kind} with the relic`);
    assert.equal(pace(who.relic, skill, kind, 1), 1, `${kind}: a faster pace stays (a recipe's own)`);
    for (const player of others(who)) assert.equal(pace(player, skill, kind, 5), 5, `${kind} without it`);
  }
  assert.equal(pace(who.relic, Skill.SMITHING, "smith", 5), 5, "anvil work is not smelting");
  assert.equal(pace(who.relic, Skill.HERBLORE, "mix", 5), 5, "a skill the Wiki leaves out");
  assert.equal(pace(who.relic, Skill.AGILITY, "lap", 5), 5);
});

/** A skill plugin's api: its tasks kept for the test to run, its events answered by the league's units as well as its own. */
function skillApi(answers = {}) {
  const tasks = [];
  const own = {};
  const submit = (task) => {
    task.setRunning?.(true);
    tasks.push(task);
  };
  return new Proxy({
    core: { ...core, TaskManager: { submit } },
    tasks,
    getTaskManager: () => ({ submit }),
    onCustomEvent: (name, handler) => (own[name] ??= []).push(handler),
    emitCustomEvent: (name, payload) => {
      answers[name]?.(payload);
      for (const handler of [...(own[name] ?? []), ...(custom[name] ?? [])]) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
}

/** Runs a task for `ticks` ticks, noting each tick `changed()` is true. */
function ticksOf(task, ticks, changed) {
  const at = [];
  for (let tick = 1; tick <= ticks && task.isRunning(); tick++) {
    task.execute();
    if (changed()) at.push(tick);
  }
  return at;
}

test("Flow State: Crafting's make-many loop asks for its pace and makes an item every 2 ticks (3 without)", () => {
  const Crafting = require("../plugins/skills/crafting/Shared.Crafting");
  const api = skillApi();
  Crafting.attach(api);
  const who = cases(FLOW_STATE);
  const made = (player) => {
    let count = 0;
    let seen = 0;
    Crafting.startMaking(player, { amount: 4, startTick: 0, firstTick: 2, interval: 3, kind: "leather", has: () => true, make: () => (count++, true) });
    return ticksOf(api.tasks.at(-1), 12, () => seen !== count && (seen = count, true));
  };
  assert.deepEqual(made(who.relic), [2, 4, 6, 8]);
  for (const player of others(who)) assert.deepEqual(made(player), [2, 5, 8, 11], "the loop's own 3 ticks");
});

test("Flow State: Fletching's knife on logs asks for its pace: shafts every 2 ticks (3 without); a fletching knife's tick stacks, 1 tick", () => {
  const Fletching = require("../plugins/skills/fletching/Shared.Fletching");
  const api = skillApi();
  Fletching.init(api);
  const who = cases(FLOW_STATE);
  const cut = (player, knife) => {
    player.getInventory().resetItems?.();
    player.getInventory().add(new core.Item(knife, 1)).add(new core.Item(I.LOGS, 3));
    let menu = null;
    const sender = player.getPacketSender();
    player.getPacketSender = () => new Proxy(sender, { get: (target, key) => (key === "sendCreationMenu" ? (value) => (menu = value, sender) : target[key]) });
    Fletching.handlePair(player, knife, I.LOGS);
    menu.execute(I.ARROW_SHAFT, 3);
    let seen = player.getInventory().getAmount(I.ARROW_SHAFT);
    const at = ticksOf(api.tasks.at(-1), 12, () => {
      const shafts = player.getInventory().getAmount(I.ARROW_SHAFT);
      return shafts !== seen && (seen = shafts, true);
    });
    player.getPacketSender = () => sender;
    return at;
  };
  assert.deepEqual(cut(who.relic, I.KNIFE), [2, 4, 6]);
  for (const player of others(who)) assert.deepEqual(cut(player, I.KNIFE), [2, 5, 8], "the logs group's own 3 ticks");
  assert.deepEqual(cut(who.relic, I.FLETCHING_KNIFE), [2, 3, 4], "the knife's tick off the relic's 2");
  for (const player of others(who)) assert.deepEqual(cut(player, I.FLETCHING_KNIFE), [2, 4, 6], "the knife's own 2 ticks");
});

test("Flow State: bones offered on an altar repeat every 2 ticks (4 without)", () => {
  const BoneAltars = require("../plugins/skills/BoneAltars.plugin");
  const api = skillApi({ "prayer:bone": (request) => { if (request.itemId === I.BONES) request.bone = { xp: 4.5 }; } });
  BoneAltars.register(api);
  const who = cases(FLOW_STATE);
  const altar = { blessing: () => ({ experience: 4.5, message: "The gods are pleased with your offering." }) };
  const object = { getLocation: () => new Location(3201, 3200, 0) };
  const offered = (player) => {
    player.getInventory().add(new core.Item(I.BONES, 8));
    const request = { player, object, itemId: I.BONES, altar, handled: false };
    api.emitCustomEvent("bone-altars:offer", request);
    assert.equal(request.handled, true);
    assert.equal(player.getInventory().getAmount(I.BONES), 7, "the first at once");
    let left = 7;
    return ticksOf(api.tasks.at(-1), 8, () => {
      const now = player.getInventory().getAmount(I.BONES);
      return now !== left && (left = now, true);
    });
  };
  Math.random = () => 0.99;
  assert.deepEqual(offered(who.relic), [2, 4, 6, 8]);
  for (const player of others(who)) assert.deepEqual(offered(player), [4, 8], "the altar's own 4 ticks");
});

test("skills:action-interval: unanswered, a loop keeps its own pace; never under 1", () => {
  const { actionInterval } = require("../plugins/skills/SkillActions");
  const seen = [];
  const emitter = { emitCustomEvent: (name, request) => seen.push([name, { ...request }]) };
  const player = character("pace", "main");
  assert.equal(actionInterval(emitter, player, Skill.MINING, "mine", 5), 5);
  assert.deepEqual(seen, [["skills:action-interval", { player, skill: Skill.MINING, kind: "mine", ticks: 5 }]]);
  assert.equal(actionInterval({ emitCustomEvent: (name, request) => (request.ticks = 0) }, player, Skill.MINING, "mine", 5), 1);
  assert.equal(actionInterval(null, player, Skill.MINING, "mine", 4), 4);
});

test("Executioner (Demonic Pacts): the axe finishes an NPC under 20%, but never Yama", () => {
  const who = cases(EXECUTIONER);
  const npc = (name) => ({ isNpc: () => true, isPlayer: () => false, getHitpoints: () => 10, getMaxHitpoints: () => 100, getDefinition: () => ({ getName: () => name }) });
  const struck = (attacker, target) => {
    const damage = new core.HitDamage(0, core.HitMask.BLUE);
    hooks.onCombatHitDamage({ attacker, target, combatType: core.CombatType.RANGED, hit: null, damage, accurate: false });
    return damage.getDamage();
  };
  for (const player of [who.relic, ...others(who)]) player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(I.SAGES_AXE, 1));
  assert.equal(struck(who.relic, npc("Goblin")), 10);
  assert.equal(struck(who.relic, npc("Yama")), 0);
  for (const player of [who.without, who.main]) assert.equal(struck(player, npc("Goblin")), 0);
});

test("Executioner (Demonic Pacts): the axe reaches 6 tiles for its owner, the shared profile's 5 otherwise", () => {
  const who = cases(EXECUTIONER);
  const reach = (attacker, combatType = core.CombatType.RANGED, distance = 5) => {
    const event = { attacker, target: {}, combatType, manualCast: false, distance };
    hooks.onCombatAttackDistance(event);
    return event.distance;
  };
  for (const player of [who.relic, ...others(who)]) player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(I.SAGES_AXE, 1));
  assert.equal(reach(who.relic), 6);
  assert.equal(reach(who.relic, core.CombatType.RANGED, 7), 8, "a tile more on top of what else sets it");
  assert.equal(reach(who.relic, core.CombatType.RANGED, 10), 10, "never past 10");
  assert.equal(reach(who.relic, core.CombatType.MELEE, 1), 1);
  for (const player of others(who)) assert.equal(reach(player), 5);
  who.relic.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(I.RUNE_THROWNAXE, 1));
  assert.equal(reach(who.relic, core.CombatType.RANGED, 4), 4, "another weapon");
});

test("Flask of Fervour: everything restored, hits on the player 0 for four ticks, three minutes of cooldown cut by big hits", () => {
  const who = cases(FLASK_OF_FERVOUR);
  const flask = itemActions.get("Flask of fervour");
  const skills = who.relic.getSkillManager();
  skills.setMaxLevels(Skill.HITPOINTS, 90, false);
  who.relic.setHitpoints(10);
  const event = { player: who.relic, handled: false };
  flask.Activate(event);
  assert.equal(event.handled, true);
  assert.equal(who.relic.getHitpoints(), skills.getMaxLevel(Skill.HITPOINTS));
  assert.equal(who.relic.sent.messages.at(-1), "<col=FE206A>Your Flask of fervour unleashes its power. The Sigil has lost power for 3 minutes.");
  const hit = new core.HitDamage(25, core.HitMask.RED);
  emit("combat:damage-apply", { target: who.relic, hit });
  assert.equal(hit.getDamage(), 0, "shielded");
  flask.Activate({ player: who.relic, handled: false });
  assert.equal(who.relic.sent.messages.at(-1), "<col=FE206A>The Flask of fervour is on cooldown for another 180 seconds!");
  const ReadyAt = require("../plugins/modes/leaguerelics/FlaskOfFervour.LeagueRelics").READY_AT_ATTRIBUTE;
  const before = who.relic.getAttribute(ReadyAt);
  let applied;
  hooks.onPlayerDealtDamage({ player: who.relic, target: null, hit: {
    getHits: () => [{ onApplied: (fn) => (applied = fn) }],
    getCombatType: () => core.CombatType.MELEE, isAccurate: () => true, getTotalDamage: () => 35,
    getCombatMethod: () => core.CombatFactory.MELEE_COMBAT, getTarget: () => null,
  } });
  applied(35);
  assert.equal(before - who.relic.getAttribute(ReadyAt), 1800, "three ticks off for 35 damage");
  for (const player of [who.without, who.main]) {
    const other = { player, handled: false };
    assert.equal(flask.Activate(other), false);
    assert.equal(other.handled, false);
  }
});

test("Flask of Fervour: three explosions 1, 3 and 5 ticks on, with the recording's impacts; 60% of Prayer to NPCs, 30% to players in PvP", (t) => {
  const who = cases(FLASK_OF_FERVOUR);
  const flask = itemActions.get("Flask of fervour");
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => tasks.push(task));
  t.mock.method(core.CombatFactory, "validTarget", () => true);
  const wilderness = new Set();
  t.mock.method(core.CombatFactory, "canAttackByPolicy", (attacker, target) =>
    (target.isPlayer?.() && !wilderness.has(target) ? core.CanAttackResponse.CANT_ATTACK_IN_AREA : core.CanAttackResponse.CAN_ATTACK));
  const victim = (name, at, isPlayer = false) => {
    const pending = [];
    return {
      pending, isPlayer: () => isPlayer, getHitpoints: () => 50, getLocation: () => at,
      getDefinition: () => ({ getName: () => name }), getCurrentDefinition: () => ({ isAttackable: () => true }),
      getTimers: () => ({ has: () => false }),
      getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => pending.push(...hits.map((hit) => hit.getDamage())) }) }),
    };
  };
  const here = who.relic.getLocation();
  const goblin = victim("Goblin", new Location(here.getX() + 3, here.getY(), 0));
  const far = victim("Goblin", new Location(here.getX() + 4, here.getY(), 0));
  const yama = victim("Yama", new Location(here.getX() + 1, here.getY(), 0));
  const rival = victim("rival", new Location(here.getX(), here.getY() - 2, 0), true);
  const bystander = victim("bystander", new Location(here.getX(), here.getY() + 1, 0), true);
  wilderness.add(rival);
  who.relic.getLocalNpcs = () => [goblin, far, yama];
  who.relic.getLocalPlayers = () => [who.relic, rival, bystander];
  const graphics = [];
  const sender = who.relic.getPacketSender();
  who.relic.getPacketSender = () => new Proxy(sender, { get: (target, key) => (key === "sendGlobalGraphic"
    ? (graphic, at) => (graphics.push([graphic.id, graphic.delay, at.getX() - here.getX(), at.getY() - here.getY()]), sender) : target[key]) });
  who.relic.getSkillManager().setMaxLevels(Skill.PRAYER, 99, false);
  flask.Activate({ player: who.relic, handled: false });
  const explosions = tasks.filter((task) => task.getDelay() < 10).sort((a, b) => a.getDelay() - b.getDelay());
  assert.deepEqual(explosions.map((task) => task.getDelay()), [1, 3, 5]);
  assert.equal(graphics.length, 0, "nothing on the Activate tick");
  for (const task of explosions) task.execute();
  assert.deepEqual([goblin.pending, rival.pending], [[59, 59, 59], [29, 29, 29]]);
  assert.deepEqual([far.pending, yama.pending, bystander.pending], [[], [], []], "out of reach, spared, not in PvP");
  const impact = core.CacheDefinitions.getSpotanimId("leagues_6_sigil_of_life_impact");
  assert.equal(graphics.length, 72, "8 lines of 3, three times");
  const first = graphics.slice(0, 24);
  assert.ok(first.every(([id]) => id === impact));
  assert.deepEqual(first.filter(([, , dx, dy]) => dx === 1 && dy === 1).map(([, delay]) => delay), [20]);
  assert.deepEqual(first.filter(([, , dx, dy]) => dx === -2 && dy === 0).map(([, delay]) => delay), [30]);
  assert.deepEqual(first.filter(([, , dx, dy]) => dx === 0 && dy === -3).map(([, delay]) => delay), [40]);
  who.relic.getPacketSender = () => sender;
});

/** The Agility plugin, attached to a test api: its ground-item pickup hook and the marks it lays kept for the test. */
function agility() {
  const pickups = [];
  const laid = [];
  const floor = {
    inventoryCapacity: (player, item) => player.getInventory().getAddableAmount(item),
    registerLocation: (player, item, position, privateArea, options) => laid.push({ item, position, options }),
    ownedBy: () => [],
  };
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit() {} }),
    getItemOnGroundManager: () => floor,
    onGroundItemPickup: (handler) => pickups.push(handler),
    onCustomEvent() {},
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/skills/Agility.plugin").register(api);
  /** Picks up a course mark the player owns on `tile`. */
  const pickUp = (player, [x, y, z]) => {
    const groundItem = { getItem: () => new core.Item(I.MARK_OF_GRACE, 1), getgoesGlobal: () => false, getDespawnDelay: () => 1000 };
    for (const handler of pickups) handler({ player, groundItem, groundItemId: I.MARK_OF_GRACE, clickType: 1, location: { x, y, z }, handled: false });
  };
  return { pickUp, laid };
}

test("Hotfoot: a rooftop lap's mark is a 33% chance (agility:mark-chance), not on other courses", () => {
  const who = cases(HOTFOOT);
  const chance = (player, course) => emit("agility:mark-chance", { player, course, chance: 0.0667 }).chance;
  for (const course of ["draynor", "alkharid", "varrock", "canifis", "falador", "seers", "pollnivneach", "rellekka", "ardougne"]) {
    assert.equal(chance(who.relic, course), 0.33, course);
  }
  assert.equal(chance(who.relic, "ape-atoll"), 0.0667, "not a rooftop course");
  assert.equal(chance(who.relic, "shayzien-basic"), 0.0667, "not a rooftop course");
  for (const player of others(who)) assert.equal(chance(player, "draynor"), 0.0667);
});

test("Hotfoot: a picked-up course mark finishes a lap, counted twice and paid, with 10,000 coins and its own 33% mark roll", () => {
  const { pickUp, laid } = agility();
  const who = cases(HOTFOOT);
  const mark = [3275, 3186, 3];
  const laps = (player) => player.getAttribute("agility.laps")?.alkharid ?? 0;
  for (const player of Object.values(who)) {
    player.getSkillManager().setCurrentLevel(Skill.AGILITY, 99, false).setMaxLevels(Skill.AGILITY, 99, false);
    player.setAttribute("agility.progress", { course: "alkharid", index: 3 });
  }
  // 99 Agility on Al Kharid: the course's own chance is 2/6 cut to a fifth, under 0.32; Hotfoot's is 0.33.
  Math.random = () => 0.32;
  const before = xp(who.relic, Skill.AGILITY);
  pickUp(who.relic, mark);
  assert.equal(laps(who.relic), 2, "the lap counts twice");
  assert.equal(who.relic.getAttribute("agility.progress"), null, "the lap in progress is over");
  assert.ok(xp(who.relic, Skill.AGILITY) > before, "the lap's completion bonus (36, 25% more)");
  assert.equal(who.relic.getInventory().getAmount(I.COINS), 10000);
  assert.equal(laid.filter(({ item }) => item.getId() === I.MARK_OF_GRACE).length, 1, "the finished lap rolls its own mark at 33%");

  for (const player of others(who)) {
    laid.length = 0;
    pickUp(player, mark);
    // Raging Echoes' slot is Corner Cutter, whose laps also count twice, but a mark finishes none.
    assert.equal(laps(player), 0, player.getUsername());
    assert.deepEqual(player.getAttribute("agility.progress"), { course: "alkharid", index: 3 });
    assert.equal(player.getInventory().getAmount(I.COINS), 0);
    assert.equal(laid.length, 0);
  }
  const elsewhere = character("elsewhere", "league", HOTFOOT);
  pickUp(elsewhere, [3200, 3200, 0]);
  assert.equal(laps(elsewhere), 0, "a mark off every course's mark tiles finishes nothing");
});

test("Barbarian Gathering: bare hands chop and mine as the crystal axe and pickaxe, at any level; without it, no tool", () => {
  const Woodcutting = require("../plugins/skills/Woodcutting.plugin");
  const Mining = require("../plugins/skills/Mining.plugin");
  Woodcutting.register(skillApi());
  Mining.register(skillApi());
  const who = cases(BARBARIAN_GATHERING);
  const axe = Woodcutting.findBestUsableAxe(who.relic);
  const crystalAxe = Woodcutting.AXES.find((entry) => entry.id === I.CRYSTAL_AXE);
  assert.deepEqual([axe.id, axe.tier, axe.animationId, axe.requiredLevel, axe.requiredAgility], [null, crystalAxe.tier, crystalAxe.animationId, 1, 1],
    "the crystal axe's cut chance and swing, no item and no requirement");
  const pickaxe = Mining.findBestPickaxe(who.relic);
  const crystalPickaxe = Mining.PICKAXES.find((entry) => entry.id === I.CRYSTAL_PICKAXE);
  assert.deepEqual([pickaxe.id, pickaxe.key, pickaxe.attemptIntervalTicks, pickaxe.requiredLevel], [null, "crystal", crystalPickaxe.attemptIntervalTicks, 1]);

  who.relic.getInventory().add(new core.Item(I.BRONZE_AXE, 1));
  assert.equal(Woodcutting.findBestUsableAxe(who.relic).id, I.BRONZE_AXE, "a held axe is used before bare hands");
  for (const player of others(who)) {
    assert.equal(Woodcutting.findBestUsableAxe(player), null);
    assert.equal(Mining.findBestPickaxe(player), null);
  }
});

test("Barbarian Gathering: bare hands fish a bait spot with no bait, and use none; a held rod still takes bait", () => {
  const Fishing = require("../plugins/skills/Fishing.plugin");
  Fishing.register(skillApi());
  const who = cases(BARBARIAN_GATHERING);
  const tool = Fishing.TOOLS.FISHING_ROD;
  for (const player of Object.values(who)) player.getSkillManager().setCurrentLevel(Skill.FISHING, 99, false).setMaxLevels(Skill.FISHING, 99, false);
  const hands = Fishing.hasToolRequirements(who.relic, tool);
  assert.equal(hands?.baitless, true, "no rod and no bait: bare hands");
  who.relic.getInventory().add(new core.Item(I.FISHING_BAIT, 5));
  Fishing.landCatch(who.relic, tool, hands, [tool.fish.at(-1)]);
  assert.equal(who.relic.getInventory().getAmount(I.FISHING_BAIT), 5, "the hands use no bait");

  who.relic.getInventory().add(new core.Item(I.FISHING_ROD, 1));
  const rod = Fishing.hasToolRequirements(who.relic, tool);
  assert.equal(rod.baitless, undefined);
  Fishing.landCatch(who.relic, tool, rod, [tool.fish.at(-1)]);
  assert.equal(who.relic.getInventory().getAmount(I.FISHING_BAIT), 4, "a rod's cast takes its bait");
  for (const player of others(who)) assert.equal(Fishing.hasToolRequirements(player, tool), null);
});

/** Runs `body` with Hunter's shared context pointed at the league's units (its events answered as the relics answer them). */
function withHunter(body) {
  const C = require("../plugins/skills/hunter/Context.Hunter");
  const previous = { api: C.H.api, core: C.H.core };
  C.H.api = { core, emitCustomEvent: (name, payload) => emit(name, payload) };
  C.H.core = core;
  try {
    return body();
  } finally {
    Object.assign(C.H, previous);
  }
}

test("Woodsman: an impling jar's loot doubled and noted (hunter:impling-loot), its clues still one each", () => withHunter(() => {
  const Catching = require("../plugins/skills/hunter/Catching.Hunter");
  const who = cases(WOODSMAN);
  Math.random = () => 0;
  const clues = (loot) => loot.filter(([id]) => /clue|scroll box/i.test(core.ItemDefinition.forId(id).getName()));
  const relic = Catching.rewards(who.relic, { key: "BABY" });
  assert.deepEqual(relic[0], [core.ItemDefinition.forId(I.CHISEL).getNoteId(), 2], "the first row (a chisel), noted and doubled");
  for (const player of others(who)) {
    const loot = Catching.rewards(player, { key: "BABY" });
    assert.deepEqual(loot[0], [I.CHISEL, 1]);
    assert.deepEqual(clues(relic), clues(loot), "the clue rolls are the jar's own");
  }
  assert.ok(clues(relic).length > 0, "a clue was rolled");
}));

test("Woodsman: a Hunters' rumour pays double XP (hunter:rumour-reward), a loot sack rolls its loot twice as often (hunter:sack-rolls)", () => withHunter(() => {
  const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
  const who = cases(WOODSMAN);
  const rumourXp = (player) => {
    const skills = player.getSkillManager();
    skills.setCurrentLevel(Skill.HUNTER, 99, false).setMaxLevels(Skill.HUNTER, 99, false);
    const [taskKey, task] = Object.entries(Rumours.tasks).find(([, each]) => each.part && I[each.part]);
    const s = Rumours.state(player);
    s.unlocked = true;
    s.assignments[0] = { task: taskKey, found: true };
    player.getInventory().add(new core.Item(I[task.part], 1));
    const paid = [];
    const add = skills.addExperiences;
    skills.addExperiences = (skill, amount) => (skill === Skill.HUNTER && paid.push(amount), skills);
    try {
      Rumours.assign(player, 0);
    } finally {
      skills.addExperiences = add;
    }
    return paid;
  };
  const novice = Rumours.masters()[0][3];
  assert.deepEqual(rumourXp(who.relic), [(99 + 5) * novice * 2]);
  for (const player of others(who)) assert.deepEqual(rumourXp(player), [(99 + 5) * novice]);

  Math.random = () => 0.5;
  assert.equal(Rumours.sackRewards(who.relic, "basic").length, 10, "a basic sack's 5 loot rolls, doubled");
  for (const player of others(who)) assert.equal(Rumours.sackRewards(player, "basic").length, 5);
}));

test("Woodsman: a quetzal whistle keeps its charge (quetzals:whistle-charge)", () => {
  const who = cases(WOODSMAN);
  const kept = (player) => emit("quetzals:whistle-charge", { player, itemId: I.BASIC_QUETZAL_WHISTLE, kept: false }).kept;
  assert.equal(kept(who.relic), true);
  for (const player of others(who)) assert.equal(kept(player), false);
});

// ---- Evil Eye and Map of Alacrity: destinations by area (data/league-evil-eye.json, league-map-of-alacrity.json) ----

const EVIL_EYE_DATA = require("../plugins/modes/data/league-evil-eye.json");
const ALACRITY_DATA = require("../plugins/modes/data/league-map-of-alacrity.json");
const SHORTCUTS = require("../plugins/skills/data/agility-shortcuts.json").shortcuts;
const DP_CAST = require("../plugins/modes/data/league-areas.json").leagues[DP].teleportCast;

/** The league's answers the relics ask (`league:areas`, `league:area-at`, `league:teleport-cast`), set for one test. */
function withLeague({ unlocked = null, areaAt = () => null } = {}, fn) {
  const saved = ["league:areas", "league:area-at", "league:teleport-cast", "quest:is-complete"].map((name) => [name, custom[name]]);
  custom["league:areas"] = [(query) => { query.unlocked = unlocked; }];
  custom["league:area-at"] = [(query) => { query.area = areaAt(query.x, query.y); }];
  custom["league:teleport-cast"] = [(query) => { query.cast = DP_CAST; }];
  try {
    return fn();
  } finally {
    for (const [name, handlers] of saved) {
      if (handlers === undefined) delete custom[name];
      else custom[name] = handlers;
    }
  }
}

/** An item option clicked: carried (inventory slot 0), or worn when `worn` (its equipment slot). */
function click(player, itemId, option, { subOp = null, worn = false } = {}) {
  const name = core.ItemDefinition.forId(itemId).getName();
  const item = new core.Item(itemId, 1);
  const event = worn
    ? { player, interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, item, itemId, slot: core.Equipment.AMULET_SLOT, clickType: 2, handled: false }
    : { player, interfaceId: (149 << 16), item, itemId, slot: 0, clickType: 1, handled: false };
  if (subOp !== null) event.subOpId = subOp + 1;
  const result = itemActions.get(name)?.[option]?.(event);
  return { event, handled: result !== false && event.handled === true };
}

/** The player's latest menu, paged through ("More...") until `label` is on it, then picked. */
function pick(player, label) {
  for (let page = 0; page < 20; page++) {
    const menu = prompts.filter((prompt) => prompt.player === player).at(-1);
    assert.ok(menu, `a menu with ${label}`);
    const entry = menu.entries.find(([text]) => text === label);
    if (entry) return entry[1]();
    const more = menu.entries.find(([text]) => text === "More...");
    assert.ok(more, `${label} on the menu "${menu.title}"`);
    more[1]();
  }
  assert.fail(`${label} never listed`);
}

/** Runs the game's ticks until the player stands on (x, y, z), at most `limit`; the ticks taken. */
function ticksTo(player, { x, y, z = 0 }, limit = 40) {
  for (let tick = 1; tick <= limit; tick++) {
    core.TaskManager.process();
    const at = player.getLocation();
    if (at.getX() === x && at.getY() === y && at.getZ() === z) {
      player.setNeedsPlacement(false);
      return tick;
    }
  }
  return -1;
}

/** Puts the player on a tile as the next tick's sync would leave it (placed). */
function relocate(player, location) {
  player.setLocation(location);
  player.setNeedsPlacement(false);
}

function area(data, name) {
  return data.areas.find((entry) => entry.name === name);
}

test("Evil Eye and Map of Alacrity: the data's areas are the items' submenus, every destination a real tile, named once", () => {
  const areaIds = require("../plugins/modes/data/league-areas.json").leagues[DP].areas;
  for (const [itemId, data] of [[I.EVIL_EYE, EVIL_EYE_DATA], [I.MAP_OF_ALACRITY, ALACRITY_DATA]]) {
    const definition = core.CacheDefinitions.getItem(itemId);
    assert.deepEqual(data.areas.map((entry) => entry.name), definition.subops[0].filter(Boolean), "the cache's subops, in order");
    const names = new Set();
    for (const entry of data.areas) {
      assert.ok(areaIds.includes(entry.area), `${entry.name}: a Demonic Pacts area id`);
      assert.ok(entry.destinations.length > 0, `${entry.name} has destinations`);
      for (const destination of entry.destinations) {
        assert.ok(!names.has(destination.name), `${destination.name} named once`);
        names.add(destination.name);
        assert.ok(Number.isInteger(destination.x) && destination.x > 1000 && destination.x < 4200, `${destination.name} x`);
        assert.ok(Number.isInteger(destination.y) && destination.y > 1000 && destination.y < 13000, `${destination.name} y`);
        assert.ok([0, 1, 2, 3].includes(destination.z ?? 0), `${destination.name} plane`);
      }
    }
  }
  for (const destination of ALACRITY_DATA.areas.flatMap((entry) => entry.destinations)) {
    const shortcut = SHORTCUTS.find((entry) => entry.name === destination.shortcut);
    assert.ok(shortcut, `${destination.name}: the server's ${destination.shortcut}`);
    assert.equal(shortcut.level, destination.level, `${destination.name}: the shortcut's own level`);
  }
  const relics = Common.catalog(DP).tiers[2].relics;
  assert.equal(relics[1].key, Common.data.effects.evilEye.key);
  assert.equal(relics[2].key, Common.data.effects.mapOfAlacrity.key);
});

test("Evil Eye: Teleport's area submenu, carried or worn, lists its destinations; a pick casts the league's teleport to the tile, and Last-destination goes back", () => {
  const who = cases(EVIL_EYE);
  const player = who.relic;
  const varlamore = area(EVIL_EYE_DATA, "Varlamore");
  const target = varlamore.destinations.at(-1);
  withLeague({}, () => {
    assert.equal(click(player, I.EVIL_EYE, "Teleport", { subOp: EVIL_EYE_DATA.areas.indexOf(varlamore) }).handled, true);
    assert.equal(prompts.at(-1).title, "Varlamore");
    pick(player, target.name);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.equal(player.getAnimation()?.getId(), DP_CAST.steps[0].animation, "the league's area-teleport cast");
    assert.ok(ticksTo(player, target) > 0, `landed on ${target.name}`);

    relocate(player, new Location(3200, 3200, 0));
    assert.equal(click(player, I.EVIL_EYE, "Last-destination").handled, true);
    assert.ok(ticksTo(player, target) > 0, "Last-destination goes back");

    // Worn: the same submenu from the equipment tab (the item's params), and a plain click lists the areas.
    relocate(player, new Location(3200, 3200, 0));
    assert.equal(click(player, I.EVIL_EYE, "Teleport", { subOp: EVIL_EYE_DATA.areas.indexOf(varlamore), worn: true }).handled, true);
    assert.equal(prompts.at(-1).title, "Varlamore");
    click(player, I.EVIL_EYE, "Teleport");
    assert.equal(prompts.at(-1).title, Common.message("evilEyeTitle"));
    pick(player, "Varlamore");
    assert.equal(prompts.at(-1).title, "Varlamore");
  });
  const fresh = character("fresh-eye", "league", EVIL_EYE);
  assert.equal(click(fresh, I.EVIL_EYE, "Last-destination").handled, true);
  assert.equal(fresh.sent.messages.at(-1), Common.message("noLastDestination"));
});

test("Evil Eye: a destination in an area not unlocked is refused, from the menu and Last-destination", () => {
  const player = character("locked-eye", "league", EVIL_EYE);
  const varlamore = area(EVIL_EYE_DATA, "Varlamore");
  const asgarnia = area(EVIL_EYE_DATA, "Asgarnia");
  withLeague({ unlocked: [varlamore.area] }, () => {
    click(player, I.EVIL_EYE, "Teleport", { subOp: EVIL_EYE_DATA.areas.indexOf(asgarnia) });
    assert.equal(player.sent.messages.at(-1), Common.message("areaLocked"));
    player.setAttribute("league:last-destination:evil-eye", { label: asgarnia.destinations[0].name, x: 0, y: 0, z: 0 });
    const before = player.getLocation().clone();
    click(player, I.EVIL_EYE, "Last-destination");
    assert.equal(player.sent.messages.at(-1), Common.message("areaLocked"));
    for (let tick = 0; tick < 30; tick++) core.TaskManager.process();
    assert.ok(player.getLocation().equals(before), "stayed");
  });
  // A tile in a locked area of its own (the area unlocks' squares) is refused too.
  withLeague({ unlocked: [varlamore.area], areaAt: () => 999 }, () => {
    click(player, I.EVIL_EYE, "Teleport", { subOp: EVIL_EYE_DATA.areas.indexOf(varlamore) });
    pick(player, varlamore.destinations[0].name);
    assert.equal(player.sent.messages.at(-1), Common.message("areaLocked"));
  });
});

test("Evil Eye and Map of Alacrity: from above level 20 of the Wilderness, where a standard teleport is refused", () => {
  for (const [picks, itemId, option, data] of [[EVIL_EYE, I.EVIL_EYE, "Teleport", EVIL_EYE_DATA], [MAP_OF_ALACRITY, I.MAP_OF_ALACRITY, "Read", ALACRITY_DATA]]) {
    const player = character(`deep-${itemId}`, "league", picks);
    player.getSkillManager().setCurrentLevel(Skill.AGILITY, 99).setMaxLevel(Skill.AGILITY, 99);
    const wilderness = area(data, "Wilderness");
    const target = wilderness.destinations[0];
    relocate(player, new Location(3100, 3900, 0));
    player.setWildernessLevel(47);
    assert.equal(core.TeleportHandler.checkReqs(player, new Location(3200, 3200, 0)), false, "the usual level-20 limit");
    withLeague({}, () => {
      click(player, itemId, option, { subOp: data.areas.indexOf(wilderness) });
      pick(player, target.name);
      assert.ok(ticksTo(player, target) > 0, `landed on ${target.name}`);
    });
  }
});

test("Map of Alacrity: Read lists an area's shortcuts; one above the Agility level, or behind the Wiki's quest, is refused", () => {
  const player = character("alacrity", "league", MAP_OF_ALACRITY);
  const kandarin = area(ALACRITY_DATA, "Kandarin");
  const target = kandarin.destinations.find((destination) => destination.level > 1);
  const skills = player.getSkillManager();
  skills.setCurrentLevel(Skill.AGILITY, target.level - 1).setMaxLevel(Skill.AGILITY, target.level - 1);
  withLeague({}, () => {
    assert.equal(click(player, I.MAP_OF_ALACRITY, "Read", { subOp: ALACRITY_DATA.areas.indexOf(kandarin) }).handled, true);
    const before = player.getLocation().clone();
    pick(player, target.name);
    assert.equal(player.sent.messages.at(-1), Common.message("agilityTooLow", { level: target.level }));
    for (let tick = 0; tick < 30; tick++) core.TaskManager.process();
    assert.ok(player.getLocation().equals(before), "stayed");

    skills.setCurrentLevel(Skill.AGILITY, target.level).setMaxLevel(Skill.AGILITY, target.level);
    click(player, I.MAP_OF_ALACRITY, "Read", { subOp: ALACRITY_DATA.areas.indexOf(kandarin) });
    pick(player, target.name);
    assert.ok(ticksTo(player, target) > 0, `landed on ${target.name}`);
    relocate(player, new Location(3200, 3200, 0));
    click(player, I.MAP_OF_ALACRITY, "Last-destination");
    assert.ok(ticksTo(player, target) > 0, "Last-destination");

    const varlamore = area(ALACRITY_DATA, "Varlamore");
    const behindQuest = varlamore.destinations.find((destination) => destination.quest);
    skills.setCurrentLevel(Skill.AGILITY, 99).setMaxLevel(Skill.AGILITY, 99);
    custom["quest:is-complete"] = [(query) => { if (query.name === behindQuest.quest) query.complete = false; }];
    click(player, I.MAP_OF_ALACRITY, "Read", { subOp: ALACRITY_DATA.areas.indexOf(varlamore) });
    pick(player, behindQuest.name);
    assert.equal(player.sent.messages.at(-1), Common.message("questNeeded", { quest: behindQuest.quest }));
  });
});

test("Evil Eye and Map of Alacrity: nothing for a character without the relic, another league's or a main character", () => {
  for (const [picks, itemId, option] of [[EVIL_EYE, I.EVIL_EYE, "Teleport"], [MAP_OF_ALACRITY, I.MAP_OF_ALACRITY, "Read"]]) {
    const who = cases(picks);
    for (const player of others(who)) {
      const count = prompts.length;
      assert.equal(click(player, itemId, option, { subOp: 0 }).handled, false, "on to the game's own");
      assert.equal(click(player, itemId, "Last-destination").handled, false);
      assert.equal(prompts.length, count, "no menu");
    }
  }
});

/** A process cycle the tests move on: each tick runs the task manager once. */
function withClock(t) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  return (ticks = 1) => {
    for (let tick = 0; tick < ticks; tick++) {
      cycle++;
      core.TaskManager.process();
    }
  };
}

function castOn(player, spellName, slot) {
  const item = player.getInventory().getItems()[slot];
  const event = { player, spellName, spellWidget: 0, spellItemId: -1, itemId: item.getId(), slot, handled: false };
  hooks.onSpellOnItem(event);
  return event;
}

/** The Magic XP `base` XP brings this character (the league's rates). */
function magicRate(player, base) {
  const control = character(`${player.getUsername()}-control`, "league", {});
  const before = xp(control, Skill.MAGIC);
  control.getSkillManager().addExperiences(Skill.MAGIC, base);
  return xp(control, Skill.MAGIC) - before;
}

test("Transmute: Divergence turns 10 of a noted stack into the next tier, noted, with 10 Magic XP each, and casts again every 5 ticks", (t) => {
  const tick = withClock(t);
  const who = cases(TRANSMUTE);
  const player = who.relic;
  const inventory = player.getInventory();
  inventory.resetItems();
  inventory.adds(I.UNCUT_SAPPHIRE_2, 24);
  const before = xp(player, Skill.MAGIC);
  assert.equal(castOn(player, "Alchemic Divergence", 0).handled, true);
  assert.equal(inventory.getAmount(I.UNCUT_SAPPHIRE_2), 14);
  assert.equal(inventory.getAmount(Common.noted(I.UNCUT_EMERALD)), 10, "noted stays noted");
  assert.equal(xp(player, Skill.MAGIC) - before, magicRate(player, 100));
  tick(4);
  assert.equal(inventory.getAmount(I.UNCUT_SAPPHIRE_2), 14, "not before 5 ticks");
  tick(1);
  assert.equal(inventory.getAmount(I.UNCUT_SAPPHIRE_2), 4);
  assert.equal(inventory.getAmount(Common.noted(I.UNCUT_EMERALD)), 20);
  tick(5);
  assert.equal(inventory.getAmount(I.UNCUT_SAPPHIRE_2), 0, "the last 4");
  assert.equal(inventory.getAmount(Common.noted(I.UNCUT_EMERALD)), 24);
  tick(10);
  assert.equal(inventory.getAmount(Common.noted(I.UNCUT_EMERALD)), 24, "the slot is empty: no more casts");
});

test("Transmute: Convergence goes a tier down; loose items convert in place, up to 10, only with a free slot for each", (t) => {
  const tick = withClock(t);
  const player = cases(TRANSMUTE).relic;
  const inventory = player.getInventory();
  inventory.resetItems();
  for (let count = 0; count < 4; count++) inventory.adds(I.UNCUT_DIAMOND, 1);
  castOn(player, "Alchemic Convergence", 0);
  assert.equal(inventory.getAmount(I.UNCUT_DIAMOND), 0);
  assert.equal(inventory.getAmount(I.UNCUT_RUBY), 4);
  inventory.resetItems();
  for (let count = 0; count < 22; count++) inventory.adds(I.BONES, 1);
  tick(5);
  const messages = player.sent.messages.length;
  castOn(player, "Alchemic Divergence", 0);
  assert.equal(inventory.getAmount(I.BONES), 22, "6 free slots for 10 bones");
  assert.equal(player.sent.messages.at(-1), "<col=ff3045>You do not have inventory space for anymore transmuted items of that type.");
  assert.equal(player.sent.messages.length, messages + 1);
});

test("Transmute: an item no row has, and the lowest tier, as recorded; a stackable stack (runes) moves 10", (t) => {
  withClock(t);
  const player = cases(TRANSMUTE).relic;
  const inventory = player.getInventory();
  inventory.resetItems();
  inventory.adds(I.BRONZE_BAR, 1);
  castOn(player, "Alchemic Divergence", 0);
  assert.equal(player.sent.messages.at(-1), "Nothing interesting happens.");
  assert.equal(inventory.getAmount(I.BRONZE_BAR), 1);
  inventory.resetItems();
  inventory.adds(I.UNCUT_SAPPHIRE_2, 5);
  const boxes = [];
  t.mock.method(player, "getDialogueManager", () => ({ startDialogues: (chain) => boxes.push(chain) }));
  castOn(player, "Alchemic Convergence", 0);
  assert.equal(boxes.length, 1, "the lowest tier's item box");
  assert.equal(inventory.getAmount(I.UNCUT_SAPPHIRE_2), 5);
  inventory.resetItems();
  inventory.adds(I.FIRE_RUNE, 25);
  castOn(player, "Alchemic Divergence", 0);
  assert.equal(inventory.getAmount(I.FIRE_RUNE), 15);
  assert.equal(inventory.getAmount(I.CHAOS_RUNE), 10);
});

test("Transmute: with the bank toggle a stack's products go to the bank; with the alchemy toggle off the spells are alchemy", (t) => {
  withClock(t);
  const player = cases(TRANSMUTE).relic;
  const inventory = player.getInventory();
  inventory.resetItems();
  inventory.adds(I.UNCUT_SAPPHIRE_2, 10);
  toggle(player, "league_relic_transmutation_bank_toggle");
  castOn(player, "Alchemic Divergence", 0);
  assert.equal(banked(player, I.UNCUT_EMERALD), 10);
  assert.equal(inventory.getAmount(Common.noted(I.UNCUT_EMERALD)), 0);
  toggle(player, "league_relic_transmutation_alchemy_toggle");
  const { MagicOnItemPacketListener } = require("../dist/net/packet/impl/MagicOnItemPacketListener");
  const alchemy = t.mock.method(MagicOnItemPacketListener.prototype, "castOnItem", () => true);
  inventory.resetItems();
  inventory.adds(I.UNCUT_SAPPHIRE_2, 10);
  assert.equal(castOn(player, "Alchemic Convergence", 0).handled, true);
  assert.deepEqual(alchemy.mock.calls[0].arguments.slice(0, 4), [player, MagicOnItemPacketListener.prototype.resolveSpellId("Low Level Alchemy"), I.UNCUT_SAPPHIRE_2, 0]);
  castOn(player, "Alchemic Divergence", 0);
  assert.equal(alchemy.mock.calls[1].arguments[1], MagicOnItemPacketListener.prototype.resolveSpellId("High Level Alchemy"));
  assert.equal(inventory.getAmount(I.UNCUT_SAPPHIRE_2), 10, "no transmute");
});

test("Transmute: the ledger, carried or worn, is endless nature runes; an item used on it shows its row with its own tier in red", () => {
  const who = cases(TRANSMUTE);
  const bypass = (player) => {
    const event = { player, spellbook: null, spellId: -1, runeId: I.NATURE_RUNE, bypass: null };
    hooks.onSpellRuneBypass(event);
    return event.bypass;
  };
  const player = who.relic;
  player.getInventory().resetItems();
  assert.equal(bypass(player), null);
  player.getInventory().adds(I.TRANSMUTATION_LEDGER, 1);
  assert.equal(bypass(player), true);
  player.getInventory().resetItems();
  player.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(I.TRANSMUTATION_LEDGER, 1));
  assert.equal(bypass(player), true, "worn");
  const strings = new Map();
  const sender = new Proxy({}, { get: (target, key) => (key === "sendString" ? (text, id) => (strings.set(id & 0xffff, text), sender) : () => sender) });
  player.getPacketSender = () => sender;
  const event = { player, usedItemId: Common.noted(I.MAPLE_LOGS), usedWithItemId: I.TRANSMUTATION_LEDGER, handled: false };
  hooks.onItemOnItem(event);
  assert.equal(event.handled, true);
  assert.equal(strings.get(2), "Logs (Normal)");
  assert.equal(strings.get(4), "1. Logs");
  assert.equal(strings.get(8), "<col=ff3045>5. Maple logs (Current)</col>");
  assert.equal(strings.get(12), "9. Redwood logs");
  const none = { player, usedItemId: I.BRONZE_BAR, usedWithItemId: I.TRANSMUTATION_LEDGER, handled: false };
  hooks.onItemOnItem(none);
  assert.equal(none.handled, false, "the game's own answer");
});

test("Transmute: the spells are left alone for a character without the relic, another league's or a main character", (t) => {
  withClock(t);
  for (const player of others(cases(TRANSMUTE))) {
    player.getInventory().resetItems();
    player.getInventory().adds(I.UNCUT_SAPPHIRE_2, 10);
    assert.equal(castOn(player, "Alchemic Divergence", 0).handled, false);
    assert.equal(player.getInventory().getAmount(I.UNCUT_SAPPHIRE_2), 10);
  }
});
