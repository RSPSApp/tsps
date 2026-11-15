// Run after `yarn build`: node --test tests/npc-death-area-leave.test.cjs
// NPCDeathTask.remove called its area's leave directly, so the leave ran without the area's plugin context and a
// throwing leave escaped the death task. It now goes through PluginManager.callArea like every other leave.
// Real NPC, real NPCDeathTask.remove.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginContext } = require("../dist/plugins/PluginContext");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");

before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); });

function npcIn(t, area) {
  const npc = NPC.create(3106, new Location(3222, 3218, 0)); // a man
  npc.setArea(area);
  t.after(() => { const queue = World.getRemoveNPCQueue(); const i = queue.indexOf(npc); if (i >= 0) queue.splice(i, 1); });
  return npc;
}

test("a dying NPC leaves its area as the area's plugin", (t) => {
  const seen = [];
  const area = { pluginName: "test-area-plugin", getName: () => "test",
    leave(who, logout) { seen.push([PluginContext.current(), logout]); who.setArea(null); } };
  const npc = npcIn(t, area);
  new NPCDeathTask(npc).remove(0);
  assert.deepEqual(seen, [["test-area-plugin", false]], "leave ran once inside the area's plugin context");
  assert.equal(npc.getArea(), null);
  assert.equal(PluginContext.current(), null, "and the context was restored afterwards");
});

test("an area whose leave throws doesn't stop the NPC's removal", (t) => {
  const npc = npcIn(t, { getName: () => "broken", leave() { throw new Error("a plugin's postLeave failed"); } });
  t.mock.method(console, "error", () => {});
  assert.doesNotThrow(() => new NPCDeathTask(npc).remove(0));
  assert.equal(npc.getArea(), null, "the area is still cleared");
  assert.ok(World.getRemoveNPCQueue().includes(npc), "and the NPC is queued for removal");
});
