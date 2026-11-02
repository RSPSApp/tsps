const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, cookId, nextIndex = 2500;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  cookId = core.CacheDefinitions.getNpcId('fai_varrock_bluemoon_chef');
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
});
function fixture(t) {
  const packets = [];
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername('holidaydialogueqa');
  player.setRegistered(true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const npc = core.NPC.create(cookId, new core.Location(3227, 3396));
  t.after(() => { player.closeInterruptibleInterfaces(); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, npc, packets, connection };
}
async function choose(f, childIndex) {
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex }]);
  f.connection.processTurnPackets();
}
function request(player, npc, variant = 'starting-the-event-talking-to-the-cook', page = '2025 Christmas event') {
  const event = { player, npc, npcId: cookId, variant: { page, variant }, exact: true };
  PM.emitCustomEvent('npc-dialogue:start', event);
  return event;
}
test('the activity explicitly reaches its canonical source through the real dispatcher and native choice', async t => {
  const f = fixture(t), { player, npc, packets } = f;
  assert.equal(request(player, npc).handled, true);
  const manager = player.getDialogueManager();
  assert.deepEqual(MultiChatboxPrompt.getPending(player), { title: 'Ask about the Christmas Event?', options: ['Yes', 'No'] });
  await choose(f, 1);
  assert.equal(manager.getCurrent().getText().replace(/\s+/g, ' '), "Can't you see the huge queue of people? I really don't have time to chat.");
  assert.ok(packets.length > 0, 'the actual PacketSender encoded the chatbox/choice updates');
  player.closeInterruptibleInterfaces();
  await choose(f, 1);
  assert.equal(MultiChatboxPrompt.getPending(player), null);
  assert.equal(manager.getCurrent(), undefined);
});
test('ordinary Talk-to does not select an inactive annual activity', t => {
  const { player, npc } = fixture(t);
  PM.emitNpcInteraction({ player, npc, npcId: cookId, action: 'Talk-to', clickType: 1, handled: false });
  const current = player.getDialogueManager().getCurrent();
  assert.ok(current);
  assert.notEqual(MultiChatboxPrompt.getPending(player)?.title, 'Ask about the Christmas Event?');
  assert.notEqual(current.getTitle?.(), 'Ask about the Christmas Event?');
  assert.notEqual(current.getText?.(), "Can't you see the huge queue of people? I really don't have time to chat.");
});

test('trusted playback can cancel only its actual initial prompt',t=>{
  const f=fixture(t),playback=request(f.player,f.npc);
  assert.equal(typeof playback.cancel,'function');assert.ok(MultiChatboxPrompt.getPending(f.player));
  assert.equal(playback.cancel(),true);assert.equal(MultiChatboxPrompt.getPending(f.player),null);
  assert.equal(f.player.getDialogueManager().getCurrent(),undefined);assert.equal(playback.cancel(),false);
});

test('a cancelled transcript cannot close an identical replacement prompt',async t=>{
  const f=fixture(t),playback=request(f.player,f.npc);let selected=false;
  PM.createApi('Replacement').sendMultiChatboxPrompt(f.player,'Ask about the Christmas Event?','Yes',()=>{selected=true;},'No',()=>{});
  assert.equal(playback.cancel(),false);assert.ok(MultiChatboxPrompt.getPending(f.player));
  await choose(f,1);assert.equal(selected,true,'native selection belongs to the replacement callback');
});

test('old cancellation preserves a new identical native source dialogue and its continuation',async t=>{
  const f=fixture(t),old=request(f.player,f.npc);await choose(f,1);
  const first=f.player.getDialogueManager().getCurrent();assert.ok(first);
  const fresh=request(f.player,f.npc);await choose(f,1);
  const current=f.player.getDialogueManager().getCurrent();assert.notEqual(current,first);assert.equal(current.getText(),first.getText());
  assert.equal(old.cancel(),false);assert.equal(f.player.getDialogueManager().getCurrent(),current);
  assert.equal(fresh.cancel(),true);assert.equal(f.player.getDialogueManager().getCurrent(),undefined);
});

test('source cancellation preserves an actual later bank and an unscoped same-group chatbox',async t=>{
  const f=fixture(t),old=request(f.player,f.npc);await choose(f,1);
  f.player.getBank(0).open();const bank=f.player.getInterfaceId();assert.ok(bank>=0,'real bank opened');
  old.cancel();assert.equal(f.player.getInterfaceId(),bank,'bank remains mounted even if the old dialogue chain still needed resetting');
  f.player.getPacketSender().sendInterfaceRemoval();
  const fresh=request(f.player,f.npc);await choose(f,1);
  const sender=f.player.getPacketSender(),group=sender.getChatboxGroupId();assert.ok(group>=0);
  sender.sendChatboxInterface(group).sendString('An unrelated replacement', (group<<16)|6);
  fresh.cancel();assert.equal(sender.isChatboxInterface(group),true,'same group id does not confer ownership of replacement UI');
  const last=request(f.player,f.npc);await choose(f,1);
  const sharedGroup=sender.getChatboxGroupId();sender.sendInterface(sharedGroup);
  last.cancel();assert.equal(f.player.getInterfaceId(),sharedGroup,'closing an owned chatbox cannot remove a separately mounted main modal with the same group');
});

test('a replacement prompt opened inside a source before-action keeps its own ownership',async t=>{
  const f=fixture(t);let selected=false;
  const hooks=PM.customEventHooks.get('npc-dialogue:line'),start=hooks.length;
  t.after(()=>hooks.splice(start));
  PM.createApi('NestedReplacementTest').onCustomEvent('npc-dialogue:line',event=>{
    if(event.player!==f.player||!String(event.text).startsWith("Can't you see"))return;
    event.before=()=>PM.createApi('Replacement').sendMultiChatboxPrompt(f.player,'Ask about the Christmas Event?','Yes',()=>{selected=true;},'No',()=>{});
  });
  const old=request(f.player,f.npc);await choose(f,1);
  assert.ok(MultiChatboxPrompt.getPending(f.player));assert.equal(old.cancel(),false);
  assert.ok(MultiChatboxPrompt.getPending(f.player),'replacement created from the old action is a new UI owner');
  await choose(f,1);assert.equal(selected,true);
});

test('closing an old owned chatbox preserves a newer real overhead chain and task continuation',async t=>{
  const f=fixture(t),old=request(f.player,f.npc);await choose(f,1);
  const data=require('../data/definitions/npc-dialogues.json');
  const line=data['Desert Treasure II - The Fallen Empire'].variants['the-whisperer-inspecting-the-totem-in-the-cistern'].find(step=>step.type==='line'&&step.speaker==='[player name]');
  assert.equal(line.presentation,'overhead');
  const fresh={player:f.player,npc:f.npc,npcId:cookId,variant:{page:'2025 Christmas event',variant:'starting-the-event-talking-to-the-cook'},exact:true,select:()=>[line,{player:'The later transcript continues.'}]};
  PM.emitCustomEvent('npc-dialogue:start',fresh);assert.equal(fresh.handled,true);
  const manager=f.player.getDialogueManager(),waiting=manager.getCurrent(),owner=manager.getOwner();assert.ok(waiting instanceof core.ActionDialogue);
  assert.equal(old.cancel(),true);assert.equal(manager.getCurrent(),waiting);assert.equal(manager.getOwner(),owner);
  core.TaskManager.process();core.TaskManager.process();
  assert.equal(manager.getCurrent()?.getText(),'The later transcript continues.');assert.equal(fresh.cancel(),true);
});

test('an interface-close callback can install a new source without the old cancel resetting it',async t=>{
  const f=fixture(t),old=request(f.player,f.npc);await choose(f,1);
  const sender=f.player.getPacketSender(),group=sender.getChatboxGroupId();
  const hooks=PM.customEventHooks.get('interface:closed'),start=hooks.length;let replacement,entry,once=false;
  t.after(()=>hooks.splice(start));
  PM.createApi('CloseReplacementTest').onCustomEvent('interface:closed',event=>{
    if(event.player!==f.player||event.interfaceId!==group||once)return;once=true;
    replacement=request(f.player,f.npc);assert.equal(MultiChatboxPrompt.selectOption(f.player,0),true);entry=f.player.getDialogueManager().getCurrent();
  });
  assert.equal(old.cancel(),true);assert.ok(once);assert.ok(entry);
  assert.equal(f.player.getDialogueManager().getCurrent(),entry,'post-close cleanup must recheck ownership after synchronous hooks');
  assert.equal(replacement.cancel(),true);
});
test('a missing explicit activity page or variant cannot replace the current conversation', async t => {
  const f = fixture(t), { player, npc } = f;
  request(player, npc);
  const current = MultiChatboxPrompt.getPending(player);
  assert.ok(current);
  assert.notEqual(request(player, npc, 'missing-variant').handled, true);
  assert.deepEqual(MultiChatboxPrompt.getPending(player), current);
  assert.notEqual(request(player, npc, 'starting-off', 'Missing annual event').handled, true);
  assert.deepEqual(MultiChatboxPrompt.getPending(player), current);
  await choose(f, 2);
  assert.equal(MultiChatboxPrompt.getPending(player), null);
});

const AGE_QUESTION = "Can you tell me how long I've been here?";
const AGE_INTRO = "Ahh, I see all the newcomers arriving in Lumbridge, fresh-faced and eager for adventure. I remember you...";
const AGE_TASK = 'learn-your-age-from-hans-in-lumbridge';
const PLAY_TIME = 'account-summary:play-time';
function hansFixture(t) {
  const f = fixture(t);
  f.player.setLocation(new core.Location(3221, 3219));
  core.RegionManager.loadMapFiles(3221, 3219);
  f.npc = core.NPC.create(core.NpcIdentifiers.HANS, new core.Location(3222, 3219));
  core.World.getNpcs().add(f.npc);
  f.npc.setRegistered(true);
  t.after(() => { f.npc.setRegistered(false); core.World.getNpcs().remove(f.npc); });
  f.current = () => f.player.getDialogueManager().getCurrent();
  f.text = () => f.current()?.getText()?.replace(/\s+/g, ' ');
  f.done = () => f.player.getAttribute('achievement-diaries:tasks')?.lumbridge ?? [];
  return f;
}
async function hansOp(f, action) {
  const actions = f.npc.getCurrentDefinition(f.player).getActions();
  const clickType = actions.indexOf(action) + 1;
  assert.ok(clickType > 0, `cache Hans action ${action}`);
  await f.connection.dispatch([{ type: 'npc_option', index: f.npc.getIndex(), clickType }]);
  f.connection.processTurnPackets();
}
async function nextLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 }]);
  f.connection.processTurnPackets();
}
function journalLifecycle(kind, player) {
  const hook = PM[`${kind}Hooks`].find(hook => hook.pluginName === 'SideJournalDefaults');
  assert.ok(hook, `real journal ${kind} lifecycle`);
  hook.handler({ player, username: player.getUsername() });
}

test('Hans native Age reads actual online time and account age, credits only the final line and remains idempotent', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 2) });
  const f = hansFixture(t), { player } = f;
  player.setCreationDate(Date.now() - 30 * 86400_000);
  player.setAttribute(PLAY_TIME, (26 * 60 + 3) * 60000 + 59_999);
  journalLifecycle('login', player);
  t.after(() => journalLifecycle('logout', player));
  t.mock.timers.tick(5 * 60000);

  await hansOp(f, 'Age');
  assert.equal(f.text(), AGE_INTRO, 'actual NPC option starts the canonical shortcut');
  assert.deepEqual(f.done(), [], 'constructing the final line does not award it early');
  player.closeInterruptibleInterfaces();
  assert.deepEqual(f.done(), [], 'aborting the introduction earns nothing');

  await hansOp(f, 'Age');
  await nextLine(f);
  assert.equal(f.text(), "You've spent 1 days, 2 hours, 8 minutes in the world since you arrived 30 days ago.");
  assert.deepEqual(f.done(), [AGE_TASK]);
  await nextLine(f);
  await hansOp(f, 'Age');
  await nextLine(f);
  assert.deepEqual(f.done(), [AGE_TASK], 'repeated Age requests do not duplicate diary progress');

  journalLifecycle('logout', player);
  player.closeInterruptibleInterfaces();
  t.mock.timers.tick(86400_000);
  await hansOp(f, 'Age');
  await nextLine(f);
  assert.equal(f.text(), "You've spent 1 days, 2 hours, 8 minutes in the world since you arrived 31 days ago.", 'offline time ages the account without adding played time');
});

test('Hans normal Talk-to native choice uses the same filled source line and does not credit unrelated answers', async t => {
  const f = hansFixture(t);
  f.player.setCreationDate(Date.now() - 2 * 86400_000);
  await hansOp(f, 'Talk-to');
  assert.equal(f.text(), 'Hello. What are you doing here?');
  await nextLine(f);
  assert.equal(MultiChatboxPrompt.getPending(f.player).options[3], AGE_QUESTION);
  await choose(f, 1);
  assert.equal(f.text(), "I'm looking for whoever is in charge of this place.");
  assert.deepEqual(f.done(), []);
  f.player.closeInterruptibleInterfaces();

  await hansOp(f, 'Talk-to');
  await nextLine(f);
  await choose(f, 4);
  assert.equal(f.text(), AGE_QUESTION);
  await nextLine(f);
  assert.equal(f.text(), AGE_INTRO);
  assert.deepEqual(f.done(), []);
  await nextLine(f);
  assert.equal(f.text(), "You've spent 0 days, 0 hours, 0 minutes in the world since you arrived 2 days ago.");
  assert.deepEqual(f.done(), [AGE_TASK]);
});

test('Hans can tell an age outside Lumbridge or in an instance without awarding the location-specific task', async t => {
  for (const privateArea of [null, new core.PrivateArea()]) {
    const f = hansFixture(t);
    if (privateArea) {
      f.player.setArea(privateArea);
      f.npc.setArea(privateArea);
    } else {
      f.player.setLocation(new core.Location(3221, 3399));
      f.npc.setLocation(new core.Location(3222, 3399));
      core.RegionManager.loadMapFiles(3221, 3399);
    }
    await hansOp(f, 'Age');
    await nextLine(f);
    assert.match(f.text() ?? '', /^You've spent 0 days, 0 hours, 0 minutes /);
    assert.deepEqual(f.done(), []);
  }
});

function hairdresserFixture(t) {
  const f = fixture(t);
  f.player.setLocation(new core.Location(2945, 3379));
  core.RegionManager.loadMapFiles(2946, 3379);
  f.npc = PM.spawnNpc({ id: core.NpcIdentifiers.HAIRDRESSER, x: 2946, y: 3379, z: 0 });
  f.messages = [];
  const sendMessage = f.player.sendMessage.bind(f.player);
  t.mock.method(f.player, 'sendMessage', text => { f.messages.push(text); sendMessage(text); });
  t.after(() => { PM.removeNpc(f.npc); core.TaskManager.cancelTasks(f.player); });
  return f;
}
async function hairdresserOp(f, option) {
  const clickType = f.npc.getCurrentDefinition(f.player).getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `native Hairdresser action ${option}`);
  await f.connection.dispatch([{ type: 'npc_option', index: f.npc.getIndex(), clickType }]);
  f.connection.processTurnPackets();
}
async function makeoverClick(f, component, slot = 0) {
  const widgetId = core.CacheDefinitions.getComponentId(`makeover:${component}`);
  await f.connection.dispatch([{ type: 'widget_action', widgetId, groupId: widgetId >>> 16, childId: widgetId & 65535, buttonNum: 1, slot }]);
  f.connection.processTurnPackets();
}

test('bare-headed native Haircut and Shave open the cache makeover categories', async t => {
  for (const [option, type] of [['Haircut', 0], ['Shave', 1]]) {
    const f = hairdresserFixture(t);
    assert.equal(f.player.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), -1);
    await hairdresserOp(f, option);
    assert.equal(f.player.getInterfaceId(), core.CacheDefinitions.getInterfaceId('makeover'));
    assert.equal(f.player.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('makeover_interface_type')), type);
    assert.ok(!f.messages.some(text => /take off your hat/.test(text)));
  }
});

test('the Hairdresser native Talk-to choices use real empty-head conditions and keep the opened makeover', async t => {
  for (const [option, type] of [['haircut', 0], ['shave', 1]]) {
    const f = hairdresserFixture(t);
    await hairdresserOp(f, 'Talk-to');
    await nextLine(f);
    const pending = MultiChatboxPrompt.getPending(f.player);
    await choose(f, pending.options.indexOf(`I'd like a ${option} please.`) + 1);
    for (let n = 0; n < 5 && f.player.getDialogueManager().getCurrent(); n++) await nextLine(f);
    assert.ok(!f.messages.some(text => /take off your hat/.test(text)), 'an empty head cannot take the worn-hat branch');
    assert.equal(f.player.getInterfaceId(), core.CacheDefinitions.getInterfaceId('makeover'), 'the old transcript cannot close the new modal');
    assert.equal(f.player.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('makeover_interface_type')), type);
  }
});

test('a real worn helmet still blocks both native Hairdresser shortcuts', async t => {
  for (const option of ['Haircut', 'Shave']) {
    const f = hairdresserFixture(t);
    f.player.getEquipment().set(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.BRONZE_MED_HELM, 1));
    await hairdresserOp(f, option);
    assert.notEqual(f.player.getInterfaceId(), core.CacheDefinitions.getInterfaceId('makeover'));
    assert.match(f.player.getDialogueManager().getCurrent()?.getText() ?? '', /take off your hat/);
    assert.equal(f.player.getDialogueManager().getCurrent()?.getItemId?.(), core.ItemIdentifiers.BRONZE_MED_HELM);
    await hairdresserOp(f, 'Talk-to');
    await nextLine(f);
    const choices = MultiChatboxPrompt.getPending(f.player).options;
    await choose(f, choices.indexOf(`I'd like a ${option === 'Haircut' ? 'haircut' : 'shave'} please.`) + 1);
    for (let n = 0; n < 5 && f.player.getDialogueManager().getCurrent(); n++) await nextLine(f);
    assert.notEqual(f.player.getInterfaceId(), core.CacheDefinitions.getInterfaceId('makeover'));
    assert.ok(f.messages.some(text => /take off your hat/.test(text)), 'the real worn-hat dialogue branch still refuses');
    f.player.getEquipment().set(core.Equipment.HEAD_SLOT, new core.Item(-1, 0));
    await hairdresserOp(f, option);
    assert.equal(f.player.getInterfaceId(), core.CacheDefinitions.getInterfaceId('makeover'), 'removing the helmet allows the service');
  }
});

test('native Hairdresser preview cancels or confirms through the existing makeover engine', async t => {
  const f = hairdresserFixture(t), appearance = f.player.getAppearance();
  const original = [...appearance.getLook()];
  await hairdresserOp(f, 'Haircut');
  const rows = core.CacheDefinitions.getEnumValues(496);
  const styles = [...rows.values()].map(id => {
    const row = core.CacheDefinitions.getDbRow(id);
    return row.int(core.CacheDefinitions.getDbColumn(row.tableId, 'player_kit_id_type_a'), -1);
  });
  const style = styles.findIndex(kit => kit >= 0 && kit !== original[core.Appearance.HEAD]);
  assert.ok(style >= 0);
  await makeoverClick(f, 'item_area', style * 5);
  assert.equal(appearance.getLook()[core.Appearance.HEAD], styles[style]);
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets();
  assert.deepEqual(appearance.getLook(), original, 'closing drops the preview');
  await hairdresserOp(f, 'Haircut');
  await makeoverClick(f, 'item_area', style * 5);
  await makeoverClick(f, 'select_and_close');
  assert.equal(appearance.getLook()[core.Appearance.HEAD], styles[style]);
  assert.equal(f.player.getInterfaceId(), -1);
  assert.ok(f.messages.includes('You get a fresh, new haircut!'));
});
