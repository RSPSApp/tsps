const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');

let core;
let DarkEssence;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const api = PluginManager.createApi('RunecraftingDarkEssenceTest');
  require('../plugins/skills/Runecrafting.plugin').register(api);
  DarkEssence = require('../plugins/skills/runecrafting/DarkEssence.Runecrafting');
});

let index = 1300;
function crafter({ runecraft = 99, crafting = 99, items = [] } = {}) {
  const player = new Player(null, new core.Location(1816, 3856, 0));
  player.setIndex(index++);
  player.setUsername('dark-essence-test');
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.messages = [];
  player.sendMessage = text => player.messages.push(text);
  player.boxes = [];
  player.getDialogueManager().startDialogues = (builder) => {
    const box = builder.getDialogues().get(0);
    player.boxes.push({ itemId: box.getItemId?.(), text: box.getText?.() });
  };
  const skills = player.getSkillManager();
  skills.setCurrentLevels(core.Skill.RUNECRAFTING, runecraft);
  skills.setCurrentLevels(core.Skill.CRAFTING, crafting);
  player.xp = [];
  const addExperiences = skills.addExperiences.bind(skills);
  skills.addExperiences = (skill, xp) => {
    player.xp.push([skill === core.Skill.CRAFTING ? 'crafting' : skill === core.Skill.RUNECRAFTING ? 'runecraft' : 'other', xp]);
    return addExperiences(skill, xp);
  };
  for (const [id, amount, meta] of items) {
    for (let i = 0; i < amount; i++) player.getInventory().add(new Item(id, 1, meta), false);
  }
  return player;
}

function chisel(player) {
  const { ItemIdentifiers } = core;
  const inventory = player.getInventory();
  const usedItemSlot = inventory.getSlotForItemId(ItemIdentifiers.CHISEL);
  const usedWithItemSlot = inventory.getSlotForItemId(ItemIdentifiers.DARK_ESSENCE_BLOCK);
  return PluginManager.emitItemOnItem({
    player, usedItem: inventory.getItems()[usedItemSlot], usedItemId: ItemIdentifiers.CHISEL, usedItemSlot,
    usedWithItem: inventory.getItems()[usedWithItemSlot], usedWithItemId: ItemIdentifiers.DARK_ESSENCE_BLOCK, usedWithItemSlot, handled: false,
  });
}

function tick(player, ticks = 1) {
  for (let i = 0; i < ticks; i++) core.TaskManager.process();
}

function blocks(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.DARK_ESSENCE_BLOCK);
}

function bind(player, objectId) {
  const object = new core.GameObject(objectId, player.getLocation(), 10, 0, null);
  const definition = core.ObjectDefinition.forPlayer(objectId, player);
  return PluginManager.emitObjectInteraction({ player, object, objectId, definition, clickType: 1, handled: false });
}

function fragmentsItem(count) {
  return [core.ItemIdentifiers.DARK_ESSENCE_FRAGMENTS, 1, { [DarkEssence.FRAGMENTS_META]: count }];
}

test('a chisel on dark essence blocks chisels one at once, the next 3 ticks later and each after that 4 ticks on (rsprox 226/01672)', () => {
  const { ItemIdentifiers } = core;
  const player = crafter({ items: [[ItemIdentifiers.CHISEL, 1], [ItemIdentifiers.DARK_ESSENCE_BLOCK, 4]] });
  const inventory = player.getInventory();
  const firstBlockSlot = inventory.getSlotForItemId(ItemIdentifiers.DARK_ESSENCE_BLOCK);
  try {
    assert.equal(chisel(player), true);
    assert.equal(blocks(player), 3);
    assert.equal(inventory.getItems()[firstBlockSlot].getId(), ItemIdentifiers.DARK_ESSENCE_FRAGMENTS, 'the first block turns into the fragments in its slot');
    assert.equal(DarkEssence.heldFragments(player), 4);
    tick(player, 2);
    assert.equal(blocks(player), 3);
    tick(player);
    assert.equal(blocks(player), 2, 'the second block 3 ticks after the first');
    tick(player, 3);
    assert.equal(blocks(player), 2);
    tick(player);
    assert.equal(blocks(player), 1, 'the third 4 ticks after the second');
    tick(player, 4);
    assert.equal(blocks(player), 0);
    assert.equal(inventory.getAmount(ItemIdentifiers.DARK_ESSENCE_FRAGMENTS), 1, 'one fragments item, never stacked');
    assert.equal(DarkEssence.heldFragments(player), 16);
    assert.deepEqual(player.xp, [['crafting', 8], ['crafting', 8], ['crafting', 8], ['crafting', 8]]);
    tick(player, 4);
    assert.equal(DarkEssence.sessions.has(player), false, 'the loop ends with the blocks');
  } finally {
    core.TaskManager.cancelTasks(player.getIndex());
  }
});

test('chiselling stops at 108 fragments with the recorded item box, and needs 38 Crafting', () => {
  const { ItemIdentifiers } = core;
  const full = crafter({ items: [[ItemIdentifiers.CHISEL, 1], fragmentsItem(105), [ItemIdentifiers.DARK_ESSENCE_BLOCK, 2]] });
  chisel(full);
  assert.equal(blocks(full), 2);
  assert.equal(DarkEssence.heldFragments(full), 105);
  assert.deepEqual(full.boxes, [{ itemId: ItemIdentifiers.DARK_ESSENCE_FRAGMENTS, text: 'Your pile of fragments cannot grow any larger.' }]);

  const capped = crafter({ items: [[ItemIdentifiers.CHISEL, 1], fragmentsItem(100), [ItemIdentifiers.DARK_ESSENCE_BLOCK, 3]] });
  try {
    chisel(capped);
    tick(capped, 3);
    assert.equal(DarkEssence.heldFragments(capped), 108, 'two blocks fit, exactly to the cap');
    tick(capped, 4);
    assert.equal(blocks(capped), 1);
    assert.equal(capped.boxes.length, 1);
    assert.equal(DarkEssence.sessions.has(capped), false);
  } finally {
    core.TaskManager.cancelTasks(capped.getIndex());
  }

  const novice = crafter({ crafting: 37, items: [[ItemIdentifiers.CHISEL, 1], [ItemIdentifiers.DARK_ESSENCE_BLOCK, 1]] });
  chisel(novice);
  assert.equal(blocks(novice), 1);
  assert.deepEqual(novice.messages, ['You need a Crafting level of at least 38 to chisel this.']);
});

test('Count says how many fragments the stack holds (Transcript: Dark essence fragments)', () => {
  const { ItemIdentifiers } = core;
  for (const [count, text] of [
    [8, 'This stack of fragments is roughly equivalent to 8 pieces of essence.'],
    [1, 'This stack of fragments is roughly equivalent to one piece of essence.'],
  ]) {
    const player = crafter({ items: [fragmentsItem(count)] });
    const slot = player.getInventory().getSlotForItemId(ItemIdentifiers.DARK_ESSENCE_FRAGMENTS);
    PluginManager.emitItemAction({ player, interfaceId: 149, item: player.getInventory().getItems()[slot], itemId: ItemIdentifiers.DARK_ESSENCE_FRAGMENTS, slot, clickType: 1, option: 'Count' });
    assert.deepEqual(player.boxes, [{ itemId: ItemIdentifiers.DARK_ESSENCE_FRAGMENTS, text }]);
  }
});

test('the Soul Altar binds every fragment held into a soul rune each at 29.7 XP (rsprox 226/01673: 111 fragments, 111 runes)', () => {
  const { ItemIdentifiers, ObjectIdentifiers } = core;
  const player = crafter({ items: [fragmentsItem(111), [ItemIdentifiers.DARK_ESSENCE_BLOCK, 2]] });
  assert.equal(bind(player, ObjectIdentifiers.SOUL_ALTAR), true);
  const inventory = player.getInventory();
  assert.equal(inventory.getAmount(ItemIdentifiers.DARK_ESSENCE_FRAGMENTS), 0);
  assert.equal(inventory.getAmount(ItemIdentifiers.SOUL_RUNE), 111);
  assert.equal(blocks(player), 2, 'blocks are not bound');
  assert.equal(player.xp.length, 1);
  assert.equal(player.xp[0][0], 'runecraft');
  assert.ok(Math.abs(player.xp[0][1] - 111 * 29.7) < 1e-6);

  const empty = crafter({ items: [[ItemIdentifiers.DARK_ESSENCE_BLOCK, 1]] });
  bind(empty, ObjectIdentifiers.SOUL_ALTAR);
  assert.deepEqual(empty.boxes.map((box) => box.text), ['You have nothing suitable to bind.']);

  const low = crafter({ runecraft: 89, items: [fragmentsItem(4)] });
  bind(low, ObjectIdentifiers.SOUL_ALTAR);
  assert.equal(low.getInventory().getAmount(ItemIdentifiers.SOUL_RUNE), 0);
  assert.deepEqual(low.messages, ['You need a Runecrafting level of at least 90 to craft this.']);
});

test("Kourend's Blood Altar binds the stack's fragments, not one rune for the item", () => {
  const { ItemIdentifiers, ObjectIdentifiers } = core;
  const player = crafter({ items: [fragmentsItem(40)] });
  bind(player, ObjectIdentifiers.BLOOD_ALTAR);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.BLOOD_RUNE), 40);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.DARK_ESSENCE_FRAGMENTS), 0);
  assert.ok(Math.abs(player.xp[0][1] - 40 * 23.8) < 1e-6);
});
