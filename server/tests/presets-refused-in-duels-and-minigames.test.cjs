// Run after `yarn build`: node --test tests/presets-refused-in-duels-and-minigames.test.cjs
// A preset load wrote gear straight into the slots, set 99 stats and full health after only a Wilderness check: in a
// No Weapons duel it re-geared the player mid-fight, and in a minigame that keeps its own gear (Last Man Standing,
// Castle Wars) it banked the minigame's items and stripped the team cape. It now refuses in a duel, in combat and in
// an area that won't let the player teleport, and each piece must pass the normal equip checks first. Real engine:
// every plugin loaded with PvpMode, a real Player, Bank and Inventory, the real applyPreset.
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

let next = 9090;
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

const geared = () => new Presetable("qa", [new core.Item(I.SHARK, 5)], [new core.Item(I.ABYSSAL_WHIP, 1)], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);

function refused(t, f, pattern) {
  f.p.getInventory().setItem(0, new core.Item(I.LOBSTER, 1));
  Presets.applyPreset(f.p, geared());
  assert.equal(f.p.getInventory().getAmount(I.LOBSTER), 1, "what was carried stays, not banked");
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 0, "no preset loaded");
  assert.equal(f.p.getEquipment().getAmount(I.ABYSSAL_WHIP), 0, "no preset gear worn");
  assert.ok(f.messages.some((m) => pattern.test(m)), f.messages.join(" | "));
}

test("no preset during a duel", (t) => {
  const f = actor(t);
  t.mock.method(f.p.getDueling(), "inDuel", () => true);
  refused(t, f, /during a duel/);
});

test("no preset in an area that keeps the player in (it refuses teleports): LMS, Castle Wars, raids", (t) => {
  const f = actor(t);
  t.mock.method(f.p, "getArea", () => ({ canTeleport: () => false }));
  refused(t, f, /can't load a preset here/);
});

test("no preset whose gear the normal equip checks refuse here", (t) => {
  const f = actor(t);
  t.mock.method(PM, "emitCanEquip", () => false);
  refused(t, f, /can't wear the Abyssal whip here/);
});

test("elsewhere a preset still loads as before", (t) => {
  const f = actor(t);
  Presets.applyPreset(f.p, geared());
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 5);
  assert.equal(f.p.getEquipment().getAmount(I.ABYSSAL_WHIP), 1);
});
