const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { ATTR_SKIP_PERSISTENCE } = require("../plugins/bots/runtime/PersistenceConstants.PlayerBots");
const GERTRUDE_BASE_NPC = 3500; // cache base transforms by the quest varp
let core, nextIndex = 1650, hunterStarted = false;
const oldBots = process.env.DISABLE_PLAYER_BOTS, oldError = console.error, errors = [];
before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError.apply(console, args); };
  process.env.DISABLE_PLAYER_BOTS = "1";
  const root = path.resolve(__dirname, "..");
  await CachePipeline.initialize(root);
  PM.loadFromDirectory(path.join(root, "plugins"));
  core = PM.getCoreApi(); core.RegionManager.init();
  for (const id of kittenIds(core)) {
    const definition = core.ItemDefinition.forId(id);
    assert.equal(definition.getName(), "Pet kitten");
    assert.equal(definition.isStackable(), false);
  }
  for (const hook of PM.serverStartupHooks) {
    if (!["Hunter", "WarpedSceptre"].includes(hook.pluginName)) continue;
    if (hook.pluginName === "Hunter") hunterStarted = true;
    hook.handler({});
  }
});
after(() => {
  try {
    if (hunterStarted) for (const hook of PM.serverShutdownHooks) if (hook.pluginName === "Hunter") hook.handler({});
    assert.deepEqual(errors, []);
  } finally {
    console.error = oldError;
    if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = oldBots;
  }
});
function actor(t, ring = false, activatedRingHistory = ring) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  let npc, registered = false;
  t.after(() => {
    try {
      player.closeInterruptibleInterfaces();
      if (registered) { npc.setRegistered(false); core.World.getNpcs().remove(npc); }
      core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(player);
      core.TaskManager.cancelTasks(player);
      if (player.getIndex() >= 0) core.TaskManager.cancelTasks(player.getIndex());
      player.getMovementQueue().reset();
    } finally { player.setRegistered(false); }
  });
  player.setAttribute(ATTR_SKIP_PERSISTENCE, true); player.setIndex(nextIndex++);
  player.setUsername("kitten" + player.getIndex()); player.setRegistered(true);
  if (activatedRingHistory) {
    for (const name of ["The Restless Ghost", "Priest in Peril", "Creature of Fenkenstrain"]) {
      const prerequisite = QuestRuntime.questNamed(name); assert.ok(prerequisite, name);
      prerequisite.setStage(player, prerequisite.completionValue); assert.equal(prerequisite.isComplete(player), true, name);
    }
    const garden = QuestRuntime.questNamed("Garden of Tranquillity"); assert.ok(garden);
    garden.setStage(player, 40); assert.equal(garden.getStage(player), 40, "ring-activation stage");
    for (const [skill, level] of [[core.Skill.CRAFTING,20],[core.Skill.THIEVING,25],[core.Skill.FARMING,25]]) {
      player.getSkillManager().setExperiences(skill,core.SkillManager.getExperienceForLevel(level),false);
      player.getSkillManager().setMaxLevels(skill,level,false).setCurrentLevel(skill,level,false);
      assert.equal(player.getSkillManager().getMaxLevel(skill),level);
    }
  }
  const quest = QuestRuntime.questNamed("Gertrude's Cat");
  assert.ok(quest); quest.setStage(player, 5); assert.equal(quest.getStage(player), 5); assert.equal(quest.isComplete(player), false);
  if (ring) {
    player.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(core.ItemIdentifiers.RING_OF_CHAROS_A_, 1));
    assert.equal(player.getEquipment().get(core.Equipment.RING_SLOT).getId(), 6465);
  }
  const spawn = require("../data/definitions/npc-spawns.json").find(row => row.id === GERTRUDE_BASE_NPC && row.name === "Gertrude");
  assert.ok(spawn, "Gertrude has an authored spawn");
  const z = spawn.level ?? 0; core.RegionManager.loadMapFiles(spawn.x, spawn.y);
  const adjacent = [[0,1],[1,0],[0,-1],[-1,0]].find(([dx,dy]) =>
    core.RegionManager.canMove(spawn.x,spawn.y,spawn.x+dx,spawn.y+dy,z,1,1,null) &&
    core.RegionManager.canMove(spawn.x+dx,spawn.y+dy,spawn.x,spawn.y,z,1,1,null));
  assert.ok(adjacent, "Gertrude has an accessible adjacent tile");
  player.setLocation(new core.Location(spawn.x+adjacent[0],spawn.y+adjacent[1],z)); player.needsPlacement = false;
  npc = core.NPC.create(GERTRUDE_BASE_NPC,new core.Location(spawn.x,spawn.y,z)); npc.setScriptedMovement(true);
  registered = core.World.getNpcs().add(npc); assert.equal(registered,true); npc.setRegistered(true);
  const connection = new ClientConnection(channel); connection.player = player;
  assert.equal(core.GameConstants.EXPERIENCE_MULTIPLIER, 1, "standard XP world rate");
  assert.notEqual(player.getAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE), true, "XP is unlocked");
  const xpGate = PM.emitCanGainExperience(player, core.Skill.COOKING, 1525);
  assert.notEqual(xpGate.allow, false); assert.equal(xpGate.multiplier, 1, "Cooking XP gate allows the unmodified reward");
  return { player, npc, quest, connection };
}
async function send(f, packet, turns=4) {
  await f.connection.dispatch([packet]);
  for (let i=0;i<turns;i++) {
    f.player.resetUpdating(); core.TaskManager.process(); f.connection.processTurnPackets();
    const movement = f.player.getMovementQueue(); movement.beginCycle(); movement.processEntityPursuit();
    if (movement.hasPendingWork()) movement.process(); core.TaskManager.processWalkTo(f.player.getIndex());
  }
}
async function talk(f) {
  const definition = f.npc.getCurrentDefinition(f.player); assert.equal(definition.getName(), "Gertrude");
  assert.equal(definition.getId(), core.NpcIdentifiers.GERTRUDE, "quest-stage base transform resolves the quest actor");
  assert.equal(f.npc.getContentId(f.player), core.NpcIdentifiers.GERTRUDE);
  const clickType = definition.getActions().indexOf("Talk-to")+1; assert.ok(clickType>0);
  await send(f,{type:"npc_option",index:f.npc.getIndex(),clickType});
}
async function toPickerOrComplete(f) {
  for (let i=0;i<40;i++) {
    const current=f.player.getDialogueManager().getCurrent();
    if (current instanceof core.OptionDialogue) return current;
    if (f.quest.isComplete(f.player)) return null;
    assert.ok(current,"real finishing dialogue is active");
    const group=f.player.getPacketSender().getChatboxGroupId();
    await send(f,{type:"dialogue_continue",widgetId:(group<<16)|5,childIndex:-1});
  }
  assert.fail("finish dialogue did not resolve");
}
async function pick(f, n, turns=4) { await send(f,{type:"dialogue_continue",widgetId:core.OptionDialogue.OPTIONS_WIDGET_ID,childIndex:n},turns); }
function observeScroll(t, f) {
  const sender = f.player.getPacketSender(), calls = [];
  const send = sender.sendItemOnInterfaces.bind(sender);
  t.mock.method(sender, "sendItemOnInterfaces", (uid, itemId, amount) => {
    if (uid === (153 << 16 | 5)) calls.push([itemId, amount]);
    return send(uid, itemId, amount);
  });
  return calls;
}
function observeMessages(t, f) {
  const messages = [], send = f.player.sendMessage.bind(f.player);
  t.mock.method(f.player, "sendMessage", message => { messages.push(String(message)); return send(message); });
  return messages;
}
const kittenIds = coreValue => [coreValue.ItemIdentifiers.PET_KITTEN,coreValue.ItemIdentifiers.PET_KITTEN_2,coreValue.ItemIdentifiers.PET_KITTEN_3,coreValue.ItemIdentifiers.PET_KITTEN_4,coreValue.ItemIdentifiers.PET_KITTEN_5,coreValue.ItemIdentifiers.PET_KITTEN_6];
const kittens = f => kittenIds(core).reduce((n,id)=>n+f.player.getInventory().getAmount(id),0);
function snapshot(f) {
  const inv = f.player.getInventory();
  return { xp: f.player.getSkillManager().getExperience(core.Skill.COOKING),
    qp: Number(f.player.getAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE)) || 0,
    cake: inv.getAmount(core.ItemIdentifiers.CHOCOLATE_CAKE), stew: inv.getAmount(core.ItemIdentifiers.STEW),
    coins: inv.getAmount(core.ItemIdentifiers.COINS), kittens: kittens(f), bones: inv.getAmount(core.ItemIdentifiers.BONES) };
}
function assertReward(before, after) {
  assert.deepEqual(after, { ...before, xp: before.xp + 1525, qp: before.qp + 1,
    cake: before.cake + 1, stew: before.stew + 1, kittens: before.kittens + 1 });
}

test("ring choice selects a free initial kitten exactly once",async t=>{
  const f=actor(t,true); const scroll=observeScroll(t,f); f.player.getInventory().adds(core.ItemIdentifiers.COINS,200);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS),200);
  assert.ok(f.player.getInventory().getFreeSlots() >= 3);
  const before=snapshot(f); await talk(f); const picker=await toPickerOrComplete(f);
  assert.ok(picker,"worn activated ring reaches the existing TSPS picker");
  assert.equal(core.MultiChatboxPrompt.getPending(f.player),null,"OptionDialogue owns the native menu");
  assert.ok(picker.getOptions().includes("Black")); assert.equal(kittens(f),0); assert.equal(f.quest.isComplete(f.player),false);
  assert.deepEqual(scroll, [], "scroll is not shown before completion");
  await pick(f,picker.getOptions().indexOf("Black")+1);
  assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.PET_KITTEN_4),1);
  assert.deepEqual(scroll, [[core.ItemIdentifiers.PET_KITTEN_4,1]], "deferred scroll displays the awarded kitten");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS),200);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.CHOCOLATE_CAKE),1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.STEW),1);
  const after=snapshot(f); assertReward(before,after);
  await pick(f,picker.getOptions().indexOf("Black")+1); assert.deepEqual(snapshot(f),after,"replayed choice has no effect");
  assert.equal(f.quest.complete(f.player),false); assert.deepEqual(snapshot(f),after,"repeat completion has no effect");
});

test("removing the ring before choosing does not complete or award the quest",async t=>{
  const f=actor(t,true); const messages=observeMessages(t,f); await talk(f); const picker=await toPickerOrComplete(f); assert.ok(picker);
  f.player.getEquipment().setItem(core.Equipment.RING_SLOT,new core.Item(-1,0));
  const before=snapshot(f);
  await pick(f,1); assert.equal(f.quest.isComplete(f.player),false); assert.deepEqual(snapshot(f),before);
  assert.ok(messages.includes("Wear your Ring of Charos(a) to choose a kitten. Talk to Gertrude again."));
  const messageCount=messages.length; await pick(f,1); assert.equal(messages.length,messageCount,"stale choice stays silent");
  assert.deepEqual(snapshot(f),before);
  await talk(f); await toPickerOrComplete(f); assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
});

test("ordinary completion grants a single random variant",async t=>{
  const f=actor(t,false); await talk(f); await toPickerOrComplete(f);
  assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.CHOCOLATE_CAKE),1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.STEW),1);
  assert.equal(f.quest.complete(f.player),false); assert.equal(kittens(f),1);
});
test("canceling the picker leaves the quest resumable",async t=>{
  const f=actor(t,true); await talk(f); let menu=await toPickerOrComplete(f); assert.ok(menu);
  await pick(f,5); menu=f.player.getDialogueManager().getCurrent();
  assert.ok(menu instanceof core.OptionDialogue); assert.ok(menu.getOptions().includes("Cancel"));
  const before=snapshot(f); await pick(f,menu.getOptions().indexOf("Cancel")+1);
  assert.equal(f.quest.isComplete(f.player),false); assert.deepEqual(snapshot(f),before);
  await talk(f); menu=await toPickerOrComplete(f); assert.ok(menu instanceof core.OptionDialogue);
  await pick(f,1); assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
});

test("losing reward space while choosing does not consume the completion",async t=>{
  const f=actor(t,true); const messages=observeMessages(t,f); await talk(f); const menu=await toPickerOrComplete(f); assert.ok(menu);
  for (let i=0;i<26;i++) f.player.getInventory().add(new core.Item(core.ItemIdentifiers.BONES,1),true);
  assert.equal(f.player.getInventory().getFreeSlots(),2);
  const before=snapshot(f); await pick(f,1); assert.equal(f.quest.isComplete(f.player),false); assert.deepEqual(snapshot(f),before);
  assert.ok(messages.includes("You need three free inventory slots to receive Gertrude's rewards."));
  const messageCount=messages.length; await pick(f,1); assert.equal(messages.length,messageCount,"stale choice stays silent");
  assert.deepEqual(snapshot(f),before);
  f.player.getInventory().deleteNumber(core.ItemIdentifiers.BONES,1);
  assert.equal(f.player.getInventory().getFreeSlots(),3);
  await talk(f); assert.ok(await toPickerOrComplete(f)); await pick(f,1);
  assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
});

test("unringed direct completion draws from more than one kitten variant",t=>{
  const a=actor(t), b=actor(t);
  const originalRandom=Math.random; let sample=0, hits=0;
  t.after(()=>{ Math.random=originalRandom; });
  Math.random=function scopedRewardRandom() {
    const caller=String(new Error().stack).split("\n")[2] ?? "";
    if (/\bgrantReward\b/.test(caller) && /GertrudesCat\.Quest\.js/.test(caller)) { hits++; return sample; }
    return originalRandom();
  };
  assert.equal(a.quest.complete(a.player,{scroll:false,announce:false}),true);
  sample=0.999999;
  assert.equal(b.quest.complete(b.player,{scroll:false,announce:false}),true);
  assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.PET_KITTEN),1);
  assert.equal(b.player.getInventory().getAmount(core.ItemIdentifiers.PET_KITTEN_6),1);
  assert.equal(hits,2,"scoped RNG was consumed by the reward producer");
  assert.equal(kittens(a),1); assert.equal(kittens(b),1);
});
test("each existing palette choice grants its selected kitten once",async t=>{
  const names=["Grey and black","White","Brown","Black","Grey and brown","Grey and blue"];
  for (let i=0;i<names.length;i++) {
    const f=actor(t,true); await talk(f); let menu=await toPickerOrComplete(f); assert.ok(menu);
    if (i>=4) { await pick(f,5); menu=f.player.getDialogueManager().getCurrent(); }
    assert.ok(menu instanceof core.OptionDialogue);
    const index=menu.getOptions().indexOf(names[i]); assert.ok(index>=0, names[i]);
    await pick(f,index+1); assert.equal(f.quest.isComplete(f.player),true);
    assert.equal(f.player.getInventory().getAmount(kittenIds(core)[i]),1,names[i]); assert.equal(kittens(f),1);
  }
});
test("a carried or unactivated ring does not enable the picker",async t=>{
  for (const carried of [true,false]) {
    const f=actor(t,false,carried);
    if (carried) f.player.getInventory().adds(core.ItemIdentifiers.RING_OF_CHAROS_A_,1);
    else f.player.getEquipment().setItem(core.Equipment.RING_SLOT,new core.Item(core.ItemIdentifiers.RING_OF_CHAROS,1));
    await talk(f); const picker=await toPickerOrComplete(f);
    assert.equal(picker,null); assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
  }
});

test("deferred completion scrolls show each player's actual random kitten", t => {
  const a=actor(t), b=actor(t), first=observeScroll(t,a), second=observeScroll(t,b);
  const cooking=core.Skill.COOKING, xp=core.SkillManager.getExperienceForLevel(50);
  assert.ok(core.SkillManager.getExperienceForLevel(51)-xp>1525,"reward crosses no level boundary");
  for (const f of [a,b]) {
    f.player.getSkillManager().setExperiences(cooking,xp,false);
    f.player.getSkillManager().setMaxLevels(cooking,50,false).setCurrentLevel(cooking,50,false);
    assert.equal(f.player.getSkillManager().getMaxLevel(cooking),50);
  }
  const held=new core.OptionDialogue(0,{executeOption() {}},"Continue later");
  a.player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(held));
  assert.equal(a.player.getDialogueManager().getCurrent(),held);
  assert.equal(a.quest.complete(a.player),true);
  assert.equal(a.player.getSkillManager().getMaxLevel(cooking),50);
  assert.equal(a.player.getDialogueManager().getCurrent(),held);
  assert.equal(a.player.getPacketSender().getChatboxGroupId(),219);
  assert.equal(b.quest.complete(b.player),true);
  const awarded = f => {
    assert.equal(kittens(f),1,"exactly one kitten was awarded");
    const ids=kittenIds(core).filter(id => f.player.getInventory().getAmount(id) === 1);
    assert.equal(ids.length,1,"the awarded kitten is a known variant");
    return ids[0];
  };
  const aKitten=awarded(a), bKitten=awarded(b);
  assert.deepEqual(first,[]); assert.deepEqual(second,[]);
  for (let i=0;i<4;i++) core.TaskManager.process();
  assert.equal(a.player.getDialogueManager().getCurrent(),held);
  assert.equal(a.player.getPacketSender().getChatboxGroupId(),219);
  assert.deepEqual(first,[],"open dialogue defers the first scroll");
  assert.deepEqual(second,[[bKitten,1]]);
  a.player.closeInterruptibleInterfaces();
  assert.equal(a.player.getDialogueManager().isActive(),false);
  for (let i=0;i<4;i++) core.TaskManager.process();
  assert.deepEqual(first,[[aKitten,1]]);
  assert.equal(a.player.getInventory().getAmount(aKitten),1);
  assert.equal(b.player.getInventory().getAmount(bKitten),1);
  assert.equal(kittens(a),1); assert.equal(kittens(b),1);
});

test("distinct chosen kittens stay with their own delayed completion scroll",async t=>{
  const a=actor(t,true), b=actor(t,true), first=observeScroll(t,a), second=observeScroll(t,b);
  const cooking=core.Skill.COOKING, xp=core.SkillManager.getExperienceForLevel(50);
  assert.ok(core.SkillManager.getExperienceForLevel(51)-xp>1525);
  for (const f of [a,b]) {
    f.player.getSkillManager().setExperiences(cooking,xp,false);
    f.player.getSkillManager().setMaxLevels(cooking,50,false).setCurrentLevel(cooking,50,false);
    assert.equal(f.player.getSkillManager().getMaxLevel(cooking),50);
  }
  const beforeA=snapshot(a), beforeB=snapshot(b);
  await talk(a); const menuA=await toPickerOrComplete(a); assert.ok(menuA instanceof core.OptionDialogue);
  await talk(b); const menuB=await toPickerOrComplete(b); assert.ok(menuB instanceof core.OptionDialogue);
  const black=menuA.getOptions().indexOf("Black")+1, white=menuB.getOptions().indexOf("White")+1;
  assert.ok(black>0 && white>0);
  // One native turn delivers the decoded choice after task processing, before the next task tick.
  await pick(a,black,1);
  assert.equal(a.quest.isComplete(a.player),true);
  assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.PET_KITTEN_4),1);
  assert.deepEqual(first,[],"first completion has not yet sent its scroll");
  assertReward(beforeA,snapshot(a));
  const held=new core.OptionDialogue(0,{executeOption() {}},"Continue later");
  a.player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(held));
  assert.equal(a.player.getDialogueManager().getCurrent(),held);
  assert.equal(a.player.getPacketSender().getChatboxGroupId(),219);
  await pick(b,white);
  assert.equal(b.quest.isComplete(b.player),true);
  assert.equal(b.player.getInventory().getAmount(core.ItemIdentifiers.PET_KITTEN_2),1);
  assertReward(beforeB,snapshot(b));
  assert.equal(a.player.getDialogueManager().getCurrent(),held);
  assert.equal(a.player.getPacketSender().getChatboxGroupId(),219);
  assert.deepEqual(first,[],"open first dialogue holds its scroll");
  assert.deepEqual(second,[[core.ItemIdentifiers.PET_KITTEN_2,1]]);
  a.player.closeInterruptibleInterfaces();
  assert.equal(a.player.getDialogueManager().isActive(),false);
  for(let i=0;i<4;i++) core.TaskManager.process();
  assert.deepEqual(first,[[core.ItemIdentifiers.PET_KITTEN_4,1]]);
  assert.deepEqual(second,[[core.ItemIdentifiers.PET_KITTEN_2,1]]);
  const afterA=snapshot(a), afterB=snapshot(b);
  await pick(a,black); await pick(b,white);
  assert.deepEqual(snapshot(a),afterA); assert.deepEqual(snapshot(b),afterB);
  assert.deepEqual(first,[[core.ItemIdentifiers.PET_KITTEN_4,1]]);
  assert.deepEqual(second,[[core.ItemIdentifiers.PET_KITTEN_2,1]]);
});
