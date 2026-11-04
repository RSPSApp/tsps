// Run after `yarn build`: node --test tests/cerberus-boots-preset.test.cjs
//
// Free preset items must not become ordinary tradeable boots through a crystal infusion. The items
// come from the real preset producer (Presets.PvpMode spawnPresetItem); the combine, the
// confirmation box, the Proceed / Cancel menu and the next-tick infusion all go through the real
// PluginManager, dialogue manager, MultiChatboxPrompt and TaskManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");

let core;
let I;
let RECIPES;
let next = 3500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  RECIPES = [
    { name: "pegasian", crystal: I.PEGASIAN_CRYSTAL, base: I.RANGER_BOOTS, result: I.PEGASIAN_BOOTS },
    { name: "primordial", crystal: I.PRIMORDIAL_CRYSTAL, base: I.DRAGON_BOOTS, result: I.PRIMORDIAL_BOOTS },
    { name: "eternal", crystal: I.ETERNAL_CRYSTAL, base: I.INFINITY_BOOTS, result: I.ETERNAL_BOOTS },
  ];
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("presetboots" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3234, 3222, 0));
  player.needsPlacement = false;
  player.getSkillManager().setMaxLevels(core.Skill.MAGIC, 60, false);
  player.getSkillManager().setMaxLevels(core.Skill.RUNECRAFTING, 60, false);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

/** An item made by the real preset producer. */
function preset(id) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const item = Presets._test.spawnPresetItem(new core.Item(id, 1), Presets.getGlobalPresetPool()[0]);
  assert.equal(item.isPresetItem(), true, "the producer marked the item");
  assert.equal(item.isTradeable(), false);
  return item;
}

const real = (id) => new core.Item(id, 1);
/** Slot of an item by value: add() stores a clone, so the original instance is never in the container. */
function slotOf(player, item) {
  return player.getInventory().getItems().findIndex((entry) => entry && entry.equals(item));
}

/** The instance the container actually holds, as the engine would hand it to a hook. */
function stored(player, item) {
  const slot = slotOf(player, item);
  assert.ok(slot >= 0, "the item is in the inventory");
  return player.getInventory().getItems()[slot];
}

/** Takes the real item out and puts the replacement in, proving both happened before any assertion. */
function swapIn(player, original, replacement) {
  const slot = slotOf(player, original);
  assert.ok(slot >= 0, "the item to swap out is in the inventory");
  player.getInventory().deleteAtSlot(slot, 1, false);
  assert.equal(slotOf(player, original), -1, "the original is gone");
  player.getInventory().add(replacement, false);
  assert.ok(slotOf(player, replacement) >= 0, "the replacement is in");
  assert.notEqual(slotOf(player, replacement), -1);
}
const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0);
const ids = (player) => held(player).map((item) => item.getId()).sort((a, b) => a - b);
const sortedIds = (list) => [...list].sort((a, b) => a - b);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);
const xp = (player, skill) => player.getSkillManager().getExperience(skill);

function give(player, ...items) {
  for (const item of items) player.getInventory().add(item, false);
}

function itemOnItem(player, usedValue, targetValue) {
  const used = stored(player, usedValue);
  const target = stored(player, targetValue);
  return PluginManager.emitItemOnItem({
    player, usedItem: used, usedItemId: used.getId(), usedItemSlot: slotOf(player, used),
    usedWithItem: target, usedWithItemId: target.getId(), usedWithItemSlot: slotOf(player, target), handled: false,
  });
}

/** Clicks through the confirmation box so the Proceed / Cancel menu shows. */
function openMenu(player) {
  assert.ok(player.getDialogueManager().isActive(), "the confirmation box is up");
  player.getDialogueManager().advance();
  assert.ok(pending(player), "the Proceed / Cancel menu is up");
}

function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

function tick() {
  for (let i = 0; i < 3; i++) core.TaskManager.process();
}

const NAMES = ["pegasian", "primordial", "eternal"];

function recipeFor(name) {
  return RECIPES.find((entry) => entry.name === name);
}

for (const name of NAMES) {
  test(`${name}: preset base boots are refused at the prompt and nothing is consumed`, (t) => {
    const { player, messages } = actor(t);
    const recipe = recipeFor(name);
    const base = preset(recipe.base);
    const crystal = real(recipe.crystal);
    give(player, base, crystal);
    itemOnItem(player, crystal, base);
    assert.equal(player.getDialogueManager().isActive(), false, "no confirmation box");
    assert.equal(pending(player), null);
    assert.deepEqual(ids(player), sortedIds([recipe.base, recipe.crystal]));
    assert.equal(held(player).find((item) => item.getId() === recipe.base).isPresetItem(), true);
    assert.ok(messages.length >= 1, "the player is told why");
  });

  test(`${name}: a preset crystal is refused at the prompt`, (t) => {
    const { player } = actor(t);
    const recipe = recipeFor(name);
    const base = real(recipe.base);
    const crystal = preset(recipe.crystal);
    give(player, base, crystal);
    itemOnItem(player, base, crystal);
    assert.equal(player.getDialogueManager().isActive(), false);
    assert.deepEqual(ids(player), sortedIds([recipe.base, recipe.crystal]));
  });

  test(`${name}: with a preset and a real pair of boots, using the preset pair is refused`, (t) => {
    const { player } = actor(t);
    const recipe = recipeFor(name);
    const presetBase = preset(recipe.base);
    const realBase = real(recipe.base);
    const crystal = real(recipe.crystal);
    give(player, presetBase, realBase, crystal);
    itemOnItem(player, presetBase, crystal);
    assert.equal(player.getDialogueManager().isActive(), false);
    assert.equal(ids(player).length, 3);
  });

  test(`${name}: with a preset and a real pair of boots, the infusion takes the real pair`, (t) => {
    const { player } = actor(t);
    const recipe = recipeFor(name);
    const presetBase = preset(recipe.base);
    const realBase = real(recipe.base);
    const crystal = real(recipe.crystal);
    give(player, presetBase, realBase, crystal);
    itemOnItem(player, realBase, crystal);
    openMenu(player);
    answer(player, 1);
    tick();
    const left = held(player);
    assert.deepEqual(left.map((item) => item.getId()).sort((a, b) => a - b), sortedIds([recipe.base, recipe.result]));
    assert.equal(left.find((item) => item.getId() === recipe.base).isPresetItem(), true,
      "the boots that remain are the preset ones");
    const made = left.find((item) => item.getId() === recipe.result);
    assert.equal(made.isPresetItem(), false);
    assert.equal(made.isTradeable(), true);
    assert.equal(xp(player, core.Skill.MAGIC) >= 200, true);
  });

  test(`${name}: preset boots swapped in after the menu are not consumed at Proceed`, (t) => {
    const { player } = actor(t);
    const recipe = recipeFor(name);
    const base = real(recipe.base);
    const crystal = real(recipe.crystal);
    give(player, base, crystal);
    itemOnItem(player, base, crystal);
    openMenu(player);
    swapIn(player, base, preset(recipe.base));
    answer(player, 1);
    tick();
    assert.deepEqual(ids(player), sortedIds([recipe.base, recipe.crystal]));
    assert.equal(held(player).find((item) => item.getId() === recipe.base).isPresetItem(), true);
    assert.equal(xp(player, core.Skill.RUNECRAFTING), 0);
  });

  test(`${name}: preset boots swapped in between Proceed and the tick are not consumed`, (t) => {
    const { player } = actor(t);
    const recipe = recipeFor(name);
    const base = real(recipe.base);
    const crystal = real(recipe.crystal);
    give(player, base, crystal);
    itemOnItem(player, base, crystal);
    openMenu(player);
    answer(player, 1);
    swapIn(player, base, preset(recipe.base));
    tick();
    assert.deepEqual(ids(player), sortedIds([recipe.base, recipe.crystal]));
    assert.equal(held(player).find((item) => item.getId() === recipe.base).isPresetItem(), true);
  });

  test(`${name}: ordinary boots and crystal still infuse`, (t) => {
    const { player } = actor(t);
    const recipe = recipeFor(name);
    const base = real(recipe.base);
    const crystal = real(recipe.crystal);
    give(player, base, crystal);
    itemOnItem(player, crystal, base);
    openMenu(player);
    answer(player, 1);
    tick();
    assert.deepEqual(ids(player), [recipe.result]);
    assert.equal(xp(player, core.Skill.MAGIC) >= 200, true);
  });
}
