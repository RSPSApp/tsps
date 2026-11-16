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

test("the spottier cape is made at any Hunter level (66 is to wear it) and announces the diary event", (t) => {
  const recipe = RECIPES.find((r) => r.id === "spottier-cape");
  // Wiki (Spottier cape): 66 Hunter to equip; no level to make it. The item's equip requirement keeps the 66.
  const low = fixture(t);
  low.player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 1);
  add(low.player, IDS.DASHING_KEBBIT_FUR, 2);
  add(low.player, IDS.COINS, 800);
  assert.equal(Y.tradeRecipe(low.api, low.player, recipe), true);
  assert.equal(count(low.player, IDS.DASHING_KEBBIT_FUR), 0);
  assert.equal(count(low.player, IDS.COINS), 0);
  assert.equal(count(low.player, Y.SPOTTIER_CAPE), 1);
  assert.equal(low.emitted.some((e) => e.name === Y.SPOTTIER_CAPE_TRADED_EVENT), true);
});

test("only the spottier cape emits the diary event; other recipes emit nothing", (t) => {
  const recipe = RECIPES.find((r) => r.id === "polar-kebbit-top");
  const f = fixture(t);
  add(f.player, IDS.POLAR_KEBBIT_FUR, 2);
  add(f.player, IDS.COINS, 20);
  assert.equal(Y.tradeRecipe(f.api, f.player, recipe), true);
  assert.equal(f.emitted.length, 0);
});

// The chatbox menus are the real OptionDialogue objects, recorded from the chain the plugin starts (the builder keeps
// each added dialogue), so the tests see exactly the options a client would be sent.
function recordMenus(t, f) {
  const shown = [];
  t.mock.method(f.player.getDialogueManager(), "startDialogues", (chain) => {
    for (const dialogue of chain.dialogues.values()) shown.push(dialogue);
  });
  return { shown, api: f.api };
}
const SETS = [...new Set(RECIPES.map((recipe) => recipe.set))];
const NAV = new Set(["More...", "Cancel"]);

test("the set menu: every set is reachable by paging, each page has at most five options and ends with Cancel", (t) => {
  const f = fixture(t);
  const { shown, api } = recordMenus(t, f);
  Y.openSetMenu(api, f.player);
  const reached = [];
  let menu = shown.at(-1);
  for (let pages = 0; pages < SETS.length; pages++) {
    const options = menu.getOptions();
    assert.ok(options.length <= 5, `page ${pages + 1} has ${options.length} options`);
    assert.equal(options.at(-1), "Cancel", `page ${pages + 1} ends with Cancel`);
    reached.push(...options.filter((option) => !NAV.has(option)));
    const more = options.indexOf("More...");
    if (more < 0) break;
    menu.execute(String(more + 1));
    menu = shown.at(-1);
  }
  assert.deepEqual([...reached].sort(), [...SETS].sort(), "each set appears on exactly one page");
});

test("the set menu: picking a set on a page opens its piece menu, and each piece menu has at most five options", (t) => {
  const f = fixture(t);
  const { shown, api } = recordMenus(t, f);
  Y.openSetMenu(api, f.player);
  const first = shown.at(-1);
  const options = first.getOptions();
  const pick = options.indexOf(SETS[0]);
  assert.ok(pick >= 0, "the first set is on the first page");
  first.execute(String(pick + 1));
  const pieces = shown.at(-1);
  const expected = RECIPES.filter((recipe) => recipe.set === SETS[0]).map((recipe) => `${recipe.output.label} (${recipe.fee} coins)`);
  assert.deepEqual(pieces.getOptions(), [...expected, "Cancel"]);
  for (const set of SETS) {
    Y.openPieceMenu(api, f.player, set);
    assert.ok(shown.at(-1).getOptions().length <= 5, `${set} piece menu`);
  }
});

test("the set menu: Cancel closes without a trade, a message or a side effect", (t) => {
  const f = fixture(t);
  const { shown, api } = recordMenus(t, f);
  Y.openSetMenu(api, f.player);
  const menu = shown.at(-1);
  const cancel = menu.getOptions().indexOf("Cancel");
  const before = shown.length;
  menu.execute(String(cancel + 1));
  assert.equal(shown.length, before, "no menu is opened by Cancel");
  assert.deepEqual(f.messages, []);
});

test("paging through the sets takes no furs or coins", (t) => {
  const f = fixture(t);
  const recipe = RECIPES[0];
  add(f.player, IDS.COINS, 10_000_000);
  for (const id of recipe.fur.ids) add(f.player, id, recipe.fur.amount + 3);
  const coins = count(f.player, IDS.COINS), fur = count(f.player, recipe.fur.ids[0]);
  const { shown, api } = recordMenus(t, f);
  Y.openSetMenu(api, f.player);
  let menu = shown.at(-1);
  for (let page = 0; page < SETS.length; page++) {
    const more = menu.getOptions().indexOf("More...");
    if (more < 0) break;
    menu.execute(String(more + 1));
    menu = shown.at(-1);
  }
  assert.equal(count(f.player, IDS.COINS), coins, "coins unchanged");
  assert.equal(count(f.player, recipe.fur.ids[0]), fur, "furs unchanged");
  assert.deepEqual(f.messages, []);
});
