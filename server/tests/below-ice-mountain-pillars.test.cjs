// Below Ice Mountain: mining the four structural pillars kills the Ancient Guardian through its
// ordinary death, with a real player, the cache entrance, the object-action packet path and World
// processing (local 1001343, ticks 2785-2877).
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});

test('four mined pillars kill the Guardian with its own death and credit the miner', async t => {
  const core = PluginManager.getCoreApi();
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
  new NpcDefinitionLoader().load(); core.RegionManager.init(); core.RegionManager.loadMapFiles(2999, 3493);
  const api = PluginManager.createApi('BelowIceMountainPillars');
  require('../plugins/quests/quests/BelowIceMountain.Quest')(api);
  api.onCustomEvent('mining:best-pickaxe', event => { event.pickaxe = { animation: new core.Animation(625) }; });
  const quest = runtime.getRegisteredQuests().find(q => q.key === 'below_ice_mountain');
  t.mock.method(Math, 'random', () => 0);

  const channel = { kind: 'test', binaryTransport: true, isOpen: () => true,
    send: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session); session.setPlayer(p);
  p.setUsername('bim-pillars'); p.setLocation(new core.Location(2998, 3493, 0));
  p.setNeedsPlacement(false); p.setRunning(false);
  for (const skill of [core.Skill.HITPOINTS, core.Skill.DEFENCE]) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevel(skill, 99, false);
  }
  p.getSkillManager().setMaxLevels(core.Skill.MINING, 10, false).setCurrentLevel(core.Skill.MINING, 10, false);
  t.mock.method(p, 'onAdd', () => {}); t.mock.method(p, 'onRemove', () => {});
  const messages = [];
  const send = p.sendMessage.bind(p);
  t.mock.method(p, 'sendMessage', message => { messages.push(message); return send(message); });
  assert.equal(core.World.getPlayers().add(p), true); core.World.refreshActiveRegions();
  const turn = () => { core.World.process(); session.flushPackets(); };
  t.after(() => {
    PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    core.World.getPlayers().remove(p); core.World.refreshActiveRegions();
  });

  quest.setStage(p, 3);
  new ObjectActionPacketListener().executeAction(p, 41357, 2999, 3493, 1, 'Enter');
  let guardian;
  for (let tick = 0; tick < 12 && !guardian; tick++) {
    turn(); guardian = core.World.getNpcs().search(npc => npc.getId() === 10654 && npc.getOwner() === p);
  }
  assert.ok(guardian, 'entering the ruins at stage 3 starts the fight');
  // Mining only: the Guardian holds its attack, so the player never retaliates.
  guardian.getCombat().reset(); guardian.getCombat().setAttackDelay(400); p.getCombat().reset();
  const guardianAnimations = [];
  const perform = guardian.performAnimation.bind(guardian);
  t.mock.method(guardian, 'performAnimation', animation => { guardianAnimations.push(animation.getId()); return perform(animation); });

  const area = p.getPrivateArea();
  const pillarTiles = [[2947, 5771, 1], [2947, 5778, 1], [2958, 5771, -1], [2958, 5778, -1]];
  const objectAt = (location) => area.getObjects().find(object => object.getLocation().equals(location));
  const startXp = p.getSkillManager().getExperience(core.Skill.MINING);
  const hitpoints = [];
  for (const [x, y, side] of pillarTiles) {
    const tile = area.sourceTile(x, y);
    assert.equal(objectAt(tile)?.getId(), 41458);
    p.moveTo(tile.transform(side, 0)); p.setNeedsPlacement(false); turn();
    new ObjectActionPacketListener().executeAction(p, 41458, tile.getX(), tile.getY(), 1, 'Mine');
    for (let tick = 0; tick < 6 && objectAt(tile)?.getId() !== 41459; tick++) turn();
    assert.equal(objectAt(tile)?.getId(), 41459, 'the pillar is replaced by the mined pillar');
    turn(); turn();
    hitpoints.push(guardian.getHitpoints());
    if (hitpoints.length < 4) turn();
  }
  assert.equal(messages.filter(message => message === 'You swing your pick at the pillar.').length, 4);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MINING) - startXp, 40);
  assert.deepEqual(hitpoints, [30, 20, 10, 0], 'three 10s at the lowest roll, then the rest');

  for (let tick = 0; tick < 3; tick++) turn();
  assert.ok(guardianAnimations.includes(8943), 'the Guardian plays its recorded death animation');
  assert.equal(quest.getStage(p), 3, 'the stage waits for the body to go');
  for (let tick = 0; tick < 8 && quest.getStage(p) === 3; tick++) turn();
  assert.equal(quest.getStage(p), 4, 'the ordinary NPC death reached the quest with the miner as killer');
  assert.equal(guardian.isRegistered(), false);
  assert.equal(p.getPacketSender().getVarbit(12063), 40);
});
