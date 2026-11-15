// Run after `yarn build`: node --test tests/elemental-workshop-ii-claw.test.cjs
//
// Issue #5739: at the crane-claw leg, EW II's crane schematic can be taken before the lever one
// advances the stage to 6. EW I's workbench handler then consumed the elemental metal as a shield.
// Real cache, every plugin loaded, the real workbench and the real multi-chatbox claw choice.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const Runtime = require("../plugins/quests/QuestRuntime");

const WORKBENCH = 3402;
const AT = [2717, 9887, 0];
const EW2_KEY = "elemental_workshop_ii";
const EW2_FLAGS = "quest.elemental_workshop_ii.flags";
const EW2_JIG = "quest.elemental_workshop_ii.jig";
const CRANE_SCHEMATIC_TAKEN = 1 << 5;
let core, next = 9960;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, { stage = 5, craneSchematic = true } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("ewclaw" + next); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(AT[0], AT[1] + 1, 0)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevels(core.Skill.SMITHING, 99, false).setCurrentLevels(core.Skill.SMITHING, 99, false);
  const I = core.ItemIdentifiers;
  p.getInventory().adds(I.ELEMENTAL_METAL, 1);
  p.getInventory().adds(I.HAMMER, 1);
  p.getInventory().adds(I.SLASHED_BOOK, 1);
  const quest = Runtime.getRegisteredQuests().find((q) => q.key === EW2_KEY);
  assert.ok(quest, "Elemental Workshop II is registered");
  quest.setStage(p, stage);
  p.setAttribute(EW2_FLAGS, craneSchematic ? CRANE_SCHEMATIC_TAKEN : 0);
  p.setAttribute(EW2_JIG, 0);
  t.after(() => {
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().remove(p);
    p.setRegistered(false);
  });
  return p;
}

function useMetal(p) {
  const loc = new core.Location(...AT);
  const object = MapObjects.getObjectsAt(loc, null).find((entry) => entry.getId() === WORKBENCH);
  assert.ok(object, "the workshop workbench stands at 2717,9887");
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.ELEMENTAL_METAL);
  assert.ok(slot >= 0);
  const item = p.getInventory().getItems()[slot];
  return PM.emitItemOnObject({
    player: p, object, objectId: WORKBENCH, item, itemId: core.ItemIdentifiers.ELEMENTAL_METAL, itemSlot: slot,
    interfaceType: Inventory.INTERFACE_ID, location: { x: loc.getX(), y: loc.getY(), z: loc.getZ() }, handled: false,
  });
}

test("using elemental metal with the crane schematic offers the claw before stage 6 (#5739)", (t) => {
  const p = player(t, { stage: 5, craneSchematic: true });
  assert.equal(useMetal(p), true, "the workbench interaction is handled");
  const prompt = core.MultiChatboxPrompt.getPending(p);
  assert.ok(prompt, "the claw choice opens");
  assert.deepEqual(prompt.options, ["An elemental claw.", "An elemental helm."]);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ELEMENTAL_SHIELD), 0, "no shield was made");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ELEMENTAL_METAL), 1, "the bar is still there");

  const index = prompt.options.indexOf("An elemental claw.");
  assert.equal(core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, groupId: 219, slot: index + 1 }), true);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.CRANE_CLAW), 1, "the claw is in the inventory");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ELEMENTAL_METAL), 0, "the bar was consumed");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ELEMENTAL_SHIELD), 0, "still no shield");
});

test("without the crane schematic EW I still makes its shield", (t) => {
  const p = player(t, { stage: 5, craneSchematic: false });
  assert.equal(useMetal(p), true);
  assert.equal(core.MultiChatboxPrompt.getPending(p), null, "no claw choice without the schematic");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ELEMENTAL_METAL), 0);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ELEMENTAL_SHIELD), 1, "the EW I shield path is unchanged");
});

test("stage 6 with both schematics still offers the claw", (t) => {
  const p = player(t, { stage: 6, craneSchematic: true });
  assert.equal(useMetal(p), true);
  const prompt = core.MultiChatboxPrompt.getPending(p);
  assert.ok(prompt, "the claw choice opens at the existing stage-6 handoff too");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ELEMENTAL_SHIELD), 0);
});
