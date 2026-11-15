const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Item } = require("../dist/game/model/Item");
const asyff = require("../plugins/npcs/Asyff.plugin");

const core = PluginManager.getCoreApi();
const Y = asyff._test;
const RECIPES = Y.RECIPES ?? [];
const IDS = core.ItemIdentifiers;

before(async () => {
  await CachePipeline.initialize(process.cwd());
});

function newPlayer(t) {
  const player = new Player(null);
  const messages = [];
  player.setRegistered(true);
  t.mock.method(player, "getSession", () => ({ sendClientPacket: () => true }));
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  return { player, messages };
}

function fixture(t) {
  const { player, messages } = newPlayer(t);
  const emitted = [];
  const api = {
    core,
    onNpcInteraction() {},
    onCustomEvent() {},
    emitCustomEvent(name, event) { emitted.push({ name, event }); },
  };
  return { player, messages, api, emitted };
}

function add(player, id, amount = 1) {
  player.getInventory().add(new Item(id, amount), false);
}

function count(player, id) {
  return player.getInventory().getAmount(id);
}

test("the recipe table covers every Asyff Custom Fur Clothing row from wiki revision 15006217", () => {
  assert.equal(RECIPES.length, 20);
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  assert.equal(Y.SOURCE.revid, 15006217);
});

test("every recipe id, fur id and coin amount comes from the cache identifiers", () => {
  for (const recipe of RECIPES) {
    assert.equal(IDS[recipe.output.name], recipe.output.id, `${recipe.id} output`);
    for (let i = 0; i < recipe.fur.names.length; i++) {
      assert.equal(IDS[recipe.fur.names[i]], recipe.fur.ids[i], `${recipe.id} fur ${recipe.fur.names[i]}`);
    }
  }
  assert.equal(IDS.COINS, 995);
});

for (const recipe of RECIPES) {
  test(`${recipe.id}: trades the exact furs and coins for one ${recipe.output.name}`, (t) => {
    const f = fixture(t);
    f.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, recipe.level ?? 1);
    add(f.player, recipe.fur.ids[0], recipe.fur.amount);
    add(f.player, IDS.COINS, recipe.fee);

    assert.equal(Y.tradeRecipe(f.api, f.player, recipe), true);
    assert.equal(count(f.player, recipe.fur.ids[0]), 0);
    assert.equal(count(f.player, IDS.COINS), 0);
    assert.equal(count(f.player, recipe.output.id), 1);
  });

  test(`${recipe.id}: refuses without the coin fee and keeps the furs`, (t) => {
    const f = fixture(t);
    f.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, recipe.level ?? 1);
    add(f.player, recipe.fur.ids[0], recipe.fur.amount);
    add(f.player, IDS.COINS, recipe.fee - 1);

    assert.equal(Y.tradeRecipe(f.api, f.player, recipe), false);
    assert.equal(count(f.player, recipe.fur.ids[0]), recipe.fur.amount);
    assert.equal(count(f.player, IDS.COINS), recipe.fee - 1);
    assert.equal(count(f.player, recipe.output.id), 0);
  });

  test(`${recipe.id}: refuses without the required furs and keeps the coins`, (t) => {
    const f = fixture(t);
    f.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, recipe.level ?? 1);
    add(f.player, recipe.fur.ids[0], recipe.fur.amount - 1);
    add(f.player, IDS.COINS, recipe.fee);

    assert.equal(Y.tradeRecipe(f.api, f.player, recipe), false);
    assert.equal(count(f.player, IDS.COINS), recipe.fee);
    assert.equal(count(f.player, recipe.output.id), 0);
  });
}

for (const recipe of RECIPES.filter((r) => r.fur.ids.length > 1)) {
  test(`${recipe.id}: accepts the tatty fur alternative`, (t) => {
    const f = fixture(t);
    f.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, recipe.level ?? 1);
    const tatty = recipe.fur.ids[1];
    add(f.player, tatty, recipe.fur.amount);
    add(f.player, IDS.COINS, recipe.fee);

    assert.equal(Y.tradeRecipe(f.api, f.player, recipe), true);
    assert.equal(count(f.player, tatty), 0);
    assert.equal(count(f.player, recipe.output.id), 1);
  });
}

test("the spottier cape keeps its 66 Hunter gate and still announces the diary event", (t) => {
  const recipe = RECIPES.find((r) => r.id === "spottier-cape");
  const weak = fixture(t);
  weak.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, Y.SPOTTIER_HUNTER_LEVEL - 1);
  add(weak.player, IDS.DASHING_KEBBIT_FUR, 2);
  add(weak.player, IDS.COINS, 800);
  assert.equal(Y.tradeRecipe(weak.api, weak.player, recipe), false);
  assert.equal(count(weak.player, IDS.DASHING_KEBBIT_FUR), 2);

  const ok = fixture(t);
  ok.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, Y.SPOTTIER_HUNTER_LEVEL);
  add(ok.player, IDS.DASHING_KEBBIT_FUR, 2);
  add(ok.player, IDS.COINS, 800);
  assert.equal(Y.tradeRecipe(ok.api, ok.player, recipe), true);
  assert.equal(ok.emitted.some((e) => e.name === Y.SPOTTIER_CAPE_TRADED_EVENT), true);
});

test("only the spottier cape emits the diary event; other recipes emit nothing", (t) => {
  const recipe = RECIPES.find((r) => r.id === "polar-kebbit-top");
  const f = fixture(t);
  add(f.player, IDS.POLAR_KEBBIT_FUR, 2);
  add(f.player, IDS.COINS, 20);
  assert.equal(Y.tradeRecipe(f.api, f.player, recipe), true);
  assert.equal(f.emitted.length, 0);
});
