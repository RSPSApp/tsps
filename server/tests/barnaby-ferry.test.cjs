// Run after `yarn build`: node --test tests/barnaby-ferry.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const BarnabyFerry = require("../plugins/world/BarnabyFerry.plugin");

const teleports = [];
let prompt = null;
BarnabyFerry.register({
  core: {
    ItemIdentifiers: ItemIds,
    TeleportHandler: {
      checkReqs: () => true,
      teleport: (player, destination, type) => teleports.push({ destination, type }),
    },
    TeleportType: { NORMAL: "NORMAL" },
  },
  sendMultiChatboxPrompt: (player, title, ...options) => { prompt = { title, options }; },
  onNpcInteraction() {},
});

function createPlayer({ coins = 100, gloves = 0 } = {}) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (gloves) equipment[Equipment.HANDS_SLOT] = { getId: () => gloves };
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

test("pay-fare offers the other ports and sails after payment", () => {
  teleports.length = 0;
  prompt = null;
  const ardougne = { getLocation: () => ({ getX: () => 2680, getY: () => 3274 }) };
  const player = createPlayer();
  BarnabyFerry._test.payFare({ player, object: ardougne });
  const labels = prompt.options.filter((option) => typeof option === "string");
  assert.ok(labels.includes("Brimhaven (30 coins)"));
  assert.ok(labels.includes("Rimmington (30 coins)"));
  assert.ok(!labels.some((label) => label.startsWith("East Ardougne")));

  const brimhaven = BarnabyFerry._test.PORTS.find((port) => port.name === "Brimhaven");
  BarnabyFerry._test.sail(player, brimhaven, 30);
  assert.equal(player.balance, 70);
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].destination.getX(), 2768);

  const broke = createPlayer({ coins: 10 });
  BarnabyFerry._test.sail(broke, brimhaven, 30);
  assert.equal(teleports.length, 1);
  assert.equal(broke.balance, 10);
});
