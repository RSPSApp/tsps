// Run after `yarn build`: node --test tests/mor-ul-rek-cape-on-guard.test.cjs
// A fire cape used on Mor Ul Rek's TzHaar-Ket guard plays the recorded exchange (rsprox_transcripts/
// 234/03276.txt tick 25553; 237/01141.txt, 227/00083.txt): the player's line, "You hold out your fire
// cape and show it to TzHaar-Ket." in a box, then his two replies; the box grants access. Real plugins,
// a real Player, the native item_on_npc packet and native dialogue continues.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test('a fire cape used on the guard plays the exchange and grants access', async (t) => {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2740); p.setUsername('morulrektest');
  p.setRegistered(true); p.setLocation(new core.Location(2458, 5122, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const guard = core.NPC.create(core.NpcIdentifiers.TZHAAR_KET_9, new core.Location(2458, 5121, 0));
  core.World.getNpcs().add(guard);
  t.after(() => { core.World.getNpcs().remove(guard); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.getInventory().add(new core.Item(core.ItemIdentifiers.FIRE_CAPE, 1), true);
  const send = async (packet) => { await c.dispatch([packet]); c.processTurnPackets(); for (let i = 0; i < 4; i++) { core.TaskManager.processWalkTo(p.getIndex()); p.getMovementQueue().process(); core.TaskManager.process(); } };
  await send({ type: 'item_on_npc', widgetId: 149 << 16, targetIndex: guard.getIndex(), itemId: core.ItemIdentifiers.FIRE_CAPE, slot: 0 });
  const seen = [];
  let capeBox = null;
  const text = () => String(p.getDialogueManager().getCurrent()?.getText?.() ?? '').replace(/\s+/g, ' ');
  for (let i = 0; i < 24 && p.getDialogueManager().isActive(); i++) {
    if (seen.at(-1) !== text()) seen.push(text());
    const current = p.getDialogueManager().getCurrent();
    if (text().includes('You hold out your fire cape')) capeBox = { item: current?.getItemId?.() };
    const before = p.getDialogueManager().getCurrent();
    for (const w of [(217 << 16) | 5, (231 << 16) | 5, (193 << 16) | 0, (229 << 16) | 0]) {
      await send({ type: 'dialogue_continue', widgetId: w, childIndex: -1 });
      if (p.getDialogueManager().getCurrent() !== before) break;
    }
  }
  assert.ok(seen.some((s) => s.includes('defeat TzTok-Jad')), seen.join(' | '));
  assert.ok(seen.some((s) => s.includes('grant you access to Mor Ul Rek')), seen.join(' | '));
  // The box step is the objectbox with the cape (rsprox_transcripts/234/03276.txt tick 25555), not a chat line.
  assert.deepEqual(capeBox, { item: core.ItemIdentifiers.FIRE_CAPE }, seen.join(' | '));
  assert.equal(p.getAttribute('mor-ul-rek:access'), true);
});
