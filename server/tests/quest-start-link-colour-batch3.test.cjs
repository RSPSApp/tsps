// Run after `yarn build`: node --test tests/quest-start-link-colour-batch3.test.cjs
// Start-message link colour follows the chatbox (chatbox_transparency 4608: <col=081190> opaque / a default player,
// <col=0ab0ff> transparent) for Below Ice Mountain, Ernest the Chicken, Waterfall Quest, X Marks the Spot and The Corsair
// Curse: each quest's own start trigger through the real PluginManager and the real plugin; the wording is unchanged.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { QUEST_POINTS_ATTRIBUTE } = require('../plugins/quests/QuestRuntime');

let core, next = 6500;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, transparent) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('startlink3' + next);
  p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  if (transparent) p.getPacketSender().sendVarbit(4608, 1);
  p.messages = [];
  p.sendMessage = (text) => { p.messages.push(text); };
  return p;
}
const N = () => core.NpcIdentifiers;
const hook = (p, npcId, hookName) => PM.emitCustomEvent('npc-dialogue:hook', { player: p, npcId, hook: hookName });
const line = (p, npcId, text) => { const event = { player: p, npcId, text, step: {} }; PM.emitCustomEvent('npc-dialogue:line', event); event.before?.(); event.after?.(); };

for (const [background, transparent, colour] of [['opaque (a default player)', false, '081190'], ['transparent', true, '0ab0ff']]) {
  const expect = (p, name) => assert.ok(p.messages.includes(`You've started a new quest: <col=${colour}>${name}</col>`), p.messages.join('|'));
  test(`Below Ice Mountain on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    p.setAttribute(QUEST_POINTS_ATTRIBUTE, 16);
    PM.emitCustomEvent('npc-dialogue:choice', { player: p, npcId: N().WILLOW, option: 'Yes.' });
    expect(p, 'Below Ice Mountain');
  });
  test(`Ernest the Chicken on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    hook(p, N().VERONICA, 'quest:ernest-the-chicken:start');
    expect(p, 'Ernest the Chicken');
  });
  test(`Waterfall Quest on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    hook(p, N().ALMERA, 'quest:waterfall-quest:start');
    expect(p, 'Waterfall Quest');
  });
  test(`X Marks the Spot on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    line(p, N().VEOS, 'Sounds good, what should I do?');
    expect(p, 'X Marks the Spot');
  });
  test(`The Corsair Curse on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    line(p, N().CAPTAIN_TOCK, "Sure, I'll try to help with your curse.");
    expect(p, 'The Corsair Curse');
  });
}
