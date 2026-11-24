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
    if (!["Hunter", "WarpedSceptre", "IbansStaff"].includes(hook.pluginName)) continue;
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
/** The kitten Gertrude handed over: following (as live gives it, Gertrude's Cat capture tick 863) or carried. */
function follower(f) { const request={player:f.player,pet:null}; PM.emitCustomEvent("pets:current",request); return request.pet; }
const KITTEN_NPCS = [5591,5592,5593,5594,5595,5596]; // kittenpet_*: the same order as PET_KITTEN..PET_KITTEN_6
function kittenItems(f) {
  const held = kittenIds(core).flatMap(id => Array(f.player.getInventory().getAmount(id)).fill(id));
  const pet = follower(f), at = KITTEN_NPCS.indexOf(pet?.getId?.());
  return at >= 0 ? [...held, kittenIds(core)[at]] : held;
}
const kittens = f => kittenItems(f).length;
function dismiss(f) { const pet = follower(f); if (pet) { core.World.getNpcs().remove(pet); f.player.setAttribute("pets:current", null); } }
/** The reward's food comes 5 ticks after the kitten and the scroll 4 after that. */
function settle(n = 12) { for (let i = 0; i < n; i++) core.TaskManager.process(); }
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
const SCROLL_KITTEN = () => core.CacheDefinitions.getObjId("kittenobject_dummy");

test("ring choice selects a free initial kitten exactly once",async t=>{
  const f=actor(t,true); const scroll=observeScroll(t,f); f.player.getInventory().adds(core.ItemIdentifiers.COINS,200);
  const before=snapshot(f); await talk(f); const picker=await toPickerOrComplete(f);
  assert.ok(picker,"worn activated ring reaches the existing TSPS picker");
  assert.equal(core.MultiChatboxPrompt.getPending(f.player),null,"OptionDialogue owns the native menu");
  assert.ok(picker.getOptions().includes("Black")); assert.equal(kittens(f),0); assert.equal(f.quest.isComplete(f.player),false);
  assert.deepEqual(scroll, [], "scroll is not shown before completion");
  await pick(f,picker.getOptions().indexOf("Black")+1); settle();
  assert.equal(f.quest.isComplete(f.player),true);
  assert.deepEqual(kittenItems(f),[core.ItemIdentifiers.PET_KITTEN_4]);
  assert.deepEqual(scroll, [[SCROLL_KITTEN(),1]], "the scroll shows live's kitten model");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS),200);
  const after=snapshot(f); assertReward(before,after);
  await pick(f,picker.getOptions().indexOf("Black")+1); settle(); assert.deepEqual(snapshot(f),after,"replayed choice has no effect");
  assert.equal(f.quest.complete(f.player),false); assert.deepEqual(snapshot(f),after,"repeat completion has no effect");
});

test("removing the ring before choosing does not complete or award the quest",async t=>{
  const f=actor(t,true); const messages=observeMessages(t,f); await talk(f); const picker=await toPickerOrComplete(f); assert.ok(picker);
  f.player.getEquipment().setItem(core.Equipment.RING_SLOT,new core.Item(-1,0));
  const before=snapshot(f);
  await pick(f,1); settle(); assert.equal(f.quest.isComplete(f.player),false); assert.deepEqual(snapshot(f),before);
  assert.ok(messages.includes("Wear your Ring of Charos(a) to choose a kitten. Talk to Gertrude again."));
  const messageCount=messages.length; await pick(f,1); assert.equal(messages.length,messageCount,"stale choice stays silent");
  assert.deepEqual(snapshot(f),before);
  await talk(f); await toPickerOrComplete(f); settle(); assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
});

test("ordinary completion grants a single random variant",async t=>{
  const f=actor(t,false); const before=snapshot(f); await talk(f); await toPickerOrComplete(f); settle();
  assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
  assertReward(before,snapshot(f));
  assert.equal(f.quest.complete(f.player),false); assert.equal(kittens(f),1);
});
test("canceling the picker leaves the quest resumable",async t=>{
  const f=actor(t,true); await talk(f); let menu=await toPickerOrComplete(f); assert.ok(menu);
  await pick(f,5); menu=f.player.getDialogueManager().getCurrent();
  assert.ok(menu instanceof core.OptionDialogue); assert.ok(menu.getOptions().includes("Cancel"));
  const before=snapshot(f); await pick(f,menu.getOptions().indexOf("Cancel")+1); settle();
  assert.equal(f.quest.isComplete(f.player),false); assert.deepEqual(snapshot(f),before);
  await talk(f); menu=await toPickerOrComplete(f); assert.ok(menu instanceof core.OptionDialogue);
  await pick(f,1); settle(); assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
});

test("a full inventory still completes: the kitten follows and the food lands at the player's feet",async t=>{
  const f=actor(t,false);
  for (let i=0;i<28;i++) f.player.getInventory().add(new core.Item(core.ItemIdentifiers.BONES,1),true);
  assert.equal(f.player.getInventory().getFreeSlots(),0);
  await talk(f); await toPickerOrComplete(f); settle();
  assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1, "the kitten follows rather than needing a slot");
  const floor = id => core.ItemOnGroundManager.getItems?.()?.some?.(g => g?.getItem?.()?.getId?.() === id && g.getPosition?.()?.equals?.(f.player.getLocation()));
  if (floor(core.ItemIdentifiers.CHOCOLATE_CAKE) !== undefined) {
    assert.equal(floor(core.ItemIdentifiers.CHOCOLATE_CAKE),true); assert.equal(floor(core.ItemIdentifiers.STEW),true);
  }
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
  assert.deepEqual(kittenItems(a),[core.ItemIdentifiers.PET_KITTEN]);
  assert.deepEqual(kittenItems(b),[core.ItemIdentifiers.PET_KITTEN_6]);
  assert.equal(hits,2,"scoped RNG was consumed by the reward producer");
});
test("each existing palette choice grants its selected kitten once",async t=>{
  const names=["Grey and black","White","Brown","Black","Grey and brown","Grey and blue"];
  for (let i=0;i<names.length;i++) {
    const f=actor(t,true); await talk(f); let menu=await toPickerOrComplete(f); assert.ok(menu);
    if (i>=4) { await pick(f,5); menu=f.player.getDialogueManager().getCurrent(); }
    assert.ok(menu instanceof core.OptionDialogue);
    const index=menu.getOptions().indexOf(names[i]); assert.ok(index>=0, names[i]);
    await pick(f,index+1); settle(); assert.equal(f.quest.isComplete(f.player),true);
    assert.deepEqual(kittenItems(f),[kittenIds(core)[i]],names[i]);
    dismiss(f);
  }
});
test("a carried or unactivated ring does not enable the picker",async t=>{
  for (const carried of [true,false]) {
    const f=actor(t,false,carried);
    if (carried) f.player.getInventory().adds(core.ItemIdentifiers.RING_OF_CHAROS_A_,1);
    else f.player.getEquipment().setItem(core.Equipment.RING_SLOT,new core.Item(core.ItemIdentifiers.RING_OF_CHAROS,1));
    await talk(f); const picker=await toPickerOrComplete(f); settle();
    assert.equal(picker,null); assert.equal(f.quest.isComplete(f.player),true); assert.equal(kittens(f),1);
    dismiss(f);
  }
});

test("a player with a follower already out gets the kitten in the backpack",async t=>{
  const f=actor(t,false);
  const first={player:f.player,itemId:core.ItemIdentifiers.PET_KITTEN,following:false};
  PM.emitCustomEvent("pets:summon",first); assert.equal(first.following,true);
  const out=follower(f);
  await talk(f); await toPickerOrComplete(f); settle();
  assert.equal(f.quest.isComplete(f.player),true);
  assert.equal(follower(f),out,"the follower already out stays");
  assert.equal(kittenIds(core).reduce((n,id)=>n+f.player.getInventory().getAmount(id),0),1,"the new kitten is carried");
  dismiss(f);
});
