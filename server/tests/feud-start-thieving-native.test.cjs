// Registered brew and generated dialogue with a synthetic Ali; not natural walking or a playthrough.
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
let core, nextIndex = 4900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function quest() {
  const found = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'the_feud');
  assert.ok(found, 'The Feud is registered');
  return found;
}
function actor(t, base) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`feudgate${nextIndex}`);
  player.setAttribute('bot-skip-persistence', true); player.setRegistered(true);
  player.setLocation(new core.Location(3300, 3184, 0)); player.setNeedsPlacement(false);
  const skills = player.getSkillManager();
  skills.setMaxLevels(core.Skill.THIEVING, base, false);
  skills.setExperiences(core.Skill.THIEVING, core.SkillManager.getExperienceForLevel(base), false);
  skills.setCurrentLevel(core.Skill.THIEVING, base, false);
  assert.equal(skills.getMaxLevel(core.Skill.THIEVING), base);
  assert.equal(skills.getCurrentLevel(core.Skill.THIEVING), base);
  assert.equal(skills.getExperience(core.Skill.THIEVING), core.SkillManager.getExperienceForLevel(base));
  assert.ok(player.getHitpoints() > 0); assert.notEqual(player.isDyingReturn(), true);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.equal(quest().getStage(player), 0);
  const messages = [];
  const sendMessage = player.sendMessage.bind(player);
  t.mock.method(player, 'sendMessage', (...args) => { messages.push(String(args[0])); return sendMessage(...args); });
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.closeInterruptibleInterfaces(); player.setRegistered(false);
    core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex());
    assert.equal(player.isRegistered(), false);
    assert.equal(core.TaskManager.hasActiveTask(player), false);
    assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
  });
  return { player, connection, messages };
}
function drinkBrew(f) {
  const id = core.ItemIdentifiers.BANDITS_BREW;
  assert.equal(core.CacheDefinitions.getItem(id).inventoryActions[0], 'Drink');
  f.player.getInventory().add(new core.Item(id, 1));
  const slot = f.player.getInventory().getSlotForItemId(id);
  assert.ok(slot >= 0, 'brew is held');
  const item = f.player.getInventory().getItems()[slot];
  assert.equal(PM.emitItemAction({ player: f.player, item, itemId: id, slot,
    interfaceId: core.Inventory.INTERFACE_ID, clickType: 1, option: 'Drink', handled: false }), true);
  assert.equal(f.player.getInventory().getAmount(id), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BEER_GLASS), 1);
  const skills = f.player.getSkillManager();
  assert.equal(skills.getMaxLevel(core.Skill.THIEVING), 29);
  assert.equal(skills.getCurrentLevel(core.Skill.THIEVING), 30);
  assert.equal(skills.getExperience(core.Skill.THIEVING), core.SkillManager.getExperienceForLevel(29));
}
async function chooseStart(f, yes) {
  const id = core.NpcIdentifiers.ALI_MORRISANE;
  const npc = core.NPC.create(id, new core.Location(3300, 3184, 0));
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId: id,
    action: 'Talk-to', clickType: 1, handled: false }), true);
  for (let step = 0; step < 100; step++) {
    const prompt = MultiChatboxPrompt.getPending(f.player);
    if (prompt) {
      let wanted;
      if (prompt.options.includes('Are you really the greatest salesman in the world?')) wanted = 'Are you really the greatest salesman in the world?';
      else if (prompt.options.includes("I'd like to help you, but...")) wanted = "I'd like to help you, but...";
      else if (/Start The Feud quest\?/i.test(prompt.title ?? '')) wanted = yes ? 'Yes.' : 'No.';
      else throw Error(`unexpected Ali menu: ${JSON.stringify({ title: prompt.title, options: prompt.options })}`);
      const choice = prompt.options.indexOf(wanted);
      assert.ok(choice >= 0, `missing actual option ${wanted}`);
      await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 }]);
      f.connection.processTurnPackets();
      if (/Start The Feud quest\?/i.test(prompt.title ?? '')) return;
      continue;
    }
    assert.ok(f.player.getDialogueManager().getCurrent(), 'Ali dialogue reaches the generated start choice');
    const group = f.player.getPacketSender().getChatboxGroupId();
    const child = ({ 231: 5, 217: 5, 229: 4 })[group];
    assert.notEqual(child, undefined, `known dialogue group ${group}`);
    assert.equal(f.player.getPacketSender().isChatboxInterface(group), true);
    await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: -1 }]);
    f.connection.processTurnPackets();
  }
  throw Error('Ali start choice was not reached');
}
test('a real Bandit brew does not admit base 29 Thieving', async t => {
  const f = actor(t, 29); drinkBrew(f);
  const keys = ['quest.the_feud.beers', 'quest.the_feud.gangs', 'quest.the_feud.receipts'];
  const initial = keys.map(key => f.player.getAttribute(key));
  await chooseStart(f, true);
  assert.equal(quest().getStage(f.player), 0);
  assert.deepEqual(keys.map(key => f.player.getAttribute(key)), initial);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BEER_GLASS), 1);
  assert.ok(f.messages.some(text => /Thieving level of 30/i.test(text)), `refusal: ${JSON.stringify(f.messages)}`);
});
test('unboosted Thieving 29 remains refused', async t => {
  const f = actor(t, 29); await chooseStart(f, true);
  assert.equal(quest().getStage(f.player), 0);
  assert.ok(f.messages.some(text => /Thieving level of 30/i.test(text)));
});
test('base and current Thieving 30 can start', async t => {
  const f = actor(t, 30); await chooseStart(f, true);
  assert.equal(quest().getStage(f.player), 1);
});
test('base 30 temporarily drained to 29 preserves current refusal behavior', async t => {
  const f = actor(t, 30); f.player.getSkillManager().setCurrentLevel(core.Skill.THIEVING, 29, false);
  assert.equal(f.player.getSkillManager().getMaxLevel(core.Skill.THIEVING), 30);
  assert.equal(f.player.getSkillManager().getCurrentLevel(core.Skill.THIEVING), 29);
  await chooseStart(f, true); assert.equal(quest().getStage(f.player), 0);
  assert.ok(f.messages.some(text => /Thieving level of 30/i.test(text)));
});
test('No leaves the quest unstarted', async t => {
  const f = actor(t, 30); await chooseStart(f, false);
  assert.equal(quest().getStage(f.player), 0);
});
