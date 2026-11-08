// Run after `yarn build`: node --test tests/bank-worn-view.test.cjs
// The bank's "Show worn items" side view (bankside:wornops, 15:4) lists the backpack (inv 93): the cache's
// bankside_build draws it from the inventory and bankside_worn_drawitem gives each item its Wear/Wield as op 1,
// Deposit as op 9 and Examine as op 10, so gear goes on without closing the bank (Wiki: Bank). Op 1 banked the matching
// *worn* item instead, and ops 9 and 10 did nothing.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function banker(t) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("wornview");
  p.setRegistered(true);
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.setStatus(PlayerStatus.BANKING);
  p.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  const messages = [];
  t.mock.method(p, "sendMessage", (text) => messages.push(text));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, messages };
}

const click = (p, buttonNum, slot, itemId) => Bank.handleWidgetAction(p, {
  groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_WORN_CHILD, buttonNum, slot, itemId,
});

test("op 1 wields the backpack item and keeps the worn one out of the bank", (t) => {
  const { p } = banker(t);
  const I = core.ItemIdentifiers, E = core.Equipment;
  p.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(I.RUNE_SCIMITAR, 1));
  p.getInventory().setItem(0, new core.Item(I.ADAMANT_SCIMITAR, 1));
  assert.equal(click(p, 1, 0, I.ADAMANT_SCIMITAR), true);
  assert.equal(p.getEquipment().getItems()[E.WEAPON_SLOT].getId(), I.ADAMANT_SCIMITAR, "wielded from the backpack");
  assert.equal(p.getInventory().getItems()[0].getId(), I.RUNE_SCIMITAR, "the old weapon swaps into its slot");
  assert.equal(p.getBank().getAmount(I.RUNE_SCIMITAR), 0, "nothing worn is banked");
  assert.equal(p.getInterfaceId(), Bank.MAIN_INTERFACE_ID, "the bank stays open");
});

test("op 9 deposits that backpack slot; op 10 examines; a stale item id is ignored", (t) => {
  const { p, messages } = banker(t);
  const I = core.ItemIdentifiers, E = core.Equipment;
  p.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(I.RUNE_SCIMITAR, 1));
  p.getInventory().setItem(0, new core.Item(I.RUNE_SCIMITAR, 1));
  click(p, 10, 0, I.RUNE_SCIMITAR);
  assert.ok(messages.length === 1 && messages[0].length > 0, "examine text");
  click(p, 9, 0, I.LOBSTER);
  assert.equal(p.getInventory().getItems()[0].getId(), I.RUNE_SCIMITAR, "the click named another item");
  click(p, 9, 0, I.RUNE_SCIMITAR);
  assert.equal(p.getInventory().getAmount(I.RUNE_SCIMITAR), 0);
  assert.equal(p.getBank().getAmount(I.RUNE_SCIMITAR), 1, "the backpack one is banked");
  assert.equal(p.getEquipment().getItems()[E.WEAPON_SLOT].getId(), I.RUNE_SCIMITAR, "the worn one stays on");
});
