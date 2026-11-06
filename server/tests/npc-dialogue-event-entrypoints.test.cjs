const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
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
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
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
      const refusalFrom = f.packets.length;
      await select('Yes.');
      assert.equal(quest.getStage(f.player), 0, 'both prerequisite quests are required');
      assert.equal(Number(f.player.getAttribute('quest.points')) || 0, 0);
      assert.equal(f.player.getDialogueManager().getCurrent(), undefined,
        'a rejected start must not play the successful gardener assignment');
      assert.equal(f.player.getPacketSender().getChatboxGroupId(), -1, 'the refusal is visible in the uncovered chatbox');
      f.player.getSession().flushPackets();
      const refusal = Buffer.concat(f.packets.slice(refusalFrom));
      assert.ok(refusal.includes(Buffer.from('You must complete Nature Spirit to start this quest.')),
        'the actual chat packet names the missing prerequisite');
      assert.equal(refusal.includes(Buffer.from('You must complete Lost City to start this quest.')), key === 'lost_city',
        'only missing prerequisites are reported');
      const oldPackets = f.packets.length;
      await choose(f, 1);
      assert.equal(quest.getStage(f.player), 0, 'a stale Yes cannot start the quest');
      assert.equal(f.packets.length, oldPackets, 'the rejected prompt is no longer resumable');
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
  const enchant = () => {
    const action = { player, npcId: core.NpcIdentifiers.NATURE_SPIRIT, stepId: 'JQyqMZ', handled: false };
    PM.emitCustomEvent('npc-dialogue:action', action);
    assert.equal(action.handled, true);
    assert.equal(action.end, true, 'the blessing closes the chat while the scene plays');
    for (let n = 0; n < 12; n++) core.TaskManager.process();
  };
  enchant();
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 0, 'a wielded pair is not duplicated by the Nature Spirit');
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, null);
  enchant();
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 1, 'a lost pair is still replaced');
});

test('Fairytale I Nature Spirit blessing scene runs before the items are consumed', async t => {
  const f = fixture(t), { player } = f;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  const { SECATEURS, MAGIC_SECATEURS, WHITE_BERRIES, MORT_MYRE_PEAR, MORT_MYRE_STEM } = core.ItemIdentifiers;
  quest.setStage(player, 60);
  player.setAttribute(NATURE_ITEMS_ATTRIBUTE, '1,2,3');
  player.getInventory().add(new core.Item(SECATEURS));
  for (const id of [WHITE_BERRIES, MORT_MYRE_PEAR, MORT_MYRE_STEM]) player.getInventory().add(new core.Item(id));
  const npc = core.NPC.create(core.NpcIdentifiers.NATURE_SPIRIT, new core.Location(3441, 9738, 1));
  const graphics = [], sender = player.getPacketSender(), sendGraphic = sender.sendGraphic.bind(sender);
  sender.sendGraphic = (graphic, location) => {
    graphics.push([graphic.getId(), location.getX(), location.getY(), location.getZ()]);
    return sendGraphic(graphic, location);
  };
  const action = { player, npc, npcId: npc.getId(), stepId: 'JQyqMZ', handled: false,
    pages: [{ page: 'Fairytale I - Growing Pains', variants: ['in-the-nature-grotto-talking-to-the-nature-spirit'] }] };
  PM.emitCustomEvent('npc-dialogue:action', action);
  assert.equal(action.handled, true);
  assert.equal(action.end, true, 'the chat closes while the scene plays');
  assert.equal(player.getAnimation()?.getId(), core.CacheDefinitions.getSeqId('human_fairy_kneel_and_offer'),
    'the player kneels and offers the secateurs');
  assert.equal(player.getMovementQueue().isMovementBlocked(), true);
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 0);
  assert.equal(quest.getStage(player), 60);
  for (let n = 0; n < 11; n++) core.TaskManager.process();
  assert.deepEqual(graphics, [[core.CacheDefinitions.getSpotanimId('fairy_flower_enchant'), 3441, 9738, 1]],
    'the cache flower-enchant effect plays above the Nature Spirit');
  assert.equal(npc.getAnimation()?.getId(), core.CacheDefinitions.getSeqId('human_fairy_take_and_hold_up'),
    'the Nature Spirit takes and holds the secateurs up');
  assert.equal(player.getInventory().getAmount(SECATEURS), 1, 'materials survive the scene');
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 0);
  assert.equal(quest.getStage(player), 60);
  core.TaskManager.process();
  assert.equal(player.getInventory().getAmount(SECATEURS), 0);
  for (const id of [WHITE_BERRIES, MORT_MYRE_PEAR, MORT_MYRE_STEM]) {
    assert.equal(player.getInventory().getAmount(id), 0, 'the blessing consumes the saved recipe');
  }
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 1);
  assert.equal(quest.getStage(player), 70);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.match(player.getDialogueManager().getCurrent()?.getText() ?? '', /^It is done!/);
  await nextLine(f);
  assert.match(player.getDialogueManager().getCurrent()?.getText() ?? '', /^Farewell,/);
});

test('Fairytale I blessing cancellation leaves the materials and stage untouched', t => {
  const f = fixture(t), { player } = f;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  const { SECATEURS, MAGIC_SECATEURS, WHITE_BERRIES, MORT_MYRE_PEAR, MORT_MYRE_STEM } = core.ItemIdentifiers;
  quest.setStage(player, 60);
  player.setAttribute(NATURE_ITEMS_ATTRIBUTE, '1,2,3');
  player.getInventory().add(new core.Item(SECATEURS));
  for (const id of [WHITE_BERRIES, MORT_MYRE_PEAR, MORT_MYRE_STEM]) player.getInventory().add(new core.Item(id));
  const npc = core.NPC.create(core.NpcIdentifiers.NATURE_SPIRIT, new core.Location(3441, 9738, 1));
  const action = { player, npc, npcId: npc.getId(), stepId: 'JQyqMZ', handled: false };
  PM.emitCustomEvent('npc-dialogue:action', action);
  for (let n = 0; n < 3; n++) core.TaskManager.process();
  player.setLocation(new core.Location(3442, 9738, 1));
  core.TaskManager.process();
  assert.equal(player.getInventory().getAmount(SECATEURS), 1, 'walking away does not consume the secateurs');
  assert.equal(player.getInventory().getAmount(MAGIC_SECATEURS), 0);
  assert.equal(quest.getStage(player), 60);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(player.getAnimation()?.getId(), core.Animation.DEFAULT_RESET_ANIMATION.getId());
});

test('Fairytale I Tanglefoot combat pursuit stops at its chamber doorway', t => {
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2394, 4379);
  const f = fixture(t), { player } = f;
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'fairytale_i_growing_pains');
  player.setLocation(new core.Location(2375, 4384, 0));
  quest.setStage(player, 70);
  PM.emitPlayerProcess({ player });
  const boss = [...core.World.getNpcs()].find(npc => npc?.getId?.() === core.NpcIdentifiers.TANGLEFOOT
    && npc.getOwner?.() === player);
  assert.ok(boss, 'entering the grove spawns the owner Tanglefoot');
  t.after(() => {
    core.TaskManager.cancelTasks(boss);
    core.World.getNpcs().remove(boss);
  });
  assert.equal(boss.hasFlag('combat:no-retreat'), true, 'the chamber is the leash, not the generic spawn radius');
  boss.getCombat().attack(player);
  core.TaskManager.process();
  assert.equal(boss.getCombat().getTarget(), player, 'the fight can pursue anywhere inside the chamber');
  player.setLocation(new core.Location(2383, 4377, 0));
  core.TaskManager.process();
  assert.equal(boss.getCombat().getTarget() ?? null, null, 'leaving the chamber drops the pursuit');
  player.setLocation(new core.Location(2375, 4384, 0));
  boss.getCombat().attack(player);
  core.TaskManager.process();
  boss.setLocation(new core.Location(2390, 4379, 0));
  core.TaskManager.process();
  const at = boss.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [2375, 4385, 0],
    'a boss that ever leaves the chamber is returned to its spawn');
});

// The banquet uses real Player/NPC/PrivateArea/TaskManager and native object,
// Talk-to and Continue producers. No gameplay server or fabricated dialogue runner.
const RFD_FEAST_PENDING = 'recipe-for-disaster:feast-pending';
const RFD_FEAST_SEEN = 'recipe-for-disaster:feast-seen';
function rfdOldSave() {
  const { JsonPlayerPersistence } = require('../plugins/persistence/JsonPlayerPersistence.plugin');
  const codec = new JsonPlayerPersistence();
  // Produced by the pre-feast quest through a native ingredient handover and PlayerSave.
  const json = require('node:fs').readFileSync(path.join(__dirname, 'fixtures/rfd-opening-pre-feast-save.json'), 'utf8');
  const save = codec.hydratePlayerSave(JSON.parse(json, codec.reviver.bind(codec)));
  assert.equal(Object.hasOwn(save.attributes, RFD_FEAST_PENDING), false);
  assert.equal(Object.hasOwn(save.attributes, RFD_FEAST_SEEN), false);
  return { save, codec };
}
function rfdSavedProgress(player) {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const save = PlayerSave.fromPlayer(player);
  return JSON.stringify({
    attributes: Object.fromEntries(Object.entries(save.attributes).filter(([key]) =>
      (key.startsWith('recipe-for-disaster:') || key === 'quest.recipe_for_disaster.stage' || key === 'quest.points')
      && key !== RFD_FEAST_PENDING && key !== RFD_FEAST_SEEN)),
    inventory: save.inventory,
  });
}
async function rfdCookTalk(f) {
  f.player.closeInterruptibleInterfaces();
  f.player.setLocation(new core.Location(3209,3215));
  f.player.setNeedsPlacement(false);
  await f.connection.dispatch([{ type: 'npc_option', index: f.npc.getIndex(), clickType: 1 }]);
  f.connection.processTurnPackets(); f.tick(3);
  return f.player.getDialogueManager().getCurrent()?.getText();
}
function rfdFeastFixture(t, { historical = false, selim = false } = {}) {
  const f = fixture(t), { player } = f;
  core.RegionManager.init();
  player.setIndex(player.getIndex() % 2000); // Native player sync has an eleven-bit local index.
  player.getSession().setPlayer(player);
  f.nativeFrames = [];
  const send = player.getSession().sendClientPacket;
  t.mock.method(player.getSession(), 'sendClientPacket', function(packet) {
    f.nativeFrames.push(packet);
    return send.call(this, packet);
  });
  const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  f.quest = quests.find(q => q.key === 'recipe_for_disaster');
  const cooks = quests.find(q => q.key === 'cooks_assistant');
  cooks.setStage(player, cooks.completionValue);
  if (selim) {
    const bcs = quests.find(q => q.key === 'beneath_cursed_sands');
    bcs.setStage(player, bcs.completionValue);
  }
  f.quest.setStage(player, historical ? 4 : 1);
  player.setLocation(new core.Location(3209, 3215));
  f.npc = core.NPC.create(core.CacheDefinitions.getNpcId('cook'), new core.Location(3208, 3215));
  core.World.getNpcs().add(f.npc);
  f.effects = [];
  const spawn = PM.spawnNpc;
  t.mock.method(PM, 'spawnNpc', function(definition, ...args) {
    const npc = spawn.call(this, definition, ...args);
    if (npc && definition.owner === player) {
      for (const method of ['performAnimation', 'performGraphic', 'setBaseAnimations', 'exactMove', 'forceChat']) {
        const original = npc[method];
        t.mock.method(npc, method, function(...values) {
          f.effects.push({ id: npc.getId(), method, values });
          return original.apply(this, values);
        });
      }
    }
    return npc;
  });
  const cycle = core.World.processCycle;
  f.owned = () => {
    const result = [];
    core.World.getNpcs().forEach(npc => { if (npc.getOwner?.() === player) result.push(npc); });
    return result;
  };
  f.tick = (count = 1) => {
    for (let n = 0; n < count; n++) {
      ++core.World.processCycle;
      player.getArea()?.process(player);
      core.TaskManager.processWalkTo(player.getIndex());
      for (const npc of f.owned()) npc.getMovementQueue().process();
      player.getMovementQueue().process();
      core.TaskManager.process();
      const npcs = f.owned();
      core.World.updateLocalNpcs(player, npcs);
      player.getSession().flush(core.World.getProcessCycle());
      for (const npc of npcs) { npc.resetUpdating(); npc.setNeedsPlacement(false); }
      player.setNeedsPlacement(false);
    }
  };
  f.click = async (id, x, y, clickType = 1) => {
    await f.connection.dispatch([{ type: 'object_option', id, x, y, clickType }]);
    f.connection.processTurnPackets();
    f.tick(5);
  };
  f.enter = async () => {
    player.closeInterruptibleInterfaces();
    player.setLocation(new core.Location(3214, 3221));
    await f.click(12349, 3213, 3221);
    f.tick(2);
  };
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    for (const npc of f.owned()) PM.removeNpc(npc);
    core.World.getNpcs().remove(f.npc);
    core.World.processCycle = cycle;
  });
  return f;
}
async function rfdHandover(f) {
  for (const id of [core.ItemIdentifiers.EYE_OF_NEWT, core.ItemIdentifiers.GREENMANS_ALE,
    core.ItemIdentifiers.ROTTEN_TOMATO, core.ItemIdentifiers.DIRTY_BLAST]) f.player.getInventory().add(new core.Item(id));
  await f.connection.dispatch([{ type: 'npc_option', index: f.npc.getIndex(), clickType: 1 }]);
  f.connection.processTurnPackets();
  for (let n = 0; n < 5; n++) {
    core.TaskManager.processWalkTo(f.player.getIndex()); f.player.getMovementQueue().process();
  }
  for (let n = 0; n < 12 && f.quest.getStage(f.player) < 4; n++) await nextLine(f);
  assert.equal(f.quest.getStage(f.player), 4, `the native Cook conversation accepts the ingredients: ${JSON.stringify({current:f.player.getDialogueManager().getCurrent()?.getText?.(),prompt:MultiChatboxPrompt.getPending(f.player),location:f.player.getLocation()})}`);
}
async function finishRfdFeast(f) {
  const lines = [];
  for (let n = 0; n < 180 && f.player.getAttribute(RFD_FEAST_PENDING); n++) {
    const current = f.player.getDialogueManager().getCurrent();
    const text = current?.getText?.()?.replace(/\s+/g, ' ');
    if (text) { lines.push(text); await nextLine(f); }
    f.tick();
  }
  assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), false, `canonical final fade completes the feast: ${JSON.stringify({last:lines.slice(-4),current:f.player.getDialogueManager().getCurrent()?.constructor.name, area:!!f.player.getPrivateArea()})}`);
  return lines;
}

test('RFD native first dining entry plays the complete feast and freezes the owned council', async t => {
  const f = rfdFeastFixture(t), { player } = f;
  const points = Number(player.getAttribute('quest.points')) || 0;
  await rfdHandover(f);
  assert.equal(player.getAttribute(RFD_FEAST_PENDING), true);
  assert.equal(player.getAttribute('quest.points'), points + 1);
  assert.equal(player.getPacketSender().getVarbit(1850), 2, 'the pre-feast chest and finale portal stay hidden');
  await f.enter();
  const scene = player.getPrivateArea();
  assert.ok(scene, 'real dining-door dispatch creates a private feast');
  assert.match(player.getDialogueManager().getCurrent()?.getText(), /Welcome, gentlemen/);
  const actors = f.owned();
  core.World.updateLocalNpcs(player, actors);
  assert.ok(player.getLocalNpcs().some(npc => npc.getId() === core.NpcIdentifiers.DUKE_HORACIO));
  const stranger = fixture(t).player;
  stranger.setLocation(player.getLocation().clone());
  core.World.updateLocalNpcs(stranger, actors);
  assert.equal(stranger.getLocalNpcs().length, 0, 'the feast cast is private to its owner');
  const lines = await finishRfdFeast(f);
  for (const phrase of ['I welcome Osman', 'Excuse me while I deal with this', 'Nooooooooooooo!',
    'Ooh – nice food!', "Aha! I'm BACK!", "And now I'll kill you!", "Sorry I'm late", 'TEMPUS CESSIT!']) {
    assert.ok(lines.some(line => line.includes(phrase)), phrase);
  }
  assert.equal(!!player.getPrivateArea(), false);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(player.isUntargetable(), false);
  assert.equal(player.getPacketSender().getVarbit(1850), 3);
  assert.equal(player.getAttribute('quest.points'), points + 1, 'the feast does not award another opening point');
  for (const [id, freeze] of [[3390,3376],[3389,3373],[3391,3388],[3392,3384],[3393,3361],
    [3394,3367],[3395,3370],[3396,3392],[3398,3380],[3400,3364]]) {
    assert.ok(f.effects.some(e => e.id === id && e.method === 'performAnimation' && e.values[0].getId() === freeze), `model-specific freeze ${id}`);
  }
  assert.ok(f.effects.some(e => e.id === 11891 && e.method === 'performAnimation' && e.values[0].getId() === 3397));
  assert.ok(f.effects.some(e => e.id === 3397 && e.method === 'exactMove'), 'the monkey visibly moves when kicked');
  assert.ok(f.effects.some(e => e.id === 11891 && e.method === 'performGraphic' && e.values[0].getId() === 601), 'Aris is targeted before freezing time');
  for (const text of ['Greetings, Horacio!', 'Meoooooow!', 'Ikik...']) {
    assert.ok(f.effects.some(e => e.method === 'forceChat' && e.values[0] === text), `actual actor overhead: ${text}`);
  }
  assert.ok(f.nativeFrames.some(packet => packet[0] === 21 && packet.length > 12), 'actual PlayerSession emits the visible cast in native NPC_INFO');
  assert.ok(f.owned().some(npc => npc.getId() === 4849), 'the Culinaromancer remains visibly frozen');
  assert.ok(f.owned().filter(npc => npc.getId() !== 11891 && npc.getId() !== 4849).every(npc => npc.getBaseAnimationsForUpdate()?.length), 'the ordinary rescue IDs retain frozen poses');
  await f.enter();
  assert.equal(player.getPrivateArea(), null, 'repeat entry goes to the dormant room without replay');
  assert.equal(player.getAttribute('quest.points'), points + 1);
  assert.equal(player.getAttribute(RFD_FEAST_SEEN), true);
});

test('RFD native feast selects Selim, cancels safely and resumes without repeating ingredients or rewards', async t => {
  const f = rfdFeastFixture(t, { selim: true }), { player } = f;
  await rfdHandover(f);
  const points = player.getAttribute('quest.points');
  await f.enter();
  const first = player.getPrivateArea();
  await nextLine(f); f.tick();
  assert.match(player.getDialogueManager().getCurrent()?.getText(), /I welcome Selim/);
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets(); f.tick();
  assert.equal(!!player.getPrivateArea(), false);
  assert.equal(first.isDestroyed(), true);
  assert.equal(player.getAttribute(RFD_FEAST_PENDING), true);
  assert.equal(player.getAttribute(RFD_FEAST_SEEN), false);
  assert.equal(f.owned().length, 0);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3214,3221]);
  await nextLine(f); f.tick(5);
  assert.equal(player.getAttribute(RFD_FEAST_PENDING), true, 'stale native Continue cannot complete an abandoned feast');
  await f.enter();
  const lines = await finishRfdFeast(f);
  assert.ok(lines.some(line => line.includes('I welcome Selim')));
  assert.ok(!lines.some(line => line.includes('I welcome Osman')));
  assert.equal(player.getAttribute('quest.points'), points);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.DIRTY_BLAST), 0);
});

test('RFD pending-feast Cook retalk invites entry across cancel and relog, then restores the later conversation', async t => {
  const f = rfdFeastFixture(t);
  await rfdHandover(f);
  const points = f.player.getAttribute('quest.points');
  assert.equal(await rfdCookTalk(f), "How's that banquet going?");
  const widgetId = (f.player.getPacketSender().getChatboxGroupId() << 16) | 5;
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId, childIndex: -1 }]);
  f.connection.processTurnPackets(); f.tick(2);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined);
  assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), true, 'closing the reminder does not consume the feast');
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  const save = require('../dist/game/entity/impl/player/persistence/PlayerSave').PlayerSave.fromPlayer(f.player);
  const restored = rfdFeastFixture(t, { historical: true });
  save.applyToPlayer(restored.player);
  PM.emitCustomEvent('player:bootstrap-complete', { player: restored.player });
  assert.equal(await rfdCookTalk(restored), "How's that banquet going?", 'the saved pending handoff keeps the invitation');
  await nextLine(restored);
  assert.match(restored.player.getDialogueManager().getCurrent()?.getText(), /gone and looked at the feast/);
  await restored.enter(); await finishRfdFeast(restored);
  assert.equal(await rfdCookTalk(restored), 'Can we talk about what happened in the dining room?');
  assert.equal(restored.player.getAttribute('quest.points'), points);
  assert.equal(restored.player.getInventory().getAmount(core.ItemIdentifiers.DIRTY_BLAST), 0);
  const historical = rfdFeastFixture(t, { historical: true });
  historical.player.setAttribute('recipe-for-disaster:rescues', 17);
  assert.equal(await rfdCookTalk(historical), 'Can we talk about what happened in the dining room?',
    'opening-complete legacy saves retain their existing time-bubble conversation');
});

test('RFD historical stage4 saves retain their rescue progress and native Collect uses actual op3', async t => {
  const f = rfdFeastFixture(t, { historical: true }), { player } = f;
  player.setAttribute('recipe-for-disaster:rescues', 17);
  await f.enter();
  assert.equal(player.getPrivateArea(), null);
  assert.equal(player.getAttribute('recipe-for-disaster:rescues'), 17);
  assert.ok(!f.owned().some(npc => [3390,3394].includes(npc.getId())), 'rescued historical guests stay removed');
  player.setLocation(new core.Location(3218,9623));
  const parent = core.MapObjects.get(12308, new core.Location(3219,9623), null);
  assert.ok(parent, 'the cache provides the transformed chest parent');
  const definition = core.ObjectDefinition.forPlayer(parent.getId(), player);
  assert.equal(definition.getName(), 'Chest');
  assert.equal(definition.getActions()[2], 'Collect');
  await f.click(12309,3219,9623,3);
  assert.equal(player.getInterfaceId(),402,'native op3 reaches the existing GE collection box');
  player.closeInterruptibleInterfaces();
  await f.click(12309,3219,9623,2);
  assert.notEqual(player.getInterfaceId(),402,'blank op2 does not collect');
  await f.click(12309,3219,9623,1);
  assert.notEqual(player.getInterfaceId(),402,'Bank stays with the bank handler');
});

test('RFD feast logout persists the pending handoff and replays after real PlayerSave recovery', async t => {
  const f = rfdFeastFixture(t);
  await rfdHandover(f); await f.enter();
  const points = f.player.getAttribute('quest.points');
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.equal(!!f.player.getPrivateArea(), false);
  assert.equal(f.owned().length, 0);
  assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), true);
  const save = require('../dist/game/entity/impl/player/persistence/PlayerSave').PlayerSave.fromPlayer(f.player);
  const restored = rfdFeastFixture(t, { historical: true });
  save.applyToPlayer(restored.player);
  PM.emitCustomEvent('player:bootstrap-complete', { player: restored.player });
  assert.equal(restored.player.getAttribute(RFD_FEAST_PENDING), true);
  assert.equal(restored.player.getPacketSender().getVarbit(1850), 2);
  await restored.enter(); await finishRfdFeast(restored);
  assert.equal(restored.player.getAttribute('quest.points'), points);
  assert.equal(restored.player.getInventory().getAmount(core.ItemIdentifiers.DIRTY_BLAST), 0);
});

test('RFD feast cancels on real death without consuming its pending retry', async t => {
  const f = rfdFeastFixture(t);
  await rfdHandover(f); await f.enter();
  f.player.appendDeath(); f.tick();
  assert.equal(!!f.player.getPrivateArea(), false);
  assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), true);
  assert.equal(f.owned().length, 0);
  assert.equal(f.player.isUntargetable(), true, 'the real death task retains its own protection after scene cleanup');
});

test('RFD stale final-fade callback preserves a replacement native prompt and pending retry', async t => {
  const f = rfdFeastFixture(t), { player } = f;
  await rfdHandover(f); await f.enter();
  let finalLine = false;
  for (let n = 0; n < 160; n++) {
    const text = player.getDialogueManager().getCurrent()?.getText?.();
    if (text?.includes('you must help me defeat this evil!')) { finalLine = true; break; }
    if (text) await nextLine(f);
    f.tick();
  }
  assert.equal(finalLine,true);
  await nextLine(f); // The canonical final fade is now pending.
  PM.createApi('RfdReplacement').sendMultiChatboxPrompt(player,'Keep this question', 'Yes',()=>{},'No',()=>{});
  const replacement = player.getDialogueManager().getCurrent();
  f.tick(4);
  assert.equal(!!player.getPrivateArea(),false);
  assert.equal(player.getAttribute(RFD_FEAST_PENDING),true,'an abandoned final fade must not commit');
  assert.equal(player.getAttribute(RFD_FEAST_SEEN),false,'a replaced final fade cannot mark the feast seen');
  assert.equal(player.getDialogueManager().getCurrent(),replacement);
  assert.equal(MultiChatboxPrompt.getPending(player).title,'Keep this question');
  assert.equal(f.owned().length,0);
});

test('RFD actual pre-feast saves recover on login before frozen-room routing and complete only once', async t => {
  for (const insideRoom of [false, true]) await t.test(insideRoom ? 'saved in the frozen room' : 'saved in the kitchen', async t => {
    const f = rfdFeastFixture(t), { save, codec } = rfdOldSave();
    if (insideRoom) save.position = new core.Location(1867,5348);
    save.applyToPlayer(f.player);
    const progress = rfdSavedProgress(f.player);
    PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
    assert.equal(f.quest.getStage(f.player), 4);
    assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), true, 'recover the actual unmarked opening-only save');
    assert.equal(f.player.getAttribute(RFD_FEAST_SEEN), false);
    assert.equal(f.player.getPacketSender().getVarbit(1850), 2);
    if (insideRoom) assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3214,3221]);
    assert.equal(f.owned().filter(npc => npc.getLocation().getX() >= 1855 && npc.getLocation().getX() <= 1870
      && npc.getLocation().getY() >= 5338 && npc.getLocation().getY() <= 5358).length, 0,
    'recovery precedes frozen-council spawning');
    assert.equal(rfdSavedProgress(f.player), progress, 'migration does not rewrite quest progress, points or items');
    assert.equal(await rfdCookTalk(f), "How's that banquet going?");
    await f.enter();
    await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets(); f.tick();
    assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), true);
    assert.equal(f.player.getAttribute(RFD_FEAST_SEEN), false);
    await f.enter(); await finishRfdFeast(f);
    assert.equal(f.player.getAttribute(RFD_FEAST_SEEN), true);
    assert.equal(rfdSavedProgress(f.player), progress, 'replaying the missing scene cannot consume ingredients or award another point');
    PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
    const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
    const serialized = JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec));
    const restoredSave = codec.hydratePlayerSave(JSON.parse(serialized, codec.reviver.bind(codec)));
    const restored = rfdFeastFixture(t);
    restoredSave.applyToPlayer(restored.player);
    PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername(), isNewAccount: false });
    PM.emitCustomEvent('player:bootstrap-complete', { player: restored.player });
    assert.equal(restored.player.getAttribute(RFD_FEAST_SEEN), true);
    assert.equal(restored.player.getAttribute(RFD_FEAST_PENDING), false);
    assert.equal(restored.player.getPacketSender().getVarbit(1850), 3);
    assert.equal(await rfdCookTalk(restored), 'Can we talk about what happened in the dining room?');
    await restored.enter();
    assert.equal(restored.player.getPrivateArea(), null, 'a completed zero-rescue save does not replay the feast');
    assert.equal(rfdSavedProgress(restored.player), progress);
  });
});

test('RFD unmarked saves with any recorded rescue or finale progress retain every progression byte', async t => {
  const cases = [
    ['rescues', 17],
    ...['pirate', 'goblin', 'dwarf', 'guide', 'evil-dave', 'skrach', 'amik', 'awowogei'].map(name => [`${name}-stage`, 1]),
    ['pirate-state', 16], ['goblin-state', 1], ['dwarf-state', 8], ['guide-state', 1],
    ['evil-dave-state', 1], ['skrach-state', 256], ['amik-state', 1], ['awowogei-state', 256],
    ['pirate-hides-given', 1], ['pirate-first-dive', true],
    ['evil-dave-recipe', { red: 1, yellow: 2, brown: 3, orange: 0 }],
    ['evil-dave-stew', { doses: { red: 1 } }],
    ['amik-dragon-drop', true], ['amik-chicken-dead', true], ['amik-wom-briefed', 1],
    ['culinaromancer-wave', 1], ['culinaromancer-defeated', true],
  ];
  for (const [key, value] of cases) await t.test(key, t => {
    const f = rfdFeastFixture(t), { save } = rfdOldSave();
    save.attributes[`recipe-for-disaster:${key}`] = value;
    save.applyToPlayer(f.player);
    const progress = rfdSavedProgress(f.player);
    PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
    PM.emitCustomEvent('player:bootstrap-complete', { player: f.player });
    assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), false, 'recorded partial progress is never treated as an unseen opening');
    assert.equal(!!f.player.getAttribute(RFD_FEAST_SEEN), false, 'recovery does not invent a completed feast');
    assert.equal(rfdSavedProgress(f.player), progress, 'classification and synchronization are pure reads of existing progression');
    assert.equal(f.player.getPrivateArea(), null);
  });
  for (const stage of [0, 1, 3, 5, 10]) await t.test(`other main stage ${stage}`, t => {
    const f = rfdFeastFixture(t), { save } = rfdOldSave();
    save.attributes['quest.recipe_for_disaster.stage'] = stage;
    save.applyToPlayer(f.player);
    const progress = rfdSavedProgress(f.player);
    PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
    assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), false);
    assert.equal(rfdSavedProgress(f.player), progress);
  });
});

test('RFD already-loaded unmarked saves recover through native Cook and dining-door inputs', async t => {
  for (const input of ['cook', 'door']) await t.test(input, async t => {
    const f = rfdFeastFixture(t), { save } = rfdOldSave();
    save.applyToPlayer(f.player);
    const progress = rfdSavedProgress(f.player);
    if (input === 'cook') assert.equal(await rfdCookTalk(f), "How's that banquet going?");
    else { await f.enter(); assert.ok(f.player.getPrivateArea()); }
    assert.equal(f.player.getAttribute(RFD_FEAST_PENDING), true);
    assert.equal(f.player.getPacketSender().getVarbit(1850), 2);
    assert.equal(rfdSavedProgress(f.player), progress);
  });
});

function pandemoniumJimFixture(t) {
  const f = fixture(t);
  core.RegionManager.init();
  f.player.setAttribute('pandemonium:stage-version', 2);
  f.quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'pandemonium');
  f.quest.setStage(f.player, 30); // The cargo hold was built; Jim is ready to issue the log.
  f.npc = core.NPC.create(core.NpcIdentifiers.JUNIOR_JIM, new core.Location(2083,2730));
  core.World.getNpcs().add(f.npc);
  t.after(() => core.World.getNpcs().remove(f.npc));
  f.talk = async () => {
    f.player.closeInterruptibleInterfaces();
    // The canonical shipyard return waits for the conversation to close, then lands normally.
    for (let n = 0; n < 16; n++) core.TaskManager.process();
    f.player.setLocation(new core.Location(2084,2730));
    f.player.setNeedsPlacement(false);
    await f.connection.dispatch([{ type: 'npc_option', index: f.npc.getIndex(), clickType: 1 }]);
    f.connection.processTurnPackets();
    for (let n = 0; n < 5; n++) {
      core.TaskManager.processWalkTo(f.player.getIndex()); f.player.getMovementQueue().process(); core.TaskManager.process();
    }
    assert.ok(f.player.getDialogueManager().getCurrent(), 'the real named Jim interaction starts its canonical source');
  };
  f.finish = async (stop = () => false) => {
    for (let n = 0; n < 80 && !stop(); n++) {
      if (MultiChatboxPrompt.getPending(f.player)) await choose(f, 1);
      else if (f.player.getDialogueManager().getCurrent()) await nextLine(f);
      else break;
      core.TaskManager.process();
    }
  };
  f.tasks = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
  return f;
}

test('Pandemonium native initial Jim request assigns cargo before the first Sarim table visit', async t => {
  const f = pandemoniumJimFixture(t);
  await f.talk(); await f.finish();
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.CAPTAINS_LOG), 1);
  assert.equal(f.quest.getStage(f.player), 34);
  assert.deepEqual(f.tasks.slots(f.player)[0], { id: 599, taken: 0, delivered: 0 });
  for (let n = 0; n < 12; n++) core.TaskManager.process(); // Finish the owned shipyard return first.
  f.player.closeInterruptibleInterfaces();
  core.RegionManager.loadMapFiles(3028,3194);
  f.player.setLocation(new core.Location(3028,3193));
  f.player.setNeedsPlacement(false);
  const id = core.CacheDefinitions.getLocId('dock_loading_bay_ledger_table_port_sarim');
  await f.connection.dispatch([{ type: 'object_option', id, x: 3028, y: 3194, clickType: 1 }]);
  f.connection.processTurnPackets();
  for (let n = 0; n < 12; n++) {
    core.TaskManager.processWalkTo(f.player.getIndex()); f.player.getMovementQueue().process(); core.TaskManager.process();
  }
  assert.equal(f.tasks.heldCrate(f.player), core.ItemIdentifiers.CRATE_OF_SHIP_PARTS_7);
  assert.equal(f.tasks.slots(f.player)[0].taken, 1);
});

test('Pandemonium native cancelled log handover recovers once on Jim retalk', async t => {
  const f = pandemoniumJimFixture(t);
  await f.talk(); await f.finish(() => f.quest.getStage(f.player) === 32);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.CAPTAINS_LOG), 1);
  assert.ok(!f.tasks.slots(f.player).some(slot => slot?.id === 599));
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets();
  await nextLine(f); core.TaskManager.process();
  assert.ok(!f.tasks.slots(f.player).some(slot => slot?.id === 599), 'stale Continue cannot finish the abandoned request');
  await f.talk(); await f.finish();
  assert.equal(f.quest.getStage(f.player), 34);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.CAPTAINS_LOG), 1);
  assert.equal(f.tasks.slots(f.player).filter(slot => slot?.id === 599).length, 1);
});

test('Pandemonium native full bag preserves the log handover until space is made', async t => {
  const f = pandemoniumJimFixture(t);
  for (let n = 0; n < 28; n++) f.player.getInventory().addItem(new core.Item(core.ItemIdentifiers.BONES, 1));
  assert.equal(f.player.getInventory().getFreeSlots(), 0);
  await f.talk(); await f.finish();
  assert.equal(f.quest.getStage(f.player), 30);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.CAPTAINS_LOG), 0);
  assert.ok(!f.tasks.slots(f.player).some(slot => slot?.id === 599));
  f.player.getInventory().deleteNumber(core.ItemIdentifiers.BONES, 1);
  await f.talk(); await f.finish();
  assert.equal(f.quest.getStage(f.player), 34);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.CAPTAINS_LOG), 1);
  assert.equal(f.tasks.slots(f.player).filter(slot => slot?.id === 599).length, 1);
});

test('Pandemonium native cargo assignment preserves a full task list and recovers after a slot is freed', async t => {
  const f = pandemoniumJimFixture(t);
  f.player.getSkillManager().setMaxLevel(core.Skill.SAILING, 99);
  const tasks = f.tasks.DATA.tasks.filter(task => task.cancellable !== false).slice(0, 5)
    .map(task => ({ id: task.id, taken: 0, delivered: 0 }));
  f.tasks.setSlots(f.player, tasks);
  const before = JSON.stringify(f.tasks.slots(f.player));
  await f.talk(); await f.finish();
  assert.equal(f.quest.getStage(f.player), 32, 'the request cannot advance without an actual task slot');
  assert.equal(JSON.stringify(f.tasks.slots(f.player)), before);
  require('../plugins/skills/sailing/porttasks/PortMaster.PortTasks').cancel(f.player, 4);
  await f.talk(); await f.finish();
  assert.equal(f.quest.getStage(f.player), 34);
  assert.deepEqual(f.tasks.slots(f.player).slice(0, 4), tasks.slice(0, 4));
  assert.deepEqual(f.tasks.slots(f.player)[4], { id: 599, taken: 0, delivered: 0 });
});

function pandemoniumShipFixture(t, stage = 14, save) {
  const f = fixture(t);
  core.RegionManager.init();
  f.player.setIndex(f.player.getIndex() % 2000);
  f.player.getSession().setPlayer(f.player);
  f.player.setUsername(`pandemonium${f.player.getIndex()}`);
  f.quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'pandemonium');
  if (save) {
    save.applyToPlayer(f.player);
    core.Sailing.onLogin(f.player);
  } else {
    f.player.setAttribute('pandemonium:stage-version', 2);
    f.quest.setStage(f.player, stage);
  }
  const lifecycle = () => ({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  f.login = () => PM.emitPlayerLogin(lifecycle());
  t.after(() => PM.emitPlayerLogout(lifecycle()));
  f.login();
  const ships = require('../plugins/skills/sailing/StaticShips.Sailing');
  f.ship = () => ships.all().find(ship => ship.boat.ownerPlayerId === f.player.getIndex());
  return f;
}

test('Pandemonium native: the tutorial uses its two-column cache hull and keeps both crew on deck', t => {
  const f = pandemoniumShipFixture(t), ship = f.ship();
  assert.ok(ship, 'the real login handler restores the owner-only tutorial ship');
  assert.deepEqual([ship.boat.configId, ship.spec.templateChunkX, ship.spec.templateChunkY], [2, 480, 800],
    'the captured tutorial template uses the active-cache 2x5 world-entity type');
  assert.deepEqual([ship.spec.hull.width, ship.spec.hull.length], [256, 640]);
  assert.deepEqual(ship.spec.boardingTile, { x: 4, y: 4 });
  const crew = [...core.World.getNpcs()].filter(npc => npc.getOwner() === f.player && [14958, 14963].includes(npc.getId()));
  assert.equal(crew.length, 2);
  assert.deepEqual(crew.map(npc => [npc.getId(), npc.getLocation().getX() - ship.boat.deckBaseX,
    npc.getLocation().getY() - ship.boat.deckBaseY]).sort((a, b) => a[0] - b[0]), [[14958, 4, 3], [14963, 3, 2]]);
  for (const npc of crew) {
    const x = npc.getLocation().getX() - ship.boat.deckBaseX, y = npc.getLocation().getY() - ship.boat.deckBaseY;
    assert.ok(ship.spec.walkableDeck.some(tile => tile.x === x && tile.y === y), `${npc.getId()} stands on its actual hull`);
  }
});

test('Pandemonium native: first visibility and relog send the interactive hook on the drawn deck plane', t => {
  const f = pandemoniumShipFixture(t);
  const sync = require('../dist/game/content/sailing/WorldEntitySync').WorldEntitySync;
  const hookId = core.CacheDefinitions.getLocId('sailing_intro_salvaging_hook');
  const hookPackets = () => sync.flush(f.player).filter(packet => packet[0] === 134 && packet.readUInt16BE(2) === hookId);
  const verify = () => {
    const ship = f.ship(), packets = hookPackets();
    assert.equal(packets.length, 1, 'one initial hook update reaches the native client');
    assert.deepEqual([packets[0].readUInt16BE(4) - ship.boat.deckBaseX,
      packets[0].readUInt16BE(6) - ship.boat.deckBaseY, packets[0][8], packets[0][9] & 3], [3, 4, 1, 1]);
    assert.equal(packets[0][10] & 1, 1, 'Deploy is enabled');
    assert.ok(core.MapObjects.getPrivateArea(f.player, hookId,
      new core.Location(ship.boat.deckBaseX + 3, ship.boat.deckBaseY + 4, 0)), 'server lookup keeps deck clicks at z=0');
  };
  verify();
  const old = f.ship();
  f.login();
  assert.notEqual(f.ship().boat.entityIndex, old.boat.entityIndex, 'relog recreates the private ship');
  verify();
});

async function pandemoniumDeploy(f, id = core.CacheDefinitions.getLocId('sailing_intro_salvaging_hook'), ship = f.ship()) {
  const x = ship.boat.deckBaseX + 3, y = ship.boat.deckBaseY + 4;
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const frame = Buffer.alloc(8);
  frame[0] = ClientPacketId.OPLOC1;
  frame[1] = (x + 128) & 255;
  frame[2] = x >>> 8;
  frame.writeUInt16LE(y, 3);
  frame[6] = id >>> 8;
  frame[7] = (id + 128) & 255;
  const decoded = decodeClientPackets(frame);
  assert.deepEqual(decoded, [{ type: 'object_option', id, x, y, clickType: 1 }]);
  await f.connection.dispatch(decoded);
  f.connection.processTurnPackets();
  core.TaskManager.processWalkTo(f.player.getIndex());
  core.TaskManager.process();
}

test('Pandemonium native: parent Deploy reaches the canonical salvage handover exactly once', async t => {
  const f = pandemoniumShipFixture(t);
  f.player.closeInterruptibleInterfaces();
  f.player.setNeedsPlacement(false);
  await pandemoniumDeploy(f);
  assert.ok(f.player.getDialogueManager().getCurrent(), 'the real OPLOC1 producer reaches the quest transcript');
  for (let lines = 0; lines < 120 && f.quest.getStage(f.player) < 16; lines++) {
    if (MultiChatboxPrompt.getPending(f.player)) await choose(f, 1);
    else if (f.player.getDialogueManager().getCurrent()) await nextLine(f);
    core.TaskManager.process();
  }
  assert.equal(f.quest.getStage(f.player), 16, 'native Continue reaches the existing cup/overboard handover');
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP), 1);
  PM.emitCustomEvent('npc-dialogue:action', { player: f.player, npcId: core.NpcIdentifiers.WILL,
    page: 'Pandemonium', stepId: 'p40qKY', handled: false, end: false });
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP), 1, 'stale handover cannot duplicate the cup');
});

test('Pandemonium native: foreign and Modify clicks cannot salvage, and cancelling allows an owned retry', async t => {
  const f = pandemoniumShipFixture(t), stranger = pandemoniumShipFixture(t);
  for (const context of [f, stranger]) {
    context.player.closeInterruptibleInterfaces();
    context.player.setNeedsPlacement(false);
  }
  await pandemoniumDeploy(stranger, undefined, f.ship());
  assert.equal(stranger.player.getDialogueManager().getCurrent(), undefined, 'a foreign owner cannot operate this ship');
  const ship = f.ship();
  await f.connection.dispatch([{ type: 'object_option', id: core.CacheDefinitions.getLocId('sailing_intro_salvaging_hook'),
    x: ship.boat.deckBaseX + 3, y: ship.boat.deckBaseY + 4, clickType: 5 }]);
  f.connection.processTurnPackets();
  core.TaskManager.processWalkTo(f.player.getIndex());
  core.TaskManager.process();
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined, 'Modify cannot become Deploy');
  assert.equal(f.quest.getStage(f.player), 14);
  await pandemoniumDeploy(f);
  const widgetId = (f.player.getPacketSender().getChatboxGroupId() << 16) | 5;
  assert.ok(f.player.getDialogueManager().getCurrent());
  f.player.closeInterruptibleInterfaces();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId, childIndex: -1 }]);
  f.connection.processTurnPackets();
  assert.equal(f.quest.getStage(f.player), 14, 'a closed source cannot advance through a stale Continue');
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP), 0);
  f.login();
  f.player.closeInterruptibleInterfaces();
  f.player.setNeedsPlacement(false);
  await pandemoniumDeploy(f, core.ObjectIdentifiers.SALVAGING_HOOK_2);
  assert.ok(f.player.getDialogueManager().getCurrent(), 'a visible-child click retries the same owned parent after relog');
});

test('Pandemonium native: the captured helm and sails still sail to the wreck with Deploy available', async t => {
  const f = pandemoniumShipFixture(t, 10), ship = f.ship();
  for (const [x, y] of [[3054, 3193], [3054, 3120], [3051, 3110], [3048, 3070], [3032, 3050]]) {
    core.RegionManager.loadMapFiles(x, y, true);
  }
  f.player.closeInterruptibleInterfaces();
  f.player.setNeedsPlacement(false);
  const operate = async (part, clickType) => {
    const loc = ship.spec.locs.find(loc => loc.part === part);
    await f.connection.dispatch([{ type: 'object_option', id: loc.id,
      x: ship.boat.deckBaseX + loc.x, y: ship.boat.deckBaseY + loc.y, clickType }]);
    f.connection.processTurnPackets();
    for (let tick = 0; tick < 6; tick++) {
      core.TaskManager.processWalkTo(f.player.getIndex());
      f.player.getMovementQueue().beginCycle();
      f.player.getMovementQueue().process();
      core.TaskManager.process();
    }
  };
  await operate('helm', 1);
  assert.equal(ship.boat.helmPlayerId, f.player.getIndex(), 'Navigate uses the actual parent and reachable deck');
  await operate('sails', 2);
  assert.equal(ship.boat.moveMode, 2, 'Set starts the observed full-sail voyage');
  // The player, not a timed quest replay, steers along the recorded route.
  const headings = new Map([[0, 0], [25, 2], [31, 1], [61, 0]]);
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  for (let tick = 0; tick < 350 && f.quest.getStage(f.player) < 12; tick++) {
    if (headings.has(tick)) {
      const heading = headings.get(tick);
      const decoded = decodeClientPackets(Buffer.from([ClientPacketId.SET_HEADING, heading]));
      assert.deepEqual(decoded, [{ type: 'set_heading', heading }]);
      await f.connection.dispatch(decoded);
      f.connection.processTurnPackets();
      assert.equal(ship.boat.heading, heading * 128, 'the helmsman\'s native input steers the supplied boat');
    }
    core.BoatManager.tick();
  }
  assert.equal(f.quest.getStage(f.player), 12,
    `the existing route arrives with the wider hull (boat ${ship.boat.tileX},${ship.boat.tileY}, ${JSON.stringify(ship.boat.lastStep)})`);
  f.player.closeInterruptibleInterfaces();
  const will = [...core.World.getNpcs()].find(npc => npc.getOwner() === f.player && npc.getId() === 14958);
  assert.ok(will);
  await f.connection.dispatch([{ type: 'npc_option', index: will.getIndex(), clickType: 1 }]);
  f.connection.processTurnPackets();
  for (let tick = 0; tick < 6; tick++) {
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getMovementQueue().beginCycle();
    f.player.getMovementQueue().process();
    core.TaskManager.process();
  }
  assert.equal(f.quest.getStage(f.player), 14);
  assert.equal(ship.spec.locs.some(loc => loc.id === core.ObjectIdentifiers.SMALL_SHIPWRECK), false,
    'arrival does not place an unrelated wreck model on the deck');
  f.player.closeInterruptibleInterfaces();
  await pandemoniumDeploy(f);
  assert.ok(f.player.getDialogueManager().getCurrent(), 'Deploy remains usable after the ordinary voyage');
});



function sourceStartChoice(page, hook) {
  const record = require('../data/definitions/npc-dialogues.json')[page];
  function find(steps) {
    for (const step of steps) {
      if (step.options?.some(option => option.hook === hook)) return step;
      for (const nested of [step.steps ?? [], ...(step.options ?? []).map(option => option.steps ?? [])]) {
        const result = find(nested);
        if (result) return result;
      }
    }
  }
  for (const [variant, steps] of Object.entries(record.variants)) {
    const choice = find(steps);
    if (choice) return { variant, choice };
  }
  throw Error(`Missing canonical start choice ${hook}`);
}

for (const [page, key, npcKey, hook, reasons] of [
  ['Lost City', 'lost_city', 'WARRIOR', 'quest:lost-city:start', ['Crafting level of at least 31', 'Woodcutting level of at least 36']],
  ['In Search of the Myreque', 'in_search_of_the_myreque', 'VANSTROM_KLAUSE_8', 'quest:in-search-of-the-myreque:start', ['Agility level of at least 25']],
]) test(`${page} native start refusal exposes existing reasons without playing accepted dialogue`, async t => {
  const f = fixture(t), quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === key);
  const { variant, choice } = sourceStartChoice(page, hook);
  const show = () => {
    const request = { player: f.player, npcId: core.NpcIdentifiers[npcKey], variant: { page, variant }, exact: true, select: () => [choice] };
    PM.emitCustomEvent('npc-dialogue:start', request);
    assert.equal(request.handled, true);
    return request;
  };
  const refuse = async expected => {
    show(); await choose(f, choice.options.findIndex(option => option.hook === hook) + 1);
    assert.equal(quest.getStage(f.player), 0);
    assert.equal(Number(f.player.getAttribute('quest.points')) || 0, 0);
    assert.equal(f.player.getDialogueManager().getCurrent(), undefined);
    assert.equal(f.player.getPacketSender().getChatboxGroupId(), -1);
    f.player.getSession().flushPackets();
    const packets = Buffer.concat(f.packets).toString('utf8');
    for (const reason of expected) assert.ok(packets.includes(reason), reason);
  };
  await refuse(reasons);
  if (key === 'lost_city') {
    f.player.getSkillManager().setMaxLevels(core.Skill.CRAFTING, 31, false);
    await refuse(['Woodcutting level of at least 36']);
    f.player.getSkillManager().setMaxLevels(core.Skill.WOODCUTTING, 36, false);
  } else {
    f.player.getSkillManager().setMaxLevels(core.Skill.AGILITY, 25, false);
    await refuse(['You must complete Nature Spirit to start this quest.']);
    const prerequisite = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'nature_spirit');
    prerequisite.setStage(f.player, prerequisite.completionValue);
  }
  show(); await choose(f, choice.options.findIndex(option => option.hook === hook) + 1);
  assert.ok(quest.getStage(f.player) > 0, 'meeting the existing requirements starts normally');
  assert.ok(f.player.getDialogueManager().getCurrent(), 'the canonical accepted branch is still played');
});

test('a rejected owned quest-start hook preserves a replacement conversation and its next native choice', async t => {
  const f = fixture(t), page = 'Fairytale I - Growing Pains', hook = 'quest:fairytale-i-growing-pains:start';
  const { variant, choice } = sourceStartChoice(page, hook);
  const hooks = PM.customEventHooks.get('npc-dialogue:hook'), start = hooks.length;
  t.after(() => hooks.splice(start));
  let replacement, refused;
  PM.createApi('RefusalReplacementTest').onCustomEvent('npc-dialogue:hook', event => {
    if (event.player !== f.player || event.hook !== hook) return;
    refused = event.end === true;
    replacement = request(f.player, f.npc);
  });
  const old = { player: f.player, npcId: core.NpcIdentifiers.MARTIN_THE_MASTER_GARDENER, variant: { page, variant }, exact: true, select: () => [choice] };
  PM.emitCustomEvent('npc-dialogue:start', old);
  await choose(f, choice.options.findIndex(option => option.hook === hook) + 1);
  assert.equal(refused, true, 'the real prerequisite handler rejected this start');
  assert.equal(replacement.handled, true);
  assert.equal(MultiChatboxPrompt.getPending(f.player).title, 'Ask about the Christmas Event?');
  assert.equal(old.cancel(), false, 'the ended playback no longer owns the replacement');
  await choose(f, 1);
  assert.match(f.player.getDialogueManager().getCurrent().getText(), /Can't you see the huge queue/);
  assert.equal(Number(f.player.getAttribute('quest.points')) || 0, 0);
});

test('action hook end stops its tail and preserves a replacement native dialogue', t => {
  for (const replace of [false, true]) {
    const f = fixture(t), hooks = PM.customEventHooks.get('npc-dialogue:hook'), start = hooks.length;
    t.after(() => hooks.splice(start));
    PM.createApi('ActionEndTest').onCustomEvent('npc-dialogue:hook', event => {
      if (event.player !== f.player || event.hook !== 'test:refusal') return;
      event.end = true;
      if (replace) {
        const builder = new core.DialogueChainBuilder(); builder.add(new core.NpcDialogue(0, cookId, 'Replacement dialogue.'));
        f.player.getDialogueManager().startDialogues(builder);
      }
    });
    const playback = { player: f.player, npcId: cookId, variant: { page: '2025 Christmas event', variant: 'starting-the-event-talking-to-the-cook' }, exact: true,
      select: () => [{ type: 'action', hook: 'test:refusal' }, { npc: 'The refused tail must not play.' }] };
    PM.emitCustomEvent('npc-dialogue:start', playback);
    assert.equal(playback.handled, true);
    assert.equal(f.player.getDialogueManager().getCurrent()?.getText(), replace ? 'Replacement dialogue.' : undefined);
    playback.cancel();
    assert.equal(f.player.getDialogueManager().getCurrent()?.getText(), replace ? 'Replacement dialogue.' : undefined);
  }
});


test('Nature Spirit retains its canonical Drezel prerequisite refusal', async t => {
  const f = fixture(t), quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  const priest = quests.find(q => q.key === 'priest_in_peril'), nature = quests.find(q => q.key === 'nature_spirit');
  priest.setStage(f.player, priest.completionValue);
  const npcId = core.NpcIdentifiers.DREZEL, npc = core.NPC.create(npcId, new core.Location(3440, 9897));
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId, action: 'Talk-to', clickType: 1, handled: false }), true);
  const lines = [];
  for (let n = 0; n < 10 && f.player.getDialogueManager().getCurrent(); n++) {
    const current = f.player.getDialogueManager().getCurrent(); if (current.getText) lines.push(current.getText());
    await nextLine(f);
  }
  assert.ok(lines.some(line => line.startsWith("Well... I don't think so.")), 'Drezel speaks the existing canonical refusal');
  f.player.getSession().flushPackets();
  assert.ok(Buffer.concat(f.packets).includes(Buffer.from('You do not meet all of the requirements to start the Nature Spirit quest.')));
  assert.equal(nature.getStage(f.player), 0);
  assert.equal(Number(f.player.getAttribute('quest.points')) || 0, 0);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined);
});

const REJECTED_START_ROUTES = [
  { page: 'Jungle Potion', key: 'jungle_potion', npc: 'TRUFITUS', quests: ['druidic_ritual'],
    route: ['What does Bwana mean?', 'Yes, of course I do.', 'A proposition eh? Sounds interesting!', 'Me? How can I help?', 'Yes.'] },
  { page: 'Haunted Mine', key: 'haunted_mine', npc: 'ZEALOT', skills: true, quests: ['priest_in_peril'],
    route: ['I follow the path of Saradomin.', 'I come seeking challenges and quests.', 'Yes.'] },
  { page: 'Between a Rock...', key: 'between_a_rock', npc: 'DONDAKAN_THE_DWARF', skills: true, quests: ['dwarf_cannon', 'fishing_contest'],
    route: ['Why are you firing a cannon at a wall?', 'Yes.'] },
  { page: 'The Lost Tribe', key: 'the_lost_tribe', npc: 'SIGMUND_13', skills: true, quests: ['goblin_diplomacy', 'rune_mysteries'],
    route: ['Do you have any quests for me?', 'Yes.'] },
  { page: 'Meat and Greet', key: 'meat_and_greet', npc: 'EMELIO', quests: ['children_of_the_sun'], route: ['Yes.'] },
  { page: 'The Curse of Arrav', key: 'curse_of_arrav', npc: 'ELIAS_WHITE', skills: true, quests: ['defender_of_varrock', 'troll_romance'], route: ['Yes.'] },
];
const RUM_START_ROUTE = { npc: 'PIRATE_PETE', route: ['Yes!', 'Of course, I fear no demon!', 'Nonsense! Keep the money!'] };
const registeredQuest = key => require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(quest => quest.key === key);
const carriedItems = player => player.getInventory().getItems().filter(item => item.getId() >= 0).map(item => [item.getId(), item.getAmount(), item.getMeta()]);
function completePrerequisites(player, keys) {
  for (const key of keys) { const quest = registeredQuest(key); assert.ok(quest, key); quest.setStage(player, quest.completionValue); }
}
function startSkillLevels(player, maximum, current = maximum) {
  for (const skill of core.Skill.values()) player.getSkillManager().setMaxLevels(skill, maximum, false).setCurrentLevel(skill, current, false);
}
async function followNativeStartRoute(f, definition) {
  const npcId = core.NpcIdentifiers[definition.npc], npc = core.NPC.create(npcId, new core.Location(3222, 3218));
  assert.equal(PM.emitNpcInteraction({ player: f.player, npc, npcId, action: 'Talk-to', clickType: 1, handled: false }), true);
  for (const option of definition.route) {
    for (let n = 0; n < 80 && !MultiChatboxPrompt.getPending(f.player); n++) {
      assert.ok(f.player.getDialogueManager().getCurrent(), `source dialogue reaches ${option}`);
      await nextLine(f);
    }
    const menu = MultiChatboxPrompt.getPending(f.player), index = menu?.options.indexOf(option) ?? -1;
    assert.ok(index >= 0, `${option} in ${JSON.stringify(menu)}`);
    await choose(f, index + 1);
  }
}
async function assertRejectedStart(f, key, items) {
  const player = f.player;
  assert.equal(registeredQuest(key).getStage(player), 0);
  assert.equal(Number(player.getAttribute('quest.points')) || 0, 0);
  assert.deepEqual(carriedItems(player), items);
  assert.equal(player.getDialogueManager().getCurrent(), undefined, 'the accepted source tail is not played');
  assert.equal(player.getPacketSender().getChatboxGroupId(), -1, 'the existing refusal messages are uncovered');
  assert.equal(MultiChatboxPrompt.getPending(player), null);
  for (let n = 0; n < 3; n++) { await choose(f, 1); await nextLine(f); }
  assert.equal(registeredQuest(key).getStage(player), 0, 'stale native replies cannot reach later quest actions');
  assert.deepEqual(carriedItems(player), items);
}
for (const definition of REJECTED_START_ROUTES) test(`${definition.page} normal rejected-start routes stop before accepted actions and retry successfully`, async t => {
  const f = fixture(t), items = carriedItems(f.player);
  const refuse = async () => {
    const first = f.packets.length;
    await followNativeStartRoute(f, definition);
    await assertRejectedStart(f, definition.key, items);
    f.player.getSession().flushPackets();
    assert.match(Buffer.concat(f.packets.slice(first)).toString('utf8'), /You (?:must complete|need)/, 'real packets contain the existing requirement reason');
  };
  await refuse();
  startSkillLevels(f.player, 99);
  if (definition.skills) await refuse();
  completePrerequisites(f.player, definition.quests);
  await followNativeStartRoute(f, definition);
  assert.ok(registeredQuest(definition.key).getStage(f.player) > 0);
  assert.ok(f.player.getDialogueManager().getCurrent(), 'eligible acceptance still plays its source branch');
});

for (const mode of ['missing quests', 'skills only', 'drained skills']) test(`Rum Deal normal choice rejects ${mode} without knockout, items or quest points`, async t => {
  const f = fixture(t), items = carriedItems(f.player), location = f.player.getLocation().clone();
  if (mode === 'missing quests') startSkillLevels(f.player, 99);
  else { completePrerequisites(f.player, ['zogre_flesh_eaters', 'priest_in_peril']); if (mode === 'drained skills') startSkillLevels(f.player, 99, 1); }
  await followNativeStartRoute(f, RUM_START_ROUTE);
  await assertRejectedStart(f, 'rum_deal', items);
  assert.ok(f.player.getLocation().equals(location), 'a rejected choice cannot enter the knockout sequence');
  f.player.getSession().flushPackets();
  const packets = Buffer.concat(f.packets).toString('utf8');
  if (mode === 'missing quests') assert.ok(packets.includes('You must complete Zogre Flesh Eaters to start this quest.'));
  else for (const [required, skill] of [[40, 'Farming'], [50, 'Fishing'], [47, 'Prayer'], [42, 'Crafting'], [42, 'Slayer']]) {
    assert.ok(packets.includes(`You need ${required} ${skill} to start this quest.`), `${skill} refusal is explicit`);
  }
  // Rum's existing predicate reads current levels: boosting passes, draining fails.
  startSkillLevels(f.player, mode === 'drained skills' ? 1 : 99, 99);
  completePrerequisites(f.player, ['zogre_flesh_eaters', 'priest_in_peril']);
  await followNativeStartRoute(f, RUM_START_ROUTE);
  assert.equal(registeredQuest('rum_deal').getStage(f.player), 1);
  for (let n = 0; n < 8 && registeredQuest('rum_deal').getStage(f.player) < 2; n++) await nextLine(f);
  assert.equal(registeredQuest('rum_deal').getStage(f.player), 2, 'an eligible acceptance retains the canonical knockout');
});

test('Rum Deal alternate source hook refuses without playing its accepted tail', async t => {
  const f = fixture(t), items = carriedItems(f.player), hook = 'quest:rum-deal:start';
  const { variant, choice } = sourceStartChoice('Pirate Pete', hook);
  const event = { player: f.player, npcId: core.NpcIdentifiers.PIRATE_PETE, variant: { page: 'Pirate Pete', variant }, exact: true, select: () => [choice] };
  PM.emitCustomEvent('npc-dialogue:start', event); assert.equal(event.handled, true);
  await choose(f, choice.options.findIndex(option => option.hook === hook) + 1);
  await assertRejectedStart(f, 'rum_deal', items);
});

test('a refused choice preserves replacement UI opened by its owning handler', async t => {
  const f = fixture(t), hooks = PM.customEventHooks.get('npc-dialogue:choice'), start = hooks.length;
  t.after(() => hooks.splice(start));
  let replacement, refused;
  PM.createApi('RefusedChoiceReplacement').onCustomEvent('npc-dialogue:choice', event => {
    if (event.player !== f.player || event.option !== 'Nonsense! Keep the money!') return;
    refused = event.end === true;
    replacement = request(f.player, f.npc);
  });
  await followNativeStartRoute(f, RUM_START_ROUTE);
  assert.equal(refused, true, 'Rum has already rejected this choice');
  assert.equal(replacement.handled, true);
  assert.equal(registeredQuest('rum_deal').getStage(f.player), 0);
  assert.equal(MultiChatboxPrompt.getPending(f.player).title, 'Ask about the Christmas Event?');
  await choose(f, 1);
  assert.match(f.player.getDialogueManager().getCurrent().getText(), /Can't you see the huge queue/);
});

for (const withSigil of [false, true]) {
  test(`Shadow Golem reprogram dialogue speaks once through native Continue (sigil=${withSigil})`, async t => {
    const f = fixture(t), { player } = f;
    t.after(() => {
      for (const npc of [...core.World.getNpcs()]) {
        if (npc.getOwner?.() === player) PM.removeNpc(npc);
      }
    });
    const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
    const quest = quests.find(entry => entry.key === 'shadow_of_the_storm');
    const golem = quests.find(entry => entry.key === 'the_golem');
    golem.setStage(player, golem.completionValue);
    quest.setStage(player, 90);
    player.setAttribute('quest.shadow_of_the_storm.helpers', 1 << 4);
    const sigil = core.ItemIdentifiers.DEMONIC_SIGIL;
    if (withSigil) player.getInventory().add(new core.Item(sigil));
    const npcId = core.NpcIdentifiers.CLAY_GOLEM_3;
    const npc = core.NPC.create(npcId, new core.Location(3478, 3089));
    const talk = () => PM.emitNpcInteraction({ player, npc, npcId, action: 'Talk-to', clickType: 1, handled: false });
    assert.equal(talk(), true);
    const lines = [];
    for (let guard = 0; guard < 30 && player.getDialogueManager().getCurrent(); guard++) {
      lines.push(player.getDialogueManager().getCurrent().getText().replace(/\s+/g, ' ').trim());
      await nextLine(f);
    }
    assert.equal(player.getDialogueManager().getCurrent(), undefined, 'the canonical exchange ends');
    assert.equal(lines.length, withSigil ? 7 : 8, 'one exchange and only the matching sigil branch');
    assert.equal(new Set(lines).size, lines.length, 'no spoken line repeats');
    assert.match(lines[0], /^I sensed a great darkness/);
    assert.match(lines.at(-1), withSigil ? /Take this demonic sigil/ : /I will wait/);
    assert.equal(quest.getStage(player), withSigil ? 100 : 90, 'the existing sigil handoff advances recruitment once');
    assert.equal(player.getInventory().getAmount(sigil), 0, 'only the existing sigil handoff consumes the offered item');
    assert.equal(talk(), true, 'the next canonical conversation remains reachable after closing');
    player.closeInterruptibleInterfaces();
    await nextLine(f);
    assert.equal(player.getDialogueManager().getCurrent(), undefined, 'stale Continue cannot resume a cancelled exchange');
  });
}

// #2289: exercise the registered NPC route and native continuation packets; no
// synthetic transcript or direct condition/variant hooks stand in for playback.
function jorralFixture(t, eligible = true) {
  const f = fixture(t);
  const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  const quest = key => {
    const entry = quests.find(entry => entry.key === key);
    assert.ok(entry, `registered quest ${key}`);
    return entry;
  };
  f.quest = quest('making_history');
  if (eligible) {
    quest('the_restless_ghost').setStage(f.player, quest('the_restless_ghost').startedValue);
    quest('priest_in_peril').setStage(f.player, quest('priest_in_peril').completionValue);
  }
  f.player.setLocation(new core.Location(2437, 3346));
  core.RegionManager.loadMapFiles(2437, 3347);
  f.npc = core.NPC.create(core.NpcIdentifiers.JORRAL, new core.Location(2437, 3347));
  core.World.getNpcs().add(f.npc);
  f.npc.setRegistered(true);
  t.after(() => { f.npc.setRegistered(false); core.World.getNpcs().remove(f.npc); });
  f.trace = [];
  f.talk = () => hansOp(f, 'Talk-to');
  f.menu = () => MultiChatboxPrompt.getPending(f.player);
  f.select = async text => {
    const menu = f.menu();
    assert.ok(menu?.options.includes(text), `expected ${text}: ${JSON.stringify(menu)}; trace=${JSON.stringify(f.trace)}`);
    await choose(f, menu.options.indexOf(text) + 1);
  };
  f.advance = async () => {
    const current = f.player.getDialogueManager().getCurrent();
    const text = current?.getText?.();
    if (text) f.trace.push(text.replace(/\s+/g, ' '));
    await nextLine(f);
  };
  f.untilMenu = async () => {
    for (let n = 0; n < 60 && !f.menu(); n++) {
      assert.ok(f.player.getDialogueManager().getCurrent(), `conversation closed before menu: ${JSON.stringify(f.trace)}`);
      await f.advance();
    }
    assert.ok(f.menu(), `no menu within 60 continuations: ${JSON.stringify(f.trace)}`);
  };
  return f;
}

for (const contact of ['A trader in Ardougne', 'A ghost in Port Phasmatys', 'A warrior in Rellekka']) {
  test(`Jorral task explanation reaches its follow-up menu and ends after ${contact}`, async t => {
    const f = jorralFixture(t);
    await f.talk();
    await f.untilMenu();
    assert.equal(f.quest.getStage(f.player), 0, 'hearing the introduction does not start the quest');
    await f.select('Tell me more.');
    await f.untilMenu();
    assert.equal(f.menu().title, 'Start the Making History quest?');
    await f.select('Yes.');
    assert.equal(f.quest.getStage(f.player), f.quest.startedValue, 'the actual acceptance hook starts the quest');
    await f.untilMenu();
    await f.select(contact);
    await f.untilMenu();
    assert.deepEqual(f.menu().options, ["What's the story so far?", 'What do I need to do now?', 'Got to go, bye!'],
      `contact explanation must reach its continuation: ${JSON.stringify(f.trace)}`);
    await f.select('Got to go, bye!');
    for (let n = 0; n < 5 && f.player.getDialogueManager().getCurrent(); n++) await f.advance();
    assert.equal(f.menu(), null, 'goodbye leaves no pending menu');
    assert.equal(f.player.getDialogueManager().isActive(), false, 'goodbye ends playback');
    assert.equal(f.quest.getStage(f.player), f.quest.startedValue, 'ending the conversation preserves progress');
  });
}

test('Jorral missing prerequisites refuses once and native close leaves a fresh start available', async t => {
  const f = jorralFixture(t, false);
  await f.talk();
  for (let n = 0; n < 10 && f.player.getDialogueManager().getCurrent(); n++) await f.advance();
  assert.equal(f.menu(), null);
  assert.equal(f.player.getDialogueManager().isActive(), false, `refusal must end: ${JSON.stringify(f.trace)}`);
  assert.equal(f.trace.filter(text => text === "Don't bother, you're not experienced enough to help me!").length, 1);
  assert.equal(f.quest.getStage(f.player), 0);
  await f.talk();
  await f.connection.dispatch([{ type: 'interface_close' }]);
  f.connection.processTurnPackets();
  assert.equal(f.menu(), null);
  assert.equal(f.quest.getStage(f.player), 0, 'closing cannot start the quest');
  await f.talk();
  assert.ok(f.player.getDialogueManager().getCurrent(), 'normal talk can restart after closing');
});

test('Jorral native close and declining the start offer preserve the normal introduction', async t => {
  const f = jorralFixture(t);
  await f.talk();
  await f.untilMenu();
  await f.connection.dispatch([{ type: 'interface_close' }]);
  f.connection.processTurnPackets();
  assert.equal(f.menu(), null);
  assert.equal(f.quest.getStage(f.player), 0);
  await f.talk();
  await f.untilMenu();
  await f.select('Tell me more.');
  await f.untilMenu();
  await f.select('No.');
  for (let n = 0; n < 10 && f.player.getDialogueManager().isActive(); n++) await f.advance();
  assert.equal(f.menu(), null);
  assert.equal(f.player.getDialogueManager().isActive(), false, `declining must end: ${JSON.stringify(f.trace)}`);
  assert.equal(f.quest.getStage(f.player), 0);
  await f.talk();
  await f.untilMenu();
  assert.ok(f.menu().options.includes('Tell me more.'), 'declining retains the normal quest introduction');
});

function pandemoniumCinematicFixture(t, save, stage = 14) {
  const f = pandemoniumShipFixture(t, stage, save);
  f.frames = []; f.poses = [];
  const send = f.player.getSession().sendClientPacket;
  t.mock.method(f.player.getSession(), 'sendClientPacket', function(packet) {
    f.frames.push(packet); return send.call(this, packet);
  });
  const playerAnimation = f.player.performAnimation;
  t.mock.method(f.player, 'performAnimation', function(animation) {
    const result = playerAnimation.call(this, animation);
    if (this.getAnimation() === animation) f.poses.push({ id: animation.getId(), tick: core.World.processCycle,
      actor: 'player', x: this.getLocation().getX(), y: this.getLocation().getY(), z: this.getLocation().getZ() });
    return result;
  });
  const spawn = PM.spawnNpc;
  t.mock.method(PM, 'spawnNpc', function(definition, ...args) {
    const npc = spawn.call(this, definition, ...args);
    if (npc && definition.owner === f.player && [14961,14966].includes(npc.getId())) {
      const animate = npc.performAnimation;
      t.mock.method(npc, 'performAnimation', function(animation) {
        const result = animate.call(this, animation);
        if (this.getAnimation() === animation) f.poses.push({ id: animation.getId(), tick: core.World.processCycle, actor: npc.getId() });
        return result;
      });
    }
    return npc;
  });
  const cycle = core.World.processCycle;
  f.owned = () => [...core.World.getNpcs()].filter(npc => npc.getOwner?.() === f.player);
  f.tick = (count = 1) => {
    for (let n = 0; n < count; n++) {
      ++core.World.processCycle;
      f.player.getArea()?.process(f.player);
      core.TaskManager.processWalkTo(f.player.getIndex());
      for (const npc of f.owned()) npc.getMovementQueue().process();
      f.player.getMovementQueue().process(); core.TaskManager.process();
      core.World.updateLocalPlayers(f.player);
      core.World.updateLocalNpcs(f.player, f.owned());
      f.player.getSession().flush(core.World.getProcessCycle());
      for (const npc of f.owned()) npc.resetUpdating();
      f.player.resetUpdating();
    }
  };
  f.advance = async () => {
    const current = f.player.getDialogueManager().getCurrent();
    if (MultiChatboxPrompt.getPending(f.player)) await choose(f, 1);
    else if (current?.getText?.()) {
      const group = f.player.getPacketSender().getChatboxGroupId();
      await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | (group === 11 ? 4 : 5), childIndex: -1 }]);
      f.connection.processTurnPackets();
    }
    f.tick();
  };
  f.finish = async () => {
    for (let n = 0; n < 180 && f.quest.getStage(f.player) === 14; n++) await f.advance();
    assert.equal(f.quest.getStage(f.player), 16, 'only the owned shore finish commits sixteen');
  };
  t.after(() => { core.World.processCycle = cycle; });
  f.tick(3); // The native voyage map/placement reaches the client before its first object input.
  return f;
}

test('Pandemonium native Deploy uses the actual copied salvage and shore scenes before committing sixteen', async t => {
  const f = pandemoniumCinematicFixture(t), { player } = f;
  const points = player.getAttribute('quest.points');
  await pandemoniumDeploy(f); f.tick(3);
  const area = player.getPrivateArea();
  assert.ok(area instanceof core.TemplatedInstanceArea, 'Deploy uses its copied cinematic map, not the voyage entity');
  assert.deepEqual(area.getChunk(1,3,4), { sourceChunkX: 187, sourceChunkY: 564, sourcePlane: 1, rotation: 0 });
  assert.deepEqual([player.getLocation().getX()-area.getBaseX(), player.getLocation().getY()-area.getBaseY(), player.getLocation().getZ()], [26,32,1]);
  const protocol = require('../dist/net/protocol/ClientProtocol');
  const rates = { rate:232, rate2:100, heightRelative:false };
  const has = packet => f.frames.some(frame => frame.equals(packet));
  assert.ok(has(protocol.encodeCameraMoveTo(area.getBaseX()+18,area.getBaseY()+29,550,rates)));
  assert.ok(has(protocol.encodeCameraLookAt(area.getBaseX()+38,area.getBaseY()+34,350,rates)));
  assert.ok(has(area.encodeScene((player.getLocation().getX()>>3),(player.getLocation().getY()>>3))), 'real PlayerSession sends its native instance palette');
  const actors = f.owned().filter(npc => [14961,14966].includes(npc.getId()));
  assert.deepEqual(actors.map(npc=>npc.getId()).sort(), [14961,14966]);
  assert.ok(f.frames.some(frame=>frame[0]===21 && frame.length>12), 'native NPC_INFO includes the cinematic cast');
  const outsider = fixture(t).player; outsider.setLocation(player.getLocation().clone());
  core.World.updateLocalNpcs(outsider, actors);
  assert.equal(outsider.getLocalNpcs().length,0,'other players cannot see the private cast');
  await f.advance(); f.tick(5);
  assert.equal(player.getPacketSender().getChatboxGroupId(),11);
  assert.deepEqual(player.getDialogueManager().getCurrent().getItemIds(), [31337,31338]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),1);
  assert.equal(f.quest.getStage(player),14,'the item popup cannot commit the unfinished shore sequence');
  assert.equal(f.poses.at(-1).id,core.Animation.DEFAULT_RESET_ANIMATION.getId(),'the captured hook-reset loop stops at the item popup');
  for(let n=0;n<100&&!f.poses.some(pose=>pose.id===10044);n++)await f.advance();
  assert.ok(f.poses.some(pose=>pose.id===10044));
  assert.deepEqual(area.getChunk(0,3,6),{sourceChunkX:379,sourceChunkY:374,sourcePlane:0,rotation:0});
  assert.ok(has(area.encodeScene(player.getLocation().getX()>>3,player.getLocation().getY()>>3)),'the shore camera has its actual rebuilt native source context');
  await f.finish();
  for (const id of [13576,13578,13083,13084,10044,8328]) assert.ok(f.poses.some(pose=>pose.id===id),`captured active sequence ${id}`);
  const pushed = f.poses.find(pose=>pose.id===13083), anne = f.poses.find(pose=>pose.id===13084);
  assert.equal(pushed.tick,anne.tick);
  assert.deepEqual([pushed.x-area.getBaseX(),pushed.y-area.getBaseY(),pushed.z],[26,31,1]);
  assert.ok(has(protocol.encodeCameraMoveTo(area.getBaseX()+18,area.getBaseY()+56,550,rates)));
  assert.ok(has(protocol.encodeCameraLookAt(area.getBaseX()+28,area.getBaseY()+49,350,rates)));
  assert.equal(area.isDestroyed(),true);
  assert.equal(player.getPrivateArea(),null);
  assert.deepEqual([player.getLocation().getX(),player.getLocation().getY(),player.getLocation().getZ()],[3049,2970,0]);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),1);
  assert.equal(player.getAttribute('quest.points'),points);
  assert.equal(player.getMovementQueue().isMovementBlocked(),false);
  assert.equal(player.isUntargetable(),false);
  assert.ok(!f.owned().some(npc=>[14961,14966].includes(npc.getId())));
});

test('Pandemonium native scene cancellation preserves a replacement prompt and permits an item-safe retry', async t => {
  const f = pandemoniumCinematicFixture(t);
  await pandemoniumDeploy(f); f.tick(3);
  const old = f.player.getPrivateArea();
  await f.advance(); f.tick(5);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),1);
  PM.createApi('PandemoniumReplacement').sendMultiChatboxPrompt(f.player,'Keep this choice','Yes',()=>{},'No',()=>{});
  const replacement = f.player.getDialogueManager().getCurrent();
  f.tick(3);
  assert.equal(old.isDestroyed(),true);
  assert.equal(f.quest.getStage(f.player),14);
  assert.equal(f.player.getDialogueManager().getCurrent(),replacement);
  assert.equal(MultiChatboxPrompt.getPending(f.player).title,'Keep this choice');
  assert.ok(f.ship(),'the owner can retry from their actual tutorial ship');
  f.player.closeInterruptibleInterfaces();
  await pandemoniumDeploy(f); f.tick(3); await f.finish();
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),1);
});

test('Pandemonium native full bag refuses new salvage but permits a carried-cup retry and saved fourteen', async t => {
  const f = pandemoniumCinematicFixture(t);
  for(let n=0;n<28;n++)f.player.getInventory().addItem(new core.Item(core.ItemIdentifiers.BONES,1));
  await pandemoniumDeploy(f); f.tick(4);
  assert.equal(f.quest.getStage(f.player),14);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),0);
  assert.ok(f.ship());
  f.player.getInventory().deleteNumber(core.ItemIdentifiers.BONES,1);
  await pandemoniumDeploy(f); f.tick(3); await f.advance(); f.tick(5);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),1);
  assert.equal(f.player.getInventory().getFreeSlots(),0);
  const { PlayerSave }=require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const save=PlayerSave.fromPlayer(f.player);
  PM.emitPlayerLogout({player:f.player,username:f.player.getUsername()});
  const restored=pandemoniumCinematicFixture(t,save);
  assert.equal(restored.quest.getStage(restored.player),14);
  assert.equal(restored.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),1);
  await pandemoniumDeploy(restored); restored.tick(3); await restored.finish();
  assert.equal(restored.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP),1);
});

test('Pandemonium native Close clears the flushed looping shore pose', async t => {
  const f=pandemoniumCinematicFixture(t);
  await pandemoniumDeploy(f);f.tick(3);
  for(let n=0;n<100&&!f.poses.some(pose=>pose.id===10044);n++)await f.advance();
  assert.ok(f.poses.some(pose=>pose.id===10044));
  assert.equal(f.player.getAnimation(),null,'the real update flush has consumed its animation mask');
  const start=f.poses.length;
  await f.connection.dispatch([{type:'interface_close'}]);f.connection.processTurnPackets();f.tick();
  assert.equal(f.quest.getStage(f.player),14);
  assert.ok(f.poses.slice(start).some(pose=>pose.id===core.Animation.DEFAULT_RESET_ANIMATION.getId()),'leaving cannot retain the captured looping floor pose');
});

test('Pandemonium cancellation preserves a later pose that was already sent with replacement UI', async t => {
  const f=pandemoniumCinematicFixture(t);
  await pandemoniumDeploy(f);f.tick(3);
  for(let n=0;n<100&&!f.poses.some(pose=>pose.id===10044);n++)await f.advance();
  assert.ok(f.poses.some(pose=>pose.id===10044));
  PM.createApi('PandemoniumLaterPose').sendMultiChatboxPrompt(f.player,'Later pose','Yes',()=>{},'No',()=>{});
  f.player.performAnimation(new core.Animation(829)); // The existing food animation, from a later feature callback.
  f.player.getSession().flush(core.World.getProcessCycle());f.player.resetUpdating();
  const start=f.poses.length;f.tick();
  assert.equal(f.quest.getStage(f.player),14);
  assert.equal(MultiChatboxPrompt.getPending(f.player).title,'Later pose');
  assert.ok(!f.poses.slice(start).some(pose=>pose.id===core.Animation.DEFAULT_RESET_ANIMATION.getId()),'the earlier scene cannot reset a later flushed pose');
});

test('Pandemonium closing the final shore fade cancels its saved stage commit and stale Continue', async t => {
  const f = pandemoniumCinematicFixture(t);
  await pandemoniumDeploy(f); f.tick(3);
  for (let n = 0; n < 150 && !f.player.getDialogueManager().getCurrent()?.getText?.().includes('Where am I'); n++) await f.advance();
  assert.match(f.player.getDialogueManager().getCurrent()?.getText?.(), /Where am I/);
  await f.advance();
  const area = f.player.getPrivateArea();
  assert.ok(area instanceof core.TemplatedInstanceArea);
  assert.equal(f.quest.getStage(f.player), 14);
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (217 << 16) | 5, childIndex: -1 }]);
  f.connection.processTurnPackets(); f.tick(15);
  assert.equal(area.isDestroyed(), true);
  assert.equal(f.quest.getStage(f.player), 14, 'the cancelled finish cannot commit after its timer expires');
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP), 1);
  assert.ok(f.ship());
  await pandemoniumDeploy(f); f.tick(3); await f.finish();
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP), 1);
});

test('Pandemonium scene death cleanup preserves the death pose and movement protection', async t => {
  const f = pandemoniumCinematicFixture(t);
  await pandemoniumDeploy(f); f.tick(3);
  const area = f.player.getPrivateArea();
  f.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 0, false);
  f.player.isDying = true;
  f.player.performAnimation(new core.Animation(836)); // The existing PlayerDeathTask pose.
  const generation = f.player.getAnimationGeneration();
  f.tick(20); // The real area process observes a dying owner before the later respawn hooks.
  assert.equal(area.isDestroyed(), true);
  assert.equal(f.quest.getStage(f.player), 14);
  assert.equal(f.player.getAnimationGeneration(), generation, 'cleanup cannot reset the death task animation');
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
  assert.equal(f.player.isUntargetable(), true);
  assert.equal(f.ship(), undefined, 'a dying player is not placed on a replacement tutorial ship');
});

test('Pandemonium saved shore completion and older later progress never restart the salvage scene', async t => {
  const f = pandemoniumCinematicFixture(t);
  await pandemoniumDeploy(f); f.tick(3); await f.finish();
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const { JsonPlayerPersistence } = require('../plugins/persistence/JsonPlayerPersistence.plugin');
  const codec = new JsonPlayerPersistence();
  const roundTrip = player => codec.hydratePlayerSave(JSON.parse(
    JSON.stringify(PlayerSave.fromPlayer(player), codec.replacer.bind(codec)), codec.reviver.bind(codec)));
  const finished = pandemoniumShipFixture(t, 16, roundTrip(f.player));
  assert.equal(finished.quest.getStage(finished.player), 16);
  assert.equal(finished.ship(), undefined);
  assert.equal(finished.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP), 1);
  assert.deepEqual([finished.player.getLocation().getX(), finished.player.getLocation().getY()], [3049,2970]);
  for (const stage of [16,18,20,28,34,46,50]) {
    const original = pandemoniumShipFixture(t, stage);
    original.player.getInventory().addItem(new core.Item(core.ItemIdentifiers.OLD_CUP, 1));
    const saved = roundTrip(original.player), restored = pandemoniumShipFixture(t, stage, saved);
    assert.equal(restored.quest.getStage(restored.player), stage, `existing version-two ${stage} progress is retained`);
    assert.equal(restored.ship(), undefined);
    assert.equal(restored.player.getInventory().getAmount(core.ItemIdentifiers.OLD_CUP), 1);
  }
  const old = pandemoniumShipFixture(t, 16);
  old.player.setAttribute('pandemonium:stage-version', 0);
  const legacy = pandemoniumShipFixture(t, 16, roundTrip(old.player));
  assert.equal(legacy.quest.getStage(legacy.player), 46, 'the pre-existing invented-ladder migration remains intact');
  assert.equal(legacy.ship(), undefined);
});

test('Pandemonium native Will conversation returns to Port Sarim and permits boarding again', async t => {
  const f = pandemoniumShipFixture(t, 10);
  f.player.closeInterruptibleInterfaces(); f.player.setNeedsPlacement(false);
  const talk = async npc => {
    await f.connection.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: 1 }]);
    f.connection.processTurnPackets();
    for (let n = 0; n < 6; n++) {
      core.TaskManager.processWalkTo(f.player.getIndex());
      f.player.getMovementQueue().beginCycle(); f.player.getMovementQueue().process(); core.TaskManager.process();
    }
  };
  const will = [...core.World.getNpcs()].find(npc => npc.getOwner() === f.player && npc.getId() === 14958);
  assert.ok(will); await talk(will);
  for (let n = 0; n < 30 && !MultiChatboxPrompt.getPending(f.player); n++) await nextLine(f);
  const option = MultiChatboxPrompt.getPending(f.player)?.options.indexOf('Actually, I want to go back to Port Sarim.') ?? -1;
  assert.ok(option >= 0); await choose(f, option + 1);
  for (let n = 0; n < 15 && f.player.getDialogueManager().getCurrent(); n++) await nextLine(f);
  for (let n = 0; n < 16; n++) core.TaskManager.process();
  assert.equal(f.ship(), undefined);
  assert.equal(f.quest.getStage(f.player), 10);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [3025,3209]);
  const dockWill = PM.spawnNpc({ id: core.NpcIdentifiers.WILL, x: 3025, y: 3209, wanderRadius: 0 });
  t.after(() => PM.removeNpc(dockWill));
  f.player.setNeedsPlacement(false);
  await talk(dockWill);
  for (let n = 0; n < 15 && !MultiChatboxPrompt.getPending(f.player); n++) await nextLine(f);
  const okay = MultiChatboxPrompt.getPending(f.player)?.options.indexOf('Okay.') ?? -1;
  assert.ok(okay >= 0); await choose(f, okay + 1);
  for (let n = 0; n < 15 && !f.ship(); n++) await nextLine(f);
  assert.ok(f.ship(), 'the canonical return choice permits reboarding the owner-only tutorial');
  assert.equal(f.quest.getStage(f.player), 10);
});

function pandemoniumBoardingFixture(t, stage = 0, save) {
  const f = pandemoniumCinematicFixture(t, save, stage);
  f.npcClicks = 0;
  f.talk = async npc => {
    ++f.npcClicks;
    await f.connection.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: 1 }]);
    f.connection.processTurnPackets(); f.tick(6);
  };
  if (!save && stage === 0) {
    f.player.moveTo(new core.Location(3025, 3209));
    f.dockWill = PM.spawnNpc({ id: core.NpcIdentifiers.WILL, x: 3025, y: 3208, wanderRadius: 0 });
    t.after(() => PM.removeNpc(f.dockWill));
    f.tick(3);
  }
  f.board = async (settle = 4) => {
    assert.equal(f.quest.getStage(f.player), 0, 'the interview starts from an actual fresh quest');
    await f.talk(f.dockWill);
    for (let n = 0; n < 100 && !f.ship(); n++) {
      const menu = MultiChatboxPrompt.getPending(f.player);
      if (menu) {
        const index = menu.options.findIndex(option => option === 'Yes.' || option === "I guess I'm ready...");
        assert.ok(index >= 0, JSON.stringify(menu)); await choose(f, index + 1); f.tick();
      } else await f.advance();
    }
    assert.ok(f.ship(), 'the actual interview action boards the owned tutorial ship');
    f.tick(settle);
  };
  f.operate = async part => {
    const ship = f.ship(), loc = ship.spec.locs.find(entry => entry.part === part);
    const actions = core.ObjectDefinition.forPlayer(loc.id, f.player).getActions();
    const clickType = actions.indexOf(part === 'helm' ? 'Navigate' : 'Set') + 1;
    assert.ok(clickType > 0);
    await f.connection.dispatch([{ type: 'object_option', id: loc.id,
      x: ship.boat.deckBaseX + loc.x, y: ship.boat.deckBaseY + loc.y, clickType }]);
    f.connection.processTurnPackets(); f.tick(8);
    return ship;
  };
  f.assertFreeShipCamera = () => {
    const protocol = require('../dist/net/protocol/ClientProtocol'), boat = f.ship().boat;
    const opcode = protocol.encodeCameraReset()[0];
    assert.equal(require('../dist/net/protocol/ServerPackets').SERVER_PACKET_LENGTHS[opcode], -1);
    const cameras = f.frames.filter(frame => frame[0] === opcode);
    assert.ok(cameras.every(frame => frame[1] === frame.length - 2));
    // All legacy, captured-rate and timed move/look variants in the actual client decoder.
    assert.ok(!cameras.some(frame => [1,2,4,5,8,9].includes(frame[2])), 'boarding sends no fixed camera position or look command');
    const target = protocol.encodeCameraTarget({ worldEntity: boat.entityIndex });
    assert.ok(f.frames.some(frame => frame.equals(target)), 'the real camera follows its sailing entity');
  };
  return f;
}

test('Pandemonium fresh native interview keeps the initial ship camera free', async t => {
  const f = pandemoniumBoardingFixture(t);
  await f.board(); f.assertFreeShipCamera();
});

test('Pandemonium fresh native boarding automatically plays both crew and the helm advances eight to ten', async t => {
  const f = pandemoniumBoardingFixture(t);
  await f.board();
  assert.equal(f.player.getDialogueManager().getCurrent()?.getText?.(), 'Lovely! The open sea!', 'boarding starts the canonical dialogue without another NPC click');
  assert.equal(f.quest.getStage(f.player), 6);
  const lines = [];
  for (let n = 0; n < 40 && f.player.getDialogueManager().isActive(); n++) {
    const current = f.player.getDialogueManager().getCurrent();
    if (current?.getText) lines.push({ text: current.getText().replace(/<br>/g, ' ').replace(/\s+/g, ' '), stage: f.quest.getStage(f.player) });
    await f.advance();
  }
  assert.ok(lines.some(line => line.text.includes("You're our new helm!")));
  assert.ok(lines.some(line => line.text.includes('Take the helm when ready.') && line.stage === 8), JSON.stringify(lines));
  assert.equal(f.npcClicks, 1, 'only the original dock interaction is needed');
  assert.equal(f.quest.getStage(f.player), 8);
  const will = f.owned().find(npc => npc.getId() === 14958);
  assert.equal(will.getInteractingMobile(), f.player, 'automatic Will uses the captured initial facing target');
  const ship = await f.operate('helm');
  assert.equal(f.quest.getStage(f.player), 10, 'the actual first helm interaction earns ten');
  assert.equal(ship.boat.helmPlayerId, f.player.getIndex());
  assert.equal(will.getInteractingMobile() === null, true, 'taking the helm releases the captured initial Will target');
  await f.operate('sails'); assert.equal(ship.boat.moveMode, 2);
});

test('Pandemonium native stage-eight checkpoint can take the helm without another acceptance menu', async t => {
  const f = pandemoniumBoardingFixture(t, 8);
  const will = f.owned().find(npc => npc.getId() === 14958), newerTarget = fixture(t).player;
  will.setMobileInteraction(newerTarget);
  const ship = await f.operate('helm');
  assert.equal(f.quest.getStage(f.player), 10);
  assert.equal(ship.boat.helmPlayerId, f.player.getIndex());
  assert.equal(will.getInteractingMobile() === newerTarget, true, 'taking the helm cannot clear a different newer NPC target');
});

test('Pandemonium native saved-ten helm and sails remain usable with a free ship camera', async t => {
  const f = pandemoniumBoardingFixture(t, 10);
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const saved = PlayerSave.fromPlayer(f.player);
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  const resumed = pandemoniumBoardingFixture(t, 10, saved);
  const ship = await resumed.operate('helm');
  assert.equal(resumed.quest.getStage(resumed.player), 10);
  assert.equal(ship.boat.helmPlayerId, resumed.player.getIndex(), 'the screenshot stage-ten resume path can take its actual helm');
  await resumed.operate('sails'); assert.equal(ship.boat.moveMode, 2);
  resumed.assertFreeShipCamera();
});

test('Pandemonium pending automatic boarding preserves replacement UI and recovers through native Talk-to', async t => {
  const f = pandemoniumBoardingFixture(t);
  await f.board(0);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined, 'replacement arrives before the deferred automatic source');
  PM.createApi('BoardingReplacement').sendMultiChatboxPrompt(f.player, 'Keep this new choice', 'Yes', () => {}, 'No', () => {});
  const replacement = f.player.getDialogueManager().getCurrent();
  f.tick(4);
  assert.equal(f.player.getDialogueManager().getCurrent(), replacement);
  assert.equal(MultiChatboxPrompt.getPending(f.player).title, 'Keep this new choice');
  assert.equal(f.quest.getStage(f.player), 6);
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets();
  const will = f.owned().find(npc => npc.getId() === 14958);
  await f.talk(will);
  assert.equal(f.player.getDialogueManager().getCurrent()?.getText?.(), 'Lovely! The open sea!');
  assert.equal(f.quest.getStage(f.player), 6, 'retalk does not skip the unspoken instructions');
  for (let n = 0; n < 40 && f.player.getDialogueManager().isActive(); n++) await f.advance();
  assert.equal(f.quest.getStage(f.player), 8);
  const ship = await f.operate('helm'); assert.equal(ship.boat.helmPlayerId, f.player.getIndex());
});

test('Pandemonium pending boarding is retired on logout and a saved-six retry retains its own instructions', async t => {
  const f = pandemoniumBoardingFixture(t);
  await f.board(0);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined, 'logout retires the pending automatic source');
  const old = f.ship().boat;
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const save = PlayerSave.fromPlayer(f.player);
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  f.tick(5);
  assert.equal(core.BoatManager.getBoat(old.entityIndex), undefined);
  assert.equal(f.player.getDialogueManager().getCurrent(), undefined, 'retired callbacks cannot start the old ship dialogue');
  const restored = pandemoniumBoardingFixture(t, 6, save);
  assert.equal(restored.quest.getStage(restored.player), 6);
  const will = restored.owned().find(npc => npc.getId() === 14958);
  await restored.talk(will);
  assert.equal(restored.quest.getStage(restored.player), 6);
  for (let n = 0; n < 40 && restored.player.getDialogueManager().isActive(); n++) await restored.advance();
  assert.equal(restored.quest.getStage(restored.player), 8);
  restored.assertFreeShipCamera();
});

test('Pandemonium stage-eight acknowledgement and stale menu cannot replace the actual helm checkpoint', async t => {
  const f = pandemoniumBoardingFixture(t, 8), will = f.owned().find(npc => npc.getId() === 14958);
  await f.talk(will);
  for (let n = 0; n < 12 && !MultiChatboxPrompt.getPending(f.player); n++) await f.advance();
  const index = MultiChatboxPrompt.getPending(f.player)?.options.indexOf("Okay, I'll get to it.") ?? -1;
  assert.ok(index >= 0); await choose(f, index + 1);
  assert.equal(f.quest.getStage(f.player), 8, 'acknowledging the route is not taking the helm');
  await f.connection.dispatch([{ type: 'interface_close' }]); f.connection.processTurnPackets();
  await choose(f, index + 1); f.tick();
  assert.equal(f.quest.getStage(f.player), 8);
  const ship = await f.operate('helm');
  assert.equal(f.quest.getStage(f.player), 10);
  assert.equal(ship.boat.helmPlayerId, f.player.getIndex());
});


for (const droppedName of ['SECATEURS', 'WHITE_BERRIES']) {
  test(`Fairytale I blessing rechecks materials after native Drop of ${droppedName}`, async t => {
    const f = fixture(t), { player } = f;
    const messages = [];
    t.mock.method(player, 'sendMessage', text => messages.push(text));
    const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'fairytale_i_growing_pains');
    quest.setStage(player, 60);
    player.setAttribute(NATURE_ITEMS_ATTRIBUTE, '1,2,3');
    const ids = ['SECATEURS', 'WHITE_BERRIES', 'MORT_MYRE_PEAR', 'MORT_MYRE_STEM'].map(name => core.ItemIdentifiers[name]);
    player.setLocation(new core.Location(3441, 9737, 1));
    for (const id of ids) player.getInventory().add(new core.Item(id));
    player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.GHOSTSPEAK_AMULET));
    const npc = core.NPC.create(core.NpcIdentifiers.NATURE_SPIRIT, new core.Location(3441, 9738, 1));
    const start = { player, npc, npcId: npc.getId(), variant: {
      page: 'Fairytale I - Growing Pains', variant: 'in-the-nature-grotto-talking-to-the-nature-spirit',
    }, exact: true };
    PM.emitCustomEvent('npc-dialogue:start', start);
    assert.equal(start.handled, true);
    for (let n = 0; n < 20 && !player.getMovementQueue().isMovementBlocked(); n++) await nextLine(f);
    assert.equal(player.getMovementQueue().isMovementBlocked(), true);
    core.TaskManager.process();
    const droppedId = core.ItemIdentifiers[droppedName];
    const slot = player.getInventory().getItems().findIndex(item => item?.getId() === droppedId);
    await f.connection.dispatch([{ type: 'inventory_action', widgetId: 3214,
      itemId: droppedId, slot, option: 'Drop', optionIndex: 5 }]);
    f.connection.processTurnPackets();
    assert.equal(player.getInventory().getAmount(droppedId), 0, 'the real inventory packet drops the item');
    for (let n = 0; n < 12; n++) core.TaskManager.process();
    assert.equal(quest.getStage(player), 60, 'missing materials cannot advance the initial blessing');
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.MAGIC_SECATEURS), 0);
    for (const id of ids.filter(id => id !== droppedId)) {
      assert.equal(player.getInventory().getAmount(id), 1, 'remaining materials are not consumed');
    }
    assert.equal(player.getMovementQueue().isMovementBlocked(), false);
    assert.match(messages.at(-1), /materials/);
  });
}

function amikRoutingFixture(t, frozen = false) {
  const f = fixture(t), { player } = f;
  core.RegionManager.init();
  const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  f.quest = key => { const quest = quests.find(q => q.key === key); assert.ok(quest, key); return quest; };
  for (const key of ['black_knights_fortress', 'druidic_ritual']) {
    const quest = f.quest(key); quest.setStage(player, quest.completionValue);
  }
  f.quest('recipe_for_disaster').setStage(player, 4);
  player.setAttribute(RFD_FEAST_SEEN, true);
  player.setAttribute(RFD_FEAST_PENDING, false);
  player.setAttribute('quest.points', 5);
  // Castle coordinates are Sir Amik's canonical npc-spawns.json entry.
  const tile = frozen ? new core.Location(1865, 5345, 0) : new core.Location(2960, 3336, 2);
  player.setLocation(new core.Location(tile.getX() + 1, tile.getY(), tile.getZ()));
  player.setNeedsPlacement(false);
  const id = frozen ? core.NpcIdentifiers.SIR_AMIK_VARZE_3 : core.NpcIdentifiers.SIR_AMIK_VARZE_4;
  if (frozen) {
    t.after(() => {
      const owned = [...core.World.getNpcs(), ...core.World.getAddNPCQueue()].filter(npc => npc.getOwner() === player);
      for (const npc of owned) {
        const index = npc.getIndex(); PM.removeNpc(npc);
        assert.notEqual(core.World.getNpcs().get(index), npc);
        assert.equal(npc.isRegistered(), false);
        assert.ok(!core.World.getAddNPCQueue().includes(npc));
      }
    });
    PM.emitCustomEvent('player:bootstrap-complete', { player });
    f.npc = [...core.World.getNpcs()].find(npc => npc.getOwner() === player && npc.getId() === id);
    assert.ok(f.npc, 'real RFD bootstrap spawns the frozen council actor');
    assert.equal(core.World.getNpcs().get(f.npc.getIndex()), f.npc);
  } else {
    f.npc = core.NPC.create(id, tile);
    const spawnedAmik = f.npc;
    t.after(() => {
      const index = spawnedAmik.getIndex();
      core.World.getNpcs().remove(spawnedAmik);
      assert.notEqual(core.World.getNpcs().get(index), spawnedAmik);
      assert.equal(spawnedAmik.isRegistered(), false);
    });
    assert.equal(core.World.getNpcs().add(spawnedAmik), true);
    assert.equal(core.World.getNpcs().get(spawnedAmik.getIndex()), spawnedAmik);
  }
  f.operated = [];
  const operatedHooks = PM.customEventHooks.get('npc:operated') ?? [];
  const operatedStart = operatedHooks.length;
  t.after(() => PM.customEventHooks.get('npc:operated')?.splice(operatedStart));
  PM.createApi('AmikRoutingTest').onCustomEvent('npc:operated', event => {
    if (event.player === player) f.operated.push({ npcId: event.npcId, option: event.option });
  });
  f.messages = [];
  const send = player.sendMessage;
  t.mock.method(player, 'sendMessage', function(message) { f.messages.push(message); return send.call(this, message); });
  f.talk = async () => {
    player.closeInterruptibleInterfaces();
    const operatedBefore = f.operated.length;
    const actions = f.npc.getCurrentDefinition(player).getActions();
    const clickType = (actions.includes('Talk-to') ? actions.indexOf('Talk-to') : actions.indexOf('Inspect')) + 1;
    assert.ok(clickType > 0, 'canonical actor has Talk-to or Inspect');
    await f.connection.dispatch([{ type: 'npc_option', index: f.npc.getIndex(), clickType }]);
    f.connection.processTurnPackets();
    for (let n = 0; n < 4; n++) {
      core.TaskManager.processWalkTo(player.getIndex());
      player.getMovementQueue().beginCycle(); player.getMovementQueue().process(); core.TaskManager.process();
    }
    assert.equal(f.operated.length, operatedBefore + 1, JSON.stringify({
      checkpoint: 'native NPC operation reached', player: player.getLocation(), npc: f.npc.getLocation(),
      contentId: f.npc.getContentId(player), messages: f.messages,
      current: player.getDialogueManager().getCurrent()?.getText(), pending: MultiChatboxPrompt.getPending(player),
    }));
  };
  return f;
}

test('castle Sir Amik starts Recruitment Drive after the RFD opening without Legends requirements', async t => {
  const f = amikRoutingFixture(t), { player } = f;
  const before = rfdSavedProgress(player);
  await f.talk();
  for (let n = 0; n < 16 && !MultiChatboxPrompt.getPending(player) && player.getDialogueManager().getCurrent(); n++) await nextLine(f);
  assert.equal(MultiChatboxPrompt.getPending(player)?.title, 'Start the Recruitment Drive quest?', JSON.stringify({ messages: f.messages, current: player.getDialogueManager().getCurrent()?.getText(), operated: f.operated }));
  assert.ok(!f.messages.some(text => text.includes("Legends' Quest")), 'no unrelated rescue refusal');
  await choose(f, 1);
  for (let n = 0; n < 12 && player.getDialogueManager().getCurrent(); n++) await nextLine(f);
  assert.equal(f.quest('recruitment_drive').getStage(player), 1);
  assert.equal(f.quest('legends_quest').getStage(player), 0);
  assert.equal(rfdSavedProgress(player), before, 'the rescue, points and inventory are unchanged');
  await f.talk();
  const lines = [];
  for (let n = 0; n < 10 && player.getDialogueManager().getCurrent(); n++) {
    lines.push(player.getDialogueManager().getCurrent().getText()); await nextLine(f);
  }
  // wrapText retains trailing spaces and the runner joins lines with another space.
  const expected = 'No, I am afraid not. I suggest you go meet Sir Tiffy in Falador Park, he will be expecting you.';
  assert.ok(lines.some(text => text.replace(/\s+/g, ' ').trim() === expected), JSON.stringify({
    checkpoint: 'started Recruitment route remains available', lines,
    pending: MultiChatboxPrompt.getPending(player), operated: f.operated, messages: f.messages,
  }));
});

test('frozen Sir Amik keeps the RFD Legends prerequisite refusal', async t => {
  const f = amikRoutingFixture(t, true), { player } = f;
  const before = rfdSavedProgress(player);
  await f.talk();
  assert.ok(f.messages.includes("You need 107 quest points, the Legends' Quest prerequisites and access to the Kharazi Jungle before helping Sir Amik."));
  assert.equal(f.quest('recruitment_drive').getStage(player), 0);
  assert.equal(rfdSavedProgress(player), before);
});

test('eligible frozen Sir Amik retains RFD rescue guidance', async t => {
  const f = amikRoutingFixture(t, true), { player } = f;
  for (const key of ['family_crest', 'heroes_quest', 'lost_city', 'merlins_crystal', 'shield_of_arrav',
    'dragon_slayer_i', 'shilo_village', 'jungle_potion', 'druidic_ritual', 'underground_pass',
    'biohazard', 'plague_city', 'waterfall_quest']) {
    const quest = f.quest(key); quest.setStage(player, quest.completionValue);
  }
  f.quest('legends_quest').setStage(player, 5);
  player.setAttribute('quest.points', 107);
  const before = rfdSavedProgress(player);
  await f.talk();
  assert.ok(f.messages.includes('Speak to Aris about freeing Sir Amik Varze to learn the next step.'));
  assert.ok(!f.messages.some(text => text.includes("Legends' Quest")));
  assert.equal(f.quest('recruitment_drive').getStage(player), 0);
  assert.equal(rfdSavedProgress(player), before);
});

test('castle Sir Amik transcript selector defers RFD to Recruitment Drive after the opening', t => {
  const f = amikRoutingFixture(t), { player, npc } = f;
  const index = require('../data/definitions/npc-dialogue-index.json');
  const pages = index[npc.getId()].map(entry => ({ ...entry, page: entry.page.replace(/^Transcript:/, '') }));
  const choice = PM.emitNpcDialogueVariant({ player, npc, npcId: npc.getId(), definition: npc.getCurrentDefinition(player), pages });
  assert.deepEqual(choice, { page: 'Recruitment Drive', variant: 'starting-out-talking-to-sir-amik-varze' });
});

test('castle Sir Amik still offers Black Knights Fortress after the RFD opening', async t => {
  const f = amikRoutingFixture(t), { player } = f;
  f.quest('black_knights_fortress').setStage(player, 0);
  player.setAttribute('quest.points', 12);
  await f.talk();
  for (let n = 0; n < 24 && !MultiChatboxPrompt.getPending(player) && player.getDialogueManager().getCurrent(); n++) await nextLine(f);
  for (const option of ['I seek a quest!', 'I laugh in the face of danger!']) {
    const selected = MultiChatboxPrompt.getPending(player)?.options.indexOf(option) ?? -1;
    assert.ok(selected >= 0, JSON.stringify({ option, pending: MultiChatboxPrompt.getPending(player), messages: f.messages, operated: f.operated }));
    await choose(f, selected + 1);
    for (let n = 0; n < 24 && !MultiChatboxPrompt.getPending(player) && player.getDialogueManager().getCurrent(); n++) await nextLine(f);
  }
  assert.equal(MultiChatboxPrompt.getPending(player)?.title, "Start the Black Knights' Fortress quest?", JSON.stringify({ messages: f.messages, current: player.getDialogueManager().getCurrent()?.getText(), operated: f.operated }));
  assert.equal(f.quest('recruitment_drive').getStage(player), 0);
  assert.ok(!f.messages.some(text => text.includes("Legends' Quest")));
});

test('Legends guard still refuses an ineligible player after the RFD opening', async t => {
  const f = amikRoutingFixture(t), { player } = f;
  const amik = f.npc;
  const guard = core.NPC.create(core.NpcIdentifiers.LEGENDS_GUARD, new core.Location(2728, 3348));
  t.after(() => {
    const index = guard.getIndex();
    core.World.getNpcs().remove(guard);
    assert.notEqual(core.World.getNpcs().get(index), guard);
    assert.equal(guard.isRegistered(), false);
    f.npc = amik;
  });
  assert.equal(core.World.getNpcs().add(guard), true);
  assert.equal(core.World.getNpcs().get(guard.getIndex()), guard);
  f.npc = guard;
  player.setLocation(new core.Location(2729, 3348)); player.setNeedsPlacement(false);
  const before = rfdSavedProgress(player);
  await f.talk();
  for (const option of ['How do I get in here?', 'Can I speak to someone in charge?', 'Can I go on the quest?']) {
    for (let n = 0; n < 20 && !MultiChatboxPrompt.getPending(player) && player.getDialogueManager().getCurrent(); n++) await nextLine(f);
    const selected = MultiChatboxPrompt.getPending(player)?.options.indexOf(option) ?? -1;
    assert.ok(selected >= 0, option); await choose(f, selected + 1);
  }
  const lines = [];
  for (let n = 0; n < 20 && !MultiChatboxPrompt.getPending(player) && player.getDialogueManager().getCurrent(); n++) {
    lines.push(player.getDialogueManager().getCurrent().getText()); await nextLine(f);
  }
  assert.ok(lines.some(text => text.startsWith("I'm very sorry but you need to complete more quests")), 'actual Legends requirements refusal remains');
  assert.equal(f.quest('legends_quest').getStage(player), 0);
  assert.equal(rfdSavedProgress(player), before);
});

function lostTribeSilverwareFixture(t, { ham = 2, stage = 9, contact = 2, silverware = true } = {}) {
  const f = fixture(t);
  f.quest = registeredQuest('the_lost_tribe');
  f.quest.setStage(f.player, stage);
  f.player.setAttribute('quest.the_lost_tribe.ham', ham);
  f.player.setAttribute('quest.the_lost_tribe.contact', contact);
  f.npc = core.NPC.create(core.NpcIdentifiers.DUKE_HORACIO, new core.Location(3211, 3220, 1));
  if (silverware) f.player.getInventory().add(new core.Item(core.ItemIdentifiers.SILVERWARE, 1), false);
  f.talk = () => PM.emitNpcInteraction({ player: f.player, npc: f.npc, npcId: f.npc.getId(), action: 'Talk-to', clickType: 1, handled: false });
  f.search = () => {
    const id = core.ObjectIdentifiers.CRATE_65, location = new core.Location(3152, 9645, 0);
    const object = new core.GameObject(id, location, 10, 0, null);
    return PM.emitObjectInteraction({ player: f.player, object, location,
      objectId: id, x: 3152, y: 9645, z: 0, option: 'Search', clickType: 1, handled: false });
  };
  return f;
}
async function lostTribeContinue(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 }]);
  f.connection.processTurnPackets();
}
async function lostTribeHandIn(f) {
  f.talk();
  for (let n = 0; n < 10 && !MultiChatboxPrompt.getPending(f.player); n++) await lostTribeContinue(f);
  const options = MultiChatboxPrompt.getPending(f.player)?.options ?? [];
  const index = options.indexOf('I found the missing silverware in the HAM cave!');
  assert.ok(index >= 0, 'actual Duke transcript offers the hand-in');
  await choose(f, index + 1);
  for (let n = 0; n < 20 && f.player.getDialogueManager().getCurrent(); n++) await lostTribeContinue(f);
}
test('Lost Tribe silverware stays owned across Duke opener cancellation and signs only at real hand-in (#2893)', async t => {
  const f = lostTribeSilverwareFixture(t), I = core.ItemIdentifiers;
  assert.equal(f.talk(), true);
  assert.equal(f.player.getInventory().getAmount(I.SILVERWARE), 1, 'opening Duke dialogue does not consume the item');
  f.player.closeInterruptibleInterfaces();
  assert.equal(f.quest.getStage(f.player), 9);
  for (let n = f.player.getInventory().getFreeSlots(); n > 0; n--) f.player.getInventory().add(new core.Item(I.BRONZE_DAGGER, 1), false);
  assert.equal(f.player.getInventory().getFreeSlots(), 0);
  await lostTribeHandIn(f);
  assert.equal(f.quest.getStage(f.player), 10);
  assert.equal(f.player.getInventory().getAmount(I.SILVERWARE), 0);
  assert.equal(f.player.getInventory().getAmount(I.PEACE_TREATY), 1, 'silverware slot becomes treaty even with full inventory');
  f.player.closeInterruptibleInterfaces(); f.talk();
  assert.equal(f.player.getInventory().getAmount(I.PEACE_TREATY), 1, 'retalk does not duplicate treaty');
});
test('Lost Tribe historical consumed silverware can be recovered from the real crate and handed in after save reload (#2893)', async t => {
  const f = lostTribeSilverwareFixture(t, { silverware: false }), I = core.ItemIdentifiers;
  const save = require('../dist/game/entity/impl/player/persistence/PlayerSave').PlayerSave.fromPlayer(f.player);
  const restored = lostTribeSilverwareFixture(t, { silverware: false });
  save.applyToPlayer(restored.player);
  restored.search();
  for (let n = 0; n < 12 && restored.player.getDialogueManager().getCurrent(); n++) await lostTribeContinue(restored);
  assert.equal(restored.player.getInventory().getAmount(I.SILVERWARE), 1, 'ham2 without item remains recoverable');
  restored.search();
  assert.equal(restored.player.getInventory().getAmount(I.SILVERWARE), 1, 'no duplicate silverware');
  await lostTribeHandIn(restored);
  assert.equal(restored.quest.getStage(restored.player), 10);
  assert.equal(restored.player.getInventory().getAmount(I.PEACE_TREATY), 1);
});

test('Lost Tribe silverware search preserves capacity, duplicate and stage/contact gates (#2893)', async t => {
  const I = core.ItemIdentifiers;
  for (const ham of [0, 2]) {
    const f = lostTribeSilverwareFixture(t, { ham, silverware: false });
    for (let n = 0; n < 28; n++) f.player.getInventory().add(new core.Item(I.BRONZE_DAGGER, 1), false);
    f.search();
    assert.equal(f.player.getInventory().getAmount(I.SILVERWARE), 0, 'full inventory cannot acquire silverware');
    assert.equal(f.player.getAttribute('quest.the_lost_tribe.ham'), ham, 'failed acquisition preserves progress');
    f.player.closeInterruptibleInterfaces();
    f.player.getInventory().deleteNumber(I.BRONZE_DAGGER, 1);
    f.search();
    for (let n = 0; n < 12 && f.player.getDialogueManager().getCurrent(); n++) await lostTribeContinue(f);
    assert.equal(f.player.getInventory().getAmount(I.SILVERWARE), 1);
    f.search();
    assert.equal(f.player.getInventory().getAmount(I.SILVERWARE), 1, 'repeat does not duplicate');
  }
  const banked = lostTribeSilverwareFixture(t, { silverware: false });
  banked.player.getBank(0).add(new core.Item(I.SILVERWARE, 1), false);
  banked.search();
  assert.equal(banked.player.getInventory().getAmount(I.SILVERWARE), 0, 'banked silverware is not lost');
  assert.equal(banked.player.getBanks()[0].getAmount(I.SILVERWARE), 1);
  for (const setup of [{ stage: 8 }, { stage: 10 }, { stage: 12 }, { contact: 1 }]) {
    const f = lostTribeSilverwareFixture(t, { ...setup, silverware: false });
    f.search();
    assert.equal(f.player.getInventory().getAmount(I.SILVERWARE), 0, 'only the current objective can recover it');
    assert.equal(f.quest.getStage(f.player), setup.stage ?? 9);
  }
});
