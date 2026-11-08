// Real decoded inventory/menu packets and TaskManager ticks; no client rendering.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core, nextIndex = 7200;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

async function trace(t, output, knifeLocation) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`valeknife${player.getIndex()}`);
  player.setRegistered(true); player.setLocation(new core.Location(3222, 3218, 0));
  player.needsPlacement = false;
  const skill = player.getSkillManager();
  skill.setMaxLevels(core.Skill.FLETCHING, 99, false).setCurrentLevels(core.Skill.FLETCHING, 99, false);
  const inv = player.getInventory(), ids = core.ItemIdentifiers;
  inv.setItem(0, new core.Item(ids.KNIFE));
  for (let slot = 1; slot <= 3; slot++) inv.setItem(slot, new core.Item(ids.LOGS));
  if (knifeLocation !== "none") inv.setItem(4, new core.Item(ids.FLETCHING_KNIFE));
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => {
    player.closeInterruptibleInterfaces();
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex());
  });
  const send = async packet => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  if (knifeLocation === "worn") {
    await send({ type: "inventory_action", widgetId: 149 << 16, slot: 4,
      itemId: ids.FLETCHING_KNIFE, option: "Wield", optionIndex: 2 });
    assert.equal(player.getEquipment().getSlot(core.Equipment.SHIELD_SLOT), ids.FLETCHING_KNIFE,
      "the actual Wield action equipped the fletching knife in the off-hand");
  }
  assert.equal(skill.getCurrentLevel(core.Skill.FLETCHING), 99);
  assert.equal(skill.getMaxLevel(core.Skill.FLETCHING), 99);
  assert.equal(inv.getAmount(ids.LOGS), 3);
  assert.equal(inv.getItems()[0].getId(), ids.KNIFE);
  for (const slot of [0, 1, 2, 3]) {
    assert.equal(inv.getItems()[slot].isPresetItem(), false);
    assert.equal(inv.getItems()[slot].isUntradeable(), false);
  }
  assert.equal(inv.contains(ids.FLETCHING_KNIFE), knifeLocation === "carried");
  assert.equal(player.getEquipment().contains(ids.FLETCHING_KNIFE), knifeLocation === "worn");
  await send({ type: "inventory_use_on", slot: 0, itemId: ids.KNIFE,
    target: { kind: "inventory", slot: 1, itemId: ids.LOGS } });
  const menu = player.getCreationMenu();
  assert.ok(menu, "using a knife on logs opens the creation menu");
  const index = menu.getItems().indexOf(output);
  assert.ok(index >= 0, "the requested product is offered");
  await send({ type: "dialogue_continue", widgetId: (270 << 16) | (15 + index), childIndex: 3 });
  assert.equal(inv.getAmount(ids.LOGS), 3, "selection does not consume a log before a task tick");
  const remaining = [];
  for (let tick = 0; tick < 8; tick++) {
    core.TaskManager.process();
    remaining.push(inv.getAmount(ids.LOGS));
  }
  assert.deepEqual(remaining.slice(0, 2), [3, 2], "the first batch and task phase are established");
  return remaining;
}

test("ordinary knife makes arrow shafts at the normal pace", async t => {
  assert.deepEqual(await trace(t, core.ItemIdentifiers.ARROW_SHAFT, "none"), [3, 2, 2, 2, 1, 1, 1, 0]);
});

test("a carried fletching knife speeds up shortbows after the first log", async t => {
  assert.deepEqual(await trace(t, core.ItemIdentifiers.SHORTBOW_U_, "carried"), [3, 2, 2, 1, 1, 0, 0, 0]);
});

for (const location of ["carried", "worn"]) {
  test(`a ${location} fletching knife leaves the second arrow-shaft log at normal speed`, async t => {
    assert.deepEqual(await trace(t, core.ItemIdentifiers.ARROW_SHAFT, location), [3, 2, 2, 2, 1, 1, 0, 0]);
  });
}
