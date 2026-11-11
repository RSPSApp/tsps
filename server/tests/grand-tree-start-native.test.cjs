// Registered dialogue with synthetic, unregistered NPCs; not a natural walk or quest playthrough.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, nextIndex = 4700;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function quest() {
  const result = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'grand_tree');
  assert.ok(result, 'Grand Tree registered');
  return result;
}
function actor(t, agility) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`treegate${nextIndex}`);
  player.setAttribute('bot-skip-persistence', true); player.setRegistered(true);
  player.setLocation(new core.Location(2466, 3496, 0)); player.setNeedsPlacement(false);
  const skill = player.getSkillManager();
  skill.setMaxLevels(core.Skill.AGILITY, agility, false);
  skill.setExperiences(core.Skill.AGILITY, core.SkillManager.getExperienceForLevel(agility), false);
  skill.setCurrentLevel(core.Skill.AGILITY, agility, false);
  assert.equal(skill.getMaxLevel(core.Skill.AGILITY), agility);
  assert.equal(skill.getCurrentLevel(core.Skill.AGILITY), agility);
  assert.ok(player.getHitpoints() > 0); assert.notEqual(player.isDyingReturn(), true);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.equal(quest().getStage(player), 0);
  assert.ok(player.getInventory().getFreeSlots() >= 2);
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.closeInterruptibleInterfaces(); player.setRegistered(false);
    core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex());
    assert.equal(player.isRegistered(), false);
    assert.equal(core.TaskManager.hasActiveTask(player), false);
    assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
  });
  return { player, connection };
}
function tick(player) {
  core.World.processCycle++;
  player.setNeedsPlacement(false);
  player.setResetMovementQueue(false);
  player.getMovementQueue().process();
  core.TaskManager.processWalkTo(player.getIndex());
  core.TaskManager.process();
}
async function pressContinue(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  const child = ({ 231: 5, 217: 5, 229: 4 })[group];
  assert.notEqual(child, undefined, `known dialogue group ${group}`);
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: -1 }]);
  f.connection.processTurnPackets();
}
async function pick(f, prompt, pattern) {
  const choice = prompt.options.findIndex(text => pattern.test(text));
  assert.ok(choice >= 0, 'actual generated answer is available');
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 }]);
  f.connection.processTurnPackets();
}
async function startChoice(f, yes) {
  const id = core.NpcIdentifiers.KING_NARNODE_SHAREEN;
  const npc = core.NPC.create(id, new core.Location(2466, 3495, 0));
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId: id, action: 'Talk-to', clickType: 1, handled: false }), true);
  for (let step = 0; step < 80; step++) {
    tick(f.player);
    const prompt = MultiChatboxPrompt.getPending(f.player);
    if (prompt) {
      if (prompt.options.some(text => /you seem worried/i.test(text))) {
        await pick(f, prompt, /you seem worried/i);
        continue;
      }
      assert.match(prompt.title, /Start The Grand Tree quest/i);
      assert.ok(f.player.getLocation().equals(new core.Location(2464, 9896, 0)), 'the offer is made beneath the tree');
      await pick(f, prompt, yes ? /^yes\b/i : /^no\b/i);
      return;
    }
    if ([231, 217, 229].includes(f.player.getPacketSender().getChatboxGroupId())) await pressContinue(f);
  }
  throw Error('start choice not reached');
}
async function finishFoundations(f) {
  const surface = new core.Location(2464, 3497, 0);
  for (let step = 0; step < 40; step++) {
    tick(f.player);
    if (f.player.getLocation().equals(surface)) return;
    if ([231, 217, 229].includes(f.player.getPacketSender().getChatboxGroupId())) await pressContinue(f);
  }
  throw Error('the King did not return the player to the surface');
}
function supplies(player, count) {
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BARK_SAMPLE), count);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.TRANSLATION_BOOK), count);
}
test('Agility 24 can start via the actual King Narnode Yes choice', async t => {
  const f = actor(t, 24); await startChoice(f, true);
  assert.equal(quest().getStage(f.player), 10); supplies(f.player, 1);
  await finishFoundations(f);
});
test('Agility 25 remains a start control', async t => {
  const f = actor(t, 25); await startChoice(f, true);
  assert.equal(quest().getStage(f.player), 10); supplies(f.player, 1);
  await finishFoundations(f);
});
test('No choice leaves a fresh quest and inventory unchanged', async t => {
  const f = actor(t, 24); await startChoice(f, false);
  assert.equal(quest().getStage(f.player), 0); supplies(f.player, 0);
  await finishFoundations(f);
});


test('the King appears and the player walks through the north cell door before dialogue continues', t => {
  const { player } = actor(t, 25);
  quest().setStage(player, 70);
  player.setLocation(new core.Location(2464, 3496, 3));
  player.setNeedsPlacement(false);
  const event = { player, npcId: core.NpcIdentifiers.CHARLIE };
  PM.emitCustomEvent('npc-dialogue:action', { ...event, stepId: 'cAaPZv' });
  const kings = core.World.getNpcsNear(player.getLocation(), 2, null);
  assert.ok(kings.some(npc => npc.getId() === core.NpcIdentifiers.KING_NARNODE_SHAREEN));
  PM.emitCustomEvent('npc-dialogue:action', { ...event, stepId: 'GdAMEV' });
  assert.equal(player.getLocation().getX(), 2464, 'continuing does not teleport the player');
  assert.equal(quest().getStage(player), 70);
  for (let i = 0; i < 4; i++) tick(player);
  assert.ok(player.getLocation().equals(new core.Location(2465, 3496, 3)));
  assert.equal(quest().getStage(player), 80);
  assert.ok(player.getDialogueManager().getCurrent(), 'the King resumes the conversation outside');
});

test('the correct shipyard password opens both leaves and walks the player across', t => {
  const { player } = actor(t, 25);
  quest().setStage(player, 80);
  player.setLocation(new core.Location(2944, 3041, 0));
  player.setNeedsPlacement(false);
  const gate = new core.Location(2945, 3041, 0);
  const other = new core.Location(2945, 3042, 0);
  assert.ok(core.MapObjects.get(core.ObjectIdentifiers.GATE_55, gate, null));
  assert.ok(core.MapObjects.get(core.ObjectIdentifiers.GATE_56, other, null));
  const event = { player, npcId: core.NpcIdentifiers.SHIPYARD_WORKER };
  for (const option of ['Ka.', 'Lu.', 'Min.']) {
    PM.emitCustomEvent('npc-dialogue:choice', { ...event, option });
  }
  PM.emitCustomEvent('npc-dialogue:action', { ...event, stepId: 'CDM9ud' });
  assert.equal(player.getLocation().getX(), 2944, 'the password does not teleport the player');
  tick(player);
  assert.equal(core.MapObjects.get(core.ObjectIdentifiers.GATE_55, gate, null), null);
  const { player: bystander } = actor(t, 25);
  bystander.setLocation(new core.Location(2944, 3041, 0));
  assert.equal(bystander.getMovementQueue().canWalkTo(gate), false, 'the opened gate still stops other players');
  assert.equal(core.MapObjects.get(core.ObjectIdentifiers.GATE_56, other, null), null);
  for (let i = 0; i < 4; i++) tick(player);
  assert.ok(player.getLocation().equals(gate));
  assert.ok(core.MapObjects.get(core.ObjectIdentifiers.GATE_55, gate, null));
  assert.ok(core.MapObjects.get(core.ObjectIdentifiers.GATE_56, other, null));
});
