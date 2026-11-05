// Run after `yarn build`: node --test tests/tourist-trap-dart.test.cjs
//
// Feathers on the prototype dart tip, through a real inventory_use_on. The item-on-item event carries usedItemId and
// usedWithItemId; a stub of the event can pass with other names. Bots off. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const STAGE_DART_TIP = 13;
const STAGE_PROTOTYPE_DART = 15;

let core;
let next = 7500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_tourist_trap");

/** A player at the dart stage holding `first` in slot 0 and `second` in slot 1, using slot 0 on slot 1. */
async function use(t, first, second) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("touristqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  quest().setStage(p, STAGE_DART_TIP);
  p.getSkillManager().setMaxLevels(core.Skill.FLETCHING, 99, false);
  p.getSkillManager().setCurrentLevels(core.Skill.FLETCHING, 99, false);
  p.getInventory().setItem(0, new core.Item(first[0], first[1]));
  p.getInventory().setItem(1, new core.Item(second[0], second[1]));
  const seen = [];
  const real = PM.emitItemOnItem;
  t.mock.method(PM, "emitItemOnItem", (event, ...rest) => {
    seen.push(event);
    return real.call(PM, event, ...rest);
  });
  await c.dispatch([{ type: "inventory_use_on", slot: 0, itemId: first[0], target: { kind: "inventory", slot: 1 } }]);
  c.processTurnPackets();
  assert.equal(seen.length, 1, "the use reached the plugins");
  assert.equal(seen[0].usedItemId, first[0]);
  assert.equal(seen[0].usedWithItemId, second[0]);
  return { p, event: seen[0] };
}

function assertDart(p, event, I) {
  assert.equal(p.getInventory().getAmount(I.PROTOTYPE_DART), 1, "the real use makes the dart");
  assert.equal(p.getInventory().getAmount(I.FEATHER), 0, "the feathers are spent");
  assert.equal(p.getInventory().getAmount(I.PROTOTYPE_DART_TIP), 0, "the tip is spent");
  assert.equal(event.handled, true);
  assert.equal(quest().getStage(p), STAGE_PROTOTYPE_DART);
}

test("The Tourist Trap: feathers on the prototype dart tip make the dart", async (t) => {
  const I = core.ItemIdentifiers;
  const { p, event } = await use(t, [I.FEATHER, 10], [I.PROTOTYPE_DART_TIP, 1]);
  assertDart(p, event, I);
});

test("The Tourist Trap: the tip on the feathers makes the dart too", async (t) => {
  const I = core.ItemIdentifiers;
  const { p, event } = await use(t, [I.PROTOTYPE_DART_TIP, 1], [I.FEATHER, 10]);
  assertDart(p, event, I);
});

test("control: feathers on something else make no dart and move no stage", async (t) => {
  const I = core.ItemIdentifiers;
  const { p } = await use(t, [I.FEATHER, 10], [I.BRONZE_BAR, 1]);
  assert.equal(p.getInventory().getAmount(I.PROTOTYPE_DART), 0);
  assert.equal(p.getInventory().getAmount(I.FEATHER), 10);
  assert.equal(quest().getStage(p), STAGE_DART_TIP);
});
