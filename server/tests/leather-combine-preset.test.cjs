// Run after `yarn build`: node --test tests/leather-combine-preset.test.cjs
// The leather combines (spiky vambraces, studded body and chaps) took their pieces by id and gave a fresh product, so
// preset vambraces (in ALLOWED_SPAWNS) came out as plain, tradeable spiky vambraces for one kebbit claw. Only plain
// copies count now. Real engine: every plugin loaded, a real Player and Inventory, the plugin's own item-on-item.
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
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("preset green d'hide vambraces are refused for spiky vambraces; plain ones open the make menu", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8930); p.setUsername("crafter8930"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 99, false).setMaxLevels(core.Skill.CRAFTING, 99, false);
  const inv = p.getInventory();
  const vambs = new core.Item(I.GREEN_D_HIDE_VAMBRACES ?? I.GREEN_DHIDE_VAMBRACES, 1);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) vambs.setMetaValue(meta, true);
  inv.setItem(0, vambs);
  inv.setItem(1, new core.Item(I.KEBBIT_CLAWS, 1));
  const use = () => PM.emitItemOnItem({ player: p, usedItem: inv.getItems()[1], usedItemId: I.KEBBIT_CLAWS, usedItemSlot: 1,
    usedWithItem: inv.getItems()[0], usedWithItemId: vambs.getId(), usedWithItemSlot: 0, handled: false });
  use();
  assert.ok(!p.getCreationMenu(), "no make menu for preset vambraces");
  assert.ok(messages.includes("Preset items cannot be used for this."));
  inv.setItem(0, new core.Item(vambs.getId(), 1));
  use();
  assert.ok(p.getCreationMenu(), "plain vambraces open the make menu as before");
});
