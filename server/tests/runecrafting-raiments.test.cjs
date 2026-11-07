// Run after `yarn build`: node --test tests/runecrafting-raiments.test.cjs
// Raiments of the Eye: extra runes at the altars, against the OSRS Wiki
// (https://oldschool.runescape.wiki/w/Raiments_of_the_Eye); see docs/runecrafting.md.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');

let core, Raiments, receipts;
const ALTAR_LOCATION = [2845, 4832, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const api = PluginManager.createApi('RunecraftingRaimentsTest');
  receipts = [];
  api.onCustomEvent('runecrafting:success', event => receipts.push(event));
  require('../plugins/skills/Runecrafting.plugin').register(api);
  Raiments = require('../plugins/skills/runecrafting/Raiments.Runecrafting');
});

let index = 3000;
function crafter({ pieces = [], essence = 28, level = 1 } = {}) {
  const I = core.ItemIdentifiers;
  const player = new Player(null, new core.Location(...ALTAR_LOCATION));
  player.setIndex(index++);
  player.setUsername('raiments-test');
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.messages = [];
  player.sendMessage = text => player.messages.push(text);
  const skills = player.getSkillManager();
  skills.setCurrentLevels(core.Skill.RUNECRAFTING, level);
  player.runecraftingXp = [];
  const addExperience = skills.addExperiences.bind(skills);
  skills.addExperiences = (skill, xp) => {
    if (skill === core.Skill.RUNECRAFTING) player.runecraftingXp.push(xp);
    return addExperience(skill, xp);
  };
  const worn = {
    hat: [core.Equipment.HEAD_SLOT, I.HAT_OF_THE_EYE],
    top: [core.Equipment.BODY_SLOT, I.ROBE_TOP_OF_THE_EYE],
    bottoms: [core.Equipment.LEG_SLOT, I.ROBE_BOTTOMS_OF_THE_EYE],
    boots: [core.Equipment.FEET_SLOT, I.BOOTS_OF_THE_EYE],
    redHat: [core.Equipment.HEAD_SLOT, I.HAT_OF_THE_EYE_RED_],
    blueTop: [core.Equipment.BODY_SLOT, I.ROBE_TOP_OF_THE_EYE_BLUE_],
  };
  for (const piece of pieces) player.getEquipment().set(worn[piece][0], new Item(worn[piece][1]));
  if (essence > 0) player.getInventory().add(new Item(I.PURE_ESSENCE, essence), false);
  return player;
}

function craftAtAirAltar(player) {
  const objectId = core.ObjectIdentifiers.ALTAR_33;
  const location = new core.Location(...ALTAR_LOCATION);
  const object = new core.GameObject(objectId, location, 10, 0, null);
  const definition = core.ObjectDefinition.forPlayer(objectId, player);
  const event = { player, object, objectId, definition, clickType: 1, handled: false };
  receipts.length = 0;
  assert.equal(PluginManager.emitObjectInteraction(event), true);
  return event;
}

const airRunes = player => player.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE);

test('bonusFor follows the Wiki formula: whole tens times M, and the remainder\'s chance of one more', () => {
  const { bonusFor, MULTIPLIER_BY_PIECES } = Raiments;
  assert.deepEqual(MULTIPLIER_BY_PIECES, [0, 1, 2, 3, 6]);
  // Wiki: 28 runes with one piece give 2 or 3 bonus runes; the full set 12 or 18.
  assert.equal(bonusFor(28, 1, () => 0.99), 2, 'the remainder roll fails (0.99 * 10 >= 8)');
  assert.equal(bonusFor(28, 1, () => 0), 3, 'the remainder roll passes');
  assert.equal(bonusFor(28, 2, () => 0.99), 4);
  assert.equal(bonusFor(28, 2, () => 0), 6);
  assert.equal(bonusFor(28, 3, () => 0.99), 6);
  assert.equal(bonusFor(28, 3, () => 0), 9);
  assert.equal(bonusFor(28, 4, () => 0.99), 12);
  assert.equal(bonusFor(28, 4, () => 0), 18);
  // Whole tens are never random; nothing without pieces or runes.
  assert.equal(bonusFor(30, 4, () => 0), 18);
  assert.equal(bonusFor(30, 4, () => 0.99), 18);
  assert.equal(bonusFor(28, 0, () => 0), 0);
  assert.equal(bonusFor(0, 4, () => 0), 0);
  // The chance is the remainder over ten, so the average is R * M / 10.
  let total = 0;
  const rolls = 20000;
  for (let i = 0; i < rolls; i++) total += bonusFor(28, 4);
  assert.ok(Math.abs(total / rolls - 16.8) < 0.3, `average ${total / rolls} is about 28 * 6 / 10`);
});

test('pieces count by slot and cache name, in any dye', () => {
  assert.equal(Raiments.piecesWorn(crafter({ pieces: [] })), 0);
  assert.equal(Raiments.piecesWorn(crafter({ pieces: ['hat'] })), 1);
  assert.equal(Raiments.piecesWorn(crafter({ pieces: ['redHat', 'blueTop', 'bottoms'] })), 3);
  assert.equal(Raiments.piecesWorn(crafter({ pieces: ['hat', 'top', 'bottoms', 'boots'] })), 4);
  const carried = crafter({ pieces: [] });
  carried.getInventory().add(new Item(core.ItemIdentifiers.HAT_OF_THE_EYE), false);
  assert.equal(Raiments.piecesWorn(carried), 0, 'a carried piece gives nothing');
});

test('an altar craft in the full set gives the bonus runes and no extra XP', () => {
  const player = crafter({ pieces: ['hat', 'top', 'bottoms', 'boots'], essence: 28, level: 1 });
  const event = craftAtAirAltar(player);
  assert.equal(event.handled, true);
  // Level 1 makes one air rune an essence: 28, plus 12 or 18 from the set.
  assert.ok([28 + 12, 28 + 18].includes(airRunes(player)), `got ${airRunes(player)} air runes`);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.PURE_ESSENCE), 0);
  assert.deepEqual(player.runecraftingXp, [28 * 5], 'XP is for the essence only');
  const receipt = receipts.find(entry => entry.source === 'altar');
  assert.equal(receipt.bonusRunes, airRunes(player) - 28);
  assert.equal(receipt.runeAmount, airRunes(player));
  assert.equal(receipt.rolls * receipt.amountPerEssence, 28, 'the base receipt is unchanged');
});

test('a single piece gives 2 or 3 bonus runes for 28 essence, and none without the outfit', () => {
  const one = crafter({ pieces: ['redHat'] });
  craftAtAirAltar(one);
  assert.ok([30, 31].includes(airRunes(one)), `got ${airRunes(one)} air runes`);

  const bare = crafter();
  craftAtAirAltar(bare);
  assert.equal(airRunes(bare), 28);
  assert.equal(receipts.find(entry => entry.source === 'altar').bonusRunes, 0);
});

test('the Ourania Altar adds the bonus to each colour of rune it makes', () => {
  const total = player => player.getInventory().getItems().reduce(
    (sum, item) => sum + (item && item.getId() !== core.ItemIdentifiers.PURE_ESSENCE ? item.getAmount() : 0), 0);
  const objectId = core.ObjectIdentifiers.ALTAR_31;
  const craft = player => {
    const location = new core.Location(...ALTAR_LOCATION);
    const object = new core.GameObject(objectId, location, 10, 0, null);
    const definition = core.ObjectDefinition.forPlayer(objectId, player);
    receipts.length = 0;
    PluginManager.emitObjectInteraction({ player, object, objectId, definition, clickType: 1, handled: false });
  };

  const bare = crafter({ level: 99, essence: 28 });
  craft(bare);
  assert.equal(total(bare), 28, 'one rune an essence without the outfit');
  assert.ok(receipts.every(receipt => receipt.bonusRunes === 0));

  const set = crafter({ pieces: ['hat', 'top', 'bottoms', 'boots'], level: 99, essence: 28 });
  const random = Math.random;
  Math.random = () => 0; // the first colour every roll, and every remainder roll passes
  try {
    craft(set);
  } finally {
    Math.random = random;
  }
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].bonusRunes, 18, 'the Wiki\'s 28 runes with the full set: the higher of 12 or 18');
  const bonus = receipts.reduce((sum, receipt) => sum + receipt.bonusRunes, 0);
  assert.ok(receipts.every(receipt => receipt.bonusRunes % 6 === 0), 'each colour gets whole sixes from the full set');
  assert.equal(total(set), 28 + bonus, 'the bonus runes are in the inventory');
  assert.equal(receipts.reduce((sum, receipt) => sum + receipt.runeAmount, 0), 28 + bonus);
  for (const receipt of receipts) {
    const base = receipt.rolls;
    assert.ok(receipt.bonusRunes >= Math.floor(base / 10) * 6 && receipt.bonusRunes <= (Math.floor(base / 10) + 1) * 6);
  }
});
