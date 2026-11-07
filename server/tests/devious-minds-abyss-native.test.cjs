// Synthetic unregistered NPCs dispatch registered interactions; no natural walk or full miniquest is claimed.
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
let core, index = 4600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function quest(key) {
  const result = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === key);
  assert.ok(result, `registered ${key}`);
  return result;
}
function actor(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername(`devgate${index}`);
  player.setAttribute('bot-skip-persistence', true); player.setRegistered(true); player.setNeedsPlacement(false);
  assert.ok(player.getHitpoints() > 0); assert.notEqual(player.isDyingReturn(), true);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  const connection = new ClientConnection(channel); connection.player = player;
  const lines = [];
  const sender = player.getPacketSender();
  const originalSendString = sender.sendString.bind(sender);
  t.mock.method(sender, 'sendString', (text, widgetId, ...rest) => {
    if (widgetId === ((231 << 16) | 6)) lines.push(String(text));
    return originalSendString(text, widgetId, ...rest);
  });
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.closeInterruptibleInterfaces(); player.setRegistered(false);
    core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex());
    assert.equal(player.isRegistered(), false);
    assert.equal(core.TaskManager.hasActiveTask(player), false);
    assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
  });
  return { player, connection, lines };
}
function completed(player, key) {
  const event = { player, key, complete: null };
  PM.emitCustomEvent('quest:is-complete', event);
  return event.complete === true;
}
function talk(f, id, x, y) {
  const npc = core.NPC.create(id, new core.Location(x, y, 0));
  f.player.setLocation(new core.Location(x, y, 0));
  return PM.emitNpcInteraction({ player: f.player, npc, npcId: id, action: 'Talk-to', clickType: 1, handled: false });
}
async function nextLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  const child = ({ 231: 5, 217: 5, 229: 4 })[group];
  assert.notEqual(child, undefined, `known owned dialogue group ${group}`);
  assert.equal(f.player.getPacketSender().isChatboxInterface(group), true);
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: -1 }]);
  f.connection.processTurnPackets();
}
async function finish(f) {
  for (let n = 0; n < 80; n++) {
    const current = f.player.getDialogueManager().getCurrent();
    const pending = MultiChatboxPrompt.getPending(f.player);
    if (pending) return pending;
    if (!current) return null;
    await nextLine(f);
  }
  throw Error('dialogue did not finish or present a choice');
}
async function choose(f, option) {
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option }]);
  f.connection.processTurnPackets();
}
function level(player, skill, value) {
  const skills = player.getSkillManager();
  skills.setMaxLevels(skill, value, false);
  skills.setExperiences(skill, core.SkillManager.getExperienceForLevel(value), false);
  skills.setCurrentLevel(skill, value, false);
  assert.equal(skills.getMaxLevel(skill), value); assert.equal(skills.getCurrentLevel(skill), value);
}
function prerequisites(f) {
  for (const key of ['wanted', 'troll_stronghold', 'dorics_quest', 'rune_mysteries']) {
    const q = quest(key); q.setStage(f.player, q.completionValue);
    assert.equal(completed(f.player, key), true);
  }
  level(f.player, core.Skill.RUNECRAFTING, 50);
  level(f.player, core.Skill.FLETCHING, 50);
  level(f.player, core.Skill.SMITHING, 65);
  assert.equal(quest('devious_minds').getStage(f.player), 0);
}
async function partial(f) {
  assert.equal(talk(f, core.NpcIdentifiers.MAGE_OF_ZAMORAK, 3106, 3558), true);
  assert.equal(quest('enter_the_abyss').getStage(f.player), 1);
  assert.equal(completed(f.player, 'enter_the_abyss'), false);
  f.player.closeInterruptibleInterfaces();
}
function hasRefusal(lines) {
  return lines.some(text => text.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ')
    .includes('I thought you were someone else'));
}
async function monk(f) {
  f.lines.length = 0;
  assert.equal(talk(f, core.NpcIdentifiers.MONK_14, 2853, 3349), true);
  let yes = false;
  for (let i = 0; i < 10; i++) {
    const prompt = await finish(f);
    if (!prompt) return yes;
    assert.match(prompt.title, /Start the Devious Minds quest/i);
    const choice = prompt.options.findIndex(text => /^yes\b/i.test(text));
    assert.ok(choice >= 0, 'actual source Yes is present');
    yes = true; await choose(f, choice + 1);
  }
  throw Error('Monk dialogue exceeded the choice limit');
}
test('partial Abyss cannot start Devious Minds through the real Monk dialogue', async t => {
  const f = actor(t); prerequisites(f); await partial(f);
  const variant = PM.emitNpcDialogueVariant({ player: f.player, npcId: core.NpcIdentifiers.MONK_14 });
  assert.ok(variant === 'starting-off-talking-to-the-monk' || variant?.page === 'Monk (Devious Minds)', 'known source branch');
  const yes = await monk(f);
  if (!yes) {
    assert.equal(variant?.page, 'Monk (Devious Minds)', 'refusal branch is selected');
    assert.ok(hasRefusal(f.lines), `actual refusal dialogue was reached: ${JSON.stringify(f.lines)}`);
  }
  assert.equal(quest('devious_minds').getStage(f.player), 0);
});
test('actual Mage hand-in completes Abyss and permits the real Monk start', async t => {
  const f = actor(t); prerequisites(f);
  quest('enter_the_abyss').setStage(f.player, 3);
  assert.equal(quest('enter_the_abyss').getStage(f.player), 3);
  assert.equal(completed(f.player, 'enter_the_abyss'), false);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.SCRYING_ORB, 1));
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SCRYING_ORB), 1);
  assert.ok(f.player.getInventory().getFreeSlots() >= 2);
  const xp = f.player.getSkillManager().getExperience(core.Skill.RUNECRAFTING);
  assert.equal(core.GameConstants.EXPERIENCE_MULTIPLIER, 1);
  const gate = PM.emitCanGainExperience(f.player, core.Skill.RUNECRAFTING, 1000);
  assert.notEqual(gate.allow, false); assert.equal(gate.multiplier, 1);
  assert.equal(talk(f, core.NpcIdentifiers.MAGE_OF_ZAMORAK_3, 3260, 3383), true);
  assert.equal(await finish(f), null);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SCRYING_ORB), 0);
  assert.equal(quest('enter_the_abyss').getStage(f.player), 4);
  assert.equal(completed(f.player, 'enter_the_abyss'), true);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ABYSSAL_BOOK), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.SMALL_POUCH), 1);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.RUNECRAFTING) - xp, 1000);
  assert.equal(await monk(f), true); assert.equal(quest('devious_minds').getStage(f.player), 1);
});
test('unfinished Wanted remains a refusal', async t => {
  const f = actor(t); prerequisites(f);
  quest('enter_the_abyss').setStage(f.player, 4);
  assert.equal(completed(f.player, 'enter_the_abyss'), true);
  quest('wanted').setStage(f.player, 0); assert.equal(completed(f.player, 'wanted'), false);
  assert.equal(await monk(f), false); assert.equal(quest('devious_minds').getStage(f.player), 0);
  assert.ok(hasRefusal(f.lines), `actual refusal dialogue was reached: ${JSON.stringify(f.lines)}`);
});
test('Runecrafting below 50 remains a refusal', async t => {
  const f = actor(t); prerequisites(f);
  quest('enter_the_abyss').setStage(f.player, 4);
  assert.equal(completed(f.player, 'enter_the_abyss'), true);
  level(f.player, core.Skill.RUNECRAFTING, 49);
  assert.equal(await monk(f), false); assert.equal(quest('devious_minds').getStage(f.player), 0);
  assert.ok(hasRefusal(f.lines), `actual refusal dialogue was reached: ${JSON.stringify(f.lines)}`);
});
