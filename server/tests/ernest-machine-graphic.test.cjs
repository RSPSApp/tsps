// Run after `yarn build`: node --test tests/ernest-machine-graphic.test.cjs
// Ernest the Chicken: the chicken's stun graphic in Oddenstein's machine plays at height 124 at once. `new Graphic(80, 45)`
// read 45 as a delay (only GraphicHeight members are heights), so it played 45 cycles late at ground height.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { TaskManager } = require('../dist/game/task/TaskManager');
const core = PluginManager.getCoreApi();
let onAction;
const spawned = [];

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  // The real quest plugin, with the hooks it registers captured and the scene's actors as real NPCs.
  require('../plugins/quests/quests/ErnestTheChicken.Quest')(new Proxy({
    core,
    onCustomEvent(name, handler) { if (name === 'npc-dialogue:action') onAction = handler; },
    spawnNpc({ id, x, y, z }) {
      const npc = new NPC(id, new core.Location(x, y, z));
      npc.graphics = [];
      npc.performGraphic = (graphic) => npc.graphics.push(graphic);
      spawned.push(npc);
      return npc;
    },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

test("the machine's stun graphic on the chicken plays at height 124 with no delay", (t) => {
  const player = new Player(null);
  player.setRegistered(true);
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  t.mock.method(player, 'sendMessage', () => {});
  t.after(() => { player.setRegistered(false); TaskManager.cancelTasks(player); });
  player.setLocation(new core.Location(3110, 3366, 2));
  player.setAttribute('ernest-the-chicken:parts-handed-in', 1);
  const event = { player, npcId: core.NpcIdentifiers.PROFESSOR_ODDENSTEIN, stepId: 'ig6Dot', handled: false };
  onAction(event);
  assert.equal(event.handled, true, 'the machine step starts the scene');
  const chicken = spawned.find((npc) => npc.getId() === core.NpcIdentifiers.CHICKEN_16);
  assert.ok(chicken, 'the scene spawns its chicken');
  for (let tick = 0; tick < 8 && chicken.graphics.length === 0; tick++) TaskManager.process();
  assert.equal(chicken.graphics.length, 1, 'the machine fires once');
  const [graphic] = chicken.graphics;
  // stunned (80): height 124 with no delay in 148 of 164 recordings.
  assert.deepEqual([graphic.getId(), graphic.getDelay(), graphic.getHeight()], [80, 0, 124]);
});
