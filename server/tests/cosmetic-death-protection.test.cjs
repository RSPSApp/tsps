// Run after `yarn build`: node --test tests/cosmetic-death-protection.test.cjs
// Death protection from cosmetics (All Settings row 386, varbit 10987): an ornamented item is kept on
// a non-PvP death outside the Wilderness beyond the kept count, unless the player turns the row off
// (docs/settings.md, "Death protection from cosmetics").
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Item } = require('../dist/game/model/Item');
const { Location } = require('../dist/game/model/Location');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');

const WAIVE_VARBIT = 10987;
const RUNE_DEFENDER_T = 23230;
const ARMADYL_GODSWORD_OR = 20368;
const VOLCANIC_ABYSSAL_WHIP = 12773;
const ARCEUUS_GRACEFUL_HOOD = 13579;
const KEPT_STATE = 323;
// A PvM death sends what it does not keep to the grave.
const GRAVE_STATE = 367;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require('../plugins/items/OrnamentKits.plugin').register(PluginManager.createApi('OrnamentKits'));
});

const WILDERNESS = new Location(3090, 3600, 0);
const EDGEVILLE = new Location(3090, 3490, 0);

function container(items) {
  return {
    getItems: () => items, getValidItems: () => items.filter(Boolean),
    resetItems() { items.length = 0; return this; }, refreshItems() { return this; },
  };
}

function fakePlayer({ items, waived = false, skulled = false, location = EDGEVILLE, sender = {} }) {
  const inventory = container(items);
  const equipment = container([]);
  return {
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getSkullTimer: () => (skulled ? 100 : 0),
    getSkullType: () => 0,
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99 }),
    getPrayerActive: () => new Array(40).fill(false),
    getLocation: () => location,
    getRights: () => PlayerRights.NONE,
    getPacketSender: () => ({ ...sender, getVarbit: (id) => (id === WAIVE_VARBIT && waived ? 1 : 0) }),
  };
}

/** Whether OrnamentKits answers `player-death:cosmetic` for the item. */
function isCosmetic(id) {
  const query = { item: new Item(id, 1), cosmetic: false };
  PluginManager.emitCustomEvent('player-death:cosmetic', query);
  return query.cosmetic;
}

const names = (items) => items.map((item) => item.getDefinition().getName());
// Bandos godsword, berserker ring and Robin Hood hat outrank a rune defender (t) (an alchemy value
// of 39,002) and a rune platebody (a Grand Exchange price of about 38,700).
const loadout = () => [I.BANDOS_GODSWORD, I.BERSERKER_RING, I.ROBIN_HOOD_HAT, RUNE_DEFENDER_T, I.RUNE_PLATEBODY, ARCEUUS_GRACEFUL_HOOD]
  .map((id) => new Item(id, 1));
const TOP_THREE = ['Bandos godsword', 'Berserker ring', 'Robin Hood hat'];

test('a PvM death keeps an ornamented item beyond the three most valuable', () => {
  const player = fakePlayer({ items: loadout() });
  assert.equal(PlayerDeathTask.protectsCosmetics(player, null), true);
  const { ranked, cosmetic } = PlayerDeathTask.getKeptItems(player, 3, true);
  assert.deepEqual(names(ranked), TOP_THREE);
  assert.deepEqual(names(cosmetic), ['Rune defender (t)'], 'the platebody and a recoloured graceful hood are not protected');
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player, 3, true)), [...TOP_THREE, 'Rune defender (t)']);
});

test('a skulled PvM death still keeps the ornamented item', () => {
  const player = fakePlayer({ items: loadout(), skulled: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player, 0, PlayerDeathTask.protectsCosmetics(player, null))), ['Rune defender (t)']);
});

test('an ornamented item valuable enough takes a kept slot and adds none', () => {
  const items = [I.BANDOS_GODSWORD, I.BERSERKER_RING, ARMADYL_GODSWORD_OR, I.RUNE_PLATEBODY].map((id) => new Item(id, 1));
  const { ranked, cosmetic } = PlayerDeathTask.getKeptItems(fakePlayer({ items }), 3, true);
  assert.deepEqual(names(ranked), ['Bandos godsword', 'Berserker ring', 'Armadyl godsword (or)']);
  assert.deepEqual(cosmetic, []);
});

test('a whip mixed with a tradeable mix is protected like a kit', () => {
  const items = [I.BANDOS_GODSWORD, I.BERSERKER_RING, I.ROBIN_HOOD_HAT, I.RUNE_PLATEBODY, VOLCANIC_ABYSSAL_WHIP]
    .map((id) => new Item(id, 1));
  const player = fakePlayer({ items, skulled: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player, 0, true)), ['Volcanic abyssal whip']);
});

test('a Bounty Hunter kit protects though it is untradeable; other untradeable modifications do not', () => {
  assert.equal(isCosmetic(28031), true, 'Dragon scimitar (cr)');
  assert.equal(isCosmetic(28067), true, 'Fighter torso (or), Bounty Hunter kit');
  assert.equal(isCosmetic(24664), false, 'Twisted ancestral hat: the colour kit is an untradeable modification');
  assert.equal(isCosmetic(24743), false, 'Graceful hood made with dark dye');
  assert.equal(isCosmetic(ARCEUUS_GRACEFUL_HOOD), false);
  // Items the Items Kept on Death screen on live marks lost when outside the kept slots.
  for (const id of [19641, 21295, 27721, 22322, 13280, 11834]) assert.equal(isCosmetic(id), false, `item ${id}`);
});

test('no protection when waived (row 386 off), killed by a player or in the Wilderness', () => {
  const killer = {};
  for (const [label, player, by] of [
    ['waived', fakePlayer({ items: loadout(), waived: true }), null],
    ['player kill', fakePlayer({ items: loadout() }), killer],
    ['Wilderness', fakePlayer({ items: loadout(), location: WILDERNESS }), null],
  ]) {
    assert.equal(PlayerDeathTask.protectsCosmetics(player, by), false, label);
    assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player, 3, PlayerDeathTask.protectsCosmetics(player, by))), TOP_THREE, label);
  }
  const self = fakePlayer({ items: loadout() });
  assert.equal(PlayerDeathTask.protectsCosmetics(self, self), true, 'a player who killed themself is not a PvP death');
});

test('the death itself keeps the ornamented item out of the grave, and loses it once waived', (t) => {
  const emitDrops = PluginManager.emitPlayerDeathDrops;
  t.after(() => { PluginManager.emitPlayerDeathDrops = emitDrops; });
  for (const waived of [false, true]) {
    let drops;
    PluginManager.emitPlayerDeathDrops = (event) => {
      drops = { items: [...event.items], untradeables: [...event.untradeables] };
      event.items.length = 0; // a grave takes them
      event.untradeables.length = 0;
    };
    const player = fakePlayer({ items: loadout(), waived });
    const kept = PlayerDeathTask.dropItems(player, null, EDGEVILLE);
    if (waived) {
      assert.deepEqual(names(kept), TOP_THREE);
      assert.ok(names(drops.untradeables).includes('Rune defender (t)'), 'waived, it goes to the grave');
    } else {
      assert.deepEqual(names(kept), [...TOP_THREE, 'Rune defender (t)']);
      assert.ok(!names(drops.untradeables).includes('Rune defender (t)'));
    }
    assert.deepEqual(names(drops.items), ['Rune platebody'], waived ? 'waived' : 'protected');
  }
});

test('the Items Kept on Death screen marks the protected item kept, and the PvP and Wilderness toggles drop it', () => {
  const handlers = new Map();
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register({
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: () => false, PROTECT_ITEM: 0 }),
    // A PvM death makes a grave, which takes unkept untradeables.
    emitCustomEvent: (name, query) => { if (name === 'gravestones:makes-grave') query.makesGrave = !query.playerKill; },
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
  });
  let sent;
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript(id, args, _varps, _varbits, inventories) { sent = { args, inventories }; return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString() { return sender; },
    sendInterfaceRemoval() { return sender; },
  };
  const stateOf = (itemId) => {
    const slot = sent.inventories[584].slots.find((s) => s.itemId === itemId);
    return slot && sent.inventories[468].slots[slot.slot].itemId;
  };
  const screen = (waived) => {
    const player = { ...fakePlayer({ items: loadout(), waived, sender }), busy: () => false, setInterfaceId() {}, getInterfaceId: () => 4 };
    handlers.get((387 << 16) | 5)({ player });
    return player;
  };

  const player = screen(false);
  assert.equal(sent.args[5], 3, 'the three kept slots stay the three most valuable');
  assert.deepEqual(sent.args.slice(6, 9).map((id) => new Item(id, 1).getDefinition().getName()), TOP_THREE);
  assert.equal(stateOf(RUNE_DEFENDER_T), KEPT_STATE);
  assert.equal(stateOf(I.RUNE_PLATEBODY), GRAVE_STATE);

  handlers.get((4 << 16) | 12)({ player, action: 3 }); // Wilderness level 21
  assert.equal(stateOf(RUNE_DEFENDER_T), GRAVE_STATE, 'a Wilderness death does not protect it');
  handlers.get((4 << 16) | 12)({ player, action: 3 }); // back to 0
  assert.equal(stateOf(RUNE_DEFENDER_T), KEPT_STATE);

  screen(true);
  assert.equal(stateOf(RUNE_DEFENDER_T), GRAVE_STATE, 'waived, it falls to the grave');

  const inWilderness = { ...fakePlayer({ items: loadout(), location: WILDERNESS, sender }), busy: () => false, setInterfaceId() {}, getInterfaceId: () => 4 };
  handlers.get((387 << 16) | 5)({ player: inWilderness });
  assert.equal(stateOf(RUNE_DEFENDER_T), GRAVE_STATE, 'opened in the Wilderness, the screen shows the death there');
  assert.equal(sent.args[5], 3);
});

test('a granite maul with both the clamp and the ornate handle is protected, by either order of attaching', () => {
  const clampOnHandled = require('../plugins/items/data/ornament-kits.json').kits
    .find((entry) => entry.kit === I.GRANITE_CLAMP && entry.base === I.GRANITE_MAUL_5);
  // granite_maul_pretty_plus (24227); 24226 is the handled maul's placeholder.
  assert.equal(clampOnHandled.result, I.GRANITE_MAUL_7, 'the clamp on a handled maul makes the clamped, handled maul');
  assert.equal(isCosmetic(I.GRANITE_MAUL_3), true, 'Granite maul (clamp)');
  assert.equal(isCosmetic(I.GRANITE_MAUL_7), true, 'Granite maul (ornate handle, clamp)');
  assert.equal(isCosmetic(I.GRANITE_MAUL_5), false, 'the ornate handle alone is an upgrade, not an ornament kit');
});

test('a failed Tombs of Amascut raid leaves the protected item with the player, and sends it to the chest once waived', (t) => {
  const Shared = require('../plugins/minigames/toa/Shared.TombsOfAmascut');
  const Retrieval = require('../plugins/minigames/toa/Retrieval.TombsOfAmascut');
  const previous = Shared.api();
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent() {}, getBonusManager: () => ({ update() {} }) });
  t.after(() => Shared.bind(previous ?? { core: null }));

  const raider = (waived) => {
    const player = fakePlayer({ items: loadout(), waived });
    const inventory = player.getInventory();
    const attributes = new Map();
    Object.assign(inventory, { setItem(slot, item) { inventory.getItems()[slot] = item; return inventory; } });
    Object.assign(player.getEquipment(), { setItem() {} });
    return Object.assign(player, {
      getAttribute: (key) => attributes.get(key),
      setAttribute: (key, value) => attributes.set(key, value),
      getUpdateFlag: () => ({ flag() {} }),
    });
  };
  const chest = (player) => player.getAttribute(Retrieval.ATTR_STORED).items.map(({ id }) => new Item(id, 1).getDefinition().getName());
  const held = (player) => names(player.getInventory().getItems().filter((item) => item && item.getId() > 0));

  const protectedRaider = raider(false);
  Retrieval.storeLost(protectedRaider);
  assert.deepEqual(held(protectedRaider), [...TOP_THREE, 'Rune defender (t)']);
  assert.deepEqual(chest(protectedRaider), ['Rune platebody', 'Graceful hood']);

  const waivedRaider = raider(true);
  Retrieval.storeLost(waivedRaider);
  assert.deepEqual(held(waivedRaider), TOP_THREE);
  assert.deepEqual(chest(waivedRaider), ['Rune defender (t)', 'Rune platebody', 'Graceful hood']);
});
