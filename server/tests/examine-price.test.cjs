// Run after `yarn build`: node --test tests/examine-price.test.cjs
// Settings rows 234 and 235: the price line after an inventory or ground item's examine text.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const {
  EXAMINE_PRICE_GE_VARBIT, EXAMINE_PRICE_ALCH_VARBIT, examinePrices, formatExaminePrice, sendExaminePrice,
} = require('../dist/game/content/ExaminePrice');

const STEEL_SCIMITAR = 1325;
const FEATHER = 314;
const TROUT = 333;
const NOTED_TROUT = 334;
const COINS = 995;
const BARCRAWL_CARD = 455; // untradeable quest item

const r = (n) => `<col=ff0000>${n}</col>`;
const BOTH = { ge: true, alch: true };

before(async () => {
  await CachePipeline.initialize();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

test('a single item: no count and no per-item price', () => {
  const prices = { ge: 67, ha: 240, la: 160 };
  assert.equal(formatExaminePrice('Steel scimitar', 1, prices, { ge: true, alch: false }), `Price of Steel scimitar: GE ${r(67)}`);
  assert.equal(formatExaminePrice('Steel scimitar', 1, prices, { ge: false, alch: true }), `Price of Steel scimitar: HA ${r(240)}  LA ${r(160)}`);
  assert.equal(formatExaminePrice('Steel scimitar', 1, prices, BOTH), `Price of Steel scimitar: GE ${r(67)}  HA ${r(240)}  LA ${r(160)}`);
});

test('a stack shows the total and each, and leaves out zero values', () => {
  assert.equal(formatExaminePrice('Feather', 100, { ge: 3, ha: 1, la: 0 }, BOTH),
    `Price of 100 x Feather: GE ${r(300)} (${r(3)}ea)  HA ${r(100)} (${r(1)}ea)`);
  assert.equal(formatExaminePrice('Trout', 10, { ge: 19, ha: 6, la: 4 }, BOTH),
    `Price of 10 x Trout: GE ${r(190)} (${r(19)}ea)  HA ${r(60)} (${r(6)}ea)  LA ${r(40)} (${r(4)}ea)`);
  assert.equal(formatExaminePrice('Rune arrow', 12345, { ge: 1500, ha: 0, la: 0 }, BOTH),
    `Price of 12,345 x Rune arrow: GE ${r('18,517,500')} (${r('1,500')}ea)`);
});

test('no line when nothing is left to show', () => {
  assert.equal(formatExaminePrice('Bones', 1, { ge: 0, ha: 0, la: 0 }, BOTH), null);
  assert.equal(formatExaminePrice('Steel scimitar', 1, { ge: 67, ha: 240, la: 160 }, { ge: false, alch: false }), null);
});

test('prices come from the item a note stands for; untradeable items and coins have none', () => {
  const trout = examinePrices(TROUT);
  assert.deepEqual(examinePrices(NOTED_TROUT), trout);
  assert.equal(trout.name, 'Trout');
  const scimitar = examinePrices(STEEL_SCIMITAR);
  assert.equal(scimitar.prices.ha, 240);
  assert.equal(scimitar.prices.la, 160);
  assert.equal(examinePrices(FEATHER).prices.la, 0);
  assert.ok(scimitar.prices.ge > 0, 'quoted on the GE');
  assert.equal(examinePrices(BARCRAWL_CARD), null, 'untradeable');
  const coins = examinePrices(COINS);
  assert.equal(coins === null || formatExaminePrice(coins.name, 100, coins.prices, BOTH) === null, true, 'coins: no line');
  assert.equal(ItemDefinition.forId(STEEL_SCIMITAR).isTradeable(), true);
});

test('sendExaminePrice follows the two settings', () => {
  const varbits = new Map();
  const messages = [];
  const player = {
    getPacketSender: () => ({ getVarbit: (id) => varbits.get(id) ?? 0 }),
    sendMessage: (text) => messages.push(text),
  };
  sendExaminePrice(player, STEEL_SCIMITAR, 1);
  assert.deepEqual(messages, [], 'both off');
  varbits.set(EXAMINE_PRICE_ALCH_VARBIT, 1);
  sendExaminePrice(player, STEEL_SCIMITAR, 1);
  assert.deepEqual(messages, [`Price of Steel scimitar: HA ${r(240)}  LA ${r(160)}`]);
  varbits.set(EXAMINE_PRICE_GE_VARBIT, 1);
  sendExaminePrice(player, BARCRAWL_CARD, 1);
  assert.equal(messages.length, 1, 'untradeable: nothing');
});
