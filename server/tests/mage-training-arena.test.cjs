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

let Common, Guardians, Lobby, Enchanting, Alchemists, Graveyard, events, ironmanMode;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/minigames/magetrainingarena/Common.MageTrainingArena');
  Guardians = require('../plugins/minigames/magetrainingarena/Guardians.MageTrainingArena');
  Lobby = require('../plugins/minigames/magetrainingarena/Lobby.MageTrainingArena');
  Enchanting = require('../plugins/minigames/magetrainingarena/Enchanting.MageTrainingArena');
  Alchemists = require('../plugins/minigames/magetrainingarena/Alchemists.MageTrainingArena');
  Graveyard = require('../plugins/minigames/magetrainingarena/Graveyard.MageTrainingArena');
  ironmanMode = 'none';
  events = [];
  const api = new Proxy({
    core: { ...core, TaskManager: { submit() {} }, Bank: { ...core.Bank, getTabForItem: () => 0 } },
    persistAttribute: () => {},
    emitCustomEvent(name, event) {
      events.push([name, event]);
      if (name === 'npc-dialogue:start') event.handled = true;
      if (name === 'ironman:mode') event.mode = ironmanMode;
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
    getCurrentBankTab: () => 0,
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

// --- The Alchemists' Playground

const playgroundTile = () => Common.data.alchemists.arrive;

test('the cupboards hold the five items and an empty one in a fixed order, turning between cupboards', () => {
  Alchemists.playground.offset = 0;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(Alchemists.cupboardItem), ['boots', 'kiteshield', 'helm', 'emerald', 'longsword', null]);
  Alchemists.playground.offset = 2;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(Alchemists.cupboardItem), ['longsword', null, 'boots', 'kiteshield', 'helm', 'emerald']);
});

test('every change gives the five items the values 1, 5, 8, 15 and 30, and sometimes a free one', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let frees = 0;
  for (let i = 0; i < 30; i++) {
    Alchemists.change(random);
    assert.deepEqual(Object.values(Alchemists.playground.values).sort((a, b) => a - b), [1, 5, 8, 15, 30]);
    if (Alchemists.playground.free) frees += 1;
  }
  assert.ok(frees > 0 && frees < 30);
});

test('Search takes one, Take-5 up to five as room allows; the empty cupboard says so; other cupboards are left alone', () => {
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  const { locs, items } = Common.ids;
  Alchemists.playground.offset = 0;
  Alchemists.takeFrom(player, locs.cupboard0, false);
  assert.equal(player.items.get(items.boots), 1);
  player.setFree(3);
  Alchemists.takeFrom(player, locs.cupboard4, true);
  assert.equal(player.items.get(items.longsword), 3);
  Alchemists.takeFrom(player, locs.cupboard5, true);
  assert.equal(player.messages.at(-1), Common.message('cupboardEmpty'));
  assert.equal(Alchemists.takeFrom(player, 1, true), false);
});

test("alching the room's items pays this turn's value in arena coins; the free one takes no runes", () => {
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  Alchemists.playground.values = { boots: 30, kiteshield: 1, helm: 5, emerald: 8, longsword: 15 };
  Alchemists.playground.free = 'boots';
  const policy = { player, itemId: items.boots, spellId: 55, allowed: false, coins: 12 };
  Alchemists.alchemyPolicy(policy);
  assert.equal(policy.allowed, true);
  assert.equal(policy.coins, 0, 'no real coins');
  const bypass = { player, spellId: 55, runeId: 561, bypass: null };
  Alchemists.runeBypass(bypass);
  assert.equal(bypass.bypass, true);
  const otherSpell = { player, spellId: 14, runeId: 561, bypass: null };
  Alchemists.runeBypass(otherSpell);
  assert.equal(otherSpell.bypass, null, 'only the alchemy just allowed');
  Alchemists.alchemyCompleted({ player, itemId: items.boots });
  assert.equal(player.items.get(items.arenaCoins), 30);
  const again = { player, spellId: 55, runeId: 561, bypass: null };
  Alchemists.runeBypass(again);
  assert.equal(again.bypass, null, 'and only once');

  const paid = { player, itemId: items.helm, spellId: 55, allowed: false, coins: 0 };
  Alchemists.alchemyPolicy(paid);
  const runes = { player, spellId: 55, runeId: 561, bypass: null };
  Alchemists.runeBypass(runes);
  assert.equal(runes.bypass, null);

  const outside = fakePlayer(3200, 3200, 0);
  const elsewhere = { player: outside, itemId: items.boots, spellId: 55, allowed: false, coins: 0 };
  Alchemists.alchemyPolicy(elsewhere);
  assert.equal(elsewhere.allowed, false);
});

test('the Coin Collector: a point per 100 (the rest a chance of one more), 10 real coins per 100, 2 XP a coin', () => {
  const [x, y, z] = playgroundTile();
  const { items } = Common.ids;
  const banked = [];
  const player = fakePlayer(x, y, z);
  player.getBank = () => ({ contains: () => false, getAddableAmount: (item) => item.getAmount(), add: (item) => banked.push([item.getId(), item.getAmount()]) });
  player.items.set(items.arenaCoins, 250);
  assert.equal(Alchemists.depositCoins(player, () => 0.4), 3, '50% chance taken');
  assert.equal(player.items.get(items.arenaCoins), 0);
  assert.deepEqual(banked, [[items.coins, 20]]);
  assert.deepEqual(player.xp, [500]);
  assert.equal(Common.points(player, 'alchemist'), 3);
  player.items.set(items.arenaCoins, 250);
  assert.equal(Alchemists.depositCoins(player, () => 0.6), 2);
  ironmanMode = 'ultimate';
  const uim = fakePlayer(x, y, z);
  uim.items.set(items.arenaCoins, 100);
  Alchemists.depositCoins(uim, () => 0.9);
  assert.equal(uim.items.get(items.coins), 10, 'an Ultimate Ironman gets them in the pack');
  ironmanMode = 'none';
});

test('the Alchemists Teleport needs Magic 21 and no coins', () => {
  const player = fakePlayer(3363, 3319, 0);
  const { locs, items } = Common.ids;
  player.magic = 20;
  Alchemists.enter({ player, objectId: locs.alchemistsPortal });
  assert.equal(player.messages.at(-1), Common.message('level', { level: 21, room: "Alchemists' Playground" }));
  player.magic = 21;
  player.items.set(items.coins, 5);
  Alchemists.enter({ player, objectId: locs.alchemistsPortal });
  assert.equal(player.messages.at(-1), Common.message('noCoins'));
  player.items.set(items.coins, 0);
  Alchemists.enter({ player, objectId: locs.alchemistsPortal });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], playgroundTile());
});

test("leaving pays the arena coins in first, then the room's items and coins are gone", () => {
  const Area = Alchemists.defineArea();
  const area = new Area();
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  player.isPlayer = () => true;
  player.getAsPlayer = () => player;
  player.getBank = () => ({ contains: () => false, getAddableAmount: (item) => item.getAmount(), add() {} });
  const { items } = Common.ids;
  player.items.set(items.arenaCoins, 300);
  player.items.set(items.emerald, 4);
  const before = Common.points(player, 'alchemist');
  area.postLeave(player, true);
  assert.equal(player.items.get(items.arenaCoins), 300, 'logging out keeps them');
  area.postLeave(player, false);
  assert.equal(Common.points(player, 'alchemist') - before, 3);
  assert.equal(player.items.get(items.arenaCoins), 0);
  assert.equal(player.items.get(items.emerald), 0);
});

test("a full bank can't swallow the Coin Collector's real coins: they go to the pack", () => {
  const [x, y, z] = playgroundTile();
  const { items } = Common.ids;
  const player = fakePlayer(x, y, z);
  player.getBank = () => ({ contains: () => false, getAddableAmount: () => 0, add() { throw new Error('nothing fits'); } });
  player.items.set(items.arenaCoins, 300);
  Alchemists.depositCoins(player, () => 0.9);
  assert.equal(player.items.get(items.coins), 30);
  assert.ok(!player.messages.some((m) => /added to your bank/.test(m)));
});

test('in the room an alchemy takes 5 ticks: a cast before then is refused', () => {
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  Alchemists.playground.values = { boots: 30, kiteshield: 1, helm: 5, emerald: 8, longsword: 15 };
  Alchemists.playground.free = null;
  const first = { player, itemId: items.emerald, spellId: 55, allowed: false, coins: 0 };
  Alchemists.alchemyPolicy(first);
  assert.equal(first.allowed, true);
  Alchemists.alchemyCompleted({ player, itemId: items.emerald });
  const second = { player, itemId: items.emerald, spellId: 55, allowed: false, coins: 0 };
  Alchemists.alchemyPolicy(second);
  assert.equal(second.allowed, false);
  player.__mtaNextAlch = -1;
  const later = { player, itemId: items.emerald, spellId: 55, allowed: false, coins: 0 };
  Alchemists.alchemyPolicy(later);
  assert.equal(later.allowed, true);
});

// --- The Creature Graveyard

const graveyardTile = () => Common.data.graveyard.arrive;

test('each bone pile type gives its own kind, then the next kind after every four taken', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const { locs, items } = Common.ids;
  for (let i = 0; i < 6; i++) Graveyard.grab({ player, objectId: locs.bonePile2 });
  assert.equal(player.items.get(items.bones2), 4);
  assert.equal(player.items.get(items.bones3), 2);
  for (let i = 0; i < 6; i++) Graveyard.grab({ player, objectId: locs.bonePile4 });
  assert.equal(player.items.get(items.bones4), 4);
  assert.equal(player.items.get(items.bones1), 2, 'kind 4 turns back to kind 1');
  assert.equal(Graveyard.grab({ player, objectId: 1 }), false);
});

test('Bones to Bananas turns every animals\' bone into its fruit, for one cast\'s runes and XP', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  player.items.set(items.bones1, 2);
  player.items.set(items.bones4, 3);
  player.setFree(10);
  let casts = 0;
  const event = { player, spellName: 'Bones to Bananas', handled: false };
  const Spell = core.Spell.prototype;
  const original = Spell.canCast;
  Spell.canCast = function () { casts += 1; return true; };
  try {
    Graveyard.castBonesSpell(event);
  } finally {
    Spell.canCast = original;
  }
  assert.equal(event.handled, true);
  assert.equal(casts, 1);
  assert.equal(player.items.get(items.banana), 14);
  assert.equal(player.items.get(items.bones1), 0);
  assert.equal(player.items.get(items.bones4), 0);
  assert.deepEqual(player.xp, [25]);
});

test('Bones to Peaches needs its unlock in the room; no bones, no cast', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const locked = { player, spellName: 'Bones to Peaches', handled: false };
  Graveyard.castBonesSpell(locked);
  assert.equal(locked.handled, true);
  assert.equal(player.messages.at(-1), Common.message('peachesLocked'));
  const empty = { player, spellName: 'Bones to Bananas', handled: false };
  Graveyard.castBonesSpell(empty);
  assert.equal(player.messages.at(-1), Common.message('noBones'));
  const outside = fakePlayer(3200, 3200, 0);
  const elsewhere = { player: outside, spellName: 'Bones to Bananas', handled: false };
  Graveyard.castBonesSpell(elsewhere);
  assert.equal(elsewhere.handled, false, 'outside the room the spell is the ordinary one');
});

test('the chute: a point per 16 fruit (a peach is 2), at most 3 a deposit, 5 XP a banana and 10 a peach', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  player.items.set(items.banana, 20);
  assert.deepEqual(Graveyard.depositFruit(player, () => 0.2), { fruit: 20, points: 2 }, '20 bananas: 1 point and a 25% chance of a second');
  assert.deepEqual(player.xp, [100]);
  player.xp.length = 0;
  player.items.set(items.peach, 27);
  const most = Graveyard.depositFruit(player, () => 0.9);
  assert.deepEqual(most, { fruit: 54, points: 3 }, '27 peaches count as 24 (Wiki)');
  assert.equal(player.items.get(items.peach), 0, 'all of them go in');
  assert.deepEqual(player.xp, [270], 'and give XP');
  assert.equal(Graveyard.depositFruit(fakePlayer(x, y, z)), null);
});

test('every Graveyard point earns a rune, given on leaving; logging out keeps the room\'s things', () => {
  const Area = Graveyard.defineArea();
  const area = new Area();
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  player.isPlayer = () => true;
  player.getAsPlayer = () => player;
  const { items } = Common.ids;
  player.items.set(items.banana, 32);
  Graveyard.depositFruit(player, () => 0.9);
  player.items.set(items.bones2, 3);
  area.postLeave(player, true);
  assert.equal(player.items.get(items.bones2), 3);
  assert.equal(player.getAttribute(Graveyard.RUNES_OWED_ATTRIBUTE), 2);
  area.postLeave(player, false);
  assert.equal(player.items.get(items.bones2), 0);
  const runes = Common.data.graveyard.rewardRunes.reduce((sum, rune) => sum + (player.items.get(items[rune]) ?? 0), 0);
  assert.equal(runes, 2);
  assert.equal(player.getAttribute(Graveyard.RUNES_OWED_ATTRIBUTE), 0);
});

test('the Graveyard Teleport needs Magic 15, and no fruit or bones', () => {
  const player = fakePlayer(3365, 3318, 0);
  player.magic = 14;
  Graveyard.enter({ player, objectId: Common.ids.locs.graveyardPortal });
  assert.equal(player.messages.at(-1), Common.message('level', { level: 15, room: 'Creature Graveyard' }));
  player.magic = 15;
  for (const key of ['peach', 'banana', 'bones']) {
    player.items.set(Common.ids.items[key], 2);
    Graveyard.enter({ player, objectId: Common.ids.locs.graveyardPortal });
    assert.equal(player.messages.at(-1), Common.message('noFruitIn'), key);
    assert.equal(player.items.get(Common.ids.items[key]), 2, 'and nothing of theirs is taken');
    player.items.set(Common.ids.items[key], 0);
  }
  Graveyard.enter({ player, objectId: Common.ids.locs.graveyardPortal });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], graveyardTile());
});
