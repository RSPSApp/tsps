// Native PlayerDeathTask and Mimic plugin callbacks, with world/sender/dispatcher adapters.
const previousBotsSetting = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const { Location } = require('../dist/game/model/Location');
const { SkullType } = require('../dist/game/model/SkullType');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const { GameConstants } = require('../dist/game/GameConstants');
const { NullPlayerPersistence } = require('../dist/game/entity/impl/player/persistence/NullPlayerPersistence');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const core = PluginManager.getCoreApi();

after(() => {
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

test('Mimic death uses its casket retrieval and stored payment, with a real loss producer', t => {
  const hooks = { drops: [], custom: new Map(), objects: new Map(), buttons: new Map(), keep: [], dropPolicy: [], logout: [] };
  let dropDispatches = 0, grave = null;
  const scheduled = [], players = [], spawned = [], errors = [], grounds = [];
  const original = new Map(['emitPlayerDeathDrops', 'emitShouldKeepItemOnDeath', 'emitShouldDropItemsOnDeath', 'emitPlayerDeath', 'emitPlayerDefeated'].map(k => [k, PluginManager[k]]));
  const submit = core.TaskManager.submit, ground = ItemOnGroundManager.registerLocation, error = console.error;
  const savedKeys = new Set(PlayerSave.persistentAttributeKeys), savedDefaults = new Map(PlayerSave.attributeDefaults);
  t.after(() => {
    try {
      for (const player of players) {
        const area = player.getArea();
        if (area && area.hasMember(player)) area.leave(player, false);
        for (const logout of hooks.logout) logout({ player });
        grave?.despawn(player);
        GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(player);
        player.getInventory().resetItems(); player.getEquipment().resetItems();
      }
      const queue = core.World.getRemoveNPCQueue();
      for (let i = queue.length - 1; i >= 0; i--) if (spawned.includes(queue[i])) queue.splice(i, 1);
      for (const task of scheduled) task.stop();
      assert.deepEqual(errors, [], 'setup, execution, and cleanup must not hide errors');
    } finally {
      for (const [key, value] of original) PluginManager[key] = value;
      core.TaskManager.submit = submit;
      ItemOnGroundManager.registerLocation = ground;
      console.error = error;
      PlayerSave.persistentAttributeKeys.clear();
      for (const key of savedKeys) PlayerSave.persistentAttributeKeys.add(key);
      PlayerSave.attributeDefaults.clear();
      for (const [key, value] of savedDefaults) PlayerSave.attributeDefaults.set(key, value);
    }
  });
  assert.ok(GameConstants.PLAYER_PERSISTENCE instanceof NullPlayerPersistence);
  assert.equal(core.CacheDefinitions.getLocId('trail_mimic_enabler'), 34733);
  assert.equal(core.CacheDefinitions.getInventoryId('gravestone'), 525);
  assert.equal(core.CacheDefinitions.getComponentId('gravestone_retrieval:items'), (602 << 16) | 3);
  assert.equal(core.CacheDefinitions.getComponentId('gravestone_retrieval:button'), (602 << 16) | 6);
  assert.equal(core.CacheDefinitions.getComponentId('gravestone_retrieval:discard'), (602 << 16) | 10);
  assert.equal(core.CacheDefinitions.getComponentId('gravestone_retrieval:discard_gfx'), (602 << 16) | 11);
  assert.equal(core.CacheDefinitions.getComponentId('gravestone_retrieval:info'), (602 << 16) | 14);
  assert.equal(core.CacheDefinitions.getEnumValues(1753).get(17), 'Things the Mimic rejected');
  assert.equal(core.CacheDefinitions.getEnumValues(1753).get(18), 'Things the Mimic rejected');
  assert.equal(core.CacheDefinitions.getEnumValues(1756).get(17), 995);
  assert.equal(core.CacheDefinitions.getEnumValues(1757).get(17), 90000);
  core.TaskManager.submit = task => scheduled.push(task);
  ItemOnGroundManager.registerLocation = (_owner, item) => { grounds.push(item.clone()); return null; };
  console.error = (...args) => { errors.push(args.map(String)); error(...args); };
  function beginDeath(victim) {
    const offset = scheduled.length;
    victim.setHitpoints(0); // real Player.appendDeath submits exactly one PlayerDeathTask
    assert.equal(victim.getHitpoints(), 0);
    const deaths = scheduled.slice(offset).filter(task => task instanceof PlayerDeathTask);
    assert.equal(deaths.length, 1, 'real zero-HP transition submitted exactly one death task');
    deaths[0].setRunning(true);
    return deaths[0];
  }
  const api = new Proxy({
    core,
    getPluginConfig: (_key, fallback) => fallback,
    persistAttribute: (key, defaultValue) => PlayerSave.persistAttribute(key, defaultValue),
    registerArea() {},
    spawnNpc: ({ id }) => {
      const npc = { hp: 100, getId: () => id, getHitpoints() { return this.hp; }, isRegistered: () => true,
        setArea(area) { this.area = area; }, getArea() { return this.area; },
        setNpcTransformationId() {}, setFlag() {}, getCombat: () => ({ attack() {} }) };
      spawned.push(npc); return npc;
    },
    onPlayerDeathDrops: fn => hooks.drops.push(fn),
    onShouldKeepItemOnDeath: fn => hooks.keep.push(fn),
    onPlayerLogout: fn => hooks.logout.push(fn),
    onShouldDropItemsOnDeath: fn => hooks.dropPolicy.push(fn),
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, payload) { for (const fn of hooks.custom.get(name) ?? []) fn(payload); },
    onObjectInteraction(name, ops) { hooks.objects.set(name, ops); },
    onInterfaceActionButton(id, fn) { const list = hooks.buttons.get(id) ?? []; list.push(fn); hooks.buttons.set(id, list); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  // Same registered callbacks as the plugins; adapter supplies sorted dispatch and no live World.
  require('../plugins/bosses/Mimic.plugin').register(api);
  require('../plugins/items/StorageItems.plugin').register(api);
  const iron = require('../plugins/modes/ironman/Common.Ironman');
  iron.init(api);
  require('../plugins/modes/ironman/Setup.Ironman')(api);
  require('../plugins/modes/ironman/Ultimate.Ironman')(api);
  require('../plugins/world/gravestones/Storage.Gravestones').attach(api);
  require('../plugins/world/gravestones/Events.Gravestones').attach(api);
  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  require('../plugins/world/gravestones/Timer.Gravestones').attach(api);
  grave = require('../plugins/world/gravestones/Grave.Gravestones');
  require('../plugins/areas/ferox/Common.FeroxEnclave').init(api);
  const ffa = require('../plugins/areas/ferox/FreeForAll.FeroxEnclave');
  ffa(api);
  PluginManager.emitPlayerDeathDrops = event => { dropDispatches++; for (const fn of hooks.drops) fn(event); };
  PluginManager.emitShouldDropItemsOnDeath = (player, killer) => {
    const event = { player, killer, shouldDrop: null };
    for (const fn of hooks.dropPolicy) { fn(event); if (event.shouldDrop !== null) break; }
    return event.shouldDrop;
  };
  PluginManager.emitShouldKeepItemOnDeath = (player, item) => {
    const event = { player, item, keep: null };
    for (const fn of hooks.keep) { fn(event); if (event.keep !== null) break; }
    return event.keep;
  };
  PluginManager.emitPlayerDeath = () => true;
  PluginManager.emitPlayerDefeated = () => {};
  const player = new Player(null, new Location(1645, 3570, 1));
  players.push(player);
  const varbits = new Map(), varps = new Map(), hidden = new Map(), strings = new Map(); let opened = false;
  const sender = new Proxy({}, { get(_target, key) {
    if (key === 'getVarbit') return id => varbits.get(id) ?? 0;
    if (key === 'sendVarbit') return (id, value) => { varbits.set(id, value); return sender; };
    if (key === 'sendConfig') return (id, value) => { varps.set(id, value); return sender; };
    if (key === 'sendInterfaceDisplayState') return (id, value) => { hidden.set(id, value); return sender; };
    if (key === 'sendString') return (value, id) => { strings.set(id, value); return sender; };
    if (key === 'isSubInterfaceOpen') return id => opened && id === 602;
    if (key === 'sendSubInterface') return (_parent, id) => { opened = id === 602; return sender; };
    if (key === 'sendInterfaceRemoval') return () => { opened = false; return sender; };
    return () => sender;
  } });
  // Working control before the target: a real ordinary death still reaches the grave.
  const ordinary = new Player(null, new Location(1645, 3570, 1));
  players.push(ordinary);
  ordinary.getPacketSender = () => sender;
  ordinary.sendMessage = () => {};
  ordinary.setUsername('ordinary-grave-control');
  ordinary.setRights(PlayerRights.NONE);
  ordinary.setSkullTimer(0);
  ordinary.setHitpoints(10);
  ordinary.getPrayerActive().fill(false);
  const ordinaryIds = [core.ItemIdentifiers.ABYSSAL_WHIP, core.ItemIdentifiers.RUNE_DEFENDER,
    core.ItemIdentifiers.RANGER_BOOTS, core.ItemIdentifiers.RUNE_SCIMITAR, core.ItemIdentifiers.DRAGON_BOOTS];
  ordinaryIds.forEach((id, slot) => ordinary.getInventory().setItem(slot, new Item(id, 1)));
  const ordinaryKept = PlayerDeathTask.getItemsToKeep(ordinary).map(item => item.getId());
  assert.equal(ordinaryKept.length, 3, 'unskulled ordinary player keeps three');
  const ordinaryLost = ordinaryIds.filter(id => !ordinaryKept.includes(id));
  assert.equal(ordinaryLost.length, 2);
  const ordinaryTask = beginDeath(ordinary);
  for (let tick = 0; tick < 5; tick++) ordinaryTask.execute();
  assert.equal(ordinaryTask.isStopped(), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(ordinary.getInventory().getValidItems().map(item => item.getId()).sort((a,b) => a-b),
    [...ordinaryKept].sort((a,b) => a-b));
  const ordinaryGrave = ordinary.getAttribute('gravestones:grave');
  assert.deepEqual(ordinaryGrave?.items.map(row => row.id).sort((a,b) => a-b), ordinaryLost.sort((a,b) => a-b));
  assert.equal(ordinary.getAttribute('mimic:retrieval') ?? null, null);
  grave.despawn(ordinary);

  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.isRegistered = () => true;
  player.moveTo = function (location) { this.setLocation(location); return this; };
  player.setUsername('mimic-retrieval-native');
  player.setRights(PlayerRights.NONE);
  player.setSkullType(SkullType.WHITE_SKULL);
  player.setSkullTimer(100);
  player.setHitpoints(10);
  player.getPrayerActive().fill(false);
  iron.setMode(player, 'ultimate');
  const casket = new Item(core.ItemIdentifiers.MIMIC, 1);
  const State = require('../plugins/bosses/mimic/State.Mimic');
  const entry = State.initialize(casket, 'elite', 5);
  player.getInventory().setItem(0, casket);
  player.getInventory().setItem(1, new Item(core.ItemIdentifiers.COINS, 100000));
  player.getInventory().setItem(2, new Item(core.ItemIdentifiers.ABYSSAL_WHIP, 1));
  const tackleId = core.CacheDefinitions.getObjId('tackle_box');
  assert.equal(tackleId, 25580);
  const tackle = new Item(tackleId, 1);
  assert.equal(tackle.isTradeable(), false, 'active cache matches pinned tackle definition');
  player.getInventory().setItem(3, tackle);
  const storage = require('../plugins/items/storage/Common.StorageItems');
  const family = storage.FAMILIES.get('tackle-box');
  assert.ok(family && family.followsOnDeath);
  player.getInventory().setItem(4, new Item(core.ItemIdentifiers.FISHING_BAIT, 100));
  assert.equal(storage.fillFrom(player, family, core.ItemIdentifiers.FISHING_BAIT), 100);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.FISHING_BAIT), 0);
  assert.deepEqual(storage.contents(player, family), [{ id: core.ItemIdentifiers.FISHING_BAIT, amount: 100 }]);
  const Lair = require('../plugins/bosses/mimic/Lair.Mimic');
  assert.equal(Lair.enterArena(player), true);
  const area = player.getArea();
  assert.equal(Lair.sessionOf(area).owner, player);
  assert.equal(require('../plugins/bosses/mimic/Challenge.Mimic').challenge({ player, npc: Lair.sessionOf(area).casket }), true);
  assert.equal(Lair.sessionOf(area).boss, Lair.sessionOf(area).casket);
  assert.deepEqual(PlayerDeathTask.getItemsToKeep(player), [], 'registered UIM keep hook');
  const task = beginDeath(player);
  for (let tick = 0; tick < 5; tick++) task.execute();
  assert.equal(task.isStopped(), true);
  assert.deepEqual(errors, [], 'death must not hide exceptions');
  const lot = player.getAttribute('mimic:retrieval');
  assert.ok(lot && !lot.paid, 'unsafe Mimic death stores the actual loss at the casket');
  assert.equal(player.getAttribute('gravestones:grave') ?? null, null);
  assert.equal(lot.items.reduce((n, row) => n + (row.id === core.ItemIdentifiers.COINS ? row.amount : 0), 0), 100000);
  assert.ok(lot.items.some(row => row.id === core.ItemIdentifiers.MIMIC && row.meta['mimic-rolls'].id === entry.id));
  assert.ok(lot.items.some(row => row.id === core.ItemIdentifiers.ABYSSAL_WHIP));
  assert.ok(lot.items.some(row => row.id === tackleId), 'untradeable tackle box enters retrieval');
  assert.deepEqual(storage.contents(player, family), [{ id: core.ItemIdentifiers.FISHING_BAIT, amount: 100 }], 'box contents stay attached to their family');
  assert.equal(player.getInventory().getValidItems().length, 0);
  const saved = PlayerSave.fromPlayer(player);
  const loaded = new Player(null);
  loaded.getPacketSender = () => sender;
  loaded.sendMessage = () => {};
  players.push(loaded);
  saved.applyToPlayer(loaded);
  assert.deepEqual(loaded.getAttribute('mimic:retrieval'), lot, 'registered real save/load preserves the lot and metadata');
  assert.deepEqual(storage.contents(loaded, family), [{ id: core.ItemIdentifiers.FISHING_BAIT, amount: 100 }]);
  area.leave(player, false); // adapter for area exit after the completed death callback
  assert.equal(player.getAttribute(State.LEDGER_ATTRIBUTE)[entry.id].rolls, 4);
  varps.set(core.CacheDefinitions.getVarpId('if3'), 1); // prior shared retrieval interface state
  assert.equal(hooks.objects.get('<col=ffff00>Strange casket</col>').Search({ player }), true);
  assert.equal(varps.get(core.CacheDefinitions.getVarpId('if3')), 0, 'unsupported Bank-All is not exposed');
  assert.equal(hidden.get(core.CacheDefinitions.getComponentId('gravestone_retrieval:discard')), true);
  assert.equal(hidden.get(core.CacheDefinitions.getComponentId('gravestone_retrieval:discard_gfx')), true);
  assert.match(strings.get(core.CacheDefinitions.getComponentId('gravestone_retrieval:info')), /Stack count:/);
  assert.equal(varps.get(core.CacheDefinitions.getVarpId('if1')), 17, 'Mimic unpaid state');
  const button = hooks.buttons.get(core.CacheDefinitions.getComponentId('gravestone_retrieval:button'));
  assert.ok(button && button.length > 0);
  for (const fn of button) fn({ player });
  const paid = player.getAttribute('mimic:retrieval');
  assert.equal(paid.paid, true);
  assert.equal(varps.get(core.CacheDefinitions.getVarpId('if1')), 18, 'Mimic paid state');
  assert.equal(paid.items.find(row => row.id === core.ItemIdentifiers.COINS).amount, 10000);
  for (const fn of button) fn({ player });
  assert.equal(player.getAttribute('mimic:retrieval'), null);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 10000);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ABYSSAL_WHIP), 1);
  assert.equal(player.getInventory().getAmount(tackleId), 1);
  assert.deepEqual(storage.contents(player, family), [{ id: core.ItemIdentifiers.FISHING_BAIT, amount: 100 }]);

  // A second legitimate arena death: ordinary mode, an insufficient payment, then coffer + bank.
  const recoveredCasket = player.getInventory().getValidItems().find(item => item.getId() === core.ItemIdentifiers.MIMIC);
  assert.ok(recoveredCasket);
  const recoveredTackle = player.getInventory().getValidItems().find(item => item.getId() === tackleId);
  assert.ok(recoveredTackle);
  player.getInventory().resetItems();
  player.getInventory().setItem(0, recoveredCasket);
  player.getInventory().setItem(1, new Item(core.ItemIdentifiers.COINS, 10000));
  player.getInventory().setItem(2, new Item(core.ItemIdentifiers.ABYSSAL_WHIP, 1));
  player.getInventory().setItem(3, new Item(core.ItemIdentifiers.RUNE_DEFENDER, 1));
  player.getInventory().setItem(4, recoveredTackle);
  const arclightId = core.ItemIdentifiers.ARCLIGHT_INACTIVE_;
  player.getInventory().setItem(5, new Item(arclightId, 1).setMetaValue('arclight', { charges: 0, infusion: 7200 }));
  player.getInventory().setItem(6, new Item(arclightId, 1).setMetaValue('arclight', { charges: 1000, infusion: 7200 }));
  iron.setMode(player, 'none');
  player.setSkullTimer(100);
  const credit = { player, amount: 30000, ok: false };
  api.emitCustomEvent('gravestones:coffer-adjust', credit);
  assert.equal(credit.ok, true, 'fixture credit through registered coffer event');
  assert.equal(Lair.enterArena(player), true);
  const secondArea = player.getArea();
  assert.equal(require('../plugins/bosses/mimic/Challenge.Mimic').challenge({ player, npc: Lair.sessionOf(secondArea).casket }), true);
  assert.deepEqual(PlayerDeathTask.getItemsToKeep(player), []);
  const secondTask = beginDeath(player);
  for (let tick = 0; tick < 5; tick++) secondTask.execute();
  assert.equal(secondTask.isStopped(), true);
  const secondLot = player.getAttribute('mimic:retrieval');
  assert.ok(secondLot && !secondLot.paid);
  assert.ok(secondLot.items.some(row => row.id === core.ItemIdentifiers.RUNE_DEFENDER), 'unprotected untradeable stored');
  assert.ok(secondLot.items.some(row => row.id === tackleId), 'the second real loss includes the box');
  assert.equal(secondLot.items.filter(row => row.id === arclightId).length, 2, 'same item id with distinct real Arclight metadata');
  secondArea.leave(player, false);
  hooks.objects.get('<col=ffff00>Strange casket</col>').Search({ player });
  assert.equal(varps.get(core.CacheDefinitions.getVarpId('if1')), 17);
  assert.equal(varps.get(core.CacheDefinitions.getVarpId('if2')), 30000, 'actual coffer balance displayed');
  const beforeShortfall = structuredClone(secondLot);
  for (const fn of button) fn({ player });
  assert.deepEqual(player.getAttribute('mimic:retrieval'), beforeShortfall, 'shortfall leaves lot untouched');
  assert.equal(player.getAttribute('gravestones:coffer'), 30000, 'shortfall does not debit coffer');
  player.getBank(0).add(new Item(core.ItemIdentifiers.COINS, 60000), false);
  for (const fn of button) fn({ player });
  const secondPaid = player.getAttribute('mimic:retrieval');
  assert.equal(secondPaid.paid, true);
  assert.equal(player.getAttribute('gravestones:coffer') ?? 0, 0);
  assert.equal(varps.get(core.CacheDefinitions.getVarpId('if2')), 0);
  assert.equal(player.getBank(0).getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(secondPaid.items.find(row => row.id === core.ItemIdentifiers.COINS).amount, 10000);
  const itemsButton = hooks.buttons.get(core.CacheDefinitions.getComponentId('gravestone_retrieval:items'));
  const beforeStale = structuredClone(secondPaid);
  for (const fn of itemsButton) fn({ player, slot: 0, itemId: 2147483647, action: 2 });
  assert.deepEqual(player.getAttribute('mimic:retrieval'), beforeStale, 'stale item id cannot select another slot');
  const firstSlot = secondPaid.items.findIndex(row => row?.id === arclightId && row.meta.arclight.charges === 0);
  assert.ok(firstSlot >= 0);
  for (const fn of itemsButton) fn({ player, slot: firstSlot, itemId: arclightId, action: 2 });
  const afterFirst = structuredClone(player.getAttribute('mimic:retrieval'));
  assert.equal(afterFirst.items[firstSlot], null, 'withdrawn slot remains vacant');
  assert.ok(afterFirst.items.some(row => row?.id === arclightId && row.meta.arclight.charges === 1000));
  const firstArclight = player.getInventory().getValidItems().find(item => item.getId() === arclightId);
  assert.deepEqual(firstArclight.getMetaValue('arclight'), { charges: 0, infusion: 7200 });
  for (const fn of itemsButton) fn({ player, slot: firstSlot, itemId: arclightId, action: 2 });
  assert.deepEqual(player.getAttribute('mimic:retrieval'), afterFirst, 'queued stale slot cannot select the other same-id item');
  player.getBank(0).add(firstArclight.clone(), false);
  player.getInventory().deleteAtSlot(player.getInventory().getSlotForItemId(arclightId), 1);
  for (let slot = 0; slot < 27; slot++) player.getInventory().setItem(slot, new Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1));
  const beforeAmounts = new Map(secondPaid.items.filter(Boolean).map(row => [row.id, row.amount]));
  for (const fn of button) fn({ player });
  const remainder = player.getAttribute('mimic:retrieval');
  assert.ok(remainder?.paid && remainder.items.length > 0, 'items that did not fit remain paid and retrievable');
  assert.ok(remainder.items.some(row => row?.id === tackleId), 'the box remains in the saved lot');
  for (const [id, amount] of beforeAmounts) {
    const stillHeld = remainder.items.filter(row => row?.id === id).reduce((n, row) => n + row.amount, 0);
    assert.equal(stillHeld + player.getInventory().getAmount(id), amount, `partial withdrawal conserves ${id}`);
  }
  const savedPaid = PlayerSave.fromPlayer(player);
  const loadedPaid = new Player(null);
  loadedPaid.getPacketSender = () => sender; loadedPaid.sendMessage = () => {};
  players.push(loadedPaid); savedPaid.applyToPlayer(loadedPaid);
  assert.deepEqual(loadedPaid.getAttribute('mimic:retrieval'), remainder, 'paid partial lot and vacant slots survive save/load');
  // Registered Ferox safe-death policy produces no loss event; an empty unsafe death does.
  const savedBeforeSafe = structuredClone(remainder), dispatches = dropDispatches;
  player.setLocation(new Location(3327, 4780, 0));
  const safeTask = beginDeath(player);
  for (let tick = 0; tick < 5; tick++) safeTask.execute();
  assert.equal(safeTask.isStopped(), true);
  assert.equal(dropDispatches, dispatches);
  assert.deepEqual(player.getAttribute('mimic:retrieval'), savedBeforeSafe);
  ffa.respawn({ player, handled: false }); // release this registered policy's saved skull state
  player.getInventory().resetItems(); player.getEquipment().resetItems();
  player.setLocation(new Location(1645, 3570, 1));
  const unsafeTask = beginDeath(player);
  for (let tick = 0; tick < 5; tick++) unsafeTask.execute();
  assert.equal(unsafeTask.isStopped(), true);
  assert.equal(dropDispatches, dispatches + 1);
  assert.equal(player.getAttribute('mimic:retrieval'), null, 'later empty unsafe death loses the stored lot');

  // Simultaneous victory uses the registered reward callback; the NPC is an adapter, not full combat.
  const simultaneous = new Player(null, new Location(1645, 3570, 1));
  players.push(simultaneous);
  simultaneous.getPacketSender = () => sender; simultaneous.sendMessage = () => {};
  simultaneous.isRegistered = () => true;
  simultaneous.moveTo = function (location) { this.setLocation(location); return this; };
  simultaneous.setUsername('simultaneous-mimic'); simultaneous.setRights(PlayerRights.NONE);
  simultaneous.setHitpoints(10); simultaneous.getPrayerActive().fill(false);
  iron.setMode(simultaneous, 'ultimate');
  const wonCasket = new Item(core.ItemIdentifiers.MIMIC, 1);
  const wonState = State.initialize(wonCasket, 'elite', 5);
  simultaneous.getInventory().setItem(0, wonCasket);
  simultaneous.getInventory().setItem(1, new Item(core.ItemIdentifiers.ABYSSAL_WHIP, 1));
  assert.equal(Lair.enterArena(simultaneous), true);
  const wonArea = simultaneous.getArea(), boss = Lair.sessionOf(wonArea).casket;
  assert.equal(require('../plugins/bosses/mimic/Challenge.Mimic').challenge({ player: simultaneous, npc: boss }), true);
  boss.hp = 0;
  const simultaneousTask = beginDeath(simultaneous);
  const victory = { player: simultaneous, npc: boss, npcId: core.NpcIdentifiers.THE_MIMIC_2, handled: false };
  api.emitCustomEvent('npc-drops:generated', victory);
  assert.equal(victory.handled, true);
  assert.equal(simultaneous.getAttribute(State.LEDGER_ATTRIBUTE)[wonState.id].defeated, true);
  for (let tick = 0; tick < 5; tick++) simultaneousTask.execute();
  assert.equal(simultaneousTask.isStopped(), true);
  assert.ok(simultaneous.getAttribute('mimic:retrieval')?.items.some(row => row?.id === core.ItemIdentifiers.MIMIC));
  wonArea.leave(simultaneous, false);
  assert.equal(simultaneous.getAttribute(State.LEDGER_ATTRIBUTE)[wonState.id].rolls, 5, 'simultaneous victory does not spend an attempt');
  assert.equal(simultaneous.getAttribute(State.LEDGER_ATTRIBUTE)[wonState.id].defeated, true);
  // UIM brings payment: paying removes the coin stack and frees exactly one inventory slot.
  for (let slot = 0; slot < 27; slot++) simultaneous.getInventory().setItem(slot, new Item(core.ItemIdentifiers.RUNE_SCIMITAR, 1));
  simultaneous.getInventory().setItem(27, new Item(core.ItemIdentifiers.COINS, 90000));
  hooks.objects.get('<col=ffff00>Strange casket</col>').Search({ player: simultaneous });
  for (const fn of button) fn({ player: simultaneous });
  assert.equal(simultaneous.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  assert.equal(simultaneous.getInventory().getFreeSlots(), 1, 'paying from carried coins makes room');
  assert.equal(simultaneous.getAttribute('mimic:retrieval').paid, true);
  for (const fn of button) fn({ player: simultaneous });
  assert.ok(simultaneous.getAttribute('mimic:retrieval')?.paid, 'unfitting reward remains paid');
  assert.equal(simultaneous.getInventory().getFreeSlots(), 0);
  assert.ok(grounds.every(item => item.getId() === core.ItemIdentifiers.BONES), 'no lost item escaped onto the floor');
  assert.deepEqual(errors, []);
});
