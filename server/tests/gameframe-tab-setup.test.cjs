// Run after `yarn build`: node --test tests/gameframe-tab-setup.test.cjs
// A side tab mounted again after the login (Tutorial Island's unlocks) gets the login's setup
// for it once more: the client drops a closed interface's flags.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { encodeGameframeTabSetup, encodeGameframeFlags } = require("../dist/net/protocol/ClientProtocol");

test("each tab gets back the login's flags on its own components", () => {
  const all = encodeGameframeFlags(161).map((packet) => packet.toString("hex"));
  const inventory = encodeGameframeTabSetup(149).map((packet) => packet.toString("hex"));
  assert.equal(inventory.length, 1, "the inventory slots' flags");
  assert.ok(all.includes(inventory[0]));
  assert.equal(encodeGameframeTabSetup(387).length, 1, "the equipment quiver slot");
  assert.equal(encodeGameframeTabSetup(116).length, 1, "the display settings dropdown");
  assert.deepEqual(encodeGameframeTabSetup(216), [], "emotes: none from the core (Emotes.plugin sends its own)");
});

test("the quest tab gets its journal back, with the character summary's flags", () => {
  const packets = encodeGameframeTabSetup(629);
  // The journal's mount, then the four account summary rows' flags.
  assert.equal(packets.length, 5);
  const flags = encodeGameframeFlags(161).map((packet) => packet.toString("hex"));
  assert.ok(!flags.includes(packets[0].toString("hex")), "the first is the journal mount, not a flag");
  for (const packet of packets.slice(1)) assert.ok(flags.includes(packet.toString("hex")));
});
