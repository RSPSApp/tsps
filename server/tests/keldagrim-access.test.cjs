// Run after `yarn build`: node --test tests/keldagrim-access.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const Keldagrim = require("../plugins/areas/Keldagrim.plugin");
const Rellekka = require("../plugins/areas/Rellekka.plugin");

test("the Rellekka tunnel reaches the cave, while the city passage needs The Giant Dwarf started", () => {
  let started = false;
  const pluginApi = {
    core,
    emitCustomEvent(name, request) {
      if (name === "quest:is-started") request.started = started;
    },
  };
  Keldagrim._test.init(pluginApi);
  Rellekka.register({ core, onObjectInteraction() {} });

  const landings = [];
  const messages = [];
  const player = {
    moveTo: (location) => landings.push([location.getX(), location.getY()]),
    sendMessage: (message) => messages.push(message),
  };
  const entry = { player, location: { x: 2731, y: 3712, z: 0 }, handled: false };
  Rellekka._test.enterTunnel(entry);
  assert.deepEqual(landings, [[2773, 10162]], "the cave remains reachable so the quest can be started");

  Keldagrim._test.goThrough({ player, objectId: core.ObjectIdentifiers.CAVE_ENTRANCE_29 });
  assert.deepEqual(landings, [[2773, 10162]], "the city passage rejects an unstarted quest");
  assert.match(messages[0], /start The Giant Dwarf/);

  started = true;
  Keldagrim._test.goThrough({ player, objectId: core.ObjectIdentifiers.CAVE_ENTRANCE_29 });
  assert.deepEqual(landings.at(-1), [2838, 10124], "starting The Giant Dwarf opens the city passage");
});
