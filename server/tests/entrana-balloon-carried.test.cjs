// Seeded quest and registered balloon action; not a natural quest or client playthrough.
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
let core, Common, Travel, Storage, quest, nextIndex = 5400;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi(); core.RegionManager.init();
  core.RegionManager.loadMapFiles(2938, 3421); core.RegionManager.loadMapFiles(2808, 3354);
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); PM.emitServerStartup({});
  Common = require('../plugins/world/balloontransport/Common.BalloonTransport');
  Travel = require('../plugins/world/balloontransport/Travel.BalloonTransport');
  Storage = require('../plugins/world/balloontransport/Storage.BalloonTransport');
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'enlightened_journey');
  assert.ok(quest);
});
after(() => PM.emitServerShutdown({}));
function actor(t, { carried = false, worn = false, ask = false } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(nextIndex++); p.setRegistered(true);
  p.setUsername(`entbal${nextIndex}`); p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(2938, 3421, 0)); p.setNeedsPlacement(false);
  const connection = new ClientConnection(channel); connection.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    for (let tick = 0; tick < 12; tick++) core.TaskManager.process();
    p.closeInterruptibleInterfaces(); p.setRegistered(false);
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    assert.equal(Travel.flying(p), false);
    assert.equal(p.getMovementQueue().isMovementBlocked(), false);
    assert.equal(p.isRegistered(), false);
    assert.equal(core.TaskManager.hasActiveTask(p), false);
    assert.equal(core.TaskManager.hasActiveTask(p.getIndex()), false);
  });
  p.getSkillManager().setMaxLevels(core.Skill.FIREMAKING, 20, false)
    .setExperiences(core.Skill.FIREMAKING, core.SkillManager.getExperienceForLevel(20), false)
    .setCurrentLevel(core.Skill.FIREMAKING, 20, false);
  p.getSkillManager().setMaxLevels(core.Skill.ATTACK, 40, false)
    .setExperiences(core.Skill.ATTACK, core.SkillManager.getExperienceForLevel(40), false)
    .setCurrentLevel(core.Skill.ATTACK, 40, false);
  assert.equal(p.getSkillManager().getMaxLevel(core.Skill.ATTACK), 40);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 40);
  quest.setStage(p, quest.completionValue);
  p.getInventory().add(new core.Item(Common.ids.objs.logs, 1), false);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 100), false);
  if (carried) p.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1), false);
  if (worn) {
    p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1));
    assert.equal(p.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(), core.ItemIdentifiers.RUNE_SCIMITAR);
  }
  if (ask) { p.setAttribute('balloon-transport:stored-logs', { logs: 1 }); p.setAttribute('balloon-transport:log-preference', 'ask'); }
  const query = { player: p, key: 'enlightened_journey', complete: false };
  PM.emitCustomEvent('quest:is-complete', query); assert.equal(query.complete, true);
  assert.equal(core.CacheDefinitions.getItem(core.ItemIdentifiers.RUNE_SCIMITAR).name.toLowerCase(), 'rune scimitar');
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.equal(p.getSkillManager().getMaxLevel(core.Skill.FIREMAKING), 20);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING), 20);
  assert.ok(p.getHitpoints() > 0); assert.notEqual(p.isDyingReturn(), true);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2938, 3421, 0]);
  assert.equal(p.getInventory().getAmount(Common.ids.objs.logs), 1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.COINS), 100);
  assert.equal(core.TeleportHandler.checkReqs(p, new core.Location(2808, 3354, 0)), true);
  assert.equal(p.busy(), false);
  assert.equal(Common.opened(p, Common.data.stations.find(s => s.key === 'entrana')), true);
  assert.ok(Travel.weightKg(p, Common.data.stations.find(s => s.key === 'entrana')) <= Common.data.maxWeightKg);
  assert.equal(Travel.flying(p), false); assert.equal(p.getMovementQueue().isMovementBlocked(), false);
  return { p, connection };
}
async function input(f, packet) { await f.connection.dispatch([packet]); f.connection.processTurnPackets(); }
async function begin(f) {
  const action = { player: f.p, action: 'open_interface', target: 'Balloon transport system', handled: false, end: false };
  PM.emitCustomEvent('npc-dialogue:action', action); assert.equal(action.handled, true);
  core.TaskManager.process();
  assert.equal(f.p.getInterfaceId(), Common.ids.map);
  const widgetId = core.CacheDefinitions.getComponentId('zep_balloon_map:btn_ent');
  assert.equal(Common.ids.buttons.get(widgetId & 0xffff)?.key, 'entrana');
  await input(f, { type: 'widget_action', widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, slot: -1, buttonNum: 1 });
  assert.ok(f.p.getDialogueManager().getCurrent(), 'real search dialogue is active');
}
async function continueSearch(f) {
  const group = f.p.getPacketSender().getChatboxGroupId(); assert.equal(group, 229);
  await input(f, { type: 'dialogue_continue', widgetId: (group << 16) | 4, childIndex: -1 });
}
function tick(n = 8) { for (let i = 0; i < n; i++) core.TaskManager.process(); }
const coords = p => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

for (const mode of ['carried', 'worn']) {
  test(`Entrana balloon refuses ${mode} rune scimitar without consuming fare`, async t => {
    const f = actor(t, { carried: mode === 'carried', worn: mode === 'worn' });
    const query = { player: f.p, allowed: false, reason: null, handled: false };
    PM.emitCustomEvent('entrana:check-items', query); assert.equal(query.handled, true); assert.equal(query.allowed, false);
    const start = coords(f.p), coins = f.p.getInventory().getAmount(core.ItemIdentifiers.COINS);
    await begin(f); await continueSearch(f); tick();
    assert.equal(Travel.flying(f.p), false); assert.deepEqual(coords(f.p), start);
    assert.equal(f.p.getInventory().getAmount(Common.ids.objs.logs), 1);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), coins);
  });
}
test('clean registered trip pays one log and arrives', async t => {
  const f = actor(t); const check = { player: f.p, allowed: false, reason: null, handled: false };
  PM.emitCustomEvent('entrana:check-items', check); assert.equal(check.allowed, true);
  await begin(f); await continueSearch(f); assert.equal(Travel.flying(f.p), true);
  assert.equal(f.p.getInventory().getAmount(Common.ids.objs.logs), 0); tick();
  assert.deepEqual(coords(f.p), [2808, 3354, 0]); assert.equal(Travel.flying(f.p), false);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 100);
});
test('noted rune scimitar remains allowed by the shared policy', async t => {
  const f = actor(t), noted = core.ItemDefinition.forId(core.ItemIdentifiers.RUNE_SCIMITAR).getNoteId();
  assert.ok(noted > 0 && noted !== core.ItemIdentifiers.RUNE_SCIMITAR);
  f.p.getInventory().add(new core.Item(noted, 1), false);
  assert.equal(f.p.getInventory().getAmount(noted), 1);
  const check = { player: f.p, allowed: false, reason: null, handled: false };
  PM.emitCustomEvent('entrana:check-items', check); assert.equal(check.handled, true); assert.equal(check.allowed, true);
  await begin(f); await continueSearch(f); assert.equal(Travel.flying(f.p), true);
  assert.equal(f.p.getInventory().getAmount(Common.ids.objs.logs), 0); tick();
  assert.deepEqual(coords(f.p), [2808, 3354, 0]); assert.equal(f.p.getInventory().getAmount(noted), 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 100);
});
test('contraband added after search but before source choice refuses and conserves both fares', async t => {
  const f = actor(t, { ask: true }); await begin(f); await continueSearch(f);
  const pending = core.MultiChatboxPrompt.getPending(f.p); assert.ok(pending);
  assert.match(pending.title, /which logs/i); assert.equal(f.p.getPacketSender().isChatboxInterface(219), true);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1), false);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.RUNE_SCIMITAR), 1);
  const denied = { player: f.p, allowed: false, reason: null, handled: false };
  PM.emitCustomEvent('entrana:check-items', denied); assert.equal(denied.handled, true); assert.equal(denied.allowed, false);
  const index = pending.options.findIndex(s => /inventory/i.test(s)); assert.notEqual(index, -1);
  await input(f, { type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }); tick();
  assert.equal(Travel.flying(f.p), false); assert.deepEqual(coords(f.p), [2938, 3421, 0]);
  assert.equal(f.p.getInventory().getAmount(Common.ids.objs.logs), 1);
  assert.equal(f.p.getAttribute('balloon-transport:stored-logs').logs, 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 100);
});
test('moving away during flight cancels at the actual relocated position and restores fare', async t => {
  const f = actor(t); await begin(f); await continueSearch(f); assert.equal(Travel.flying(f.p), true);
  f.p.moveTo(new core.Location(2940, 3420, 0)); tick();
  assert.equal(Travel.flying(f.p), false); assert.deepEqual(coords(f.p), [2940, 3420, 0]);
  assert.equal(f.p.getInventory().getAmount(Common.ids.objs.logs), 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 100);
});
test('contraband added during flight aborts and restores fare', async t => {
  const f = actor(t); await begin(f); await continueSearch(f); assert.equal(Travel.flying(f.p), true);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1), false);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.RUNE_SCIMITAR), 1); tick();
  assert.equal(Travel.flying(f.p), false); assert.deepEqual(coords(f.p), [2938, 3421, 0]);
  assert.equal(f.p.getInventory().getAmount(Common.ids.objs.logs), 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 100);
});
