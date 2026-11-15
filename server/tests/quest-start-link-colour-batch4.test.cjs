// Run after `yarn build`: node --test tests/quest-start-link-colour-batch4.test.cjs
// Start-message link colour follows the chatbox (chatbox_transparency 4608: <col=081190> opaque / a default player,
// <col=0ab0ff> transparent) for Sheep Shearer, Witch's Potion, Prince Ali Rescue, Dragon Slayer I, Death on the Isle and the
// miniquest His Faithful Servants. These starts are two-step: the real start hook sets the plugin's pending flag (or the
// requirements are met through the real quest registry and skill levels), then the committing line fires; the wording is
// unchanged. Real PluginManager and plugins.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const runtime = require('../plugins/quests/QuestRuntime');

let core, next = 6700;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, transparent) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('startlink4' + next);
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
/** Completes a registered quest through its own registry entry (the plugins ask quest:is-complete, answered by it). */
const complete = (p, key) => { const q = runtime.getRegisteredQuests().find((x) => x.key === key); assert.ok(q, key); q.setStage(p, q.completionValue ?? 2); };

for (const [background, transparent, colour] of [['opaque (a default player)', false, '081190'], ['transparent', true, '0ab0ff']]) {
  const expect = (p, name, kind = 'quest') => assert.ok(p.messages.includes(`You've started a new ${kind}: <col=${colour}>${name}</col>`), p.messages.join('|'));
  test(`Sheep Shearer on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    hook(p, N().FRED_THE_FARMER, 'quest:sheep-shearer:start');
    line(p, N().FRED_THE_FARMER, 'Yes, okay. I can do that.');
    expect(p, 'Sheep Shearer');
  });
  test(`Witch's Potion on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    hook(p, N().HETTY, 'quest:witch-s-potion:start');
    line(p, N().HETTY, "You need an eye of newt, a rat's tail, an onion...");
    expect(p, "Witch's Potion");
  });
  test(`Prince Ali Rescue on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    hook(p, N().CHANCELLOR_HASSAN, 'quest:prince-ali-rescue:start');
    line(p, N().CHANCELLOR_HASSAN, "You'll find our Spymaster, Osman, in the north-east corner of the palace.");
    expect(p, 'Prince Ali Rescue');
  });
  test(`Dragon Slayer I on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    p.setAttribute(runtime.QUEST_POINTS_ATTRIBUTE, 32);
    hook(p, N().GUILDMASTER, 'quest:dragon-slayer-i:start');
    line(p, N().GUILDMASTER, "You'll have to speak to Oziach, the maker of rune platebodies.");
    expect(p, 'Dragon Slayer I');
  });
  test(`Death on the Isle on an ${background} chatbox: the start link is ${colour}`, (t) => {
    const p = actor(t, transparent);
    p.getSkillManager().setMaxLevels(core.Skill.THIEVING, 34, false);
    p.getSkillManager().setMaxLevels(core.Skill.AGILITY, 32, false);
    complete(p, 'children_of_the_sun');
    hook(p, N().PATZI, 'quest:death-on-the-isle:start');
    expect(p, 'Death on the Isle');
  });
  test(`His Faithful Servants (a miniquest) on an ${background} chatbox: the start link is ${colour}, the wording stays 'miniquest'`, (t) => {
    const p = actor(t, transparent);
    complete(p, 'priest_in_peril');
    line(p, N().STRANGE_OLD_MAN, "It's time.");
    expect(p, 'His Faithful Servants', 'miniquest');
  });
}
