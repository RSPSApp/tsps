// Run after `yarn build`: node --test tests/weapon-style-memory.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { COMBAT_STYLE_BY_CATEGORY_ATTRIBUTE } = require("../dist/game/content/combat/FightType");
const { FightType } = require("../dist/game/content/combat/FightType");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");

// The special bar and autocast indicators aren't what's under test.
CombatSpecial.assign = () => {};
CombatSpecial.updateBar = () => {};
Autocasting.refreshIndicators = () => {};
Autocasting.clearForStyle = () => {};

/** Enough of a player for assign() and changeCombatStyle(): it reports the varp 43 values sent. */
function fakePlayer(weaponInterface, fightType = FightType.UNARMED_KICK) {
  const attributes = new Map();
  const styles = [];
  const item = {
    getId: () => (weaponInterface.current === WeaponInterfaces.UNARMED ? -1 : 1),
    getDefinition: () => ({ getWeaponInterface: () => weaponInterface.current, getName: () => "Test weapon" }),
  };
  const sender = new Proxy({}, {
    get: (_target, name) => (name === "sendConfig"
      ? (varp, value) => { if (varp === FightType.UNARMED_KICK.getParentId()) styles.push(value); return sender; }
      : () => sender),
  });
  const player = {
    styles,
    getEquipment: () => ({ getItems: () => Object.assign([], { 3: item }) }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getFightType: () => fightType,
    setFightType: (value) => { fightType = value; },
    getWeapon: () => weaponInterface.current,
    setWeapon: () => {},
    getPacketSender: () => sender,
    autoRetaliateReturn: () => true,
  };
  return player;
}

function slots(weapon) {
  return Object.values(weapon.getFightType()).filter((type) => type instanceof FightType.UNARMED_KICK.constructor)
    .map((type) => type.getChildId()).sort((a, b) => a - b);
}

test("every weapon category has a style in slot 0, the one a category starts on", () => {
  for (const weapon of [WeaponInterfaces.UNARMED, WeaponInterfaces.WHIP, WeaponInterfaces.SCIMITAR]) {
    assert.equal(slots(weapon)[0], 0, String(weapon.getCategory()));
  }
});

test("a weapon category goes back to its own style when its weapon returns (rsprox 1718, 3200, 3275)", () => {
  const wielded = { current: WeaponInterfaces.WHIP };
  const player = fakePlayer(wielded);

  WeaponInterfaceManager.assign(player);
  assert.ok(WeaponInterfaceManager.changeCombatStyle(player, 3));
  assert.equal(player.getAttribute(COMBAT_STYLE_BY_CATEGORY_ATTRIBUTE)[WeaponInterfaces.WHIP.getCategory()], 3);

  wielded.current = WeaponInterfaces.SCIMITAR;
  WeaponInterfaceManager.assign(player);
  assert.equal(player.styles.at(-1), 0, "a category never chosen starts on its first style");

  assert.ok(WeaponInterfaceManager.changeCombatStyle(player, 1));

  wielded.current = WeaponInterfaces.WHIP;
  WeaponInterfaceManager.assign(player);
  assert.equal(player.styles.at(-1), 3);

  wielded.current = WeaponInterfaces.SCIMITAR;
  WeaponInterfaceManager.assign(player);
  assert.equal(player.styles.at(-1), 1);
});

test("a save from before the memory keeps the style it was on", () => {
  const wielded = { current: WeaponInterfaces.WHIP };
  const lash = Object.values(WeaponInterfaces.WHIP.getFightType())
    .find((type) => type instanceof FightType.UNARMED_KICK.constructor && type.getChildId() === 1);
  const player = fakePlayer(wielded, lash);

  WeaponInterfaceManager.assign(player);
  assert.equal(player.styles.at(-1), 1);
  assert.equal(player.getAttribute(COMBAT_STYLE_BY_CATEGORY_ATTRIBUTE)[WeaponInterfaces.WHIP.getCategory()], 1);
});
