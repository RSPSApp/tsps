const assert = require('node:assert/strict');
const { test, before, afterEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Spell } = require('../dist/game/content/combat/magic/Spell');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { World } = require('../dist/game/World');
let core;
const crafting = {};
const tasks = [];
const legacyPlayers = new Set();
afterEach(() => {
  if (!core) return;
  for (const player of legacyPlayers) {
    // Legacy spells use both index and object keys; stop only this fixture's actors.
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  }
  legacyPlayers.clear();
});
before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi('JewelleryTest');
  require('../plugins/skills/EnchantJewellery.plugin').register(api);
  require('../plugins/items/ElementalStaves.plugin').register(api);
  require('../plugins/skills/CraftingSpells.plugin').register(api);
  require('../plugins/skills/Crafting.plugin').register({ ...api,
    onItemOnItem: handler => { crafting[handler.name] = handler; },
    onItemOnObject: handler => { crafting[handler.name] = handler; },
    onInterfaceActionClick: handler => { crafting.button = handler; },
    getTaskManager: () => ({ submit: task => tasks.push(task) }),
  });
  api.onCanUseItem(event => { if (event.player.blockItem) event.allow = false; });
  api.onSpellDisabled(event => { if (event.player.blockSpell) event.disabled = true; });
  api.registerSpellRuneSource({
    check: (player, missing) => missing.every(item => (player.pouch.get(item.id) ?? 0) >= item.getAmount()),
    consume: (player, missing) => missing.forEach(item => player.pouch.set(item.id, player.pouch.get(item.id) - item.getAmount())),
  });
});
function playerWith(entries = []) {
  const amounts = new Map(entries), attrs = new Map(), log = [];
  const inventory = {
    getItems: () => [...amounts].filter(([, n]) => n > 0).map(([id, n]) => new core.Item(id, n)),
    getCopiedItems: () => {
      const items = [...amounts].filter(([, n]) => n > 0).flatMap(([id, n]) =>
        core.ItemDefinition.forId(id).isStackable() ? [new core.Item(id, n)] :
          Array.from({ length: n }, () => new core.Item(id, 1)));
      assert.ok(items.length <= 28, "fixture inventory exceeds capacity");
      return [...items, ...Array.from({ length: 28 - items.length }, () => new core.Item(-1, 0))];
    },
    getAmount: id => amounts.get(id) ?? 0,
    contains: id => (amounts.get(id) ?? 0) > 0,
    deleteNumber: (id, n) => amounts.set(id, Math.max(0, (amounts.get(id) ?? 0) - n)),
    deletes: item => inventory.deleteNumber(item.id, item.getAmount()),
    addItem: item => amounts.set(item.id, (amounts.get(item.id) ?? 0) + item.getAmount()),
    setItem: (slot, item) => { inventory.deleteNumber(inventory.getItems()[slot].id, 1); inventory.addItem(item); return inventory; },
    refreshItems: () => inventory,
  };
  const sender = {
    sendSound(id) { log.push(['sound', id]); return sender; },
    sendSoundEffect(id) { log.push(['sound', id]); return sender; },
    sendConfig(id, value) { log.push(['config', id, value]); return sender; },
    sendVarbit(id, value) { log.push(['varbit', id, value]); return sender; },
    sendTypedMessage(type, text) { log.push([type === core.ChatType.SPAM ? 'spam' : 'message', text]); return sender; },
    sendSubInterface(uid, group) { log.push(['open', group]); return sender; },
    closeSubInterface() { log.push(['close']); return sender; },
    sendEnterAmountPrompt() { log.push(['quantity']); return sender; },
    sendClientScript(id, ...args) { log.push(['script', id, ...args]); return sender; },
  };
  const player = {
    amounts, log, pouch: new Map(), level: 99, book: core.MagicSpellbook.NORMAL,
    weapon: -1, interfaceId: -1, moving: false, location: new core.Location(3225, 3255),
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => Array.from({length:14}, () => new core.Item(player.weapon, 1)), get: () => new core.Item(player.weapon,1), containsAllItem: () => true }),
    getSkillManager: () => ({ getCurrentLevel: () => player.level, addExperiences: (skill,xp) => log.push(['xp',skill,xp]) }),
    getCombat: () => ({ reset() {}, setCastSpell() {}, setAutocastSpell() {} }), getSpellbook: () => player.book,
    getAttribute: key => attrs.get(key), setAttribute: (key,value) => attrs.set(key,value),
    getPacketSender: () => sender, sendMessage: text => log.push(['message',text]),
    performAnimation: anim => log.push(['animation',anim.getId()]),
    performGraphic: gfx => log.push(['graphic',gfx.getId(),gfx.getHeight()]),
    getInterfaceId: () => player.interfaceId, setInterfaceId: id => { player.interfaceId = id; },
    setEnteredAmountAction: action => { player.amountAction = action; },
    getUsername: () => 'JewelleryTest', getIndex: () => 1, isPlayerBot: () => false,
    getLocation: () => player.location, isRegistered: () => true, getHitpoints: () => 99,
    getMovementQueue: () => ({ size: () => player.moving ? 1 : 0 }), getForceMovement: () => null,
  };
  legacyPlayers.add(player);
  return player;
}
function cast(player,name,itemId,slot = player.getInventory().getItems().findIndex(item => item.id === itemId)) {
  return PluginManager.emitSpellOnItem({player,spellName:name,itemId,slot,handled:false});
}
test('equipped elemental staffs bypass only the elemental runes they supply for spells', () => {
  const player = playerWith();
  const spell = { getSpellbook: () => core.MagicSpellbook.NORMAL, spellId: () => 1 };
  const windSurgeRunes = [
    new core.Item(ItemIdentifiers.AIR_RUNE, 7),
    new core.Item(ItemIdentifiers.WRATH_RUNE, 1),
  ];

  player.weapon = ItemIdentifiers.STAFF_OF_AIR;
  assert.deepEqual(
    Spell.prototype.itemsToConsume.call(spell, player, windSurgeRunes).map(item => item.id),
    [ItemIdentifiers.WRATH_RUNE],
  );

  player.weapon = ItemIdentifiers.STAFF_OF_WATER;
  assert.deepEqual(
    Spell.prototype.itemsToConsume.call(spell, player, windSurgeRunes).map(item => item.id),
    [ItemIdentifiers.AIR_RUNE, ItemIdentifiers.WRATH_RUNE],
  );
});
// Gold amulets play the spell's own sequence, graphic and sound; rings, necklaces and bracelets
// play human_cast_enchantring 931 / enchant_ring 238 (rsprox 1135, 3342, 4119); silver amulets the
// spell's sequence with graphic 238 (rsprox 4211).
const RING_CAST = [931,238];
const enchantRecipes = [
  ['Lvl-1 Enchant', [[1694,1727]], [[21108,21160]], [[1637,2550],[1656,3853],[11072,11074],[21081,21126],[21090,21143],[21117,21177]],
    [[564,1],[555,1]],17.5,719,114,136,147],
  // The jade bracelet: the spell's sequence, enchant_ring and sound 142 (rsprox 1846).
  ['Lvl-2 Enchant', [[1696,1729]], [[21111,21163]], [[1639,2552],[1658,5521],[11076,11079],[21084,21129],[21093,21146]],
    [[564,1],[556,3]],37,720,115,141,142,[[21120,21180]]],
  // The ruby necklace plays the amulet cast (rsprox 1757).
  ['Lvl-3 Enchant', [[1698,1725],[1660,11194]], [[21114,21166]], [[1641,2568],[11085,11088],[21087,21140],[21096,21157],[21123,21183]],
    [[564,1],[554,5]],59,721,116,145,145],
  ['Lvl-4 Enchant', [[1700,1731]], [], [[1643,2570],[1662,11090],[11092,11095]], [[564,1],[557,10]],67,719,153,137,137],
  ['Lvl-5 Enchant', [[1702,1704]], [], [[1645,2572],[1664,11113],[11115,11126]], [[564,1],[555,15],[557,15]],78,720,154,139,140],
  ['Lvl-6 Enchant', [[6581,6585]], [], [[6575,6583],[6577,11128],[11130,11133]], [[564,1],[554,20],[557,20]],97,721,452,143,144],
  ['Lvl-7 Enchant', [[19541,19553]], [], [[19538,19550],[19535,19547],[19532,19544]], [[564,1],[565,20],[566,20]],110,721,452,143,144],
];
test('all 40 enchant recipes use wearable cache jewellery, consume their runes and play their cast', () => {
  let count = 0;
  for (const [spell,amulets,silver,jewellery,runes,xp,anim,gfx,sound,jewellerySound,silverJewellery = []] of enchantRecipes) {
    const looks = [[amulets,[anim,gfx,sound]],[silver,[anim,238,sound]],[jewellery,[...RING_CAST,jewellerySound]],[silverJewellery,[anim,238,jewellerySound]]];
    for (const [recipes,[animation,graphic,sfx]] of looks) for (const [input,output] of recipes) {
      count++;
      const def = core.CacheDefinitions.getItem(input);
      assert.equal(def.noteTemplate,-1); assert.equal(def.placeholderTemplate,-1);
      assert.ok(def.inventoryActions.includes('Wear'), `${input} must be wearable`);
      assert.ok(core.CacheDefinitions.getItem(output).inventoryActions.includes('Wear'), `${output} must be wearable`);
      const player = playerWith([[input,1],...runes]);
      assert.equal(cast(player,spell,input),true);
      assert.equal(player.amounts.get(output),1, `${spell} on ${input}`);
      assert.equal(player.amounts.get(input),0);
      for (const [id] of runes) assert.equal(player.amounts.get(id),0);
      for (const [kind,value] of [['xp',xp],['animation',animation],['graphic',graphic],['sound',sfx]])
        assert.ok(player.log.some(row => row[0] === kind && row[row[0] === 'graphic' ? 1 : row.length - 1] === value), `${spell} on ${input}: ${kind} ${value}`);
      // rsprox: every enchant graphic at height 92, and toplevel_sidebutton_switch [6] on the cast.
      assert.ok(player.log.some(row => row[0] === 'graphic' && row[2] === 92), `${spell} on ${input}: graphic height 92`);
      assert.ok(player.log.some(row => row[0] === 'script' && row[1] === 915 && row[2] === 6), `${spell} on ${input}: magic tab`);
    }
  }
  assert.equal(count,40);
});
/** A player whose inventory is a 28-slot array (null = empty), for slot-exact enchanting. */
function slotPlayer(slots) {
  const player = playerWith();
  const items = Array.from({ length: 28 }, (_, slot) => slots[slot] == null ? null
    : new core.Item(...(Array.isArray(slots[slot]) ? slots[slot] : [slots[slot], 1])));
  const count = id => items.reduce((sum, item) => sum + (item?.getId() === id ? item.getAmount() : 0), 0);
  const inventory = {
    getItems: () => items, getAmount: count, contains: id => count(id) > 0, refreshItems: () => inventory,
    deletes(item) {
      const slot = items.findIndex(entry => entry?.getId() === item.id);
      items[slot].setAmount(items[slot].getAmount() - item.getAmount());
      if (items[slot].getAmount() <= 0) items[slot] = null;
      return inventory;
    },
    setItem: (slot, item) => { items[slot] = item; return inventory; },
  };
  player.getInventory = () => inventory;
  player.ids = () => items.map(item => item?.getId() ?? null);
  return player;
}
/** One game tick of a repeating enchant; unit tests hold the cycle still, so the cast delay is spent here. */
function tickEnchant(player, task, count = 1) {
  for (let n = 0; n < count; n++) {
    player.setAttribute('enchant-jewellery:next-cast-at',0); player.setAttribute('magic:next-cast-at',0);
    task.execute();
  }
}
/** Runs `body` with TaskManager.submit capturing the tasks it would start. */
function withTasks(body) {
  const submit = core.TaskManager.submit, started = [];
  core.TaskManager.submit = task => { task.setRunning(true); started.push(task); };
  try { body(started); } finally { core.TaskManager.submit = submit; }
}
test('an enchant converts the first piece of that jewellery in its own slot (Wiki, 12 February 2025)', () => withTasks(() => {
  const player = slotPlayer([[564,10],[555,10],null,1637,2550,1637]);
  cast(player,'Lvl-1 Enchant',1637,5);
  assert.deepEqual(player.ids().slice(0,6),[564,555,null,2550,2550,1637]);
}));
test('one enchant repeats every 7 ticks on the same jewellery until none is left (Wiki, rsprox 4119)', () => withTasks(started => {
  const player = slotPlayer([[564,10],[555,10],1637,1694,1637,1637]);
  cast(player,'Lvl-1 Enchant',1637,2);
  assert.equal(started.length,1);
  const task = started[0];
  assert.equal(task.key,player.getIndex(),'keyed to the player, so walking cancels it');
  const rings = () => player.ids().filter(id => id === 2550).length;
  assert.equal(rings(),1);
  tickEnchant(player,task,6);
  assert.equal(rings(),1,'nothing before the seventh tick');
  tickEnchant(player,task); assert.deepEqual(player.ids().slice(2,6),[2550,1694,2550,1637]);
  tickEnchant(player,task,7);
  assert.deepEqual(player.ids().slice(2,6),[2550,1694,2550,2550],'the sapphire amulet is another type and stays');
  assert.equal(task.isRunning(),true);
  tickEnchant(player,task,7);
  assert.equal(task.isRunning(),false,'stops once the rings run out');
  assert.equal(player.log.filter(row => row[0] === 'xp').length,3);
  assert.equal(player.log.filter(row => row[0] === 'message').length,0);
}));
test('an enchant clicked during the 3-tick delay waits for it, then repeats (Wiki, 21 August 2014)', () => withTasks(started => {
  const player = slotPlayer([[564,10],[555,10],1637,1637]);
  player.setAttribute('enchant-jewellery:next-cast-at',World.getProcessCycle()+2);
  cast(player,'Lvl-1 Enchant',1637,2);
  assert.deepEqual(player.ids().slice(2,4),[1637,1637]);
  const task = started[0];
  task.execute(); assert.deepEqual(player.ids().slice(2,4),[1637,1637],'still in the delay');
  tickEnchant(player,task); assert.deepEqual(player.ids().slice(2,4),[2550,1637],'cast when the delay ends');
  tickEnchant(player,task,7); assert.deepEqual(player.ids().slice(2,4),[2550,2550],'then repeats');
  const switches = player.log.filter(row => row[0] === 'script' && row[1] === 915 && row[2] === 6).length;
  assert.equal(switches,1,'the queued click returns to the spellbook once; the repeats do not');
}));
test('a new enchant replaces the running one, and running out of runes stops it', () => withTasks(started => {
  const player = slotPlayer([[564,2],[555,2],1637,1637,11072,11072]);
  cast(player,'Lvl-1 Enchant',1637,2);
  player.setAttribute('enchant-jewellery:next-cast-at',0); player.setAttribute('magic:next-cast-at',0);
  cast(player,'Lvl-1 Enchant',11072,4);
  assert.equal(started[0].isRunning(),false);
  assert.deepEqual(player.ids().slice(2,6),[2550,1637,11074,11072]);
  tickEnchant(player,started[1],7);
  assert.deepEqual(player.ids().slice(2,6),[2550,1637,11074,11072],'no runes left for the second bracelet');
  assert.equal(started[1].isRunning(),false);
}));
test('elemental staves and rune pouch shortfalls use the core rune pipeline', () => {
  const staff = playerWith([[1694,1],[564,1]]); staff.weapon = core.ItemIds.STAFF_OF_WATER;
  cast(staff,'Lvl-1 Enchant',1694); assert.equal(staff.amounts.get(1727),1);
  const pouch = playerWith([[1700,1],[557,4]]); pouch.pouch = new Map([[564,1],[557,6]]);
  cast(pouch,'Lvl-4 Enchant',1700); assert.equal(pouch.amounts.get(1731),1);
  assert.equal(pouch.pouch.get(564),0); assert.equal(pouch.pouch.get(557),0);
});
test('restrictions, missing runes, wrong slots and cooldowns preserve items and XP', () => {
  for (const change of [p => { p.level = 1; }, p => { p.blockItem = true; }, p => { p.blockSpell = true; },
    p => { p.book = core.MagicSpellbook.ANCIENT; }, p => { p.amounts.delete(564); },
    p => p.setAttribute('magic:next-cast-at',World.getProcessCycle()+17),
    p => p.setAttribute('enchant-jewellery:next-cast-at',World.getProcessCycle()+3)]) {
    const player = playerWith([[1694,1],[564,1],[555,1]]); change(player);
    const before = [...player.amounts];
    const setAutocast = core.Autocasting.setAutocast;
    // Spellbook rejection also clears autocast; its UI refresh is tested separately.
    core.Autocasting.setAutocast = () => player.log.push(['autocast-cleared']);
    try { cast(player,'Lvl-1 Enchant',1694); }
    finally { core.Autocasting.setAutocast = setAutocast; }
    assert.deepEqual([...player.amounts],before);
    assert.equal(player.log.filter(row => row[0] === 'xp').length,0);
  }
  const player = playerWith([[1694,2],[564,2],[555,2]]);
  cast(player,'Lvl-1 Enchant',1694,20); assert.equal(player.amounts.get(564),2);
  cast(player,'Lvl-1 Enchant',1694); cast(player,'Lvl-1 Enchant',1694);
  assert.equal(player.amounts.get(1727),1); assert.equal(player.amounts.get(564),1);
});
function openFurnace(player) {
  crafting.handleBarOnFurnace({player,itemId:2357,object:{getDefinition:() => ({getName:() => 'Furnace'})}});
}
function button(player,component) { crafting.button({player,buttonId:(446 << 16)|component,handled:false}); }
function tick(task,count) { for (let n=0;n<count;n++) task.execute(); }
test('furnace uses group 446 and make-X, producing 2 ticks after the choice then every 3 ticks', () => {
  const player = playerWith([[2357,5],[1592,1]]);
  openFurnace(player); assert.ok(player.log.some(row => row[0] === 'open' && row[1] === 446));
  button(player,63); player.amountAction.execute(2); button(player,8);
  // rsprox 1102/1105: human_furnace and sound 2725 on the choice, the ring 2 ticks later.
  assert.ok(player.log.some(row => row[0] === 'animation' && row[1] === 899));
  const task = tasks.at(-1); tick(task,1); assert.equal(player.amounts.get(1635),undefined);
  tick(task,1); assert.equal(player.amounts.get(1635),1);
  tick(task,3); assert.equal(player.amounts.get(1635),2);
  assert.equal(player.amounts.get(1592),1); assert.equal(player.amounts.get(2357),3);
  assert.equal(player.getAttribute('crafting:task'),null);
  assert.equal(player.log.filter(row => row[0] === 'message').length,0);
  assert.ok(player.log.some(row => row[0] === 'sound' && row[1] === 2725));
  // rsprox 1851: the gold ring button stores enum 4318's value for it.
  const lastType = core.CacheDefinitions.getVarbitId('crafting_gold_item_lasttype');
  assert.ok(player.log.some(row => row[0] === 'varbit' && row[1] === lastType && row[2] === 1));
});
const crafted = [
  [1592,8,[1635,1637,1639,1641,1643,1645,6575,19538]],
  [1597,23,[1654,1656,1658,1660,1662,1664,6577,19535]],
  [1595,37,[1673,1675,1677,1679,1681,1683,6579,19501]],
  [11065,50,[11069,11072,11076,11085,11092,11115,11130,19532]],
];
test('all 32 furnace products are real items, with wearable bracelets and 200 Zenyte amulet XP', () => {
  const gems = [null,1607,1605,1603,1601,1615,6573,19493];
  for (const [mould,first,products] of crafted) for (const [index,output] of products.entries()) {
    const component = mould === 11065 && index > 0 ? first + index + 1 : first + index;
    const player = playerWith([[2357,1],[mould,1],...(gems[index] ? [[gems[index],1]] : [])]);
    openFurnace(player); button(player,component); tick(tasks.at(-1),3);
    assert.equal(player.amounts.get(output),1,`component ${component}`);
    const def = core.CacheDefinitions.getItem(output);
    assert.equal(def.placeholderTemplate,-1); assert.equal(def.noteTemplate,-1);
    if (mould === 11065) assert.ok(def.inventoryActions.includes('Wear'));
    if (output === 19501) assert.ok(player.log.some(row => row[0] === 'xp' && row[2] === 200));
  }
});
test('moving, lost ingredients and insufficient levels stop furnace production safely', () => {
  for (const change of [p => { p.moving = true; }, p => { p.amounts.delete(1592); }, p => { p.level = 1; }]) {
    const player = playerWith([[2357,1],[1592,1]]); openFurnace(player); button(player,8); change(player); tick(tasks.at(-1),3);
    assert.equal(player.amounts.get(2357),1); assert.equal(player.amounts.get(1635),undefined);
  }
});
test('all eight amulets string in either order on the next tick with real identifiers and the live message', () => {
  for (const [input,output] of [[1673,1692],[1675,1694],[1677,1696],[1679,1698],[1681,1700],[1683,1702],[6579,6581],[19501,19541]]) for (const reverse of [false,true]) {
    const player = playerWith([[1759,1],[input,1]]);
    crafting.stringAmulet({player,usedItemId:reverse ? input : 1759,usedWithItemId:reverse ? 1759 : input});
    assert.equal(player.amounts.get(output),undefined, 'nothing on the click tick');
    tick(tasks.at(-1),1);
    assert.equal(player.amounts.get(output),1);
    assert.ok(player.log.some(row => row[0] === 'spam' && row[1] === 'You put some string on your amulet.'));
    assert.ok(player.log.some(row => row[0] === 'xp' && row[2] === 4));
  }
});

// --- Spells that make Crafting materials (plugins/skills/craftingspells)

/** A player whose inventory holds real Item objects, so spells can convert them in place. */
function spellPlayer(entries, book = core.MagicSpellbook.LUNAR) {
  const player = playerWith();
  let items = entries.flatMap(([id, n]) => core.ItemDefinition.forId(id).isStackable()
    ? [new core.Item(id, n)] : Array.from({ length: n }, () => new core.Item(id, 1)));
  const count = id => items.filter(item => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0);
  const inventory = {
    getItems: () => items, getValidItems: () => items.filter(item => item.getAmount() > 0),
    getAmount: count, contains: id => count(id) > 0, refreshItems() {},
    deleteNumber(id, n) {
      for (const item of items) {
        if (n <= 0 || item.getId() !== id) continue;
        const take = Math.min(n, item.getAmount()); item.setAmount(item.getAmount() - take); n -= take;
      }
      items = items.filter(item => item.getAmount() > 0);
      return inventory;
    },
    deletes: item => inventory.deleteNumber(item.id, item.getAmount()),
    addItem: item => { items.push(new core.Item(item.getId(), item.getAmount())); return inventory; },
    forceAdd: (_player, item) => inventory.addItem(item),
  };
  player.getInventory = () => inventory;
  player.book = book;
  player.getSkillManager = () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99, addExperiences: (skill, xp) => player.log.push(['xp', skill, xp]) });
  player.count = count;
  return player;
}
function castSelf(player, spellName) {
  return PluginManager.emitSpellCast({ player, spellName, spellWidget: -1, spellItemId: -1, handled: false });
}
const craftingXp = player => player.log.filter(row => row[0] === 'xp' && row[1] === core.Skill.CRAFTING).map(row => row[2]);

test('Spin Flax spins at most five flax with the Wiki runes and 15 Crafting XP each', () => {
  const I = ItemIdentifiers;
  const player = spellPlayer([[I.FLAX, 7], [I.ASTRAL_RUNE, 1], [I.NATURE_RUNE, 2], [I.AIR_RUNE, 5]]);
  assert.equal(castSelf(player, 'Spin Flax'), true);
  assert.equal(player.count(I.BOW_STRING), 5);
  assert.equal(player.count(I.FLAX), 2);
  assert.deepEqual(craftingXp(player), [75]);
  assert.equal(player.count(I.ASTRAL_RUNE) + player.count(I.NATURE_RUNE) + player.count(I.AIR_RUNE), 0);
  assert.ok(player.log.some(row => row[0] === 'graphic' && row[1] === 728));
});

test('Tan Leather tans five hides, cowhide and snake hide included', () => {
  const I = ItemIdentifiers;
  const player = spellPlayer([[I.COWHIDE, 3], [I.SNAKE_HIDE, 3], [I.ASTRAL_RUNE, 2], [I.NATURE_RUNE, 1], [I.FIRE_RUNE, 5]]);
  castSelf(player, 'Tan Leather');
  assert.equal(player.count(I.LEATHER) + player.count(I.SNAKESKIN), 5);
  assert.equal(player.count(I.COWHIDE) + player.count(I.SNAKE_HIDE), 1);
});

test('Superglass Make counts giant seaweed as six ash and gives 10 Crafting XP per sand', () => {
  const I = ItemIdentifiers, random = Math.random;
  Math.random = () => 0.99;
  try {
    const player = spellPlayer([[I.BUCKET_OF_SAND, 7], [I.GIANT_SEAWEED, 1], [I.SODA_ASH, 1],
      [I.ASTRAL_RUNE, 2], [I.FIRE_RUNE, 6], [I.AIR_RUNE, 10]]);
    castSelf(player, 'Superglass Make');
    assert.equal(player.count(I.MOLTEN_GLASS), 7);
    assert.equal(player.count(I.BUCKET_OF_SAND) + player.count(I.GIANT_SEAWEED) + player.count(I.SODA_ASH), 0);
    assert.deepEqual(craftingXp(player), [70]);
  } finally { Math.random = random; }
});

test('the Lunar crafting spells need the Lunar spellbook and leave other self-casts alone', () => {
  const I = ItemIdentifiers;
  const player = spellPlayer([[I.FLAX, 1], [I.ASTRAL_RUNE, 1], [I.NATURE_RUNE, 2], [I.AIR_RUNE, 5]], core.MagicSpellbook.NORMAL);
  assert.equal(castSelf(player, 'Spin Flax'), false);
  assert.equal(player.count(I.FLAX), 1);
  assert.equal(castSelf(player, 'Bones to Bananas'), false);
});

test('Charge Air Orb on the Obelisk of Air uses one unpowered orb per cast and the Wiki runes', () => {
  const I = ItemIdentifiers;
  const player = spellPlayer([[I.UNPOWERED_ORB, 2], [I.COSMIC_RUNE, 3], [I.AIR_RUNE, 30]], core.MagicSpellbook.NORMAL);
  const widget = core.CacheDefinitions.getSpellByName('Charge Air Orb');
  const obelisk = { getDefinition: () => ({ getName: () => 'Obelisk of Air' }) };
  PluginManager.emitSpellOnObject({ player, object: obelisk, objectId: 2152, spellWidget: widget.widgetId,
    spellChild: -1, spellItemId: widget.itemId, spellId: -1, location: { x: 0, y: 0, z: 0 }, handled: false });
  assert.equal(player.count(I.AIR_ORB), 1);
  assert.equal(player.count(I.UNPOWERED_ORB), 1);
  assert.equal(player.count(I.COSMIC_RUNE) + player.count(I.AIR_RUNE), 0);
});

// Native furnace route and selected World phases; no direct recipe/session admission helper.
test("native gold jewellery stops a pending conversion after a drained one-step walk", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const path = require("node:path");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const Smithing = require("../plugins/skills/Smithing.plugin");
  const Shared = require("../plugins/skills/crafting/Shared.Crafting");
  PluginManager.loadFromDirectory(path.resolve(__dirname,"../plugins"));
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222,3218);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  const ids=core.ItemIdentifiers;
  const ringType=Shared.DATA.gold.types.find(row=>row.name==="ring");
  const productIndex=ringType.products.findIndex(row=>row[0]==="GOLD_RING");
  assert.ok(productIndex>=0);
  const component=ringType.components[productIndex];
  assert.deepEqual(ringType.products[productIndex],["GOLD_RING",5,15]);
  let index=1780;
  for(const mode of ["stationary","approach","interrupt"]) await t.test(mode,async t=>{
    const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const p=new Player(new PlayerSession(channel));p.setIndex(index++);p.setUsername("jewelcancel"+index);p.setRegistered(true);
    p.setLocation(new core.Location(mode==="approach"?3219:3226,3218,0));p.needsPlacement=false;
    p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING,99,false);
    const c=new ClientConnection(channel);c.player=p;
    t.after(()=>{
      Shared.stopCrafting(p);
      PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});
      PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});
      p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);
      assert.equal(p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE),null);
    });
    assert.equal(p.getEquipment().getItems().some(item=>item&&item.getId()>0),false);
    for(const id of [ids.GOLD_BAR,ids.RING_MOULD])p.getInventory().add(new core.Item(id,1),false);
    const furnaceId=[...Smithing.FURNACE_OBJECT_IDS].find(id=>{
      const d=core.ObjectDefinition.forPlayer(id,p);return d?.getName()==="Furnace"&&d.getActions()?.includes("Smelt");
    });
    assert.ok(Number.isInteger(furnaceId));
    const furnace=new core.GameObject(furnaceId,new core.Location(3223,3218,0),10,0,null);
    core.ObjectManager.register(furnace,true);t.after(()=>core.ObjectManager.deregister(furnace,true));
    const pos=()=>[p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()];
    const initial=pos(),gains=[],openings=[],rows=[];
    let completed=false;
    t.after(()=>{ if(!completed) t.diagnostic("JEWELLERY_CANCELLATION_OBSERVATION "+JSON.stringify({rows,openings})); });
    const skills=p.getSkillManager(),add=skills.addExperiences.bind(skills);
    t.mock.method(skills,"addExperiences",(skill,xp)=>{if(skill===core.Skill.CRAFTING)gains.push(xp);return add(skill,xp);});
    const total=id=>p.getInventory().getAmount(id)+p.getEquipment().getAmount(id)+core.World.getItems().filter(g=>!g.isPendingRemoval()&&g.getOwner()===p.getUsername()&&g.getPrivateArea()===p.getPrivateArea()&&g.getItem().getId()===id).reduce((n,g)=>n+g.getItem().getAmount(),0);
    let turns=0;const animate=p.performAnimation.bind(p);
    t.mock.method(p,"performAnimation",(...args)=>{
      const result=animate(...args);
      if(args[0]?.getId()===899)openings.push({turns,pos:pos(),accepted:p.getAnimation()?.getId()===899,bar:total(ids.GOLD_BAR),ring:total(ids.GOLD_RING),gains:[...gains]});
      return result;
    });
    const snapshot=label=>{
      const q=p.getMovementQueue(),task=p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE);
      const row={label,mode,turns,epoch:core.World.getProcessCycle(),pos:pos(),queue:q.size(),moving:q.isMovings(),didMove:q.didMoveThisCycle(),taskActive:task?.isRunning?.()??false,interfaceId:p.getInterfaceId(),bar:total(ids.GOLD_BAR),ring:total(ids.GOLD_RING),mould:total(ids.RING_MOULD),gains:[...gains]};
      rows.push(row);return row;
    };
    const turn=()=>{
      assert.ok(++turns<=24,"bounded native turn budget");p.resetUpdating();core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;
      core.TaskManager.process();c.processTurnPackets();
      const q=p.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(p.getIndex());
    };
    const untouched=()=>{assert.deepEqual(gains,[]);assert.equal(total(ids.GOLD_BAR),1);assert.equal(total(ids.GOLD_RING),0);assert.equal(total(ids.RING_MOULD),1);};
    if(mode==="approach")assert.equal(furnace.isWithinInteractionDistance(p.getLocation()),false);
    await c.dispatch([{type:"item_on_object",objectId:furnaceId,x:3223,y:3218,itemId:ids.GOLD_BAR,slot:p.getInventory().getSlotForItemId(ids.GOLD_BAR),widgetId:149<<16}]);
    for(let i=0;i<10&&p.getInterfaceId()!==446;i++)turn();
    snapshot("furnace-menu");
    assert.equal(p.getInterfaceId(),446,"real bar-on-furnace must open native gold menu");
    if(mode==="approach")assert.notDeepEqual(pos(),initial);else assert.deepEqual(pos(),initial);
    assert.deepEqual(pos(),[3226,3218,0]);assert.equal(p.getMovementQueue().size(),0);untouched();
    const menu=p.getAttribute("crafting:jewellery-menu");assert.ok(menu);assert.equal(menu.amount,1);
    await c.dispatch([{type:"widget_action",widgetId:(446<<16)|component,groupId:446,childId:component,buttonNum:1,opId:1,slot:-1,itemId:-1}]);
    turn();snapshot("accepted-pending");
    assert.equal(p.getInterfaceId(),-1);assert.equal(p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE)?.isRunning(),true);
    assert.equal(openings.length,1);assert.equal(openings[0].accepted,true);assert.deepEqual(openings[0].pos,[3226,3218,0]);untouched();
    if(mode==="interrupt")await c.dispatch([{type:"move",worldX:3225,worldY:3217,modifierFlags:0,run:false}]);
    turn();snapshot("after-input-before-due");untouched();
    if(mode==="interrupt"){
      assert.deepEqual(pos(),[3225,3217,0]);assert.equal(p.getMovementQueue().size(),0);
      assert.equal(p.getMovementQueue().didMoveThisCycle(),true);assert.equal(p.getMovementQueue().isMovings(),true);
      assert.ok(p.getLocation().getDistance(menu.location)<=2,"anchor-radius refusal must not replace cancellation");
    }
    for(let i=0;i<5;i++)turn();
    const end=snapshot("completion-window");
    const cancelled=mode==="interrupt";
    assert.deepEqual(gains,cancelled?[]:[15],"pending gold-ring XP cancellation: "+JSON.stringify(end));
    assert.equal(total(ids.GOLD_BAR),cancelled?1:0);assert.equal(total(ids.GOLD_RING),cancelled?0:1);assert.equal(total(ids.RING_MOULD),1);
    assert.equal(p.getAttribute(Shared.CRAFTING_TASK_ATTRIBUTE),null);
    completed=true;
  });
});
