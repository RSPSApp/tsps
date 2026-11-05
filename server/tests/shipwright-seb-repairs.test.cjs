// Real actors, shipyard owner, currency containers and dialogue manager; network only is stubbed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const ROOT = path.resolve(__dirname, '..');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, yard, hp, index = 1700;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  PM.loadFromDirectory(path.join(ROOT, 'plugins'));
  core = PM.getCoreApi();
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init(); PM.emitServerStartup({});
  yard = require('../plugins/skills/sailing/Shipyard.plugin');
  hp = require('../plugins/skills/sailing/seacombat/BoatHp.SeaCombat');
});
after(() => PM.emitServerShutdown({}));
function freshPlayer(t) {
  const p = new Player(null); p.setIndex(index++); p.setUsername('SebRepair' + index); p.setRegistered(true);
  p.setAttribute('bot-skip-persistence', true);
  const packets = [];
  p.getSession = () => ({ sendClientPacket(packet) { packets.push(packet); return true; }, write() { return true; }, getChannel() { return null; } });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return { p, packets };
}
function fixture(t, damage = 10) {
  const { p, packets } = freshPlayer(t);
  p.getSkillManager().setCurrentLevel(core.Skill.SAILING, 99);
  core.Sailing.giveBoat(p, 'skiff', 'the_pandemonium');
  yard.beginVisit(p, core.Sailing.getDock('the_pandemonium'), 0);
  p.setNeedsPlacement(false);
  const boat = yard.visitedBoat(p); boat.damage = damage; hp.sendHitpoints(p, boat);
  const sebId = core.CacheDefinitions.getNpcId('sailing_shipyard_manager_vis');
  const npc = core.NPC.create(sebId, p.getLocation().transform(1, 0)); npc.setRegistered(true);
  const coins = core.CacheDefinitions.getObjId('coins'); p.getInventory().add(new core.Item(coins, 1000));
  t.after(() => npc.setRegistered(false));
  const click = option => PM.emitNpcInteraction({ player: p, npc, npcId: sebId,
    definition: npc.getCurrentDefinition(p), option, clickType: option === 'Talk-to' ? 1 : 4, handled: false });
  return { p, npc, boat, coins, packets, click };
}
function prompt(p) {
  for (let i = 0; i < 12; i++) {
    const pending = MultiChatboxPrompt.getPending(p);
    if (pending) return pending;
    const current = p.getDialogueManager().getCurrent();
    assert.ok(current, 'repair dialogue must reach its confirmation');
    const group = current.groupId ?? current.constructor.GROUP_ID;
    if (group) assert.equal(p.getDialogueManager().handleResume((group << 16) | 5, 0), true);
    else p.getDialogueManager().advance();
  }
  assert.fail('repair confirmation did not appear');
}
function choose(p, number) {
  assert.equal(PM.emitInterfaceActionClick({ player: p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: 219, childId: 1, action: number, handled: false }), true);
}
function replay(p, number) {
  return PM.emitInterfaceActionClick({ player:p, buttonId:MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId:219, childId:1, action:number, handled:false });
}
function bankCoins(f, amount) {
  f.p.getBank(0).open();
  core.Bank.deposit(f.p, f.coins, f.p.getInventory().getSlotForItemId(f.coins), amount, false);
  f.p.getPacketSender().sendInterfaceRemoval();
  const bank = f.p.getBank(core.Bank.getTabForItem(f.p, f.coins));
  assert.equal(bank.getAmount(f.coins), amount, 'real bank transfer prepared the funds');
  return bank;
}
function ticks(count) { while (count--) { ++core.World.processCycle; core.TaskManager.process(); } }

// Ordinary shipwright destruction uses the native selection and canonical transcript,
// independently of Seb's repair-only shipyard service.
function destroyFixture(t, npcId) {
  const packets = [], channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send(packet) { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++); p.setUsername('DestroyBoat' + index); p.setRegistered(true);
  p.setAttribute('bot-skip-persistence', true);
  p.getSkillManager().setCurrentLevel(core.Skill.SAILING, 99);
  const spawn = require('../data/definitions/npc-spawns.json').find(entry => entry.id === npcId);
  assert.ok(spawn, 'exercise an ordinary shipwright present in the world spawn data');
  const approach = [[1, 0], [-1, 0], [0, -1], [0, 1]].map(([x, y]) =>
    new core.Location(spawn.x + x, spawn.y + y, spawn.level)).find(tile =>
    !core.RegionManager.blocked(tile, null) && core.RegionManager.canMove(tile.getX(), tile.getY(), spawn.x, spawn.y, spawn.level, 1, 1, null));
  assert.ok(approach, 'the cached shipwright has a reachable adjacent approach');
  p.setLocation(approach);
  const npc = core.NPC.create(npcId, new core.Location(spawn.x, spawn.y, spawn.level));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  const connection = new ClientConnection(channel); connection.player = p;
  t.after(() => {
    p.closeInterruptibleInterfaces(); PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p);
    core.Sailing.onLogout(p); p.setRegistered(false);
    const npcIndex = npc.getIndex();
    core.World.getNpcs().remove(npc);
    assert.equal(core.World.getNpcs().get(npcIndex), null, 'teardown releases the registered NPC slot');
  });
  const native = async packet => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  return { p, npc, packets, native,
    async talk() {
      const clickType = npc.getCurrentDefinition(p).getActions().indexOf('Talk-to') + 1;
      assert.ok(clickType > 0);
      await native({ type: 'npc_option', index: npc.getIndex(), clickType });
      core.TaskManager.processWalkTo(p.getIndex());
    },
  };
}
async function destroyChoice(f) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const pending = MultiChatboxPrompt.getPending(f.p);
    if (pending) return pending;
    assert.ok(f.p.getDialogueManager().getCurrent(), 'canonical dialogue must reach its choice');
    const group = f.p.getPacketSender().getChatboxGroupId();
    await f.native({ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 });
  }
  assert.fail('canonical shipwright choice did not appear');
}
async function destroySelect(f, childIndex) {
  await f.native({ type: 'dialogue_continue', widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex });
}
async function openDestroy(f) {
  await f.talk();
  const menu = await destroyChoice(f);
  const option = menu.options.indexOf("I'd like to destroy a boat.");
  assert.ok(option >= 0, 'native ordinary Talk-to offers canonical destruction');
  await destroySelect(f, option + 1);
  for (let attempt = 0; attempt < 12 && f.p.getInterfaceId() !== 934; attempt++) {
    const group = f.p.getPacketSender().getChatboxGroupId();
    if (f.p.getDialogueManager().getCurrent()) {
      await f.native({ type: 'dialogue_continue', widgetId: (group << 16) | 5, childIndex: -1 });
    }
    ticks(1);
  }
  assert.equal(f.p.getInterfaceId(), 934, 'an owner reaches native Destroy Boat selection, not the no-boats refusal');
  assert.equal(f.p.getPacketSender().getVarbit(18553), 9, 'active cache table149 row7317 is Destroy mode9');
}
async function chooseDestroyedBoat(f, boat) {
  await f.native({ type: 'dialogue_continue', widgetId: (934 << 16) | 5, childIndex: boat.slot + 1 });
}
test('ordinary shipwright native Talk-to, mode9 and canonical confirmation remove only the chosen boat and cargo', async t => {
  const f = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SENNIA);
  const kept = core.Sailing.giveBoat(f.p, 'raft', 'port_sarim');
  const boat = core.Sailing.giveBoat(f.p, 'skiff', 'the_pandemonium');
  boat.cargo.push({ id: core.ItemIdentifiers.COINS, amount: 123 });
  const keptBefore = JSON.stringify(kept);
  await openDestroy(f); await chooseDestroyedBoat(f, boat);
  assert.equal(f.p.getSailing().boats.includes(boat), true, 'selection is not confirmation');
  assert.match(f.p.getDialogueManager().getCurrent().getText().replace(/\s+/g, ' '), /items stored in your cargo hold/);
  assert.deepEqual(await destroyChoice(f), { title: 'Are you sure you want to destroy your boat?',
    options: ['Yes, destroy it.', "No, don't destroy it."] });
  await destroySelect(f, 2);
  assert.equal(f.p.getSailing().boats.includes(boat), true, 'No preserves the boat and cargo');
  await openDestroy(f); await chooseDestroyedBoat(f, boat); await destroyChoice(f); await destroySelect(f, 1);
  assert.deepEqual(f.p.getSailing().boats, [kept]);
  assert.equal(JSON.stringify(kept), keptBefore);
  assert.deepEqual(boat.cargo, []);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 0, 'destruction refunds no cargo or materials');
  assert.match(f.p.getDialogueManager().getCurrent().getText(), /broken up into\s+scrap/);
  await destroySelect(f, 1);
  assert.deepEqual(f.p.getSailing().boats, [kept], 'duplicate native Yes cannot remove another slot');
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const save = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.p)));
  assert.deepEqual(save.sailing.boats, [kept]);
});
test('ordinary shipwright native selection cannot destroy a replacement object occupying the same slot', async t => {
  const f = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SCOTT);
  const original = core.Sailing.giveBoat(f.p, 'raft', 'port_sarim');
  await openDestroy(f); await chooseDestroyedBoat(f, original); await destroyChoice(f);
  const replacement = { ...original, cargo: [{ id: core.ItemIdentifiers.COINS, amount: 50 }] };
  f.p.getSailing().boats[0] = replacement;
  await destroySelect(f, 1);
  assert.equal(f.p.getSailing().boats[0], replacement);
  assert.deepEqual(replacement.cargo, [{ id: core.ItemIdentifiers.COINS, amount: 50 }]);
  assert.doesNotMatch(f.p.getDialogueManager().getCurrent()?.getText?.() ?? '', /broken up into\s+scrap/);
});
test('ordinary shipwright native Junior Jim keeps his distinct canonical warning and completion words after Pandemonium', async t => {
  const jimId = core.CacheDefinitions.getNpcId('junior_jim');
  assert.ok(Number.isInteger(jimId), 'the active cache identifies the real Junior Jim multiloc actor');
  const f = destroyFixture(t, jimId);
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'pandemonium');
  quest.setStage(f.p, 50);
  assert.equal(quest.isComplete(f.p), true, 'post-quest service fixture');
  const boat = core.Sailing.giveBoat(f.p, 'raft', 'the_pandemonium');
  boat.cargo.push({ id: core.ItemIdentifiers.COINS, amount: 1 });
  await openDestroy(f); await chooseDestroyedBoat(f, boat);
  assert.match(f.p.getDialogueManager().getCurrent().getText().replace(/\s+/g, ' '), /cargo hold, mate\. Gotta warn you/);
  await destroyChoice(f); await destroySelect(f, 1);
  assert.match(f.p.getDialogueManager().getCurrent().getText().replace(/\s+/g, ' '), /All done, mate\. Your boat has been broken up into scrap\./);
  assert.deepEqual(f.p.getSailing().boats, []);
});
test('ordinary shipwright no-boats refusal and actual Seb repair-only menu remain intact', async t => {
  const f = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SENNIA);
  await f.talk();
  const menu = await destroyChoice(f);
  await destroySelect(f, menu.options.indexOf("I'd like to destroy a boat.") + 1);
  await f.native({ type: 'dialogue_continue', widgetId: (f.p.getPacketSender().getChatboxGroupId() << 16) | 5, childIndex: -1 });
  assert.match(f.p.getDialogueManager().getCurrent().getText(), /don't seem to own any boats/);
  assert.notEqual(f.p.getInterfaceId(), 934);
  const seb = fixture(t);
  seb.click('Talk-to');
  assert.equal(prompt(seb.p).options.some(text => /destroy/i.test(text)), false);
});
test('native destroy selection close, stale slot and replacement modal cannot remove any boat', async t => {
  for (const transition of ['close-selection', 'replace-selection-slot', 'replace-confirmation', 'move-confirmation', 'death', 'logout']) {
    const f = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SENNIA);
    const boat = core.Sailing.giveBoat(f.p, 'raft', 'port_sarim');
    await openDestroy(f);
    if (transition === 'close-selection') {
      await f.native({ type: 'interface_close' });
      await chooseDestroyedBoat(f, boat);
    } else if (transition === 'replace-selection-slot') {
      f.p.getSailing().boats[0] = { ...boat };
      await chooseDestroyedBoat(f, boat);
    } else {
      await chooseDestroyedBoat(f, boat); await destroyChoice(f);
      if (transition === 'replace-confirmation') f.p.getBank(0).open();
      if (transition === 'move-confirmation') {
        await f.native({ type: 'move', x: f.p.getLocation().getX(), y: f.p.getLocation().getY() + 1, running: false });
      }
      if (transition === 'death') f.p.setHitpoints(0);
      if (transition === 'logout') { PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() }); f.p.setRegistered(false); }
      await destroySelect(f, 1);
      if (transition === 'replace-confirmation') assert.ok(f.p.getInterfaceId() >= 0, 'old callback preserves the bank UI');
    }
    assert.equal(f.p.getSailing().boats.length, 1, transition);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COINS), 0, transition);
  }
});
test('cargo added after an empty-boat confirmation requires a fresh warning before destruction', async t => {
  const f = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SENNIA);
  const boat = core.Sailing.giveBoat(f.p, 'raft', 'port_sarim');
  await openDestroy(f); await chooseDestroyedBoat(f, boat); await destroyChoice(f);
  boat.cargo.push({ id: core.ItemIdentifiers.COINS, amount: 50 });
  await destroySelect(f, 1);
  assert.equal(f.p.getSailing().boats[0], boat);
  assert.deepEqual(boat.cargo, [{ id: core.ItemIdentifiers.COINS, amount: 50 }]);
  await openDestroy(f); await chooseDestroyedBoat(f, boat); await destroyChoice(f); await destroySelect(f, 1);
  assert.deepEqual(f.p.getSailing().boats, []);
});
test('owned disposal runs real Sailing crew/sidepanel consumers before safely releasing a guest', t => {
  const owner = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SENNIA);
  const guest = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SENNIA);
  const common = require('../plugins/skills/sailing/crew/Common.Crew');
  const crewmate = common.all().find(entry => entry.name === 'Cabin Boy Jenkins');
  assert.ok(crewmate);
  // A persisted recruitment fixture; recruitment itself is covered by the crew suite.
  common.update(owner.p, state => { state.recruited = [crewmate.id]; state.slots[0] = crewmate.id; });
  const guestCrew = JSON.stringify(common.state(guest.p));
  const owned = core.Sailing.giveBoat(owner.p, 'skiff', 'port_sarim');
  const kept = core.Sailing.giveBoat(guest.p, 'raft', 'the_pandemonium');
  assert.equal(core.Sailing.board(owner.p, 'port_sarim'), null);
  const instance = core.Sailing.instanceAboard(owner.p);
  ticks(2);
  assert.equal(common.crewAboard(instance).length, 1, 'actual boarding hooks spawned the hired crew');
  const member = common.crewAboard(instance)[0].npc;
  const deck = core.BoatManager.getDeck(instance);
  deck.enter(guest.p); guest.p.setLocation(owner.p.getLocation().clone());
  guest.p.getSailing().returnPoint = { x: 3222, y: 3218, z: 0 };
  instance.helmPlayerId = owner.p.getIndex();
  assert.equal(core.Sailing.removeOwnedBoat(owner.p, owned), true);
  assert.equal(core.BoatManager.getBoat(instance.entityIndex), undefined);
  assert.equal(common.crewAboard(instance).length, 0);
  assert.ok(!member.isRegistered() || core.World.getRemoveNPCQueue().includes(member), 'crew follows the real deregistration path');
  assert.deepEqual(common.state(owner.p).recruited, [crewmate.id], 'destroying a boat does not fire hired crew');
  assert.equal(JSON.stringify(common.state(guest.p)), guestCrew, 'owner cleanup never writes the guest crew state');
  assert.equal(owner.p.getPacketSender().getVarbit(common.VARBIT.SIDEPANEL_SLOT0), 0);
  assert.equal(owner.p.getArea(), null); assert.equal(guest.p.getArea(), null);
  assert.deepEqual(guest.p.getSailing().boats, [kept]);
  assert.deepEqual([guest.p.getLocation().getX(), guest.p.getLocation().getY()], [3222, 3218]);
});
test('native courier delivery uses its originating boat after destruction and same-slot replacement', async t => {
  const cargo = require('../plugins/skills/sailing/Cargo.Sailing');
  const ports = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
  const crew = require('../plugins/skills/sailing/crew/Common.Crew');
  const task = ports.taskById(32);
  for (const destroy of [false, true]) {
    const f = destroyFixture(t, core.NpcIdentifiers.SHIPWRIGHT_SENNIA);
    const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'pandemonium');
    quest.setStage(f.p, 50);
    const member = crew.all().find(entry => entry.name === 'Cabin Boy Jenkins');
    crew.update(f.p, state => { state.recruited = [member.id]; state.slots[0] = member.id; });
    const original = core.Sailing.giveBoat(f.p, 'skiff', 'the_pandemonium');
    // Valid arrival fixtures: one player-carried crate and two still recorded in the hold.
    ports.setSlots(f.p, [{ id: task.id, taken: 3, delivered: 0 }, null, null, null, null]);
    assert.equal(cargo.store(original, task.crate, 2), 2);
    ports.carry(f.p, task.crate, 0);
    assert.equal(core.Sailing.board(f.p, 'the_pandemonium'), null); ticks(2);
    assert.equal(core.Sailing.disembark(f.p, 'the_pandemonium'), null); ticks(2);
    assert.equal(ports.crewCargo(f.p)[0]?.amount, 2, 'real delayed disembark producer created the delivery job');
    let replacement;
    if (destroy) {
      assert.equal(core.Sailing.removeOwnedBoat(f.p, original), true);
      replacement = core.Sailing.giveBoat(f.p, 'skiff', 'the_pandemonium');
      assert.equal(replacement.slot, original.slot);
      // Data-layer matching-cargo control, not a claim of a live acquisition/UI exploit.
      assert.equal(cargo.store(replacement, task.crate, 2), 2);
    }
    const ledgerId = core.CacheDefinitions.getLocId('dock_loading_bay_ledger_table_pandemonium');
    const at = new core.Location(3061, 2985);
    const ledger = core.MapObjects.getPrivateArea(f.p, ledgerId, at);
    assert.ok(ledger, 'actual quest-installed native ledger');
    const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => at.transform(x, y))
      .find(tile => !core.RegionManager.blocked(tile, null));
    assert.ok(adjacent); f.p.setLocation(adjacent); f.p.closeInterruptibleInterfaces(); f.p.setNeedsPlacement(false);
    const clickType = core.ObjectDefinition.forPlayer(ledgerId, f.p).getActions().indexOf('Deposit-cargo') + 1;
    assert.ok(clickType > 0);
    await f.native({ type: 'object_option', id: ledgerId, x: at.getX(), y: at.getY(), clickType });
    core.TaskManager.processWalkTo(f.p.getIndex()); ticks(2);
    assert.equal(cargo.countIn(original, task.crate), 0, destroy ? 'removed origin stays empty' : 'ordinary delivery deducts the original hold');
    if (replacement) assert.equal(cargo.countIn(replacement, task.crate), 2, 'same-slot replacement cargo belongs to the new boat');
    assert.equal(ports.crewCargo(f.p)[0], null);
    assert.equal(ports.slots(f.p)[0], null, 'existing physically carried delivery still completes');
  }
});
test('Seb Repair-boat quotes and atomically charges/heals the actual visited boat', t => {
  const f = fixture(t);
  assert.equal(f.click('Repair-boat'), true, 'native Seb repair option must be handled');
  const menu = prompt(f.p);
  assert.match(menu.title, /500 coins/);
  assert.deepEqual(menu.options, ['Yes.', "Yes, and don't ask again.", 'No.']);
  choose(f.p, 1);
  assert.equal(f.boat.damage, 0);
  assert.equal(f.p.getInventory().getAmount(f.coins), 500);
  assert.equal(f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('sailing_boat_1_stored_hp')), hp.maxHitpoints(f.boat));
});
test('boundary: canonical Talk-to repair choice reaches the same quote and No preserves funds/boat', t => {
  const f = fixture(t); f.click('Talk-to');
  const menu = prompt(f.p);
  const repairIndex = menu.options.indexOf('Could you help me repair my boat?');
  assert.ok(repairIndex >= 0);
  assert.ok(menu.options.includes('What do you have for sale?'));
  choose(f.p, repairIndex + 1); assert.match(prompt(f.p).title, /500 coins/);
  choose(f.p, 3);
  assert.equal(f.boat.damage, 10); assert.equal(f.p.getInventory().getAmount(f.coins), 1000);
});
test('boundary: whole bank payment follows a real transfer, and insufficient sources are not combined', t => {
  const f = fixture(t), bank = bankCoins(f, 600);
  f.click('Repair-boat'); prompt(f.p); choose(f.p, 1);
  assert.equal(f.boat.damage, 0); assert.equal(bank.getAmount(f.coins), 100);
  assert.equal(f.p.getInventory().getAmount(f.coins), 400);
  const g = fixture(t), otherBank = bankCoins(g, 200);
  g.p.getInventory().deleteNumber(g.coins, 400);
  g.click('Repair-boat'); prompt(g.p); choose(g.p, 1);
  assert.equal(g.boat.damage, 10); assert.equal(g.p.getInventory().getAmount(g.coins), 400);
  assert.equal(otherBank.getAmount(g.coins), 200);
});
test('boundary: changed damage, a real replacement visit, teleport and death invalidate the quoted repair', t => {
  for (const transition of ['damage', 'visit', 'teleport', 'death']) {
    const f = fixture(t); f.click('Repair-boat'); prompt(f.p);
    let other;
    if (transition === 'damage') hp.damage(f.p, f.boat, 1);
    if (transition === 'visit') {
      other = core.Sailing.giveBoat(f.p, 'raft', 'the_pandemonium'); other.damage = 2;
      yard.beginVisit(f.p, core.Sailing.getDock('the_pandemonium'), other.slot); f.p.setNeedsPlacement(false);
    }
    if (transition === 'teleport') f.p.moveTo(new core.Location(3050, 2995, 0));
    if (transition === 'death') f.p.setHitpoints(0);
    const before = f.boat.damage; replay(f.p, 1);
    assert.equal(f.boat.damage, before, transition); assert.equal(f.p.getInventory().getAmount(f.coins), 1000, transition);
    if (other) assert.equal(other.damage, 2);
  }
});
test('boundary: healthy boat is free and a repeated old resume cannot charge twice', t => {
  const f = fixture(t, 0); f.click('Repair-boat');
  assert.match(f.p.getDialogueManager().getCurrent().getText(), /fine and dandy/);
  assert.equal(MultiChatboxPrompt.getPending(f.p), null);
  assert.equal(f.p.getInventory().getAmount(f.coins), 1000);
  const g = fixture(t); g.click('Repair-boat'); prompt(g.p); choose(g.p, 1);
  assert.equal(replay(g.p, 1), false);
  assert.equal(g.boat.damage, 0); assert.equal(g.p.getInventory().getAmount(g.coins), 500);
});
test('boundary: replacing the confirmation with the real bank UI prevents old payment', t => {
  const f = fixture(t); f.click('Repair-boat'); prompt(f.p);
  f.p.getBank(0).open(); assert.equal(replay(f.p, 1), false);
  assert.equal(f.boat.damage, 10); assert.equal(f.p.getInventory().getAmount(f.coins), 1000);
});
test('boundary: actual trade acceptance invalidates the old repair confirmation', t => {
  const f = fixture(t), g = fixture(t);
  f.click('Repair-boat'); prompt(f.p);
  f.p.getTrading().requestTrade(g.p); g.p.getTrading().requestTrade(f.p);
  assert.ok(f.p.busy(), 'real trade starts');
  assert.equal(replay(f.p, 1), false);
  assert.equal(f.boat.damage, 10); assert.equal(f.p.getInventory().getAmount(f.coins), 1000);
  f.p.getTrading().closeTrade();
});
test('boundary: persisted no-warning choice restores its cache flag and still charges the next real repair', t => {
  const f = fixture(t); f.click('Repair-boat'); prompt(f.p); choose(f.p, 2);
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const save = PlayerSave.fromPlayer(f.p), { p } = freshPlayer(t); save.applyToPlayer(p);
  PM.emitPlayerLogin({player:p,username:p.getUsername(),isNewAccount:false});
  const warning = core.CacheDefinitions.getVarbitId('boat_repair_cost_warning_dismissed');
  assert.equal(p.getPacketSender().getVarbit(warning), 1);
  yard.beginVisit(p, core.Sailing.getDock('the_pandemonium'), 0); p.setNeedsPlacement(false);
  const boat = yard.visitedBoat(p); hp.damage(p, boat, 4);
  assert.equal(PM.emitNpcInteraction({player:p,npc:f.npc,npcId:f.npc.getId(),definition:f.npc.getCurrentDefinition(p),option:'Repair-boat',clickType:4,handled:false}),true);
  assert.equal(boat.damage, 0); assert.equal(p.getInventory().getAmount(f.coins), 300);
  assert.equal(MultiChatboxPrompt.getPending(p), null);
});
test('boundary: real PIN entry resumes one repair, and a replaced visit while PIN waits stays untouched', t => {
  const Pin = require('../plugins/interface/bankpin/Common.BankPin');
  for (const replace of [false, true]) {
    const f = fixture(t), bank = bankCoins(f, 1000);
    Pin.set(f.p, 'hash', Pin.hash(f.p, '2468')); Pin.lock(f.p);
    f.click('Repair-boat'); prompt(f.p); choose(f.p, 1);
    assert.equal(f.boat.damage, 10); assert.equal(bank.getAmount(f.coins), 1000);
    const entry = f.p.getEnteredAmountAction(); assert.ok(entry, 'actual PIN keypad is waiting');
    if (replace) {
      const other = core.Sailing.giveBoat(f.p, 'raft', 'the_pandemonium');
      yard.beginVisit(f.p, core.Sailing.getDock('the_pandemonium'), other.slot); f.p.setNeedsPlacement(false);
    }
    f.p.setEnteredAmountAction(null); entry.execute(2468); ticks(3);
    assert.equal(f.boat.damage, replace ? 10 : 0);
    assert.equal(bank.getAmount(f.coins), replace ? 1000 : 500);
    assert.equal(f.p.getInventory().getAmount(f.coins), 0);
  }
});

test('native destruction preserves required quest cargo until it is returned to its source ledger', async t => {
  const ports = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
  const cargo = require('../plugins/skills/sailing/Cargo.Sailing');
  const facilities = require('../plugins/skills/sailing/BoatFacilities.Sailing');
  const ledger = require('../plugins/skills/sailing/porttasks/Ledger.PortTasks');
  const jimId = core.CacheDefinitions.getNpcId('junior_jim');
  const f = destroyFixture(t, jimId), p = f.p;
  const jimApproach = p.getLocation().clone();
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(entry => entry.key === 'pandemonium');
  p.setAttribute('pandemonium:stage-version', 2); quest.setStage(p, 38);
  const task = ports.taskById(599);
  ports.setSlots(p, [{id:599,taken:0,delivered:0}]);
  const owned=core.Sailing.giveBoat(p,'raft','port_sarim');
  const facility=facilities.facilityNamed('Cargo hold');
  const hot=facilities.hotspotsOf('raft').find(h=>h.allowed.includes(facility));
  assert.ok(hot); facilities.setFacility(owned,hot.id,facility);
  core.RegionManager.loadMapFiles(3028,3194); p.setLocation(new core.Location(3028,3193)); p.setNeedsPlacement(false);
  const sourceId=core.CacheDefinitions.getLocId('dock_loading_bay_ledger_table_port_sarim');
  await f.native({type:'object_option',id:sourceId,x:3028,y:3194,clickType:1});
  core.TaskManager.processWalkTo(p.getIndex()); ticks(2);
  assert.equal(ports.heldCrate(p),task.crate,'native source ledger supplies the actual quest cargo');
  p.closeInterruptibleInterfaces(); assert.equal(core.Sailing.board(p,'port_sarim'),null); ticks(2);
  const boat=core.Sailing.instanceAboard(p), spec=core.BoatManager.getSpec(boat);
  const loc=spec.locs.find(l=>l.hotspot===hot.id); assert.ok(loc);
  const definition=core.ObjectDefinition.forPlayer(loc.id,p); const clickType=definition.getActions().indexOf('Deposit-held')+1;
  assert.ok(clickType>0);
  const locAt=new core.Location(boat.deckBaseX+loc.x,boat.deckBaseY+loc.y,0);
  const adjacent=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>locAt.transform(x,y)).find(tile=>!core.RegionManager.blocked(tile,p.getPrivateArea()));
  assert.ok(adjacent); p.setLocation(adjacent);p.setNeedsPlacement(false);
  await f.native({type:'object_option',id:loc.id,x:locAt.getX(),y:locAt.getY(),clickType});
  core.TaskManager.processWalkTo(p.getIndex());ticks(2);
  assert.equal(ports.heldCrate(p),undefined);assert.equal(cargo.countIn(owned,task.crate),1,'native Deposit-held puts the collected crate in the actual raft');
  // Arrival fixture after the normal sailing leg; this probe does not claim an end-to-end voyage.
  assert.equal(core.Sailing.disembark(p,'the_pandemonium'),null);ticks(2);
  assert.equal(quest.getStage(p),42);p.setLocation(jimApproach);p.setNeedsPlacement(false);
  await openDestroy(f);await chooseDestroyedBoat(f,owned);await destroyChoice(f);await destroySelect(f,1);
  assert.deepEqual(p.getSailing().boats, [owned], 'required cargo prevents destruction');
  assert.equal(cargo.countIn(owned, task.crate), 1);
  assert.deepEqual(ports.slots(p)[0], { id: 599, taken: 1, delivered: 0 });
  assert.doesNotMatch(p.getDialogueManager().getCurrent()?.getText?.() ?? '', /broken up into\s+scrap/);
  assert.equal(require('../plugins/skills/sailing/porttasks/PortMaster.PortTasks').cancel(p, 0), false);

  // Recover through the native hold, then the source ledger; no replacement crate is invented.
  p.closeInterruptibleInterfaces();
  assert.equal(core.Sailing.board(p, 'the_pandemonium'), null); ticks(2);
  const recoveredBoat = core.Sailing.instanceAboard(p);
  const recoveredSpec = core.BoatManager.getSpec(recoveredBoat);
  const recoveredLoc = recoveredSpec.locs.find(entry => entry.hotspot === hot.id);
  const holdAt = new core.Location(recoveredBoat.deckBaseX + recoveredLoc.x, recoveredBoat.deckBaseY + recoveredLoc.y, 0);
  const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => holdAt.transform(x, y))
    .find(tile => !core.RegionManager.blocked(tile, p.getPrivateArea()));
  assert.ok(beside); p.setLocation(beside); p.setNeedsPlacement(false);
  const open = core.ObjectDefinition.forPlayer(recoveredLoc.id, p).getActions().indexOf('Open') + 1;
  assert.ok(open > 0);
  await f.native({ type: 'object_option', id: recoveredLoc.id, x: holdAt.getX(), y: holdAt.getY(), clickType: open });
  core.TaskManager.processWalkTo(p.getIndex()); ticks(2);
  assert.equal(p.getInterfaceId(), 943);
  const slot = owned.cargo.findIndex(item => item?.id === task.crate);
  await f.native({ type: 'widget_action', widgetId: (943 << 16) | 10, groupId: 943, childId: 10,
    buttonNum: 1, slot, itemId: task.crate });
  assert.equal(ports.heldCrate(p), task.crate);
  assert.equal(cargo.countIn(owned, task.crate), 0);
  assert.equal(core.Sailing.disembark(p, 'port_sarim'), null); ticks(2);
  p.closeInterruptibleInterfaces(); p.setLocation(new core.Location(3028, 3193)); p.setNeedsPlacement(false);
  const deposit = core.ObjectDefinition.forPlayer(sourceId, p).getActions().indexOf('Deposit-cargo') + 1;
  assert.ok(deposit > 0);
  await f.native({ type: 'object_option', id: sourceId, x: 3028, y: 3194, clickType: deposit });
  core.TaskManager.processWalkTo(p.getIndex()); ticks(2);
  assert.equal(ports.heldCrate(p), undefined);
  assert.deepEqual(ports.slots(p)[0], { id: 599, taken: 0, delivered: 0 });
  assert.equal(quest.getStage(p), 42, 'return is no delivery or quest progress');
  assert.ok(ledger.collectable(p, 'port_sarim').some(([index]) => index === 0));
  p.closeInterruptibleInterfaces(); p.setLocation(jimApproach); p.setNeedsPlacement(false);
  await openDestroy(f); await chooseDestroyedBoat(f, owned); await destroyChoice(f); await destroySelect(f, 1);
  assert.equal(p.getSailing().boats.length, 0, 'empty boat remains destructible');
});
