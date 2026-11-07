// Registered generated dialogue with seeded quest states and synthetic NPCs; no natural travel or full playthrough.
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
let core, nextIndex = 5100;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi(); PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function quest(key) {
  const found = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === key);
  assert.ok(found, `registered quest ${key}`); return found;
}
function completeQuery(player, key) {
  const event = { player, key, complete: false }; PM.emitCustomEvent('quest:is-complete', event); return event.complete;
}
function actor(t, lowSkill, jungleComplete = true) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const errors = [], warnings = [];
  const originalError = console.error.bind(console), originalWarn = console.warn.bind(console);
  t.mock.method(console, 'error', (...args) => { errors.push(args); return originalError(...args); });
  t.mock.method(console, 'warn', (...args) => {
    if (String(args[0]).includes('[plugins]')) warnings.push(args);
    return originalWarn(...args);
  });
  t.after(() => {
    const index = player.getIndex();
    try { PM.emitPlayerLogout({ player, username: player.getUsername() }); }
    finally {
      player.closeInterruptibleInterfaces(); core.World.getPlayers().remove(player);
      core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(index);
      assert.equal(player.isRegistered(), false);
      assert.equal(core.TaskManager.hasActiveTask(player), false);
      assert.equal(core.TaskManager.hasActiveTask(index), false);
      assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
    }
  });
  player.setUsername(`triogate${nextIndex++}`);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  assert.notEqual(player.getLongUsername(), 0n);
  player.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(player), true);
  player.setLocation(new core.Location(2795, 3151, 1)); player.setNeedsPlacement(false);
  const skills = player.getSkillManager();
  for (const [skill, threshold] of [[core.Skill.FIREMAKING, 30], [core.Skill.COOKING, 30],
    [core.Skill.AGILITY, 15], [core.Skill.FISHING, 5], [core.Skill.HERBLORE, 30]]) {
    const level = skill === lowSkill ? threshold - 1 : threshold;
    skills.setMaxLevels(skill, level, false);
    skills.setExperiences(skill, core.SkillManager.getExperienceForLevel(level), false);
    skills.setCurrentLevel(skill, level, false);
    assert.equal(skills.getMaxLevel(skill), level); assert.equal(skills.getCurrentLevel(skill), level);
    assert.equal(skills.getExperience(skill), core.SkillManager.getExperienceForLevel(level));
  }
  const druidic = quest('druidic_ritual'); druidic.setStage(player, druidic.completionValue);
  assert.equal(completeQuery(player, 'druidic_ritual'), true);
  const jungle = quest('jungle_potion');
  if (jungleComplete) jungle.setStage(player, jungle.completionValue);
  assert.equal(completeQuery(player, 'jungle_potion'), jungleComplete);
  assert.equal(quest('tai_bwo_wannai_trio').getStage(player), 0);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.ok(player.getHitpoints() > 0); assert.notEqual(player.isDyingReturn(), true);
  const connection = new ClientConnection(channel); connection.player = player;
  return { player, connection };
}
async function advance(f) {
  assert.ok(f.player.getDialogueManager().getCurrent(), 'active generated dialogue');
  const group = f.player.getPacketSender().getChatboxGroupId();
  const child = ({ 231: 5, 217: 5, 229: 4 })[group];
  assert.notEqual(child, undefined, `known dialogue group ${group}`);
  assert.equal(f.player.getPacketSender().isChatboxInterface(group), true);
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: -1 }]);
  f.connection.processTurnPackets();
}
async function choose(f, prompt, option) {
  const index = prompt.options.indexOf(option);
  assert.ok(index >= 0, `missing actual option ${option}: ${JSON.stringify(prompt.options)}`);
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  f.connection.processTurnPackets();
}
async function startTrio(f, yes, jungleComplete = true) {
  const id = core.NpcIdentifiers.TIMFRAKU;
  const npc = core.NPC.create(id, new core.Location(2795, 3151, 1));
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId: id,
    action: 'Talk-to', clickType: 1, handled: false }), true);
  for (let step = 0; step < 100; step++) {
    const prompt = MultiChatboxPrompt.getPending(f.player);
    if (!prompt) { await advance(f); continue; }
    if (/Start the Tai Bwo Wannai Trio quest\?/i.test(prompt.title ?? '')) {
      assert.equal(quest('tai_bwo_wannai_trio').getStage(f.player), jungleComplete ? 2 : 0);
      assert.equal(quest('tai_bwo_wannai_trio').isStarted(f.player), false);
      await choose(f, prompt, yes ? 'Yes.' : 'No.'); return;
    }
    const options = ['I am a roving adventurer.', 'Trufitus sent me.', 'Your gratitude is all I deserve.'];
    const wanted = options.find(option => prompt.options.includes(option));
    assert.ok(wanted, `unexpected Timfraku menu: ${JSON.stringify(prompt.options)}`);
    await choose(f, prompt, wanted);
  }
  throw Error('Timfraku start choice was not reached');
}
for (const name of ['FIREMAKING', 'COOKING', 'AGILITY', 'FISHING']) {
  test(`below ${name} start threshold can accept the generated offer`, async t => {
    const f = actor(t, core.Skill[name]); await startTrio(f, true);
    assert.equal(quest('tai_bwo_wannai_trio').getStage(f.player), 3);
    assert.equal(quest('tai_bwo_wannai_trio').isStarted(f.player), true);
  });
}
test('threshold skills remain a positive start control', async t => {
  const f = actor(t); await startTrio(f, true);
  assert.equal(quest('tai_bwo_wannai_trio').getStage(f.player), 3);
});
test('No keeps the generated conversation at pre-start stage 2', async t => {
  const f = actor(t); await startTrio(f, false);
  assert.equal(quest('tai_bwo_wannai_trio').getStage(f.player), 2);
  assert.equal(quest('tai_bwo_wannai_trio').isStarted(f.player), false);
});
test('missing Jungle Potion keeps the quest unstarted', async t => {
  const f = actor(t, undefined, false); await startTrio(f, true, false);
  assert.equal(quest('tai_bwo_wannai_trio').getStage(f.player), 0);
  assert.equal(completeQuery(f.player, 'jungle_potion'), false);
});
test('registered Trufitus hand-in completes Jungle Potion', async t => {
  const f = actor(t, undefined, false), jungle = quest('jungle_potion');
  jungle.setStage(f.player, 10); f.player.getInventory().add(new core.Item(core.ItemIdentifiers.ROGUES_PURSE, 1));
  assert.equal(jungle.getStage(f.player), 10);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ROGUES_PURSE), 1);
  assert.equal(completeQuery(f.player, 'jungle_potion'), false);
  const id = core.NpcIdentifiers.TRUFITUS;
  const npc = core.NPC.create(id, new core.Location(2794, 3064, 0));
  f.player.setLocation(new core.Location(2794, 3064, 0)); f.player.setNeedsPlacement(false);
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId: id,
    action: 'Talk-to', clickType: 1, handled: false }), true);
  for (let step = 0; step < 80 && !jungle.isComplete(f.player); step++) {
    const prompt = MultiChatboxPrompt.getPending(f.player);
    if (prompt) await choose(f, prompt, 'Of course!'); else await advance(f);
  }
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ROGUES_PURSE), 0);
  assert.equal(jungle.getStage(f.player), 12);
  assert.equal(completeQuery(f.player, 'jungle_potion'), true);
  // Close the completion presentation via its registered client route before the next conversation.
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets();
  f.player.setLocation(new core.Location(2795, 3151, 1)); f.player.setNeedsPlacement(false);
  await startTrio(f, true);
  assert.equal(quest('tai_bwo_wannai_trio').getStage(f.player), 3);
  assert.equal(quest('tai_bwo_wannai_trio').isStarted(f.player), true);
});
