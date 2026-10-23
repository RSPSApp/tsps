// Run after `yarn build`: node --test tests/staff-effects.test.cjs
// Staves, wands, powered and bladed staves: Power of Death, rune saving and supplied runes, the
// staff melee styles, and that none of the plain staves has a special or consumes anything.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
const { FightStyle } = require("../dist/game/content/combat/FightStyle");
const { FightType } = require("../dist/game/content/combat/FightType");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");

const SpecialAttacks = require("../plugins/combat/SpecialAttacks.plugin");
const ElementalStaves = require("../plugins/items/ElementalStaves.plugin");
const SpellRuneSaving = require("../plugins/items/SpellRuneSaving.plugin");

const rows = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8"),
);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

const incomingModifiers = [];
const listeners = new Map();
const api = new Proxy(
  {
    core: PluginManager.getCoreApi(),
    registerCombatSpecial: (definition) => CombatSpecial.register(definition),
    getBonusManager: () => require("../dist/game/model/equipment/BonusManager").BonusManager,
    registerIncomingDamageModifier: (modifier) => incomingModifiers.push(modifier),
    onCustomEvent: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
  },
  { get: (target, key) => target[key] ?? (() => {}) },
);
const emit = (name, payload) => (listeners.get(name) ?? []).forEach((handler) => handler(payload));
SpecialAttacks.register(api);
ElementalStaves.register(api);
SpellRuneSaving.register(api);

function fakePlayer(weaponId, { special = 100 } = {}) {
  const attributes = new Map();
  const messages = [];
  const player = {
    messages,
    special,
    activated: false,
    isPlayer: () => true,
    getAsPlayer: () => player,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({ get: () => ({ getId: () => player.weaponId }) }),
    weaponId,
    getCombatSpecial: () => CombatSpecial.getForWeaponId(player.weaponId),
    getDueling: () => ({ inDuel: () => false }),
    isSpecialActivated: () => player.activated,
    setSpecialActivated: (value) => { player.activated = value; },
    getSpecialPercentage: () => player.special,
    sendMessage: (message) => messages.push(message),
    performAnimation: (animation) => { player.animation = animation.getId(); },
    performGraphic: (graphic) => { player.graphic = graphic.getId(); },
  };
  return player;
}

function hit(damage) {
  let value = damage;
  return { getDamage: () => value, setDamage: (next) => { value = next; } };
}

function incoming(player, damage, type) {
  const damageHit = hit(damage);
  for (const modifier of incomingModifiers) modifier(player, damageHit, { type });
  return damageHit.getDamage();
}

const POWER_OF_DEATH_STAVES = [I.STAFF_OF_THE_DEAD, I.STAFF_OF_LIGHT, I.STAFF_OF_BALANCE, I.TOXIC_STAFF_OF_THE_DEAD];

function press(player) {
  const drains = [];
  const drain = CombatSpecial.drain;
  const updateBar = CombatSpecial.updateBar;
  CombatSpecial.drain = (character, amount) => { drains.push(amount); character.special -= amount; };
  CombatSpecial.updateBar = () => {};
  try {
    CombatSpecial.activate(player);
  } finally {
    CombatSpecial.drain = drain;
    CombatSpecial.updateBar = updateBar;
  }
  return drains;
}

test("Power of Death drains 100% once, halves melee for a minute and spends no target state", () => {
  for (const staff of POWER_OF_DEATH_STAVES) {
    const player = fakePlayer(staff);
    assert.deepEqual(press(player), [100], `${staff} drains exactly once`);
    assert.equal(player.special, 0);
    assert.equal(player.activated, false, "an instant special never stays toggled on");
    assert.deepEqual(player.messages, ["Spirits of deceased evildoers offer you their protection."]);
    assert.equal(incoming(player, 20, CombatType.MELEE), 10);
    assert.equal(incoming(player, 21, CombatType.MELEE), 10);
    assert.equal(incoming(player, 20, CombatType.RANGED), 20, "only melee is halved");
    assert.equal(incoming(player, 20, CombatType.MAGIC), 20);
    assert.equal(incoming(player, 0, CombatType.MELEE), 0);
  }
});

test("Power of Death needs the full energy bar and changes nothing without it", () => {
  const player = fakePlayer(I.STAFF_OF_THE_DEAD, { special: 99 });
  assert.deepEqual(press(player), []);
  assert.equal(player.special, 99);
  assert.deepEqual(player.messages, ["You do not have enough special attack energy left!"]);
  assert.equal(incoming(player, 20, CombatType.MELEE), 20);
});

test("Power of Death outlives the staff until a hit lands without it, and expires after a minute", () => {
  const player = fakePlayer(I.STAFF_OF_THE_DEAD);
  press(player);
  player.weaponId = -1;
  assert.equal(incoming(player, 20, CombatType.MELEE), 20, "taking damage unarmed ends the effect");
  player.weaponId = I.STAFF_OF_THE_DEAD;
  assert.equal(incoming(player, 20, CombatType.MELEE), 20, "and it stays ended");

  press(fakePlayer(I.STAFF_OF_LIGHT)); // a second user does not share the state
  const unwielded = fakePlayer(I.STAFF_OF_THE_DEAD);
  press(unwielded);
  unwielded.setAttribute("power-of-death:until", Date.now() - 1);
  assert.equal(incoming(unwielded, 20, CombatType.MELEE), 20, "expired");
});

test("recasting restarts the minute without doubling the reduction; a Rejuvenation pool clears it", () => {
  const player = fakePlayer(I.STAFF_OF_THE_DEAD);
  press(player);
  player.special = 100;
  press(player);
  assert.equal(incoming(player, 40, CombatType.MELEE), 20, "50%, not 75%");
  emit("rejuvenation-pool:restored", { player });
  assert.equal(incoming(player, 40, CombatType.MELEE), 40);
});

test("the staff of the dead family and the Kodai wand save runes on offensive spells only", () => {
  const cast = (weaponId, offensive, roll) => {
    const random = Math.random;
    Math.random = () => roll;
    try {
      const event = { player: fakePlayer(weaponId), offensive, saved: false, message: null };
      emit("magic:rune-saving", event);
      return event;
    } finally {
      Math.random = random;
    }
  };
  for (const staff of POWER_OF_DEATH_STAVES) {
    assert.equal(cast(staff, true, 0.12).saved, true, `${staff} saves on the 1/7 roll`);
    assert.equal(cast(staff, true, 0.15).saved, false);
    assert.equal(cast(staff, false, 0).saved, false, "not for utility spells");
  }
  assert.match(cast(I.STAFF_OF_THE_DEAD, true, 0).message, /Staff of the dead/);
  assert.equal(cast(I.KODAI_WAND, true, 0.14).saved, true);
  assert.equal(cast(I.KODAI_WAND, true, 0.16).saved, false);
  assert.equal(cast(I.KODAI_WAND_3, true, 0.14).saved, true);
  assert.equal(cast(I.STAFF_OF_FIRE, true, 0).saved, false, "plain staves never save runes");
});

const SUPPLIED = {
  air: [I.AIR_RUNE], water: [I.WATER_RUNE], earth: [I.EARTH_RUNE], fire: [I.FIRE_RUNE],
  lava: [I.FIRE_RUNE, I.EARTH_RUNE], mud: [I.WATER_RUNE, I.EARTH_RUNE], steam: [I.FIRE_RUNE, I.WATER_RUNE],
  smoke: [I.FIRE_RUNE, I.AIR_RUNE], mist: [I.WATER_RUNE, I.AIR_RUNE], dust: [I.AIR_RUNE, I.EARTH_RUNE],
};

function runesOf(item) {
  const request = { player: fakePlayer(item.id) };
  emit("elemental-staves:runes", request);
  return request.runes;
}

test("every elemental, combination battlestaff and mystic staff supplies its runes and only those", () => {
  const pattern = /^(?:(Air|Water|Earth|Fire|Lava|Mud|Steam|Smoke|Mist|Dust) battlestaff|Mystic (air|water|earth|fire|lava|mud|steam|smoke|mist|dust) staff|Staff of (air|water|earth|fire))$/i;
  let checked = 0;
  for (const item of rows) {
    const match = !item.noted && item.equipmentType === "WEAPON" ? pattern.exec(item.name ?? "") : null;
    if (!match) continue;
    const element = (match[1] ?? match[2] ?? match[3]).toLowerCase();
    assert.deepEqual([...runesOf(item)].sort(), [...SUPPLIED[element]].sort(), `${item.name} (${item.id})`);
    checked++;
  }
  assert.ok(checked >= 25, `checked ${checked} staves`);
  assert.deepEqual(runesOf({ id: I.BATTLESTAFF }), [], "the plain battlestaff supplies nothing");
});

test("no plain staff, mystic staff, wand or powered staff has a special attack", () => {
  const plain = rows.filter(
    (item) =>
      !item.noted && item.equipmentType === "WEAPON" &&
      /battlestaff$|^Mystic \w+ staff$|^Staff of (air|water|earth|fire)$|\bwand$|^Trident of the|^(Holy )?Sanguinesti staff|^Tumeken's shadow/i.test(item.name ?? "") &&
      !/Noose|Elder/.test(item.name),
  );
  assert.ok(plain.length > 40);
  for (const item of plain) {
    assert.equal(CombatSpecial.getForWeaponId(item.id) ?? undefined, undefined, `${item.name} (${item.id}) has no special`);
  }
});

test("every wand uses the staff styles: Bash trains Attack, Pound Strength, Focus Defence", () => {
  const wands = rows.filter(
    (item) => !item.noted && item.equipmentType === "WEAPON" && /\bwand\b/i.test(item.name ?? "") && !/Noose|Elder/.test(item.name),
  );
  assert.ok(wands.length >= 8);
  for (const wand of wands) assert.equal(wand.weaponInterface, "STAFF", `${wand.name} (${wand.id})`);
  const styles = WeaponInterfaces.STAFF.getFightType();
  assert.deepEqual(styles, [FightType.STAFF_BASH, FightType.STAFF_POUND, FightType.STAFF_FOCUS]);
  assert.deepEqual(styles.map((style) => style.getStyle()), [FightStyle.ACCURATE, FightStyle.AGGRESSIVE, FightStyle.DEFENSIVE]);
});

test("wands swing every 4 ticks, mystic staves every 5 and the staff of the dead every 4", () => {
  const wielding = (itemId, weaponInterface) => {
    const items = [];
    items[Equipment.WEAPON_SLOT] = { getId: () => itemId, getDefinition: () => ItemDefinition.forId(itemId) };
    return { getEquipment: () => ({ getItems: () => items }), getWeapon: () => weaponInterface, getFightType: () => null };
  };
  for (const wand of [I.KODAI_WAND, I.KODAI_WAND_3, I.MASTER_WAND, I.MASTER_WAND_3, I.TEACHER_WAND, I.APPRENTICE_WAND, I.APPRENTICE_WAND_3, I.BEGINNER_WAND, I.BEGINNER_WAND_3, I.DRAGON_HUNTER_WAND, I._3RD_AGE_WAND]) {
    assert.equal(WeaponProfiles.attackSpeed(wielding(wand, WeaponInterfaces.STAFF), 5), 4, `wand ${wand}`);
  }
  assert.equal(WeaponProfiles.attackSpeed(wielding(I.MYSTIC_FIRE_STAFF, WeaponInterfaces.STAFF), 5), 5);
  assert.equal(WeaponProfiles.attackSpeed(wielding(I.STAFF_OF_THE_DEAD, WeaponInterfaces.BLADED_STAFF), 4), 4);
});
