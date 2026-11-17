// Run after `yarn build`: node --test tests/quest-start-link-colour-batch5.test.cjs
// Start-message link colour follows the chatbox (chatbox_transparency 4608: <col=081190> opaque / a default player,
// <col=0ab0ff> transparent) for Secrets of the North, The Heart of Darkness, The Ribbiting Tale of a Lily Pad Labour Dispute
// and Desert Treasure II - The Fallen Empire (the last two pass their page name to questStartMessage unchanged). Each start
// path is the plugin's real one: requirements through skill levels and the quest registry, the start hook, the committing
// line, or the vault door's object interaction and its "Start the quest?" prompt. Real PluginManager and plugins.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const runtime = require('../plugins/quests/QuestRuntime');

let core, next = 6900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, transparent, x = 3222, y = 3218) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('startlink5' + next);
  p.setRegistered(true); p.setLocation(new core.Location(x, y, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  if (transparent) p.getPacketSender().sendVarbit(4608, 1);
  p.messages = [];
  p.sendMessage = (text) => { p.messages.push(text); };
  return p;
}
const N = () => core.NpcIdentifiers;
const hook = (p, npcId, hookName) => PM.emitCustomEvent('npc-dialogue:hook', { player: p, npcId, hook: hookName });
const line = (p, npcId, text) => { const event = { player: p, npcId, text, step: {} }; PM.emitCustomEvent('npc-dialogue:line', event); event.before?.(); event.after?.(); };
const complete = (p, key) => { const q = runtime.getRegisteredQuests().find((x) => x.key === key); assert.ok(q, key); q.setStage(p, q.completionValue ?? 2); };
const levels = (p, pairs) => { for (const [skill, level] of pairs) p.getSkillManager().setMaxLevels(skill, level, false); };

for (const [background, transparent, colour] of [['opaque (a default player)', false, '081190'], ['transparent', true, '0ab0ff']]) {
  const expect = (p, name) => assert.ok(p.messages.includes(`You've started a new quest: <col=${colour}>${name}</col>`), p.messages.join('|'));
  test(`Secrets of the North on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    levels(p, [[core.Skill.AGILITY, 69], [core.Skill.THIEVING, 64], [core.Skill.HUNTER, 56]]);
    for (const key of ['making_friends_with_my_arm', 'devious_minds', 'hazeel_cult']) complete(p, key);
    PM.emitCustomEvent('npc-dialogue:hook', { player: p, hook: 'quest:secrets-of-the-north:start' });
    expect(p, 'Secrets of the North');
  });
  test(`The Heart of Darkness on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    levels(p, [[core.Skill.MINING, 55], [core.Skill.THIEVING, 48], [core.Skill.SLAYER, 48], [core.Skill.AGILITY, 46]]);
    complete(p, 'twilights_promise');
    PM.emitCustomEvent('npc-dialogue:hook', { player: p, hook: 'quest:the-heart-of-darkness:start' });
    expect(p, 'The Heart of Darkness');
  });
  test(`The Ribbiting Tale of a Lily Pad Labour Dispute on an ${background} chatbox: the start link is ${colour} (the page name passes through unchanged)`, (t) => {
    const p = actor(t, transparent);
    levels(p, [[core.Skill.WOODCUTTING, 15]]);
    complete(p, 'children_of_the_sun');
    hook(p, N().MARCELLUS, 'quest:the-ribbiting-tale-of-a-lily-pad-labour-dispute:start');
    line(p, N().MARCELLUS, 'Okay then... Well provided that you can help us');
    expect(p, 'The Ribbiting Tale of a Lily Pad Labour Dispute');
  });
  test(`Desert Treasure II on an ${background} chatbox: the start link is ${colour} (the page name passes through unchanged)`, (t) => {
    const p = actor(t, transparent, 3511, 2970);
    p.setSpellbook(core.MagicSpellbook.ANCIENT);
    levels(p, [[core.Skill.FIREMAKING, 75], [core.Skill.MAGIC, 75], [core.Skill.THIEVING, 70], [core.Skill.HERBLORE, 62], [core.Skill.RUNECRAFTING, 60], [core.Skill.CONSTRUCTION, 60]]);
    for (const key of ['desert_treasure_i', 'secrets_of_the_north', 'enakhras_lament', 'temple_of_the_eye', 'the_garden_of_death', 'below_ice_mountain', 'his_faithful_servants']) complete(p, key);
    const object = new core.GameObject(core.ObjectIdentifiers.VAULT_DOOR_2, new core.Location(3511, 2970, 0), 10, 0, null);
    PM.emitObjectInteraction({ player: p, object, objectId: object.getId(), location: object.getLocation(), clickType: 1 });
    const pending = MultiChatboxPrompt.getPending(p);
    assert.ok(pending && /Desert Treasure II/.test(pending.title), JSON.stringify(pending));
    MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, action: 1 });
    expect(p, 'Desert Treasure II - The Fallen Empire');
  });
}
