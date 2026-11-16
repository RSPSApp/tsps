// Run after `yarn build`: node --test tests/bank-owns.test.cjs
//
// Bank.owns: the shared "owns this item" check (inventory, worn equipment, bank tabs) that the
// quest, minigame and league plugins used to copy, some counting a placeholder or the search tab.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const { Bank } = require('../dist/game/model/container/impl/Bank');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');

before(async () => {
  await CachePipeline.initialize(process.cwd());
});

const fresh = () => new Player(null);

test('an item carried, worn or in a bank tab is owned; one held nowhere is not', () => {
  assert.equal(Bank.owns(fresh(), I.ABYSSAL_WHIP), false);

  const carried = fresh();
  carried.getInventory().add(new Item(I.ABYSSAL_WHIP, 1), false);
  assert.equal(Bank.owns(carried, I.ABYSSAL_WHIP), true);

  const worn = fresh();
  worn.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(I.ABYSSAL_WHIP, 1));
  assert.equal(Bank.owns(worn, I.ABYSSAL_WHIP), true);

  const banked = fresh();
  banked.getBank(3).add(new Item(I.ABYSSAL_WHIP, 1), false);
  assert.equal(Bank.owns(banked, I.ABYSSAL_WHIP), true);
  assert.equal(Bank.owns(banked, [I.COINS, I.ABYSSAL_WHIP]), true, 'any of several ids');
  assert.equal(Bank.owns(banked, [I.COINS, -1]), false);
  assert.equal(Bank.owns(banked, []), false);
});

test('a bank placeholder (the id at amount 0) and the search tab own nothing', () => {
  const placeholder = fresh();
  placeholder.getBank(0).add(new Item(I.ABYSSAL_WHIP, 1), false);
  placeholder.getBank(0).getItems().find((item) => item.getId() === I.ABYSSAL_WHIP).setAmount(0);
  assert.ok(placeholder.getBank(0).contains(I.ABYSSAL_WHIP), 'the placeholder keeps the id');
  assert.equal(Bank.owns(placeholder, I.ABYSSAL_WHIP), false);

  const searched = fresh();
  searched.getBank(Bank.BANK_SEARCH_TAB_INDEX).add(new Item(I.ABYSSAL_WHIP, 1), false);
  assert.equal(Bank.owns(searched, I.ABYSSAL_WHIP), false);
});
