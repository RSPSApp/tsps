// Run after `yarn build`: node --test tests/items-kept-on-death.test.cjs
// Which items a player keeps on death, upgraded Nightmare staffs splitting into their staff and orb
// for a Wilderness killer, and the staffs' special attack graphics (docs/items-kept-on-death.md).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
const { Item } = require('../dist/game/model/Item');
const { Location } = require('../dist/game/model/Location');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

const WILDERNESS = new Location(3090, 3600, 0);
const EDGEVILLE = new Location(3090, 3490, 0);

function fakePlayer({ items, protectItem = false, skulled = false, location = EDGEVILLE }) {
  const prayers = new Array(40).fill(false);
  if (protectItem) prayers.fill(true);
  return {
    getInventory: () => ({ getItems: () => items }),
    getEquipment: () => ({ getItems: () => [] }),
    getSkullTimer: () => (skulled ? 100 : 0),
    getSkullType: () => 0,
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99 }),
    getPrayerActive: () => prayers,
    getLocation: () => location,
    getRights: () => PlayerRights.NONE,
  };
}

const names = (items) => items.map((item) => item.getDefinition().getName());

test('Bounty Hunter bots use normal death drops, including Protect Item', (t) => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const botLoot = require('../plugins/bots/runtime/DeathLoot.PlayerBots');
  const at = new Location(3446, 4005);
  const whip = new Item(I.ABYSSAL_WHIP, 1);
  const sword = new Item(I.RUNE_SCIMITAR, 1);
  const food = new Item(I.SHARK, 5);
  const container = (items) => ({
    getItems: () => items, getValidItems: () => items,
    resetItems() { items.length = 0; return this; }, refreshItems() { return this; },
  });
  const inventory = container([sword, food]);
  const equipment = container([whip]);
  const victim = {
    ...fakePlayer({ items: [], skulled: true, protectItem: true, location: at }),
    getInventory: () => inventory, getEquipment: () => equipment,
    getUsername: () => 'BhBot1', isPlayerBot: () => true,
  };
  const killer = { getLocation: () => at, sendMessage: (message) => assert.fail(message) };
  const ground = [];
  const emitItemDrop = PluginManager.emitPlayerDeathItemDrop;
  const register = ItemOnGroundManager.registerLocation;
  t.after(() => {
    PluginManager.emitPlayerDeathItemDrop = emitItemDrop;
    ItemOnGroundManager.registerLocation = register;
  });
  botLoot.initBotDeathLootCoreAccess({
    getWorld: () => ({}),
    getItemOnGroundManager: () => ({ registerNonGlobals: () => assert.fail('BH must use core drops') }),
  });
  PluginManager.emitPlayerDeathItemDrop = (event) => {
    botLoot.handleBotDeathItemDrop(event);
    return event.handled;
  };
  ItemOnGroundManager.registerLocation = (owner, item, position) => {
    assert.equal(owner, killer);
    assert.equal(position, at);
    ground.push(item);
  };
  const kept = PlayerDeathTask.dropItems(victim, killer, at);
  assert.deepEqual(kept, [whip]);
  assert.deepEqual(ground, [sword, food]);
  assert.equal(inventory.getItems().length + equipment.getItems().length, 0);
});

test('untradeable items compete for the kept slots by value (Wiki: Items Kept on Death)', () => {
  // Skulled with Protect Item: one item kept. The 4.6m staff beat the 125k ballista only once
  // untradeables were ranked; before, the ballista took the slot.
  const staff = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  const ballista = new Item(I.LIGHT_BALLISTA, 1);
  const player = fakePlayer({ items: [ballista, staff], protectItem: true, skulled: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player)), ['Volatile Nightmare staff']);
  // Unskulled without Protect Item: three, both among them.
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(fakePlayer({ items: [ballista, staff] }))).sort(),
    ['Light ballista', 'Volatile Nightmare staff']);
});

test('the kept items are the most valuable by Grand Exchange price, not store value (Wiki: Items Kept on Death)', () => {
  // Store values: rune platebody 65,000, platelegs 64,000, kiteshield 54,400; dragon boots 20,000,
  // berserker ring 10,000, ranger boots 200. The Grand Exchange prices run the other way.
  const items = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_KITESHIELD, I.DRAGON_BOOTS, I.BERSERKER_RING, I.RANGER_BOOTS]
    .map((id) => new Item(id, 1));
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(fakePlayer({ items }))), ['Ranger boots', 'Berserker ring', 'Dragon boots']);
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(fakePlayer({ items, skulled: true, protectItem: true }))), ['Ranger boots']);
});

test('an item with no Grand Exchange price is ranked by its high alchemy value (Wiki: Items Kept on Death)', () => {
  // Dragon defender: high alch 40,804, store value 68,007. A dragon scimitar trades for more than the
  // alch value but less than the store value, so only the alch value lets the scimitar win.
  const defender = new Item(I.DRAGON_DEFENDER, 1);
  const scimitar = new Item(I.DRAGON_SCIMITAR, 1);
  assert.equal(defender.getDefinition().hasGrandExchangeValue(), false);
  assert.equal(PlayerDeathTask.keepValue(defender), defender.getDefinition().getHighAlchValue());
  const scimitarPrice = PlayerDeathTask.keepValue(scimitar);
  assert.ok(scimitarPrice > defender.getDefinition().getHighAlchValue() && scimitarPrice < defender.getDefinition().getValue(),
    `dragon scimitar price ${scimitarPrice} sits between the defender's alch and store values`);
  const player = fakePlayer({ items: [defender, scimitar], skulled: true, protectItem: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player)), ['Dragon scimitar']);
});

test('the Items Kept on Death interface shows what a death keeps, and prices the risk at Grand Exchange value', () => {
  // rsprox recording 430: the kept list holds an untradeable max cape, and turning Protect Item on
  // moved a sanfew serum (store value 300) to the kept side, lowering the guide risk value by 18,569.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const handlers = new Map();
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register({
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: () => false, PROTECT_ITEM: 0 }),
    emitCustomEvent() {},
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
  });
  const items = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_KITESHIELD, I.MAX_CAPE, I.BERSERKER_RING, I.RANGER_BOOTS]
    .map((id) => new Item(id, 1));
  const sent = { scripts: [], strings: [] };
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript(id, args) { sent.scripts.push({ id, args }); return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString(text) { sent.strings.push(text); return sender; },
    sendInterfaceRemoval() { return sender; },
  };
  const player = {
    ...fakePlayer({ items }),
    busy: () => false,
    setInterfaceId() {},
    getInterfaceId: () => 4,
    getPacketSender: () => sender,
  };
  handlers.get((387 << 16) | 5)({ player });
  const [{ args }] = sent.scripts;
  assert.equal(args[5], 3);
  const kept = args.slice(6, 9).map((id) => new Item(id, 1).getDefinition().getName()).sort();
  assert.deepEqual(kept, ['Berserker ring', 'Max cape', 'Ranger boots']);
  const risk = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_KITESHIELD]
    .reduce((sum, id) => sum + new Item(id, 1).getDefinition().getGrandExchangeValue(), 0);
  assert.equal(sent.strings[0], `Guide risk value:<br><col=ffffff>${risk.toLocaleString()}</col>`);
});

test('the death preview does not protect unkept untradeables that a PvM grave takes', (t) => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const handlers = new Map();
  const custom = new Map();
  let gravesEnabled = true;
  const api = {
    core: PluginManager.getCoreApi(),
    getPrayerHandler: () => ({ isActivated: player => player.getPrayerActive()[0], PROTECT_ITEM: 0 }),
    getPluginConfig: (key, fallback) => key === 'Gravestones:enabled' ? gravesEnabled : fallback,
    onInterfaceActionButton: (uid, handler) => handlers.set(uid, handler),
    onPlayerDeathDrops() {},
    onCustomEvent: (name, handler) => custom.set(name, handler),
    emitCustomEvent: (name, query) => custom.get(name)?.(query),
  };
  custom.set('ironman:mode', query => { query.mode = query.player.ironmanMode; });
  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  require('../plugins/interface/ItemsKeptOnDeath.plugin').register(api);
  const items = [I.RANGER_BOOTS, I.BERSERKER_RING, I.DRAGON_BOOTS, I.ABYSSAL_WHIP,
    I.RUNE_DEFENDER, I.ADAMANT_DEFENDER, I.MITHRIL_DEFENDER, I.STEEL_DEFENDER, I.IRON_DEFENDER, I.BRONZE_DEFENDER]
    .map(id => new Item(id, 1));
  assert.ok(items.slice(4).every(item => !item.isTradeable()), 'defenders are untradeable in the active cache');
  let sent;
  const sender = {
    sendSubInterface() { return sender; },
    sendInterfaceScript(id, args, _varps, _varbits, inventories) { sent = { id, args, inventories }; return sender; },
    sendInterfaceFlagsRange() { return sender; },
    sendString() { return sender; },
  };
  const untradeableStates = () => sent.inventories[584].slots
    .filter(slot => items.slice(4).some(item => item.getId() === slot.itemId))
    .map(slot => sent.inventories[468].slots[slot.slot].itemId);
  for (const [skulled, protectItem, count] of [[false, false, 3], [false, true, 4], [true, true, 1], [true, false, 0]]) {
    const player = {
      ...fakePlayer({ items, skulled, protectItem }),
      setInterfaceId() {}, getInterfaceId: () => 4, getPacketSender: () => sender,
    };
    handlers.get((387 << 16) | 5)({ player });
    assert.equal(sent.args[5], count);
    assert.deepEqual(sent.args.slice(6, 6 + count), PlayerDeathTask.getItemsToKeep(player).map(item => item.getId()));
    assert.ok(sent.inventories[468].slots.every(slot => slot.itemId === 1991),
      'the six extra untradeables must not add protected icons to the selected kept slots');
    assert.equal(sent.inventories[584].slots.length, items.length - count);

    handlers.get((4 << 16) | 12)({ player, action: 2 });
    assert.deepEqual(untradeableStates(), new Array(6).fill(323), 'the existing PvP preview stays unchanged');
  }
  const player = {
    ...fakePlayer({ items }),
    setInterfaceId() {}, getInterfaceId: () => 4, getPacketSender: () => sender,
  };
  for (const exception of ['ultimate', 'bot', 'config-disabled', 'plugin-disabled']) {
    player.ironmanMode = exception === 'ultimate' ? 'ultimate' : null;
    player.isPlayerBot = () => exception === 'bot';
    gravesEnabled = exception !== 'config-disabled';
    if (exception === 'plugin-disabled') custom.delete('gravestones:makes-grave');
    handlers.get((387 << 16) | 5)({ player });
    assert.deepEqual(untradeableStates(), new Array(6).fill(323), `${exception}: without a grave, core returns these untradeables`);
  }

  require('../plugins/world/gravestones/Death.Gravestones').attach(api);
  const keep = PluginManager.emitShouldKeepItemOnDeath;
  t.after(() => { PluginManager.emitShouldKeepItemOnDeath = keep; });
  PluginManager.emitShouldKeepItemOnDeath = (owner, item) => item === items[4] ? true : keep(owner, item);
  handlers.get((387 << 16) | 5)({ player });
  assert.equal(sent.args[5], 4, 'an always-kept hook adds a legitimate protected item beyond the normal three');
  assert.ok(sent.args.slice(6).includes(items[4].getId()));
  assert.ok(!sent.inventories[584].slots.some(slot => slot.itemId === items[4].getId()), 'the always-kept item has no lost marker');
  assert.deepEqual(untradeableStates(), new Array(5).fill(1991), 'the other unprotected defenders still go to the grave');
});

test('the Bounty Hunter risk skull counts what a death drops, by Grand Exchange price', () => {
  // Store order (rune platebody 65,000 > platelegs 64,000 > sq shield 38,400 > ranger boots 200)
  // crosses the Grand Exchange order, where the ranger boots come first: an unskulled death keeps
  // the boots, body and legs and drops the sq shield, and the risk skull must price that shield.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const RiskSkulls = require('../plugins/minigames/bountyhunter/RiskSkulls.BountyHunter');
  RiskSkulls({ core: PluginManager.getCoreApi(), onPlayerLogout() {}, onServerStartup() {}, onCustomEvent() {} }, {});
  const items = [I.RUNE_PLATEBODY, I.RUNE_PLATELEGS, I.RUNE_SQ_SHIELD, I.RANGER_BOOTS].map((id) => new Item(id, 1));
  const player = fakePlayer({ items });
  const shield = items[2];
  assert.ok(shield.getDefinition().getValue() > items[3].getDefinition().getValue(), 'store value puts the shield above the boots');
  const kept = PlayerDeathTask.getItemsToKeep(player);
  assert.deepEqual(names(kept).sort(), ['Ranger boots', 'Rune platebody', 'Rune platelegs']);
  assert.equal(RiskSkulls._test.riskOf(player), PlayerDeathTask.keepValue(shield));
});

test('preset items are never protected', () => {
  const staff = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  staff.setMetaValue(Item.UNTRADEABLE_META, true);
  const ballista = new Item(I.LIGHT_BALLISTA, 1);
  const player = fakePlayer({ items: [staff, ballista], protectItem: true, skulled: true });
  assert.deepEqual(names(PlayerDeathTask.getItemsToKeep(player)), ['Light ballista']);
});

test('an unkept upgraded staff splits into its staff and orb for a Wilderness killer (Wiki)', () => {
  const killer = { isPlayer: () => true };
  const split = (victim, items, kept = [], by = killer) => names(PlayerDeathTask.splitIntoComponents(victim, by, kept, items));
  for (const [staffId, orb] of [[I.VOLATILE_NIGHTMARE_STAFF, 'Volatile orb'], [I.HARMONISED_NIGHTMARE_STAFF, 'Harmonised orb'], [I.ELDRITCH_NIGHTMARE_STAFF, 'Eldritch orb']]) {
    const staff = new Item(staffId, 1);
    const victim = fakePlayer({ items: [staff], location: WILDERNESS });
    assert.deepEqual(split(victim, [staff]), ['Nightmare staff', orb]);
    assert.deepEqual(split(victim, [staff], [staff]).length, 1, 'kept: stays whole');
  }
  const staff = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  assert.deepEqual(split(fakePlayer({ items: [staff], location: EDGEVILLE }), [staff]), ['Volatile Nightmare staff'], 'outside the Wilderness');
  assert.deepEqual(split(fakePlayer({ items: [staff], location: WILDERNESS }), [staff], [], null), ['Volatile Nightmare staff'], 'no player killer');
  const preset = new Item(I.VOLATILE_NIGHTMARE_STAFF, 1);
  preset.setMetaValue(Item.UNTRADEABLE_META, true);
  assert.deepEqual(split(fakePlayer({ items: [preset], location: WILDERNESS }), [preset]), ['Volatile Nightmare staff'],
    'a preset staff is deleted, never split into free components');
});

test('the Volatile and Eldritch specials show their cache graphics', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const core = { ...PluginManager.getCoreApi(), CombatSpecial: { drain() {} } };
  for (const [file, cast, hit] of [['VolatileNightmareStaff', 1760, 1759], ['EldritchNightmareStaff', 1762, 1761]]) {
    let special = null;
    require(`../plugins/combat/specials/${file}.SpecialAttack`)({ core, registerCombatSpecial: (entry) => { special = entry; } });
    const shown = { animations: [], graphics: [], target: [] };
    const caster = {
      isPlayer: () => false,
      performAnimation: (animation) => shown.animations.push(animation.getId()),
      performGraphic: (graphic) => shown.graphics.push(graphic.getId()),
    };
    const target = { performGraphic: (graphic) => shown.target.push(graphic.getId()) };
    special.combatMethod.start(caster, target);
    special.combatMethod.handleAfterHitEffects({ isAccurate: () => true, getTarget: () => target, getAttacker: () => caster, getTotalDamage: () => 0 });
    special.combatMethod.handleAfterHitEffects({ isAccurate: () => false, getTarget: () => target, getAttacker: () => caster, getTotalDamage: () => 0 });
    assert.deepEqual(shown, { animations: [8532], graphics: [cast], target: [hit, 85] }, file);
  }
  // Ending the special must not play the reset animation over the cast.
  const resets = [];
  let volatile = null;
  require('../plugins/combat/specials/VolatileNightmareStaff.SpecialAttack')({ core, registerCombatSpecial: (entry) => { volatile = entry; } });
  volatile.combatMethod.finished({
    getCombat: () => ({ reset: (...args) => resets.push(args) }),
    setMobileInteraction() {},
    getMovementQueue: () => ({ reset() {} }),
  }, {});
  assert.deepEqual(resets, [[false]]);
});

test('kept items retain their per-item charges and infusion after death',()=>{
 const {PluginManager}=require('../dist/plugins/PluginManager'),{ItemOnGroundManager}=require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
 const sword=new Item(I.ARCLIGHT_INACTIVE_,1).setMetaValue('arclight',{charges:0,infusion:7200}),kept=[];
 let carried=[sword];const inventory={getItems:()=>carried,getValidItems:()=>carried,resetItems(){carried=[];return this;},refreshItems(){return this;},addItem:i=>{kept.push(i);return inventory;},adds:(id,n)=>{kept.push(new Item(id,n));return inventory;}};
 const equipment={getItems:()=>[],getValidItems:()=>[],resetItems(){return this;},refreshItems(){return this;}};
 const player={...fakePlayer({items:carried}),getInventory:()=>inventory,getEquipment:()=>equipment,getCombat:()=>({getRecentDamagerEntries:()=>[],getKiller:()=>null}),resetAttributes(){},isPlayerBot:()=>false};
 const originals=new Map(['emitShouldDropItemsOnDeath','emitPlayerDeathItemDrop','emitPlayerDefeated','emitPlayerDeath'].map(k=>[k,PluginManager[k]])),register=ItemOnGroundManager.registerLocation;
 try{
  PluginManager.emitShouldDropItemsOnDeath=()=>true;PluginManager.emitPlayerDeathItemDrop=()=>false;PluginManager.emitPlayerDefeated=()=>{};PluginManager.emitPlayerDeath=()=>true;ItemOnGroundManager.registerLocation=()=>null;
  const task=new PlayerDeathTask(player);task.ticks=0;task.execute();assert.equal(kept.length,1);assert.notEqual(kept[0],sword);assert.equal(kept[0].getId(),I.ARCLIGHT_INACTIVE_);assert.deepEqual(kept[0].getMetaValue('arclight'),{charges:0,infusion:7200});
  kept[0].setMetaValue('arclight',{charges:1000,infusion:7200});assert.deepEqual(sword.getMetaValue('arclight'),{charges:0,infusion:7200});
 }finally{for(const[k,v]of originals)PluginManager[k]=v;ItemOnGroundManager.registerLocation=register;}
});
