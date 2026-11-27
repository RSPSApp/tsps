// From server/: node --test tests/dialogue-lone-box-continue.test.cjs (after yarn build).
//
// A message box sent on its own (StatementDialogue.send, the rowing boat's "You arrive at the
// fishing platform.") has no dialogue chain behind it. Live closes it on its continue (Sea Slug
// capture 20261110T112750, tick 88: resume_pausebutton on messagebox:continue, then
// if_closesub chatbox:chatmodal); ours left the client on "Please wait..." (issue 6879).
// A real Player, PacketSender and DialogueManager.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
process.chdir(path.resolve(__dirname, '..'));
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const core = PluginManager.getCoreApi();

const MESSAGEBOX = 229;
const MESSAGEBOX_CONTINUE = (MESSAGEBOX << 16) | 4;
const OBJECTBOX = 193;
const OBJECTBOX_CONTINUE = (OBJECTBOX << 16) | 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '..', 'plugins'));
  core.RegionManager.init();
});

let index = 3100;
function player() {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(`lonebox${index}`);
  p.setLocation(new core.Location(2782, 3273, 0));
  p.setRegistered(true);
  return p;
}

/** A player behind a real ClientConnection, so continues go through the packet dispatch. */
function connected(x, y) {
  const p = player();
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  p.setAttribute('tutorial-island:progress', 1000);
  const connection = new ClientConnection(p.getSession().getChannel());
  connection.player = p;
  return { p, connection };
}

async function continuePacket({ connection }, widgetId) {
  await connection.dispatch([{ type: 'dialogue_continue', widgetId, childIndex: -1 }]);
  connection.processTurnPackets();
}

const chatbox = (p) => p.getPacketSender().getChatboxGroupId();

test('the continue of a lone message box closes it', () => {
  const p = player();
  core.StatementDialogue.send(p, 'You arrive at the fishing platform.');
  assert.equal(chatbox(p), MESSAGEBOX);
  assert.equal(p.getDialogueManager().isActive(), false, 'no chain behind the box');
  assert.equal(p.getDialogueManager().handleResume(MESSAGEBOX_CONTINUE, -1), true);
  assert.equal(chatbox(p), -1, 'the chatbox is closed, not left on "Please wait..."');
});

test('a lone item box closes on its continue too', () => {
  const p = player();
  core.ItemStatementDialogue.send(p, core.ItemIdentifiers.UNLIT_TORCH, 'Bailey gives you a torch.');
  assert.equal(chatbox(p), OBJECTBOX);
  assert.equal(p.getDialogueManager().handleResume(OBJECTBOX_CONTINUE, -1), true);
  assert.equal(chatbox(p), -1);
});

test('a continue for a box that is not open changes nothing', () => {
  const p = player();
  assert.equal(p.getDialogueManager().handleResume(MESSAGEBOX_CONTINUE, -1), false);
  core.StatementDialogue.send(p, 'You arrive on a small island.');
  assert.equal(p.getDialogueManager().handleResume(OBJECTBOX_CONTINUE, -1), false, 'another group: not this box');
  assert.equal(chatbox(p), MESSAGEBOX, 'the open box stays');
});

test('a chain still advances through its boxes rather than closing', () => {
  const p = player();
  const chain = new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, 'First.'))
    .add(new core.StatementDialogue(1, 'Second.'));
  p.getDialogueManager().startDialogues(chain);
  assert.equal(p.getDialogueManager().handleResume(MESSAGEBOX_CONTINUE, -1), true);
  assert.equal(p.getDialogueManager().getCurrent()?.getText?.(), 'Second.');
  assert.equal(chatbox(p), MESSAGEBOX);
  assert.equal(p.getDialogueManager().handleResume(MESSAGEBOX_CONTINUE, -1), true);
  assert.equal(chatbox(p), -1, 'the chain ends and closes');
});

test("Holgart's rowing arrival box closes on the continue packet (capture tick 88)", async () => {
  const actor = connected(2720, 3305);
  const request = { player: actor.p, route: 'sea-slug-platform', handled: false };
  PluginManager.emitCustomEvent('ferries:travel', request);
  assert.equal(request.handled, true);
  for (let tick = 0; tick < 12; tick++) core.TaskManager.process();
  assert.deepEqual([actor.p.getLocation().getX(), actor.p.getLocation().getY()], [2782, 3273]);
  assert.equal(chatbox(actor.p), MESSAGEBOX, '"You arrive at the fishing platform."');
  await continuePacket(actor, MESSAGEBOX_CONTINUE);
  assert.equal(chatbox(actor.p), -1);
});

test('a held box (sent without its continue) stays for its scene', async () => {
  const actor = connected(3222, 3222);
  core.StatementDialogue.send(actor.p, 'Kennith scrambles through the broken wall...', false);
  await continuePacket(actor, MESSAGEBOX_CONTINUE);
  assert.equal(chatbox(actor.p), MESSAGEBOX, 'live ignores a resume on a box with no continue');
  core.StatementDialogue.send(actor.p, 'Down below, you see Holgart collect the boy from the crane and lead him away to safety.');
  await continuePacket(actor, MESSAGEBOX_CONTINUE);
  assert.equal(chatbox(actor.p), -1, 'the next box, with its continue, closes');
});
