// Run after `yarn build`: node --test tests/deaths-coffer-preset-items.test.cjs
// Death's coffer never takes a preset or meta-untradeable copy (Presets.PvpMode tags them untradeable, unbankable
// and preset): it was never paid for, so it must not buy coffer credit (which pays Death's fees and the Angel of
// Death style). Real engine: every plugin loaded, a real Player and Inventory, the coffer's own handlers (open,
// Select, X, Confirm) and Death's Office state.
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
let next = 9800;
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
  p.setUsername("coffer" + p.getIndex());
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

const Coffer = require("../plugins/areas/deathsoffice/Coffer.DeathsOffice");
const Common = require("../plugins/areas/deathsoffice/Common.DeathsOffice");

function cofferHandlers() {
  const h = { buttons: {}, open: null };
  const real = PM.createApi("CofferPresetTest");
  Coffer.attach(new Proxy(real, {
    get: (target, key) => {
      if (key === "onObjectFirstClick") return (id, handler) => { h.open = handler; };
      if (key === "onInterfaceActionButton") return (component, handler) => { h.buttons[component] = handler; };
      return target[key];
    },
  }));
  const B = Common.COMPONENT;
  return {
    open: (p) => h.open({ player: p }),
    select: (p, slot) => h.buttons[B.cofferSideItems]({ player: p, slot, opId: 1, action: 1 }),
    count: (p, n) => { h.buttons[B.cofferX]({ player: p }); p.getEnteredAmountAction().execute(n); },
    confirm: (p) => h.buttons[B.cofferConfirm]({ player: p }),
  };
}

test("a preset whip is refused when selected and when confirmed, and buys no credit", (t) => {
  const f = actor(t);
  const coffer = cofferHandlers();
  f.inv.setItem(0, preset(new core.Item(I.ABYSSAL_WHIP, 1)));
  const before = Common.state(f.p).coffer;
  coffer.open(f.p);
  coffer.select(f.p, 0);
  assert.equal(f.messages.at(-1), "You cannot trade that item to Death.");
  coffer.confirm(f.p);
  assert.equal(Common.state(f.p).coffer, before);
  assert.equal(amount(f.inv, I.ABYSSAL_WHIP, true), 1);
});

test("with a preset and a plain whip held, only the plain one is sacrificed, even when more are asked for", (t) => {
  const f = actor(t);
  const coffer = cofferHandlers();
  f.inv.setItem(0, preset(new core.Item(I.ABYSSAL_WHIP, 1))); // first in slot order
  f.inv.setItem(1, new core.Item(I.ABYSSAL_WHIP, 1));
  const before = Common.state(f.p).coffer;
  coffer.open(f.p);
  coffer.select(f.p, 1);
  coffer.count(f.p, 2);
  coffer.confirm(f.p);
  assert.equal(Common.state(f.p).coffer - before, Coffer.credit(I.ABYSSAL_WHIP), "credit for one whip");
  assert.equal(amount(f.inv, I.ABYSSAL_WHIP, false), 0);
  assert.equal(amount(f.inv, I.ABYSSAL_WHIP, true), 1, "the preset whip is left alone");
});

test("a preset copy put in the selected slot after selecting is refused at Confirm", (t) => {
  const f = actor(t);
  const coffer = cofferHandlers();
  f.inv.setItem(0, new core.Item(I.ABYSSAL_WHIP, 1));
  const before = Common.state(f.p).coffer;
  coffer.open(f.p);
  coffer.select(f.p, 0);
  f.inv.setItem(0, preset(new core.Item(I.ABYSSAL_WHIP, 1))); // swapped in while the coffer is open
  coffer.confirm(f.p);
  assert.equal(f.messages.at(-1), "You cannot trade that item to Death.");
  assert.equal(Common.state(f.p).coffer, before);
  assert.equal(amount(f.inv, I.ABYSSAL_WHIP, true), 1);
});
