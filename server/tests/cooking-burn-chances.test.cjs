// Run after `yarn build`: node --test tests/cooking-burn-chances.test.cjs
// The Wiki's cooking charts (low/high out of 256 per cooker), the formula past level 99, the
// Hosidius Kitchen bonus, Hunters' Rumours gates and the foods added from the Wiki.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Cooking = require("../plugins/skills/Cooking.plugin");
const Common = require("../plugins/skills/cooking/Common.Cooking");
const DATA = require("../plugins/skills/data/cooking.json");

before(() => CachePipeline.initialize());

// Answers the diary and rumour questions the cookers ask; each test sets what they answer.
const answers = { eliteKourend: false, rumours: 0, trio: "none" };
Cooking._test.setApi({
  core: PluginManager.getCoreApi(),
  emitCustomEvent(name, request) {
    if (name === "diary:is-complete" && request.diary === "kourend" && request.tier === "elite") request.complete = answers.eliteKourend;
    if (name === "hunter:rumours-completed") request.completed = answers.rumours;
    if (request.key === "tai_bwo_wannai_trio" && name === "quest:is-started") request.started = answers.trio !== "none";
    if (request.key === "tai_bwo_wannai_trio" && name === "quest:is-complete") request.complete = answers.trio === "complete";
  },
});

const obj = (name) => CacheDefinitions.getObjId(name);
const food = (raw) => Cooking._test.COOKABLE_BY_RAW.get(obj(raw));

function player(cooking, hands = 0) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  equipment[Equipment.HANDS_SLOT] = { getId: () => hands };
  return {
    getEquipment: () => ({ getItems: () => equipment }),
    getSkillManager: () => ({ getCurrentLevel: () => cooking }),
  };
}

const location = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
const RANGE = 0; // any object id that is not the Lumbridge or Hosidius range

test("the Wiki formula: (floor(low*(99-L)/98 + high*(L-1)/98 + 0.5) + 1) / 256, clamped", () => {
  assert.equal(Common.successChance(1, 232, 99), 233 / 256, "shark on a range at 99");
  assert.equal(Common.successChance(128, 512, 1), 129 / 256, "shrimps at 1");
  assert.equal(Common.successChance(128, 512, 34), 1);
  assert.equal(Common.successChance(-1626, 217, 91) >= 0, true, "a Sailing fish's negative low value never goes below 0");
});

test("the chance keeps rising past 99, up to 150", () => {
  const shark = food("raw_shark");
  const at = (level, cooker) => Cooking._test.successChance(player(level), shark, RANGE, cooker);
  assert.ok(at(99, "range") < 1, "a shark still burns on a range at 99");
  assert.ok(at(120, "range") > at(99, "range"));
  assert.equal(Cooking._test.stopBurnLevel(player(1), shark, RANGE, "range"), 109);
  assert.equal(Cooking._test.stopBurnLevel(player(1), shark, RANGE, "fire"), 125);
  assert.equal(at(150, "fire"), 1);

  const antelope = food("hunting_antelopemoon_meat");
  assert.equal(Cooking._test.stopBurnLevel(player(1), antelope, RANGE, "range"), 126);
  assert.equal(Cooking._test.stopBurnLevel(player(1), antelope, RANGE, "fire"), 137);
  assert.equal(Cooking._test.successChance(player(150), antelope, RANGE, "fire"), 1, "level 150 never burns a moonlight antelope");
});

test("fires and ranges use their own values", () => {
  const cod = food("raw_cod");
  assert.equal(Cooking._test.stopBurnLevel(player(1), cod, RANGE, "fire"), 51);
  assert.equal(Cooking._test.stopBurnLevel(player(1), cod, RANGE, "range"), 49);
  assert.equal(Cooking._test.stopBurnLevel(player(1), cod, ObjectIdentifiers.COOKING_RANGE, "range"), 47, "Lumbridge Castle range");
});

test("cooking gauntlets: the Wiki burn table's default column", () => {
  const expected = { raw_lobster: 64, raw_swordfish: 80, hunting_kyatt_meat: 80, raw_monkfish: 86, raw_shark: 94, raw_anglerfish: 97 };
  for (const [raw, level] of Object.entries(expected)) {
    assert.equal(Cooking._test.stopBurnLevel(player(1, ItemIds.COOKING_GAUNTLETS), food(raw), RANGE, "range"), level, raw);
  }
});

test("every clay oven is a cooker: \"Clay oven\" in Hosidius and on Neitiznot, \"Clay Oven\" in Nardah", () => {
  const core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  for (const id of [ObjectIdentifiers.CLAY_OVEN_3, 10377]) {
    const oven = new core.GameObject(id, new core.Location(1677, 3622), 10, 0);
    assert.ok(Cooking.isCooker(oven.getDefinition()), `${id} (${oven.getDefinition().getName()}) cooks food`);
  }
});

test("the Hosidius Kitchen ranges add 12, or 25 with the elite Kourend & Kebos Diary", () => {
  const shark = food("raw_shark");
  const kitchen = location(1677, 3622), mess = location(1648, 3627);
  const oven = ObjectIdentifiers.CLAY_OVEN_3;
  const chance = (at) => Cooking._test.successChance(player(90), shark, oven, "range", at);
  answers.eliteKourend = false;
  assert.equal(chance(kitchen), Common.successChance(1 + 12, 232 + 12, 90));
  assert.equal(chance(mess), Common.successChance(1, 232, 90), "the mess's clay oven has no bonus");
  answers.eliteKourend = true;
  assert.equal(chance(kitchen), Common.successChance(1 + 25, 232 + 25, 90));
  // Wiki (Cooking/Burn level): Hosidius 5% with gauntlets stops a shark at 89, 10% at 84.
  answers.eliteKourend = false;
  assert.equal(Cooking._test.stopBurnLevel(player(1, ItemIds.COOKING_GAUNTLETS), shark, oven, "range", kitchen), 89);
  answers.eliteKourend = true;
  assert.equal(Cooking._test.stopBurnLevel(player(1, ItemIds.COOKING_GAUNTLETS), shark, oven, "range", kitchen), 84);
  answers.eliteKourend = false;
});

test("a roll of 0 burns anything that can still burn; a high roll cooks it", () => {
  const lobster = food("raw_lobster");
  assert.equal(Cooking._test.isSuccess(player(60), lobster, RANGE, "range", undefined, () => 0), false);
  assert.equal(Cooking._test.isSuccess(player(60), lobster, RANGE, "range", undefined, () => 0.999), true);
  assert.equal(Cooking._test.isSuccess(player(74), lobster, RANGE, "range", undefined, () => 0), true);
});

test("foods without a Wiki chart keep their stop-burn level", () => {
  const guppy = food("raw_guppy");
  assert.equal(guppy.chance, undefined);
  assert.equal(Cooking._test.successChance(player(guppy.stopBurn), guppy, RANGE, "range"), 1);
  assert.ok(Cooking._test.successChance(player(guppy.level), guppy, RANGE, "range") < 1);
});

test("every food: real items, and Wiki values for each cooker it is cooked on", () => {
  for (const row of DATA.cookables) {
    for (const key of ["raw", "cooked", "burnt", "returnItem"]) {
      if (row[key] === undefined || typeof row[key] === "number") continue;
      assert.ok(Number.isInteger(obj(row[key])), `${row.name}: unknown ${key} ${row[key]}`);
    }
    if (!row.chance) {
      assert.ok(Number.isInteger(row.stopBurn), `${row.name}: needs chance or stopBurn`);
      continue;
    }
    // A fire without its own values uses the range's (the Wiki charts some foods on a range only).
    assert.ok(row.chance.range, `${row.name}: range values`);
    if (row.rangeOnly) assert.equal(row.chance.fire, undefined, `${row.name}: no fire values for a range-only food`);
    for (const values of Object.values(row.chance)) {
      assert.ok(Array.isArray(values) && values.length === 2 && values.every(Number.isInteger), `${row.name}: [low, high]`);
    }
  }
});

test("the foods added from the Wiki", () => {
  const added = {
    hunting_antelopemoon_meat: { cooked: "antelopemoon_cooked", level: 92, xp: 220, rumours: 50 },
    hunting_antelopesun_meat: { cooked: "antelopesun_cooked", level: 68, xp: 175, rumours: 50 },
    huntingbeast_speedy2_meat: { cooked: "dashingkebbit_cooked", level: 82, xp: 215, rumours: 50 },
    hunting_fennecfox_meat: { cooked: "fennecfox_cooked", level: 59, xp: 154, rumours: 25 },
    hunting_kyatt_meat: { cooked: "kyatt_cooked", level: 51, xp: 143, rumours: 25 },
    hunting_graahk_meat: { cooked: "graahk_cooked", level: 41, xp: 124, rumours: 25 },
    huntingbeast_barbed_meat: { cooked: "barbkebbit_cooked", level: 32, xp: 106 },
    hunting_larupia_meat: { cooked: "larupia_cooked", level: 31, xp: 92 },
    huntingbeast_wild_meat: { cooked: "wildkebbit_cooked", level: 23, xp: 73 },
    raw_bear_meat: { cooked: "cooked_meat", level: 1, xp: 30 },
    raw_giant_carp: { cooked: "giant_carp", level: 10, xp: 0 },
    hundred_pirate_raw_fishcake: { cooked: "hundred_pirate_fishcake", level: 31, xp: 100 },
    wrapped_oomlie: { cooked: "cooked_oomlie", level: 50, xp: 30 },
    potato: { cooked: "potato_baked", level: 7, xp: 15 },
    sweetcorn: { cooked: "sweetcorn_cooked", level: 28, xp: 104 },
    uncooked_stew: { cooked: "stew", level: 25, xp: 117 },
    uncooked_curry: { cooked: "curry", level: 60, xp: 280 },
    uncooked_cake: { cooked: "cake", level: 40, xp: 180 },
    bowl_egg_raw: { cooked: "bowl_egg_scrambled", level: 13, xp: 50 },
    bowl_onion: { cooked: "bowl_onion_fried", level: 42, xp: 60 },
    bowl_mushroom_raw: { cooked: "bowl_mushroom_fried", level: 46, xp: 60 },
  };
  for (const [raw, expected] of Object.entries(added)) {
    const row = food(raw);
    assert.ok(row, `${raw} is cookable`);
    assert.equal(row.cooked, obj(expected.cooked), raw);
    assert.equal(row.level, expected.level, raw);
    assert.equal(row.xp, expected.xp, raw);
    assert.equal(row.rumours, expected.rumours, raw);
  }
  assert.equal(food("potato").rangeOnly, true, "a potato bakes on a range only");
  assert.equal(food("uncooked_cake").returnItem, obj("cake_tin"));
});

test("the better hunter meats need Hunters' Rumours", () => {
  const antelope = food("hunting_antelopemoon_meat");
  const messages = [];
  const cook = {
    getAttribute: () => undefined,
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getDialogueManager: () => ({ startDialogues: (chain) => messages.push(chain) }),
    sendMessage: () => {},
  };
  const range = { getId: () => RANGE, getDefinition: () => ({ getName: () => "Range" }) };
  answers.rumours = 49;
  assert.equal(Cooking._test.canCook(cook, range, antelope), false);
  assert.equal(messages.length, 1);
  answers.rumours = 50;
  assert.equal(Cooking._test.canCook(cook, range, antelope), true);
  answers.rumours = 0;
  assert.equal(Cooking._test.canCook(cook, range, food("huntingbeast_wild_meat")), true, "wild kebbit needs no rumours");
});

test("stew, curry, cake and egg recipes", () => {
  const recipe = (a, b) => Common.recipeWith(obj(a), obj(b));
  assert.equal(recipe("potato", "bowl_water").productId, obj("stew1"));
  assert.equal(recipe("cooked_meat", "bowl_water").productId, obj("stew2"));
  assert.equal(recipe("cooked_meat", "stew1").productId, obj("uncooked_stew"));
  assert.equal(recipe("potato", "stew2").productId, obj("uncooked_stew"));
  assert.equal(recipe("spicespot", "uncooked_stew").productId, obj("uncooked_curry"));
  assert.equal(recipe("egg", "bowl_empty").productId, obj("bowl_egg_raw"));
  const cake = recipe("egg", "cake_tin");
  assert.equal(cake.productId, obj("uncooked_cake"));
  assert.deepEqual(cake.returns.map(({ id }) => id).sort(), [obj("pot_empty"), obj("bucket_empty")].sort());
});

test("raw karambwanji cook into karambwanji only during Tai Bwo Wannai Trio", () => {
  const karambwanji = food("tbwt_raw_karambwanji");
  assert.equal(karambwanji.cooked, obj("tbwt_quest_cooked_karambwanji"));
  assert.equal(karambwanji.cooked, 21394);
  assert.equal(karambwanji.burnt, obj("ashes"));
  assert.equal(karambwanji.xp, 10);
  assert.equal(Cooking._test.burnMessage(karambwanji), "You accidentally burn the karambwanji to ashes.");
  // Wiki (Karambwanji): stops burning at 28.
  assert.equal(Cooking._test.stopBurnLevel(player(1), karambwanji, RANGE, "range"), 28);

  const messages = [];
  const cook = {
    getAttribute: () => undefined,
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getDialogueManager: () => ({ startDialogues: () => {} }),
    sendMessage: (text) => messages.push(text),
  };
  const range = { getId: () => RANGE, getDefinition: () => ({ getName: () => "Range" }) };
  for (const [state, allowed] of [["none", false], ["started", true], ["complete", false]]) {
    answers.trio = state;
    assert.equal(Cooking._test.canCook(cook, range, karambwanji), allowed, state);
  }
  assert.deepEqual(messages, ["You don't feel that would be useful now.", "You don't feel that would be useful now."]);
  answers.trio = "none";
});
