// Run after `yarn build`: node --test tests/toa-ward-preset-soul-runes.test.cjs
// Fortifying Elidinis' ward takes 10,000 soul runes for a fresh, tradeable Elidinis' ward (f), so only plain soul
// runes pay: preset copies (untradeable, unbankable, preset, as Presets.PvpMode tags them) never do. Real engine:
// every plugin loaded, a real Player, Inventory and skills, the Tombs of Amascut items plugin's own item-on-item
// handler, its real Yes/No prompt and its timed fuse.
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
let next = 9880;
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
  p.setUsername("ward" + p.getIndex());
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

const PRESET_TEXT = "Preset items cannot be used for this.";

function fortifyHandler() {
  let handler = null;
  const real = PM.createApi("WardPresetTest");
  require("../plugins/minigames/toa/Items.TombsOfAmascut")(new Proxy(real, {
    get: (target, key) => (key === "onItemOnItem"
      ? (...args) => { if (args[0] === "Arcane sigil") handler = args[2]; }
      : target[key]),
  }));
  return handler;
}

function ready(t) {
  const f = actor(t);
  for (const skill of [core.Skill.SMITHING, core.Skill.PRAYER]) f.p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  f.inv.setItem(0, new core.Item(I.ARCANE_SIGIL, 1));
  f.inv.setItem(1, new core.Item(I.ELIDINIS_WARD, 1));
  return f;
}

function fortify(f) {
  fortifyHandler()({ player: f.p });
  if (core.MultiChatboxPrompt.getPending(f.p)) {
    core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1 });
  }
  for (let i = 0; i < 4; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
  }
}

test("10,000 preset soul runes cannot fortify the ward", (t) => {
  const f = ready(t);
  f.inv.setItem(2, preset(new core.Item(I.SOUL_RUNE, 10000)));
  fortify(f);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.ELIDINIS_WARD_F_), 0);
  assert.equal(amount(f.inv, I.SOUL_RUNE, true), 10000);
  assert.equal(f.inv.getAmount(I.ELIDINIS_WARD), 1);
});

test("with preset and plain soul runes held, only the plain ones pay", (t) => {
  const f = ready(t);
  f.inv.setItem(2, preset(new core.Item(I.SOUL_RUNE, 10000))); // first in slot order
  f.inv.setItem(3, new core.Item(I.SOUL_RUNE, 10000));
  fortify(f);
  assert.equal(f.inv.getAmount(I.ELIDINIS_WARD_F_), 1);
  assert.equal(amount(f.inv, I.SOUL_RUNE, false), 0);
  assert.equal(amount(f.inv, I.SOUL_RUNE, true), 10000, "the preset stack is left alone");
});

test("too few plain soul runes, with preset ones making up the rest, is refused", (t) => {
  const f = ready(t);
  f.inv.setItem(2, preset(new core.Item(I.SOUL_RUNE, 5000)));
  f.inv.setItem(3, new core.Item(I.SOUL_RUNE, 5000));
  fortify(f);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(f.inv.getAmount(I.ELIDINIS_WARD_F_), 0);
  assert.equal(f.inv.getAmount(I.SOUL_RUNE), 10000);
});
