// Run after `yarn build`: node --test tests/salve-amulet.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const registerSalve = require("../plugins/combat/effects/SalveAmulet.EquipmentEffects");
const registerJusticiar = require("../plugins/combat/effects/JusticiarArmour.EquipmentEffects");

// Gear is matched by item name; no cache is loaded here.
const NAMES = new Map([
  [ItemIds.SALVE_AMULET, "Salve amulet"],
  [ItemIds.SALVE_AMULET_E_, "Salve amulet (e)"],
  [ItemIds.SALVE_AMULET_I_, "Salve amulet(i)"],
  [ItemIds.SALVE_AMULET_EI_, "Salve amulet(ei)"],
  [ItemIdentifiers.SLAYER_HELMET, "Slayer helmet"],
]);
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? "" });

function undeadTarget(undead) {
  const attributes = undead ? ["undead"] : [];
  return {
    isNpc: () => true,
    getAsNpc: () => ({
      getCurrentDefinition: () => ({ isUndead: () => undead, hasAttribute: (a) => attributes.includes(a) }),
    }),
  };
}

function createPlayer({ amulet = -1, head = -1, undead = true } = {}) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.AMULET_SLOT] = { getId: () => amulet };
  items[Equipment.HEAD_SLOT] = { getId: () => head };
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }),
    getCombat: () => ({ getTarget: () => undeadTarget(undead) }),
  };
}

/** A fake plugin api keeping each modifier and passing custom events between plugins. */
function fakeApi(extra = {}) {
  const modifiers = {};
  const listeners = new Map();
  const set = (kind) => (fn) => { modifiers[kind] = fn; };
  const api = {
    registerMeleeAttackAccuracyModifier: set("meleeAccuracy"),
    registerMeleeHitModifier: set("meleeHit"),
    registerRangedAttackAccuracyModifier: set("rangedAccuracy"),
    registerRangedHitModifier: set("rangedHit"),
    registerMagicAttackAccuracyModifier: set("magicAccuracy"),
    registerMagicAccuracyPercentModifier: set("magicAccuracyPercent"),
    registerMagicHitModifier: set("magicHit"),
    registerMagicDamageBonusModifier: set("magicDamageBonus"),
    onCustomEvent: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    emitCustomEvent: (name, payload) => { for (const fn of listeners.get(name) ?? []) fn(payload); },
    ...extra,
  };
  return { api, modifiers };
}

const { api: salveApi, modifiers: salve } = fakeApi();
registerSalve(salveApi);
void registerJusticiar;

test("salve amulets boost the right styles against undead only", () => {
  const base = createPlayer({ amulet: ItemIds.SALVE_AMULET });
  assert.equal(salve.meleeHit(base, 600), 700, "1/6 melee");
  assert.equal(salve.rangedHit(base, 100), 100, "plain salve does not help ranged");
  assert.equal(salve.magicDamageBonus(base, 0), 0);

  const enchanted = createPlayer({ amulet: ItemIds.SALVE_AMULET_E_ });
  assert.equal(salve.meleeHit(enchanted, 100), 120, "20% melee");
  assert.equal(salve.rangedHit(enchanted, 100), 100);

  const imbued = createPlayer({ amulet: ItemIds.SALVE_AMULET_I_ });
  assert.equal(salve.rangedHit(imbued, 100), 116, "7/6, rounded down");
  assert.equal(salve.magicDamageBonus(imbued, 0), 150, "+15% magic damage, in permille");
  assert.equal(salve.magicAccuracyPercent(imbued, 0), 15, "+15 additive magic accuracy points");
  assert.equal(salve.magicAccuracyPercent(createPlayer({ amulet: ItemIds.SALVE_AMULET_EI_ }), 10), 30, "adds to points already there");

  const enchantedImbued = createPlayer({ amulet: ItemIds.SALVE_AMULET_EI_ });
  assert.equal(salve.rangedHit(enchantedImbued, 100), 120);
  assert.equal(salve.magicDamageBonus(enchantedImbued, 0), 200);

  const living = createPlayer({ amulet: ItemIds.SALVE_AMULET_EI_, undead: false });
  assert.equal(salve.meleeHit(living, 100), 100, "not undead, no bonus");
  assert.equal(salve.magicDamageBonus(createPlayer({ amulet: -1 }), 0), 0, "no amulet, no bonus");
});

test("a salve amulet suppresses the slayer helmet bonus on undead targets", () => {
  const { api, modifiers } = fakeApi({
    core: { ItemIdentifiers, Skill, Equipment, ItemDefinition, hitTargetOf: require("../dist/game/content/combat/EquipmentEffects").hitTargetOf },
    onItemOnItem() {},
    onItemAction() {},
    onPlayerDeathItemDrop() {},
    onPlayerDeathDrops() {},
  });
  api.onCustomEvent("slayer:on-task", (request) => { request.onTask = true; });
  registerSalve(api);
  const SlayerHelmet = require("../plugins/items/SlayerHelmet.plugin");
  SlayerHelmet.register(api);

  const undead = createPlayer({ amulet: ItemIdentifiers.SALVE_AMULET_E_, head: ItemIdentifiers.SLAYER_HELMET });
  // The last registered melee modifier is the helmet's; the salve's own bonus is tested above.
  assert.equal(modifiers.meleeHit(undead, 42), 42, "salve wins, no slayer helmet stack");

  const living = createPlayer({ amulet: ItemIdentifiers.SALVE_AMULET_E_, head: ItemIdentifiers.SLAYER_HELMET, undead: false });
  assert.equal(modifiers.meleeHit(living, 42), 49, "against living targets the helmet still applies");
});

test('salve scroll imbues use Arena IDs, consume one scroll, preserve metadata and refund only their own method',()=>{
 const {Item}=require('../dist/game/model/Item');
 const I=require('../dist/util/ItemIdentifiers').ItemIdentifiers;
 let use,yes;const actions=new Map();
 require('../plugins/items/SalveAmulet.plugin').register({core:{Item,ItemIdentifiers:I},
  onItemOnItem:h=>use=h,onItemAction:(name,a)=>actions.set(name,a.Uncharge),
  sendMultiChatboxPrompt:(p,title,y,accept)=>yes=accept});
 function fixture(base,scrollId=I.SCROLL_OF_IMBUING){
  const item=new Item(base,1,{sentinel:true}),scroll=new Item(scrollId,2);const items=[item,scroll];let space=true;
  const inventory={getItems:()=>items,deleteNumber:(id,n)=>{const x=items.find(i=>i.getId()===id);x.setAmount(x.getAmount()-n);},
   refreshItems:()=>{},getAddableAmount:()=>space?1:0,full:()=>{},add:x=>items.push(x)};
  return {item,scroll,items,p:{getInventory:()=>inventory,sendMessage:()=>{}},space:v=>space=v};
 }
 for(const [base,result] of [[I.SALVE_AMULET,I.SALVE_AMULET_I__5],[I.SALVE_AMULET_E_,I.SALVE_AMULET_EI__5]])
 for(const reverse of [false,true]) for(const scrollId of [I.SCROLL_OF_IMBUING,I.SCROLL_OF_IMBUING_2]){
  const f=fixture(base,scrollId);const e={player:f.p,usedItem:reverse?f.item:f.scroll,usedWithItem:reverse?f.scroll:f.item,
   usedItemId:reverse?base:scrollId,usedWithItemId:reverse?scrollId:base};use(e);
  assert.equal(e.handled,true);assert.equal(f.item.getId(),result);assert.equal(f.scroll.getAmount(),1);assert.equal(f.item.getMetaValue('sentinel'),true);
  const uncharge=actions.get(base===I.SALVE_AMULET?'Salve amulet(i)':'Salve amulet(ei)');
  assert.equal(uncharge({player:f.p,item:f.item}),true);f.space(false);yes();assert.equal(f.item.getId(),result);
  f.space(true);yes();assert.equal(f.item.getId(),base);assert.equal(f.items.at(-1).getId(),I.SCROLL_OF_IMBUING);
  const length=f.items.length;yes();assert.equal(f.items.length,length,'stale confirmation cannot refund twice');
 }
 for(const id of [I.SALVE_AMULET_I_,I.SALVE_AMULET_EI_,I.SALVE_AMULET_I__3,I.SALVE_AMULET_EI__3]){
  const f=fixture(id);assert.equal(actions.get('Salve amulet(i)')({player:f.p,item:f.item}),false);
 }
 const f=fixture(I.SALVE_AMULET);f.items.splice(1,1);const e={player:f.p,usedItem:f.scroll,usedWithItem:f.item,usedItemId:I.SCROLL_OF_IMBUING,usedWithItemId:I.SALVE_AMULET};
 use(e);assert.equal(f.item.getId(),I.SALVE_AMULET);assert.notEqual(e.handled,true,'missing scroll cannot imbue');
});

// Exercise real API registration and dispatch: an invented API method must fail this test.
test('salve Uncharge registers and dispatches through the real PluginManager API', async (t) => {
  const { PluginManager: PM } = require('../dist/plugins/PluginManager');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { Item } = require('../dist/game/model/Item');
  const I = ItemIdentifiers;
  const api = PM.createApi('SalveAmulet');
  let confirm;
  t.mock.method(api, 'sendMultiChatboxPrompt', (player, title, yes, accept) => { confirm = accept; });
  await CachePipeline.initialize();
  const actions = PM.itemActionHooks.length, items = PM.itemOnItemHooks.length;
  t.after(() => { PM.itemActionHooks.length = actions; PM.itemOnItemHooks.length = items; });
  assert.doesNotThrow(() => require('../plugins/items/SalveAmulet.plugin').register(api));
  for (const [imbued, base] of [[I.SALVE_AMULET_I__5, I.SALVE_AMULET], [I.SALVE_AMULET_EI__5, I.SALVE_AMULET_E_]]) {
    const item = new Item(imbued, 1), inventoryItems = [item];
    const inventory = { getItems: () => inventoryItems, getAmount: () => 1, getAddableAmount: () => 1,
      add: scroll => inventoryItems.push(scroll), refreshItems() {} };
    const player = { getInventory: () => inventory };
    const clickType = CacheDefinitions.getItem(imbued).inventoryActions.indexOf("Uncharge") + 1;
    assert.ok(clickType > 0, "live cache exposes Uncharge");
    const event = {player, item, itemId: imbued, slot: 0, clickType, interfaceId: 3214, handled: false};
    confirm = undefined;
    assert.equal(PM.emitItemAction(event), true);
    assert.equal(typeof confirm, 'function', 'real Uncharge dispatch reaches the confirmation');
    confirm();
    assert.equal(item.getId(), base);
    assert.equal(inventoryItems[1].getId(), I.SCROLL_OF_IMBUING);
    assert.equal(inventoryItems[1].getAmount(), 1);
    confirm();
    assert.equal(inventoryItems.length, 2, 'same confirmation cannot refund twice');
  }
});
