// Run after `yarn build`: node --test tests/pets.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");

const events = new Map();
const broadcasts = [];
const Pets = require("../plugins/npcs/Pets.plugin");
Pets.register({
  core: { ItemIdentifiers, NpcIdentifiers },
  getWorld: () => ({ sendMessage: (message) => broadcasts.push(message) }),
  getRegionManager: () => ({}),
  getItemOnGroundManager: () => ({}),
  persistAttribute() {},
  onCustomEvent: (name, handler) => events.set(name, handler),
  onItemDropPolicy() {},
  onAnyNpcInteraction() {},
  onNpcFirstClick() {},
  onNpcSecondClick() {},
  onNpcThirdClick() {},
  onPlayerLogout() {},
  onPlayerDisconnect() {},
  onPlayerLogin() {},
  log() {},
});

const GIANT_SQUIRREL = 20659;
const AIR_RIFT_GUARDIAN = 20667;
const BLOOD_RIFT_GUARDIAN = 20691;
const HELLPUPPY = 13247;

/** A player whose follower is already out, so awards land in the backpack. */
function createPlayer({ level = 99, xp = 13034431 } = {}) {
  const attributes = new Map([["pets:current", { isRegistered: () => true, getId: () => -1 }]]);
  const inventory = [];
  const messages = [];
  return {
    messages,
    inventory,
    getUsername: () => "Tester",
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({ getMaxLevel: () => level, getExperience: () => xp }),
    getInventory: () => ({
      isFull: () => inventory.length >= 28,
      adds: (itemId) => inventory.push(itemId),
      contains: (itemId) => inventory.includes(itemId),
    }),
    getBanks: () => [],
    sendMessage: (message) => messages.push(message),
  };
}

const realRandom = Math.random;
beforeEach(() => {
  Math.random = realRandom;
  broadcasts.length = 0;
});

test("agility rolls the giant squirrel at 1 in (base - level * 25)", () => {
  const player = createPlayer({ level: 99 });
  let seen;
  Math.random = () => { seen = true; return 1 / (35609 - 99 * 25) - 1e-9; };
  events.get("agility:success")({ player, skill: Skill.AGILITY, petBase: 35609 });
  assert.ok(seen);
  assert.deepEqual(player.inventory, [GIANT_SQUIRREL]);
  assert.match(broadcasts[0], /Giant Squirrel while agility/i);

  Math.random = () => 1 / (35609 - 99 * 25);
  events.get("agility:success")({ player: createPlayer(), skill: Skill.AGILITY, petBase: 35609 });
  assert.equal(broadcasts.length, 1);
});

test("an action without a rate never rolls", () => {
  const player = createPlayer();
  Math.random = () => 0;
  events.get("hunter:success")({ player, skill: Skill.HUNTER, npcId: -1 });
  assert.deepEqual(player.inventory, []);
});

test("the rift guardian takes the colour of the rune crafted and rolls per essence", () => {
  const player = createPlayer();
  let rolls = 0;
  Math.random = () => (++rolls === 3 ? 0 : 1);
  events.get("runecrafting:success")({
    player,
    skill: Skill.RUNECRAFTING,
    petBase: 1795758,
    rolls: 3,
    runeId: ItemIdentifiers.AIR_RUNE,
  });
  assert.equal(rolls, 3);
  assert.deepEqual(player.inventory, [AIR_RIFT_GUARDIAN]);
});

test("a second pet of the same skill is a would-have-been-followed miss", () => {
  const player = createPlayer();
  Math.random = () => 0;
  events.get("runecrafting:success")({ player, skill: Skill.RUNECRAFTING, petBase: 1795758, runeId: ItemIdentifiers.AIR_RUNE });
  events.get("runecrafting:success")({ player, skill: Skill.RUNECRAFTING, petBase: 804984, runeId: ItemIdentifiers.BLOOD_RUNE });
  assert.deepEqual(player.inventory, [AIR_RIFT_GUARDIAN]);
  assert.ok(!player.inventory.includes(BLOOD_RIFT_GUARDIAN));
  assert.equal(player.messages.at(-1), "You have a funny feeling like you would have been followed...");
});

test("a boss pet drop goes to the killer, not the floor", () => {
  const player = createPlayer();
  const drops = [{ itemId: ItemIdentifiers.BONES, amount: 1 }, { itemId: HELLPUPPY, amount: 1 }];
  events.get("npc-drops:roll")({ player, drops });
  assert.deepEqual(drops.map((drop) => drop.itemId), [ItemIdentifiers.BONES]);
  assert.deepEqual(player.inventory, [HELLPUPPY]);
  assert.deepEqual(player.getAttribute("pets.owned"), [HELLPUPPY]);
});

test("Probita returns owned pets the player no longer has, once", () => {
  const player = createPlayer();
  player.setAttribute("pets.owned", [HELLPUPPY, GIANT_SQUIRREL]);
  player.inventory.push(GIANT_SQUIRREL);
  const reclaim = () => {
    const event = { player, npcId: NpcIdentifiers.PROBITA, action: "open_interface", target: "Pet Insurance" };
    events.get("npc-dialogue:action")(event);
    return event;
  };
  assert.equal(reclaim().handled, true);
  assert.deepEqual(player.inventory, [GIANT_SQUIRREL, HELLPUPPY]);
  reclaim();
  assert.deepEqual(player.inventory, [GIANT_SQUIRREL, HELLPUPPY]);
  assert.equal(player.messages.at(-1), "You don't have any pets to reclaim.");
});
