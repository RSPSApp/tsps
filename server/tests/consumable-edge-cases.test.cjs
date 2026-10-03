// Run after `yarn build`: node --test tests/consumable-edge-cases.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const Potions = require("../plugins/items/Potions.plugin");
const { applyPrayerRestore, applySanfewRestore, applyDivine, processDivine, pauseTimedEffects, resumeTimedEffects } = Potions._test;

function createPlayer({ base = 99, current = 1, inventory = [], equipment = [] } = {}) {
  const levels = new Map(Skill.values().map((skill) => [skill, current]));
  const attributes = new Map();
  const player = {
    levels,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({ contains: (id) => inventory.includes(id) }),
    getEquipment: () => ({ contains: (id) => equipment.includes(id) }),
    getPacketSender: () => ({ sendSound() { return this; } }),
    getSession: () => ({ sendClientPacket() {} }),
    setHitpoints(value) { levels.set(Skill.HITPOINTS, value); },
    sendMessage() {},
    getSkillManager: () => ({
      getMaxLevel: () => base,
      getCurrentLevel: (skill) => levels.get(skill),
      setCurrentLevels: (skill, level) => levels.set(skill, level),
      increaseCurrentLevel: (skill, amount, max) => levels.set(skill, Math.min(max, levels.get(skill) + amount)),
    }),
  };
  return player;
}

test("prayer potions restore 7 + 25%, or 27% with a holy wrench or worn prayer cape", () => {
  const plain = createPlayer();
  applyPrayerRestore(plain, false);
  assert.equal(plain.levels.get(Skill.PRAYER), 1 + 7 + 24);
  const wrench = createPlayer({ inventory: [ItemIdentifiers.HOLY_WRENCH] });
  applyPrayerRestore(wrench, false);
  assert.equal(wrench.levels.get(Skill.PRAYER), 1 + 7 + 26);
  const cape = createPlayer({ equipment: [ItemIdentifiers.PRAYER_CAPE] });
  applyPrayerRestore(cape, true);
  assert.equal(cape.levels.get(Skill.PRAYER), 1 + 8 + 26);
});

test("a Sanfew dose restores 4 + 30% (prayer 32% with the bonus)", () => {
  const player = createPlayer({ equipment: [ItemIdentifiers.RING_OF_THE_GODS_I_] });
  applySanfewRestore(player);
  assert.equal(player.levels.get(Skill.ATTACK), 1 + 4 + 29);
  assert.equal(player.levels.get(Skill.PRAYER), 1 + 4 + 31);
});

test("a divine potion's timer pauses while logged out and the state survives a save", () => {
  const player = createPlayer({ current: 99 });
  applyDivine(player, (p) => p.levels.set(Skill.ATTACK, 118), [Skill.ATTACK]);
  const state = player.getAttribute("potions:divine:state");
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state, "the state is JSON so it can be persisted");
  const remaining = state.endsAt - Date.now();
  pauseTimedEffects({ player });
  player.setAttribute("potions:paused-at", Date.now() - 60 * 60 * 1000);
  resumeTimedEffects({ player });
  const resumed = player.getAttribute("potions:divine:state");
  assert.ok(resumed.endsAt - Date.now() >= remaining + 60 * 60 * 1000 - 50);
  player.levels.set(Skill.ATTACK, 105);
  processDivine(player);
  assert.equal(player.levels.get(Skill.ATTACK), 118, "the divine level holds after a relog");
});

const SpellTeleports = require("../plugins/combat/SpellTeleports.plugin");
const teleports = [];
/** Stands in for Construction's "construction:house-tablet" answer. */
let ownsHouse = true;
const HOUSE_PORTAL = new (require("../dist/game/model/Location").Location)(2953, 3224, 0);
function houseTablet(request) {
  if (!ownsHouse) return;
  request.destination = HOUSE_PORTAL;
  request.onArrival = request.option === "outside" ? null : () => "entered";
}
let allowTeleport = true;
let breakTablet;
SpellTeleports.register({
  core: {
    ItemDefinition: { forId: (id) => ({ getName: () => (id === ItemIdentifiers.VARROCK_TELEPORT ? "Varrock teleport" : "Teleport to house") }) },
    TeleportHandler: {
      checkReqs: () => allowTeleport,
      teleport: (player, destination, type, warning, onArrival) => teleports.push({ destination, type, onArrival }),
    },
    TeleportType: { TELE_TAB: "TELE_TAB" },
  },
  onItemAction: (handler) => { breakTablet = handler; },
  emitCustomEvent: (name, request) => houseTablet(request),
  onInterfaceActionClick() {},
});

function tabletHolder(count) {
  const items = new Array(count).fill(ItemIdentifiers.VARROCK_TELEPORT);
  return {
    items,
    getInventory: () => ({
      contains: (id) => items.includes(id),
      deleteNumber: (id) => items.splice(items.indexOf(id), 1),
    }),
  };
}

test("breaking a tablet teleports to its spell's destination and uses one tablet", () => {
  teleports.length = 0;
  allowTeleport = true;
  const player = tabletHolder(2);
  const event = { player, itemId: ItemIdentifiers.VARROCK_TELEPORT, option: "Break", handled: false };
  breakTablet(event);
  assert.equal(event.handled, true);
  assert.equal(player.items.length, 1);
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], [3213, 3424]);
  assert.equal(teleports[0].type, "TELE_TAB");
});

test("a refused tablet (teleblock, deep Wilderness, busy) is not used up", () => {
  teleports.length = 0;
  allowTeleport = false;
  const player = tabletHolder(1);
  breakTablet({ player, itemId: ItemIdentifiers.VARROCK_TELEPORT, option: "Break", handled: false });
  assert.equal(player.items.length, 1);
  assert.equal(teleports.length, 0);
});

function houseTabletHolder() {
  const items = [ItemIdentifiers.TELEPORT_TO_HOUSE];
  return {
    items,
    getInventory: () => ({
      contains: (id) => items.includes(id),
      deleteNumber: (id) => items.splice(items.indexOf(id), 1),
    }),
  };
}

test("a house tablet without a house is refused and kept", () => {
  teleports.length = 0;
  allowTeleport = true;
  ownsHouse = false;
  const player = houseTabletHolder();
  const event = { player, itemId: ItemIdentifiers.TELEPORT_TO_HOUSE, option: "Break", handled: false };
  breakTablet(event);
  assert.equal(event.handled, true);
  assert.equal(player.items.length, 1);
  assert.equal(teleports.length, 0);
});

test("a house tablet goes to the house portal and enters unless Outside was chosen", () => {
  teleports.length = 0;
  allowTeleport = true;
  ownsHouse = true;
  for (const option of ["Break", "Inside", "Outside"]) {
    breakTablet({ player: houseTabletHolder(), itemId: ItemIdentifiers.TELEPORT_TO_HOUSE, option, handled: false });
  }
  assert.equal(teleports.length, 3);
  assert.ok(teleports.every(({ destination }) => destination === HOUSE_PORTAL));
  assert.deepEqual(teleports.map(({ onArrival }) => onArrival?.() ?? null), ["entered", "entered", null]);
});
