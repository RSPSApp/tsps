// Run after `yarn build`: node --test tests/presets-bank-carried-full.test.cjs
// Loading a preset banks everything carried (bare bank.add) and then resets the inventory and equipment. With the bank
// full, `add` dropped each item, so they were deleted; and it never asked the bank's own refusal hooks, so a loot key
// (refused at the bank) went in too. Now the load is refused, with nothing moved, when either would happen. Real
// engine: every plugin loaded with PvpMode, a real Player, Bank and Inventory, the real applyPreset.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/pvp-mode-on.cjs");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");

let core;
let I;
let Presets;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Presets = require("../plugins/modes/pvp/Presets.PvpMode");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 8980;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("preset" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => p.setRegistered(false));
  return { p, messages };
}
const preset = () => new Presetable("qa", [new core.Item(I.SHARK, 5)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);

test("a full bank refuses the load and keeps what was carried", (t) => {
  const f = actor(t);
  assert.ok(Presets.isEnabled(), "PvpMode presets are on");
  f.p.getInventory().setItem(0, new core.Item(I.ABYSSAL_WHIP, 1));
  t.mock.method(Bank, "freeSlots", () => 0);
  Presets.applyPreset(f.p, preset());
  assert.equal(f.p.getInventory().getAmount(I.ABYSSAL_WHIP), 1, "the whip is still carried, not deleted");
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 0, "the preset was not loaded");
  assert.ok(f.messages.some((m) => /bank space/.test(m)));
});

test("an item the bank refuses (a loot key) stops the load instead of being banked", (t) => {
  const f = actor(t);
  f.p.getInventory().setItem(0, new core.Item(I.LOOT_KEY, 1));
  Presets.applyPreset(f.p, preset());
  assert.equal(f.p.getInventory().getAmount(I.LOOT_KEY), 1, "still carried");
  const banked = Array.from({ length: 10 }, (_, tab) => f.p.getBank(tab)?.getAmount?.(I.LOOT_KEY) ?? 0).reduce((a, b) => a + b, 0);
  assert.equal(banked, 0, "and not in the bank");
});

test("with room, the load banks what was carried as before", (t) => {
  const f = actor(t);
  f.p.getInventory().setItem(0, new core.Item(I.ABYSSAL_WHIP, 1));
  Presets.applyPreset(f.p, preset());
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 5, "the preset is loaded");
  assert.equal(f.p.getBank(Bank.getTabForItem(f.p, I.ABYSSAL_WHIP)).getAmount(I.ABYSSAL_WHIP), 1, "the whip is banked");
});
