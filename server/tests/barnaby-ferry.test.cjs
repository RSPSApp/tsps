// Run after `yarn build`: node --test tests/barnaby-ferry.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const BarnabyFerry = require("../plugins/world/BarnabyFerry.plugin");

const teleports = [];
const hooks = { interactions: [], conditions: [], events: [], variants: [] };
BarnabyFerry.register({
  core: {
    ItemIdentifiers: ItemIds,
    TeleportHandler: {
      checkReqs: () => true,
      teleport: (player, destination, type) => teleports.push({ destination, type }),
    },
    TeleportType: { NORMAL: "NORMAL" },
  },
  onNpcInteraction: (name, actions) => hooks.interactions.push({ name, actions }),
  onNpcDialogueVariant: (handler) => hooks.variants.push(handler),
  onNpcDialogueCondition: (handler) => hooks.conditions.push(handler),
  onCustomEvent: (name, handler) => hooks.events.push({ name, handler }),
});

function createPlayer({ coins = 100, gloves = 0, ring = 0 } = {}) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (gloves) equipment[Equipment.HANDS_SLOT] = { getId: () => gloves };
  if (ring) equipment[Equipment.RING_SLOT] = { getId: () => ring };
  let balance = coins;
  const messages = [];
  return {
    messages,
    getEquipment: () => ({ get: (slot) => equipment[slot] }),
    getInventory: () => ({
      getAmount: () => balance,
      deleteNumber: (id, amount) => { balance = Math.max(0, balance - amount); },
      refreshItems: () => {},
    }),
    get balance() { return balance; },
    sendMessage: (message) => messages.push(message),
  };
}

const ARDOUGNE = { getLocation: () => ({ getX: () => 2680, getY: () => 3274 }) };
const action = (name) => hooks.interactions.flatMap((entry) => entry.actions[name] ?? [])[0];

test("the ferry costs 30 coins, or 15 with Karamja gloves", () => {
  assert.equal(BarnabyFerry._test.fareFor(createPlayer()), 30);
  assert.equal(BarnabyFerry._test.fareFor(createPlayer({ gloves: ItemIds.KARAMJA_GLOVES_1 })), 15);
  assert.equal(BarnabyFerry._test.fareFor(createPlayer({ gloves: 1234 })), 30);
});

test("the port is found from the captain's tile", () => {
  const brimhaven = { getLocation: () => ({ getX: () => 2768, getY: () => 3227 }) };
  assert.equal(BarnabyFerry._test.currentPort(brimhaven)?.name, "Brimhaven");
  assert.equal(BarnabyFerry._test.currentPort({ getLocation: () => ({ getX: () => 1, getY: () => 1 }) }), null);
});

test("the destination options all sail from the captain's own dock", () => {
  assert.ok(action("Brimhaven"), "the captain's Brimhaven option is hooked");
  assert.ok(action("Rimmington"));
  assert.ok(action("Ardougne"));
});

test("a destination option pays the fare and boards with the wiki line", () => {
  teleports.length = 0;
  const player = createPlayer();
  action("Brimhaven")({ player, npc: ARDOUGNE });
  assert.equal(player.balance, 70);
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].destination.getX(), 2768);
  assert.deepEqual(player.messages, ["You board the ship and sail to Brimhaven."]);

  const broke = createPlayer({ coins: 10 });
  action("Brimhaven")({ player: broke, npc: ARDOUGNE });
  assert.equal(teleports.length, 1, "no crossing without the fare");
  assert.equal(broke.balance, 10);
  assert.deepEqual(broke.messages, ["You don't have enough coins for that fare."]);
});

test("the transcript's sailing steps charge and cross; the charmed ones are free", () => {
  teleports.length = 0;
  const sail = hooks.events.find((entry) => entry.name === "npc-dialogue:action").handler;
  const paid = createPlayer({ coins: 100 });
  sail({ player: paid, kind: "message", stepId: "YLphRs", handled: false });
  assert.equal(paid.balance, 70);
  assert.equal(teleports.length, 1);
  assert.equal(paid.messages.length, 0, "the transcript narrates the crossing itself");

  const charmed = createPlayer({ coins: 100, ring: ItemIds.RING_OF_CHAROS_A_ });
  sail({ player: charmed, kind: "message", stepId: "GcZwOU", handled: false });
  assert.equal(charmed.balance, 100, "the Ring of Charos(a) route is free");
  assert.equal(teleports.length, 2);

  const broke = createPlayer({ coins: 10 });
  const refused = { player: broke, kind: "message", stepId: "YLphRs", handled: false };
  sail(refused);
  assert.equal(teleports.length, 2, "no crossing without the fare");
  assert.equal(refused.handled, true, "the narrated line is suppressed");
});

test("the dock's own transcript variant is chosen", () => {
  const variant = hooks.variants[0];
  const definition = { getName: () => "Captain Barnaby" };
  const at = (x, y) => ({ definition, player: { getLocation: () => ({ getX: () => x, getY: () => y }) } });
  assert.equal(variant(at(2680, 3274)), "standard-dialogue-if-the-player-is-on-the-dock-in-east-ardougne");
  assert.equal(variant(at(2916, 3225)), "standard-dialogue-if-the-player-is-on-the-dock-in-rimmington");
  assert.equal(variant(at(2768, 3227)), "standard-dialogue-if-the-player-is-on-the-dock-in-brimhaven");
  assert.equal(variant({ definition: { getName: () => "Trader Crewmember" }, player: { getLocation: () => ({ getX: () => 2768, getY: () => 3227 }) } }), null);
});

test("the conditions answer the fare and the Ring of Charos(a)", () => {
  const condition = hooks.conditions[0];
  assert.equal(condition({ player: createPlayer({ coins: 100, gloves: ItemIds.KARAMJA_GLOVES_1 }), text: "If the player does not have 30 coins:" }), false);
  assert.equal(condition({ player: createPlayer({ coins: 10 }), text: "If the player does not have 30 coins:" }), true);
  assert.equal(condition({ player: createPlayer({ ring: ItemIds.RING_OF_CHAROS_A_ }), text: "If wearing the Ring of Charos(a):" }), true);
  assert.equal(condition({ player: createPlayer(), text: "If wearing the Ring of Charos(a):" }), false);
  assert.equal(condition({ player: createPlayer(), text: "Something else:" }), null);
});
