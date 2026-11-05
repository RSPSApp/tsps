// Run after `yarn build`: node --test tests/ornament-ranged-combat.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { RangedCombatMethod } = require("../dist/game/content/combat/method/impl/RangedCombatMethod");
const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
const { ItemAliases } = require("../dist/game/model/ItemAliases");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");

const core = PluginManager.getCoreApi();
const pluginApi = (name) => PluginManager.createApi(`ornament-ranged-test:${name}`);

require("../plugins/items/VenatorBow.plugin").register(pluginApi("venator"));
require("../plugins/items/ToxicBlowpipe.plugin").register(pluginApi("blowpipe"));
require("../plugins/combat/specials/ToxicBlowpipe.SpecialAttack")(pluginApi("blowpipe-special"));

function item(id, amount = 1, metadata = {}) {
  const meta = new Map(Object.entries(metadata));
  return {
    getId: () => id,
    setId: (next) => { id = next; },
    getAmount: () => amount,
    getMetaValue: (key) => meta.get(key),
    setMetaValue: (key, value) => value === undefined ? meta.delete(key) : meta.set(key, value),
  };
}

function playerWith(weaponId, weaponInterface, ammoId, ammoAmount = 100, metadata = {}) {
  const equipmentItems = new Array(14).fill(null);
  const weapon = item(weaponId, 1, metadata);
  equipmentItems[Equipment.WEAPON_SLOT] = weapon;
  equipmentItems[Equipment.AMMUNITION_SLOT] = item(ammoId, ammoAmount);
  let rangedWeapon = null;
  let ammunition = null;
  let resets = 0;
  const equipment = {
    get: (slot) => equipmentItems[slot] ?? item(-1, 0),
    getItems: () => equipmentItems,
  };
  const combat = {
    getRangedWeapon: () => rangedWeapon,
    setRangedWeapon: (value) => { rangedWeapon = value; },
    getAmmunition: () => ammunition,
    setAmmunition: (value) => { ammunition = value; },
    getCastSpell: () => null,
    getAutocastSpell: () => null,
    reset: () => { resets++; },
  };
  const messages = [];
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getEquipment: () => equipment,
    getCombat: () => combat,
    getWeapon: () => weaponInterface,
    isSpecialActivated: () => false,
    getFightType: () => weaponInterface.getFightType()[0],
    sendMessage: (message) => messages.push(message),
    state: () => ({ rangedWeapon, ammunition, resets, messages }),
    weapon,
  };
  return player;
}

test("charged and uncharged Echo Venator bows use native ranged data and ammo checks", () => {
  assert.equal(ItemAliases.baseOf(I.ECHO_VENATOR_BOW), I.VENATOR_BOW);
  assert.equal(ItemAliases.baseOf(I.ECHO_VENATOR_BOW_UNCHARGED_), I.VENATOR_BOW_UNCHARGED_);
  for (const [bowId, chargeState] of [[I.ECHO_VENATOR_BOW, { "venator-bow:charges": 100 }], [I.ECHO_VENATOR_BOW_UNCHARGED_, {}]]) {
    const player = playerWith(bowId, WeaponInterfaces.SHORTBOW, I.RUNE_ARROW, 100, chargeState);
    assert.equal(RangedWeapon.getFor(player), core.RangedWeapon.VENATOR_BOW);
    assert.equal(WeaponProfiles.ranged(player).projectileId, 2291, "Echo inherits the Venator projectile profile");

    const method = CombatFactory.getMethod(player);
    assert.ok(method instanceof RangedCombatMethod);
    assert.equal(method.canAttack(player, {}), true, "native checkAmmo accepts the equipped rune arrows");
    assert.equal(method.shouldRenew(player), true, "native renewal keeps combat active with valid ammunition");
    assert.equal(CombatFactory.checkAmmo(player, 1), true);
  }
});

test("a loaded Blazing Blowpipe resolves native ranged data, renewal, and its special", () => {
  assert.equal(ItemAliases.baseOf(I.BLAZING_BLOWPIPE), I.TOXIC_BLOWPIPE);
  assert.equal(ItemAliases.baseOf(I.BLAZING_BLOWPIPE_EMPTY_), I.TOXIC_BLOWPIPE_EMPTY_);
  const player = playerWith(I.BLAZING_BLOWPIPE, WeaponInterfaces.BLOWPIPE, -1, 0, {
    "toxic-blowpipe": { scales: 100, dartId: I.RUNE_DART, dartAmount: 100 },
  });
  assert.equal(RangedWeapon.getFor(player), core.RangedWeapon.TOXIC_BLOWPIPE);

  const method = CombatFactory.getMethod(player);
  assert.ok(method instanceof RangedCombatMethod);
  assert.equal(method.canAttack(player, {}), true);
  assert.equal(method.shouldRenew(player), true, "native renewal delegates to the registered blowpipe ammo handler");
  assert.equal(CombatFactory.checkAmmo(player, 1), true, "native checkAmmo accepts its loaded dart state");

  const special = CombatSpecial.getById("toxic_blowpipe");
  assert.ok(special);
  assert.equal(CombatSpecial.getForWeaponId(I.BLAZING_BLOWPIPE), special);
  assert.equal(CombatSpecial.getForWeaponId(I.BLAZING_BLOWPIPE_EMPTY_), null, "an empty ornamented blowpipe has no special");
});

test("empty Echo bows retain the base bow's ordinary shooting behavior", () => {
  const player = playerWith(I.ECHO_VENATOR_BOW_UNCHARGED_, WeaponInterfaces.SHORTBOW, -1, 0);
  const method = CombatFactory.getMethod(player);
  assert.equal(RangedWeapon.getFor(player), core.RangedWeapon.VENATOR_BOW);
  assert.equal(method.canAttack(player, {}), false);
  assert.equal(method.shouldRenew(player), false);
  assert.equal(player.state().resets, 1, "native ammo rejection ends the attack");
});
