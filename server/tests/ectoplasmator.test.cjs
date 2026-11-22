const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');

let core, onDeath;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  new NpcDefinitionLoader().load(); // the dumped monster attributes and hitpoints
  require('../plugins/items/Ectoplasmator.plugin').register({ core, onNpcDeath: (handler) => { onDeath = handler; } });
});

function player(t, carrying = true) {
  const p = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, 'getPacketSender', () => sender);
  p.setUsername('ecto');
  if (carrying) p.getInventory().add(new core.Item(core.ItemIdentifiers.ECTOPLASMATOR, 1));
  return p;
}

const npc = (id) => new NPC(id, new core.Location(3200, 3200, 0));
const prayerXp = (p) => p.getSkillManager().getExperience(core.Skill.PRAYER);

function kill(p, id) {
  const before = prayerXp(p);
  onDeath({ killer: p, npc: npc(id), npcId: id, location: { x: 3200, y: 3200, z: 0 } });
  return prayerXp(p) - before;
}

// Wiki Ectoplasmator's table: 20% of max health, rounded down.
test('a spectral kill gives 20% of its max health in Prayer XP, rounded down', t => {
  const p = player(t);
  assert.equal(kill(p, 2), 18); // Aberrant spectre, 90 HP
  assert.equal(kill(p, 85), 5); // Ghost, 25 HP
  assert.equal(kill(p, 2515), 13); // Ankou, 65 HP (13 on the Wiki's table)
  assert.equal(kill(p, 12077), 170); // Phantom Muspah, 850 HP
});

test('the Corporeal Beast and the Blue Moon are not spectral and give nothing', t => {
  const p = player(t);
  assert.equal(kill(p, 319), 0);
  assert.equal(kill(p, 13013), 0);
});

test('nothing without the ectoplasmator in the inventory', t => {
  const p = player(t, false);
  assert.equal(kill(p, 2), 0);
  p.getBank(0).add(new core.Item(core.ItemIdentifiers.ECTOPLASMATOR, 1));
  assert.equal(kill(p, 2), 0);
});

test('an npc killer gets nothing and does not throw', () => {
  assert.doesNotThrow(() => onDeath({ killer: npc(2), npc: npc(2), npcId: 2 }));
});
