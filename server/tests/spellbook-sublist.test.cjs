// Run after `yarn build`: node --test tests/spellbook-sublist.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const SpellbookSublist = require("../plugins/interface/SpellbookSublist.plugin");
const { showSublist } = SpellbookSublist._test;

const ENCHANT_JEWELLERY_VIEW = (218 << 16) | 15;
const BACK_BUTTON = (218 << 16) | 4;

function createPlayer() {
  const log = [];
  const varbits = new Map();
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit: (id, value) => { varbits.set(id, value); log.push(`varbit ${id}=${value}`); return sender; },
  };
  return { log, getPacketSender: () => sender };
}

const click = (player, buttonId) => showSublist({ player, buttonId });

test("registers View and Back on the spellbook", () => {
  const buttons = [];
  SpellbookSublist.register({ onInterfaceActionButton: (ids) => buttons.push(...ids) });
  assert.deepEqual(buttons.sort((a, b) => a - b), [BACK_BUTTON, ENCHANT_JEWELLERY_VIEW]);
});

test("as captured: View opens Jewellery Enchantments and Back returns to the whole book", () => {
  const player = createPlayer();
  assert.equal(click(player, ENCHANT_JEWELLERY_VIEW), true);
  assert.equal(click(player, BACK_BUTTON), true);
  assert.deepEqual(player.log, ["varbit 9730=1", "varbit 9730=0"]);
});

test("the varbit is sent only when it changes", () => {
  const player = createPlayer();
  click(player, BACK_BUTTON);
  click(player, ENCHANT_JEWELLERY_VIEW);
  click(player, ENCHANT_JEWELLERY_VIEW);
  assert.deepEqual(player.log, ["varbit 9730=1"]);
});

test("other spellbook buttons are left alone", () => {
  const player = createPlayer();
  assert.equal(click(player, (218 << 16) | 13), false);
  assert.deepEqual(player.log, []);
});
