// Run after `yarn build`: node --test tests/haunted-mine-zealot-history.test.cjs
//
// Transcript:Haunted Mine: "Can you explain the history of these mines again?" in the Zealot's talk-again menus is
// "(same as above)": he tells the starting-out history again. The dump keeps only an unresolvable jump (lZ-7gL), so
// the chat ended after the player's line. Every plugin loaded, a real Player, the Zealot's own spawn and native
// npc_option / dialogue_continue packets.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');

const ZEALOT = { id: 3611, at: [3444, 3258] };
const QUESTION = 'Can you explain the history of these mines again?';
const FIRST = 'Well, below the very ground you stand upon lies an intricate network of tunnels';
const LAST = "Further, Zamorak's then ruler upon the land ordered the slaughter of anyone within the mines and that the mines be sealed.";
let core, next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(ZEALOT.at[0], ZEALOT.at[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function zealot() {
  return [...core.World.getNpcs()].find((npc) => npc && npc.getId() === ZEALOT.id)
    ?? PM.spawnNpc({ id: ZEALOT.id, x: ZEALOT.at[0], y: ZEALOT.at[1], z: 0, wanderRadius: 0 });
}

function harness(t, npc, stage) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('zealot' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setAttribute('quest.haunted_mine.stage', stage);
  const at = npc.getLocation();
  player.setLocation(new core.Location(at.getX() + 1, at.getY(), at.getZ())); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => { core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets(); };
  const send = async (packet) => { await c.dispatch([packet]); for (let i = 0; i < 3; i++) tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  const text = () => player.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
  const said = [];
  async function menu() {
    for (let i = 0; i < 40; i++) {
      const current = player.getDialogueManager().getCurrent();
      if (typeof current?.getOptions === 'function') return current.getOptions();
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      if (text()) said.push(text());
      await send({ type: 'dialogue_continue', widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
    return null;
  }
  async function choose(option) {
    const options = await menu();
    assert.ok(options?.includes(option), `${option} in ${JSON.stringify(options)}`);
    await send({ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: options.indexOf(option) + 1 });
  }
  async function talk() {
    const op = npc.getCurrentDefinition(player).getActions().findIndex((action) => action === 'Talk-to') + 1;
    await send({ type: 'npc_option', index: npc.getIndex(), clickType: op });
  }
  return { player, said, menu, choose, talk };
}

for (const [stage, label] of [[1, 'after starting the quest'], [3, 'after finding the second entrance']]) {
  test(`the history question ${label} retells the starting-out history, then its menu`, async (t) => {
    const h = harness(t, zealot(), stage);
    await h.talk();
    await h.choose(QUESTION);
    const options = await h.menu();
    const asked = h.said.indexOf(QUESTION);
    assert.ok(asked >= 0, `the question is said: ${JSON.stringify(h.said)}`);
    const first = h.said.findIndex((line) => line.startsWith(FIRST));
    assert.ok(first > asked, `the history follows the question: ${JSON.stringify(h.said)}`);
    assert.ok(h.said.indexOf(LAST) > first, 'the whole history is told');
    assert.equal(h.said.filter((line) => line === QUESTION).length, 1, 'the question is said once');
    assert.deepEqual(options, [
      'Is there any other way into the mines?',
      'How does a lost artefact that was only legendary help?',
      'Why was everyone in the mines slaughtered?',
      'I must be going now.',
    ], 'the menu after the history, as above');
  });
}
