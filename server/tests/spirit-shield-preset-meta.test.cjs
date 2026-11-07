// Run after `yarn build`: node --test tests/spirit-shield-preset-meta.test.cjs
// Blessing a spirit shield and attaching a sigil at an anvil convert the shield in place, keeping its meta: a
// preset copy (untradeable, unbankable, preset, as Presets.PvpMode tags it) stays one, rather than coming out
// as a plain, tradeable shield. Real engine: every plugin loaded, a real Player, Inventory and skills, and the
// Corporeal Beast plugin's own bless (Holy elixir on a spirit shield) and anvil handlers.
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
let next = 9820;
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
  p.setUsername("shield" + p.getIndex());
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

const Shields = require("../plugins/bosses/corporealbeast/SpiritShields.CorporealBeast");

function skilled(f) {
  for (const skill of [core.Skill.PRAYER, core.Skill.SMITHING]) {
    f.p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  return f;
}

test("a sigil on a preset blessed spirit shield gives a preset, untradeable shield", (t) => {
  const f = skilled(actor(t));
  const [sigil, shield] = [...Shields.SIGILS][0];
  f.inv.setItem(0, preset(new core.Item(Shields.ITEM.BLESSED_SPIRIT_SHIELD, 1)));
  f.inv.setItem(1, new core.Item(I.HAMMER, 1));
  f.inv.setItem(2, new core.Item(sigil, 1));
  Shields.attach({ player: f.p, itemId: sigil });
  assert.equal(f.inv.getAmount(sigil), 0);
  assert.equal(amount(f.inv, shield, false), 0, "no plain shield");
  assert.equal(amount(f.inv, shield, true), 1);
  assert.equal(f.inv.getItems().find((item) => item?.getId() === shield).isUntradeable(), true);
});

test("a sigil on a plain blessed spirit shield still gives a plain, tradeable shield", (t) => {
  const f = skilled(actor(t));
  const [sigil, shield] = [...Shields.SIGILS][0];
  f.inv.setItem(0, new core.Item(Shields.ITEM.BLESSED_SPIRIT_SHIELD, 1));
  f.inv.setItem(1, new core.Item(I.HAMMER, 1));
  f.inv.setItem(2, new core.Item(sigil, 1));
  Shields.attach({ player: f.p, itemId: sigil });
  assert.equal(amount(f.inv, shield, false), 1);
  assert.equal(f.inv.getAmount(Shields.ITEM.BLESSED_SPIRIT_SHIELD), 0);
});

test("a holy elixir on a preset spirit shield gives a preset blessed shield", (t) => {
  const f = skilled(actor(t));
  f.inv.setItem(0, preset(new core.Item(Shields.ITEM.SPIRIT_SHIELD, 1)));
  f.inv.setItem(1, new core.Item(Shields.ITEM.HOLY_ELIXIR, 1));
  const items = f.inv.getItems();
  Shields.bless({ player: f.p, usedItem: items[1], usedItemSlot: 1, usedWithItem: items[0], usedWithItemSlot: 0 });
  assert.equal(f.inv.getAmount(Shields.ITEM.HOLY_ELIXIR), 0);
  assert.equal(amount(f.inv, Shields.ITEM.BLESSED_SPIRIT_SHIELD, false), 0, "no plain blessed shield");
  assert.equal(amount(f.inv, Shields.ITEM.BLESSED_SPIRIT_SHIELD, true), 1);
});
