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
const EXECUTIONER = { 7: 1 };
const FLASK_OF_FERVOUR = { 7: 3 };

let core;
let I;
let Common;
let Unlock;
const hooks = {};
const custom = {};
const itemActions = new Map();
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
    assert.equal(pace(who.relic, skill, kind, 1), 1, `${kind}: a faster pace stays (a fletching knife's, a recipe's)`);
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

test("Flow State: Fletching's knife on logs asks for its pace: shafts every 2 ticks (3 without)", () => {
  const Fletching = require("../plugins/skills/fletching/Shared.Fletching");
  const api = skillApi();
  Fletching.init(api);
  const who = cases(FLOW_STATE);
  const cut = (player) => {
    player.getInventory().add(new core.Item(I.KNIFE, 1)).add(new core.Item(I.LOGS, 3));
    let menu = null;
    const sender = player.getPacketSender();
    player.getPacketSender = () => new Proxy(sender, { get: (target, key) => (key === "sendCreationMenu" ? (value) => (menu = value, sender) : target[key]) });
    Fletching.handlePair(player, I.KNIFE, I.LOGS);
    menu.execute(I.ARROW_SHAFT, 3);
    let seen = 0;
    return ticksOf(api.tasks.at(-1), 12, () => {
      const shafts = player.getInventory().getAmount(I.ARROW_SHAFT);
      return shafts !== seen && (seen = shafts, true);
    });
  };
  assert.deepEqual(cut(who.relic), [2, 4, 6]);
  for (const player of others(who)) assert.deepEqual(cut(player), [2, 5, 8], "the logs group's own 3 ticks");
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
