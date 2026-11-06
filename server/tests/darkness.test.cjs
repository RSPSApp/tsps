// Run after `yarn build`: node --test tests/darkness.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

test("light sources and the darkness timer follow the OSRS Wiki", () => {
  const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
  const Darkness = require("../plugins/world/Darkness.plugin");
  const {
    hasLightSource,
    darknessTickMessage,
    takesDarknessDamage,
    DARKNESS_WARNING_TICKS,
    DARKNESS_SWARM_TICKS,
  } = Darkness;

  // The Skillcapes plugin answers this; a carried or worn Firemaking cape is all this test needs.
  const firemakingCapes = [I.FIREMAKING_CAPE, I.FIREMAKING_CAPE_T_];
  Darkness.register({
    registerArea: () => {},
    log: () => {},
    core: { Area: class {} },
    emitCustomEvent(name, request) {
      if (name !== "skillcape:has-perk" || request.skill !== "FIREMAKING") return;
      const held = [...request.player.getInventory().getItems(), ...request.player.getEquipment().getItems()];
      request.result = held.some((item) => firemakingCapes.includes(item.getId()));
    },
  });

  const fakePlayer = ({ inventory = [], equipment = [] } = {}) => ({
    getInventory: () => ({ getItems: () => inventory.map((id) => ({ getId: () => id })) }),
    getEquipment: () => ({ getItems: () => equipment.map((id) => ({ getId: () => id })) }),
  });

  // Carried lights work from the inventory; unlit variants never count.
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.LIT_CANDLE] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.CANDLE] })), false);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.LIT_TORCH] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.UNLIT_TORCH] })), false);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.LIT_BLACK_CANDLE] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.OIL_LAMP] })), false);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.OIL_LAMP_3] })), true);

  // The firemaking cape is an inextinguishable light source equipped or carried.
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.FIREMAKING_CAPE] })), true);
  assert.equal(hasLightSource(fakePlayer({ equipment: [I.FIREMAKING_CAPE_T_] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.FIREMAKING_HOOD] })), false);

  // Worn lamps only work while equipped.
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.MINING_HELMET] })), false);
  assert.equal(hasLightSource(fakePlayer({ equipment: [I.MINING_HELMET] })), true);
  assert.equal(hasLightSource(fakePlayer({ inventory: [I.KANDARIN_HEADGEAR_1] })), false);
  assert.equal(hasLightSource(fakePlayer({ equipment: [I.KANDARIN_HEADGEAR_1] })), true);
  assert.equal(hasLightSource(fakePlayer()), false);

  // 9s warning, 18s swarm, then 1 damage per tick.
  assert.equal(darknessTickMessage(DARKNESS_WARNING_TICKS - 1), null);
  assert.equal(
    darknessTickMessage(DARKNESS_WARNING_TICKS),
    "You hear tiny insects skittering over the ground..."
  );
  assert.equal(darknessTickMessage(DARKNESS_SWARM_TICKS), "Tiny biting insects swarm all over you!");
  assert.equal(takesDarknessDamage(DARKNESS_WARNING_TICKS), false);
  assert.equal(takesDarknessDamage(DARKNESS_SWARM_TICKS - 1), false);
  assert.equal(takesDarknessDamage(DARKNESS_SWARM_TICKS), true);
});

test("the caves warn, swarm and damage an unlit player until a light is lit", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
  const Darkness = require("../plugins/world/Darkness.plugin");

  const core = PluginManager.getCoreApi();
  let area = null;
  Darkness.register({
    core,
    registerArea: (registered) => { area = registered; },
    log: () => {},
    emitCustomEvent: () => {},
  });
  assert.ok(area, "dark area registered");

  const attributes = new Map();
  const messages = [];
  const damage = [];
  const inventory = [];
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({ getItems: () => inventory.map((id) => ({ getId: () => id })) }),
    getEquipment: () => ({ getItems: () => [] }),
    sendMessage: (message) => messages.push(message),
    getCombat: () => ({
      getHitQueue: () => ({ addPendingDamage: (hits) => damage.push(...hits) }),
    }),
  };

  for (let tick = 0; tick < 14; tick++) area.process(player);
  assert.equal(messages.length, 0, "silent for the first 9 seconds");
  assert.equal(damage.length, 0);

  area.process(player); // tick 15
  assert.deepEqual(messages, ["You hear tiny insects skittering over the ground..."]);

  for (let tick = 15; tick < 29; tick++) area.process(player);
  assert.equal(damage.length, 0, "no damage before 18 seconds");

  area.process(player); // tick 30
  assert.equal(messages[1], "Tiny biting insects swarm all over you!");
  assert.equal(damage.length, 1, "one damage on the swarm tick");
  area.process(player);
  assert.equal(damage.length, 2, "one damage per tick after");

  inventory.push(I.LIT_CANDLE);
  area.process(player);
  assert.equal(damage.length, 2, "lighting a source stops the damage");
  assert.equal(attributes.get("darkness:no-light-ticks"), undefined);

  inventory.length = 0;
  for (let tick = 0; tick < 30; tick++) area.process(player);
  assert.ok(damage.length > 2, "timer restarts when the light goes away");

  area.postLeave(player);
  assert.equal(attributes.get("darkness:no-light-ticks"), undefined);
});

test('A sapphire lantern is assembled, fuelled at its still, lit and extinguished with actual ingredients', () => {
 const {PluginManager}=require('../dist/plugins/PluginManager'),core=PluginManager.getCoreApi(),I=core.ItemIdentifiers;
 const hooks={pairs:[],object:null,actions:new Map()},items=[],attrs=new Map(),bits=new Map(),events=[];let currentCraft=99,maxCraft=99,fire=48;
 const item=id=>({id,getId(){return this.id;},setId(id){this.id=id;return this;}});
 const inv={getItems:()=>items,contains:id=>items.some(i=>i.getId()===id),deleteNumber:(id,n)=>{while(n--){const i=items.findIndex(i=>i.getId()===id);assert(i>=0);items.splice(i,1);}},adds:(id,n)=>{while(n--)items.push(item(id));},refreshItems(){}};
 const player={getPacketSender:()=>({sendVarbit:(id,v)=>bits.set(id,v)}),getInventory:()=>inv,getEquipment:()=>({getItems:()=>[]}),getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),getSkillManager:()=>({getCurrentLevel:s=>s===core.Skill.CRAFTING?currentCraft:fire,getMaxLevel:()=>maxCraft}),performAnimation(){},sendMessage(){}};
 require('../plugins/items/OilLights.plugin').register({core:{...core,ObjectDefinition:{forPlayer:id=>{assert.equal(id,5908);return {getName:()=> 'Lamp oil still'};}}},persistAttribute(){},emitCustomEvent:(name,event)=>events.push({name,...event}),onPlayerLogin:h=>hooks.login=h,onItemOnItem:h=>hooks.pairs.push(h),onItemOnObject:h=>hooks.object=h,onItemAction:(name,actions)=>hooks.actions.set(name,actions)});
 const pair=(a,b)=>{const e={player,usedItemId:a,usedWithItemId:b,usedItem:items.find(i=>i.getId()===a),usedWithItem:items.find(i=>i.getId()===b)};for(const h of hooks.pairs){h(e);if(e.handled)break;}return e;};
 const still=x=>({getId:()=>5908,getDefinition:()=>({getName:()=> 'null'}),getLocation:()=>new core.Location(x,3300,0)});
 const fuel=(id,x=2900)=>hooks.object({player,itemId:id,object:still(x)});
 for(const id of[I.BULLSEYE_LANTERN_UNF_,I.LANTERN_LENS,I.SAPPHIRE,I.SWAMP_TAR,I.TINDERBOX])items.push(item(id));
 pair(I.BULLSEYE_LANTERN_UNF_,I.LANTERN_LENS);assert(inv.contains(I.BULLSEYE_LANTERN_EMPTY_));
 currentCraft=30;maxCraft=19;pair(I.SAPPHIRE,I.BULLSEYE_LANTERN_EMPTY_);assert(inv.contains(I.SAPPHIRE),'finished lantern lens swap is unboostable');
 maxCraft=20;pair(I.SAPPHIRE,I.BULLSEYE_LANTERN_EMPTY_);assert(inv.contains(I.SAPPHIRE_LANTERN));assert(inv.contains(I.LANTERN_LENS));assert(!inv.contains(I.SAPPHIRE));
 fuel(I.SAPPHIRE_LANTERN);assert(inv.contains(I.SAPPHIRE_LANTERN),'empty still gives no fuel');
 fuel(I.SWAMP_TAR);assert(!inv.contains(I.SWAMP_TAR));fuel(I.SAPPHIRE_LANTERN,2901);assert(inv.contains(I.SAPPHIRE_LANTERN),'oil stays in its own still');fuel(I.SAPPHIRE_LANTERN);assert(inv.contains(I.SAPPHIRE_LANTERN_2));
 pair(I.TINDERBOX,I.SAPPHIRE_LANTERN_2);assert(inv.contains(I.SAPPHIRE_LANTERN_2),'lighting requires 49 Firemaking');fire=49;pair(I.TINDERBOX,I.SAPPHIRE_LANTERN_2);assert(inv.contains(I.SAPPHIRE_LANTERN_3));assert(inv.contains(I.TINDERBOX));
 assert.deepEqual(events,[{name:'oil-lights:lit',player,itemId:I.SAPPHIRE_LANTERN_3}],'only the successful lighting emits the event');
 assert(require('../plugins/world/Darkness.plugin').hasLightSource(player));hooks.actions.get('Sapphire lantern').Extinguish({player,item:items.find(i=>i.getId()===I.SAPPHIRE_LANTERN_3)});assert(inv.contains(I.SAPPHIRE_LANTERN_2));assert(!require('../plugins/world/Darkness.plugin').hasLightSource(player));assert.equal(events.length,1,'extinguishing adds no lighting event');
 attrs.set('oil-lights:distilled-oil','2937,3210,0');hooks.login({player});assert.equal(bits.get(281),1);attrs.set('oil-lights:distilled-oil',0);hooks.login({player});assert.equal(bits.get(281),0);
 maxCraft=49;pair(I.LANTERN_LENS,I.SAPPHIRE_LANTERN_2);assert(inv.contains(I.BULLSEYE_LANTERN));assert(inv.contains(I.SAPPHIRE));
});
