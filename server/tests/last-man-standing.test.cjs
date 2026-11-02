// Run after `npx tsc --build`: node --test tests/last-man-standing.test.cjs
//
// Last Man Standing (plugins/minigames/lms) on a real Player with only the network stubbed: the
// data's names resolve in the cache, the rank and points rules, the stash round trip, a build's
// load-out and levels, the kill resupply, and the supply chest's clicks and drags.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const Common = require('../plugins/minigames/lms/Common.LastManStanding');
const Profile = require('../plugins/minigames/lms/Profile.LastManStanding');
const Stash = require('../plugins/minigames/lms/Stash.LastManStanding');
const Loadouts = require('../plugins/minigames/lms/Loadouts.LastManStanding');
const Match = require('../plugins/minigames/lms/Match.LastManStanding');
const Loot = require('../plugins/minigames/lms/Loot.LastManStanding');

let core;
let index = 1;

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  Common.init({
    core,
    getPluginConfig: (_key, fallback) => fallback,
    getSkillManager: () => require('../dist/game/content/skill/SkillManager').SkillManager,
    emitCustomEvent() {},
  });
});

function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  p.messages = [];
  p.varbits = new Map();
  const sender = p.getPacketSender();
  const sendVarbit = sender.sendVarbit;
  t.mock.method(sender, 'sendVarbit', function (id, value) { p.varbits.set(id, value); return sendVarbit.apply(this, arguments); });
  t.mock.method(p, 'sendMessage', (line) => p.messages.push(line));
  return p;
}

const id = (name) => Common.objId(name);
const names = (container) => container.getItems().filter((item) => item && item.getId() > 0).map((item) => item.getDefinition().getName());

test('every loot, shop and key name is an item in the cache', () => {
  for (const [build, tables] of Object.entries(Common.data.loot)) {
    for (const [table, entries] of Object.entries(tables)) {
      for (const entry of entries) {
        for (const item of entry) {
          const name = Array.isArray(item) ? item[0] : item;
          assert.ok(id(name) > 0, `${build} ${table}: ${name}`);
        }
      }
    }
  }
  for (const entry of Common.data.shop.stock) if (entry) assert.ok(id(entry[0]) > 0, `shop: ${entry[0]}`);
  for (const key of ['bloody', 'bloodier']) assert.ok(id(Common.data.keys[key]) > 0);
});

test('points: the place, plus 2 for three kills or 3 for five (Wiki)', () => {
  assert.equal(Match.pointsFor(1, 1), 6);
  assert.equal(Match.pointsFor(2, 1), 5);
  assert.equal(Match.pointsFor(4, 1), 4);
  assert.equal(Match.pointsFor(5, 1), 3);
  assert.equal(Match.pointsFor(9, 3), 5);
  assert.equal(Match.pointsFor(12, 5), 4);
  assert.equal(Match.pointsFor(20, 1), 0);
});

test('results: a win from 499 is 508 and 6 points; 21st loses 5 rank and gets nothing (captured)', (t) => {
  const winner = realPlayer(t);
  winner.setAttribute(Common.ATTRIBUTES.rank, 499);
  winner.setAttribute(Common.POINTS_ATTRIBUTE, 7);
  const game = { clock: 700, kills: new Map([[winner, 2]]), mode: Common.data.modes[1] };
  const won = Match.results(game, winner, 1, 'won');
  assert.equal(Common.rankOf(winner), 508);
  assert.deepEqual(won, [[2, 'Your rank has increased!'], [3, 'You have earned <col=ef1020>6 points</col>. Total: <col=ef1020>13</col>.']]);

  const loser = realPlayer(t);
  loser.setAttribute(Common.ATTRIBUTES.rank, 500);
  const lost = Match.results({ clock: 40, kills: new Map(), mode: Common.data.modes[1] }, loser, 21);
  assert.equal(Common.rankOf(loser), 495);
  assert.deepEqual(lost, [[1, 'Your rank has decreased!'], [2, 'You earned no points because you were not in the game for long enough. Total: <col=ef1020>0</col>.']]);
});

test('the stash keeps the player\'s own things and levels, and gives them back', (t) => {
  const { Item, Skill } = core;
  const p = realPlayer(t);
  p.getInventory().add(new Item(995, 1000), false);
  p.getEquipment().setItem(3, new Item(4151, 1));
  Stash.save(p);
  assert.deepEqual(names(p.getInventory()), []);
  Loadouts.equip(p, 2);
  assert.equal(p.getSkillManager().getMaxLevel(Skill.DEFENCE), 1);
  assert.equal(p.getSkillManager().getMaxLevel(Skill.ATTACK), 75);
  assert.ok(names(p.getEquipment()).includes('Ancient staff'));
  assert.ok(Stash.restore(p));
  assert.deepEqual(names(p.getInventory()), ['Coins']);
  assert.deepEqual(names(p.getEquipment()), ['Abyssal whip']);
  assert.equal(p.getSkillManager().getMaxLevel(Skill.ATTACK), 1);
  assert.equal(Stash.stashed(p), null);
});

test('a build\'s load-out: the captured Max/Med kit with 5,000 bolts', (t) => {
  const p = realPlayer(t);
  Loadouts.equip(p, 0);
  const equipment = p.getEquipment().getItems();
  assert.equal(equipment[3].getId(), id('br_abyssal_whip'));
  assert.equal(equipment[13].getAmount(), 5000);
  assert.equal(p.getInventory().getAmount(id('br_shark')), 10);
  assert.equal(p.getSpellbook(), core.MagicSpellbook.ANCIENT);
});

test('a kill tops the supplies back up and swaps drunk potions for full ones', (t) => {
  const { Item } = core;
  const p = realPlayer(t);
  Loadouts.equip(p, 0);
  const inventory = p.getInventory();
  inventory.delete(id('br_shark'), 5);
  const brew = inventory.getSlotForItemId(id('br_4dosepotionofsaradomin'));
  inventory.setItem(brew, new Item(id('br_1dosepotionofsaradomin'), 1));
  Loadouts.resupply(p, 0, () => assert.fail('no drop with room'));
  assert.equal(inventory.getAmount(id('br_shark')), 10);
  assert.equal(inventory.getAmount(id('br_4dosepotionofsaradomin')), 3);
  assert.equal(inventory.getAmount(id('br_1dosepotionofsaradomin')), 0);
});

test('the supply chest: a click adds within the limits, a drag swaps, the trash discards', (t) => {
  const p = realPlayer(t);
  Profile.finishTutorial(p);
  const inventoryUid = Common.component('br_loadout:cinventory');
  const menuUid = Common.component('br_loadout:cmenu');
  const trashUid = Common.component('br_loadout:ctrash');
  const before = Profile.loadout(p, 2);
  // Captured: a slot dragged onto another swaps the two.
  Loadouts.drag({ player: p, packet: { sourceWidgetId: inventoryUid, sourceSlot: 0, targetWidgetId: inventoryUid, targetSlot: 25 } });
  let after = Profile.loadout(p, 2);
  assert.equal(after.inventory[0], before.inventory[25]);
  assert.equal(after.inventory[25], before.inventory[0]);
  assert.equal(p.varbits.get(Common.varbitId('br_loadout_c_inv_25')), before.inventory[0]);
  // Ten sharks is the limit (Wiki): the list's shark (18) adds nothing more.
  Loadouts.click({ player: p, buttonId: menuUid, slot: 18, opId: 1 });
  assert.equal(Profile.loadout(p, 2).inventory.filter((value) => value === 18).length, 10);
  // Onto the trash, and the slot is empty.
  Loadouts.drag({ player: p, packet: { sourceWidgetId: inventoryUid, sourceSlot: 25, targetWidgetId: trashUid, targetSlot: -1 } });
  after = Profile.loadout(p, 2);
  assert.equal(after.inventory[25], 0);
  // A Pure can't take the Lunar spellbook (Wiki); Standard is sub 2.
  Loadouts.click({ player: p, buttonId: Common.component('br_loadout:cspellbook_menu'), slot: 3, opId: 1 });
  assert.equal(Profile.loadout(p, 2).spellbook, 0);
  Loadouts.click({ player: p, buttonId: Common.component('br_loadout:cspellbook_menu'), slot: 2, opId: 1 });
  assert.equal(Profile.loadout(p, 2).spellbook, 1);
});

test('loot lines read as captured', () => {
  const { Item } = core;
  assert.equal(Loot.lineOf([new Item(id('br_purging_staff'), 1)]), '<col=ef1020>Purging staff</col>');
  assert.equal(Loot.lineOf([new Item(id('br_morrigans_javelin'), 1000)]), "1,000 x <col=ef1020>Morrigan's javelin</col>");
});

const Lobby = require('../plugins/minigames/lms/Lobby.LastManStanding');
const Coffer = require('../plugins/minigames/lms/Coffer.LastManStanding');

test('entry: the introduction first; Competitive needs 750 total and 30 quest points, or 1,500 (Wiki)', (t) => {
  const p = realPlayer(t);
  const competitive = Lobby.modeOf('competitive');
  assert.equal(Lobby.refusal(p, competitive).box, Common.message('introNeeded'));
  Profile.finishTutorial(p);
  assert.match(Lobby.refusal(p, competitive).line, /total level of 750/);
  assert.equal(Lobby.refusal(p, Lobby.modeOf('casual')), null);
  const { Skill } = core;
  for (const name of Object.keys(Skill).filter((key) => Skill[key]?.getIndex)) p.getSkillManager().setMaxLevels(Skill[name], 99, false);
  assert.equal(Lobby.refusal(p, competitive), null);
});

test('three forfeits in a day bar the ranked modes', (t) => {
  const p = realPlayer(t);
  Profile.finishTutorial(p);
  const { Skill } = core;
  for (const name of Object.keys(Skill).filter((key) => Skill[key]?.getIndex)) p.getSkillManager().setMaxLevels(Skill[name], 99, false);
  for (let i = 0; i < 3; i++) Lobby.forfeited(p);
  assert.equal(Lobby.forfeitsToday(p), 3);
  assert.match(Lobby.refusal(p, Lobby.modeOf('competitive')).line, /forfeited too many/);
  assert.equal(Lobby.refusal(p, Lobby.modeOf('casual')), null);
});

test('High Stakes: the fee from the coffer, prizes to the reward chest, a free game for 3rd-5th (Wiki)', (t) => {
  const highStakes = Lobby.modeOf('highstakes');
  const first = realPlayer(t);
  Profile.setCoffer(first, 600000);
  assert.ok(Coffer.pay(first, highStakes.fee));
  assert.equal(Profile.coffer(first), 100000);
  assert.equal(Coffer.pay(first, highStakes.fee), false);
  Match.results({ clock: 700, kills: new Map([[first, 3]]), mode: highStakes }, first, 1);
  assert.equal(Common.number(first, Common.ATTRIBUTES.winnings), 7500000);
  Coffer.claim({ player: first });
  assert.equal(first.getInventory().getAmount(995), 7500000);
  assert.equal(Common.number(first, Common.ATTRIBUTES.winnings), 0);

  const third = realPlayer(t);
  Match.results({ clock: 700, kills: new Map([[third, 1]]), mode: highStakes }, third, 4);
  assert.ok(Coffer.freeEntry(third));
  assert.ok(Coffer.pay(third, highStakes.fee));
  assert.equal(Coffer.freeEntry(third), false);
});

const Items = require('../plugins/minigames/lms/Items.LastManStanding');

test('the game\'s copies fire as the real items: crossbows, bolts, arrows (cache-derived aliases)', () => {
  Items.registerAliases();
  const { ItemAliases } = core;
  const { RangedWeapon, Ammunition } = require('../dist/game/content/combat/ranged/RangedData');
  assert.equal(ItemAliases.baseOf(id('br_xbows_crossbow_runite')), 9185);
  assert.equal(ItemAliases.baseOf(id('br_dragon_claws')), 13652);
  assert.ok(Ammunition.getForItem(id('br_dstone_bolts_e')));
  assert.equal(Ammunition.getForItem(id('br_dstone_bolts_e')), Ammunition.getForItem(9243));
  assert.ok(Ammunition.getForItem(id('fake_dragon_arrow')));
  assert.ok(ItemAliases.same(id('br_dragon_bolts_enchanted_opal'), ItemAliases.baseOf(id('br_dragon_bolts_enchanted_opal'))));
  assert.equal(ItemAliases.baseOf(id('br_shark')) != null, true);
  assert.equal(ItemAliases.baseOf(9185), null);
});

test('in a game the rune pouch covers a spell\'s runes (Ice Barrage)', (t) => {
  const { Item } = core;
  const p = realPlayer(t);
  const runes = [new Item(560, 4), new Item(565, 2), new Item(555, 6)];
  assert.equal(Match.pouchCovers(p, runes), false);
  p.getInventory().add(new Item(id('br_rune_replacement'), 1), false);
  assert.equal(Match.pouchCovers(p, runes), false, 'outside a game');
});

test('the game\'s potions drink as the real ones, down their own doses to the game\'s vial', () => {
  const Potions = require('../plugins/items/Potions.plugin');
  const chains = Items.potionChains();
  assert.deepEqual(chains.get('Saradomin brew'), ['br_4dosepotionofsaradomin', 'br_3dosepotionofsaradomin', 'br_2dosepotionofsaradomin', 'br_1dosepotionofsaradomin'].map(id));
  for (const [name, chain] of chains) {
    const request = { name, chain, emptyItemId: id('br_vial_empty') };
    Potions._test.registerCopy(request);
    assert.ok(request.registered, name);
  }
  const brew = Potions._test.findPotionEntry(id('br_4dosepotionofsaradomin'));
  assert.equal(brew.potion.name, 'Saradomin brew');
  assert.equal(brew.replacementId, id('br_3dosepotionofsaradomin'));
  assert.equal(Potions._test.findPotionEntry(id('br_1dose2restore')).replacementId, id('br_vial_empty'));
  assert.equal(Potions._test.findPotionEntry(id('br_sanfew_salve_4_dose')).potion.name, 'Sanfew serum');
});

test('the waiting rooms run right up to their barriers (the row beside it is inside)', (t) => {
  const { Location } = require('../dist/game/model/Location');
  const p = realPlayer(t);
  const at = (x, y, z) => { p.setLocation(new Location(x, y, z)); return Lobby.waitingMode(p)?.key ?? null; };
  assert.equal(at(3142, 3639, 0), 'competitive');
  assert.equal(at(3138, 3645, 0), 'competitive');
  assert.equal(at(3142, 3638, 0), null, 'the lobby side of the barrier');
  assert.equal(at(3141, 3639, 1), 'casual');
  assert.equal(at(3141, 3639, 2), 'highstakes');
});

test('a teleport from a waiting area is refused, as captured; the lobby lets it through', (t) => {
  const { Location } = require('../dist/game/model/Location');
  const p = realPlayer(t);
  p.setLocation(new Location(3142, 3640, 0));
  const inside = { player: p, allow: null };
  Lobby.canTeleport(inside);
  assert.equal(inside.allow, false);
  assert.deepEqual(p.messages, ['Please use the door if you need to leave.']);
  p.setLocation(new Location(3142, 3638, 0));
  const lobby = { player: p, allow: null };
  Lobby.canTeleport(lobby);
  assert.equal(lobby.allow, null);
});

test('holding_inventory_location is 2 while belongings are held and 0 once they are back', (t) => {
  const p = realPlayer(t);
  const id = Common.varbitId('holding_inventory_location');
  assert.ok(id != null, 'the varbit resolves');
  Stash.save(p);
  assert.equal(p.varbits.get(id), 2);
  Stash.restore(p);
  assert.equal(p.varbits.get(id), 0);
});

test('belongings come back on a closed session (logging out mid-game) without throwing', (t) => {
  const p = realPlayer(t);
  p.getSession.mock.mockImplementation(() => ({ sendClientPacket: () => false, write: () => false }));
  p.getInventory().add(new (require('../dist/game/model/Item').Item)(id('coins'), 5), false);
  Stash.save(p);
  assert.doesNotThrow(() => Stash.restore(p));
  assert.equal(p.getInventory().getAmount(id('coins')), 5);
  assert.equal(Stash.stashed(p), null);
});

test('the time runs out: survivors all take the place they are in, not one each', (t) => {
  t.mock.method(Common, 'later', () => {});
  const survivors = [{}, {}, {}];
  const released = [];
  const game = Object.assign(Object.create(Match.Game.prototype), {
    over: false,
    begun: true,
    alive: new Set(survivors),
    area: { isDestroyed: () => true },
    release: (player, place, how) => released.push([player, place, how]),
  });
  game.finish();
  assert.deepEqual(released.map(([, place, how]) => [place, how]), [[3, 'time'], [3, 'time'], [3, 'time']]);
});

test('leaving the arena drops hits still queued, and poison and venom, before belongings come back', (t) => {
  t.mock.method(Common, 'later', () => {});
  t.mock.method(require('../plugins/minigames/lms/Lobby.LastManStanding'), 'openOverlay', () => {});
  const p = realPlayer(t);
  p.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(10, core.HitMask.RED)]);
  p.setPoisonDamage(5);
  p.setVenomed(true);
  const game = { area: {}, immuneUntil: new Map(), mode: { ranked: false } };
  Match.Game.prototype.release.call(game, p, 1, 'dead');
  assert.equal(p.getCombat().getHitQueue().hasPendingWork(), false);
  assert.equal(p.isPoisoned(), false);
  assert.equal(p.isVenomed(), false);
});

test('a withdrawal fills only what the coin stack can hold, and the coffer keeps the rest', (t) => {
  const Coffer = require('../plugins/minigames/lms/Coffer.LastManStanding');
  const p = realPlayer(t);
  // The coffer's menu reopens after each withdrawal; its prompt is the plugin api's.
  const initWith = (extra) => Common.init({
    core,
    getPluginConfig: (_key, fallback) => fallback,
    getSkillManager: () => require('../dist/game/content/skill/SkillManager').SkillManager,
    ...extra,
  });
  initWith({ sendMultiChatboxPrompt: () => {} });
  t.after(() => initWith({}));
  let entered;
  t.mock.method(p, 'setEnteredAmountAction', (action) => { entered = action; });
  const withdrawing = (amount) => {
    Coffer.withdraw(p);
    entered.execute(amount);
  };
  p.getInventory().add(new (require('../dist/game/model/Item').Item)(id('coins'), 2147482000), false);
  Profile.setCoffer(p, 5000);
  withdrawing(5000);
  assert.equal(p.getInventory().getAmount(id('coins')), 2147483000);
  assert.equal(Profile.coffer(p), 4000);
  withdrawing(5000);
  assert.equal(p.getInventory().getAmount(id('coins')), 2147483000, 'the stack has no room for a whole 1,000');
  assert.equal(Profile.coffer(p), 4000, 'nothing taken, nothing deducted');
});

test('Justine\'s purchase: a stack that cannot take the whole set refuses it and keeps the points', (t) => {
  const Rewards = require('../plugins/minigames/lms/Rewards.LastManStanding');
  const slot = Common.data.shop.stock.findIndex((entry) => entry && entry[0] === 'rune_arrow');
  const p = realPlayer(t);
  let entered;
  t.mock.method(p, 'setEnteredAmountAction', (action) => { entered = action; });
  p.setAttribute(Common.ATTRIBUTES.wins, 1);
  p.setAttribute(Common.POINTS_ATTRIBUTE, 10);
  const Item = require('../dist/game/model/Item').Item;
  p.getInventory().add(new Item(id('rune_arrow'), 2147483637), false);
  Rewards.confirm({ player: p, slot });
  entered.execute(1);
  assert.equal(Common.points(p), 10, 'no points taken for arrows that do not fit');
  assert.equal(p.getInventory().getAmount(id('rune_arrow')), 2147483637, 'the stack keeps what it had');
});

test('Justine\'s purchase: the set is added in full when the stack has the room, and costs its points', (t) => {
  const Rewards = require('../plugins/minigames/lms/Rewards.LastManStanding');
  const slot = Common.data.shop.stock.findIndex((entry) => entry && entry[0] === 'rune_arrow');
  const p = realPlayer(t);
  let entered;
  t.mock.method(p, 'setEnteredAmountAction', (action) => { entered = action; });
  p.setAttribute(Common.ATTRIBUTES.wins, 1);
  p.setAttribute(Common.POINTS_ATTRIBUTE, 10);
  const Item = require('../dist/game/model/Item').Item;
  p.getInventory().add(new Item(id('rune_arrow'), 2147483000), false);
  Rewards.confirm({ player: p, slot });
  entered.execute(1);
  assert.equal(Common.points(p), 7);
  assert.equal(p.getInventory().getAmount(id('rune_arrow')), 2147483300);
});
