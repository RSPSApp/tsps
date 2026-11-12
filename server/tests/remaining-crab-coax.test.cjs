const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

const CACHE = path.resolve(__dirname, '..');
const SIT_SLOT = 54;
const SIT_LOOP = 10061; // emote_sit_loop, interface 216 child 54 (cache enum 1001 -> 5248)

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(CACHE);
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

const { setup } = require('./crab-quest-harness.cjs');

// `bit` is the spot-array index bit used by SCARED/MET (join bits differ).
const SIT_SPOTS = [
  { id: 62473, x: 3043, y: 2640, sit: [3042, 2640], bit: 1 << 0 },
  { id: 62470, x: 3042, y: 2637, sit: [3041, 2638], bit: 1 << 1 },
  { id: 62475, x: 3036, y: 2644, sit: [3037, 2643], bit: 1 << 3 },
  { id: 62475, x: 3046, y: 2656, sit: [3046, 2655], bit: 1 << 9 },
];

test('Crab coax needs the real Sit emote after the too-scared investigate', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 47);
  for (const spot of SIT_SPOTS) {
    h.setLocation(spot.sit[0], spot.sit[1]);
    h.investigate(spot.id, spot.x, spot.y);
    assert.ok((h.attrs.get('quest.crab_quest.scared') & spot.bit) !== 0, `spot ${spot.id} set scared`);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, `spot ${spot.id} not coaxed by investigate`);

    h.investigate(spot.id, spot.x, spot.y);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, `second investigate does not coax ${spot.id}`);

    h.sit(spot.sit[0], spot.sit[1], 12);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, 'a different emote does not coax');

    h.sit(spot.sit[0] + 1, spot.sit[1] + 1);
    assert.equal(h.attrs.get('quest.crab_quest.met') & spot.bit, 0, 'Sit on the wrong tile does not coax');

    h.sit(spot.sit[0], spot.sit[1]);
    assert.ok((h.attrs.get('quest.crab_quest.met') & spot.bit) !== 0, `Sit at ${spot.sit} coaxes ${spot.id}`);
    assert.ok(h.messages.includes('And now, you wait...'));
  }
  // The captured crab chathead is crab_bandcrab 16483; its join action must count.
  h.emit('npc-dialogue:action', { npcId: 16483, stepId: '5WiO-g' });
  assert.ok((h.attrs.get('quest.crab_quest.recruited') & (1 << 0)) !== 0, 'bandcrab chathead action sets the join bit');
});

test('Crab recruit pocket is reachable once the 3039,2644 flavor palm is skipped (real cache pathfinder)', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { Location } = require('../dist/game/model/Location');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  ObjectDefinition.init();
  RegionManager.init();

  const spots = [
    [62473, 3043, 2640], [62470, 3042, 2637], [62470, 3039, 2644], [62475, 3037, 2644],
    [62470, 3037, 2647], [62470, 3039, 2647], [62470, 3040, 2649], [62470, 3048, 2658],
    [62470, 3040, 2636], [62475, 3047, 2656], [62475, 3063, 2653], [62477, 3054, 2656],
    [62478, 3050, 2636], [62478, 3057, 2640],
  ];
  const objects = spots.map(([id, x, y]) => new GameObject(id, new Location(x, y, 0), 10, 0, null));
  for (const object of objects) MapObjects.add(object);

  const reachable = () => {
    const start = [3039, 2645];
    const seen = new Set([start.join(',')]);
    const queue = [start];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || RegionManager.getClipping(nx, ny, 0, null) !== 0) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };

  const sealed = reachable();
  assert.equal(sealed.has('3042,2640'), false, 'solid 3039,2644 palm seals the magic tree');
  assert.equal(sealed.has('3041,2637'), false, 'solid 3039,2644 palm seals the palm south');

  const flavor = objects[2];
  MapObjects.remove(flavor);
  RegionManager.removeObjectClipping(flavor);
  const open = reachable();
  assert.equal(open.has('3042,2640'), true, 'magic tree reachable once the flavor palm is skipped');
  assert.equal(open.has('3041,2637'), true, 'palm south reachable once the flavor palm is skipped');
});

test('Crab tree NW (capture 3036,2644) sits at 3037,2643; the 2x2 tree refuses 3037,2644', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { Location } = require('../dist/game/model/Location');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  ObjectDefinition.init();
  RegionManager.init();
  MapObjects.add(new GameObject(62475, new Location(3036, 2644, 0), 10, 2, null));
  assert.notEqual(RegionManager.getClipping(3037, 2644, 0, null), 0, '3037,2644 is inside the 2x2 tree');
  assert.equal(RegionManager.getClipping(3037, 2643, 0, null), 0, '3037,2643 is walkable');

  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 47);
  h.setLocation(3037, 2643);
  h.investigate(62475, 3036, 2644);
  assert.ok((h.attrs.get('quest.crab_quest.scared') & (1 << 3)) !== 0, 'tree NW scared bit 3');
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'no auto-coax');
  h.investigate(62475, 3036, 2644);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'second investigate does not coax');
  h.sit(3037, 2644);
  assert.equal(h.attrs.get('quest.crab_quest.met') & (1 << 3), 0, 'Sit on the tree tile is refused');
  h.sit(3037, 2643);
  assert.ok((h.attrs.get('quest.crab_quest.met') & (1 << 3)) !== 0, 'captured Sit tile 3037,2643 coaxes');
});

test('Crab legacy hand-in count derives colours only when complete and never from pickups', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const partial = setup();
  const partialQuest = partial.loadQuest();
  partialQuest.setStage(partial.player, 30);
  partial.attrs.set('quest.crab_quest.shells-handed', 3);
  partial.attrs.set('quest.crab_quest.shells-picked', 0b1111111);
  for (const fn of partial.hooks.login) fn({ player: partial.player });
  for (let index = 0; index < 7; index++) {
    assert.equal(valueOf(partial, 15844 + index), 0, `legacy partial count does not guess shell ${index + 1}`);
  }
  assert.equal(partialQuest.getStage(partial.player), 30);

  const complete = setup();
  const completeQuest = complete.loadQuest();
  completeQuest.setStage(complete.player, 30);
  complete.attrs.set('quest.crab_quest.shells-handed', 7);
  for (const fn of complete.hooks.login) fn({ player: complete.player });
  for (let index = 0; index < 7; index++) {
    assert.equal(valueOf(complete, 15844 + index), 1, `completed hand-in count derives shell ${index + 1}`);
  }
  assert.equal(completeQuest.getStage(complete.player), 30);
});

test('Crab does not count a duplicate colour towards the seven shells', () => {
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 25);
  const talk = () => h.hooks.npcs.at(-1)({
    player: h.player,
    npcId: 16471,
    clickType: 1,
    definition: h.core.NpcDefinition.forId(16471),
  });

  h.inventory.set(34575, 2);
  talk();
  assert.equal(h.attrs.get('quest.crab_quest.shells-handed'), 1, 'first colour counted once');
  assert.equal(h.attrs.get('crab-quest:shells-handed-mask'), 1 << 0);

  talk();
  assert.equal(h.attrs.get('quest.crab_quest.shells-handed'), 1, 'duplicate colour does not increment again');
  assert.equal(h.attrs.get('crab-quest:shells-handed-mask'), 1 << 0);
  assert.equal(h.inventory.get(34575), 0, 'duplicate shell is still consumed');
  assert.equal(quest.getStage(h.player), 25, 'duplicate colour cannot reach the seven-shell stage');
});

test('Crab clears the native instance flag on completion only', () => {
  const valueOf = (h, id) => [...h.varbits].reverse().find((entry) => entry.id === id)?.value;
  const h = setup();
  const quest = h.loadQuest();
  quest.setStage(h.player, 60);
  h.varbits.length = 0;
  h.emit('npc-dialogue:action', { npcId: 16474, stepId: 'Wk9imR' });
  assert.equal(quest.getStage(h.player), 63, 'ceremony completion still reaches 63');
  assert.equal(valueOf(h, 15868), 0, 'completed quest leaves the instance flag clear');
  assert.equal(valueOf(h, 15842), 63, 'stage varbit still publishes 63');
});

test('Crab Sit uses the real cached slot 54 loop', () => {
  const Emotes = require('../plugins/interface/Emotes.plugin');
  const player = { getEquipment: () => ({ getItems: () => [] }) };
  assert.deepEqual(Emotes._test.resolveEmote(player, SIT_SLOT, 1, {}), { sequence: SIT_LOOP, graphic: undefined });
});

// Native registered bottle, mooring and spell consumers. The fixture drives the real dialogue
// manager and scheduled sailing tasks; it does not claim a decoded click or a sailing journey.
