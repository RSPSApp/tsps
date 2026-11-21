// Run after `yarn build`: node --test tests/aldarin-cauldron.test.cjs
//
// Drink-from on Aldarin's cauldron (loc cauldron_generic_drink): the player's recorded line a tick
// after the arrival (rsprox recording 4182 ticks 131 and 17847), through the real object dispatch;
// Witch's Potion's cauldron of the same name is left to its quest.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, next = 5410;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, at) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("cauldron" + next); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(at); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return p;
}

function cauldronAt(x, y) {
  core.RegionManager.loadMapFiles(x, y);
  return core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null)
    .find((object) => object.getDefinition()?.getName() === "Cauldron");
}

function drinkFrom(p, object) {
  const event = { player: p, object, objectId: object.getId(), clickType: 1, definition: object.getDefinition(), handled: false };
  PM.emitObjectInteraction(event);
  return event;
}

function currentText(p) {
  const current = p.getDialogueManager().getCurrent();
  return current?.text ?? current?.getText?.();
}

const Cauldron = require("../plugins/objects/AldarinCauldron.plugin.js")._test;

test("Aldarin cauldron: Drink-from says the recorded line a tick later, and nothing else changes", (t) => {
  const cauldron = cauldronAt(1384, 2916);
  assert.equal(cauldron?.getId(), core.CacheDefinitions.getLocId(Cauldron.LOC));
  assert.equal(cauldron.getDefinition().getInteractions()[0], "Drink-from");
  const p = player(t, new core.Location(1385, 2916, 0));
  const before = JSON.stringify(p.getInventory().getItems?.() ?? []);
  const event = drinkFrom(p, cauldron);
  assert.equal(event.handled, true);
  assert.equal(currentText(p), undefined, "no line on the arrival tick");
  core.TaskManager.process();
  assert.equal(currentText(p), Cauldron.LINE);
  assert.equal(JSON.stringify(p.getInventory().getItems?.() ?? []), before, "inventory untouched");
});

test("Aldarin cauldron: walking off before the line cancels it", (t) => {
  const cauldron = cauldronAt(1384, 2916);
  const p = player(t, new core.Location(1385, 2916, 0));
  drinkFrom(p, cauldron);
  p.setLocation(new core.Location(1386, 2916, 0));
  core.TaskManager.process();
  assert.equal(currentText(p), undefined);
});

test("Witch's Potion's cauldron (same name and option) does not get the Aldarin line", (t) => {
  const p = player(t, new core.Location(2968, 3205, 0));
  const hetty = cauldronAt(2967, 3205);
  assert.ok(hetty && hetty.getId() !== core.CacheDefinitions.getLocId(Cauldron.LOC));
  assert.equal(Cauldron.drinkFrom({ player: p, object: hetty }), false);
  core.TaskManager.process();
  assert.notEqual(currentText(p), Cauldron.LINE);
});
