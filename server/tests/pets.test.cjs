// Run after `yarn build`: node --test tests/pets.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();

const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");

const events = new Map();
const broadcasts = [];
const loginHooks = [];
const logoutHooks = [];
const deathHooks = [];
const collectionLogObtains = [];
const prompts = [];
const npcApi = {};
const world = {
  sendMessage: (message) => broadcasts.push(message),
  getNpcs: () => npcApi,
  getAddNPCQueue: () => npcApi.addQueue,
  getRemoveNPCQueue: () => npcApi.removeQueue,
};
npcApi.add = () => false;
npcApi.get = () => null;
npcApi.addQueue = [];
npcApi.removeQueue = [];
npcApi.npcs = [];
npcApi[Symbol.iterator] = function* () {
  yield* this.npcs;
};

const Pets = require("../plugins/npcs/Pets.plugin");
Pets.register({
  core: { ItemIdentifiers, NpcIdentifiers, ItemDefinition },
  getWorld: () => world,
  getRegionManager: () => ({ blocked: () => true }),
  getItemOnGroundManager: () => ({ registerNonGlobal() {}, registerLocation() {} }),
  persistAttribute() {},
  onCustomEvent: (name, handler) => events.set(name, handler),
  emitCustomEvent: (name, request) => { if (name === "collection-log:obtain") collectionLogObtains.push(request); },
  onItemDropPolicy() {},
  onItemOnNpc() {},
  onAnyNpcInteraction() {},
  onNpcClick() {},
  onPlayerLogout: (handler) => logoutHooks.push(handler),
  onPlayerDisconnect() {},
  onPlayerLogin: (handler) => loginHooks.push(handler),
  onPlayerDeath: (handler) => deathHooks.push(handler),
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    prompts.push({ player, title, pairs });
    return true;
  },
  log() {},
});

const GIANT_SQUIRREL = 20659;
const AIR_RIFT_GUARDIAN = 20667;
const BLOOD_RIFT_GUARDIAN = 20691;
const HELLPUPPY = 13247;
const SNAKELING_ITEM = 12921;

/** A player whose follower is already out, so awards land in the backpack. */
function createPlayer({ level = 99, xp = 13034431 } = {}) {
  const attributes = new Map([["pets:current", { isRegistered: () => true, getId: () => -1 }]]);
  const inventory = [];
  const messages = [];
  return {
    messages,
    inventory,
    getUsername: () => "Tester",
    getIndex: () => 1,
    isPlayerBot: () => false,
    getHitpoints: () => 99,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({ getMaxLevel: () => level, getExperience: () => xp }),
    getInventory: () => ({
      isFull: () => inventory.length >= 28,
      adds: (itemId) => inventory.push(itemId),
      deleteNumber: (itemId, amount) => {
        for (let i = 0; i < amount; i++) inventory.splice(inventory.indexOf(itemId), 1);
      },
      contains: (itemId) => inventory.includes(itemId),
    }),
    getBanks: () => [],
    getBank: () => ({ adds: () => true, contains: () => false }),
    getPacketSender: () => ({
      sendConfig() {},
      sendSoundEffect() {},
    }),
    getArea: () => null,
    getPrivateArea: () => null,
    outterTiles: () => [new Location(1, 1, 0)],
    getLocation: () => new Location(0, 0, 0),
    setPositionToFace() {},
    performAnimation() {},
    getMovementQueue: () => ({ reset() {} }),
    sendMessage: (message) => messages.push(message),
  };
}

function createPetNpc(player, npcId) {
  return {
    id: npcId,
    transformed: undefined,
    isRegistered: () => true,
    isPet: () => true,
    getId() {
      return this.transformed ?? this.id;
    },
    getRealId() {
      return this.id;
    },
    getIndex: () => 7,
    getOwner: () => player,
    getLocation: () => new Location(0, 0, 0),
    getDefinition: () => ({ getName: () => "pet" }),
    setNpcTransformationId(id) {
      this.transformed = id;
    },
  };
}

const realRandom = Math.random;
beforeEach(() => {
  Math.random = realRandom;
  broadcasts.length = 0;
  collectionLogObtains.length = 0;
  prompts.length = 0;
  npcApi.npcs.length = 0;
  npcApi.addQueue.length = 0;
  npcApi.removeQueue.length = 0;
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

test("every owned pet reaches the collection log; only the new one announces itself", () => {
  const player = createPlayer();
  player.setAttribute("pets.owned", [HELLPUPPY, GIANT_SQUIRREL]);
  events.get("npc-drops:roll")({ player, drops: [{ id: 12921, amount: 1 }] });
  assert.deepEqual(collectionLogObtains.map(({ itemId, ensure, silent }) => [itemId, ensure, silent]), [
    [HELLPUPPY, true, false],
    [GIANT_SQUIRREL, true, false],
    [SNAKELING_ITEM, true, false],
  ]);
  assert.ok(collectionLogObtains.every((request) => request.player === player));
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

test("every skilling-pet collection log item has a roll source", () => {
  const log = require("../../client/common/collectionlog/collection-log.json");
  const skilling = log.categories.find((category) => category.structId === 529)?.itemIds ?? [];
  assert.ok(skilling.length > 0, "the Skilling Pets collection log category is empty");
  const rollable = new Set(Pets.__internals.PETS.filter((pet) => pet.skill != null).map((pet) => pet.itemId));
  for (const itemId of skilling) {
    assert.ok(rollable.has(itemId), `collection log item ${itemId} has no skilling roll source`);
  }
});

test("every metamorphosis cycle stays inside the pet's family", () => {
  const { PETS, PET_BY_ID, petFamily } = Pets.__internals;
  for (const pet of PETS) {
    if (pet.morphId === 0) continue;
    const next = PET_BY_ID.get(pet.morphId);
    assert.ok(next, `${pet.enumName} morphs to unknown npc ${pet.morphId}`);
    assert.equal(petFamily(next), petFamily(pet), `${pet.enumName} morphs outside its family`);
  }
});

test("metamorphosis cycles one step and stores the chosen variant", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 2130);
  player.setAttribute("pets:current", npc);

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 2131);
  assert.deepEqual(player.getAttribute("pets:variant"), { "item:12921": 2131 });

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 2132);

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 2130);
  assert.deepEqual(player.getAttribute("pets:variant"), { "item:12921": 2130 });
});

test("a pet with no metamorphosis cycle refuses to morph", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 6717);
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.morph(player, npc), false);
  assert.equal(npc.transformed, undefined);
  assert.equal(player.getAttribute("pets:variant"), undefined);
});

test("the stored variant is re-applied to a freshly summoned follower", () => {
  const player = createPlayer();
  player.setAttribute("pets:variant", { "item:12921": 2132 });
  const pet = Pets.__internals.PET_BY_ITEM_ID.get(SNAKELING_ITEM);
  const npc = createPetNpc(player, 2130);
  Pets.__internals.applyStoredVariant(player, npc, pet);
  assert.equal(npc.transformed, 2132);
});

test("a cross-item morph keeps one ownership record and ticks the base log item", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 7337);
  player.setAttribute("pets:current", npc);
  player.setAttribute("pets.owned", [20665]);
  player.inventory.push(ItemIdentifiers.AIR_TALISMAN);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 7338);
  assert.deepEqual(player.getAttribute("pets:variant"), { "skill:runecrafting": 7338 });
  assert.equal(Pets.__internals.pickup(player, npc), true);
  assert.deepEqual(player.inventory, [ItemIdentifiers.AIR_TALISMAN, 20667]);
  assert.deepEqual(player.getAttribute("pets.owned"), [20667]);
  assert.deepEqual(collectionLogObtains.at(-1)?.itemId, 20665, "the base log item");
});

test("a cached Metamorphosis option dispatches to morph, Talk-to to interact", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 2130);
  player.setAttribute("pets:current", npc);
  const definition = { getActions: () => ["Talk-to", null, "Pick-up", "Metamorphosis", null] };

  assert.equal(Pets.__internals.handlePetClick({ player, npc, npcId: 2130, clickType: 4, definition }), true);
  assert.equal(npc.transformed, 2131);
  assert.equal(Pets.__internals.handlePetClick({ player, npc, npcId: 2130, clickType: 1, definition }), true);
  assert.deepEqual(player.inventory, []);
});

test("a normal logout and login rebuilds exactly one follower from the item", () => {
  const player = createPlayer();
  player.setAttribute("pets:current", undefined);
  player.setAttribute("pets:last", SNAKELING_ITEM);
  player.inventory.push(SNAKELING_ITEM);
  const loggedIn = loginHooks[0]({ player });
  assert.equal(loggedIn, undefined);
  assert.deepEqual(player.inventory, []);
  assert.equal(player.getAttribute("pets:last"), SNAKELING_ITEM);
});

test("pickup keeps the follower when the backpack is full", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 2130);
  player.setAttribute("pets:current", npc);
  for (let i = 0; i < 28; i++) player.inventory.push(995);
  assert.equal(Pets.__internals.pickup(player, npc), true);
  assert.equal(player.getAttribute("pets:current"), npc);
  assert.equal(player.messages.at(-1), "You don't have enough inventory space.");
});

test("an item-gated metamorphosis is denied until its item is used", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 6722); // Heron -> Great blue heron needs spirit flakes
  player.setAttribute("pets:current", npc);

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);
  assert.equal(player.getAttribute("pets:variant"), undefined);
  assert.match(player.messages.at(-1), /spirit flakes/);

  player.inventory.push(ItemIdentifiers.SPIRIT_FLAKES);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 10636);
  assert.deepEqual(player.inventory, []);
  assert.deepEqual(player.getAttribute("pets:morph-unlocks"), ["skill:fishing"]);

  // Back to Heron is free; the permanent unlock lets it re-morph with no flakes.
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 6722);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 10636);
  assert.deepEqual(player.getAttribute("pets:morph-unlocks"), ["skill:fishing"]);
});

test("a completion-gated metamorphosis is denied until the activity is completed", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, NpcIdentifiers.YOUNGLLEF_2);
  player.setAttribute("pets:current", npc);

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);
  assert.match(player.messages.at(-1), /Corrupted Gauntlet/);

  player.setAttribute("gauntlet:stats", { completions: { regular: 0, corrupted: 1 } });
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, NpcIdentifiers.CORRUPTED_YOUNGLLEF_2);
});

test("a phoenix needs the right firelighter and consumes it", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, NpcIdentifiers.PHOENIX_2);
  player.setAttribute("pets:current", npc);

  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);
  assert.match(player.messages.at(-1), /blue firelighter/);

  player.inventory.push(ItemIdentifiers.BLUE_FIRELIGHTER);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, NpcIdentifiers.PHOENIX_7);
  assert.deepEqual(player.inventory, []);

  player.inventory.push(ItemIdentifiers.PURPLE_FIRELIGHTER);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, NpcIdentifiers.PHOENIX_7);
  assert.match(player.messages.at(-1), /green firelighter/);
});

test("Bran and Ric are free metamorphosis forms", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, NpcIdentifiers.BRAN_2);
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 12595);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, NpcIdentifiers.BRAN_2);
});

test("the Little nightmare needs a parasitic egg for its Parasite form", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, NpcIdentifiers.LITTLE_NIGHTMARE_2);
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);
  assert.match(player.messages.at(-1), /parasitic egg/);

  player.inventory.push(ItemIdentifiers.PARASITIC_EGG);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, NpcIdentifiers.LITTLE_PARASITE_2);
  assert.deepEqual(player.inventory, []);
});

test("Gull must be fed 50 fish before it metamorphoses into Gulliver", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, NpcIdentifiers.GULL_7);
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);
  assert.match(player.messages.at(-1), /feed Gull 50/);

  for (let i = 0; i < 50; i++) {
    player.inventory.push(ItemIdentifiers.RAW_SARDINE);
    Pets.__internals.handleGullFeed({ player, target: npc, itemId: ItemIdentifiers.RAW_SARDINE });
  }
  assert.equal(player.getAttribute("pets:gull-fed"), 50);
  assert.deepEqual(player.inventory, []);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 14932);
});

test("Noon and Midnight metamorphose across items under one ownership record", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 7892);
  player.setAttribute("pets:current", npc);
  player.setAttribute("pets.owned", [21748]);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 7893);
  assert.deepEqual(player.getAttribute("pets:variant"), { "group:noon": 7893 });
  assert.equal(Pets.__internals.pickup(player, npc), true);
  assert.deepEqual(player.inventory, [21750]);
  assert.deepEqual(player.getAttribute("pets.owned"), [21750]);
});

test("the Baby mole-rat needs both mole parts", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 6635);
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);
  assert.match(player.messages.at(-1), /mole claw and mole skin/);

  player.inventory.push(ItemIdentifiers.MOLE_CLAW);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);

  player.inventory.push(ItemIdentifiers.MOLE_SKIN);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 10651);
  assert.deepEqual(player.inventory, []);
});

test("the Rift guardian needs its talisman, which is not consumed", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 7337);
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, undefined);
  assert.match(player.messages.at(-1), /air talisman/);

  player.inventory.push(ItemIdentifiers.AIR_TALISMAN);
  assert.equal(Pets.__internals.morph(player, npc), true);
  assert.equal(npc.transformed, 7338);
  assert.deepEqual(player.inventory, [ItemIdentifiers.AIR_TALISMAN]);
});

test("the Chompy chick waits for the Western Provinces elite diary flag", () => {
  const player = createPlayer();
  events.get("npc-drops:roll")({ player, drops: [{ itemId: 13071, amount: 1 }] });
  assert.deepEqual(player.inventory, []);
  assert.equal(player.getAttribute("pets.owned"), undefined);

  player.setAttribute("achievement-diary:western-provinces:elite", true);
  events.get("npc-drops:roll")({ player, drops: [{ itemId: 13071, amount: 1 }] });
  assert.deepEqual(player.inventory, [13071]);
});

test("a kitten grows into an adult cat when its growth counter fills", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 5591);
  player.setAttribute("pets:current", npc);
  const pet = Pets.__internals.PET_BY_ID.get(5591);
  Pets.__internals.trackCatFollower(player, npc, pet);
  const state = player.getAttribute("pets:cat");
  assert.equal(state.stage, "kitten");
  state.growth = 119;
  assert.equal(Pets.__internals.catTick(player), true);
  const grown = player.getAttribute("pets:current");
  assert.equal(grown.getId(), 1619);
  assert.equal(player.getAttribute("pets:last"), 1561);
  assert.equal(player.getAttribute("pets:cat").stage, "cat");
  assert.equal(player.messages.at(-1), "Your kitten has grown into a cat.");
});

test("feeding resets hunger and milk reverts a hell-kitten to its colour", () => {
  const player = createPlayer();
  const kittenNpc = createPetNpc(player, 5591);
  player.setAttribute("pets:current", kittenNpc);
  Pets.__internals.trackCatFollower(player, kittenNpc, Pets.__internals.PET_BY_ID.get(5591));
  const state = player.getAttribute("pets:cat");
  state.hungerStage = 2;
  player.inventory.push(ItemIdentifiers.RAW_SARDINE);
  Pets.__internals.handleItemOnCat({ player, target: kittenNpc, itemId: ItemIdentifiers.RAW_SARDINE });
  assert.equal(state.hungerStage, 0);
  assert.deepEqual(player.inventory, []);
  assert.match(player.messages.at(-1), /eats the raw sardine/);

  const hellNpc = createPetNpc(player, 5597);
  player.setAttribute("pets:current", hellNpc);
  Pets.__internals.trackCatFollower(player, hellNpc, Pets.__internals.PET_BY_ID.get(5597));
  player.setAttribute("pets:cat", { stage: "hellkitten", colour: 2, growth: 3, hungerAt: 0, attentionAt: 0 });
  player.inventory.push(ItemIdentifiers.BUCKET_OF_MILK);
  Pets.__internals.handleItemOnCat({ player, target: hellNpc, itemId: ItemIdentifiers.BUCKET_OF_MILK });
  const reverted = player.getAttribute("pets:current");
  assert.equal(reverted.getId(), 5593);
  assert.equal(player.getAttribute("pets:cat").stage, "kitten");
  assert.deepEqual(player.inventory, [ItemIdentifiers.BUCKET]);
  assert.equal(player.messages.at(-1), "Your cat returns to its original colour.");
});

test("the cat Interact menu strokes, guesses age and shoos away", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 1619);
  player.setAttribute("pets:current", npc);
  Pets.__internals.trackCatFollower(player, npc, Pets.__internals.PET_BY_ID.get(1619));

  assert.equal(Pets.__internals.interact(player, npc), true);
  const prompt = prompts.at(-1);
  assert.equal(prompt.title, "Interact");
  assert.deepEqual(prompt.pairs.filter((_, index) => index % 2 === 0), ["Stroke", "Chase vermin", "Guess age", "Shoo away"]);

  const stroke = prompt.pairs[1];
  stroke(player);
  assert.ok(player.getAttribute("pets:cat").attentionAt > Date.now());
  assert.match(player.messages.at(-1), /stroke the cat/);

  const guess = prompt.pairs[5];
  guess(player);
  assert.match(player.messages.at(-1), /become overgrown in about/);

  const shoo = prompt.pairs[7];
  shoo(player);
  assert.equal(player.getAttribute("pets:current"), null);
  assert.equal(player.getAttribute("pets:cat"), null);
  assert.equal(player.messages.at(-1), "You shoo your pet away.");
});

test("chasing vermin catches a rat and a hell-rat makes a hell-kitten", () => {
  const player = createPlayer();
  const kitten = createPetNpc(player, 5591);
  player.setAttribute("pets:current", kitten);
  Pets.__internals.trackCatFollower(player, kitten, Pets.__internals.PET_BY_ID.get(5591));

  const rat = {
    isRegistered: () => true,
    getLocation: () => new Location(1, 0, 0),
    getDefinition: () => ({ getName: () => "Rat" }),
  };
  npcApi.npcs.push(rat);
  Math.random = () => 0;
  assert.equal(Pets.__internals.chaseVermin(player, kitten, Pets.__internals.PET_BY_ID.get(5591)), true);
  assert.ok(npcApi.removeQueue.includes(rat));
  assert.match(player.messages.at(-1), /catches the rat/);

  const hellRat = {
    isRegistered: () => true,
    getLocation: () => new Location(1, 0, 0),
    getDefinition: () => ({ getName: () => "Hell-Rat" }),
  };
  npcApi.npcs.length = 0;
  npcApi.npcs.push(hellRat);
  assert.equal(Pets.__internals.chaseVermin(player, kitten, Pets.__internals.PET_BY_ID.get(5591)), true);
  assert.equal(player.getAttribute("pets:current").getId(), 5597);
  assert.equal(player.getAttribute("pets:cat").stage, "hellkitten");
  assert.equal(player.getAttribute("pets:last"), 7583);
});

test("a generic pet runs off when its owner dies", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 1619);
  player.setAttribute("pets:current", npc);
  deathHooks[0]({ player });
  assert.equal(player.getAttribute("pets:current"), null);
  assert.equal(player.getAttribute("pets:cat"), null);
  assert.equal(player.messages.at(-1), "Your pet runs off.");
});

test("a pet without transcripts consumes Interact without inventing dialogue", () => {
  const player = createPlayer();
  const npc = createPetNpc(player, 318); // Dark core: dialogue id 123, no transcript in the dump
  player.setAttribute("pets:current", npc);
  assert.equal(Pets.__internals.interact(player, npc), true);
  assert.deepEqual(player.messages, []);
  assert.equal(prompts.length, 0);
  assert.equal(player.getAttribute("pets:current"), npc);
});

test("no shop sells pet items", () => {
  const shops = require("../data/definitions/custom-shops.json");
  const petItems = new Set(Pets.__internals.PETS.map((pet) => pet.itemId));
  for (const shop of shops) {
    const items = Array.isArray(shop.items) ? shop.items : [];
    for (const itemId of items) {
      assert.ok(!petItems.has(itemId), `${shop.name} still sells pet item ${itemId}`);
    }
  }
});
