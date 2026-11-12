// Run after `yarn build`: node --test tests/private-area-destroy-npcs.test.cjs
// A private instance's NPCs go with it: those that entered the area and those its plugin attached with add() (Sarachnis'
// boss and minions, Scurrius), registered or still waiting to spawn. Real NPCs and the real World queues.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
const { Boundary } = require("../dist/game/model/Boundary");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");

const SCURRIUS = 7221;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); });

class Lair extends PrivateArea {
  getName() { return "Test lair"; }
}

test("destroying a private area removes the NPCs attached with add(), registered or pending", (t) => {
  const area = new Lair([new Boundary(3290, 3300, 9860, 9870, 0)]);
  const boss = new NPC(SCURRIUS, new Location(3295, 9865, 0));
  const pending = new NPC(SCURRIUS, new Location(3296, 9866, 0));
  boss.setRegistered(true);
  World.getAddNPCQueue().push(pending);
  t.after(() => {
    for (const queue of [World.getAddNPCQueue(), World.getRemoveNPCQueue()]) {
      for (const npc of [boss, pending]) for (let i = queue.indexOf(npc); i !== -1; i = queue.indexOf(npc)) queue.splice(i, 1);
    }
  });
  area.add(boss);
  area.add(pending);
  area.destroy();
  assert.ok(World.getRemoveNPCQueue().includes(boss), "the registered boss is removed");
  assert.equal(World.getAddNPCQueue().includes(pending), false, "the pending one never spawns");
  assert.equal(World.getRemoveNPCQueue().filter((npc) => npc === boss).length, 1, "queued once");
});
