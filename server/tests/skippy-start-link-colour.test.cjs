// Run after `yarn build`: node --test tests/skippy-start-link-colour.test.cjs
// Skippy and the Mogres (a miniquest): the start message keeps its own wording ("miniquest") and the quest link follows the
// player's chatbox background (chatbox_transparency 4608: <col=081190> opaque, <col=0ab0ff> transparent). The start is the
// dialogue action "skippy:throw-water" with a bucket of water, through the real PluginManager and the real plugin.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');

const STAGE = 'quest.skippy_and_the_mogres.stage';
let core, next = 6100;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

for (const [background, transparent, colour] of [['opaque (a default player)', false, '081190'], ['transparent', true, '0ab0ff']]) {
  test(`starting Skippy and the Mogres on an ${background} chatbox: the miniquest link is ${colour}`, (t) => {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
    const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('skippy' + next);
    p.setRegistered(true); p.setLocation(new core.Location(2984, 3197, 0)); p.needsPlacement = false;
    t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
    if (transparent) p.getPacketSender().sendVarbit(4608, 1);
    const messages = [];
    p.sendMessage = (text) => { messages.push(text); };
    p.getInventory().adds(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
    PM.emitCustomEvent('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.SKIPPY, stepId: 'skippy:throw-water', handled: false });
    assert.equal(p.getAttribute(STAGE) ?? 0, 1, 'the miniquest started');
    assert.ok(messages.includes(`You've started a new miniquest: <col=${colour}>Skippy and the Mogres</col>`), messages.join('|'));
  });
}
