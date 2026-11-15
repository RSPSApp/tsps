// Run after `yarn build`: node --test tests/quest-start-link-colour-batch2.test.cjs
// Start-message link colour follows the chatbox (chatbox_transparency 4608: <col=081190> opaque / a default player,
// <col=0ab0ff> transparent) for The Knight's Sword, Vampyre Slayer, Doric's Quest, Goblin Diplomacy and Black Knights'
// Fortress: each quest's own start trigger through the real PluginManager and the real plugin; the wording is unchanged.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { QUEST_POINTS_ATTRIBUTE } = require('../plugins/quests/QuestRuntime');

let core, next = 6300;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, transparent) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('startlink' + next);
  p.setRegistered(true); p.setLocation(new core.Location(2965, 3385, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  if (transparent) p.getPacketSender().sendVarbit(4608, 1);
  p.messages = [];
  p.sendMessage = (text) => { p.messages.push(text); };
  return p;
}
const N = () => core.NpcIdentifiers;
const hook = (p, npcId, hookName) => PM.emitCustomEvent('npc-dialogue:hook', { player: p, npcId, hook: hookName });
/** A dialogue line whose `before` callback commits the start (the plugin sets it on the event). */
const line = (p, npcId, text) => { const event = { player: p, npcId, text, step: {} }; PM.emitCustomEvent('npc-dialogue:line', event); event.before?.(); event.after?.(); };

for (const [background, transparent, colour] of [['opaque (a default player)', false, '081190'], ['transparent', true, '0ab0ff']]) {
  const expect = (p, name) => assert.ok(p.messages.includes(`You've started a new quest: <col=${colour}>${name}</col>`), p.messages.join('|'));
  test(`The Knight's Sword on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    hook(p, N().SQUIRE_14, 'quest:the-knight-s-sword:start');
    expect(p, "The Knight's Sword");
  });
  test(`Vampyre Slayer on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    hook(p, N().MORGAN, 'quest:vampyre-slayer:start');
    expect(p, 'Vampyre Slayer');
  });
  test(`Doric's Quest on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    line(p, N().DORIC, 'Clay is what I use more than anything, to make casts.');
    expect(p, "Doric's Quest");
  });
  test(`Goblin Diplomacy on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    line(p, N().GENERAL_BENTNOZE, 'Yep, bring us orange armour.');
    expect(p, 'Goblin Diplomacy');
  });
  test(`Black Knights' Fortress on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    p.setAttribute(QUEST_POINTS_ATTRIBUTE, 12);
    line(p, N().SIR_AMIK_VARZE_4, 'Good luck! Let me know how you get on.');
    expect(p, "Black Knights' Fortress");
  });
}
