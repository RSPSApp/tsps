const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Spell } = require('../dist/game/content/combat/magic/Spell');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
let core;
const crafting = {};
const tasks = [];
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
    getAmount: id => amounts.get(id) ?? 0,
    contains: id => (amounts.get(id) ?? 0) > 0,
    deleteNumber: (id, n) => amounts.set(id, Math.max(0, (amounts.get(id) ?? 0) - n)),
    deletes: item => inventory.deleteNumber(item.id, item.getAmount()),
    addItem: item => amounts.set(item.id, (amounts.get(item.id) ?? 0) + item.getAmount()),
  };
  const sender = {
    sendSound(id) { log.push(['sound', id]); return sender; },
    sendSoundEffect(id) { log.push(['sound', id]); return sender; },
    sendConfig(id, value) { log.push(['config', id, value]); return sender; },
    sendSubInterface(uid, group) { log.push(['open', group]); return sender; },
    closeSubInterface() { log.push(['close']); return sender; },
    sendEnterAmountPrompt() { log.push(['quantity']); return sender; },
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
    performGraphic: gfx => log.push(['graphic',gfx.getId()]),
    getInterfaceId: () => player.interfaceId, setInterfaceId: id => { player.interfaceId = id; },
    setEnteredAmountAction: action => { player.amountAction = action; },
    getUsername: () => 'JewelleryTest', isPlayerBot: () => false,
    getLocation: () => player.location, isRegistered: () => true, getHitpoints: () => 99,
    getMovementQueue: () => ({ size: () => player.moving ? 1 : 0 }), getForceMovement: () => null,
  };
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
const enchantRecipes = [
  ['Lvl-1 Enchant', [[1637,2550],[1656,3853],[1694,1727]], [[564,1],[555,1]],17.5,719,114,136],
  ['Lvl-2 Enchant', [[1639,2552],[1658,5521],[1696,1729]], [[564,1],[556,3]],37,720,115,141],
  ['Lvl-3 Enchant', [[1641,2568],[1660,11194],[1698,1725]], [[564,1],[554,5]],59,721,116,145],
  ['Lvl-4 Enchant', [[1643,2570],[1662,11090],[1700,1731]], [[564,1],[557,10]],67,719,153,137],
  ['Lvl-5 Enchant', [[1645,2572],[1664,11113],[1702,1704]], [[564,1],[555,15],[557,15]],78,720,154,139],
  ['Lvl-6 Enchant', [[6575,6583],[6577,11128],[6581,6585]], [[564,1],[554,20],[557,20]],97,721,452,143],
  ['Lvl-7 Enchant', [[19538,19550],[19535,19547],[19541,19553]], [[564,1],[565,20],[566,20]],110,721,452,143],
];
test('all 21 enchant recipes use wearable cache jewellery and consume their runes', () => {
  for (const [spell,recipes,runes,xp,anim,gfx,sound] of enchantRecipes) for (const [input,output] of recipes) {
    const def = core.CacheDefinitions.getItem(input);
    assert.equal(def.noteTemplate,-1); assert.equal(def.placeholderTemplate,-1);
    assert.ok(def.inventoryActions.includes('Wear'), `${input} must be wearable`);
    const player = playerWith([[input,1],...runes]);
    assert.equal(cast(player,spell,input),true);
    assert.equal(player.amounts.get(output),1, `${spell} on ${input}`);
    assert.equal(player.amounts.get(input),0);
    for (const [id] of runes) assert.equal(player.amounts.get(id),0);
    for (const [kind,value] of [['xp',xp],['animation',anim],['graphic',gfx],['sound',sound]])
      assert.ok(player.log.some(row => row[0] === kind && row.at(-1) === value), `${kind} ${value}`);
  }
});
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
    p => p.setAttribute('magic:next-cast-at',Date.now()+10000),
    p => p.setAttribute('enchant-jewellery:next-cast-at',Date.now()+10000)]) {
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
    const player = playerWith([[2357,1],[mould,1],...(gems[index] ? [[gems[index],1]] : [])]);
    openFurnace(player); button(player,first+index); tick(tasks.at(-1),3);
    assert.equal(player.amounts.get(output),1,`component ${first+index}`);
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
test('all eight amulets string in either order with real identifiers and the live message', () => {
  for (const [input,output] of [[1673,1692],[1675,1694],[1677,1696],[1679,1698],[1681,1700],[1683,1702],[6579,6581],[19501,19541]]) for (const reverse of [false,true]) {
    const player = playerWith([[1759,1],[input,1]]);
    crafting.stringAmulet({player,usedItemId:reverse ? input : 1759,usedWithItemId:reverse ? 1759 : input});
    assert.equal(player.amounts.get(output),1);
    assert.ok(player.log.some(row => row[0] === 'message' && row[1] === 'You put some string on your amulet.'));
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
