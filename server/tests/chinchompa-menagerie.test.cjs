const assert = require('node:assert/strict'), path=require('node:path');
const {before,after,test}=require('node:test');
const root=path.resolve(__dirname,'..');
process.env.DISABLE_PLAYER_BOTS = '1';
require(root+'/dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require(root+'/dist/game/cache/CachePipeline');
const {PluginManager:PM}=require(root+'/dist/plugins/PluginManager');
const {Player}=require(root+'/dist/game/entity/impl/player/Player');
const {PlayerSession}=require(root+'/dist/net/PlayerSession');
const {ClientConnection}=require(root+'/dist/net/NetworkBuilder');
let core,House,MaxHouse,Data,next=1450;
before(async()=>{await CachePipeline.initialize(root);PM.loadFromDirectory(root+'/plugins');core=PM.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(3222,3218);PM.emitServerStartup({});House=require(root+'/plugins/skills/construction/House.Construction');MaxHouse=require(root+'/plugins/skills/construction/MaxHouse.Construction');Data=require(root+'/plugins/skills/construction/Data.Construction');});
after(()=>PM.emitServerShutdown({}));
function actor(t){const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};const p=new Player(new PlayerSession(channel));p.setIndex(next++);p.setUsername('olmreview'+next);p.setRegistered(true);p.setLocation(new core.Location(3222,3218,0));p.needsPlacement=false;const c=new ClientConnection(channel);c.player=p;const varbits=[];const sender=p.getPacketSender(),original=sender.sendVarbit.bind(sender);t.mock.method(sender,'sendVarbit',(id,value)=>{varbits.push([id,value]);return original(id,value)});p._reviewVarbits=varbits;const msgs=[];t.mock.method(p.getPacketSender(),'sendMessage',m=>{msgs.push(m);return p.getPacketSender()});p._reviewMessages=msgs;t.after(()=>{const taskIndex=p._logoutTestIndex ?? p.getIndex();if(core.World.getPlayers().get(taskIndex)===p){core.World.getPlayers().remove(p);}else if(!p._logoutTestDone){House.releaseHouse(p,true);PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);}core.TaskManager.cancelTasks(taskIndex);for(const n of [...core.World.getNpcs()])if(n?.getOwner?.()===p)core.World.getNpcs().remove(n);});return{p,c};}
async function send(f,packet){await f.c.dispatch([packet]);f.c.processTurnPackets();for(let i=0;i<15;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}}
async function store(t,obj,bankAway=false,pinBefore=false){const f=actor(t);MaxHouse.maxHouse({player:f.p});House.enterHouse(f.p,false);const h=House.houseFor(f.p);assert.ok(h);const e=h.furnitureEntries().find(e=>e.room.roomKey==='MENAGERIE_INDOORS'&&/HOUSE$/.test(e.furniture.buildableKey));assert.ok(e);const id=Data.BUILDABLE_BY_KEY.get(e.furniture.buildableKey).objectIds[0],object=h.furnitureObjects.find(o=>o.getId()===id&&o.getLocation().equals(e.location));assert.ok(object);f.p.setLocation(e.location.clone().add(bankAway?-2:-1,0));f.p.needsPlacement=false;const itemId=core.CacheDefinitions.getObjId(obj);f.p.getInventory().add(new core.Item(itemId),true);if(pinBefore){const pin=require(root+'/plugins/interface/bankpin/Common.BankPin');f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,'1234'))}const packet={type:'item_on_object',objectId:id,x:e.location.getX(),y:e.location.getY(),itemId,slot:f.p.getInventory().getSlotForItemId(itemId),widgetId:149<<16};if(bankAway){await f.c.dispatch([packet]);f.c.processTurnPackets();f.p.getBank(0).open();core.Bank.deposit(f.p,itemId,f.p.getInventory().getSlotForItemId(itemId),1,false);assert.equal(f.p.getBank(0).getAmount(itemId),1);f.p.getPacketSender().sendInterfaceRemoval();for(let i=0;i<15;i++){core.TaskManager.processWalkTo(f.p.getIndex());f.p.getMovementQueue().process();core.TaskManager.process();}}else await send(f,packet);console.log(JSON.stringify({obj,at:f.p.getLocation(),privateMatch:f.p.getPrivateArea()===h,placed:f.p.isNeedsPlacement(),busy:f.p.busy(),messages:f.p._reviewMessages,stored:f.p.getAttribute('construction:menagerie')}));return{...f,h,itemId,object};}

for(const colour of ['red','grey','black'])test('actual chinchompa house Store/View/Take preserves '+colour,async t=>{const f=await store(t,'skillpethunter_'+colour);assert.equal(f.p.getInventory().getAmount(f.itemId),0);const bit=core.CacheDefinitions.getVarbitId('poh_menagerie_multiform_skillpethunter'),value={grey:0,red:1,black:2}[colour];assert.ok(f.p._reviewVarbits.some(([id,v])=>id===bit&&v===value),'store must send the actual script642 colour varbit');f.p._reviewVarbits.length=0;assert.ok(f.h.getNpcs().some(n=>n.getId()===core.CacheDefinitions.getNpcId('poh_skillpet_hunter_'+colour)));await send(f,{type:'object_option',id:f.object.getId(),x:f.object.getLocation().getX(),y:f.object.getLocation().getY(),action:'View'});assert.equal(f.p.getInterfaceId(),211);assert.ok(f.p._reviewVarbits.some(([id,v])=>id===bit&&v===value),'View must resend the actual script642 colour varbit');const slot=[...core.CacheDefinitions.getEnumValues(985)].find(([,id])=>id===core.CacheDefinitions.getObjId('skillpethunter_red'))[0];await send(f,{type:'widget_action',widgetId:(211<<16)|7,groupId:211,childId:7,slot,buttonNum:1});assert.equal(f.p.getInventory().getAmount(f.itemId),1);});

test('actual client enum bindings resolve non-item names and native misspellings',()=>{const forms=require('../plugins/skills/construction/PetForms.Construction');for(const[obj,bit]of [['skillpethunter_red','poh_menagerie_multiform_skillpethunter'],['phoenixpet','poh_menagerie_mutliform_phoenixpet'],['skillpetfarming','poh_menagerie_mutliform_farmingpet'],['skillpetrunecrafting_fire','poh_menagerie_multiform_skillpetrunecrafting'],['skillpetwc','poh_menagerie_multiform_skillpetwoodcutting'],['skillpetagility','poh_menagerie_multiform_skillpetagility_bigger']]){const id=core.CacheDefinitions.getObjId(obj);assert.ok(Number.isInteger(id),obj);const enumId=core.CacheDefinitions.getItem(id).params.get(446);assert.equal(forms.varbitForEnum(enumId),core.CacheDefinitions.getVarbitId(bit),obj);}assert.equal(forms.varbitForEnum(-1),undefined);assert.equal(forms.varbitForEnum(undefined),undefined);});


// A guest's paid tips stay owned until the owner's inventory or bank receives them.
test('tip jar withdrawals conserve the owner balance at currency stack limits', async (t) => {
  const MAX = 0x7fffffff, I = core.ItemIdentifiers;
  const total = (stores) => Object.values(stores).reduce((sum, count) => sum + count, 0);
  for (const destination of ['inventory', 'bank']) {
    for (const mode of ['room', 'exact', 'near', 'full']) {
      await t.test(`${destination} withdrawal with ${mode} coin headroom`, async (child) => {
        const owner = actor(child), guest = actor(child);
        for (const f of [owner, guest]) {
          f.p.setUsername('jar' + f.p.getIndex());
          assert.ok(f.p.getUsername().length <= 12);
          f.p.setLongUsername(core.Misc.stringToLongBigInt(f.p.getUsername()));
          assert.notEqual(f.p.getLongUsername(), 0n);
          f.p.setRegistered(false);
          assert.equal(core.World.getPlayers().add(f.p), true);
          child.after(() => {
            core.TaskManager.cancelTasks(f.p);
            for (const ground of [...core.World.getItems()]) {
              if (ground.getOwner() === f.p.getUsername() && !ground.isPendingRemoval())
                core.ItemOnGroundManager.deregister(ground);
            }
          });
        }
        assert.notEqual(owner.p.getLongUsername(), guest.p.getLongUsername());
        owner.p.getRelations().setStatus(core.PrivateChatStatus.ON, false);
        const saved = House.houseStateFor(owner.p);
        saved.owned = true; saved.location = 1; saved.style = 0; saved.locked = false;
        const garden = saved.rooms.flat(2).find((room) => room?.roomKey === 'GARDEN');
        assert.ok(garden); garden.furniture.GARDEN_TIP_JAR = 'TIP_JAR';
        assert.equal(House.enterHouse(owner.p, false), true);
        const house = House.houseFor(owner.p);
        assert.equal(house.owner, owner.p); assert.equal(house.buildingMode, false);
        assert.equal(House.canVisitHouse(guest.p, house), true);
        House.visitHouse(guest.p, owner.p.getUsername(), 1);
        assert.equal(House.houseFor(guest.p), house);
        const jarId = Data.BUILDABLE_BY_KEY.get('TIP_JAR').objectIds[0];
        const jar = house.furnitureObjects.find((object) => object.getId() === jarId);
        assert.ok(jar, 'the saved garden furnishes a real tip jar');
        const definition = core.ObjectDefinition.forId(jarId);
        assert.equal(definition.getName(), 'Tip jar');
        assert.equal(core.ItemDefinition.forId(I.COINS).isStackable(), true);
        const position = jar.getLocation();
        for (const f of [owner, guest]) {
          f.p.setLocation(position.clone().add(-1, 0)); f.p.needsPlacement = false;
          assert.equal(f.p.getPrivateArea(), house);
        }
        const stores = (player, id) => ({
          inventory: player.getInventory().getAmount(id), equipment: player.getEquipment().getAmount(id),
          bank: player.getBanks().reduce((sum, bank, tab) => sum + (bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0),
          floor: core.World.getItems().filter((ground) => !ground.isPendingRemoval()
            && ground.getOwner() === player.getUsername() && ground.getPrivateArea() === house
            && ground.getItem().getId() === id).reduce((sum, ground) => sum + ground.getItem().getAmount(), 0),
        });
        const xp = (player) => core.Skill.values().map((skill) => player.getSkillManager().getExperience(skill));
        assert.equal(total(stores(owner.p, I.COINS)), 0);
        assert.equal(total(stores(guest.p, I.COINS)), 0);
        assert.equal(house.save.tipJar?.coins ?? 0, 0);
        guest.p.getInventory().add(new core.Item(I.COINS, 2), false);
        const donorBefore = total(stores(guest.p, I.COINS));
        await send(guest, {type:'item_on_object', objectId:jarId, x:position.getX(), y:position.getY(),
          widgetId:core.Inventory.INTERFACE_ID, itemId:I.COINS, slot:guest.p.getInventory().getSlotForItemId(I.COINS)});
        assert.ok(guest.p.getEnteredAmountAction(), 'the registered jar handler opens its amount prompt');
        await send(guest, {type:'dialogue_amount', amount:2});
        assert.equal(donorBefore - total(stores(guest.p, I.COINS)), 2);
        assert.equal(house.save.tipJar.coins, 2);
        assert.equal(House.houseStateFor(owner.p).tipJar, house.save.tipJar);
        const headroom = mode === 'room' ? null : mode === 'exact' ? 2 : mode === 'near' ? 1 : 0;
        const initial = headroom === null ? 0 : MAX - headroom - 1;
        const bank = owner.p.getBank(core.Bank.getTabForItem(owner.p, I.COINS));
        const destinationContainer = destination === 'bank' ? bank : owner.p.getInventory();
        if (initial) destinationContainer.add(new core.Item(I.COINS, initial), false);
        const pile = core.ItemOnGroundManager.registers(owner.p, new core.Item(I.COINS, 1));
        assert.ok(pile); assert.equal(stores(owner.p, I.COINS).floor, 1);
        await send(owner, {type:'ground_item_action', itemId:I.COINS, x:owner.p.getLocation().getX(),
          y:owner.p.getLocation().getY(), option:'Take'});
        assert.equal(pile.isPendingRemoval(), true); assert.equal(stores(owner.p, I.COINS).floor, 0);
        if (destination === 'bank') {
          assert.equal(owner.p.getInventory().getAmount(I.COINS), 1);
          owner.p.getBank(0).open();
          assert.equal(core.Bank.isOpen(owner.p), true);
          await send(owner, {type:'widget_action', widgetId:(core.Bank.SIDE_INTERFACE_ID << 16) | 3,
            groupId:core.Bank.SIDE_INTERFACE_ID, childId:3, buttonNum:2,
            itemId:I.COINS, slot:owner.p.getInventory().getSlotForItemId(I.COINS), option:'Deposit-1'});
          assert.equal(owner.p.getInventory().getAmount(I.COINS), 0);
          owner.p.getPacketSender().sendInterfaceRemoval();
        }
        assert.equal(destinationContainer.getAmount(I.COINS), initial + 1);
        assert.equal(destinationContainer.getAddableAmount(new core.Item(I.COINS, 2)), headroom === null ? 2 : headroom);
        assert.ok(owner.p.getInventory().getFreeSlots() >= 27);
        assert.equal(house.save.tipJar.coins, 2);
        const before = {coins:stores(owner.p,I.COINS), platinum:stores(owner.p,I.PLATINUM_TOKEN),
          guestCoins:stores(guest.p,I.COINS), guestPlatinum:stores(guest.p,I.PLATINUM_TOKEN),
          storedCoins:house.save.tipJar.coins, storedPlatinum:house.save.tipJar.platinum,
          ownerXp:xp(owner.p), guestXp:xp(guest.p)};
        await send(owner, {type:'object_option', id:jarId, x:position.getX(), y:position.getY(), action:'Use'});
        const manager = owner.p.getDialogueManager(), sender = owner.p.getPacketSender();
        const box = manager.getCurrent();
        assert.ok(box instanceof core.ItemStatementDialogue);
        assert.equal(box.getText(), 'Your tip jar contains:<br>2 coins');
        assert.equal(sender.getChatboxGroupId(), 193); assert.equal(manager.getOwner(), undefined);
        await send(owner, {type:'dialogue_continue', widgetId:193 << 16, childIndex:-1});
        const menu = core.MultiChatboxPrompt.getPending(owner.p);
        assert.ok(menu, 'the registered jar action opens its own current multi prompt');
        assert.equal(manager.getCurrent(), undefined); assert.equal(manager.isActive(), false);
        assert.equal(menu.title, 'Take the tips?');
        assert.deepEqual(menu.options, ['Take them to your inventory','Take them to your bank','Leave them']);
        assert.equal(sender.getChatboxGroupId(), 219); assert.equal(manager.getOwner(), undefined);
        const mount = sender.subInterfaceTargets.get(219);
        assert.ok(mount); assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
        assert.equal(house.save.tipJar.coins, 2);
        assert.deepEqual(stores(owner.p,I.COINS), before.coins);
        const selected = destination === 'inventory' ? 1 : 2;
        await send(owner, {type:'dialogue_continue', widgetId:core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex:selected});
        const after = {coins:stores(owner.p,I.COINS), stored:house.save.tipJar.coins};
        assert.equal(total(after.coins) + after.stored, total(before.coins) + before.storedCoins,
          JSON.stringify({destination,mode,before:{coins:before.coins,stored:before.storedCoins},after}));
        assert.ok(after.stored >= 0 && after.stored <= 2);
        assert.equal(total(after.coins) - total(before.coins), 2 - after.stored);
        if (mode === 'room' || mode === 'exact') { assert.equal(after.stored, 0); assert.equal(total(after.coins) - total(before.coins), 2); }
        assert.deepEqual(stores(owner.p,I.PLATINUM_TOKEN), before.platinum);
        assert.equal(house.save.tipJar.platinum, before.storedPlatinum);
        assert.deepEqual(stores(guest.p,I.COINS), before.guestCoins);
        assert.deepEqual(stores(guest.p,I.PLATINUM_TOKEN), before.guestPlatinum);
        assert.deepEqual(xp(owner.p), before.ownerXp); assert.deepEqual(xp(guest.p), before.guestXp);
      });
    }
  }
});


// Logout uses the same bank credit path; uncredited owned tips remain in the saved house.
test('tip jar logout banking preserves both currencies at bank stack limits', async t => {
  const MAX = 0x7fffffff, I = core.ItemIdentifiers;
  for (const [field, id] of [['coins', I.COINS], ['platinum', I.PLATINUM_TOKEN]]) {
    for (const headroom of [2, 1, 0]) await t.test(`${field} headroom ${headroom}`, async child => {
      const f = actor(child), p = f.p;
      p.setUsername('jar' + p.getIndex());
      p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
      assert.notEqual(p.getLongUsername(), 0n);
      p.setRegistered(false);
      p.setAttribute('bot-skip-persistence', true);
      assert.equal(core.World.getPlayers().add(p), true);
      const index = p.getIndex();
      p._logoutTestIndex = index;
      const saved = House.houseStateFor(p);
      saved.tipJar = { coins: 0, platinum: 0, muted: false, bankOnLogout: true };
      saved.tipJar[field] = 2;
      p.setAttribute(Data.HOUSE_ATTRIBUTE, saved);
      const bank = p.getBank(core.Bank.getTabForItem(p, id));
      bank.add(new core.Item(id, MAX - headroom), false);
      assert.equal(bank.getAddableAmount(new core.Item(id, 2)), headroom);
      const prior = bank.getAmount(id);
      core.World.getPlayers().remove(p);
      p._logoutTestDone = true;
      assert.notEqual(core.World.getPlayers().get(index), p);
      assert.equal(p.getAttribute(Data.HOUSE_ATTRIBUTE), saved);
      assert.equal(saved.tipJar[field], 2 - headroom);
      assert.equal(bank.getAmount(id), prior + headroom);
      assert.equal(bank.getAmount(id) + saved.tipJar[field], prior + 2);
    });
  }
});
