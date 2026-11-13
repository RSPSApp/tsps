// Run after `yarn build`: node --test tests/leather-preset-missing-tool.test.cjs
// A hide shield (hard leather on an oak shield, with nails and a hammer) made from preset pieces without a hammer
// names the missing hammer first, as it does for plain pieces; the preset line is only for a full set of tools.
// Real engine: every plugin loaded, a real Player and Inventory, the item-on-item packet path.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");

const PRESET_TEXT = "Preset items cannot be used for this.";
const NO_HAMMER = "You need a hammer to make this.";
let core;
let I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9410;
function crafter(t) {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => true);
  const p = new Player(null);
  p.setIndex(next++);
  p.setUsername(`leatherqa${p.getIndex()}`);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.messages = [];
  t.mock.method(p, "getSession", () => ({ sendClientPacket() { return true; }, write() { return true; } }));
  t.mock.method(p, "sendMessage", (m) => p.messages.push(m));
  t.mock.method(p.getInventory(), "refreshItems", () => p.getInventory());
  p.setRegistered(true);
  p.getSkillManager().setMaxLevels(core.Skill.CRAFTING, 99, false).setCurrentLevels(core.Skill.CRAFTING, 99, false);
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return p;
}

function preset(item) {
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) item.setMetaValue(meta, true);
  return item;
}

function shieldPieces(p, { hammer }) {
  const inventory = p.getInventory();
  inventory.setItem(0, preset(new core.Item(I.HARD_LEATHER, 2)));
  inventory.setItem(1, new core.Item(I.OAK_SHIELD, 1));
  inventory.setItem(2, new core.Item(I.BRONZE_NAILS, 15));
  if (hammer) inventory.setItem(3, new core.Item(I.HAMMER, 1));
}

test("preset hides and no hammer: the missing hammer is named, not the preset line", (t) => {
  const p = crafter(t);
  shieldPieces(p, { hammer: false });
  UseItemPacketListener.itemOnItem(p, 0, 1);
  assert.deepEqual(p.messages, [NO_HAMMER]);
});

test("preset hides with a hammer still get the preset line", (t) => {
  const p = crafter(t);
  shieldPieces(p, { hammer: true });
  UseItemPacketListener.itemOnItem(p, 0, 1);
  assert.deepEqual(p.messages, [PRESET_TEXT]);
  assert.equal(p.getInventory().getAmount(I.HARD_LEATHER), 2);
});
