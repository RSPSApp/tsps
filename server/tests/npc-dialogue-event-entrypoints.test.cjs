const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
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

test('What Lies Below excavates and enters the actual cached statue through native object clicks', async t => {
  const f = fixture(t), { player } = f;
  core.RegionManager.init();
  const tile = new core.Location(3283, 3468);
  const parentId = core.CacheDefinitions.getLocId('surok_statuebase');
  const statueId = core.CacheDefinitions.getLocId('surok_statuebase1');
  const parent = core.MapObjects.get(parentId, tile, null);
  assert.ok(parent, 'the cache provides one multiloc statue at the real southwest tile');
  assert.equal(core.MapObjects.getPrivateArea(player, statueId, tile), parent,
    'the visible statue resolves to the original multiloc');
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'what_lies_below');
  player.setLocation(new core.Location(3282, 3468));
  const clickStatue = async () => {
    await f.connection.dispatch([{ type: 'object_option', id: statueId, x: tile.getX(), y: tile.getY(), clickType: 1 }]);
    f.connection.processTurnPackets();
    for (let tick = 0; tick < 4; tick++) {
      core.TaskManager.processWalkTo(player.getIndex());
      player.getMovementQueue().process();
      core.TaskManager.process();
    }
  };
  await clickStatue();
  assert.ok(player.getDialogueManager().getCurrent(), 'the native parent reaches Anna\'s existing refusal');
  assert.notEqual(player.getAttribute('what-lies-below:tunnel'), 1);
  player.closeInterruptibleInterfaces();
  quest.setStage(player, 30);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_PICKAXE));
  await clickStatue();
  for (let line = 0; line < 20 && player.getDialogueManager().getCurrent(); line++) await nextLine(f);
  assert.equal(player.getAttribute('what-lies-below:tunnel'), 1, 'the existing excavation transcript opens the tunnel');
  assert.equal(quest.getStage(player), 30, 'the optional shortcut does not advance the main quest');
  player.closeInterruptibleInterfaces();
  await clickStatue();
  assert.ok(player.getLocation().equals(new core.Location(3179, 5190)), 'the opened shortcut is still enterable');
});
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

for (const farming of [1, 2]) {
  test(`Fairytale I reaches its native start prompt without looping at Farming ${farming}`, async t => {
    const f = fixture(t);
    const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
    const quest = quests.find(entry => entry.key === 'fairytale_i_growing_pains');
    f.player.getSkillManager().setMaxLevels(core.Skill.FARMING, farming);
    const npcId = core.NpcIdentifiers.MARTIN_THE_MASTER_GARDENER;
    const npc = core.NPC.create(npcId, new core.Location(3078, 3258));
    const talk = () => PM.emitNpcInteraction({ player: f.player, npc, npcId,
      action: 'Talk-to', clickType: 1, handled: false });
    const select = async text => {
      const pending = MultiChatboxPrompt.getPending(f.player);
      assert.ok(pending?.options.includes(text), `expected option ${text}, got ${JSON.stringify(pending)}`);
      await choose(f, pending.options.indexOf(text) + 1);
    };
    const untilMenu = async () => {
      for (let n = 0; n < 30 && !MultiChatboxPrompt.getPending(f.player); n++) {
        assert.ok(f.player.getDialogueManager().getCurrent(), 'the source conversation remains reachable');
        await nextLine(f);
      }
      assert.ok(MultiChatboxPrompt.getPending(f.player), 'dialogue reaches its next menu');
    };
    const reachStart = async () => {
      assert.equal(talk(), true);
      await select('Ask about the quest.');
      await untilMenu();
      await select('Anything I can help with?');
      await untilMenu();
      assert.equal(MultiChatboxPrompt.getPending(f.player).title, 'Start the Fairytale I - Growing Pains quest?');
    };
    for (const key of ['lost_city', 'nature_spirit']) {
      await reachStart();
      await select('Yes.');
      assert.equal(quest.getStage(f.player), 0, 'both prerequisite quests are required');
      f.player.closeInterruptibleInterfaces();
      const prerequisite = quests.find(entry => entry.key === key);
      prerequisite.setStage(f.player, prerequisite.completionValue);
    }
    await reachStart();
    assert.equal(quest.getStage(f.player), 0, 'hearing the offer cannot start the quest');
    f.player.closeInterruptibleInterfaces();
    assert.equal(quest.getStage(f.player), 0, 'closing the offer cannot start the quest');
    await reachStart();
    await select('No.');
    f.player.closeInterruptibleInterfaces();
    assert.equal(quest.getStage(f.player), 0, 'refusing preserves the unstarted state');
    await reachStart();
    await select('Yes.');
    assert.equal(quest.getStage(f.player), quest.startedValue);
    f.player.closeInterruptibleInterfaces();
    assert.equal(talk(), true);
    const followup = 'Have you spoken to any other members of the Gardening Group yet?';
    assert.equal(f.player.getDialogueManager().getCurrent()?.getText().replace(/\s+/g, ' '), followup,
      'started characters keep their follow-up conversation');
    const restored = fixture(t);
    const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
    PlayerSave.fromPlayer(f.player).applyToPlayer(restored.player);
    assert.equal(quest.getStage(restored.player), quest.startedValue, 'the start stage survives save/load');
    PM.emitNpcInteraction({ player: restored.player, npc, npcId, action: 'Talk-to', clickType: 1, handled: false });
    assert.equal(restored.player.getDialogueManager().getCurrent()?.getText().replace(/\s+/g, ' '), followup,
      'relogging retains the follow-up conversation');
  });
}

async function nativeDig(f, itemId = core.ItemIdentifiers.SPADE, slot = f.player.getInventory().getSlotForItemId(itemId)) {
  await f.connection.dispatch([{ type: 'inventory_action', widgetId: core.CacheDefinitions.getComponentId('inventory:items'),
    itemId, slot, option: 'Dig', optionIndex: 1 }]);
  f.connection.processTurnPackets();
}
function advanceDig(f, ticks = 4) {
  for (let n = 0; n < ticks; n++) {
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getMovementQueue().process();
    core.TaskManager.process();
  }
}
const HUMAN_DIG_LONG = () => core.CacheDefinitions.getSeqId('human_dig_long');

test('Fairytale I Draynor skull is reachable through the native Spade Dig action', async t => {
  const f = fixture(t), { player } = f, messages = [], sounds = [], typedMessages = [];
  player.sendMessage = message => messages.push(message);
  const sender = player.getPacketSender(), sendSoundEffect = sender.sendSoundEffect.bind(sender);
  const sendTypedMessage = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, message, from) => {
    typedMessages.push([type, message]); messages.push(message);
    return sendTypedMessage(type, message, from);
  };
  sender.sendSoundEffect = (id, loops, delay, volume) => {
    sounds.push([id, Math.max(1, loops), delay]);
    return sendSoundEffect(id, loops, delay, volume);
  };
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3106, 3384);
  const grave = core.MapObjects.get(core.ObjectIdentifiers.GRAVESTONE_8, new core.Location(3106, 3384), null);
  assert.ok(grave, 'the grave is present in the real cache at the quest location');
  player.setLocation(new core.Location(3106, 3385));
  player.getInventory().add(new core.Item(core.ItemIdentifiers.SPADE));
  const skull = () => player.getInventory().getAmount(core.ItemIdentifiers.DRAYNOR_SKULL);
  await nativeDig(f);
  assert.equal(skull(), 0, 'the skull is not granted on the click tick');
  assert.equal(player.getAnimation()?.getId(), HUMAN_DIG_LONG(), 'the long dig sequence plays');
  assert.deepEqual(messages, ['You start digging...']);
  assert.deepEqual(typedMessages, [[105, 'You start digging...']], 'the opening uses the captured spam channel');
  assert.deepEqual(sounds, [[1470, 1, 0], [1470, 3, 25]], 'the captured synth sounds play once each');
  advanceDig(f, 3);
  assert.equal(skull(), 0, 'the grant waits the captured four ticks');
  assert.deepEqual(messages, ['You start digging...']);
  advanceDig(f, 1);
  assert.equal(skull(), 1);
  assert.deepEqual(messages, ['You start digging...', 'You dig up a skull.']);
  assert.equal(player.getAnimation()?.getId(), core.Animation.DEFAULT_RESET_ANIMATION.getId(), 'the long dig sequence resets');
  await nativeDig(f);
  advanceDig(f);
  assert.equal(skull(), 1, 'repeated digging cannot duplicate it');
  assert.equal(messages.at(-1), 'You dig the grave but find nothing.');
  player.getInventory().deleteNumber(core.ItemIdentifiers.DRAYNOR_SKULL, 1);
  player.getBank(2).add(new core.Item(core.ItemIdentifiers.DRAYNOR_SKULL), false);
  await nativeDig(f);
  advanceDig(f);
  assert.equal(skull(), 0, 'a banked skull is still owned');
  assert.equal(messages.at(-1), "I think I've already stored the skull in my bank.");
  player.getBank(2).deleteNumber(core.ItemIdentifiers.DRAYNOR_SKULL, 1);
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  assert.equal(quest.getStage(player), 0, 'the skull remains obtainable before the quest without starting it');
  quest.setStage(player, 50);
  await f.connection.dispatch([{ type: 'item_on_object', widgetId: core.CacheDefinitions.getComponentId('inventory:items'),
    itemId: core.ItemIdentifiers.SPADE, slot: player.getInventory().getSlotForItemId(core.ItemIdentifiers.SPADE),
    objectId: grave.getId(), x: 3106, y: 3384 }]);
  f.connection.processTurnPackets();
  advanceDig(f);
  assert.equal(skull(), 1, 'using the spade on the grave still works');
  assert.equal(quest.getStage(player), 50, 'digging does not advance the quest');
});

test('Fairytale I Draynor dig rejects incorrect tiles, planes and item sources and handles a full bag', async t => {
  const f = fixture(t), { player } = f, inventory = player.getInventory(), messages = [];
  player.sendMessage = message => messages.push(message);
  let laterDigs = 0;
  const hooks = PM.itemActionHooks, start = hooks.length;
  t.after(() => hooks.splice(start));
  PM.createApi('LaterQuestDigProbe').onItemAction('Spade', { Dig: () => { laterDigs++; return false; } });
  const { SPADE, DRAYNOR_SKULL } = core.ItemIdentifiers;
  inventory.add(new core.Item(SPADE));
  for (const at of [new core.Location(3106, 3388), new core.Location(3106, 3385, 1)]) {
    player.setLocation(at); await nativeDig(f);
    assert.equal(inventory.getAmount(DRAYNOR_SKULL), 0);
  }
  advanceDig(f);
  assert.equal(inventory.getAmount(DRAYNOR_SKULL), 0, 'off-site clicks start no delayed grant');
  assert.equal(laterDigs, 2, 'off-site digs remain available to other content');
  player.setLocation(new core.Location(3106, 3385));
  await nativeDig(f, SPADE, 20);
  assert.equal(inventory.getAmount(DRAYNOR_SKULL), 0, 'an empty or stale slot cannot dig');
  inventory.resetItems();
  const noted = core.ItemDefinition.forId(SPADE).getNoteId();
  inventory.add(new core.Item(noted));
  await nativeDig(f, noted);
  assert.equal(inventory.getAmount(DRAYNOR_SKULL), 0, 'a noted spade has no native Dig action');
  inventory.resetItems();
  inventory.add(new core.Item(SPADE, 28));
  assert.equal(inventory.getFreeSlots(), 0);
  await nativeDig(f);
  advanceDig(f);
  assert.equal(inventory.getAmount(DRAYNOR_SKULL), 0);
  assert.equal(messages.at(-1), 'Not enough space in your inventory.');
  inventory.deleteNumber(SPADE, 1);
  const hash = core.MapObjects.getHash(3106, 3384, 0), objects = core.MapObjects.mapObjects.get(hash);
  core.MapObjects.mapObjects.delete(hash);
  try {
    await nativeDig(f);
    advanceDig(f);
    assert.equal(inventory.getAmount(DRAYNOR_SKULL), 0, 'a removed grave cannot supply its skull');
  } finally { core.MapObjects.mapObjects.set(hash, objects); }
  await nativeDig(f);
  advanceDig(f);
  assert.equal(inventory.getAmount(DRAYNOR_SKULL), 1, 'freeing a slot makes the next dig recoverable');
});

test('Fairytale I Draynor dig cancels on movement or logout and never duplicates a pending grant', async t => {
  const f = fixture(t), { player } = f, inventory = player.getInventory(), messages = [];
  player.sendMessage = message => messages.push(message);
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3106, 3384);
  player.setLocation(new core.Location(3106, 3385));
  inventory.add(new core.Item(core.ItemIdentifiers.SPADE));
  const skull = () => inventory.getAmount(core.ItemIdentifiers.DRAYNOR_SKULL);
  await nativeDig(f);
  advanceDig(f, 1);
  await nativeDig(f);
  assert.equal(player.getAnimation()?.getId(), HUMAN_DIG_LONG(), 'a repeated click restores the long dig pose');
  advanceDig(f, 3);
  assert.equal(skull(), 0, 'a repeated click restarts the four-tick dig');
  advanceDig(f, 1);
  assert.equal(skull(), 1, 'a second click cannot queue a duplicate grant');
  assert.equal(messages.filter(message => message === 'You dig up a skull.').length, 1);
  inventory.deleteNumber(core.ItemIdentifiers.DRAYNOR_SKULL, 1);
  await nativeDig(f);
  player.getMovementQueue().walkToReset();
  advanceDig(f);
  assert.equal(skull(), 0, 'walking cancels the pending dig');
  assert.equal(player.getAnimation()?.getId(), core.Animation.DEFAULT_RESET_ANIMATION.getId());
  await nativeDig(f);
  player.setRegistered(false);
  advanceDig(f);
  assert.equal(skull(), 0, 'a dig that ends after logout grants nothing');
  player.setRegistered(true);
  await nativeDig(f);
  advanceDig(f);
  assert.equal(skull(), 1, 'the next dig after interruption still works');
});

test('Fairytale I pending dig cannot grant a skull after native Drop or override a real death pose', async t => {
  const f = fixture(t), { player } = f, inventory = player.getInventory();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3106, 3384);
  player.setLocation(new core.Location(3106, 3385));
  inventory.add(new core.Item(core.ItemIdentifiers.SPADE));
  await nativeDig(f); advanceDig(f, 3);
  await f.connection.dispatch([{ type: 'inventory_action', widgetId: core.CacheDefinitions.getComponentId('inventory:items'),
    itemId: core.ItemIdentifiers.SPADE, slot: inventory.getSlotForItemId(core.ItemIdentifiers.SPADE), option: 'Drop', optionIndex: 5 }]);
  f.connection.processTurnPackets(); advanceDig(f);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.SPADE), 0);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.DRAYNOR_SKULL), 0);
  inventory.add(new core.Item(core.ItemIdentifiers.SPADE));
  await nativeDig(f); advanceDig(f, 2);
  player.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 0);
  player.appendDeath(); advanceDig(f, 1);
  const deathAnimation = player.getAnimation()?.getId();
  assert.equal(deathAnimation, 836, 'the real PlayerDeathTask starts its death pose');
  advanceDig(f, 1);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.DRAYNOR_SKULL), 0);
  assert.equal(player.getAnimation()?.getId(), deathAnimation, 'dig cancellation cannot reset death');
});

function nuffFixture(t, stage = 20) {
  const f = fixture(t), { player } = f;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  quest.setStage(player, stage);
  const npcId = core.NpcIdentifiers.FAIRY_NUFF_2, npc = core.NPC.create(npcId, new core.Location(2386, 4727));
  return { ...f, quest, talk: () => PM.emitNpcInteraction({ player, npc, npcId, action: 'Talk-to', clickType: 1, handled: false }) };
}

const NATURE_ITEMS_ATTRIBUTE = 'quest.fairytale-i-growing-pains:nature-items';
async function readNatureRecipe(f, quest, first = false) {
  const npcId = core.NpcIdentifiers.MALIGNIUS_MORTIFER;
  const npc = core.NPC.create(npcId, new core.Location(3000, 3275));
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId,
    action: 'Talk-to', clickType: 1, handled: false }), true);
  const choices = first ? ['I need help with fighting a Tanglefoot.'] : [
    'I was asking you about fighting a Tanglefoot...', 'What did I need to take to the Nature Spirit again?'];
  const lines = [];
  for (let n = 0; n < 80; n++) {
    const menu = MultiChatboxPrompt.getPending(f.player);
    if (menu) {
      const choice = choices.shift();
      assert.ok(menu.options.includes(choice), `expected ${choice}, got ${JSON.stringify(menu)}`);
      await choose(f, menu.options.indexOf(choice) + 1);
    } else if (f.player.getDialogueManager().getCurrent()) {
      lines.push(f.player.getDialogueManager().getCurrent().getText?.() ?? '');
      await nextLine(f);
    } else break;
  }
  assert.deepEqual(choices, []);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined);
  assert.equal(quest.getStage(f.player), 60);
  return lines.join(' ').replace(/\s+/g, ' ');
}

for (const [first, names] of [[1, ['white berries', 'a mort myre pear', 'a mort myre stem']],
  [29, ['a king worm', 'snape grass', 'a lime']]]) {
  test(`Fairytale I native initial and reminder recipes match saved items ${first}-${first + 2}`, async t => {
    const f = fixture(t), other = fixture(t);
    f.player.setUsername(`nature${first}`);
    const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'fairytale_i_growing_pains');
    const originalRandom = core.Misc.randomInclusive;
    let rolls = 0;
    t.mock.method(core.Misc, 'randomInclusive', (min, max) => {
      if (min === 1 && max === 29) { rolls++; return first; }
      return originalRandom(min, max);
    });
    quest.setStage(f.player, 50);
    f.player.getInventory().add(new core.Item(core.ItemIdentifiers.DRAYNOR_SKULL), false);
    const positions = `${first},${first + 1},${first + 2}`;
    const check = (text, player) => {
      assert.doesNotMatch(text, /\[item\s*[123]\]/i);
      for (const name of names) {
        assert.ok(text.includes(name), `the native recipe names ${name}: ${text}`);
        assert.ok(quest.buildJournal(player, quest).includes(name), `the journal agrees on ${name}`);
      }
      assert.equal(player.getAttribute(NATURE_ITEMS_ATTRIBUTE), positions);
    };
    check(await readNatureRecipe(f, quest, true), f.player);
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.DRAYNOR_SKULL), 0);
    check(await readNatureRecipe(f, quest), f.player);
    const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
    PlayerSave.fromPlayer(f.player).applyToPlayer(other.player);
    check(await readNatureRecipe(other, quest), other.player);
    assert.equal(rolls, 1, 'reminders and save/load reuse the persisted recipe');
    const foreign = fixture(t);
    foreign.player.setUsername(`other${first}`);
    quest.setStage(foreign.player, 60);
    foreign.player.setAttribute(NATURE_ITEMS_ATTRIBUTE, first === 1 ? '29,30,31' : '1,2,3');
    const foreignText = await readNatureRecipe(foreign, quest);
    assert.ok(foreignText.includes(first === 1 ? 'snape grass' : 'white berries'));
    assert.equal(f.player.getAttribute(NATURE_ITEMS_ATTRIBUTE), positions, 'another player cannot replace this recipe');
  });
}

test('Fairytale I only substitutes Malignius recipe lines on its own transcript page', t => {
  const f = fixture(t), text = 'Gather [item 1], [item 2] and [item 3].';
  f.player.setAttribute(NATURE_ITEMS_ATTRIBUTE, '1,2,3');
  for (const [page, npcId, speaker] of [
    ['Another page', core.NpcIdentifiers.MALIGNIUS_MORTIFER, 'Malignius Mortifer'],
    ['Fairytale I - Growing Pains', core.NpcIdentifiers.NATURE_SPIRIT, 'Nature Spirit'],
    ['Fairytale I - Growing Pains', core.NpcIdentifiers.MALIGNIUS_MORTIFER, 'Player'],
  ]) {
    const event = { player: f.player, npcId, pages: [{ page }], step: { speaker }, text };
    PM.emitCustomEvent('npc-dialogue:line', event);
    assert.equal(event.text, text);
  }
});

async function finishNuff(f) {
  for (let n = 0; f.player.getDialogueManager().getCurrent() && n < 60; n++) await nextLine(f);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined);
}

async function cancelFinalNuffLine(f) {
  for (let n = 0; n < 60; n++) {
    const line = f.player.getDialogueManager().getCurrent()?.getText() ?? '';
    if (/I believe he now resides|I have a copy of it here/.test(line)) break;
    assert.ok(line, 'the handover line remains reachable');
    await nextLine(f);
  }
  assert.match(f.player.getDialogueManager().getCurrent()?.getText() ?? '', /I believe he now resides|I have a copy of it here/);
  const group = f.player.getPacketSender().getChatboxGroupId();
  f.player.closeInterruptibleInterfaces();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 }]);
  f.connection.processTurnPackets();
}

test('Fairytale I Nuff waits for native dialogue completion and preserves cancellation, recovery and retalk', async t => {
  const f = nuffFixture(t), { player, quest } = f, item = core.ItemIdentifiers.SYMPTOMS_LIST;
  assert.equal(f.talk(), true);
  assert.equal(player.getInventory().getAmount(item), 0);
  assert.equal(quest.getStage(player), 20);
  await cancelFinalNuffLine(f);
  assert.equal(player.getInventory().getAmount(item), 0, 'a closed conversation and stale Continue cannot hand over the list');
  assert.equal(quest.getStage(player), 20);
  f.talk(); await finishNuff(f);
  assert.equal(player.getInventory().getAmount(item), 1);
  assert.equal(quest.getStage(player), 40);
  f.talk(); player.closeInterruptibleInterfaces();
  assert.equal(player.getInventory().getAmount(item), 1, 'retalking with the list does not duplicate it');
  player.getInventory().deleteNumber(item, 1);
  f.talk();
  assert.equal(player.getInventory().getAmount(item), 0, 'replacement lists also wait for their conversation');
  await cancelFinalNuffLine(f);
  assert.equal(player.getInventory().getAmount(item), 0);
  f.talk(); await finishNuff(f);
  assert.equal(player.getInventory().getAmount(item), 1);
  assert.equal(quest.getStage(player), 40);
});

test('Fairytale I Nuff handovers recover from a full inventory without skipping quest stages', async t => {
  const f = nuffFixture(t), { player, quest } = f, inventory = player.getInventory();
  const { SPADE, SYMPTOMS_LIST } = core.ItemIdentifiers;
  inventory.add(new core.Item(SPADE, 28));
  f.talk(); await finishNuff(f);
  assert.equal(inventory.getAmount(SYMPTOMS_LIST), 0);
  assert.equal(quest.getStage(player), 20);
  inventory.deleteNumber(SPADE, 1);
  f.talk(); await finishNuff(f);
  assert.equal(inventory.getAmount(SYMPTOMS_LIST), 1);
  assert.equal(quest.getStage(player), 40);
  inventory.deleteNumber(SYMPTOMS_LIST, 1); inventory.add(new core.Item(SPADE));
  f.talk(); await finishNuff(f);
  assert.equal(inventory.getAmount(SYMPTOMS_LIST), 0);
  inventory.deleteNumber(SPADE, 1);
  f.talk(); await finishNuff(f);
  assert.equal(inventory.getAmount(SYMPTOMS_LIST), 1);
  assert.equal(quest.getStage(player), 40);
});

const FAIRYTALE_STAGE_SCHEMA = 'quest.fairytale-i-growing-pains:stage-schema';
const FAIRYTALE_STAGE = 'quest.fairytale_i_growing_pains.stage';

function godfatherFixture(t, stage = 20) {
  const f = fixture(t), { player } = f;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  player.setAttribute(FAIRYTALE_STAGE_SCHEMA, 1);
  quest.setStage(player, stage);
  const npcId = core.NpcIdentifiers.FAIRY_GODFATHER_2, npc = core.NPC.create(npcId, new core.Location(2387, 4445));
  return { ...f, quest, npcId, npc, talk: () => PM.emitNpcInteraction({ player, npc, npcId, action: 'Talk-to', clickType: 1, handled: false }) };
}

async function untilChoice(f) {
  for (let n = 0; n < 40 && !MultiChatboxPrompt.getPending(f.player); n++) {
    assert.ok(f.player.getDialogueManager().getCurrent(), 'the Godfather conversation remains reachable');
    await nextLine(f);
  }
  const pending = MultiChatboxPrompt.getPending(f.player);
  assert.ok(pending?.options.includes("Where's the Fairy Queen?"), `expected the Godfather menu, got ${JSON.stringify(pending)}`);
  return pending;
}

async function finishDialogue(f) {
  for (let n = 0; n < 60 && f.player.getDialogueManager().getCurrent(); n++) await nextLine(f);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined);
}

test('Fairytale I Godfather choice sends the player to Nuff, who then hands over the symptoms list', async t => {
  const f = godfatherFixture(t, 20), { player, quest } = f;
  assert.equal(f.talk(), true);
  let menu = await untilChoice(f);
  await choose(f, menu.options.indexOf('Who are you?') + 1);
  assert.equal(quest.getStage(player), 20, 'another Godfather answer does not advance');
  menu = await untilChoice(f);
  await choose(f, menu.options.indexOf("Where's the Fairy Queen?") + 1);
  assert.equal(quest.getStage(player), 30, 'the Queen answer is the step that sends the player to Nuff');
  player.closeInterruptibleInterfaces();
  assert.match(quest.buildJournal(player, quest).join(' ').replace(/\s+/g, ' '), /Fairy Nuff/,
    'the stage-30 journal names the next contact');

  const nuffId = core.NpcIdentifiers.FAIRY_NUFF_2, nuff = core.NPC.create(nuffId, new core.Location(2386, 4727));
  assert.equal(PM.emitNpcInteraction({ player, npc: nuff, npcId: nuffId, action: 'Talk-to', clickType: 1, handled: false }), true);
  await finishNuff(f);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.SYMPTOMS_LIST), 1);
  assert.equal(quest.getStage(player), 40, 'the subsequent Nuff handoff continues from the Godfather stage');

  quest.setStage(player, 10);
  PM.emitCustomEvent('npc-dialogue:choice', { player, npcId: f.npcId, option: "Where's the Fairy Queen?" });
  assert.equal(quest.getStage(player), 10, 'the same answer outside stage 20 does not advance');
});

test('Fairytale I varbit 1803 and varp 671 progress through native completion at 90 and keep siblings', async t => {
  const f = godfatherFixture(t, 10), { player, quest } = f, sender = player.getPacketSender();
  const row = core.CacheDefinitions.getDbRow(46);
  assert.equal(row.tableId, 0);
  assert.equal(row.int(19), 90, 'active cache quest DB row 46 completes at 90');
  assert.equal(quest.completionValue, row.int(19));
  sender.sendVarbit(1804, 21).sendVarbit(1805, 10).sendVarbit(1806, 31).sendVarbit(1807, 3).sendVarbit(1808, 1);
  const siblings = sender.getVarp(671) & ~0x7f;
  assert.notEqual(siblings, 0);
  for (const stage of [10, 20, 30, 40, 50, 60, 70, 80]) {
    quest.setStage(player, stage);
    assert.equal(sender.getVarbit(1803), stage, `varbit 1803 follows stage ${stage}`);
    assert.equal(sender.getVarp(671) & 0x7f, stage, `varp 671's quest bits hold stage ${stage}`);
    assert.equal(sender.getVarp(671) & ~0x7f, siblings, `stage ${stage} preserves the packed siblings`);
  }
  player.getInventory().add(new core.Item(core.ItemIdentifiers.QUEENS_SECATEURS));
  const xp = skill => player.getSkillManager().getExperience(skill);
  const before = [core.Skill.FARMING, core.Skill.ATTACK, core.Skill.MAGIC].map(xp);
  assert.equal(f.talk(), true);
  await finishDialogue(f);
  assert.equal(quest.getStage(player), 90);
  assert.equal(sender.getVarbit(1803), 90, 'the cache completion value reaches varbit 1803');
  assert.equal(sender.getVarp(671) & 0x7f, 90, 'and its parent varp');
  assert.equal(sender.getVarp(671) & ~0x7f, siblings, 'completion preserves the siblings');
  assert.equal(quest.isComplete(player), true);
  assert.deepEqual([core.Skill.FARMING, core.Skill.ATTACK, core.Skill.MAGIC].map(xp),
    before.map((value, index) => value + [3500, 2000, 1000][index]), 'the quest rewards are paid once');
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.QUEENS_SECATEURS), 0);

  const replay = { player, npcId: f.npcId, stepId: 'Z_ZWiI', handled: false, end: false };
  PM.emitCustomEvent('npc-dialogue:action', replay);
  assert.equal(replay.handled, true);
  assert.deepEqual([core.Skill.FARMING, core.Skill.ATTACK, core.Skill.MAGIC].map(xp),
    before.map((value, index) => value + [3500, 2000, 1000][index]), 'replaying the completion action pays no second reward');
});

test('Fairytale I legacy saves migrate once through login and bootstrap while fresh saves stay at zero', async t => {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  const login = player => PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: false });
  const bootstrap = player => PM.emitCustomEvent('player:bootstrap-complete', { player, username: player.getUsername() });
  const xp = player => [core.Skill.FARMING, core.Skill.ATTACK, core.Skill.MAGIC].map(skill => player.getSkillManager().getExperience(skill));
  const points = player => Number(player.getAttribute('quest.points')) || 0;
  const stageEvents = [];
  const hooks = PM.customEventHooks.get('quest:stage-changed');
  const hookCount = hooks.length;
  PM.createApi('FairytaleMigrationObserver').onCustomEvent('quest:stage-changed', event => {
    if (event.key === 'fairytale_i_growing_pains') stageEvents.push({
      player: event.player, stage: event.stage,
      schema: event.player.getAttribute(FAIRYTALE_STAGE_SCHEMA), complete: quest.isComplete(event.player),
    });
  });
  t.after(() => hooks.splice(hookCount));
  for (const [legacy, current] of [[30, 40], [40, 50], [50, 60], [60, 70], [70, 80], [80, 90]]) {
    const source = fixture(t);
    source.player.setUsername(`legacy${legacy}`);
    quest.setStage(source.player, legacy);
    const target = fixture(t);
    PlayerSave.fromPlayer(source.player).applyToPlayer(target.player);
    assert.equal(target.player.getAttribute(FAIRYTALE_STAGE_SCHEMA), 0, 'the legacy save has no schema stamp');
    target.player.getPacketSender().sendConfig(671, (1 << 26) | (1 << 30));
    login(target.player);
    assert.equal(quest.getStage(target.player), current, `legacy ${legacy} migrates to ${current}`);
    assert.equal(target.player.getAttribute(FAIRYTALE_STAGE_SCHEMA), 1);
    const change = stageEvents.find(event => event.player === target.player && event.stage === current);
    assert.ok(change, 'migration publishes the native stage change');
    assert.equal(change.schema, 1, 'observers/save requests see the schema stamp with the new value');
    assert.equal(change.complete, current === 90, 'legacy 70 -> current 80 is still unfinished during the event');
    assert.equal(target.player.getPacketSender().getVarp(671) & ((1 << 26) | (1 << 30)), (1 << 26) | (1 << 30),
      'migration preserves unrelated packed bits');
    if (current === 90) {
      assert.equal(quest.isComplete(target.player), true, 'a migrated completed save is complete');
      assert.deepEqual(xp(target.player), [0, 0, 0], 'migration does not repay experience');
      assert.equal(points(target.player), 0, 'migration does not repay quest points');
      const reloaded = fixture(t);
      PlayerSave.fromPlayer(target.player).applyToPlayer(reloaded.player);
      assert.equal(reloaded.player.getAttribute(FAIRYTALE_STAGE_SCHEMA), 1, 'the schema survives save/load');
      assert.equal(quest.getStage(reloaded.player), 90);
      login(reloaded.player);
      assert.equal(quest.getStage(reloaded.player), 90, 'a reloaded migrated save is not shifted again');
    }
    bootstrap(target.player);
    assert.equal(quest.getStage(target.player), current, 'bootstrap does not migrate twice');
    login(target.player);
    assert.equal(quest.getStage(target.player), current, 'a repeated login does not migrate twice');
  }

  const fresh = fixture(t);
  assert.equal(quest.getStage(fresh.player), 0);
  login(fresh.player);
  bootstrap(fresh.player);
  login(fresh.player);
  assert.equal(quest.getStage(fresh.player), 0, 'a fresh save stays unstarted');
  assert.equal(fresh.player.getAttribute(FAIRYTALE_STAGE_SCHEMA), 1);

  const current = fixture(t);
  current.player.setAttribute(FAIRYTALE_STAGE_SCHEMA, 1);
  current.player.setAttribute(FAIRYTALE_STAGE, 90);
  login(current.player);
  assert.equal(quest.getStage(current.player), 90, 'a save already on the current schema is not shifted');

  const league = fixture(t);
  quest.setStage(league.player, 80);
  const leagueXp = xp(league.player), leaguePoints = points(league.player);
  const prerequisite = { player: league.player, key: 'fairytale_i_growing_pains', complete: null };
  PM.emitCustomEvent('quest:is-complete', prerequisite);
  assert.equal(prerequisite.complete, true, 'FT2 and quest queries see a legacy complete save before migration');
  PM.emitCustomEvent('league:complete-quests', { player: league.player, quests: ['Fairytale I - Growing Pains'], items: false });
  assert.equal(quest.getStage(league.player), 80, 'league completion before login leaves a legacy complete save alone');
  assert.deepEqual(xp(league.player), leagueXp, 'league completion does not repay its experience');
  assert.equal(points(league.player), leaguePoints, 'league completion does not repay its quest points');
  login(league.player);
  assert.equal(quest.getStage(league.player), 90, 'the login migration then moves it to the cache completion value');
  assert.deepEqual(xp(league.player), leagueXp, 'the migration still does not repay experience');
  assert.equal(points(league.player), leaguePoints, 'the migration still does not repay quest points');
});

test('Fairytale I north Tanglefoot spawn is reachable by the production pathfinder and owner-isolated', t => {
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2394, 4379);
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  const first = fixture(t), second = fixture(t);
  const enter = f => {
    f.player.setLocation(new core.Location(2394, 4379, 0));
    quest.setStage(f.player, 70);
    PM.emitPlayerProcess({ player: f.player });
  };
  enter(first); enter(second);
  const spawns = () => [...core.World.getNpcs()].filter(npc => npc?.getId?.() === core.NpcIdentifiers.TANGLEFOOT);
  const owned = player => spawns().filter(npc => npc.getOwner?.() === player);
  const firstNpcs = owned(first.player), secondNpcs = owned(second.player);
  assert.equal(firstNpcs.length, 1, 'the real zone-enter route spawns one Tanglefoot for its owner');
  assert.equal(secondNpcs.length, 1, 'another player gets their own Tanglefoot');
  assert.notEqual(firstNpcs[0], secondNpcs[0]);
  const spawned = firstNpcs[0], at = spawned.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [2375, 4385, 0], 'Quest Helper kill-tile inference');
  assert.equal(spawned.isOwnerOnly(), true);
  assert.equal(core.RegionManager.blocked(at, null), false, 'the spawned tile is not clipped');
  const definition = core.CacheDefinitions.getNpc(core.NpcIdentifiers.TANGLEFOOT);
  assert.equal(definition.size, 1);
  assert.ok(definition.actions.includes('Attack'), 'the actual cache NPC offers Attack');

  // Gameplay routes stop at 25 checkpoints; raise the cap to prove the whole
  // tunnel connects the entrance to the exact spawn.
  const route = PathFinder.rsmodRouteFinding.findRoute({
    level: 0, srcX: 2394, srcY: 4379, srcSize: 1,
    destX: at.getX(), destY: at.getY(), privateArea: null, moveNear: true, maxWaypoints: 128,
  });
  assert.equal(route.success, true, 'the production pathfinder finds the real entrance -> north spawn route');
  assert.equal(route.endX, at.getX());
  assert.equal(route.endY, at.getY());
  const points = route.waypoints.map(point => new core.Location(point.x, point.y, point.z));
  assert.ok(points.length > 0);
  const end = points.at(-1);
  assert.deepEqual([end.getX(), end.getY(), end.getZ()], [at.getX(), at.getY(), at.getZ()],
    'the route ends exactly on the spawned Tanglefoot tile');
  let from = new core.Location(2394, 4379, 0);
  for (const point of points) {
    assert.equal(core.RegionManager.canMovestart(from, point, 1, 1, null), true,
      `legal directional step ${from.getX()},${from.getY()} -> ${point.getX()},${point.getY()}`);
    from = point;
  }
  assert.ok(at.getX() >= 2368 && at.getX() <= 2398 && at.getY() >= 4354 && at.getY() <= 4399,
    'the expanded encounter zone covers the spawned location');
  t.after(() => {
    for (const npc of [...core.World.getNpcs()]) {
      if (npc?.getOwner?.() === first.player || npc?.getOwner?.() === second.player) core.World.getNpcs().remove(npc);
    }
  });
});

for (const shieldStage of [4, 7]) {
  test(`Priest in Peril starts through native choices after Shield of Arrav stage ${shieldStage}`, async t => {
    const f = fixture(t);
    const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
    const quest = quests.find(entry => entry.key === 'priest_in_peril');
    quests.find(entry => entry.key === 'shield_of_arrav').setStage(f.player, shieldStage);
    const npcId = core.NpcIdentifiers.KING_ROALD_3;
    const npc = core.NPC.create(npcId, new core.Location(3222, 3474));
    const select = async text => {
      const pending = MultiChatboxPrompt.getPending(f.player);
      assert.ok(pending?.options.includes(text), `expected ${text}, got ${JSON.stringify(pending)}`);
      await choose(f, pending.options.indexOf(text) + 1);
    };
    const untilMenu = async () => {
      for (let n = 0; n < 15 && !MultiChatboxPrompt.getPending(f.player); n++) {
        assert.ok(f.player.getDialogueManager().getCurrent(), 'Roald conversation remains reachable');
        await nextLine(f);
      }
      assert.ok(MultiChatboxPrompt.getPending(f.player));
    };
    const reachStart = async () => {
      assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId,
        action: 'Talk-to', clickType: 1, handled: false }), true);
      await untilMenu();
      await select("I'm looking for a quest!");
      await untilMenu();
      await select("Yes, I think I've heard of it.");
      await untilMenu();
      assert.equal(MultiChatboxPrompt.getPending(f.player).title, 'Start the Priest in Peril quest?');
    };
    await reachStart();
    assert.equal(quest.getStage(f.player), 0);
    f.player.closeInterruptibleInterfaces();
    assert.equal(quest.getStage(f.player), 0, 'closing the offer leaves it unstarted');
    await reachStart();
    await select('No.');
    f.player.closeInterruptibleInterfaces();
    assert.equal(quest.getStage(f.player), 0, 'refusing leaves it unstarted');
    await reachStart();
    await select('Yes.');
    assert.equal(quest.getStage(f.player), quest.startedValue, 'native acceptance starts the quest');
    assert.equal(f.player.getPacketSender().getVarp(302), 1);
  });
}

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

function fillimanFixture(t, stage = 20) {
  const f = fixture(t), { player } = f;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'nature_spirit');
  quest.setStage(player, stage);
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3440, 3336);
  player.setLocation(new core.Location(3440, 3335)); player.needsPlacement = false;
  player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.GHOSTSPEAK_AMULET));
  const npc = PM.spawnNpc({ id: core.NpcIdentifiers.FILLIMAN_TARLOCK, x: 3440, y: 3336, z: 0,
    owner: player, ownerOnly: true, wanderRadius: 0 });
  const messages = [];
  t.mock.method(player.getPacketSender(), 'sendMessage', text => { messages.push(text); return player.getPacketSender(); });
  t.after(() => PM.removeNpc(npc));
  const use = async itemId => {
    player.closeInterruptibleInterfaces();
    await f.connection.dispatch([{ type: 'item_on_npc', targetIndex: npc.getIndex(), itemId,
      slot: player.getInventory().getSlotForItemId(itemId), widgetId: 149 << 16 }]);
    f.connection.processTurnPackets();
    for (let tick = 0; tick < 8; tick++) {
      core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process();
    }
  };
  const talk = () => PM.emitNpcInteraction({ player, npc, npcId: npc.getId(), action: 'Talk-to', clickType: 1, handled: false });
  return { ...f, npc, quest, use, talk, messages };
}

async function fillimanUntil(f, stop) {
  const lines = [];
  for (let n = 0; n < 60; n++) {
    const menu = MultiChatboxPrompt.getPending(f.player);
    const text = f.player.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
    if (stop({ menu, text })) return lines;
    assert.ok(text, 'Filliman conversation must reach the expected continuation');
    lines.push(text);
    await nextLine(f);
  }
  assert.fail('Filliman conversation did not reach the expected continuation');
}

test('Nature Spirit native mirror use plays the dead dialogue and commits only after its final line', async t => {
  const f = fillimanFixture(t, 10), { player, quest } = f;
  assert.equal(f.talk(), true);
  await fillimanUntil(f, ({ menu }) => !!menu);
  await choose(f, 2);
  const refusal = await fillimanUntil(f, ({ menu }) => !!menu);
  assert.ok(refusal.some(text => text.includes("I'm not a ghost!")));
  player.closeInterruptibleInterfaces();
  f.talk();
  const reminder = await fillimanUntil(f, ({ menu }) => !!menu);
  assert.ok(reminder.some(text => text.includes("do you still think I'm dead?")));
  assert.ok(MultiChatboxPrompt.getPending(player).options.includes('How long have you been a ghost?'));
  player.closeInterruptibleInterfaces();
  player.getInventory().add(new core.Item(core.ItemIdentifiers.MIRROR));
  await f.use(core.ItemIdentifiers.MIRROR);
  assert.equal(quest.getStage(player), 20, 'showing the mirror first starts its source conversation');
  const final = ({ text }) => text?.startsWith('It must be a sign...');
  const lines = await fillimanUntil(f, final);
  assert.ok(lines.some(text => text.includes('This mirror must somehow be dysfunctional.')));
  player.closeInterruptibleInterfaces(); await nextLine(f);
  assert.equal(quest.getStage(player), 20, 'cancellation and a stale Continue cannot accept death');
  await f.use(core.ItemIdentifiers.MIRROR);
  await fillimanUntil(f, final); await nextLine(f);
  assert.equal(quest.getStage(player), 25);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.MIRROR), 1);
});

test('Nature Spirit native diary reading and help choice resume without granting an early spell', async t => {
  const f = fillimanFixture(t, 25), { player, quest } = f;
  const { JOURNAL, DRUIDIC_SPELL } = core.ItemIdentifiers;
  player.getInventory().add(new core.Item(JOURNAL));
  await f.use(JOURNAL);
  assert.equal(quest.getStage(player), 30);
  assert.equal(player.getInventory().getAmount(JOURNAL), 0, 'the canonical handover gives Filliman his journal');
  assert.equal(player.getInventory().getAmount(DRUIDIC_SPELL), 0, 'the journal itself does not award the spell');
  const lines = await fillimanUntil(f, ({ menu }) => !!menu);
  assert.ok(lines.some(text => text.includes('My journal!')));
  assert.ok(lines.some(text => text.includes("It's all coming back to me now.")));
  assert.ok(f.messages.some(text => text.includes('starts leafing through the journal')));
  await choose(f, MultiChatboxPrompt.getPending(player).options.indexOf('Ok thanks.') + 1);
  await nextLine(f);
  assert.equal(quest.getStage(player), 30);
  assert.equal(player.getInventory().getAmount(DRUIDIC_SPELL), 0);
  const offerHelp = async () => {
    assert.equal(f.talk(), true);
    await fillimanUntil(f, ({ menu }) => !!menu);
    assert.deepEqual(MultiChatboxPrompt.getPending(player).options, [
      'Being dead, what options do you think you have?', "So, what's your plan?", 'Well, good luck with that.', 'How can I help?', 'Ok thanks.',
    ]);
    await choose(f, 4);
    await fillimanUntil(f, ({ text }) => text?.startsWith("It is required if you're to cast this druid spell."));
  };
  await offerHelp();
  player.closeInterruptibleInterfaces(); await nextLine(f);
  assert.equal(quest.getStage(player), 30);
  assert.equal(player.getInventory().getAmount(DRUIDIC_SPELL), 0, 'closing the final instruction cannot grant a spell');
  await offerHelp(); await nextLine(f);
  assert.equal(quest.getStage(player), 35);
  assert.equal(player.getInventory().getAmount(DRUIDIC_SPELL), 1);
  f.talk(); player.closeInterruptibleInterfaces();
  assert.equal(player.getInventory().getAmount(DRUIDIC_SPELL), 1, 'retalking does not duplicate the reward');
});

test('Nature Spirit saved journal progress and full inventories recover at the help conversation', async t => {
  const saved = fillimanFixture(t, 30), f = fillimanFixture(t, 0);
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  PlayerSave.fromPlayer(saved.player).applyToPlayer(f.player);
  const { player, quest } = f, inventory = player.getInventory();
  assert.equal(quest.getStage(player), 30, 'the help checkpoint survives native save/load');
  const { SPADE, DRUIDIC_SPELL } = core.ItemIdentifiers;
  inventory.add(new core.Item(SPADE, 28));
  const help = async () => {
    f.talk();
    await fillimanUntil(f, ({ menu }) => !!menu);
    await choose(f, 4);
    await fillimanUntil(f, ({ text }) => text?.startsWith("It is required if you're to cast this druid spell."));
    await nextLine(f);
  };
  await help();
  assert.equal(quest.getStage(player), 30);
  assert.equal(inventory.getAmount(DRUIDIC_SPELL), 0);
  inventory.deleteNumber(SPADE, 1);
  await help();
  assert.equal(quest.getStage(player), 35);
  assert.equal(inventory.getAmount(DRUIDIC_SPELL), 1);
});

test('Nature Spirit native item use requires held items and ghostspeak, including direct mirror use at stage10', async t => {
  const f = fillimanFixture(t, 10), { player, quest } = f, inventory = player.getInventory();
  const { MIRROR, JOURNAL } = core.ItemIdentifiers;
  await f.use(MIRROR);
  assert.equal(quest.getStage(player), 10);
  assert.equal(player.getDialogueManager().getCurrent(), undefined);
  inventory.add(new core.Item(MIRROR));
  player.getEquipment().setItem(core.Equipment.AMULET_SLOT, null);
  await f.use(MIRROR);
  assert.equal(player.getDialogueManager().getCurrent().getText(), 'Ahhrs Oooohh arhhhhAHhhh.');
  await nextLine(f); assert.equal(quest.getStage(player), 10);
  player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.GHOSTSPEAK_AMULET));
  await f.use(MIRROR);
  await fillimanUntil(f, ({ text }) => text?.startsWith('It must be a sign...'));
  await nextLine(f); assert.equal(quest.getStage(player), 25);
  inventory.add(new core.Item(JOURNAL));
  player.getEquipment().setItem(core.Equipment.AMULET_SLOT, null);
  await f.use(JOURNAL);
  assert.equal(player.getDialogueManager().getCurrent().getText(), 'Ahhrs Oooohh arhhhhAHhhh.');
  await nextLine(f); assert.equal(quest.getStage(player), 25);
  assert.equal(inventory.getAmount(JOURNAL), 1, 'an untranslated conversation cannot take the diary');
});

test('Fairytale I pending dig cancels on native Eat and preserves its newer pose', async t => {
 const f=fixture(t), {player}=f, inv=player.getInventory();
 core.RegionManager.init(); core.RegionManager.loadMapFiles(3106,3384);
 player.setLocation(new core.Location(3106,3385));
 inv.add(new core.Item(core.ItemIdentifiers.SPADE)); inv.add(new core.Item(core.ItemIdentifiers.CABBAGE));
 await nativeDig(f); advanceDig(f,3);
 await f.connection.dispatch([{type:'inventory_action',widgetId:core.CacheDefinitions.getComponentId('inventory:items'),itemId:core.ItemIdentifiers.CABBAGE,slot:inv.getSlotForItemId(core.ItemIdentifiers.CABBAGE),option:'Eat',optionIndex:1}]);
 f.connection.processTurnPackets();
 assert.equal(inv.getAmount(core.ItemIdentifiers.CABBAGE),0,'native Eat consumed the cabbage');
 advanceDig(f,1);
 assert.equal(inv.getAmount(core.ItemIdentifiers.DRAYNOR_SKULL),0,'Eat must interrupt the pending dig');
 assert.equal(player.getAnimation()?.getId(),829,'cancelled dig cannot reset the newer eating pose');
 assert.equal(player.getSkill(),null);
 assert.equal(core.TaskManager.hasActiveTask(player.getIndex(),'DraynorDigTask'),false);
});

for (const studied of [false, true]) {
  test(`Fairytale II native certificate Use reaches its ${studied ? 'studied' : 'unstudied'} Godfather dialogue`, async t => {
    const f = fixture(t), { player } = f;
    const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'fairytale_ii_cure_a_queen');
    const stage = studied ? 30 : 20, certificate = core.ItemIdentifiers.NUFFS_CERTIFICATE;
    quest.setStage(player, stage);
    player.setAttribute('quest.fairytale-ii-cure-a-queen:certificate-studied', studied ? 1 : 0);
    core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
    player.setLocation(new core.Location(3222, 3218)); player.needsPlacement = false;
    const npc = PM.spawnNpc({ id: core.NpcIdentifiers.FAIRY_GODFATHER, x: 3223, y: 3218, z: 0,
      owner: player, ownerOnly: true, wanderRadius: 0 });
    t.after(() => PM.removeNpc(npc));
    const inventory = player.getInventory(); inventory.add(new core.Item(certificate));
    const packet = { type: 'item_on_npc', targetIndex: npc.getIndex(), itemId: certificate,
      slot: inventory.getSlotForItemId(certificate), widgetId: 149 << 16 };
    const use = async () => {
      await f.connection.dispatch([packet]); f.connection.processTurnPackets();
      for (let tick = 0; tick < 8; tick++) {
        core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process();
      }
    };
    await use();
    assert.ok(player.getDialogueManager().getCurrent(), 'native certificate Use opens its canonical conversation');
    player.closeInterruptibleInterfaces(); await nextLine(f);
    assert.equal(player.getDialogueManager().getCurrent(), undefined, 'stale Continue cannot resume the cancelled use');
    await use();
    const lines = [];
    for (let n = 0; n < 8 && player.getDialogueManager().getCurrent(); n++) {
      lines.push(player.getDialogueManager().getCurrent().getText().replace(/\s+/g, ' '));
      await nextLine(f);
    }
    assert.deepEqual(lines, studied ? [
      'Do you know what these strange marks mean?',
      'For why you show-a me dat? Eez very nice to see yous learning to draw! Bravo!',
    ] : ['For why you show-a me dat? I-a busy fairy! I donn-a have time for nonsense!']);
    assert.equal(player.getDialogueManager().getCurrent(), undefined);
    assert.equal(inventory.getAmount(certificate), 1, 'showing the certificate does not consume it');
    assert.equal(quest.getStage(player), stage);
    assert.equal(player.getAttribute('quest.fairytale-ii-cure-a-queen:certificate-studied'), studied ? 1 : 0);
    inventory.deleteNumber(certificate, 1);
    await use();
    assert.equal(player.getDialogueManager().getCurrent(), undefined, 'native Use without the certificate cannot start a conversation');
  });
}

function documentPackets(f, t) {
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  const sender = f.player.getPacketSender(), calls = [];
  for (const [method, tag] of [['sendClientScript', 'script'], ['sendInterface', 'open']]) {
    const original = sender[method];
    t.mock.method(sender, method, function (...args) { calls.push([tag, ...args]); return original.apply(this, args); });
  }
  async function input(bytes) {
    await f.connection.dispatch(decodeClientPackets(bytes)); f.connection.processTurnPackets();
  }
  return {
    calls,
    async certificate(action) {
      const itemId = core.ItemIdentifiers.NUFFS_CERTIFICATE;
      // Cache inventory actions Read/Study use widget ops2/3 (script7779/enum4303).
      const frame = Buffer.alloc(9); frame[0] = action === 'Read' ? ClientPacketId.IF_BUTTON2 : ClientPacketId.IF_BUTTON3;
      frame.writeInt32BE(149 << 16, 1);
      frame.writeUInt16BE(Math.max(0, f.player.getInventory().getSlotForItemId(itemId)), 5);
      frame.writeUInt16BE(itemId, 7);
      await input(frame);
    },
    close: () => input(Buffer.from([ClientPacketId.IF_CLOSE])),
    mounted: () => sender.getSubInterfaceAt((161 << 16) | 16)?.groupId,
  };
}

for (const stage of [20, 90]) {
  test(`Fairytale II native Read/Study at stage ${stage} preserves documents and progress across close/reopen`, async t => {
    const f = fixture(t), { player } = f, doc = documentPackets(f, t);
    const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'fairytale_ii_cure_a_queen');
    const certificate = core.ItemIdentifiers.NUFFS_CERTIFICATE, inventory = player.getInventory();
    assert.deepEqual(core.CacheDefinitions.getItem(certificate).inventoryActions.slice(0, 2), ['Read', 'Study']);
    quest.setStage(player, stage); inventory.add(new core.Item(certificate));
    await doc.certificate('Read');
    assert.equal(player.getInterfaceId(), 423); assert.equal(doc.mounted(), 423);
    assert.deepEqual(doc.calls.slice(-2), [['script', 2524, -1, -1], ['open', 423]]);
    assert.equal(quest.getStage(player), stage);
    assert.equal(player.getAttribute('quest.fairytale-ii-cure-a-queen:certificate-studied') ?? 0, 0);
    await doc.close(); assert.equal(player.getInterfaceId(), -1); assert.equal(doc.mounted(), undefined);
    await doc.certificate('Read'); assert.equal(doc.mounted(), 423);
    await doc.certificate('Study');
    assert.equal(player.getInterfaceId(), 424); assert.equal(doc.mounted(), 424);
    assert.deepEqual(doc.calls.slice(-2), [['script', 2524, 4269835, 100], ['open', 424]]);
    assert.equal(quest.getStage(player), Math.max(30, stage));
    assert.equal(player.getPacketSender().getVarbit(2336), 1);
    assert.equal(inventory.getAmount(certificate), 1);
    await doc.close(); await doc.close(); await doc.certificate('Read');
    assert.equal(doc.mounted(), 423, 'Read turns back to the front after Study');
    assert.equal(player.getAttribute('quest.fairytale-ii-cure-a-queen:certificate-studied'), 1);
    await doc.close(); inventory.deleteNumber(certificate, 1);
    const count = doc.calls.length; await doc.certificate('Study');
    assert.equal(doc.calls.length, count, 'a stale item action cannot reopen a document');
    assert.equal(quest.getStage(player), Math.max(30, stage));
  });
}

test('Fairytale II native Rune temple sign opens its document only after studying and can reopen', async t => {
  const f = fixture(t), { player } = f, doc = documentPackets(f, t);
  const messages = [], sendMessage = player.sendMessage;
  t.mock.method(player, 'sendMessage', function (text, ...args) { messages.push(text); return sendMessage.call(this, text, ...args); });
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'fairytale_ii_cure_a_queen');
  core.RegionManager.init(); core.RegionManager.loadMapFiles(2409, 4369);
  player.setLocation(new core.Location(2409, 4370)); player.setNeedsPlacement(false);
  quest.setStage(player, 20);
  const read = async () => {
    await f.connection.dispatch([{ type: 'object_option', id: 16307, x: 2409, y: 4369, clickType: 1 }]);
    f.connection.processTurnPackets();
    for (let tick = 0; tick < 4; tick++) {
      core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process();
    }
  };
  await read();
  assert.ok(messages.includes('The strange markings on the sign mean nothing to you yet.'), 'native map-object action reaches the sign owner');
  assert.equal(doc.mounted(), undefined); assert.equal(player.getPacketSender().getVarbit(2338), 0);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.NUFFS_CERTIFICATE));
  await doc.certificate('Study'); await doc.close();
  await read();
  assert.equal(player.getInterfaceId(), 425); assert.equal(doc.mounted(), 425);
  assert.deepEqual(doc.calls.slice(-2), [['script', 2524, -1, -1], ['open', 425]]);
  assert.equal(player.getPacketSender().getVarbit(2338), 4); assert.equal(quest.getStage(player), 30);
  await doc.close(); assert.equal(doc.mounted(), undefined);
  await read(); assert.equal(doc.mounted(), 425);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.NUFFS_CERTIFICATE), 1);
});

test('Fairytale I Tanglefoot lair gate and Nature Spirit treat wielded magic secateurs as owned', t => {
  const { player } = fixture(t), { MAGIC_SECATEURS, SECATEURS } = core.ItemIdentifiers;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  quest.setStage(player, 70);
  const gap = { x: 2397, y: 4379, z: 0 };
  const enter = () => {
    player.closeInterruptibleInterfaces();
    player.setLocation(new core.Location(gap.x + 1, gap.y, 0));
    // emitObjectInteraction ignores events without an `object`; a stub with a definition skips the cache lookup.
    const objectId = core.ObjectIdentifiers.A_GAP_THROUGH_THE_WALL, definition = { getName: () => 'A gap through the wall', getInteractions: () => [] };
    const handled = PM.emitObjectInteraction({ player, object: { getId: () => objectId, getDefinition: () => definition },
      objectId, definition, location: gap, clickType: 1, handled: false });
    assert.equal(handled, true, 'the quest claims the gap click');
    return player.getDialogueManager().getCurrent()?.getText();
  };
  assert.match(enter(), /^I'm afraid nobody is allowed in there/, 'without the secateurs the gatekeeper refuses');
  player.getInventory().add(new core.Item(MAGIC_SECATEURS));
  assert.match(enter(), /^I've received orders to let you through/, 'carried secateurs let the player in');
  player.getInventory().deleteNumber(MAGIC_SECATEURS, 1);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(MAGIC_SECATEURS));
  assert.match(enter(), /^I've received orders to let you through/, 'wielded secateurs let the player in');
  const enchant = () => PM.emitCustomEvent('npc-dialogue:action', { player, npcId: core.NpcIdentifiers.NATURE_SPIRIT, stepId: 'JQyqMZ', handled: false });
  enchant();
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 0, 'a wielded pair is not duplicated by the Nature Spirit');
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, null);
  enchant();
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 1, 'a lost pair is still replaced');
});
