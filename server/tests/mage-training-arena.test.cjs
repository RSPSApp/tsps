// From server/: node --test tests/mage-training-arena.test.cjs (after yarn build).
//
// The Mage Training Arena against the OSRS Wiki (Mage_Training_Arena, Pizazz_points, Progress_hat,
// Entrance_Guardian, Enchanting_Chamber): the hat and its dialogue, Pizazz Points and their caps,
// the Enchanting Chamber's piles, enchant points, hole and rune reward, and the room's items.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Guardians, Lobby, Enchanting, events;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/minigames/magetrainingarena/Common.MageTrainingArena');
  Guardians = require('../plugins/minigames/magetrainingarena/Guardians.MageTrainingArena');
  Lobby = require('../plugins/minigames/magetrainingarena/Lobby.MageTrainingArena');
  Enchanting = require('../plugins/minigames/magetrainingarena/Enchanting.MageTrainingArena');
  events = [];
  const api = new Proxy({
    core: { ...core, TaskManager: { submit() {} } },
    persistAttribute: () => {},
    emitCustomEvent(name, event) {
      events.push([name, event]);
      if (name === 'npc-dialogue:start') event.handled = true;
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
});

const loc = (x, y, z = 0) => new core.Location(x, y, z);

function fakePlayer(x = 3363, y = 9644, z = 0) {
  let tile = loc(x, y, z);
  const items = new Map();
  let free = 20;
  const xp = [];
  const strings = new Map();
  const hidden = new Map();
  const player = {
    messages: [], attributes: {}, xp, strings, hidden, magic: 99, anims: 0,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    sendMessage: (m) => player.messages.push(m),
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    getSkillManager: () => ({ getCurrentLevel: () => player.magic, addExperiences: (skill, amount) => xp.push(amount) }),
    getPacketSender: () => ({
      sendSubInterface() {}, closeSubInterface() {}, sendSound() {},
      sendString: (text, id) => strings.set(id, text),
      sendInterfaceDisplayState: (id, hide) => hidden.set(id, hide),
    }),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      contains: (id) => (items.get(id) ?? 0) > 0,
      deleteNumber: (id, n) => items.set(id, (items.get(id) ?? 0) - n),
      adds: (id, n) => items.set(id, (items.get(id) ?? 0) + n),
      getFreeSlots: () => free,
      getItems: () => player.slots ?? [],
    }),
    getEquipment: () => ({ get: () => null }),
    getBanks: () => [],
    performAnimation: () => { player.anims += 1; },
    performGraphic() {},
    setFree: (n) => { free = n; },
    items,
  };
  return player;
}

test('every id resolves from the cache', () => {
  const { npcs, locs, items, interfaces } = Common.ids;
  assert.deepEqual([npcs.entranceGuardian, npcs.enchantmentGuardian, npcs.hat], [5978, 5981, 7512]);
  assert.deepEqual([locs.enchantPortal, locs.exit, locs.hole], [23674, 23677, 23698]);
  assert.deepEqual([locs.cubePile, locs.cylinderPile, locs.icosahedronPile, locs.pentamidPile], [23694, 23695, 23696, 23697]);
  assert.deepEqual([items.hatDull, items.hatEnergised, items.hatFull], [6885, 6886, 6887]);
  assert.deepEqual([items.cube, items.cylinder, items.icosahedron, items.pentamid, items.orb, items.dragonstone], [6899, 6898, 6900, 6901, 6902, 6903]);
  assert.deepEqual([interfaces.lobby, interfaces.enchanting], [553, 195]);
});

test('Pizazz Points stop at each type\'s cap', () => {
  const player = fakePlayer();
  assert.equal(Common.addPoints(player, 'enchantment', 31990), 31990);
  assert.equal(Common.addPoints(player, 'enchantment', 50), 10);
  assert.equal(Common.points(player, 'enchantment'), 32000);
  assert.match(player.messages.at(-1), /Enchantment/);
  assert.equal(Common.addPoints(player, 'telekinetic', 9000), 8000);
  assert.equal(Common.addPoints(player, 'telekinetic', -500), -500);
  assert.equal(Common.points(player, 'telekinetic'), 7500);
});

test('the hat brightens at 300 of every type, fills at 600, and dulls again when points are spent', () => {
  const player = fakePlayer();
  const { items } = Common.ids;
  player.items.set(items.hatDull, 1);
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 300);
  assert.equal(player.items.get(items.hatEnergised), 1);
  assert.equal(player.items.get(items.hatDull), 0);
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 300);
  assert.equal(player.items.get(items.hatFull), 1);
  Common.addPoints(player, 'graveyard', -400);
  assert.equal(player.items.get(items.hatDull), 1);
  assert.equal(player.items.get(items.hatFull), 0);
});

test('the Entrance Guardian gives the hat if there is room, and again once it is lost', () => {
  const player = fakePlayer(3363, 3303);
  const npcId = Common.ids.npcs.entranceGuardian;
  assert.equal(Guardians.variant({ player, npcId }), null);
  player.setFree(0);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player does not have inventory space:' }), true);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player has inventory space:' }), false);
  player.setFree(5);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player has inventory space:' }), true);
  const action = { player, npcId, action: 'receive', text: 'Progress hat', handled: false };
  Guardians.action(action);
  assert.equal(action.handled, true);
  assert.equal(player.items.get(Common.ids.items.hatDull), 1);
  assert.equal(Guardians.variant({ player, npcId }), Guardians.AFTER_HAT);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player already owns a progress hat:' }), true);
  player.items.set(Common.ids.items.hatDull, 0);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player has destroyed or lost their progress hat:' }), true);
  assert.equal(Guardians.condition({ player, npcId: 1, text: 'If the player has inventory space:' }), null, 'other NPCs are left alone');
});

test("the hat reads out the four totals in the transcript's blanks", () => {
  const player = fakePlayer();
  Common.addPoints(player, 'telekinetic', 12);
  Common.addPoints(player, 'alchemist', 1500);
  Common.addPoints(player, 'enchantment', 7);
  const request = { player, npcId: Common.ids.npcs.hat, text: 'Ok, I suppose it\'s my job. You have: [number] Telekinetic, [number] Alchemist, [number] Enchantment, and [number] Graveyard Pizazz Points.' };
  Guardians.line(request);
  assert.equal(request.text, 'Ok, I suppose it\'s my job. You have: 12 Telekinetic, 1,500 Alchemist, 7 Enchantment, and 0 Graveyard Pizazz Points.');
  events = [];
  assert.equal(Guardians.talkToHat({ player }), true);
  assert.equal(events[0][0], 'npc-dialogue:start');
  assert.equal(events[0][1].npcId, Common.ids.npcs.hat);
});

test('the Enchanters Teleport needs Magic 7; the Exit Teleport leads back to the hall', () => {
  const player = fakePlayer(3360, 3317);
  player.magic = 6;
  Lobby.enterEnchanting({ player, objectId: Common.ids.locs.enchantPortal });
  assert.equal(player.messages.at(-1), Common.message('level', { level: 7, room: 'Enchanting Chamber' }));
  assert.equal(player.getLocation().getY(), 3317);
  player.magic = 7;
  Lobby.enterEnchanting({ player, objectId: Common.ids.locs.enchantPortal });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], Common.data.enchanting.arrive);
  Lobby.exit({ player, objectId: Common.ids.locs.exit });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], Common.data.lobby.arrive);
  assert.equal(Lobby.exit({ player, objectId: 1 }), false);
});

test('each pile gives its shape, 1 in 32 a dragonstone; nothing with a full pack', () => {
  const player = fakePlayer();
  const { locs, items } = Common.ids;
  Enchanting.takeFromPile({ player, objectId: locs.pentamidPile }, () => 0.5);
  assert.equal(player.items.get(items.pentamid), 1);
  Enchanting.takeFromPile({ player, objectId: locs.cubePile }, () => 0.01);
  assert.equal(player.items.get(items.dragonstone), 1);
  player.setFree(0);
  Enchanting.takeFromPile({ player, objectId: locs.cubePile }, () => 0.5);
  assert.equal(player.items.get(items.cube) ?? 0, 0);
  assert.equal(player.messages.at(-1), Common.message('inventoryFull'));
});

test('enchant points: the spell level, doubled every 10th shape, +2 on the bonus shape, double for a dragonstone', () => {
  assert.equal(Enchanting.enchantPoints(4, { count: 3, bonus: false }), 4);
  assert.equal(Enchanting.enchantPoints(4, { count: 10, bonus: false }), 8);
  assert.equal(Enchanting.enchantPoints(4, { count: 3, bonus: true }), 6);
  assert.equal(Enchanting.enchantPoints(4, { count: 20, bonus: true }), 10);
  assert.equal(Enchanting.enchantPoints(7, { dragonstone: true }), 14);
});

test('an enchant in the chamber turns the shape into an orb with the spell\'s runes and XP', () => {
  const player = fakePlayer();
  const { items } = Common.ids;
  player.items.set(items.cube, 1);
  player.slots = [null, { getId: () => items.cube }];
  let runesSpent = 0;
  const spell = { canCast: () => { runesSpent += 1; return true; }, baseExperience: () => 67, data: { animation: 719, graphic: 153, sound: 137 } };
  Enchanting.chamber.bonus = 'cube';
  const event = { player, spell, spellName: 'Lvl-4 Enchant', itemId: items.cube, slot: 1, handled: false };
  Enchanting.enchantShape(event);
  assert.equal(event.handled, true);
  assert.equal(runesSpent, 1);
  assert.equal(player.items.get(items.cube), 0);
  assert.equal(player.items.get(items.orb), 1);
  assert.deepEqual(player.xp, [67]);
  assert.equal(Common.points(player, 'enchantment'), 6, '4 for the spell, +2 for the bonus cube');
  assert.equal(player.strings.get(Common.ids.components.enchantPoints), '6');
  assert.equal(player.hidden.get(Common.ids.components.bonusCube), false);
  assert.equal(player.hidden.get(Common.ids.components.bonusPentamid), true);

  const outside = fakePlayer(3200, 3200);
  outside.items.set(items.cube, 1);
  const elsewhere = { player: outside, spell, spellName: 'Lvl-4 Enchant', itemId: items.cube, slot: 1, handled: false };
  Enchanting.enchantShape(elsewhere);
  assert.equal(elsewhere.handled, false, 'outside the chamber the jewellery spell says it can\'t');
});

test('the hole takes every orb for 20 XP each; 3 runes for every 20, given on leaving', () => {
  const player = fakePlayer();
  const { items, locs } = Common.ids;
  player.items.set(items.orb, 45);
  Enchanting.deposit({ player, objectId: locs.hole });
  assert.equal(player.items.get(items.orb), 0);
  assert.deepEqual(player.xp, [900]);
  const given = Enchanting.payRunes(player, () => 0);
  assert.deepEqual(given, { blood: 6 });
  assert.equal(player.items.get(Common.ids.items.blood), 6);
  assert.deepEqual(Enchanting.payRunes(player), {}, 'paid once');
});

test("leaving clears the room's items before the runes, so a full pack still gets them; logging out keeps both", () => {
  const Area = Enchanting.defineArea();
  const area = new Area();
  const { items } = Common.ids;
  const player = fakePlayer();
  player.isPlayer = () => true;
  player.getAsPlayer = () => player;
  player.items.set(items.cube, 27);
  player.setAttribute(Enchanting.ORBS_ATTRIBUTE, 40);
  const inventory = player.getInventory();
  inventory.getFreeSlots = () => (player.items.get(items.cube) > 0 ? 0 : 27);
  player.getInventory = () => inventory;
  area.postLeave(player, true);
  assert.equal(player.items.get(items.cube), 27, 'logout keeps the shapes');
  assert.equal(player.getAttribute(Enchanting.ORBS_ATTRIBUTE), 40, 'and the orbs counted');
  area.postLeave(player, false);
  assert.equal(player.items.get(items.cube), 0);
  const runes = ['blood', 'death', 'cosmic'].reduce((sum, rune) => sum + (player.items.get(items[rune]) ?? 0), 0);
  assert.equal(runes, 6, 'two rewards of 3 runes, in the pack');
  assert.equal(player.getAttribute(Enchanting.ORBS_ATTRIBUTE), 0);
});

test("the room's shapes, orbs and dragonstones never leave it", () => {
  const player = fakePlayer();
  const { items } = Common.ids;
  for (const id of [items.cube, items.cylinder, items.icosahedron, items.pentamid, items.orb, items.dragonstone]) player.items.set(id, 2);
  player.items.set(564, 50);
  assert.equal(Enchanting.removeRoomItems(player), 12);
  assert.equal(player.items.get(564), 50);
});

test('the bonus shape always changes to a different one', () => {
  Enchanting.chamber.bonus = 'cube';
  Enchanting.rotateBonus(() => 0);
  assert.notEqual(Enchanting.chamber.bonus, 'cube');
  const previous = Enchanting.chamber.bonus;
  Enchanting.rotateBonus(() => 0.99);
  assert.notEqual(Enchanting.chamber.bonus, previous);
});

test('the jewellery enchant spells offer other items to the arena before refusing them', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'skills', 'Spells.EnchantJewellery.js'), 'utf8');
  assert.match(source, /emitCustomEvent\("magic:enchant-item"/);
});
