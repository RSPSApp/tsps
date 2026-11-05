const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, common, master, ledger;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3061, 2985);
  PM.emitServerStartup({});
  common = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
  master = require('../plugins/skills/sailing/porttasks/PortMaster.PortTasks');
  ledger = require('../plugins/skills/sailing/porttasks/Ledger.PortTasks');
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 1500;
function lifecycle(p) { return { player: p, username: p.getUsername(), isNewAccount: false }; }
function player(t) {
  const p = new Player(null);
  p.setIndex(nextIndex++);
  p.setUsername(`cargoqa${nextIndex}`);
  p.setLocation(new core.Location(3061, 2985, 0));
  p.messages = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() { return true; }, write() { return true; } }));
  t.mock.method(p, 'sendMessage', (m) => p.messages.push(m));
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.mock.method(p.getEquipment(), 'refreshItems', () => p.getEquipment());
  p.setRegistered(true);
  p.setHitpoints(10);
  t.after(() => { PM.emitPlayerLogout(lifecycle(p)); p.setRegistered(false); });
  return p;
}
function carry(p, index = 0, task = common.taskById(20)) {
  const slots = common.slots(p);
  slots[index] = { id: task.id, taken: 1, delivered: 0 };
  common.setSlots(p, slots);
  common.carry(p, task.crate, index);
  return task;
}
function ticks(n) { for (let i = 0; i < n; i++) core.TaskManager.process(); }
function objectOption(p, object, option) {
  p.getPacketSender().sendInterfaceRemoval();
  p.needsPlacement = false;
  const at = object.getLocation();
  const clientId = core.ObjectDefinition.forPlayer(object.getId(), p).id;
  new ObjectActionPacketListener().executeAction(p, clientId, at.getX(), at.getY(), 0, option);
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(p.getIndex());
    p.getMovementQueue().process();
    core.TaskManager.process();
  }
}
function outside(p) { p.moveTo(new core.Location(3222, 3218, 0)); }
function sarimLedger(p) {
  core.RegionManager.loadMapFiles(3028, 3194);
  p.moveTo(new core.Location(3028, 3193, 0)); // The cache table's accessible south side.
  const object = core.ObjectManager.objectsAt(new core.Location(3028, 3194, 0)).find(object => object.getType() === 10);
  assert.ok(object);
  return object;
}
const warning = "You're leaving port with some cargo. If you do not return it, it will be confiscated by the shipwright wizard's autonomous tracking unit.";
const confiscated = 'Your cargo has been confiscated by the S.W.A.T. team.';

test('committed teleport confiscates only hand cargo and makes one crate collectable again', (t) => {
  const p = player(t); const task = carry(p, 0, common.DATA.tasks.find((task) => task.type === 'courier' && task.amount >= 4));
  const held = common.slots(p); held[0].taken = 3; common.setSlots(p, held);
  common.setCrewCargo(p, 0, { crate: task.crate, amount: 1 });
  p.getSailing().boats.push({ slot: 0, cargo: [{ id: task.crate, amount: 2 }] });
  PM.emitCustomEvent('teleport:landed', { player: p, from: p.getLocation(), to: new core.Location(3222, 3218, 0) });
  assert.equal(common.heldCrate(p), undefined);
  assert.equal(common.slots(p)[0].taken, 2);
  assert.equal(common.crewAmount(p, 0), 1);
  assert.equal(p.getSailing().boats[0].cargo[0].amount, 2);
  assert.deepEqual(p.messages, [confiscated]);
  assert.ok(ledger.collectable(p, task.cargoPort).some(([index]) => index === 0));
  PM.emitCustomEvent('teleport:landed', { player: p });
  assert.equal(common.slots(p)[0].taken, 2, 'a second landing event cannot remove another crate');
});

test('teleport requirements probe does not confiscate cargo', (t) => {
  const p = player(t); const task = carry(p);
  core.TeleportHandler.checkReqs(p, new core.Location(3222, 3218, 0));
  assert.equal(common.heldCrate(p), task.crate);
  assert.equal(common.slots(p)[0].taken, 1);
});

test('leaving port warns once, keeps crate for 21 ticks, confiscates 22 ticks after warning', (t) => {
  const p = player(t); carry(p); outside(p); ticks(1);
  assert.deepEqual(p.messages, [warning]);
  core.TaskManager.cancelTasks(p.getIndex()); // Ordinary walk/action cancellation uses the player's numeric index.
  ticks(21); assert.notEqual(common.heldCrate(p), undefined);
  ticks(1); assert.equal(common.heldCrate(p), undefined);
  assert.deepEqual(p.messages, [warning, confiscated]);
  ticks(30); assert.equal(common.slots(p)[0].taken, 0);
});

test('real ledger map object can collect a confiscated crate again through the dispatcher', (t) => {
  const p = player(t); const task = common.taskById(20);
  common.setSlots(p, [{ id: task.id, taken: 0, delivered: 0 }]);
  const id = core.CacheDefinitions.getLocId('dock_loading_bay_ledger_table_pandemonium');
  const at = new core.Location(3061, 2985, 0);
  const object = core.ObjectManager.objectsAt(at).find((object) => object.getType() === 10);
  assert.ok(object, 'the ledger is loaded from the active map');
  assert.equal(object.getId(), id, 'the actual startup overlay must preserve the cache multiloc');
  function collect() {
    objectOption(p, object, 'Take-cargo');
  }
  collect(); assert.equal(common.heldCrate(p), task.crate);
  PM.emitCustomEvent('teleport:landed', { player: p });
  collect(); assert.equal(common.heldCrate(p), task.crate);
  assert.equal(common.slots(p)[0].taken, 1);
});

test('quest startup installs both ledger multilocs so native actions follow actual carrying state', (t) => {
  const p = player(t);
  for (const [name, x, y] of [['port_sarim', 3028, 3194], ['pandemonium', 3061, 2985]]) {
    const id = core.CacheDefinitions.getLocId(`dock_loading_bay_ledger_table_${name}`);
    const object = core.ObjectManager.objectsAt(new core.Location(x, y, 0)).find((object) => object.getType() === 10);
    assert.ok(object, `${name} has its startup fallback ledger`);
    assert.equal(object.getId(), id, `${name} uses its active cache multiloc, not a fixed action variant`);
    assert.ok(core.ObjectDefinition.forPlayer(id, p).getInteractions().includes('Take-cargo'));
    carry(p);
    assert.ok(core.ObjectDefinition.forPlayer(id, p).getInteractions().includes('Deposit-cargo'));
    common.putDown(p);
  }
});

test('Pandemonium source ledger returns the actual hand crate without a local boat, reward or progression', t => {
  const p = player(t), table = sarimLedger(p);
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(quest => quest.key === 'pandemonium');
  p.setAttribute('pandemonium:stage-version', 2);
  quest.setStage(p, 38);
  const task = common.taskById(599);
  common.setSlots(p, [null, null, { id: task.id, taken: 0, delivered: 0 }]);
  const points = p.getAttribute('quest.points'), xp = p.getSkillManager().getExperience(core.Skill.SAILING);
  assert.equal(p.getSailing().boats.length, 0);
  objectOption(p, table, 'Take-cargo');
  assert.equal(common.heldCrate(p), task.crate, 'real Sarim multiloc pickup reaches the shared cargo owner');
  assert.equal(p.getAttribute(common.CARRIED_SLOT_ATTRIBUTE), 2);
  assert.equal(p.getInventory().getAmount(task.crate), 0);
  objectOption(p, table, 'Deposit-cargo');
  assert.equal(common.heldCrate(p), undefined, 'the source table is a safe place to set down the crate');
  assert.deepEqual(common.slots(p)[2], { id: task.id, taken: 0, delivered: 0 });
  assert.equal(p.getAttribute(common.CARRIED_SLOT_ATTRIBUTE), -1);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.CARRYING_CARGO), 0);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.LAST_CARGO_TAKEN), 0);
  objectOption(p, table, 'Deposit-cargo');
  assert.deepEqual(common.slots(p)[2], { id: task.id, taken: 0, delivered: 0 }, 'a repeated deposit cannot decrement twice');
  assert.equal(quest.getStage(p), 38);
  assert.equal(p.getAttribute('quest.points'), points);
  assert.equal(p.getSkillManager().getExperience(core.Skill.SAILING), xp);
  objectOption(p, table, 'Take-cargo');
  assert.equal(common.heldCrate(p), task.crate, 'the returned quest cargo is collectable again');
  assert.equal(common.slots(p)[2].taken, 1);
});

test('source return preserves other task slots and cargo in the crew and hold', t => {
  const p = player(t), table = sarimLedger(p);
  const task = common.DATA.tasks.find(task => task.type === 'courier' && task.cargoPort === 'port_sarim' && task.amount >= 3);
  assert.ok(task);
  const other = { id: 599, taken: 1, delivered: 0 };
  common.setSlots(p, [other, { id: task.id, taken: 2, delivered: 0 }]);
  common.setCrewCargo(p, 1, { crate: task.crate, amount: 1, boatSlot: 0 });
  const hold = [{ id: task.crate, amount: 1 }];
  p.getSailing().boats.push({ slot: 0, cargo: hold });
  common.carry(p, task.crate, 1);
  objectOption(p, table, 'Deposit-cargo');
  assert.equal(common.heldCrate(p), undefined);
  assert.deepEqual(common.slots(p)[0], other);
  assert.deepEqual(common.slots(p)[1], { id: task.id, taken: 1, delivered: 0 });
  assert.deepEqual(common.crewCargo(p)[1], { crate: task.crate, amount: 1, boatSlot: 0 });
  assert.deepEqual(p.getSailing().boats[0].cargo, hold);
});

test('a wrong port cannot accept a crate as a source return or delivery', t => {
  const p = player(t), table = sarimLedger(p), task = common.taskById(31);
  assert.notEqual(task.cargoPort, 'port_sarim');
  assert.notEqual(task.destination, 'port_sarim');
  carry(p, 0, task);
  objectOption(p, table, 'Deposit-cargo');
  assert.equal(common.heldCrate(p), task.crate);
  assert.deepEqual(common.slots(p)[0], { id: task.id, taken: 1, delivered: 0 });
  assert.equal(p.messages.at(-1), "This cargo isn't for delivery here.");
});

test('source return requires the exact carried slot to own an outstanding crate', async t => {
  for (const state of ['missing-slot', 'foreign-slot', 'already-delivered']) await t.test(state, t => {
    const p = player(t), table = sarimLedger(p), task = common.taskById(599);
    carry(p, 0, task);
    if (state === 'missing-slot') p.setAttribute(common.CARRIED_SLOT_ATTRIBUTE, -1);
    else if (state === 'foreign-slot') {
      common.setSlots(p, [{ id: task.id, taken: 1, delivered: 0 }, { id: 31, taken: 1, delivered: 0 }]);
      p.setAttribute(common.CARRIED_SLOT_ATTRIBUTE, 1);
    } else common.setSlots(p, [{ id: task.id, taken: 1, delivered: 1 }]);
    const before = JSON.stringify(common.slots(p));
    objectOption(p, table, 'Deposit-cargo');
    assert.equal(common.heldCrate(p), task.crate);
    assert.equal(JSON.stringify(common.slots(p)), before);
  });
});

for (const [name, taskId, stage, nextStage] of [['Pandemonium', 599, 42, 44], ['Prying Times', 600, 5, 10]]) {
  test(`${name} advances its real courier hand-in through the startup ledger multiloc`, (t) => {
    const p = player(t);
    const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
    const quest = quests.find((quest) => quest.name === name);
    assert.ok(quest);
    quest.setStage(p, stage); // Controlled quest prerequisite fixture; the delivery itself is native.
    if (taskId === 600) {
      // Steve's accepted-task state; the existing completion guard distinguishes delivery from cancellation.
      p.setAttribute('prying-times:delivery-assigned', true);
      p.setAttribute('prying-times:delivery-baseline', p.getAttribute(common.COMPLETED_ATTRIBUTE)?.total ?? 0);
    }
    const task = common.taskById(taskId);
    carry(p, 0, task);
    const object = core.ObjectManager.objectsAt(new core.Location(3061, 2985, 0)).find((object) => object.getType() === 10);
    objectOption(p, object, 'Deposit-cargo');
    assert.equal(common.slots(p)[0], null, 'the shared courier owner completed the actual hand-in');
    assert.equal(quest.getStage(p), nextStage, 'the quest observed the resolved ledger action');
  });
}

test('returning to port resets the grace period; a new departure starts a fresh 22 ticks', (t) => {
  const p = player(t); carry(p); outside(p); ticks(10);
  p.moveTo(new core.Location(3061, 2985, 0)); ticks(30);
  assert.notEqual(common.heldCrate(p), undefined);
  outside(p); ticks(1); ticks(21);
  assert.notEqual(common.heldCrate(p), undefined);
  ticks(1); assert.equal(common.heldCrate(p), undefined);
  assert.equal(p.messages.filter((m) => m === warning).length, 2);
});

test('cancellation/replacement cannot let the old watcher confiscate a later crate', (t) => {
  const p = player(t); carry(p); outside(p); ticks(15);
  master.cancel(p, 0);
  p.moveTo(new core.Location(3061, 2985, 0)); carry(p); ticks(30);
  assert.notEqual(common.heldCrate(p), undefined);
  assert.equal(common.slots(p)[0].taken, 1);
  assert.equal(p.messages.includes(confiscated), false);
});

test('actual equipment rules reject manual removal and weapon/shield replacement', (t) => {
  const p = player(t); const task = carry(p);
  assert.equal(core.EquipPacketListener.unequip(p, core.Equipment.WEAPON_SLOT), false);
  assert.equal(common.heldCrate(p), task.crate);
  assert.equal(PM.emitCanEquip(p, core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.BRONZE_SWORD, 1)), false);
  assert.equal(PM.emitCanEquip(p, core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.WOODEN_SHIELD, 1)), false);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.BRONZE_SWORD, 1));
  const slot = p.getInventory().getSlotForItemId(core.ItemIdentifiers.BRONZE_SWORD);
  core.EquipPacketListener.equip(p, core.ItemIdentifiers.BRONZE_SWORD, slot, core.Inventory.INTERFACE_ID);
  assert.equal(common.heldCrate(p), task.crate);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BRONZE_SWORD), 1);
});

test('native equipment Remove preserves cargo and sends its recorded removal refusal', async (t) => {
  const p = player(t); const task = carry(p);
  const channel = { isOpen: () => true, send: () => true, onData() {}, onError() {}, onClose() {}, close() {} };
  const connection = new ClientConnection(channel); connection.player = p;
  const widgetId = core.CacheDefinitions.getComponentId('wornitems:slot3');
  await connection.dispatch([{ type: 'widget_action', widgetId, groupId: 387, childId: 18,
    buttonNum: 1, option: 'Remove', slot: 3, itemId: task.crate }]);
  connection.processTurnPackets();
  assert.equal(common.heldCrate(p), task.crate);
  assert.equal(p.messages.at(-1), "You can't remove the cargo. You'll need to find a safe place to put it down first.");
});

test('hands policy checks actual player equipment, not crew/hold cargo', (t) => {
  const p = player(t); const task = carry(p);
  const request = { player: p, allow: null };
  PM.emitCustomEvent('sailing:can-use-hands', request);
  assert.equal(request.allow, false);
  common.putDown(p);
  common.setCrewCargo(p, 0, { crate: task.crate, amount: 2 });
  const free = { player: p, allow: null };
  PM.emitCustomEvent('sailing:can-use-hands', free);
  assert.notEqual(free.allow, false);
});

test('logout suspends watcher and login restores crate state and outside grace period', (t) => {
  const p = player(t); const task = carry(p); outside(p); ticks(15);
  PM.emitPlayerLogout(lifecycle(p)); ticks(30);
  assert.equal(common.heldCrate(p), task.crate);
  PM.emitPlayerLogin(lifecycle(p)); ticks(1); ticks(21);
  assert.equal(common.heldCrate(p), task.crate);
  ticks(1); assert.equal(common.heldCrate(p), undefined);
});

test('shared teleport task reaches the committed hook, preserves a failed probe and resets cargo varbits', (t) => {
  const p = player(t); carry(p);
  core.TeleportHandler.teleport(p, new core.Location(3222, 3218, 0), core.TeleportType.NORMAL, false);
  assert.notEqual(common.heldCrate(p), undefined, 'casting has not landed');
  ticks(8);
  assert.equal(p.getLocation().getX(), 3222);
  assert.equal(common.heldCrate(p), undefined);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.CARRYING_CARGO), 0);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.LAST_CARGO_TAKEN), 0);
});

test('save/load retains hand cargo owner and login rebuilds the two client varbits', (t) => {
  const p = player(t); const task = carry(p, 2);
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const saved = PlayerSave.fromPlayer(p);
  assert.equal(saved.attributes[common.CARRIED_SLOT_ATTRIBUTE], 2);
  const q = player(t); saved.applyToPlayer(q);
  PM.emitPlayerLogin(lifecycle(q));
  assert.equal(common.heldCrate(q), task.crate);
  assert.equal(q.getPacketSender().getVarbit(common.VARBIT.CARRYING_CARGO), 1);
  assert.equal(q.getPacketSender().getVarbit(common.VARBIT.LAST_CARGO_TAKEN), 3);
  PM.emitCustomEvent('teleport:landed', { player: q });
  assert.equal(common.slots(q)[2].taken, 0);
});

test('actual dangerous death clears physical cargo indicators and owner after equipment loss', (t) => {
  const p = player(t); carry(p, 2); p.setHitpoints(0);
  ticks(5); // setHitpoints(0) queues the real PlayerDeathTask itself.
  assert.equal(common.heldCrate(p), undefined);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.CARRYING_CARGO), 0);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.LAST_CARGO_TAKEN), 0);
  assert.equal(p.getAttribute(common.CARRIED_SLOT_ATTRIBUTE), -1);
  assert.equal(common.slots(p)[2].taken, 1, 'death-drop ownership policy is unchanged');
});

test('death cleanup preserves unrelated equipment installed after the shared item-loss transition', (t) => {
  const p = player(t); carry(p, 2);
  const sword = new core.Item(core.ItemIdentifiers.BRONZE_SWORD, 1);
  PM.createApi('CargoDeathTransitionTest').onPlayerDefeated(({ victim }) => {
    if (victim === p) victim.getEquipment().setItem(core.Equipment.WEAPON_SLOT, sword);
  });
  p.setHitpoints(0);
  ticks(5);
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT], sword);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.CARRYING_CARGO), 0);
  assert.equal(p.getAttribute(common.CARRIED_SLOT_ATTRIBUTE), -1);
});

test('real Ferox safe death retains physical cargo, owner, restrictions and outside watcher', (t) => {
  const p = player(t); const task = carry(p, 2);
  p.moveTo(new core.Location(3327, 4770, 0)); p.setHitpoints(0);
  ticks(5);
  assert.equal(common.heldCrate(p), task.crate);
  assert.equal(p.getAttribute(common.CARRIED_SLOT_ATTRIBUTE), 2);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.CARRYING_CARGO), 1);
  assert.equal(p.getPacketSender().getVarbit(common.VARBIT.LAST_CARGO_TAKEN), 3);
  const hands = { player: p, allow: null }; PM.emitCustomEvent('sailing:can-use-hands', hands);
  assert.equal(hands.allow, false);
  ticks(25);
  assert.equal(common.heldCrate(p), undefined, 'the retained carrier still has an active outside watcher');
});

test('active cache confirms carrying varbits and crate weapon identity', () => {
  const crate = common.taskById(20).crate;
  assert.equal(core.CacheDefinitions.getObjId('cargo_crate_jewellery_port_sarim'), crate);
  assert.equal(core.CacheDefinitions.getVarbitId('sailing_carrying_cargo'), common.VARBIT.CARRYING_CARGO);
  assert.equal(core.CacheDefinitions.getVarbitId('port_task_last_cargo_taken'), common.VARBIT.LAST_CARGO_TAKEN);
});

test('real boat Helm Navigate and Sails Trim reject the clicking player carrying cargo', (t) => {
  const p = player(t);
  core.Sailing.giveBoat(p, 'raft', 'the_pandemonium');
  assert.equal(core.Sailing.board(p, 'the_pandemonium'), null);
  const boat = core.Sailing.instanceAboard(p);
  t.after(() => core.Sailing.onLogout(p));
  const deck = core.BoatManager.getDeck(boat);
  carry(p);
  for (const [name, option] of [['Helm', 'Navigate'], ['Sails', 'Trim']]) {
    const object = deck.getObjects().find((object) => {
      const definition = core.ObjectDefinition.forPlayer(object.getId(), p);
      return definition?.getName() === name && definition.getInteractions().includes(option);
    });
    assert.ok(object, `${name} is a real object on the deck`);
    objectOption(p, object, option);
    assert.equal(p.messages.at(-1), "You can't do that while you're holding cargo in your hands.");
    assert.equal(boat.helmPlayerId, undefined);
  }
  ticks(30);
  assert.notEqual(common.heldCrate(p), undefined, 'the boat deck is safe for hand cargo');
});
for (const route of ['bank', 'deposit-box']) {
  test(`native ${route} Deposit worn cannot bank ledger cargo and still deposits ordinary equipment`, async t => {
    const p = player(t), task = common.taskById(20);
    common.setSlots(p, [{ id: task.id, taken: 0, delivered: 0 }]);
    const object = core.ObjectManager.objectsAt(new core.Location(3061, 2985, 0)).find(object => object.getType() === 10);
    assert.ok(object);objectOption(p, object, 'Take-cargo');
    assert.equal(common.heldCrate(p), task.crate, 'crate produced by native ledger interaction');
    const helmet = core.ItemIdentifiers.IRON_FULL_HELM;
    p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(helmet));
    p.getPacketSender().sendInterfaceRemoval();
    if (route === 'bank') p.getBank(0).open();
    else PM.emitCustomEvent('bank:open-deposit-box', { player: p });
    const widgetId = core.CacheDefinitions.getComponentId(route === 'bank' ? 'bankmain:depositworn' : 'bank_depositbox:deposit_worn');
    assert.ok(widgetId > 0);
    const channel = { isOpen: () => true, send: () => true, onData() {}, onError() {}, onClose() {}, close() {} };
    const connection = new ClientConnection(channel); connection.player = p;
    await connection.dispatch([{ type: 'widget_action', widgetId, groupId: widgetId >>> 16, childId: widgetId & 65535,
      buttonNum: 1, slot: -1, itemId: -1 }]);connection.processTurnPackets();
    assert.equal(p.getBank(0).getAmount(task.crate), 0);
    assert.equal(common.heldCrate(p), task.crate);assert.equal(common.slots(p)[0].taken, 1);
    assert.equal(p.getAttribute(common.CARRIED_SLOT_ATTRIBUTE), 0);
    assert.equal(p.getPacketSender().getVarbit(common.VARBIT.CARRYING_CARGO), 1);
    assert.equal(p.getBank(0).getAmount(helmet), 1, 'ordinary equipment remains bankable');
    assert.ok(p.messages.includes("You can't remove the cargo. You'll need to find a safe place to put it down first."));
    p.getPacketSender().sendInterfaceRemoval();outside(p);ticks(25);
    assert.equal(common.heldCrate(p), undefined);assert.equal(common.slots(p)[0].taken, 0);
    assert.equal(p.getBank(0).getAmount(task.crate), 0);
  });
}
