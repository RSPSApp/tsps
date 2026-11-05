// node --test tests/bounty-hunter-rewards.test.cjs (no build needed: ids come from the generated identifier sources)
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const DIR = "../plugins/minigames/bountyhunter";
const Points = require(`${DIR}/Points.BountyHunter`);
const Emblems = require(`${DIR}/Emblems.BountyHunter`);
const EarningPotential = require(`${DIR}/EarningPotential.BountyHunter`);
const BountyCrates = require(`${DIR}/BountyCrates.BountyHunter`);
const Coffer = require(`${DIR}/Coffer.BountyHunter`);
const EmblemTrader = require(`${DIR}/EmblemTrader.BountyHunter`);
const CorruptedWarrior = require(`${DIR}/CorruptedWarrior.BountyHunter`);

/** NAME -> id (and id -> name) from a generated identifiers class. */
function identifiers(file) {
  const source = fs.readFileSync(path.join(__dirname, "../src/main/typescript/elvarg/util", file), "utf8");
  const ids = {};
  const names = new Map();
  for (const [, name, id, comment] of source.matchAll(/public static (\w+) = (\d+);(?: \/\/ (.*))?/g)) {
    ids[name] = Number(id);
    if (!names.has(Number(id))) names.set(Number(id), comment ?? name);
  }
  return { ids, names };
}

const items = identifiers("ItemIdentifiers.ts");
const I = items.ids;

class Item {
  constructor(id, amount) { this.id = id; this.amount = amount; }
  getId() { return this.id; }
  getAmount() { return this.amount; }
}

const core = {
  Item,
  ItemIdentifiers: I,
  NpcIdentifiers: identifiers("NpcIdentifiers.ts").ids,
  ObjectIdentifiers: identifiers("ObjectIdentifiers.ts").ids,
  ItemDefinition: { forId: (id) => ({ getName: () => items.names.get(id), getNoteId: () => id + 1 }) },
  Misc: { getTicks: (seconds) => seconds / 0.6 },
  SkullType: { WHITE_SKULL: "white" },
  Flag: { APPEARANCE: "appearance" },
  DialogueChainBuilder: class { add() { return this; } },
  ItemStatementDialogue: class {},
  NpcDialogue: class {},
  CacheDefinitions: { getVarbitId: (name) => name, getVarpId: (name) => name },
};

const handlers = new Map();
const api = new Proxy({
  core,
  onCustomEvent: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  emitCustomEvent: (name, payload) => (handlers.get(name) ?? []).forEach((handler) => handler(payload)),
}, { get: (object, name) => object[name] ?? (() => {}) });
for (const unit of [Points, Emblems, EarningPotential, BountyCrates, Coffer, EmblemTrader, CorruptedWarrior]) unit(api);
const emit = (name, payload) => api.emitCustomEvent(name, payload);

let ironman = false;
api.onCustomEvent("ironman:mode", (query) => { query.mode = ironman ? "standard" : "none"; });

function player({ combat = 100, skulled = false, inventory = {} } = {}) {
  const attributes = new Map();
  const slots = Array.from({ length: 28 }, () => new Item(-1, 0));
  Object.entries(inventory).forEach(([id, amount], slot) => { slots[slot] = new Item(Number(id), amount); });
  const container = {
    get: (slot) => slots[slot],
    setItem: (slot, item) => { slots[slot] = item; return container; },
    refreshItems: () => container,
    getSlotForItemId: (id) => slots.findIndex((item) => item.id === id && item.amount > 0),
    getAmount: (id) => slots.filter((item) => item.id === id).reduce((sum, item) => sum + item.amount, 0),
    contains: (id) => container.getAmount(id) > 0,
    getFreeSlots: () => slots.filter((item) => item.id === -1).length,
    deleteNumber: (id, amount) => { slots[container.getSlotForItemId(id)].amount -= amount; },
    getAddableAmount: (item) => item.amount,
    addItem: (item) => container.forceAdd(null, item),
    forceAdd: (_, item) => {
      const slot = container.getSlotForItemId(item.id);
      if (slot >= 0) slots[slot].amount += item.amount;
      else slots[slots.findIndex((entry) => entry.id === -1)] = item;
    },
  };
  const p = {
    varps: new Map(), messages: [], skullTimer: skulled ? 100 : 0,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => container,
    getBanks: () => [],
    getSkillManager: () => ({ getCombatLevel: () => combat }),
    isSkulled: () => p.skullTimer > 0,
    getSkullTimer: () => p.skullTimer,
    sendMessage: (message) => p.messages.push(message),
    getPacketSender() {
      const sender = { sendConfig: (id, value) => { p.varps.set(id, value); return sender; } };
      return sender;
    },
  };
  return p;
}

test("target kills pay 2 points plus the largest milestone bonus, halved when penalised", () => {
  assert.deepEqual([1, 10, 50, 100, 500, 1000].map((kills) => Points.pointsForKill(kills, false)), [2, 5, 7, 12, 27, 27]);
  assert.deepEqual([1, 10, 100].map((kills) => Points.pointsForKill(kills, true)), [1, 2, 6]);

  const killer = player();
  for (let kill = 0; kill < 10; kill++) emit("bounty-hunter:target-killed", { killer, victim: player(), penalised: false, killerSkulled: true });
  assert.equal(Points.targetKills(killer), 10);
  assert.equal(Points.getPoints(killer), 9 * 2 + 5);
  assert.equal(killer.varps.get("bh_2023_points"), 23);
  assert.equal(killer.varps.get("bh_2023_target_kill"), 10);
  emit("bounty-hunter:rogue-killed", { killer, victim: player() });
  assert.equal(killer.varps.get("bh_2023_rogue_kill"), 1);
});

test("arena entry and exit report the current points balance to players, without messaging bots", () => {
  const fighter = player();
  Points.addPoints(fighter, 1234);
  emit("bounty-hunter:entered-arena", { player: fighter });
  assert.equal(fighter.messages.at(-1), "You currently have 1,234 Bounty Hunter points.");
  Points.addPoints(fighter, -234);
  emit("bounty-hunter:left-arena", { player: fighter });
  assert.equal(fighter.messages.at(-1), "You currently have 1,000 Bounty Hunter points.");

  const fresh = player();
  emit("bounty-hunter:entered-arena", { player: fresh });
  assert.equal(fresh.messages.at(-1), "You currently have 0 Bounty Hunter points.");
  const bot = player();
  bot.isPlayerBot = () => true;
  emit("bounty-hunter:entered-arena", { player: bot });
  emit("bounty-hunter:left-arena", { player: bot });
  assert.deepEqual(bot.messages, []);
});

test("a kill gives an emblem to whoever owns none, unless ironman or penalised", () => {
  const killed = (killer, extra = {}) => emit("bounty-hunter:target-killed", { killer, victim: player(), killerSkulled: true, penalised: false, ...extra });
  const fresh = player();
  killed(fresh);
  assert.equal(Emblems.carriedEmblem(fresh)?.tier, 1);
  const penalised = player();
  killed(penalised, { penalised: true });
  assert.equal(Emblems.carriedEmblem(penalised), null);
  ironman = true;
  const iron = player();
  killed(iron);
  ironman = false;
  assert.equal(Emblems.carriedEmblem(iron), null);
});

test("kills upgrade the emblem to tier 10 (5 unskulled); deaths take a tier off and lose tier 1", () => {
  const holder = player({ inventory: { [I.ESOTERIC_EMBLEM_TIER_4_]: 1 } });
  emit("bounty-hunter:target-killed", { killer: holder, victim: player(), killerSkulled: false, penalised: false });
  assert.equal(Emblems.carriedEmblem(holder).tier, 5);
  emit("bounty-hunter:target-killed", { killer: holder, victim: player(), killerSkulled: false, penalised: false });
  assert.equal(Emblems.carriedEmblem(holder).tier, 5);
  emit("bounty-hunter:target-killed", { killer: holder, victim: player(), killerSkulled: true, penalised: true });
  assert.equal(Emblems.carriedEmblem(holder).tier, 5);
  emit("bounty-hunter:target-killed", { killer: holder, victim: player(), killerSkulled: true, penalised: false });
  assert.equal(Emblems.carriedEmblem(holder).tier, 6);

  const victim = player({ inventory: { [I.ESOTERIC_EMBLEM_TIER_2_]: 1 } });
  emit("bounty-hunter:died", { player: victim, killer: holder, skulled: true });
  assert.equal(Emblems.carriedEmblem(victim).tier, 1);
  emit("bounty-hunter:died", { player: victim, killer: holder, skulled: true });
  assert.equal(Emblems.carriedEmblem(victim), null);
});

test("Earning Potential: 1% per 30 s, halved unskulled, doubled with a target and 50k risked", () => {
  assert.equal(EarningPotential.gainPerStep(true, false), 1);
  assert.equal(EarningPotential.gainPerStep(false, false), 0.5);
  assert.equal(EarningPotential.gainPerStep(true, true), 2);
  assert.equal(EarningPotential.gainPerStep(false, true), 1);

  const fighter = player({ skulled: true });
  const target = player();
  const answerTarget = (query) => { if (query.player === fighter) query.target = target; };
  const answerRisk = (query) => { if (query.player === fighter) query.value = 50_000; };
  api.onCustomEvent("bounty-hunter:has-target", answerTarget);
  api.onCustomEvent("bounty-hunter:risk", answerRisk);
  emit("bounty-hunter:entered-arena", { player: fighter });
  for (let tick = 0; tick < 49; tick++) EarningPotential.tick();
  assert.equal(EarningPotential.getEp(fighter), 0);
  EarningPotential.tick();
  assert.equal(EarningPotential.getEp(fighter), 2);
  for (let tick = 0; tick < 50 * 60; tick++) EarningPotential.tick();
  assert.equal(EarningPotential.getEp(fighter), 100);
  emit("bounty-hunter:left-arena", { player: fighter });
  assert.equal(EarningPotential.inArena.has(fighter), false);
});

test("a target kill turns EP into a crate of its tier and resets EP", () => {
  assert.deepEqual([0, 19, 20, 29, 55, 99, 100].map(EarningPotential.crateTier), [0, 0, 1, 1, 4, 8, 9]);
  const killer = player();
  killer.setAttribute("bounty-hunter:earning-potential", 37.5);
  emit("bounty-hunter:target-killed", { killer, victim: player(), killerSkulled: true, penalised: false });
  assert.equal(killer.getInventory().getAmount(I.BOUNTY_CRATE_TIER_2_), 1);
  assert.equal(EarningPotential.getEp(killer), 0);
  const query = { player: killer, value: null };
  emit("bounty-hunter:earning-potential", query);
  assert.equal(query.value, 0);
});

test("bounty crates roll coins, noted restores and food, and a 1/10 artefact", () => {
  for (let tier = 1; tier <= 9; tier++) {
    const loot = BountyCrates.rollCrate(tier, () => 0.99);
    assert.equal(loot.length, 3);
    for (const [name] of loot) assert.ok(Number.isInteger(I[name]), name);
  }
  assert.deepEqual(BountyCrates.rollCrate(1, () => 0).map(([name, amount]) => [name, amount]), [
    ["COINS", 40000], ["BLIGHTED_SUPER_RESTORE_4_", 3], ["BLIGHTED_ANGLERFISH", 15], ["ANCIENT_EMBLEM", 1],
  ]);
  assert.equal(BountyCrates.rollCrate(9, () => 0.999999)[0][1], 600000);
  const relic = [0, 0, 0, 0, 0, 0.999];
  assert.equal(BountyCrates.rollCrate(5, () => relic.shift()).at(-1)[0], "ANCIENT_RELIC");
});

test("the coffer: minimum deposits by combat level, a 2m cap, and death costs to the killer", () => {
  assert.deepEqual([3, 32, 60, 61, 88, 89, 110, 111, 126].map(Coffer.minimumDeposit),
    [30000, 30000, 30000, 50000, 50000, 100000, 100000, 150000, 150000]);

  const victim = player({ combat: 70, inventory: { [I.COINS]: 3_000_000 } });
  Coffer.deposit(victim, 2_500_000);
  assert.equal(Coffer.balance(victim), 2_000_000);
  Coffer.withdraw(victim, 1_900_000);
  assert.equal(Coffer.balance(victim), 100_000);

  const query = { player: victim, balance: 0 };
  emit("bounty-hunter:coffer-balance", query);
  assert.equal(query.balance, 100_000);
  const minimum = { player: victim, amount: 0 };
  emit("bounty-hunter:minimum-deposit", minimum);
  assert.equal(minimum.amount, 50_000);

  const killer = player();
  emit("bounty-hunter:died", { player: victim, killer, skulled: false });
  assert.equal(Coffer.balance(victim), 50_000);
  emit("bounty-hunter:died", { player: victim, killer, skulled: true });
  assert.equal(Coffer.balance(victim), 40_000);
  emit("bounty-hunter:died", { player: victim, killer: null, skulled: true });
  assert.equal(Coffer.balance(victim), 40_000);
  assert.equal(killer.getInventory().getAmount(I.COINS), 60_000);
});

test("Corrupted Warriors swap (bh) armour both ways; the Emblem Trader answers skull conditions", () => {
  const { counterparts } = CorruptedWarrior;
  assert.equal(counterparts.get(I.VESTAS_CHAINBODY_BH_INACTIVE_), I.CORRUPTED_VESTAS_CHAINBODY_BH_INACTIVE_);
  assert.equal(counterparts.get(I.CORRUPTED_ZURIELS_HOOD_BH_), I.ZURIELS_HOOD_BH_);
  assert.equal(counterparts.size, 88);

  const trader = core.NpcIdentifiers.EMBLEM_TRADER_2;
  const unskulled = player();
  assert.equal(EmblemTrader.answerCondition({ player: unskulled, npcId: trader, text: "If the player is not skulled" }), true);
  assert.equal(EmblemTrader.answerCondition({ player: unskulled, npcId: trader, text: "If the player is skulled:" }), false);
  assert.equal(EmblemTrader.answerCondition({ player: player({ skulled: true }), npcId: trader, text: "If the skull can be extended:" }), true);
  assert.equal(EmblemTrader.answerCondition({ player: unskulled, npcId: 1, text: "If the player is skulled" }), null);
  assert.equal(EmblemTrader.band(unskulled), 5);
});
