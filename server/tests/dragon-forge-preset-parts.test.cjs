// Run after `yarn build`: node --test tests/dragon-forge-preset-parts.test.cjs
// The dragon forge (dragon kiteshield, dragon platebody) and the visage shields (dragonfire shield and ward) take
// only plain parts: a preset copy (untradeable, unbankable, preset, as Presets.PvpMode tags it) must not come out
// inside a fresh, tradeable product. Real engine: every plugin loaded, a real Player, Inventory, skills and quest
// state, and the smithing plugin's own anvil handler with the forge's and its own timed steps.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9870;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("forge" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}

const amount = (inv, id, wantPreset) => inv.getItems()
  .filter((item) => item?.getId() === id && item.isPresetItem() === wantPreset)
  .reduce((total, item) => total + item.getAmount(), 0);

const DragonShields = require("../plugins/skills/smithing/DragonShields.Smithing");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const PRESET_TEXT = "Preset items cannot be used for this.";
const DRAGON_SQ_SHIELD = () => core.CacheDefinitions.getObjId("dragon_sq_shield"); // the forge's own part (1187)

function smith(t) {
  const f = actor(t);
  for (const skill of [core.Skill.SMITHING]) f.p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  const ds2 = QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "dragon_slayer_ii");
  ds2.setStage(f.p, ds2.completionValue);
  const boxes = [];
  t.mock.method(f.p.getDialogueManager(), "startDialogues", (chain) => { boxes.push(chain); });
  f.boxes = boxes;
  return f;
}

function ticks(count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
  }
}

const atForge = (f, itemId) => DragonShields.useOnAnvil({ player: f.p, itemId, objectId: core.CacheDefinitions.getLocId("ds2_ac_forge_anvil"), location: f.p.getLocation(), handled: false });
const boxText = (f) => f.boxes.flatMap((chain) => [...chain.getDialogues().values()].map((dialogue) => dialogue.getText?.() ?? "")).join(" / ");

test("a preset dragon sq shield is refused at the forge and stays as it is", (t) => {
  const f = smith(t);
  f.inv.setItem(0, preset(new core.Item(DRAGON_SQ_SHIELD(), 1)));
  f.inv.setItem(1, new core.Item(I.DRAGON_METAL_SLICE, 1));
  f.inv.setItem(2, new core.Item(I.DRAGON_METAL_SHARD, 1));
  f.inv.setItem(3, new core.Item(I.HAMMER, 1));
  atForge(f, I.DRAGON_METAL_SLICE);
  ticks(6);
  assert.match(boxText(f), /Preset items cannot be used for this\./);
  assert.equal(f.inv.getAmount(I.DRAGON_KITESHIELD), 0);
  assert.equal(amount(f.inv, DRAGON_SQ_SHIELD(), true), 1);
  assert.equal(f.inv.getAmount(I.DRAGON_METAL_SLICE), 1);
});

test("with a preset and a plain sq shield, the forge uses the plain one", (t) => {
  const f = smith(t);
  f.inv.setItem(0, preset(new core.Item(DRAGON_SQ_SHIELD(), 1))); // first in slot order
  f.inv.setItem(1, new core.Item(DRAGON_SQ_SHIELD(), 1));
  f.inv.setItem(2, new core.Item(I.DRAGON_METAL_SLICE, 1));
  f.inv.setItem(3, new core.Item(I.DRAGON_METAL_SHARD, 1));
  f.inv.setItem(4, new core.Item(I.HAMMER, 1));
  atForge(f, I.DRAGON_METAL_SLICE);
  ticks(6);
  assert.equal(amount(f.inv, I.DRAGON_KITESHIELD, false), 1);
  assert.equal(amount(f.inv, DRAGON_SQ_SHIELD(), true), 1, "the preset sq shield is left alone");
  assert.equal(amount(f.inv, DRAGON_SQ_SHIELD(), false), 0);
});

test("a preset dragon chainbody is refused for the dragon platebody; a plain one still works", (t) => {
  const chainbody = core.CacheDefinitions.getObjId("dragon_chainbody"); // the forge's own part (3140)
  const f = smith(t);
  f.inv.setItem(0, preset(new core.Item(chainbody, 1)));
  f.inv.setItem(1, new core.Item(I.DRAGON_METAL_LUMP, 1));
  f.inv.setItem(2, new core.Item(I.DRAGON_METAL_SHARD, 1));
  f.inv.setItem(3, new core.Item(I.HAMMER, 1));
  atForge(f, I.DRAGON_METAL_LUMP);
  ticks(6);
  assert.match(boxText(f), /Preset items cannot be used for this\./);
  assert.equal(f.inv.getAmount(I.DRAGON_PLATEBODY), 0);
  assert.equal(amount(f.inv, chainbody, true), 1);
  f.inv.setItem(0, new core.Item(chainbody, 1));
  atForge(f, I.DRAGON_METAL_LUMP);
  ticks(6);
  assert.equal(amount(f.inv, I.DRAGON_PLATEBODY, false), 1, "the plain chainbody makes the platebody");
});

test("a preset anti-dragon shield is refused for a dragonfire shield at an anvil", (t) => {
  const f = smith(t);
  f.inv.setItem(0, preset(new core.Item(I.ANTI_DRAGON_SHIELD, 1)));
  f.inv.setItem(1, new core.Item(I.DRACONIC_VISAGE, 1));
  f.inv.setItem(2, new core.Item(I.HAMMER, 1));
  DragonShields.useOnAnvil({ player: f.p, itemId: I.DRACONIC_VISAGE, objectId: 2097, location: f.p.getLocation(), handled: false });
  ticks(12);
  assert.match(boxText(f), /Preset items cannot be used for this\./);
  assert.equal(f.inv.getAmount(I.DRACONIC_VISAGE), 1);
  assert.equal(amount(f.inv, I.ANTI_DRAGON_SHIELD, true), 1);
});
