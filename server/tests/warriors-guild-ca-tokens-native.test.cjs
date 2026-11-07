// Registered routes and native death phases; seeded CA task completion and killer.
// Run after yarn build: node --test tests/warriors-guild-ca-tokens-native.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
const { MAIN_PROFILE } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
const { isMembersWorld } = require('../dist/game/definition/WorldDefinition');
const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
const Progress = require('../plugins/achievements/combatachievements/Progress.CombatAchievements');
let core, next = 8200;
const injectedAwards = new WeakMap();
function testAwardProbe(event) { const probe = injectedAwards.get(event.player); if (probe && event.minigame === 'warriors-guild') { probe.count++; event.points += 1; } }
const errors = [], warnings = [], oldError = console.error, oldWarn = console.warn;
console.error = (...args) => { errors.push(args); oldError(...args); };
console.warn = (...args) => { if (args.some(x => /hook.*(threw|error)/i.test(String(x)))) warnings.push(args); oldWarn(...args); };
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2860, 3542);
  PM.createApi('WarriorsGuildTokenTest').onCustomEvent('minigame:points', testAwardProbe);
  PM.emitServerStartup({});
});
after(() => {
  try { PM.emitServerShutdown({}); }
  finally { console.error = oldError; console.warn = oldWarn; assert.deepEqual(errors, []); assert.deepEqual(warnings, []); }
});
function runCleanups(cleanups) {
  let failure;
  for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (error) { failure ??= error; } }
  if (failure) throw failure;
}
function actor(t) {
  const channel = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const player = new Player(new PlayerSession(channel)), cleanups=[];
  const name = `wgca${next++}`;
  t.after(() => {
    try { try { runCleanups(cleanups); } finally { try { player.closeInterruptibleInterfaces(); } finally { core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); } } }
    finally {
      try { if (player.isRegistered()) core.World.getPlayers().remove(player); }
      finally {
        assert.ok(!player.isRegistered());
        assert.equal(core.TaskManager.hasActiveTask(player), false);
        assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
        assert.equal(core.MultiChatboxPrompt.getPending(player), null);
        assert.ok(player.getDialogueManager().getCurrent() == null);
        assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
      }
    }
  });
  player.setUsername(name); player.setLongUsername(core.Misc.stringToLongBigInt(name));
  assert.notEqual(player.getLongUsername(), 0n);
  player.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(player), true);
  player.moveTo(new core.Location(2860,3542,0)); player.setNeedsPlacement(false);
  assert.ok(player.getHitpoints() > 0); assert.equal(player.busy(), false);
  assert.equal(core.RegionManager.blocked(player.getLocation(),player.getPrivateArea()),false);
  for (const skill of [core.Skill.ATTACK,core.Skill.STRENGTH]) {
    player.getSkillManager().setMaxLevels(skill,65,false).setExperience(skill,SkillManager.getExperienceForLevel(65)).setCurrentLevels(skill,65,false);
    assert.equal(player.getSkillManager().getMaxLevel(skill),65);
    assert.equal(player.getSkillManager().getCurrentLevel(skill),65);
  }
  assert.equal(require('../plugins/areas/warriors-guild/Entrance.WarriorsGuild').qualifies(player),true,'actor meets the actual guild entry predicate');
  assert.equal(isMembersWorld(), true); assert.equal(player.getProfile(), MAIN_PROFILE);
  const league = require('../plugins/modes/league/Common.LeagueMode');
  const sentinel = Symbol('unanswered'); const q = {player, league:sentinel};
  assert.equal(league.worldLeague(), null); PM.emitCustomEvent('league:profile', q); assert.equal(q.league, null);
  const connection = new ClientConnection(channel); connection.player = player;
  player.getSession().setPlayer(player); player.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
  return {player, connection, cleanups};
}
function seedCompleted(f) {
  const words = Data.TASK_VARPS.map(() => 0);
  for (const task of Data.tasks().values()) words[task.id >>> 5] |= 1 << (task.id & 31);
  f.player.setAttribute('combat-achievements:completed', words);
  assert.equal(Progress.claimedTiers(f.player).size, 0, 'no claim is seeded');
}
function tier(f, tier) {
  const q = {player:f.player, tier, claimed:false, currentThresholdMet:false};
  PM.emitCustomEvent('combat-achievements:tier', q);
  return q;
}
async function resume(f, choice) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231,217].includes(group) ? 5 : 0) : core.MultiChatboxPrompt.OPTIONS_WIDGET_ID;
  await f.connection.dispatch([{type:'dialogue_continue', widgetId, childIndex:choice ?? -1}]);
  f.connection.processTurnPackets();
}
function normalized(dialogue) {
  const raw = dialogue?.getText?.();
  return (Array.isArray(raw) ? raw.join(' ') : String(raw ?? '')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
}
async function claimNext(t, f, expectedName) {
  const here=f.player.getLocation(); let spawn=null;
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const candidate=new core.Location(here.getX()+dx,here.getY()+dy,here.getZ());
    const occupied=[...core.World.getNpcs()].some(other => other?.isRegistered() && other.getLocation().equals(candidate));
    if (!occupied && !core.RegionManager.blocked(candidate,f.player.getPrivateArea())) { spawn=candidate; break; }
  }
  assert.ok(spawn, 'Ghommal has an adjacent walkable tile');
  const npc = core.NPC.create(core.NpcIdentifiers.GHOMMAL_3, spawn);
  f.cleanups.push(() => { if (npc.isRegistered()) core.World.getNpcs().remove(npc); assert.ok(!npc.isRegistered()); });
  assert.equal(core.World.getNpcs().add(npc), true);
  const def = npc.getCurrentDefinition(f.player);
  assert.match(def.getName(), /Ghommal/i);
  assert.equal(PM.emitNpcInteraction({player:f.player, npc, npcId:npc.getId(), definition:def, clickType:1, handled:false}), true);
  let confirmed = false;
  for (let i = 0; i < 45 && !confirmed; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.player);
    if (menu) {
      assert.equal(f.player.getPacketSender().getChatboxGroupId(),219);
      const index = menu.options.findIndex(x => x.startsWith("I'm here to talk about Combat Achievements") || x.startsWith("I think I've completed a combat tier"));
      assert.ok(index >= 0, 'actual reward option is available');
      await resume(f, index + 1);
    } else {
      const line = f.player.getDialogueManager().getCurrent();
      assert.ok(line, 'reward conversation remains active before confirmation');
      const text = normalized(line);
      if (text === 'Yes please!') {
        assert.ok(line instanceof PlayerDialogue); assert.equal(f.player.getPacketSender().getChatboxGroupId(),217); confirmed = true;
      } else if (text === 'You have come very far. You have earned these rewards.') {
        assert.ok(line instanceof NpcDialogue); assert.equal(line.getNpcId(),npc.getId());
        assert.equal(f.player.getPacketSender().getChatboxGroupId(),231); confirmed = true;
      } else await resume(f);
    }
  }
  assert.equal(confirmed, true, 'actual reward confirmation reached');
  assert.equal(tier(f, expectedName).claimed, false);
  await resume(f);
  assert.equal(tier(f, expectedName).claimed, true, 'normal reward commits the claim');
  assert.equal(tier(f, expectedName).currentThresholdMet, true);
  f.player.closeInterruptibleInterfaces();
  if (npc.isRegistered()) core.World.getNpcs().remove(npc);
}
function reachable(player, object) {
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const loc = object.getLocation(), def = ObjectDefinition.forPlayer(object.getId(), player);
  if (!def) return false;
  const type = object.getType(), rect = type === 10 || type === 11 || type === 22;
  const footprint = type === 22 ? def : (ObjectDefinition.forId(object.getId()) ?? def);
  return PathFinder.reachedObject(player, loc.getX(), loc.getY(), rect ? footprint.getSizeX() : 1,
    rect ? footprint.getSizeY() : 1, object.getFace(), rect ? 10 : type, rect ? def.getBlockingMask() : 0);
}
function kegPair(f) {
  const player=f.player, {ObjectDefinition}=require('../dist/game/definition/ObjectDefinition');
  core.RegionManager.loadMapFiles(2870,3540);
  const ids=[15669,15670], definitions=ids.map(id=>ObjectDefinition.forPlayer(id,player));
  for(const id of ids) { const base=ObjectDefinition.forId(id); assert.ok(base); assert.equal(base.getSizeX(),1); assert.equal(base.getSizeY(),1); }
  for(const def of definitions) {
    assert.ok(def,'active cache resolves the keg definition');
    assert.ok(Number.isInteger(def.id));
    assert.equal(def.getSizeX(),1); assert.equal(def.getSizeY(),1);
    assert.ok(typeof def.getInteractions()?.[0]==='string' && def.getInteractions()[0].length>0,'first cache action exists');
  }
  let selected=null;
  for(let x=2862;x<=2877 && !selected;x++) for(let y=3536;y<=3542 && !selected;y++) {
    const tiles=[new core.Location(x,y,1),new core.Location(x-1,y,1),new core.Location(x+1,y,1)];
    const region=core.RegionManager.getRegion(x,y);
    if(!region?.isLoaded() || tiles.some(loc=>core.RegionManager.blocked(loc,player.getPrivateArea()))) continue;
    if(tiles.some(loc=>core.MapObjects.getObjectsAt(loc,player.getPrivateArea()).length ||
      core.ObjectManager.objectsAt(loc).length || core.World.getRemovedObjects().some(o=>o.getLocation().equals(loc)))) continue;
    selected=tiles;
  }
  assert.ok(selected,'loaded room provides unoccupied walkable synthetic-placement tiles');
  const snapshots=[];
  const center=selected[0];
  const ownerBefore=[...core.MapObjects.ownerObjectsInScene(player,center.getX()-3,center.getY()-3,7)];
  for(let dx=-2;dx<=2;dx++) for(let dy=-1;dy<=1;dy++) {
    const loc=new core.Location(center.getX()+dx,center.getY()+dy,1);
    snapshots.push({loc,clip:core.RegionManager.getClipping(loc.getX(),loc.getY(),loc.getZ(),player.getPrivateArea()),
      map:[...core.MapObjects.getObjectsAt(loc,player.getPrivateArea())],runtime:[...core.ObjectManager.objectsAt(loc)],
      removed:core.World.getRemovedObjects().filter(o=>o.getLocation().equals(loc))});
  }
  const registered=[];
  f.cleanups.push(()=>{
    try { runCleanups(registered.map(object=>()=>core.ObjectManager.deregister(object,true))); }
    finally {
      for(const s of snapshots) {
        assert.equal(core.RegionManager.getClipping(s.loc.getX(),s.loc.getY(),s.loc.getZ(),player.getPrivateArea()),s.clip);
        assert.deepEqual(core.MapObjects.getObjectsAt(s.loc,player.getPrivateArea()),s.map);
        assert.deepEqual([...core.ObjectManager.objectsAt(s.loc)],s.runtime);
        assert.deepEqual(core.World.getRemovedObjects().filter(o=>o.getLocation().equals(s.loc)),s.removed);
      }
      for(const object of registered) assert.notEqual(core.MapObjects.getPrivateArea(player,ObjectDefinition.forPlayer(object.getId(),player)?.id,object.getLocation()),object);
      assert.deepEqual(core.MapObjects.ownerObjectsInScene(player,center.getX()-3,center.getY()-3,7),ownerBefore);
    }
  });
  player.moveTo(center); player.setNeedsPlacement(false);
  for(let i=0;i<2;i++) {
    const object=new core.GameObject(ids[i],selected[i+1],10,0,null).setOwner(player);
    registered.push(object); // Cleanup is armed before registration, including partial failure.
    core.ObjectManager.register(object,true);
    assert.equal(object.getOwner(),player); assert.equal(object.getType(),10); assert.equal(object.getFace(),0);
    assert.equal(core.MapObjects.getPrivateArea(player,definitions[i].id,object.getLocation()),object);
    assert.ok(reachable(player,object),'owned cache-defined keg is reachable from the selected standing tile');
  }
  return registered.map((object,i)=>({object,definition:definitions[i]}));
}
async function earnKegs(t, f) {
  const player = f.player, state = require('../plugins/areas/warriors-guild/Kegs.WarriorsGuild')._test.balancing;
  f.cleanups.push(() => { if (state.has(player)) PM.emitPlayerLogout({player, username:player.getUsername()}); assert.equal(state.has(player), false); });
  const objects = kegPair(f);
  assert.ok(player.getHitpoints() > 0); assert.equal(player.busy(), false);
  assert.equal(core.RegionManager.blocked(player.getLocation(),player.getPrivateArea()),false);
  for (const slot of [core.Equipment.HEAD_SLOT, core.Equipment.WEAPON_SLOT, core.Equipment.SHIELD_SLOT, core.Equipment.HANDS_SLOT])
    assert.ok(!(player.getEquipment().getItems()[slot]?.getId() > 0), 'hands and head empty');
  assert.equal(Number(player.getAttribute('warriors-guild:keg-tokens')) || 0, 0);
  const varbits = new Map([[15669,2253],[15670,2254],[15671,2255],[15672,2256],[15673,2252]]);
  let handled=0;
  const original=PM.emitObjectInteraction.bind(PM);
  t.mock.method(PM,'emitObjectInteraction',event=>{
    const result=original(event);
    if(event.player===player && objects.some(row=>row.object===event.object) && result) handled++;
    return result;
  });
  for(const {object,definition} of objects) {
    const loc=object.getLocation();
    assert.ok(reachable(player,object));
    await f.connection.dispatch([{type:'object_option',id:definition.id,x:loc.getX(),y:loc.getY(),clickType:1}]);
    f.connection.processTurnPackets();
    // Adapter: process the real route and pickup tasks without a player balance phase.
    core.TaskManager.process(); core.TaskManager.processWalkTo(player.getIndex());
  }
  assert.equal(handled,2,'both decoded interactions reached registered object handlers');
  for (let i=0; i<6 && state.get(player)?.kegs !== 2; i++) core.TaskManager.process();
  assert.equal(state.get(player)?.kegs, 2, 'two distinct registered pickups complete');
  for (const {object} of objects) assert.equal(player.getPacketSender().getVarbit(varbits.get(object.getId())), 1);
  assert.equal(player.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), core.ItemIdentifiers.ONE_BARREL + 1);
  const helm = core.ItemIdentifiers.BRONZE_FULL_HELM;
  player.getInventory().adds(helm, 1);
  const slot = player.getInventory().getSlotForItemId(helm);
  assert.ok(slot >= 0);
  await f.connection.dispatch([{type:'inventory_action', itemId:helm, slot, widgetId:149 << 16, option:'Wear'}]);
  f.connection.processTurnPackets();
  assert.equal(state.has(player), false, 'registered equipment path causes the fall');
  for (const {object} of objects) assert.equal(player.getPacketSender().getVarbit(varbits.get(object.getId())), 0);
  const earned = Number(player.getAttribute('warriors-guild:keg-tokens')) || 0;
  assert.ok(earned > 0, 'fall records an actual base keg balance');
  return earned;
}
async function transferKegs(t, f, base) {
  const player = f.player, origin = player.getLocation();
  let spawn = null;
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const candidate = new core.Location(origin.getX()+dx, origin.getY()+dy, origin.getZ());
    const occupied = [...core.World.getNpcs()].some(other => other?.isRegistered() && other.getLocation().equals(candidate));
    if (!occupied && !core.RegionManager.blocked(candidate, player.getPrivateArea())) { spawn = candidate; break; }
  }
  assert.ok(spawn, 'Jimmy has an adjacent walkable tile');
  const npc = core.NPC.create(core.NpcIdentifiers.JIMMY, spawn);
  f.cleanups.push(() => { if (npc.isRegistered()) core.World.getNpcs().remove(npc); assert.ok(!npc.isRegistered()); });
  assert.equal(core.World.getNpcs().add(npc), true);
  const def = npc.getCurrentDefinition(player);
  assert.match(def.getName(), /Jimmy/i);
  assert.ok(npc.getLocation().getDistance(player.getLocation()) <= 1);
  const old = Number(player.getAttribute('warriors-guild:tokens')) || 0;
  assert.equal(PM.emitNpcInteraction({player,npc,npcId:npc.getId(),definition:def,clickType:1,handled:false}), true);
  let selected = false;
  for (let i=0; i<45 && Number(player.getAttribute('warriors-guild:keg-tokens')) > 0; i++) {
    const menu = core.MultiChatboxPrompt.getPending(player);
    if (menu) {
      assert.equal(player.getPacketSender().getChatboxGroupId(),219);
      const index = menu.options.findIndex(x => x.startsWith('May I claim my tokens please?'));
      assert.ok(index >= 0, 'actual Jimmy claim option appears');
      selected = true;
      await resume(f, index + 1);
    } else {
      assert.ok(player.getDialogueManager().getCurrent(), 'Jimmy dialogue remains active until transfer');
      await resume(f);
    }
  }
  assert.equal(selected, true);
  assert.equal(Number(player.getAttribute('warriors-guild:keg-tokens')) || 0, 0, 'Jimmy consumed the actual keg balance');
  player.closeInterruptibleInterfaces();
  if (npc.isRegistered()) core.World.getNpcs().remove(npc);
  return (Number(player.getAttribute('warriors-guild:tokens')) || 0) - old;
}
async function payStaff(f, expected) {
  const player=f.player, here=player.getLocation(); let spawn=null;
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const candidate=new core.Location(here.getX()+dx,here.getY()+dy,here.getZ());
    const occupied=[...core.World.getNpcs()].some(other=>other?.isRegistered() && other.getLocation().equals(candidate));
    if(!occupied && !core.RegionManager.blocked(candidate,player.getPrivateArea())) { spawn=candidate; break; }
  }
  assert.ok(spawn,'staff has an adjacent walkable tile');
  const npc=core.NPC.create(core.NpcIdentifiers.AJJAT,spawn);
  f.cleanups.push(()=>{if(npc.isRegistered()) core.World.getNpcs().remove(npc); assert.ok(!npc.isRegistered());});
  assert.equal(core.World.getNpcs().add(npc),true);
  const definition=npc.getCurrentDefinition(player);
  assert.match(definition.getName(),/Ajjat/i);
  const option=definition.getActions().findIndex(value=>value?.toLowerCase()==='claim-tokens');
  assert.ok(option>=0,'actual staff has Claim-Tokens action');
  const click=()=>PM.emitNpcInteraction({player,npc,npcId:npc.getId(),definition,clickType:option+1,handled:false});
  const token=core.ItemIdentifiers.WARRIOR_GUILD_TOKEN, before=player.getInventory().getAmount(token);
  assert.equal(Number(player.getAttribute('warriors-guild:tokens')),expected);
  assert.equal(click(),true);
  for(let i=0;i<10 && Number(player.getAttribute('warriors-guild:tokens'))>0;i++) {
    assert.ok(player.getDialogueManager().getCurrent(),'staff payout dialogue active');
    await resume(f);
  }
  assert.equal(Number(player.getAttribute('warriors-guild:tokens'))||0,0);
  assert.equal(player.getInventory().getAmount(token),before+expected,'staff pays exactly the ledger');
  player.closeInterruptibleInterfaces();
  assert.equal(click(),true);
  for(let i=0;i<5 && player.getDialogueManager().getCurrent();i++) await resume(f);
  assert.equal(player.getInventory().getAmount(token),before+expected,'repeat claim adds nothing');
  assert.equal(Number(player.getAttribute('warriors-guild:tokens'))||0,0);
  player.closeInterruptibleInterfaces();
  if(npc.isRegistered()) core.World.getNpcs().remove(npc);
}
for (const [name, claims, multiplier] of [['ordinary',0,1],['earned-unclaimed',-1,1],['Easy claimed',1,2],['Easy and Medium claimed',2,3]]) {
  test(`registered keg transfer: ${name}`, async t => {
    const f = actor(t);
    if (claims !== 0) seedCompleted(f);
    if (claims > 0) await claimNext(t,f,'Easy');
    if (claims > 1) await claimNext(t,f,'Medium');
    const easy = tier(f,'Easy'), medium = tier(f,'Medium');
    assert.equal(easy.claimed, claims > 0); assert.equal(medium.claimed, claims > 1);
    if (claims !== 0) { assert.equal(easy.currentThresholdMet,true); assert.equal(medium.currentThresholdMet,true); }
    f.player.setAttribute('warriors-guild:tokens', 7);
    const base = await earnKegs(t,f);
    assert.equal(await transferKegs(t,f,base), base * multiplier);
    assert.equal(Number(f.player.getAttribute('warriors-guild:tokens')), 7 + base * multiplier, 'pre-existing ledger is not repriced');
    await payStaff(f,7 + base * multiplier);
  });
}
function animatorObject(f) {
  const id = core.ObjectIdentifiers.MAGICAL_ANIMATOR, player = f.player;
  core.RegionManager.loadMapFiles(2851,3536);
  for (let x=2845; x<=2858; x++) for (let y=3530; y<=3543; y++) {
    const loc = new core.Location(x,y,0), object = core.World.findCacheObject(player,id,loc);
    if (!object) continue;
    const def = object.getDefinition(), option = def?.getInteractions?.().findIndex(s => s?.toLowerCase() === 'animate');
    if (option < 0 || option == null) continue;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[0,0]]) {
      const standing = new core.Location(x+dx,y+dy,0);
      if (core.RegionManager.blocked(standing,player.getPrivateArea())) continue;
      player.moveTo(standing); player.setNeedsPlacement(false);
      if (reachable(player,object)) return {object,def,clickType:option+1};
    }
  }
  assert.fail('actual animator and reachable loaded-map tile are required');
}
async function animatedDrop(t,f,multiplier) {
  const player=f.player, I=core.ItemIdentifiers, N=core.NpcIdentifiers;
  const {ItemOnGroundManager} = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const foreignItems = [...core.World.getItems()].filter(item => item.getOwner() !== player.getUsername());
  let spawned=null, beforeRoll=null, afterRoll=null;
  f.cleanups.push(() => {
    const pending=core.World.getAddNPCQueue(), removing=core.World.getRemoveNPCQueue();
    const ownedNpcs=new Set([...core.World.getNpcs(),...pending,...removing].filter(npc=>npc?.getOwner?.()===player));
    if (spawned) ownedNpcs.add(spawned);
    let undrained=[];
    try {
      // Death tasks are unkeyed: first allow any already-started death to retire naturally.
      for (let i=0; i<60 && [...ownedNpcs].some(npc=>npc.isRegistered() && (npc.isDyingFunction() || npc.getHitpoints()<=0)); i++) core.World.process();
      undrained=[...ownedNpcs].filter(npc=>npc.isRegistered() && (npc.isDyingFunction() || npc.getHitpoints()<=0));
    } finally {
      try { PM.emitPlayerLogout({player,username:player.getUsername()}); }
      finally {
        try {
          for (const npc of [...core.World.getNpcs(),...pending,...removing]) if(npc?.getOwner?.()===player) ownedNpcs.add(npc);
          for (const npc of ownedNpcs) {
            let index=pending.indexOf(npc); if(index>=0) pending.splice(index,1);
            index=removing.indexOf(npc); if(index>=0) removing.splice(index,1);
            if(npc.isRegistered()) core.World.getNpcs().remove(npc);
            assert.ok(!npc.isRegistered()); assert.ok(!pending.includes(npc)); assert.ok(!removing.includes(npc));
          }
          assert.equal([...core.World.getNpcs(),...pending,...removing].some(npc=>npc?.getOwner?.()===player),false);
          assert.deepEqual(undrained,[],'started death task retired before cleanup');
        } finally {
          const owned = ItemOnGroundManager.ownedBy(player.getUsername());
          for (const item of owned) ItemOnGroundManager.deregister(item);
          ItemOnGroundManager.process();
          for (const item of owned) assert.ok(!core.World.getItems().includes(item));
          assert.deepEqual(ItemOnGroundManager.ownedBy(player.getUsername()), []);
          for (const item of foreignItems) assert.ok(core.World.getItems().includes(item), 'unrelated ground items remain');
        }
      }
    }
  });
  const selected=animatorObject(f);
  for (const id of [I.BRONZE_FULL_HELM,I.BRONZE_PLATEBODY,I.BRONZE_PLATELEGS]) player.getInventory().adds(id,1);
  const oldEmit=PM.emitCustomEvent.bind(PM);
  t.mock.method(PM,'emitCustomEvent',(name,event) => {
    const selectedRoll = name === 'npc-drops:roll' && event?.npc === spawned && event?.player === player;
    if (selectedRoll) beforeRoll = event.drops.map(drop => ({...drop}));
    const result=oldEmit(name,event);
    if (selectedRoll) afterRoll = event.drops.map(drop => ({...drop}));
    return result;
  });
  const loc=selected.object.getLocation();
  assert.equal(PM.emitObjectInteraction({player,object:selected.object,objectId:selected.object.getId(),definition:selected.def,
    location:{x:loc.getX(),y:loc.getY(),z:loc.getZ()},clickType:selected.clickType,handled:false}),true);
  for (let i=0; i<15 && !spawned; i++) {
    core.World.process();
    spawned=[...core.World.getNpcs()].find(npc => npc?.getId()===N.ANIMATED_BRONZE_ARMOUR && npc.getOwner?.()===player) ?? null;
  }
  assert.ok(spawned?.isRegistered(), 'actual registered owned animated armour spawned');
  for (const id of [I.BRONZE_FULL_HELM,I.BRONZE_PLATEBODY,I.BRONZE_PLATELEGS]) assert.equal(player.getInventory().getAmount(id),0);
  const combat=spawned.getCombat();
  t.mock.method(combat,'getKiller',()=>player);
  t.mock.method(combat,'getRecentDamagers',()=>[player]);
  spawned.setHitpoints(0); // Fixture adapter: the actual death task and drop pipeline remain native.
  for (let i=0; i<60 && !afterRoll; i++) core.World.process();
  assert.ok(beforeRoll && afterRoll, 'native death reached actual drop roll');
  const token=I.WARRIOR_GUILD_TOKEN;
  const beforeToken=beforeRoll.filter(drop=>drop.itemId===token), afterToken=afterRoll.filter(drop=>drop.itemId===token);
  assert.equal(beforeToken.length,1); assert.equal(beforeToken[0].amount,5);
  assert.equal(afterToken.length,1); assert.equal(afterToken[0].amount,5*multiplier);
  assert.deepEqual(afterRoll.filter(drop=>drop.itemId!==token),beforeRoll.filter(drop=>drop.itemId!==token));
  const ground=ItemOnGroundManager.ownedBy(player.getUsername()).filter(item=>item.getItem().getId()===token);
  assert.equal(ground.reduce((sum,item)=>sum+item.getItem().getAmount(),0),5*multiplier);
  for (const id of [I.BRONZE_FULL_HELM,I.BRONZE_PLATEBODY,I.BRONZE_PLATELEGS]) {
    const rolled=afterRoll.filter(drop=>drop.itemId===id).reduce((sum,drop)=>sum+drop.amount,0);
    const landed=ItemOnGroundManager.ownedBy(player.getUsername()).filter(item=>item.getItem().getId()===id)
      .reduce((sum,item)=>sum+item.getItem().getAmount(),0);
    assert.equal(landed,rolled,'actually rolled bronze armour lands unchanged');
  }
}
for (const [name,claims,multiplier] of [['ordinary',0,1],['earned-unclaimed',-1,1],['Easy claimed',1,2],['Easy and Medium claimed',2,3]]) {
  test(`registered animated bronze drop: ${name}`,async t=>{
    const f=actor(t);
    if (claims!==0) seedCompleted(f);
    if (claims>0) await claimNext(t,f,'Easy');
    if (claims>1) await claimNext(t,f,'Medium');
    assert.equal(tier(f,'Easy').claimed,claims>0); assert.equal(tier(f,'Medium').claimed,claims>1);
    await animatedDrop(t,f,multiplier);
  });
}
test('registered drop hook leaves an unowned armour and an unrelated NPC unchanged', async t => {
  const f=actor(t); seedCompleted(f); await claimNext(t,f,'Easy');
  const ids=[core.NpcIdentifiers.ANIMATED_BRONZE_ARMOUR,core.NpcIdentifiers.GHOMMAL_3];
  for (const id of ids) {
    const npc=core.NPC.create(id,new core.Location(2860,3542,0));
    if (id !== ids[0]) npc.setOwner(f.player);
    const drops=[{itemId:core.ItemIdentifiers.WARRIOR_GUILD_TOKEN,amount:5},{itemId:core.ItemIdentifiers.BRONZE_FULL_HELM,amount:1}];
    const prior=drops.map(drop=>({...drop}));
    // Direct registered-event guard control; actual owned death is exercised separately.
    PM.emitCustomEvent('npc-drops:roll',{player:f.player,npc,npcId:id,drops});
    assert.deepEqual(drops,prior);
  }
});
test('previously claimed tier below the current threshold does not boost the ledger', async t => {
  const f=actor(t); seedCompleted(f); await claimNext(t,f,'Easy');
  f.player.setAttribute('combat-achievements:completed',Data.TASK_VARPS.map(()=>0));
  const q=tier(f,'Easy'); assert.equal(q.claimed,true); assert.equal(q.currentThresholdMet,false);
  const base=await earnKegs(t,f);
  assert.equal(await transferKegs(t,f,base),base);
});
test('room credit emits the existing points event once before the CA multiplier', async t => {
  const f=actor(t); seedCompleted(f); await claimNext(t,f,'Easy');
  const probe={count:0}; injectedAwards.set(f.player,probe);
  t.after(()=>injectedAwards.delete(f.player));
  const base=await earnKegs(t,f);
  assert.equal(await transferKegs(t,f,base),(base+1)*2);
  assert.equal(probe.count,1);
});
