const assert = require("node:assert/strict");
const path = require("node:path");
const {before, after, test} = require("node:test");
// The bots spawn on load, which keeps the process alive after the tests, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline} = require("../dist/game/cache/CachePipeline");
const {PluginManager: PM} = require("../dist/plugins/PluginManager");
const {Player} = require("../dist/game/entity/impl/player/Player");
const {PlayerSession} = require("../dist/net/PlayerSession");
const {ClientConnection} = require("../dist/net/NetworkBuilder");
const Daily = require("../plugins/items/diaryrewards/DailyRing.DiaryRewards");
let core, index = 400;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
const id = name => core.CacheDefinitions.getObjId(name);
const uid = name => core.CacheDefinitions.getComponentId(name);
function actor(t, tier = "elite") {
  const channel = {kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);p.setUsername("ringalch"+index);p.setRegistered(true);p.needsPlacement=false;
  p.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  const c = new ClientConnection(channel);c.player=p;
  const ring = new core.Item(id("lumbridge_ring_"+tier));
  p.getInventory().add(ring,false);
  const ringItem = p.getInventory().forSlot(0);
  const messages=[];
  t.mock.method(p.getPacketSender(),"sendMessage",m=>{messages.push(m);return p.getPacketSender();});
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);});
  const open = async () => {
    const d=core.CacheDefinitions.getItem(ring.getId());
    let option="Alchemy", clickType=d.inventoryActions.indexOf(option)+1,subOpId;
    if(!clickType){option="Functions";clickType=d.inventoryActions.indexOf(option)+1;subOpId=d.subops[clickType-1].indexOf("Alchemy")+1;}
    const w=uid("inventory:items"); await c.dispatch([{type:"widget_action",widgetId:w,groupId:w>>>16,childId:w&65535,buttonNum:[2,3,4,6,7][clickType-1],slot:0,itemId:ring.getId(),subOpId}]);c.processTurnPackets();
  };
  return {p,c,open,messages};
}
async function click(f,name,slot,itemId,action=1) {
  const w=uid("lumbridge_alchemy:"+name);
  await f.c.dispatch([{type:"widget_action",widgetId:w,groupId:w>>>16,childId:w&65535,buttonNum:action,slot,itemId}]);
  f.c.processTurnPackets();
}
function target(f,name="bronze_dagger") {
  const itemId=id(name);f.p.getInventory().add(new core.Item(itemId),false);
  return {itemId,slot:f.p.getInventory().getItems().findIndex(i=>i.getId()===itemId)};
}
const cast = (f, x) => click(f,"items",x.slot,x.itemId);
const used = f => Daily.uses(f.p,Daily.ALCHEMY_KEY);
async function resume(f, widgetId, childIndex) {
  await f.c.dispatch([{type:"dialogue_continue",widgetId,childIndex}]);f.c.processTurnPackets();
}
test("ring Alchemy opens native panel and both spells use shared free charges without XP",async t=>{
  const f=actor(t);await f.open();
  assert.equal(f.p.getPacketSender().isSubInterfaceOpen(core.CacheDefinitions.getInterfaceId("lumbridge_alchemy")),true);
  const x=target(f), xp=f.p.getSkillManager().getExperience(core.Skill.MAGIC);
  const low=core.ItemDefinition.forId(x.itemId).getLowAlchValue();
  await cast(f,x);
  assert.equal(used(f),1);assert.equal(f.p.getInventory().getAmount(id("coins")),low);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),xp);
  f.p.setAttribute("magic:alchemy-next-cast",0);
  await click(f,"high");
  const y=target(f);await cast(f,y);
  assert.equal(used(f),2);
  assert.equal(f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("lumbridge_free_alchs")),2);
});
test("lower rings deny high alchemy; magic levels and other spellbooks are respected",async t=>{
  for(const tier of ["easy","medium","hard"]){
    const f=actor(t,tier);await f.open();await click(f,"high");
    assert.equal(f.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("lumbridge_alchemy_high")),0);
    f.p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,20,false);
    const x=target(f);await cast(f,x);assert.equal(used(f),0);assert.equal(f.p.getInventory().getAmount(x.itemId),1);
    f.p.getSkillManager().setCurrentLevel(core.Skill.MAGIC,21,false);
    f.p.setSpellbook(core.MagicSpellbook.ANCIENT);
    await cast(f,x);assert.equal(used(f),1,tier);
  }
});
test("thirtieth free cast succeeds, exhausted and ring-self casts preserve all items",async t=>{
  const f=actor(t);f.p.setAttribute(Daily.DAILY_ATTRIBUTE,{day:"2026-10-27",energy:0,alchemy:29});await f.open();
  await cast(f,{slot:0,itemId:id("lumbridge_ring_elite")});assert.equal(used(f),29);
  const x=target(f);await cast(f,x);assert.equal(used(f),30);
  f.p.setAttribute("magic:alchemy-next-cast",0);const y=target(f);await cast(f,y);
  assert.equal(used(f),30);assert.equal(f.p.getInventory().getAmount(y.itemId),1);
});
test("stale panel, replaced ring, dead, trade and forged item clicks cannot spend charges",async t=>{
  for(const mode of ["panel","ring","dead","trade","forged"]){
    const f=actor(t);await f.open();const x=target(f);
    if(mode==="panel")f.p.getPacketSender().sendSubInterface(uid("toplevel_osrs_stretch:side3"),core.CacheDefinitions.getInterfaceId("inventory"),1);
    if(mode==="ring")f.p.getInventory().setItem(0,new core.Item(id("lumbridge_ring_elite")));
    if(mode==="dead")f.p.setHitpoints(0);
    if(mode==="trade")f.p.setStatus(core.PlayerStatus.TRADING);
    await cast(f,mode==="forged"?{...x,itemId:id("coins")}:x);
    assert.equal(used(f),0,mode);assert.equal(f.p.getInventory().getAmount(x.itemId),1,mode);
  }
});
test("coin stack overflow refuses the free cast without removing its item",async t=>{
  const f=actor(t);f.p.getInventory().add(new core.Item(id("coins"),2147483647),false);await f.open();const x=target(f);
  await cast(f,x);assert.equal(used(f),0);assert.equal(f.p.getInventory().getAmount(x.itemId),1);
});
test("normal casts prefer complete rune payment; partial supplies fall back untouched with zero XP",t=>{
  const f=actor(t), inv=f.p.getInventory(), nature=core.ItemIdentifiers.NATURE_RUNE, fire=core.ItemIdentifiers.FIRE_RUNE;
  inv.add(new core.Item(nature,2),false);inv.add(new core.Item(fire,5),false);
  let x=target(f), before=f.p.getSkillManager().getExperience(core.Skill.MAGIC);
  core.castAlchemy(f.p,"High Level Alchemy",x.itemId,x.slot);
  assert.equal(used(f),0);assert.equal(inv.getAmount(nature),1);assert.equal(inv.getAmount(fire),0);
  assert.ok(f.p.getSkillManager().getExperience(core.Skill.MAGIC)>before);
  inv.add(new core.Item(fire,3),false);f.p.setAttribute("magic:alchemy-next-cast",0);
  x=target(f);before=f.p.getSkillManager().getExperience(core.Skill.MAGIC);
  core.castAlchemy(f.p,"High Level Alchemy",x.itemId,x.slot);
  assert.equal(used(f),1);assert.equal(inv.getAmount(nature),1);assert.equal(inv.getAmount(fire),3);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.MAGIC),before);
});
test("normal fallback cannot bypass spellbook rules and accepts a worn ring",async t=>{
  const f=actor(t),inv=f.p.getInventory(),ring=inv.forSlot(0).clone();
  inv.deleteAtSlot(0);f.p.getEquipment().setItem(core.Equipment.RING_SLOT,ring);
  const x=target(f);f.p.setSpellbook(core.MagicSpellbook.ANCIENT);
  core.castAlchemy(f.p,"High Level Alchemy",x.itemId,x.slot);assert.equal(used(f),0);
  f.p.setSpellbook(core.MagicSpellbook.NORMAL);
  core.castAlchemy(f.p,"High Level Alchemy",x.itemId,x.slot);assert.equal(used(f),1);
  await f.c.dispatch([{type:"widget_action",widgetId:(387<<16)|24,groupId:387,childId:24,buttonNum:4}]);f.c.processTurnPackets();
  assert.equal(f.p.getPacketSender().isSubInterfaceOpen(core.CacheDefinitions.getInterfaceId("lumbridge_alchemy")),true);
});
test("queued free casts reject a same-id replacement or closed panel",async t=>{
  for(const mode of ["item","panel","logout"]){
    const f=actor(t),tasks=[];t.mock.method(core.TaskManager,"submit",task=>tasks.push(task));
    t.mock.method(core.World,"getProcessCycle",()=>1000);
    await f.open();let x=target(f);await cast(f,x);assert.equal(used(f),1);
    x=target(f);await cast(f,x);assert.equal(used(f),1);assert.equal(tasks.length,1);
    if(mode==="item")f.p.getInventory().setItem(x.slot,new core.Item(x.itemId));
    if(mode==="panel")await click(f,"close");
    if(mode==="logout")PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
    t.mock.method(core.World,"getProcessCycle",()=>1005);tasks[0].execute();
    assert.equal(used(f),1,mode);assert.equal(f.p.getInventory().getAmount(x.itemId),1,mode);
    t.mock.restoreAll();
  }
});
test("item used on ring warns by default and the native disabled-warning bit permits the cast",async t=>{
  const f=actor(t),x=target(f);
  const use=async()=>{await f.c.dispatch([{type:"inventory_use_on",slot:x.slot,itemId:x.itemId,target:{kind:"inventory",slot:0,itemId:id("lumbridge_ring_elite")}}]);f.c.processTurnPackets();};
  await use();assert.equal(used(f),0);assert.equal(f.p.getPacketSender().isChatboxInterface(219),true);
  f.p.getPacketSender().sendInterfaceRemoval();
  f.p.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId("alchemy_warning_forinventory_disabled"),1);
  await use();assert.equal(used(f),1);
});
test("native All Settings inventory-alchemy warning toggle persists and restores",async t=>{
  const f=actor(t),rows=[];
  for(const [,st]of [...core.CacheDefinitions.getEnumValues(422)].sort(([a],[b])=>a-b)){
    const cat=core.CacheDefinitions.getStructParams(st);
    for(const [,row]of [...core.CacheDefinitions.getEnumValues(cat.get(745))].sort(([a],[b])=>a-b)) rows.push(core.CacheDefinitions.getStructParams(row).get(1077));
  }
  require("../plugins/interface/Settings.plugin").openAllSettings(f.p);
  f.p.setAttribute("settings-view",-1);
  const w=(134<<16)|20;
  await f.c.dispatch([{type:"widget_action",widgetId:w,groupId:134,childId:20,buttonNum:1,slot:rows.indexOf(432)}]);f.c.processTurnPackets();
  const warning=core.CacheDefinitions.getVarbitId("alchemy_warning_forinventory_disabled");
  assert.equal(f.p.getPacketSender().getVarbit(warning),1);
  assert.equal(f.p.getAttribute("settings:values")["varbit:"+warning],1);
  f.p.getPacketSender().sendVarbit(warning,0);
  PM.emitPlayerLogin({player:f.p,username:f.p.getUsername(),isNewAccount:false});
  assert.equal(f.p.getPacketSender().getVarbit(warning),1);
});
test("real untradeable confirmation accepts, cancels and rejects same-id replacement",async t=>{
  for(const mode of ["accept","cancel","replace"]){
    const f=actor(t);await f.open();const itemId=core.ItemIdentifiers.FIRE_CAPE;
    f.p.getInventory().add(new core.Item(itemId),false);
    const slot=f.p.getInventory().getItems().findIndex(i=>i.getId()===itemId);
    await cast(f,{slot,itemId});assert.equal(used(f),0);
    assert.equal(f.p.getPacketSender().isChatboxInterface(193),true,JSON.stringify({messages:f.messages,high:core.ItemDefinition.forId(itemId).getHighAlchValue(),low:core.ItemDefinition.forId(itemId).getLowAlchValue(),tradeable:core.ItemDefinition.forId(itemId).isTradeable()}));
    await resume(f,193<<16,1);
    assert.equal(f.p.getPacketSender().isChatboxInterface(219),true);
    if(mode==="replace")f.p.getInventory().setItem(slot,new core.Item(itemId));
    await resume(f,(219<<16)|1,mode==="cancel"?2:1);
    assert.equal(used(f),mode==="accept"?1:0,mode);
    assert.equal(f.p.getInventory().getAmount(itemId),mode==="accept"?0:1,mode);
  }
});
test("exact clicked slot preserves earlier metadata and preset-protected copies",async t=>{
  const f=actor(t),itemId=id("bronze_dagger"),inv=f.p.getInventory();
  const protectedItem=new core.Item(itemId);protectedItem.setMetaValue(core.Item.UNTRADEABLE_META,true);protectedItem.setMetaValue("test:marker","keep");
  inv.add(protectedItem,false);await f.open();
  const x=target(f);x.slot=inv.getItems().findLastIndex(i=>i.getId()===itemId);
  await cast(f,x);assert.equal(used(f),1);assert.equal(inv.getAmount(itemId),1);
  assert.equal(inv.getItems().find(i=>i.getId()===itemId).getMetaValue("test:marker"),"keep");
});
test("one queued free cast succeeds once when its cooldown ends",async t=>{
  const f=actor(t),tasks=[];t.mock.method(core.TaskManager,"submit",task=>tasks.push(task));
  t.mock.method(core.World,"getProcessCycle",()=>1000);
  await f.open();let x=target(f);await cast(f,x);x=target(f);await cast(f,x);await cast(f,x);
  assert.equal(used(f),1);assert.equal(tasks.length,1);
  t.mock.method(core.World,"getProcessCycle",()=>1005);tasks[0].execute();
  assert.equal(used(f),2);assert.equal(f.p.getInventory().getAmount(x.itemId),0);
  tasks[0].execute();assert.equal(used(f),2);
});

test("queued item-on-ring alchemy rejects a real bank remove-and-return stack",async t=>{
  const f=actor(t),tasks=[];t.mock.method(core.TaskManager,"submit",task=>tasks.push(task));
  t.mock.method(core.World,"getProcessCycle",()=>1000);
  const arrows=id("rune_arrow"),inv=f.p.getInventory();inv.add(new core.Item(arrows,11),false);
  const slot=inv.getSlotForItemId(arrows);
  f.p.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId("alchemy_warning_forinventory_disabled"),1);
  const use=async()=>{await f.c.dispatch([{type:"inventory_use_on",slot,itemId:arrows,target:{kind:"inventory",slot:0,itemId:id("lumbridge_ring_elite")}}]);f.c.processTurnPackets();};
  await use();await use();assert.equal(used(f),1);assert.equal(inv.getAmount(arrows),10);assert.equal(tasks.length,1);
  const retained=inv.forSlot(slot);f.p.getBank(0).open();assert.equal(core.Bank.isOpen(f.p),true);
  core.Bank.deposit(f.p,arrows,slot,10,false);assert.equal(inv.getAmount(arrows),0);
  const tab=core.Bank.getTabForItem(f.p,arrows),bank=f.p.getBank(tab);
  core.Bank.withdraw(f.p,arrows,bank.getSlotForItemId(arrows),10,tab);
  assert.equal(inv.getAmount(arrows),10);assert.equal(inv.getSlotForItemId(arrows),slot);
  f.p.getPacketSender().sendInterfaceRemoval();
  t.mock.method(core.World,"getProcessCycle",()=>1005);tasks[0].execute();
  assert.equal(used(f),1,"replacement stack must not spend another daily charge");assert.equal(inv.getAmount(arrows),10);
  assert.notEqual(inv.forSlot(slot),retained,"a newly filled empty stack has a fresh identity");
});

test("confirmed item-on-ring cast rejects actual emptied/refilled stack; existing stack merges retain identity",async t=>{
  const f=actor(t),arrows=id("rune_arrow"),inv=f.p.getInventory();inv.add(new core.Item(arrows,10),false);
  const slot=inv.getSlotForItemId(arrows),original=inv.forSlot(slot);
  inv.add(new core.Item(arrows,5),false);assert.equal(inv.forSlot(slot),original);assert.equal(inv.getAmount(arrows),15);
  await f.c.dispatch([{type:"inventory_use_on",slot,itemId:arrows,target:{kind:"inventory",slot:0,itemId:id("lumbridge_ring_elite")}}]);f.c.processTurnPackets();
  assert.equal(f.p.getPacketSender().isChatboxInterface(219),true);
  inv.deleteNumber(arrows,15);inv.add(new core.Item(arrows,15),false);
  await resume(f,(219<<16)|1,1);assert.equal(used(f),0);assert.equal(inv.getAmount(arrows),15);
});
test("real save restores both shared charges and selected spell into a fresh player",async t=>{
  const f=actor(t);await f.open();await click(f,"high");const x=target(f);await cast(f,x);
  const {PlayerSave}=require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const saved=PlayerSave.fromPlayer(f.p),g=actor(t);
  saved.applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});
  assert.equal(used(g),1);assert.equal(g.p.getAttribute("diary-rewards:alchemy-high"),true);
  await g.open();assert.equal(g.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("lumbridge_alchemy_high")),1);
  assert.equal(g.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("lumbridge_free_alchs")),1);
});
test("native item-on-ring prompt accepts, cancels and cannot resume after logout",async t=>{
  for(const mode of ["accept","cancel","logout"]){
    const f=actor(t),x=target(f);
    await f.c.dispatch([{type:"inventory_use_on",slot:x.slot,itemId:x.itemId,target:{kind:"inventory",slot:0,itemId:id("lumbridge_ring_elite")}}]);f.c.processTurnPackets();
    assert.equal(used(f),0);assert.equal(f.p.getPacketSender().isChatboxInterface(219),true);
    if(mode==="logout")PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
    await resume(f,(219<<16)|1,mode==="cancel"?2:1);
    assert.equal(used(f),mode==="accept"?1:0,mode);
  }
});

// Gateway IF_BUTTONT reaches this native widget_target route. The clicked copy remains
// a valid target while successive casts consume equivalent copies from earlier slots.
test("both alchemy spells take equivalent copies in inventory order through native packets", async t => {
  for (const name of ["High Level Alchemy", "Low Level Alchemy"]) {
    const f = actor(t), inv = f.p.getInventory(), itemId = id("bronze_dagger");
    inv.add(new core.Item(core.ItemIdentifiers.NATURE_RUNE, 20), false);
    inv.add(new core.Item(core.ItemIdentifiers.FIRE_RUNE, 100), false);
    inv.add(new core.Item(itemId, 3), false);
    const slots = inv.getItems().flatMap((item, slot) => item.getId() === itemId ? [slot] : []);
    const clicked = inv.forSlot(slots[2]), spell = core.CacheDefinitions.getSpellByName(name);
    const before = inv.getAmount(core.ItemIdentifiers.NATURE_RUNE);
    for (const consumed of slots) {
      f.p.setAttribute("magic:alchemy-next-cast", 0);
      await f.c.dispatch([{ type: "widget_target", sourceWidgetId: spell.widgetId,
        sourceItemId: spell.itemId, sourceSlot: -1, targetWidgetId: uid("inventory:items"),
        targetSlot: slots[2], targetItemId: itemId }]);
      f.c.processTurnPackets();
      assert.notEqual(inv.forSlot(consumed).getId(), itemId, name + " consumes the earliest remaining slot");
      if (consumed !== slots[2]) assert.equal(inv.forSlot(slots[2]), clicked, "clicked copy survives earlier casts");
    }
    assert.equal(inv.getAmount(core.ItemIdentifiers.NATURE_RUNE), before - 3, "one payment per item");
  }
});

test("alchemy keeps different item state separate and gives ring hooks the consumed slot", async t => {
  const f = actor(t), inv = f.p.getInventory(), itemId = id("bronze_dagger");
  const charged = new core.Item(itemId).setMetaValue("test:charges", 5);
  inv.add(charged, false); await f.open();
  inv.add(new core.Item(itemId, 2), false);
  const slots = inv.getItems().flatMap((item, slot) => item.getId() === itemId ? [slot] : []);
  const clicked = inv.forSlot(slots[2]);
  await cast(f, { slot: slots[2], itemId });
  assert.equal(used(f), 1);
  assert.equal(inv.forSlot(slots[0]).getMetaValue("test:charges"), 5);
  assert.notEqual(inv.forSlot(slots[1]).getId(), itemId, "earliest matching state is consumed");
  assert.equal(inv.forSlot(slots[2]), clicked);
  const arrows = id("rune_arrow"), earlier = 6, later = 7;
  inv.setItem(earlier, new core.Item(arrows, 2));
  inv.setItem(later, new core.Item(arrows, 5));
  f.p.setAttribute("magic:alchemy-next-cast", 0);
  await cast(f, { slot: later, itemId: arrows });
  assert.equal(inv.forSlot(earlier).getAmount(), 1, "quantity does not distinguish otherwise equivalent split stacks");
  assert.equal(inv.forSlot(later).getAmount(), 5);
  assert.equal(used(f), 2, "the ring pays exactly once for the selected stack");
});

test("queued and confirmed duplicate alchemy still rejects replacement of the clicked copy", async t => {
  for (const pending of ["queue", "confirmation"]) {
    const f = actor(t), inv = f.p.getInventory(), itemId = pending === "queue" ? id("bronze_dagger") : core.ItemIdentifiers.FIRE_CAPE;
    inv.add(new core.Item(itemId, 2), false); await f.open();
    const slots = inv.getItems().flatMap((item, slot) => item.getId() === itemId ? [slot] : []);
    const tasks = [];
    if (pending === "queue") {
      t.mock.method(core.World, "getProcessCycle", () => 1000);
      f.p.setAttribute("magic:alchemy-next-cast", 1005);
      t.mock.method(core.TaskManager, "submit", task => tasks.push(task));
    }
    await cast(f, { slot: slots[1], itemId });
    inv.setItem(slots[1], new core.Item(itemId));
    if (pending === "queue") {
      t.mock.method(core.World, "getProcessCycle", () => 1005); tasks[0].execute();
    } else {
      await resume(f, 193 << 16, 1); await resume(f, (219 << 16) | 1, 1);
    }
    assert.equal(used(f), 0, pending + " cannot spend a charge");
    assert.equal(inv.getAmount(itemId), 2, pending + " cannot consume either copy");
  }
});
