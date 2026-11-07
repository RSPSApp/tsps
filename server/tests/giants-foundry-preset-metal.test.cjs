// Run after `yarn build`: node --test tests/giants-foundry-preset-metal.test.cjs
// The Giants' Foundry crucible melts armour and weapons into metal that Kovac pays for in coins, reputation and
// Smithing XP, so it never melts a preset copy (untradeable, unbankable, preset, as Presets.PvpMode tags it).
// Real engine: every plugin loaded, a real Player, Inventory and skills, the crucible plugin's own item-on-object
// handler with its real prompt and its three-tick lever.
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
let next = 9890;
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
  p.setUsername("foundry" + p.getIndex());
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

const Crucible = require("../plugins/minigames/giantsfoundry/Crucible.GiantsFoundry");
const Shared = require("../plugins/minigames/giantsfoundry/Shared.GiantsFoundry");

function useHandler() {
  let handler = null;
  const real = PM.createApi("FoundryPresetTest");
  Crucible(new Proxy(real, {
    get: (target, key) => (key === "onItemOnObject" ? (fn) => { handler = fn; } : key === "onObjectInteraction" ? () => {} : target[key]),
  }));
  return handler;
}

function smith(t) {
  const f = actor(t);
  f.p.getSkillManager().setMaxLevels(core.Skill.SMITHING, 99, false).setCurrentLevels(core.Skill.SMITHING, 99, false);
  const access = PM.createApi("FoundryPresetAccess");
  access.onCustomEvent("giants-foundry:access", (request) => { if (request.player === f.p) request.allowed = true; });
  Crucible.clear(f.p);
  return f;
}

function addToCrucible(f, itemId) {
  const event = { player: f.p, itemId, objectId: Shared.OBJECT.CRUCIBLE_MULTI, handled: false };
  useHandler()(event);
  if (core.MultiChatboxPrompt.getPending(f.p)) {
    core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1 });
  }
  for (let i = 0; i < 6; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
  }
  return event;
}

test("a preset rune platebody is not melted into the crucible", (t) => {
  const f = smith(t);
  f.inv.setItem(0, preset(new core.Item(I.RUNE_PLATEBODY, 1)));
  const event = addToCrucible(f, I.RUNE_PLATEBODY);
  assert.equal(event.handled, true);
  assert.equal(Crucible.total(f.p), 0);
  assert.equal(amount(f.inv, I.RUNE_PLATEBODY, true), 1);
});

test("a plain rune platebody still melts into four bars' worth", (t) => {
  const f = smith(t);
  f.inv.setItem(0, new core.Item(I.RUNE_PLATEBODY, 1));
  addToCrucible(f, I.RUNE_PLATEBODY);
  assert.equal(Crucible.total(f.p), 4);
  assert.equal(f.inv.getAmount(I.RUNE_PLATEBODY), 0);
});

test("with preset and plain copies held, only the plain ones melt", (t) => {
  const f = smith(t);
  f.inv.setItem(0, preset(new core.Item(I.RUNE_PLATEBODY, 1))); // first in slot order
  f.inv.setItem(1, new core.Item(I.RUNE_PLATEBODY, 1));
  addToCrucible(f, I.RUNE_PLATEBODY);
  assert.equal(Crucible.total(f.p), 4, "one platebody's worth");
  assert.equal(amount(f.inv, I.RUNE_PLATEBODY, true), 1, "the preset one is left alone");
  assert.equal(amount(f.inv, I.RUNE_PLATEBODY, false), 0);
});
