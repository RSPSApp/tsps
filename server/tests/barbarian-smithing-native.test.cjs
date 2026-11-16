// Real Player/Inventory/NPC, map anvil, native packets, skill task and save codec.
const assert = require('node:assert/strict');
const path = require('node:path');
const {test, before, after} = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
const {CREATION_MENU_GROUP_ID, CREATION_MENU_FIRST_ITEM_COMPONENT} = require('../dist/net/packet/PacketSender');
const {SkillManager} = require('../dist/game/content/skill/SkillManager');
const {PlayerSave} = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const {Bank} = require('../dist/game/model/container/impl/Bank');
const Training = require('../plugins/npcs/BarbarianTraining.plugin');
const Runtime = require('../plugins/quests/QuestRuntime');
const Sessions = require('../plugins/skills/smithing/Sessions.Smithing');
const TOPIC_SPEAR = 'Tell me more about the use of spears.';
const TOPIC_HASTA = 'What of the one-handed spears of which you spoke?';
const SPEAR_FINAL = 'Note well that you will require wood for the spear shafts; the quality of wood must be similar to that of the metal involved.';
const HASTA_FINAL = 'Indeed. You may use our special anvil for this spear type too. The ways of black and dragon spears are beyond our knowledge, however; these spears may not be created.';
const TAMAYU = 'quest.tai_bwo_wannai_trio.tamayu';
let core, otto, anvil, quest, fault = null, serial = 0;
const hookErrors = [], oldError = console.error;

before(async () => {
  console.error = (...args) => { hookErrors.push(args.map(String).join(' ')); oldError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('NpcDialogues'));
  require('../plugins/quests/quests/TaiBwoWannaiTrio.Quest')(PM.createApi('Quests'));
  require('../plugins/skills/Smithing.plugin').register(PM.createApi('Smithing'));
  Training.register(PM.createApi('BarbarianTraining'));
  PM.createApi('SmithingTranscriptFault').onCustomEvent('npc-dialogue:start', request => {
    if (fault && request.npcId === core.NpcIdentifiers.OTTO_GODBLESSED) {
      request.select(fault === 'empty' ? [] : [{type: 'choice', options: [{text: TOPIC_SPEAR,
        steps: [{player: TOPIC_SPEAR}, ...(fault === 'truncated' ? [{type: 'condition', text: 'If Tai Bwo Wannai Trio has been completed:',
          steps: [{type: 'line', text: 'Many warriors complain that spears are difficult to find, we barbarians thus forge our own.'}]}] : [])]}]}]);
    }
  });
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2502, 3485);
  otto = core.NPC.create(core.NpcIdentifiers.OTTO_GODBLESSED, new core.Location(2501, 3487, 0));
  otto.setScriptedMovement(true);
  assert.equal(core.World.getNpcs().add(otto), true);
  otto.needsPlacement = false;
  const id = core.CacheDefinitions.getLocId('brut_anvil');
  assert.equal(id, 25349);
  anvil = core.MapObjects.getPrivateArea(new Player(null), id, new core.Location(2502, 3485, 0));
  assert.ok(anvil, 'real map barbarian anvil');
  assert.equal(core.ObjectDefinition.forId(id).getName(), 'Barbarian anvil');
  assert.equal(core.CacheDefinitions.getVarbitId('brut_smith_spear'), 3762);
  assert.equal(core.CacheDefinitions.getVarbitId('brut_smith_hasta'), 3763);
  quest = Runtime.questNamed('Tai Bwo Wannai Trio');
  assert.ok(quest);
  PM.emitServerStartup({}); // Only explicitly registered owners; no browser gateway.
  core.TaskManager.process();
});

after(() => {
  try {
    if (otto?.isRegistered()) core.World.getNpcs().removes(otto);
    PM.emitServerShutdown({});
    assert.deepEqual(hookErrors, [], 'required owners must not throw');
  } finally { console.error = oldError; }
});

function fixture(t, taughtPrerequisites = false) {
  const packets = [];
  const channel = {kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {}};
  const session = new PlayerSession(channel);
  session.sendClientPacket = packet => { packets.push(packet); };
  const p = new Player(session);
  p.setUsername(`smithlesson${++serial}`);
  p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(2503, 3485, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  p.getSkillManager().setExperience(core.Skill.SMITHING, SkillManager.getExperienceForLevel(99));
  p.getSkillManager().setMaxLevel(core.Skill.SMITHING, 99).setCurrentLevel(core.Skill.SMITHING, 99);
  for (const id of [core.ItemIdentifiers.HAMMER, core.ItemIdentifiers.BRONZE_BAR, core.ItemIdentifiers.LOGS]) p.getInventory().adds(id, 2);
  const connection = new ClientConnection(channel); connection.player = p;
  const tick = () => {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    connection.processTurnPackets();
    const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit(); if (q.hasPendingWork()) q.process();
    core.TaskManager.processWalkTo(p.getIndex());
  };
  const send = async (packet, turns = 3) => { await connection.dispatch([packet]); for (let i = 0; i < turns; i++) tick(); };
  const current = () => p.getDialogueManager().getCurrent();
  const resume = () => {
    const group = p.getPacketSender().getChatboxGroupId();
    return send({type: 'dialogue_continue', widgetId: (group << 16) | (group === 229 ? 4 : 5), childIndex: -1});
  };
  const choose = async text => {
    const choices = current()?.getOptions?.();
    assert.ok(choices?.includes(text), `native menu includes ${text}`);
    await send({type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: choices.indexOf(text) + 1});
  };
  const talk = async () => {
    await send({type: 'npc_option', index: otto.getIndex(), clickType: 1});
    for (let i = 0; i < 15 && !current()?.getOptions; i++) await resume();
    assert.ok(current()?.getOptions, 'native Talk-to opened topic menu');
  };
  const use = async (barId = core.ItemIdentifiers.BRONZE_BAR) => {
    await send({type: 'item_on_object', objectId: anvil.getId(), x: 2502, y: 3485,
      itemId: barId, slot: p.getInventory().getSlotForItemId(barId), widgetId: 149 << 16});
    for (let i = 0; i < 15 && !p.getCreationMenu() && !current(); i++) tick();
  };
  t.after(() => {
    p.getPacketSender().sendInterfaceRemoval();
    PM.emitPlayerDisconnect({player: p});
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().removes(p);
    assert.equal(Sessions.typeOf(p), null);
  });
  if (taughtPrerequisites) eligible(p);
  return {p, packets, connection, tick, send, current, resume, choose, talk, use};
}

function eligible(p, claimed = true) {
  p.setAttribute('barbarian-training', {fishingRod: 3, harpoon: 3});
  quest.setStage(p, 6);
  p.setAttribute(TAMAYU, claimed ? 5 : 4);
}

async function until(f, text) {
  for (let i = 0; i < 30 && f.current()?.getText?.() !== text; i++) await f.resume();
  assert.equal(f.current()?.getText?.(), text);
}

async function selectProduct(f, id, amount = 1) {
  const menu = f.p.getCreationMenu();
  assert.ok(menu, 'native item-on-anvil opened current menu');
  const slot = menu.getItems().indexOf(id);
  assert.ok(slot >= 0);
  await f.send({type: 'dialogue_continue', widgetId: (CREATION_MENU_GROUP_ID << 16) | (CREATION_MENU_FIRST_ITEM_COMPONENT + slot), childIndex: amount}, 1);
}

async function learn(f, topic, final) {
  await f.talk(); await f.choose(topic); await until(f, final);
  f.p.getPacketSender().sendInterfaceRemoval();
}

function roundTrip(t, original, spear, hasta) {
  let codec;
  require('../plugins/persistence/JsonPlayerPersistence.plugin').register({
    getSkillManager: () => SkillManager, setPlayerPersistence: value => { codec = value; }, log() {},
  });
  const saved = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(original), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const restored = fixture(t).p;
  codec.hydratePlayerSave(saved).applyToPlayer(restored);
  PM.emitPlayerLogin({player: restored, username: restored.getUsername()});
  for (const [field, value] of [['spear', spear], ['hasta', hasta]]) {
    assert.equal(Training._test.state(restored)[field], value);
    assert.equal(restored.getPacketSender().getVarbit(field === 'spear' ? 3762 : 3763), value);
  }
  assert.equal(Training._test.state(restored).fishingRod, Training._test.state(original).fishingRod);
  assert.equal(Training._test.state(restored).herblore, Training._test.state(original).herblore);
  return restored;
}

test('fresh native barbarian anvil refuses instead of the absent-quest fail-open', async t => {
  const f = fixture(t), p = f.p, I = core.ItemIdentifiers;
  const before = p.getSkillManager().getExperience(core.Skill.SMITHING);
  await f.use();
  assert.equal(p.getCreationMenu(), null, 'untaught player must not get a crafting menu');
  for (let i = 0; i < 8; i++) f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 2);
  assert.equal(p.getInventory().getAmount(I.LOGS), 2);
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 0);
  assert.equal(p.getSkillManager().getExperience(core.Skill.SMITHING), before);
});

test('eligible native Otto menu offers spear teaching without completing other sections', async t => {
  const f = fixture(t, true);
  await f.talk();
  assert.ok(f.current().getOptions().includes(TOPIC_SPEAR));
  assert.ok(!f.current().getOptions().includes(TOPIC_HASTA));
  await f.choose(TOPIC_SPEAR);
  assert.equal(Training._test.state(f.p).spear, 0, 'selecting topic alone does not teach');
  await until(f, SPEAR_FINAL);
  assert.equal(Training._test.state(f.p).spear, 1);
});

test('native manufacture and reports complete two independent lessons; inventory alone and other smithing cannot skip them', async t => {
  const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
  p.getInventory().adds(I.BRONZE_SPEAR, 1); // Bought/carried fixture is not a manufacture event.
  await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
  assert.equal(Training._test.state(p).spear, 1);
  assert.equal(Training._test.state(p).hasta, 0);
  roundTrip(t, p, 1, 0);
  PM.emitCustomEvent('smithing:success', {player: p, itemId: I.BRONZE_SPEAR});
  PM.emitCustomEvent('smithing:success', {player: p, itemId: I.BRONZE_HASTA, source: 'barbarian-anvil'});
  assert.equal(Training._test.state(p).spear, 1);
  assert.equal(Training._test.state(p).hasta, 0);
  await f.use(); await selectProduct(f, I.BRONZE_HASTA);
  f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_HASTA), 0, 'spear instruction does not allow hasta');
  const xp = p.getSkillManager().getExperience(core.Skill.SMITHING);
  await f.use(); await selectProduct(f, I.BRONZE_SPEAR);
  f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 1);
  assert.equal(p.getInventory().getAmount(I.LOGS), 1);
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 2);
  assert.equal(p.getSkillManager().getExperience(core.Skill.SMITHING) - xp, 25);
  assert.equal(Training._test.state(p).spear, 2);
  assert.equal(f.current().getText(), Training._test.LEARNED);
  roundTrip(t, p, 2, 0);
  await learn(f, TOPIC_SPEAR, 'The manufacture of spears is now yours as a speciality. Use your skill well. In addition I am ready to reveal one-handed spear crafts.');
  assert.equal(Training._test.state(p).spear, 3);
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 2, 'report does not consume a spear');
  await learn(f, TOPIC_HASTA, HASTA_FINAL);
  assert.equal(Training._test.state(p).hasta, 1);
  roundTrip(t, p, 3, 1);
  await f.use(); await selectProduct(f, I.BRONZE_HASTA);
  f.tick();
  assert.equal(Training._test.state(p).hasta, 2);
  assert.equal(p.getInventory().getAmount(I.BRONZE_HASTA), 1);
  roundTrip(t, p, 3, 2);
  await learn(f, TOPIC_HASTA, "To live life to it's fullest of course - that you may be a peaceful spirit when your time ends.");
  assert.equal(Training._test.state(p).hasta, 3);
  assert.equal(p.getInventory().getAmount(I.BRONZE_HASTA), 1);
  roundTrip(t, p, 3, 3);
});

test('incomplete fishing reports, unclaimed Tamayu reward, missing transcript and early close never teach', async t => {
  const f = fixture(t, true), p = f.p;
  Training._test.setStage(p, 'harpoon', 2);
  await f.talk();
  assert.ok(!f.current().getOptions().includes(TOPIC_SPEAR));
  Training._test.setStage(p, 'harpoon', 3);
  quest.setStage(p, 0);
  await f.talk(); await f.choose(TOPIC_SPEAR);
  await until(f, 'The next step is to manufacture a spear, suitable for combat. To do so, you must speak with our distant cousins on Karamja, in the village of Tai Bwo Wannai.');
  assert.equal(Training._test.state(p).spear, 0);
  quest.setStage(p, 6); p.setAttribute(TAMAYU, 4);
  await f.talk(); await f.choose(TOPIC_SPEAR); await f.resume();
  assert.equal(Training._test.state(p).spear, 0, 'quest complete alone is not Tamayu combat training');
  p.setAttribute(TAMAYU, 5);
  for (const invalid of ['empty', 'player-only']) {
    fault = invalid;
    try { await f.talk(); await f.choose(TOPIC_SPEAR); }
    finally { fault = null; }
    assert.equal(Training._test.state(p).spear, 0);
    assert.equal(p.getDialogueManager().isActive(), false);
  }
  await f.talk(); await f.choose(TOPIC_SPEAR); await f.resume();
  p.getPacketSender().sendInterfaceRemoval();
  await f.resume();
  assert.equal(Training._test.state(p).spear, 0);
  p.setAttribute('barbarian-training:smithing', true);
  await f.use();
  assert.equal(p.getCreationMenu(), null, 'obsolete broad boolean does not fabricate lessons');
  roundTrip(t, p, 0, 0);
});

test('a truncated spear instruction with an earlier NPC line cannot replace the required final reply', async t => {
  const f = fixture(t, true);
  fault = 'truncated';
  try { await f.talk(); await f.choose(TOPIC_SPEAR); await f.resume(); }
  finally { fault = null; }
  assert.equal(Training._test.state(f.p).spear, 0);
});

test('native selection after teleport out and back cannot use the former anvil menu', async t => {
  const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
  await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
  await f.use();
  p.moveTo(new core.Location(2499, 3485, 0)); p.moveTo(new core.Location(2503, 3485, 0));
  await selectProduct(f, I.BRONZE_SPEAR);
  for (let i = 0; i < 6; i++) f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 0);
  assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 2);
  assert.equal(Training._test.state(p).spear, 1);
});

test('restricted logs cannot turn into a tradeable spear through the real make-X action', async t => {
  const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
  await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
  p.getInventory().deleteNumber(I.LOGS, 2);
  p.getInventory().add(new core.Item(I.LOGS, 1, {[core.Item.PRESET_META]: true}));
  await f.use(); await selectProduct(f, I.BRONZE_SPEAR);
  f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 0);
  assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 2);
  assert.equal(p.getInventory().getAmount(I.LOGS), 1);
});

test('actual spear production uses barbarian hammering and keeps four ticks between outputs', async t => {
  const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
  await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
  await f.use(); await selectProduct(f, I.BRONZE_SPEAR, 2);
  f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 1);
  assert.equal(p.getAnimation().getId(), core.CacheDefinitions.getSeqId('brut_human_smithing'));
  for (let i = 0; i < 3; i++) { f.tick(); assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 1); }
  f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 2);
  assert.equal(Sessions.typeOf(p), null);
});

test('the actual Tamayu reward transcript unlocks the missing prerequisite', async t => {
  const f = fixture(t, true), p = f.p;
  p.setAttribute(TAMAYU, 4);
  const tamayu = core.NPC.create(core.NpcIdentifiers.TAMAYU, new core.Location(2501, 3487, 0));
  tamayu.setScriptedMovement(true); assert.equal(core.World.getNpcs().add(tamayu), true); tamayu.needsPlacement = false;
  t.after(() => { if (tamayu.isRegistered()) core.World.getNpcs().removes(tamayu); });
  // Post-quest location and prior quest completion are controlled setup; reward ownership is real.
  await f.send({type: 'npc_option', index: tamayu.getIndex(), clickType: 1});
  for (let i = 0; i < 30 && p.getAttribute(TAMAYU) !== 5; i++) await f.resume();
  assert.equal(p.getAttribute(TAMAYU), 5);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.RUNE_SPEAR_KP_), 1);
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK), 2500);
  assert.equal(p.getSkillManager().getExperience(core.Skill.STRENGTH), 2500);
  p.getPacketSender().sendInterfaceRemoval();
  await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
  assert.equal(Training._test.state(p).spear, 1);
});

test('permission, hammer and materials are rechecked on the actual production tick', async t => {
  for (const change of ['permission', 'hammer', 'logs']) await t.test(change, async t => {
    const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
    await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
    await f.use(); await selectProduct(f, I.BRONZE_SPEAR);
    if (change === 'permission') Training._test.setStage(p, 'harpoon', 2);
    else p.getInventory().deleteNumber(change === 'hammer' ? I.HAMMER : I.LOGS, 2);
    f.tick();
    assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 0);
    assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 2);
    assert.equal(Training._test.state(p).spear, 1);
    assert.equal(Sessions.typeOf(p), null);
  });
});

test('real bank remove/return after native interface cancellation preserves materials and a reopened menu works', async t => {
  const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
  await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
  await f.use();
  const oldPacket = {type: 'dialogue_continue', widgetId: (CREATION_MENU_GROUP_ID << 16) | CREATION_MENU_FIRST_ITEM_COMPONENT, childIndex: 1};
  // Native world input clears the old crafting UI. Banking uses its real container APIs at a controlled location.
  await f.send({type: 'move', worldX: p.getLocation().getX(), worldY: p.getLocation().getY() + 1, modifierFlags: 0, run: false});
  assert.equal(p.getCreationMenu(), null);
  p.getBank(0).open(); assert.equal(Bank.isOpen(p), true);
  Bank.deposit(p, I.BRONZE_BAR, p.getInventory().getSlotForItemId(I.BRONZE_BAR), 2, false);
  assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 0);
  Bank.withdraw(p, I.BRONZE_BAR, p.getBank(0).getSlotForItemId(I.BRONZE_BAR), 2, 0);
  assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 2);
  p.getPacketSender().sendInterfaceRemoval();
  await f.send(oldPacket);
  for (let i = 0; i < 5; i++) f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 0);
  assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 2);
  await f.use(); await selectProduct(f, I.BRONZE_SPEAR); f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 1);
  await f.send(oldPacket); // Current menu was consumed before callback; duplicate native packet cannot restart.
  for (let i = 0; i < 5; i++) f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 1);
});

test('real full inventory, level boundary and high tier use existing costs and wielded hammer policy', async t => {
  const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
  await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
  p.getInventory().adds(I.BONES, p.getInventory().getFreeSlots());
  assert.equal(p.getInventory().getFreeSlots(), 0);
  p.getSkillManager().setCurrentLevel(core.Skill.SMITHING, 4);
  await f.use(); await selectProduct(f, I.BRONZE_SPEAR); f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 0);
  p.getSkillManager().setCurrentLevel(core.Skill.SMITHING, 5);
  await f.use(); await selectProduct(f, I.BRONZE_SPEAR); f.tick();
  assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 1);
  assert.equal(p.getInventory().getFreeSlots(), 1, 'consuming two real input slots allows output in a full inventory');
  p.getInventory().resetItems();
  p.getEquipment().set(core.Equipment.SHIELD_SLOT, new core.Item(I.IMCANDO_HAMMER_OFF_HAND_, 1));
  p.getInventory().adds(I.RUNITE_BAR, 1); p.getInventory().adds(I.MAGIC_LOGS, 1);
  p.getSkillManager().setCurrentLevel(core.Skill.SMITHING, 90);
  const xp = p.getSkillManager().getExperience(core.Skill.SMITHING);
  await f.use(I.RUNITE_BAR); await selectProduct(f, I.RUNE_SPEAR); f.tick();
  assert.equal(p.getInventory().getAmount(I.RUNE_SPEAR), 1);
  assert.equal(p.getSkillManager().getExperience(core.Skill.SMITHING) - xp, 150);
  assert.equal(p.getAnimation().getId(), core.CacheDefinitions.getSeqId('brut_human_smithing_imcando_hammer'));
});

test('report interruption and Otto leaving before the final reply preserve unreported progress', async t => {
  for (const section of ['spear', 'hasta']) await t.test(section, async t => {
    const f = fixture(t, true), p = f.p;
    Training._test.setStage(p, 'spear', section === 'spear' ? 2 : 3);
    Training._test.setStage(p, 'hasta', section === 'hasta' ? 2 : 0);
    const topic = section === 'spear' ? TOPIC_SPEAR : TOPIC_HASTA;
    await f.talk(); await f.choose(topic);
    p.getPacketSender().sendInterfaceRemoval(); await f.resume();
    assert.equal(Training._test.state(p)[section], 2);
    await f.talk(); await f.choose(topic);
    if (section === 'hasta') {
      await f.resume(); await f.resume();
      assert.equal(f.current().getText(), 'If I may ask, readiness for what?');
    }
    const position = otto.getLocation().clone();
    otto.setLocation(new core.Location(2515, 3490, 0));
    try { await f.resume(); }
    finally { otto.setLocation(position); }
    assert.equal(Training._test.state(p)[section], 2);
    assert.equal(p.getDialogueManager().isActive(), false);
  });
});

test('native movement and actual disconnect stop pending manufacturing without later production', async t => {
  for (const mode of ['walk', 'disconnect']) await t.test(mode, async t => {
    const f = fixture(t, true), p = f.p, I = core.ItemIdentifiers;
    await learn(f, TOPIC_SPEAR, SPEAR_FINAL);
    await f.use(); await selectProduct(f, I.BRONZE_SPEAR, 2);
    // The native world input is admitted before the next task tick, as the server does.
    if (mode === 'walk') {
      await f.connection.dispatch([{type: 'move', worldX: p.getLocation().getX(), worldY: p.getLocation().getY() + 1, modifierFlags: 0, run: false}]);
      f.connection.processTurnPackets();
    } else { PM.emitPlayerDisconnect({player: p}); core.World.getPlayers().removes(p); }
    for (let i = 0; i < 8; i++) f.tick();
    assert.equal(p.getInventory().getAmount(I.BRONZE_SPEAR), 0);
    assert.equal(p.getInventory().getAmount(I.BRONZE_BAR), 2);
    assert.equal(Sessions.typeOf(p), null);
  });
});
