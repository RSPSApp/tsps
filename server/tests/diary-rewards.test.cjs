// Run after `yarn build`: node --test tests/diary-rewards.test.cjs
const assert = require("node:assert/strict");
const path = require("path");
const { test, before, beforeEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const Rewards = require("../plugins/items/diaryrewards/Common.DiaryRewards");
const Teleports = require("../plugins/items/diaryrewards/Teleports.DiaryRewards");
const FaladorShield = require("../plugins/items/diaryrewards/FaladorShield.DiaryRewards");
const ExplorersRing = require("../plugins/items/diaryrewards/ExplorersRing.DiaryRewards");
const Pickpocketing = require("../plugins/items/diaryrewards/Pickpocketing.DiaryRewards");

let core;
const hooks = new Map();
const teleports = [];
const events = new Map();
/** "<diary>:<tier>" keys the stand-in diary framework reports as complete. */
const completedTiers = new Set();
const api = new Proxy({
  onCustomEvent(name, handler) {
    events.set(name, handler);
  },
  emitCustomEvent(name, request) {
    if (name === "diary:is-complete") request.complete = completedTiers.has(`${request.diary}:${request.tier}`);
  },
  onItemAction(name, actions) {
    hooks.set(name, { ...(hooks.get(name) ?? {}), ...actions });
  },
}, { get: (target, key) => (key === "core" ? core : key in target ? target[key] : () => {}) });

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const real = PluginManager.getCoreApi();
  // Record casts instead of moving anyone: the teleport checks pass, arrival runs at once.
  core = {
    ...real,
    TeleportHandler: {
      checkReqs: () => true,
      confirm: (player, destination, go, level, { item } = {}) => go(item),
      teleport: (player, tile, type, warning, onArrival) => {
        teleports.push({ player, tile: [tile.getX(), tile.getY(), tile.getZ()], type });
        onArrival?.();
      },
    },
    TaskManager: { submit: (task) => task.execute() },
  };
  Rewards.init(api);
  for (const unit of [Teleports, FaladorShield, ExplorersRing, Pickpocketing]) unit(api);
});

beforeEach(() => {
  teleports.length = 0;
  completedTiers.clear();
});

function player({ prayer = 99, maxPrayer = 99, energy = 0 } = {}) {
  const attributes = new Map();
  const messages = [];
  const varbits = new Map();
  let currentPrayer = prayer;
  let runEnergy = energy;
  return {
    messages, varbits,
    drain: 40,
    setPrayerPointDrain(value) { this.drain = value; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(text),
    getRunEnergy: () => runEnergy,
    setRunEnergy: (value) => { runEnergy = value; },
    getSkillManager: () => ({
      getMaxLevel: () => maxPrayer,
      getCurrentLevel: () => currentPrayer,
      setCurrentLevel: (skill, level) => { currentPrayer = level; },
    }),
    get prayer() { return currentPrayer; },
    getMovementQueue: () => ({ setBlockMovement() { return this; }, reset() { return this; } }),
    performAnimation() {},
    performGraphic() {},
    getPacketSender: () => ({
      sendVarbit: (id, value) => varbits.set(id, value),
      sendRunEnergy() {},
      sendTypedMessage: (type, text) => messages.push(text),
    }),
  };
}

const option = (item, name, who, extra = {}) => hooks.get(item)[name]({ player: who, ...extra });
const varbit = (name) => core.CacheDefinitions.getVarbitId(name);

test("every reward item's option names come from its cache definition", () => {
  for (const family of Rewards.DATA.families) {
    const names = new Set();
    for (const obj of family.objs) {
      const definition = core.CacheDefinitions.getItem(Rewards.objId(obj));
      for (const action of definition.inventoryActions ?? []) if (action) names.add(action);
      for (let param = 451; param <= 458; param++) {
        const worn = definition.params?.get?.(param);
        if (typeof worn === "string") names.add(worn);
      }
    }
    for (const teleport of family.teleports) {
      for (const name of teleport.options) assert.ok(names.has(name), `${family.name}: ${name}`);
    }
  }
});

test("the Ardougne cloak's monastery teleport is unlimited and lands in the 5x5 square (Wiki)", () => {
  const p = player();
  for (let i = 0; i < 6; i++) option("Ardougne cloak 1", "Monastery Teleport", p);
  assert.equal(teleports.length, 6);
  for (const { tile } of teleports) {
    assert.ok(Math.abs(tile[0] - 2607) <= 2 && Math.abs(tile[1] - 3221) <= 2, String(tile));
  }
});

test("Ardougne cloak 2 gives three farm teleports a day, and cloak 3 carries the day's uses on (Wiki)", () => {
  const p = player();
  for (let i = 0; i < 3; i++) option("Ardougne cloak 2", "Farm Teleport", p);
  assert.equal(p.messages.at(-1), "You have used 3 of your 3 Ardougne Farm teleports for today.");
  option("Ardougne cloak 2", "Ardougne Farm", p);
  assert.equal(teleports.length, 3);
  option("Ardougne cloak 3", "Farm Teleport", p);
  assert.equal(teleports.length, 4);
  assert.equal(p.messages.at(-1), "You have used 4 of your 5 Ardougne Farm teleports for today.");
});

test("a new day restores the allowance", () => {
  const p = player();
  option("Fremennik sea boots 1", "Teleport", p);
  option("Fremennik sea boots 1", "Teleport", p);
  assert.equal(teleports.length, 1);
  p.setAttribute(Rewards.DAILY_ATTRIBUTE, { day: "2000-01-01", counts: { rellekka: 1 } });
  option("Fremennik sea boots 1", "Teleport", p);
  assert.equal(teleports.length, 2);
});

test("elite tiers are unlimited but still count in the varbit (captures)", () => {
  const p = player();
  option("Rada's blessing 4", "Mount Karuulm", p);
  option("Rada's blessing 4", "Mount Karuulm", p);
  assert.equal(teleports.length, 2);
  assert.equal(p.varbits.get(varbit("zeah_blessing_brimstone_teleport")), 2);
  assert.equal(p.messages.length, 0);
});

test("counters are capped at what their varbit holds", () => {
  const p = player();
  for (let i = 0; i < 3; i++) option("Desert amulet 4", "Nardah", p);
  assert.equal(p.varbits.get(varbit("desert_nardah_teleport")), 1);
});

test("the desert amulet's elite Nardah teleport goes into the shrine, the others outside (Wiki)", () => {
  option("Desert amulet 2", "Teleport", player());
  option("Desert amulet 4", "Nardah", player());
  const [outside, shrine] = teleports.map(({ tile }) => tile);
  assert.ok(Math.abs(outside[0] - 3420) <= 3 && Math.abs(outside[1] - 2918) <= 3, String(outside));
  assert.ok(Math.abs(shrine[0] - 3426) <= 2 && Math.abs(shrine[1] - 2928) <= 2, String(shrine));
});

test("tiers that can't teleport yet say so instead", () => {
  const p = player();
  option("Desert amulet 1", "Teleport", p);
  option("Western banner 2", "Teleport", p);
  assert.equal(teleports.length, 0);
  assert.equal(p.messages.length, 2);
});

test("the Karamja gloves clap before casting (captures)", () => {
  const p = player();
  option("Karamja gloves 4", "Slayer Master", p);
  assert.equal(p.messages[0], "You clap your hands and the world changes...");
  assert.deepEqual(teleports[0].tile.slice(2), [1]);
});

test("the Falador shield restores its share of Prayer once a day, and full Prayer spends nothing (Wiki)", () => {
  const p = player({ prayer: 10, maxPrayer: 70 });
  option("Falador shield 1", "Recharge-prayer", p);
  assert.equal(p.prayer, 10 + Math.floor(70 * 0.25));
  option("Falador shield 1", "Recharge Prayer", p);
  assert.equal(p.prayer, 27);
  option("Falador shield 1", "Check", p);
  assert.equal(p.messages.at(-1), "Your shield has 0 prayer restores left for today.");

  const full = player({ prayer: 70, maxPrayer: 70 });
  option("Falador shield 4", "Recharge-prayer", full);
  option("Falador shield 4", "Check", full);
  assert.equal(full.messages.at(-1), "Your shield has 2 prayer restores left for today.");
});

test("a Falador shield recharge clears the prayer drain counter, a refused one does not (Wiki)", () => {
  const p = player({ prayer: 10, maxPrayer: 70 });
  option("Falador shield 1", "Recharge-prayer", p);
  assert.equal(p.drain, 0);
  p.drain = 40;
  option("Falador shield 1", "Recharge-prayer", p);
  assert.equal(p.drain, 40, "no charge left");
  const full = player({ prayer: 70, maxPrayer: 70 });
  option("Falador shield 4", "Recharge-prayer", full);
  assert.equal(full.drain, 40, "full Prayer");
});

test("Falador shield 4 restores fully twice a day", () => {
  const p = player({ prayer: 0, maxPrayer: 80 });
  option("Falador shield 4", "Recharge-prayer", p);
  assert.equal(p.prayer, 80);
  assert.equal(p.varbits.get(varbit("falador_shield_recharge")), 1);
});

test("the Explorer's ring restores energy per its tier and Check reads like the capture", () => {
  const p = player({ energy: 10 });
  option("Explorer's ring 1", "Energy", p);
  assert.equal(p.getRunEnergy(), 60);
  option("Explorer's ring 1", "Energy", p);
  option("Explorer's ring 1", "Energy", p);
  assert.equal(p.messages.at(-1), "You have used all of your energy restores for today.");
  option("Explorer's ring 1", "Check", p);
  assert.equal(p.messages.at(-1), "You have 30 out of 30 alchemy charges left and 0 of your 2 energy restores left for today.");

  const elite = player({ energy: 0 });
  option("Explorer's ring 4", "Energy", elite);
  assert.equal(elite.getRunEnergy(), 100);
});

test("the Explorer's ring Functions submenu's Energy entry restores energy", () => {
  const p = player({ energy: 0 });
  const itemId = Rewards.objId("lumbridge_ring_medium");
  assert.equal(option("Explorer's ring 2", "Functions", p, { itemId, subOpId: 1 }), true);
  assert.equal(p.getRunEnergy(), 50);
  // Alchemy (subop2) is exercised with real objects/native input in explorers-ring-alchemy.
  assert.equal(option("Explorer's ring 2", "Functions", p, { itemId, subOpId: 20 }), false);
});

test("Explorer's ring 2 Check also lists its cabbage patch teleports", () => {
  const p = player();
  option("Explorer's ring 2", "Teleport", p);
  option("Explorer's ring 2", "Check", p);
  assert.equal(p.messages.at(-1), "You have 2 of your 3 teleports left for today.");
});

/** What the pickpocket asks content ("thieving:pickpocket-target") before its limit and chance are used. */
function pickpocketRequest(x, y) {
  const npc = { getLocation: () => ({ getX: () => x, getY: () => y }) };
  const request = { player: player(), npc, pouchLimit: 28, chanceBonus: 0 };
  events.get("thieving:pickpocket-target")(request);
  return request;
}
const EAST_ARDOUGNE_MARKET = [2655, 3302];
const FALADOR = [2964, 3380];
const COMPLETE_TIERS = (...tiers) => tiers.forEach((tier) => completedTiers.add(`ardougne:${tier}`));

test("without an Ardougne tier, a pickpocket keeps 28 coin pouches and its plain chance (Wiki)", () => {
  const request = pickpocketRequest(...EAST_ARDOUGNE_MARKET);
  assert.equal(request.pouchLimit, 28);
  assert.equal(request.chanceBonus, 0);
  COMPLETE_TIERS("easy");
  assert.equal(pickpocketRequest(...EAST_ARDOUGNE_MARKET).chanceBonus, 0, "the easy tier gives neither");
});

test("the Medium Ardougne Diary: 56 coin pouches and +10% success, in Ardougne only (Wiki)", () => {
  COMPLETE_TIERS("easy", "medium");
  const inCity = pickpocketRequest(...EAST_ARDOUGNE_MARKET);
  assert.deepEqual([inCity.pouchLimit, inCity.chanceBonus], [56, 10]);
  const west = pickpocketRequest(2470, 3300);
  assert.equal(west.chanceBonus, 10, "West Ardougne is Ardougne too");
  const away = pickpocketRequest(...FALADOR);
  assert.deepEqual([away.pouchLimit, away.chanceBonus], [56, 0], "the pouch limit is not tied to the city");
  assert.equal(pickpocketRequest(2636, 3364).chanceBonus, 0, "the master farmer's patch north of the walls is outside it");
});

test("the Hard Ardougne Diary: 84 coin pouches and +10% success anywhere, not 20% in the city (Wiki)", () => {
  COMPLETE_TIERS("easy", "medium", "hard");
  for (const tile of [EAST_ARDOUGNE_MARKET, FALADOR]) {
    const request = pickpocketRequest(...tile);
    assert.deepEqual([request.pouchLimit, request.chanceBonus], [84, 10], String(tile));
  }
});

test("the Elite Ardougne Diary: 140 coin pouches (Wiki)", () => {
  COMPLETE_TIERS("easy", "medium", "hard", "elite");
  assert.equal(pickpocketRequest(...FALADOR).pouchLimit, 140);
});

test("the Ardougne bonus adds to content's own chance bonus and never lowers a larger pouch limit", () => {
  COMPLETE_TIERS("medium");
  const npc = { getLocation: () => ({ getX: () => 2655, getY: () => 3302 }) };
  const request = { player: player(), npc, pouchLimit: 100, chanceBonus: 15 };
  events.get("thieving:pickpocket-target")(request);
  assert.deepEqual([request.pouchLimit, request.chanceBonus], [100, 25]);
});
