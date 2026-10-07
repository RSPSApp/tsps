// Run after `yarn build`: node --test tests/charter-ships.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const CharterShips = require("../plugins/world/CharterShips.plugin");

let quests = [];
QuestRuntime.getRegisteredQuests = () => quests;

const teleports = [];
let prompt = null;
const npcHooks = [];
CharterShips.register({
  core: {
    GameConstants: { DEFINITIONS_DIRECTORY: path.join(__dirname, "..", "data", "definitions") },
    ItemIdentifiers,
    TeleportHandler: {
      checkReqs: () => true,
      teleport: (player, destination, type) => teleports.push({ destination, type }),
    },
    TeleportType: { NORMAL: "NORMAL" },
  },
  sendMultiChatboxPrompt: (player, title, ...options) => { prompt = { title, options }; },
  onNpcInteraction: (name, actions) => npcHooks.push({ name, actions }),
  log() {},
});

function createPlayer({ coins = 10000, ring = 0 } = {}) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (ring) equipment[Equipment.RING_SLOT] = { getId: () => ring };
  const messages = [];
  let balance = coins;
  return {
    messages,
    getEquipment: () => ({ get: (slot) => equipment[slot] }),
    getInventory: () => ({
      getAmount: () => balance,
      deleteNumber: (id, amount) => { balance = Math.max(0, balance - amount); },
      refreshItems: () => {},
    }),
    sendMessage: (message) => messages.push(message),
    get balance() { return balance; },
  };
}

test("the charter table loads ports and the Wiki fare matrix", () => {
  const { ports, fares } = CharterShips._test.loadData();
  assert.equal(ports.length, 11);
  assert.equal(Object.keys(fares).length, 106);
  assert.equal(CharterShips._test.fareBetween("Brimhaven", "Catherby"), 480);
  assert.equal(CharterShips._test.fareBetween("Karamja Shipyard", "Port Sarim"), 400);
  assert.equal(CharterShips._test.fareBetween("Port Tyras", "Port Sarim"), CharterShips._test.fareBetween("Port Sarim", "Port Tyras"));
});

test("a ring of charos(a) and Cabin Fever halve the fare, stacking to a quarter", () => {
  quests = [];
  assert.equal(CharterShips._test.fareFor(createPlayer(), "Brimhaven", "Catherby"), 480);
  assert.equal(CharterShips._test.fareFor(createPlayer({ ring: ItemIdentifiers.RING_OF_CHAROS_A_ }), "Brimhaven", "Catherby"), 240);
  quests = [{ name: "Cabin Fever", isComplete: () => true }];
  assert.equal(CharterShips._test.fareFor(createPlayer({ ring: ItemIdentifiers.RING_OF_CHAROS_A_ }), "Brimhaven", "Catherby"), 120);
  assert.equal(CharterShips._test.fareFor(createPlayer(), "Brimhaven", "Catherby"), 240);
});

test("sailing pays the fare and teleports; a registered incomplete quest blocks", () => {
  teleports.length = 0;
  quests = [{ name: "Regicide", isComplete: () => false }];
  const player = createPlayer();
  const tyras = CharterShips._test.loadData().ports.find((port) => port.name === "Port Tyras");
  CharterShips._test.sail(player, tyras, 3200);
  assert.equal(teleports.length, 0);
  assert.equal(player.balance, 10000);
  assert.match(player.messages.at(-1), /Regicide/);

  quests = [];
  const sarim = CharterShips._test.loadData().ports.find((port) => port.name === "Port Sarim");
  CharterShips._test.sail(player, sarim, 1600);
  assert.equal(teleports.length, 1);
  assert.equal(player.balance, 8400);
  assert.match(player.messages.at(-1), /pay 1600 coins/);
});

test("the menu identifies the current port and lists the others with fares", () => {
  quests = [];
  prompt = null;
  const brimhaven = CharterShips._test.loadData().ports.find((port) => port.name === "Brimhaven");
  assert.equal(
    CharterShips._test.currentPort({ getLocation: () => brimhaven.destination })?.name,
    "Brimhaven"
  );
  CharterShips._test.openMenu({
    player: createPlayer({ ring: ItemIdentifiers.RING_OF_CHAROS_A_ }),
    object: { getLocation: () => brimhaven.destination },
  });
  const labels = prompt.options.filter((option) => typeof option === "string");
  assert.ok(labels.some((label) => label.startsWith("Catherby (240 coins)")));
  assert.ok(!labels.some((label) => label.startsWith("Brimhaven")));
  assert.equal(npcHooks.filter((hook) => hook.name.toLowerCase().includes("trader")).length >= 2, true);
});
