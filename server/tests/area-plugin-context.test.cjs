// Run after `yarn build`: node --test tests/area-plugin-context.test.cjs
// Instance areas a plugin builds and enters directly (the Mimic and Sarachnis lairs) are never passed to
// api.registerArea, so they had no pluginName: their hooks ran with no PluginContext (tasks and objects they made
// belonged to no plugin) and pluginperf filed them under the area's name. An area now starts as the plugin whose
// code built it.
const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
const { Boundary } = require("../dist/game/model/Boundary");
const { PluginContext } = require("../dist/plugins/PluginContext");
const { PluginManager } = require("../dist/plugins/PluginManager");

class LairArea extends PrivateArea {
  getName() { return "Test lair"; }
  process() { return PluginContext.current(); }
}

test("an instance area built by a plugin's code runs its hooks as that plugin", () => {
  const previous = PluginContext.enter("TestBoss");
  let area;
  try {
    area = new LairArea([new Boundary(0, 10, 0, 10, 0)]);
  } finally {
    PluginContext.exit(previous);
  }
  assert.equal(area.pluginName, "TestBoss");
  assert.equal(PluginManager.callArea(area, "process"), "TestBoss", "its hooks run inside the plugin's context");
});

test("an area built outside any plugin still has no plugin name", () => {
  assert.equal(new LairArea([new Boundary(0, 10, 0, 10, 0)]).pluginName, null);
});
