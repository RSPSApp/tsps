// Native controls for clue modifiers. Cache 2746; use the existing server test recipe.
const assert = require("node:assert/strict");
const path = require("node:path");
const {test, before, after} = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline} = require("../dist/game/cache/CachePipeline");
const {PluginManager: PM} = require("../dist/plugins/PluginManager");
const {Player} = require("../dist/game/entity/impl/player/Player");
const {PlayerSession} = require("../dist/net/PlayerSession");
const {SkillManager} = require("../dist/game/content/skill/SkillManager");
const {ClientConnection} = require("../dist/net/NetworkBuilder");
let core, submit;
const createdTasks = new Set();
const priorRandom = Math.random, priorBots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  submit = core.TaskManager.submit;
  core.TaskManager.submit = function (...args) {
    if (args[0]) createdTasks.add(args[0]);
    return submit.apply(this, args);
  };
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  for (const [x, y] of [[3222,3218], [3186,3927], [1365,3632]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
  core.World.process();
});
after(() => {
  Math.random = priorRandom;
  try { PM.emitServerShutdown({}); }
  finally {
    try { for (const task of createdTasks) task.stop(); }
    finally {
      if (submit) core.TaskManager.submit = submit;
      if (priorBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
      else process.env.DISABLE_PLAYER_BOTS = priorBots;
    }
  }
});
let sequence = 0;
function actor(t, x, y) {
  const channel = {kind:"test", remoteAddress:"127.0.0.1", isOpen:()=>true,
    send:()=>true, close(){}, onData(){}, onError(){}, onClose(){}};
  const player = new Player(new PlayerSession(channel));
  player.setUsername(`cluemodifier${++sequence}`);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(x,y,0));
  assert.equal(core.World.getPlayers().add(player), true);
  player.needsPlacement = false;
  const client = new ClientConnection(channel); client.player = player;
  const groundBefore = new Set(core.World.getItems());
  t.after(() => {
    Math.random = priorRandom;
    try {
      PM.emitPlayerLogout({player, username:player.getUsername()});
      core.TaskManager.cancelTasks(player.getIndex());
      core.TaskManager.cancelTasks(player);
      if (player.isRegistered()) core.World.getPlayers().removes(player);
    } finally {
      for (const ground of [...core.World.getItems()]) {
        if (!groundBefore.has(ground) && ground.getOwner() === player.getUsername()) core.ItemOnGroundManager.deregister(ground);
      }
      core.ItemOnGroundManager.process();
    }
  });
  return {player,client};
}
function level(player, skill, value) {
  const s = player.getSkillManager();
  s.setExperience(skill, SkillManager.getExperienceForLevel(value));
  s.setMaxLevel(skill, value); s.setCurrentLevel(skill, value, true);
}
function boxes(player, eligible) {
  const bank = player.getBank(0); bank.resetItems();
  for (const tier of ["BEGINNER","EASY","MEDIUM","HARD","ELITE"]) {
    if (tier !== eligible) bank.add(new core.Item(core.ItemIdentifiers[`SCROLL_BOX_${tier}_`],2), true);
  }
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find(q => q.key === "x_marks_the_spot");
  assert.ok(quest); if (!quest.isComplete(player)) assert.equal(quest.complete(player,{scroll:false,announce:false}),true);
  const q = {player,tier:eligible.toLowerCase(),allowed:null};
  PM.emitCustomEvent("treasure-trails:can-receive",q); assert.equal(q.allowed,true);
}
function unlockEasy(player) {
  const D = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
  const P = require("../plugins/achievements/combatachievements/Progress.CombatAchievements");
  const tier = D.tiers().find(x => x.name.toLowerCase() === "easy");
  assert.ok(tier);
  for (const task of D.tasks().values()) { if (P.points(player) >= tier.threshold) break; P.complete(player,task,{silent:true}); }
  const request = {player,tier:"easy",currentThresholdMet:null};
  PM.emitCustomEvent("combat-achievements:tier",request);
  assert.equal(request.currentThresholdMet,true);
}
// All object scenes below place cache-defined objects at fixture coordinates;
// they do not establish natural map spawns.
async function objectCatch(t, f, row, draw) {
  const {player,client}=f, I=core.ItemIdentifiers, inventory=player.getInventory();
  inventory.resetItems(); inventory.add(new core.Item(row.tool),true);
  const location=new core.Location(row.x,row.y,0);
  player.setLocation(new core.Location(row.x-1,row.y,0)); player.needsPlacement=false; player.getMovementQueue().reset();
  const object=new core.GameObject(row.id,location,10,0,null);
  // Registration can replace a same-tile dynamic or map object. Restore every
  // replaced object on all exits so the synthetic scene does not leak.
  const replaced=core.ObjectManager.objectsAt(location).filter(o =>
    o.getType() === object.getType() && o.getPrivateArea() === object.getPrivateArea() && o.getOwner() === object.getOwner());
  core.ObjectManager.register(object,true);
  let rolls=0; const observedCallers=[];
  Math.random=()=>{
    const stack=new Error().stack;
    const caller = stack.split("\n")[2] ?? "";
    if (stack.includes(row.clueModule) && observedCallers.length < 4) observedCallers.push(caller.trim());
    const namedProducer = new RegExp(`\\b${row.clue}(?: \\[as handler\\])? \\(`).test(caller);
    if (namedProducer && caller.includes(row.clueModule)) {rolls++; return draw;}
    if (stack.includes("rollSucceeds") || stack.includes("rollLog") || stack.includes("rollGemTable")) return 0.02;
    if (stack.includes("maybeDropBirdNest")) return 0.99;
    return priorRandom();
  };
  const xp=player.getSkillManager().getExperience(row.skill);
  try {
    await client.dispatch([{type:"object_option",id:row.id,x:row.x,y:row.y,action:row.action}]);
    client.processTurnPackets(); core.World.process();
    for (let i=0;i<20 && !inventory.getAmount(row.resource);i++) core.World.process();
    assert.ok(inventory.getAmount(row.resource)>=1, "control: native action produces the resource");
    assert.ok(player.getSkillManager().getExperience(row.skill)>xp, "control: native action grants XP");
    assert.equal(player.getSkillManager().getCurrentLevel(row.skill),row.level ?? 30, "the rate uses the intended visible level");
    assert.equal(rolls,5, `the five actual clue-tier rolls consume the scoped draw; callers: ${JSON.stringify(observedCallers)}`);
    return inventory.getAmount(I[`SCROLL_BOX_${row.reward ?? "EASY"}_`]);
  } finally {
    Math.random=priorRandom; player.getSkillManager().stopSkillable();
    const respawns=[...createdTasks].filter(task => task.originalRockObject === object || task.originalTreeObject === object);
    for (const task of respawns) {
      task.stop();
      const replacement=task.depletedObject ?? task.stumpObject;
      if (replacement) core.ObjectManager.deregister(replacement,true);
    }
    core.ObjectManager.deregister(object,true);
    for (const previous of replaced) core.ObjectManager.register(previous,true);
    player.setLocation(new core.Location(row.x-4,row.y,0)); player.needsPlacement=false;
    core.World.process();
    for (const task of respawns) assert.equal(task.isRunning(),false,"fixture-owned respawn task is stopped");
    for (const previous of replaced) {
      assert.ok(core.ObjectManager.objectsAt(location).includes(previous) ||
        core.MapObjects.get(previous.getId(), location, previous.getPrivateArea()) === previous,
        "the scene object replaced by the fixture is restored");
    }
  }
}

test("native copper geodes use the documented unboosted floor order", async t => {
  const f=actor(t,3222,3218), I=core.ItemIdentifiers;
  level(f.player,core.Skill.MINING,20); boxes(f.player,"EASY");
  const row={skill:core.Skill.MINING,level:20,tool:I.BRONZE_PICKAXE,id:core.CacheDefinitions.getLocId("copperrock1"),
    action:"Mine",resource:I.COPPER_ORE,clue:"rollClueGeodes",clueModule:"ClueGeodes.Mining.js",x:3223,y:3218};
  // Legacy denominator 7352 admits this roll; documented integer-ratio
  // base adjustment and floor order produce 7354 and reject it.
  assert.equal(await objectCatch(t,f,row,1/7353),0,"unboosted geode uses the documented floor order");
});

test("native copper geodes apply matching Combat Achievement reward", async t => {
  const f=actor(t,3222,3218), I=core.ItemIdentifiers;
  level(f.player,core.Skill.MINING,30); boxes(f.player,"EASY");
  const row={skill:core.Skill.MINING,tool:I.BRONZE_PICKAXE,id:core.CacheDefinitions.getLocId("copperrock1"),
    action:"Mine",resource:I.COPPER_ORE,clue:"rollClueGeodes",clueModule:"ClueGeodes.Mining.js",x:3223,y:3218};
  assert.equal(await objectCatch(t,f,row,1/6600),0,"control: non-CA easy misses");
  unlockEasy(f.player);
  assert.equal(await objectCatch(t,f,row,1/6600),1,"eligible easy CA changes the real geode outcome");
  boxes(f.player,"MEDIUM");
  const medium = {player:f.player,tier:"medium",currentThresholdMet:null}; PM.emitCustomEvent("combat-achievements:tier",medium);
  assert.equal(medium.currentThresholdMet,false);
  assert.equal(await objectCatch(t,f,{...row,reward:"MEDIUM"},1/7800),0,"easy CA does not boost medium geodes");
  boxes(f.player,"BEGINNER");
  assert.equal(await objectCatch(t,f,{...row,reward:"BEGINNER"},1/775),0,"easy CA does not boost beginner geodes");
});

test("native tree nests apply matching Combat Achievement reward", async t => {
  const f=actor(t,3222,3218), I=core.ItemIdentifiers;
  level(f.player,core.Skill.WOODCUTTING,30); boxes(f.player,"EASY");
  const row={skill:core.Skill.WOODCUTTING,tool:I.BRONZE_AXE,id:core.ObjectIdentifiers.TREE,
    action:"Chop down",resource:I.LOGS,clue:"rollClueNests",clueModule:"ClueNests.Woodcutting.js",x:3223,y:3218};
  assert.equal(await objectCatch(t,f,row,1/4050),0,"control: non-CA easy misses");
  unlockEasy(f.player);
  assert.equal(await objectCatch(t,f,row,1/4050),1,"eligible easy CA changes the real nest outcome");
  boxes(f.player,"MEDIUM");
  const medium = {player:f.player,tier:"medium",currentThresholdMet:null}; PM.emitCustomEvent("combat-achievements:tier",medium);
  assert.equal(medium.currentThresholdMet,false);
  assert.equal(await objectCatch(t,f,{...row,reward:"MEDIUM"},1/4750),0,"easy CA does not boost medium nests");
  boxes(f.player,"BEGINNER");
  assert.equal(await objectCatch(t,f,{...row,reward:"BEGINNER"},1/475),0,"easy CA does not boost beginner nests");
});

// The tree object is cache-defined but placed by the fixture; this checks server
// Wilderness classification and the registered action, not a natural map spawn.
test("native Wilderness tree nests apply the imbued ring only to nonbeginner tiers", async t => {
  const f=actor(t,3186,3927), I=core.ItemIdentifiers, equipment=f.player.getEquipment();
  level(f.player,core.Skill.WOODCUTTING,30); boxes(f.player,"EASY");
  const row={skill:core.Skill.WOODCUTTING,tool:I.BRONZE_AXE,id:core.ObjectIdentifiers.TREE,
    action:"Chop down",resource:I.LOGS,clue:"rollClueNests",clueModule:"ClueNests.Woodcutting.js",x:3187,y:3927};
  assert.ok(core.Wilderness.levelAt(3186,3927)>0);
  assert.equal(await objectCatch(t,f,row,1.5/4153),0,"control: easy without ring misses");
  equipment.setItem(core.Equipment.RING_SLOT,new core.Item(I.RING_OF_WEALTH_I_));
  assert.equal(await objectCatch(t,f,row,1.5/4153),1,"Wilderness ring doubles the easy chance");
  assert.equal(await objectCatch(t,f,{...row,x:3223,y:3218},1.5/4153),0,"ring outside Wilderness does not double");
  boxes(f.player,"BEGINNER");
  assert.equal(await objectCatch(t,f,{...row,reward:"BEGINNER"},1.5/488),0,"beginner is not doubled");
  equipment.setItem(core.Equipment.RING_SLOT,new core.Item(-1,0));
});

test("native Aerial bottles apply matching Combat Achievement reward", async t => {
  const f=actor(t,1365,3632), player=f.player, I=core.ItemIdentifiers, N=core.NpcIdentifiers;
  level(player,core.Skill.FISHING,43); level(player,core.Skill.HUNTER,35); boxes(player,"EASY");
  const inventory=player.getInventory(); inventory.add(new core.Item(I.KING_WORM,5),true);
  const alry=core.NPC.create(N.ALRY_THE_ANGLER,new core.Location(1367,3632,0));
  const spot=core.NPC.create(N.FISHING_SPOT_12,new core.Location(1358,3631,0));
  alry.setScriptedMovement(true); spot.setScriptedMovement(true);
  t.after(() => { if(alry.isRegistered()) core.World.getNpcs().removes(alry); if(spot.isRegistered()) core.World.getNpcs().removes(spot); });
  assert.equal(core.World.getNpcs().add(alry),true); assert.equal(core.World.getNpcs().add(spot),true);
  alry.needsPlacement=false; spot.needsPlacement=false;
  function interact(npc, action) {
    const definition=npc.getCurrentDefinition(player), clickType=definition.getActions().indexOf(action)+1;
    assert.ok(clickType>0, `cache exposes ${action}`);
    return PM.emitNpcInteraction({player,npc,npcId:npc.getId(),definition,clickType,handled:false});
  }
  function catchOnce(tier="EASY", draw=1/7370) {
    let rolls=0, ordinary=0;
    Math.random=()=>{
      const stack=new Error().stack;
      if (stack.includes("rollClueBottles")) {ordinary++;return 0;}
      if (/\bat roll \([^\n]*Context\.Hunter\.js:\d+:\d+\)/.test(stack) && stack.includes("Aerial.Hunter")) return rolls++ === 2 ? draw : 0.25;
      if (stack.includes("Aerial.Hunter")) return 0.25;
      return priorRandom();
    };
    const fishing=player.getSkillManager().getExperience(core.Skill.FISHING);
    const hunter=player.getSkillManager().getExperience(core.Skill.HUNTER);
    const fish=inventory.getAmount(I.BLUEGILL), bait=inventory.getAmount(I.KING_WORM);
    try {
      assert.equal(interact(spot,"Catch"),true);
      for(let i=0;i<5;i++) core.World.process();
      assert.equal(inventory.getAmount(I.BLUEGILL)-fish,1,"control: genuine Aerial fish");
      assert.equal(bait-inventory.getAmount(I.KING_WORM),1,"control: one king worm consumed");
      assert.ok(player.getSkillManager().getExperience(core.Skill.FISHING)>fishing);
      assert.ok(player.getSkillManager().getExperience(core.Skill.HUNTER)>hunter);
      assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.FISHING),43);
      assert.equal(ordinary,0,"no ordinary Fishing bottle producer"); assert.equal(rolls,3,"two fish-selection and one eligible clue roll");
      return inventory.getAmount(I[`SCROLL_BOX_${tier}_`]);
    } finally {Math.random=priorRandom;}
  }
  try {
    assert.equal(interact(alry,"Get bird"),true);
    assert.equal(player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(),I.CORMORANTS_GLOVE_2);
    assert.equal(catchOnce(),0,"control: non-CA easy misses");
    unlockEasy(player);
    assert.equal(catchOnce(),1,"eligible easy CA changes the real Aerial bottle outcome");
    boxes(player,"MEDIUM");
    const medium = {player,tier:"medium",currentThresholdMet:null}; PM.emitCustomEvent("combat-achievements:tier",medium);
    assert.equal(medium.currentThresholdMet,false);
    assert.equal(catchOnce("MEDIUM",1/8700),0,"easy CA does not boost medium bottles");
    boxes(player,"BEGINNER");
    assert.equal(catchOnce("BEGINNER",1/870),0,"easy CA does not boost beginner bottles");
  } finally {
    interact(alry,"Get bird");
    if(alry.isRegistered()) core.World.getNpcs().removes(alry);
    if(spot.isRegistered()) core.World.getNpcs().removes(spot);
  }
});
