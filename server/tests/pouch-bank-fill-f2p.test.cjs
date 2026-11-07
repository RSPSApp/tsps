// Run after `yarn build`: node --test tests/pouch-bank-fill-f2p.test.cjs
// An essence pouch's Fill from the bank screen came through the bank's side-op event, which skips the free-world
// item check the inventory's own Fill has. On a free world it filled a members pouch; now it is refused. Real engine:
// every plugin loaded, a real Player, the bank's own Bank.INVENTORY_OP_EVENT.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, next = 9380;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function crafter(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("pouch" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setMaxLevels(core.Skill.RUNECRAFTING, 99, false); p.getSkillManager().setCurrentLevels(core.Skill.RUNECRAFTING, 99, false);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.SMALL_POUCH, 1), false);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.PURE_ESSENCE, 5), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  t.mock.method(core.Bank, "isOpen", () => true);
  return { p, messages };
}

function bankFill(f) {
  const slot = f.p.getInventory().getSlotForItemId(core.ItemIdentifiers.SMALL_POUCH);
  const event = { player: f.p, item: f.p.getInventory().getItems()[slot], slot, op: BANK_FILL_OP, option: "Fill", handled: false };
  PM.emitCustomEvent(core.Bank.INVENTORY_OP_EVENT, event);
  return event;
}

const BANK_FILL_OP = 9; // the pouch's bank-side Fill (Pouches.Runecrafting BANK_FILL_OP)

test("a free world refuses the bank screen's Fill on an essence pouch", (t) => {
  t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
  const f = crafter(t);
  const event = bankFill(f);
  assert.equal(event.handled, true);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.PURE_ESSENCE), 5, "no essence goes in");
  assert.ok(f.messages.includes("To use this item please login to a members' world."), f.messages.join(" | "));
});

test("a members world still fills the pouch from the bank screen", (t) => {
  const f = crafter(t);
  bankFill(f);
  assert.ok(f.p.getInventory().getAmount(core.ItemIdentifiers.PURE_ESSENCE) < 5, "essence went into the pouch");
});
