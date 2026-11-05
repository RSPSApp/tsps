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
  assert.equal(encodeGameframeTabSetup(116).length, 3, "the layout and the two attack options dropdowns");
  assert.equal(encodeGameframeTabSetup(541).length, 1, "the prayer filter menu rows");
  assert.equal(encodeGameframeTabSetup(218).length, 1, "the spellbook filter menu rows");
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


test("the optional summary is a discovered plugin with real world-switch semantics", t => {
  const path = require("node:path");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const WorldDefinition = require("../dist/game/definition/WorldDefinition");
  const directory = path.resolve(__dirname, "../plugins/interface");
  const files = PluginManager.discoverPluginFiles(directory, 0)
    .filter(file => ["SideJournalDefaults.plugin.js", "CustomCharacterSummary.plugin.js"].includes(path.basename(file)));
  const candidates = PluginManager.collectPluginLoadCandidates(files);
  assert.ok(candidates.some(candidate => candidate.pluginName === "SideJournalDefaults"));
  const custom = candidates.find(candidate => candidate.pluginName === "CustomCharacterSummary");
  assert.ok(custom, "the configured feature is a real discovered plugin, not an unknown plugin-map key");
  assert.equal(custom.plugin.enabled, false);
  assert.deepEqual(custom.plugin.dependsOn, ["SideJournalDefaults"]);
  let world = {};
  t.mock.method(WorldDefinition, "readWorldConfig", () => world);
  const warnings = [];
  t.mock.method(console, "warn", message => warnings.push(String(message)));
  let config = PluginManager.loadPluginSwitches();
  assert.equal(config.switches.has("customcharactersummary"), false);
  assert.equal(config.defaultEnabled, undefined);
  world = { plugins: { CustomCharacterSummary: true } };
  assert.equal(PluginManager.loadPluginSwitches().switches.get("customcharactersummary"), true);
  world = { plugins: { CustomCharacterSummary: false } };
  assert.equal(PluginManager.loadPluginSwitches().switches.get("customcharactersummary"), false);
  world = { disabledPlugins: [] };
  config = PluginManager.loadPluginSwitches();
  assert.equal(config.defaultEnabled, true, "legacy mode can still load a default-off plugin");
  assert.equal(config.switches.has("customcharactersummary"), false);
  assert.ok(warnings.some(message => message.includes("deprecated")));
  // The separate summary fixture registers the actual discovered wrapper even in legacy mode,
  // proving its internal explicit-true guard leaves native UI/XP active in that composition.
});
