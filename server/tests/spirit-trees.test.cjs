// Run after `yarn build`: node --test tests/spirit-trees.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Location } = require("../dist/game/model/Location");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const SpiritTrees = require("../plugins/world/SpiritTrees.plugin");

let quests = [];
QuestRuntime.getRegisteredQuests = () => quests;

const teleports = [];
let prompt = null;
SpiritTrees.register({
  core: {
    GameConstants: { DEFINITIONS_DIRECTORY: path.join(__dirname, "..", "data", "definitions") },
    TeleportHandler: {
      checkReqs: () => true,
      teleport: (player, destination, type) => teleports.push({ destination, type }),
    },
    TeleportType: { NORMAL: "NORMAL" },
  },
  sendMultiChatboxPrompt: (player, title, ...options) => { prompt = { title, options }; },
  onObjectInteraction() {},
  log() {},
});

function createPlayer() {
  const messages = [];
  return { messages, sendMessage: (message) => messages.push(message) };
}

const villageTree = { getLocation: () => new Location(2539, 3166, 0) };
const strongholdTree = { getLocation: () => new Location(2460, 3446, 0) };

test("the spirit tree table has the permanent network", () => {
  const destinations = SpiritTrees._test.loadDestinations();
  assert.equal(destinations.length, 8);
  const ge = destinations.find((entry) => entry.name === "Grand Exchange");
  assert.deepEqual([ge.destination.getX(), ge.destination.getY()], [3185, 3510]);
  const stronghold = destinations.find((entry) => entry.name === "Gnome Stronghold");
  assert.equal(stronghold.requires, "The Grand Tree");
});

test("the network needs Tree Gnome Village, and travel from the Stronghold needs The Grand Tree", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => false }];
  const locked = createPlayer();
  assert.equal(SpiritTrees._test.canUseNetwork(locked, villageTree), false);
  assert.match(locked.messages.at(-1), /Tree Gnome Village/);

  const grandTree = { name: "The Grand Tree", isComplete: () => false };
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }, grandTree];
  assert.equal(SpiritTrees._test.canUseNetwork(createPlayer(), villageTree), true);
  const noGrandTree = createPlayer();
  assert.equal(SpiritTrees._test.canUseNetwork(noGrandTree, strongholdTree), false);
  assert.match(noGrandTree.messages.at(-1), /The Grand Tree/);

  grandTree.isComplete = () => true;
  assert.equal(SpiritTrees._test.canUseNetwork(createPlayer(), strongholdTree), true);
});

test("travelling checks the destination quest when it is registered", () => {
  teleports.length = 0;
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const player = createPlayer();
  const ge = SpiritTrees._test.loadDestinations().find((entry) => entry.name === "Grand Exchange");
  SpiritTrees._test.travel(player, ge);
  assert.equal(teleports.length, 1);
  assert.equal(teleports[0].destination.getX(), 3185);

  quests.push({ name: "Song of the Elves", isComplete: () => false });
  const prif = SpiritTrees._test.loadDestinations().find((entry) => entry.name === "Prifddinas");
  SpiritTrees._test.travel(player, prif);
  assert.equal(teleports.length, 1, "an incomplete registered quest blocks");
  assert.match(player.messages.at(-1), /Song of the Elves/);
});

test("the menu lists every destination", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  prompt = null;
  SpiritTrees._test.openNetwork({ player: createPlayer(), object: villageTree });
  assert.ok(prompt);
  const labels = prompt.options.filter((option) => typeof option === "string");
  assert.ok(labels.includes("Grand Exchange"));
  assert.ok(labels.includes("Prifddinas"));
});
