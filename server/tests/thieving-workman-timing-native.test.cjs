// Seeded adjacent actors and deterministic success rolls; not a walking or live-game test.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core, started = false;
const submitted = new Set(); let realSubmit;
const errors = [], oldError = console.error, oldWarn = console.warn;
before(async () => {
  console.error = (...a) => { errors.push(a.map(String).join(' ')); oldError(...a); };
  console.warn = (...a) => { if (String(a[0]).includes('hook threw')) errors.push(a.map(String).join(' ')); oldWarn(...a); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3364, 3431);
  realSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function (task) { submitted.add(task); return realSubmit.call(this, task); };
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({}); started = true;
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
});
after(() => { try { if (started) PM.emitServerShutdown({}); for (const task of submitted) task.stop(); assert.deepEqual(errors, []); } finally { if (core && realSubmit) core.TaskManager.submit = realSubmit; console.error = oldError; console.warn = oldWarn; } });
function tick() {
  core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  const original = Math.random;
  try { Math.random = () => 0.5; core.TaskManager.process(); } finally { Math.random = original; }
}
function actor(t, level, label) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setUsername(`thief${label}`); player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3364, 3431, 0));
  assert.equal(core.World.getPlayers().add(player), true); player.setNeedsPlacement(false);
  assert.equal(core.World.getPlayers().get(player.getIndex()), player);
  assert.ok(player.getIndex() >= 0 && player.getIndex() < 2048);
  const skills = player.getSkillManager(), xp = core.SkillManager.getExperienceForLevel(level);
  skills.setExperiences(core.Skill.THIEVING, xp, false); skills.setMaxLevels(core.Skill.THIEVING, level, false); skills.setCurrentLevel(core.Skill.THIEVING, level, false);
  assert.equal(skills.getCurrentLevel(core.Skill.THIEVING), level);
  assert.ok(player.isRegistered() && player.getHitpoints() > 0);
  t.after(() => { const index = player.getIndex(); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(index); assert.equal(core.World.getPlayers().removes(player), true); assert.equal(player.isRegistered(), false); });
  return player;
}
function admitted(t, player, id, name, option) {
  const npc = core.NPC.create(id, new core.Location(3365, 3431, 0));
  assert.equal(core.World.getNpcs().add(npc), true);
  assert.equal(core.World.getNpcs().get(npc.getIndex()), npc);
  assert.equal(player.getLocation().getDistance(npc.getLocation()), 1);
  t.after(() => { assert.equal(core.World.getNpcs().removes(npc), true); assert.equal(npc.isRegistered(), false); });
  const definition = npc.getCurrentDefinition(player);
  assert.equal(definition.getName(), name);
  const clickType = definition.getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `${name} has ${option}`);
  const messages = [];
  const send = player.sendMessage.bind(player);
  t.mock.method(player, 'sendMessage', (...a) => { messages.push(String(a[0])); return send(...a); });
  const tasksBefore = submitted.size;
  const handled = PM.emitNpcInteraction({ player, npc, definition, npcId: id, clickType, handled: false });
  assert.equal(handled, true);
  return { npc, messages, tasksAdded: submitted.size - tasksBefore };
}
test('workman outcome follows the captured delay, while an ordinary pickpocket resolves normally', (t) => {
  // During task processing 0.5 succeeds at level 99 without guaranteeing rare rewards.
  const underlevel = actor(t, 1, 'under');
  const refused = admitted(t, underlevel, core.NpcIdentifiers.DIGSITE_WORKMAN_2, 'Digsite workman', 'Steal-from');
  assert.ok(refused.messages.includes('You need a Thieving level of at least 25 to do this.'));
  assert.equal(refused.tasksAdded, 0, 'refusal schedules no outcome');
  assert.equal(underlevel.getInventory().getItems().filter(i => i?.getId() > 0).length, 0);
  const workman = actor(t, 99, 'workman');
  const man = actor(t, 99, 'man');
  const rawTenths = (p) => Math.round(p.getSkillManager().getSkills().getExperiences()[core.Skill.THIEVING.getIndex()] * 10);
  const workXp = rawTenths(workman);
  const workDisplayXp = workman.getSkillManager().getExperience(core.Skill.THIEVING);
  const manXp = man.getSkillManager().getExperience(core.Skill.THIEVING);
  const work = admitted(t, workman, core.NpcIdentifiers.DIGSITE_WORKMAN_2, 'Digsite workman', 'Steal-from');
  admitted(t, man, core.NpcIdentifiers.MAN_5, 'Man', 'Pickpocket');
  assert.ok(work.messages.includes("You attempt to pick the workman's pocket..."));
  assert.equal(workman.getInventory().getItems().filter(i => i?.getId() > 0).length, 0);
  tick();
  assert.equal(man.getSkillManager().getExperience(core.Skill.THIEVING) - manXp, 8);
  assert.equal(rawTenths(workman), workXp, 'no workman XP on first tick');
  assert.equal(workman.getInventory().getItems().filter(i => i?.getId() > 0).length, 0);
  tick();
  assert.equal(rawTenths(workman), workXp, 'no workman XP on second tick');
  assert.equal(workman.getInventory().getItems().filter(i => i?.getId() > 0).length, 0);
  tick();
  assert.equal(rawTenths(workman) - workXp, 104);
  assert.equal(workman.getInventory().getItems().filter(i => i?.getId() > 0).length, 1);
  assert.ok(work.messages.includes("You pick the workman's pocket..."));
  assert.equal(workman.getSkillManager().getExperience(core.Skill.THIEVING) - workDisplayXp, 10);
  tick();
  assert.equal(rawTenths(workman) - workXp, 104, 'reward only once');
  assert.equal(underlevel.getSkillManager().getExperience(core.Skill.THIEVING), core.SkillManager.getExperienceForLevel(1));
  // Four ticks have passed; this checks a subsequent ordinary action, not a minimum cadence.
  admitted(t, workman, core.NpcIdentifiers.MAN_5, 'Man', 'Pickpocket');
  tick();
  assert.equal(man.getSkillManager().getExperience(core.Skill.THIEVING) - manXp, 8);
  assert.equal(rawTenths(workman) - workXp, 184);
  assert.ok(workman.getInventory().getAmount(core.ItemIdentifiers.COIN_POUCH) > 0);
});
