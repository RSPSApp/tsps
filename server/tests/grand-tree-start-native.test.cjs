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
  player.setLocation(new core.Location(2466, 3495, 0)); player.setNeedsPlacement(false);
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
async function startChoice(f, yes) {
  const id = core.NpcIdentifiers.KING_NARNODE_SHAREEN;
  const npc = core.NPC.create(id, new core.Location(2466, 3495, 0));
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId: id, action: 'Talk-to', clickType: 1, handled: false }), true);
  for (let step = 0; step < 80; step++) {
    const prompt = MultiChatboxPrompt.getPending(f.player);
    if (prompt) {
      assert.match(prompt.title, /Start The Grand Tree quest/i);
      const choice = prompt.options.findIndex(text => yes ? /^yes\b/i.test(text) : /^no\b/i.test(text));
      assert.ok(choice >= 0, 'actual generated answer is available');
      await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 }]);
      f.connection.processTurnPackets();
      return;
    }
    assert.ok(f.player.getDialogueManager().getCurrent(), 'actual source dialogue reaches the start choice');
    const group = f.player.getPacketSender().getChatboxGroupId();
    const child = ({ 231: 5, 217: 5, 229: 4 })[group];
    assert.notEqual(child, undefined, `known dialogue group ${group}`);
    assert.equal(f.player.getPacketSender().isChatboxInterface(group), true);
    await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: -1 }]);
    f.connection.processTurnPackets();
  }
  throw Error('start choice not reached');
}
function supplies(player, count) {
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BARK_SAMPLE), count);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.TRANSLATION_BOOK), count);
}
test('Agility 24 can start via the actual King Narnode Yes choice', async t => {
  const f = actor(t, 24); await startChoice(f, true);
  assert.equal(quest().getStage(f.player), 10); supplies(f.player, 1);
});
test('Agility 25 remains a start control', async t => {
  const f = actor(t, 25); await startChoice(f, true);
  assert.equal(quest().getStage(f.player), 10); supplies(f.player, 1);
});
test('No choice leaves a fresh quest and inventory unchanged', async t => {
  const f = actor(t, 24); await startChoice(f, false);
  assert.equal(quest().getStage(f.player), 0); supplies(f.player, 0);
});
