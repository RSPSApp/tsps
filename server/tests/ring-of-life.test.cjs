// Run after `yarn build`: node --test tests/ring-of-life.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");

const { Player } = require("../dist/game/entity/impl/player/Player");
const RingOfLife = require("../plugins/items/RingOfLife.plugin");

const teleports = [];
const prompts = [];
const customHandlers = {};
let ardougneMedium = false;
/** Whether teleports are allowed where the player is (a minigame refuses them). */
let teleportsAllowed = true;
RingOfLife.register({
  core: {
    ItemIdentifiers: ItemIds,
    GameConstants: { DEFAULT_LOCATION: { getX: () => 3222, getY: () => 3218, getZ: () => 0 } },
    TeleportHandler: {
      checkReqs: () => teleportsAllowed,
      teleport: (player, destination, type, warning) => teleports.push({ player, destination, type, warning }),
    },
    TeleportType: { NORMAL: "NORMAL" },
    Location: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } getX() { return this.x; } getY() { return this.y; } getZ() { return this.z; } },
  },
  registerIncomingDamageModifier() {},
  persistAttribute() {},
  onCustomEvent(name, handler) { customHandlers[name] = handler; },
  onItemAction() {},
  sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.push({ player, title, pairs }),
  // The Skillcapes plugin answers this; a worn Defence cape is all these tests need.
  emitCustomEvent(name, request) {
    if (name === "phoenix-necklace:will-trigger") {
      request.active = request.player.phoenix === true && request.remaining <= 20;
    }
    if (name === "diary:is-complete" && request.diary === "ardougne" && request.tier === "medium") request.complete = ardougneMedium;
    if (name === "ring-of-life:can-escape") request.allowed = request.player.mayEscape === true;
    if (name === "skillcape:ring-of-life") {
      request.active = request.player.getEquipment().get(Equipment.CAPE_SLOT)?.getId() === ItemIds.DEFENCE_CAPE;
    }
  },
});

function createPlayer({ hp = 100, max = 100, ring = -1, cape = -1, teleblocked = false } = {}) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  const deleted = [];
  const messages = [];
  if (ring > 0) equipment[Equipment.RING_SLOT] = { getId: () => ring };
  if (cape > 0) equipment[Equipment.CAPE_SLOT] = { getId: () => cape };
  const player = {
    messages,
    deleted,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({
      get: (slot) => equipment[slot],
      deleteNumber: (id, amount) => deleted.push([id, amount]),
      refreshItems: () => {},
    }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.HITPOINTS ? hp : 99),
      getMaxLevel: (skill) => (skill === Skill.HITPOINTS ? max : 99),
    }),
    getCombat: () => ({ getTeleblockTimer: () => ({ finished: () => !teleblocked }) }),
    sendMessage: (message) => messages.push(message),
    attributes: new Map(),
    getAttribute(key) { return this.attributes.get(key); },
    setAttribute(key, value) { this.attributes.set(key, value); },
  };
  return player;
}

test("a hit leaving 10% HP procs the ring and destroys it", () => {
  teleports.length = 0;
  const player = createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE });
  RingOfLife._test.onIncomingDamage(player, { getDamage: () => 95 });
  assert.equal(teleports.length, 1);
  assert.deepEqual(player.deleted, [[ItemIds.RING_OF_LIFE, 1]]);
  assert.equal(player.messages[0], "Your ring of life saves you and is destroyed in the process.");
});

test("where teleports are refused the ring works only if content allows it (ring-of-life:can-escape)", () => {
  teleports.length = 0;
  teleportsAllowed = false;
  try {
    const stuck = createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE });
    RingOfLife._test.onIncomingDamage(stuck, { getDamage: () => 95 });
    assert.deepEqual([teleports.length, stuck.deleted], [0, []], "a minigame's refusal stands");
    const allowed = createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE });
    allowed.mayEscape = true;
    RingOfLife._test.onIncomingDamage(allowed, { getDamage: () => 95 });
    assert.deepEqual([teleports.length, allowed.deleted], [1, [[ItemIds.RING_OF_LIFE, 1]]]);
  } finally {
    teleportsAllowed = true;
  }
});

test("the ring does not save a lethal hit or a hit above the 10% threshold", () => {
  teleports.length = 0;
  RingOfLife._test.onIncomingDamage(createPlayer({ hp: 15, ring: ItemIds.RING_OF_LIFE }), { getDamage: () => 15 });
  assert.equal(teleports.length, 0, "a hit to zero is not saved");
  RingOfLife._test.onIncomingDamage(createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE }), { getDamage: () => 89 });
  assert.equal(teleports.length, 0, "89 damage leaves 11 HP, above 10%");
  RingOfLife._test.onIncomingDamage(createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE }), { getDamage: () => 90 });
  assert.equal(teleports.length, 1, "exactly 10 HP procs");
});

test("a Defence cape saves without being destroyed, and Tele Block stops both", () => {
  teleports.length = 0;
  const caped = createPlayer({ hp: 100, cape: ItemIds.DEFENCE_CAPE });
  RingOfLife._test.onIncomingDamage(caped, { getDamage: () => 95 });
  assert.equal(teleports.length, 1);
  assert.equal(caped.deleted.length, 0);
  assert.match(caped.messages[0], /Defence cape saves you/);

  RingOfLife._test.onIncomingDamage(
    createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE, teleblocked: true }),
    { getDamage: () => 95 }
  );
  assert.equal(teleports.length, 1, "a teleblocked ring does not activate");
});

test("a phoenix necklace that will heal the wearer leaves the ring of life alone", () => {
  teleports.length = 0;
  const player = createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE });
  player.phoenix = true;
  RingOfLife._test.onIncomingDamage(player, { getDamage: () => 95 });
  assert.equal(teleports.length, 0);
  assert.equal(player.deleted.length, 0);
});

test("Toggle-respawn: after the medium Ardougne Diary the ring takes its wearer to East Ardougne (Wiki)", () => {
  const player = createPlayer({ hp: 100, ring: ItemIds.RING_OF_LIFE });
  const toggle = () => RingOfLife._test.toggleRespawn({ player, itemId: ItemIds.RING_OF_LIFE, handled: false });
  ardougneMedium = false;
  prompts.length = 0;
  toggle();
  assert.equal(prompts.length, 0, "refused before the diary");
  assert.match(player.messages.at(-1), /medium Ardougne Diary/);
  ardougneMedium = true;
  toggle();
  const [label, choose] = prompts[0].pairs;
  assert.equal(label, "Ardougne");
  choose();
  teleports.length = 0;
  RingOfLife._test.onIncomingDamage(player, { getDamage: () => 95 });
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], RingOfLife._test.ARDOUGNE_MARKET.slice(0, 2));
});

test("Wintertodt asks for the ring when warmth drops below 10%: the ring is destroyed and the player teleports", () => {
  teleports.length = 0;
  const player = createPlayer({ hp: 99, ring: ItemIds.RING_OF_LIFE });
  const request = { player, activated: false };
  customHandlers["ring-of-life:activate"](request);
  assert.equal(request.activated, true);
  assert.equal(teleports.length, 1);
  assert.deepEqual(player.deleted, [[ItemIds.RING_OF_LIFE, 1]]);

  const bare = { player: createPlayer({ hp: 99 }), activated: false };
  customHandlers["ring-of-life:activate"](bare);
  assert.equal(bare.activated, false, "nothing worn saves nobody");
  const blocked = { player: createPlayer({ hp: 99, ring: ItemIds.RING_OF_LIFE, teleblocked: true }), activated: false };
  customHandlers["ring-of-life:activate"](blocked);
  assert.equal(blocked.activated, false, "Tele Block stops it");
  assert.equal(teleports.length, 1);
});

test("Toggle-respawn: each choice says where the ring now takes its wearer (live's lines)", () => {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  const messages = [];
  player.sendMessage = (text) => messages.push(text);
  ardougneMedium = true;
  const choose = (label) => {
    prompts.length = 0;
    RingOfLife._test.toggleRespawn({ player, itemId: ItemIds.RING_OF_LIFE, handled: false });
    const pairs = prompts[0].pairs;
    pairs[pairs.indexOf(label) + 1]();
    return messages.at(-1);
  };
  assert.equal(choose("Ardougne"), "<col=dc143c>Your respawn location has now been changed to Ardougne.</col>");
  assert.equal(player.getAttribute(RingOfLife._test.ARDOUGNE_ATTRIBUTE), true);
  assert.equal(choose("Ardougne"), "Your respawn location has been left as Ardougne.");
  assert.equal(choose("Default"), "<col=dc143c>Your respawn location has now been changed to the default.</col>");
  assert.equal(player.getAttribute(RingOfLife._test.ARDOUGNE_ATTRIBUTE), false);
  assert.equal(choose("Default"), "Your respawn location has been left as the default.");
  assert.equal(messages.length, 4, "one line per choice");
});
