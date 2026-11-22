// The Ectoplasmator through the real death path: the plugin loaded by PluginManager, the
// killer chosen by NPCDeathTask from the NPC's damage map, the NPC's own definition at death.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NPCDeathTask } = require('../dist/game/task/impl/NPCDeathTask');

let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  // Only this plugin, through PluginManager's real loader and onNpcDeath dispatch.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecto-plugins-'));
  const real = path.resolve(__dirname, '../plugins/items/Ectoplasmator.plugin.js');
  fs.writeFileSync(path.join(dir, 'Ectoplasmator.plugin.js'), `module.exports = require(${JSON.stringify(real)});`);
  PluginManager.loadFromDirectory(dir);
  core = PluginManager.getCoreApi();
});

function player(t) {
  const p = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, 'getPacketSender', () => sender);
  t.mock.method(p, 'isRegistered', () => true);
  t.mock.method(p, 'sendMessage', () => {});
  p.setUsername('ectodeath');
  p.getInventory().add(new core.Item(core.ItemIdentifiers.ECTOPLASMATOR, 1));
  return p;
}

const prayerXp = (p) => p.getSkillManager().getExperience(core.Skill.PRAYER);

/** Lands the kill for `p` and runs the death task to its end; the Prayer XP after each tick. */
function die(p, id) {
  const npc = new NPC(id, new core.Location(3430, 3545, 1));
  npc.getCombat().addDamage(p, npc.getHitpoints());
  npc.setHitpoints(0);
  const task = new NPCDeathTask(npc);
  const start = prayerXp(p);
  const gained = [];
  core.TaskManager.submit(task); // runs it, as NPC.appendDeath does; ticked by hand below
  for (let tick = 0; tick < 20 && task.isRunning(); tick++) {
    task.tick();
    gained.push(prayerXp(p) - start);
  }
  return gained;
}

test('a credited Aberrant spectre kill gives 18 Prayer XP once, when the death completes', t => {
  const gained = die(player(t), 2);
  assert.equal(gained.at(-1), 18);
  assert.equal(gained[0], 0); // not on the lethal tick
  assert.ok(gained.every((xp) => xp === 0 || xp === 18), gained.join(','));
});

test('a non-spectral kill through the same path gives nothing', t => {
  assert.equal(die(player(t), 484).at(-1), 0); // Bloodveld
});
