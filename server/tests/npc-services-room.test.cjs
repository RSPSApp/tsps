// Run after `yarn build`: node --test tests/npc-services-room.test.cjs
//
// Zahur and Mawnis take payment and hand something back, so they must not take what they can't give.
// Native fixture: registered NPCs through real npc_option, Mawnis's real transcript, answers through
// ClientConnection.dispatch. The hard Desert Diary is the real saved task list, set directly because a
// fixture can't play it; the quest stage is set the same way. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");

const { DIARIES } = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Ecto = require("../plugins/skills/ectofuntus/Common.Ectofuntus");

const HOME = [3222, 3218];
const YES = 1;
const COST = 200;
const NO_SPACE = "You don't have enough inventory space.";
const NO_COINS = "You don't have enough coins.";
const HANDS_OVER = "The Burgher hands you his helm.";
const HELM_PRICE = 50000;
const HERBALIST_TASK = "have-the-nardah-herbalist-clean-a-herb-for-you";

let core;
let I;
let next = 6400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, { desertDiary = true } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("npcroom" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  if (desertDiary) {
    const desert = DIARIES.find((diary) => diary.key === "desert");
    p.setAttribute(Progress.TASKS_ATTRIBUTE, { desert: desert.tiers.hard.tasks.map((task) => task.key) });
  }
  return { p, c, inv: p.getInventory(), messages };
}

const creditedForCleaning = (f) =>
  Progress.doneTasks(f.p, DIARIES.find((diary) => diary.key === "desert")).has(HERBALIST_TASK);

function drain(f) {
  for (let i = 0; i < 6; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const answer = (f, option) => send(f, {
  type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option,
});
const plain = (id, count = 1) => new core.Item(id, count);
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
const noted = (id) => core.ItemDefinition.forId(id).getNoteId();
const amount = (f, id) => f.inv.getAmount(id);

function fillTo(f, freeSlots) {
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(plain(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

async function npcOption(t, f, id, option) {
  const npc = core.NPC.create(id, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const clickType = npc.getDefinition().getActions().findIndex((action) => action === option) + 1;
  assert.ok(clickType > 0, `NPC ${id} offers ${option}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType });
  drain(f);
}

// These scenes place the same actor beside indexed NPC spawns; they do not claim
// to exercise travel between scenes. Every quest and service interaction is a packet.
// Large token stocks and a coherent capped Prayer baseline are declared consumer
// starting states, not acquired in this run or evidence of a real saved history.
const ectoNorm = (text) => String(text).replace(/\s+/g, " ").trim();
function ectoTurn(f) {
  const p = f.p;
  p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
  core.TaskManager.process(); f.c.processTurnPackets();
  const queue = p.getMovementQueue(); queue.beginCycle(); queue.processEntityPursuit();
  if (queue.hasPendingWork()) queue.process();
  core.TaskManager.processWalkTo(p.getIndex());
}
async function ectoSend(f, packet) {
  await f.c.dispatch([packet]);
  for (let i = 0; i < 6; i++) ectoTurn(f);
}
async function ectoScene(t, f, id, name, x, y) {
  const spawns = require("../data/definitions/npc-spawns.json");
  assert.ok(spawns.some(s => s.id === id && s.name === name && s.x === x && s.y === y && (s.level ?? 0) === 0));
  core.RegionManager.loadMapFiles(x, y);
  const adjacent = [[0,-1], [0,1], [-1,0], [1,0]].map(([dx,dy]) => new core.Location(x+dx,y+dy,0))
    .find(loc => !core.RegionManager.blocked(loc, null));
  assert.ok(adjacent, `walkable approach at indexed ${name} spawn`);
  f.p.setLocation(adjacent);
  const npc = core.NPC.create(id, new core.Location(x,y,0));
  assert.equal(core.World.getNpcs().add(npc), true);
  t.after(() => core.World.getNpcs().remove(npc));
  const definition = npc.getCurrentDefinition(f.p);
  assert.equal(definition.getName(), name);
  const clickType = definition.getActions().indexOf("Talk-to") + 1;
  assert.ok(clickType > 0);
  await ectoSend(f, {type:"npc_option", index:npc.getIndex(), clickType});
  return npc;
}

function ectoLine(f) {
  const manager = f.p.getDialogueManager(), sender = f.p.getPacketSender();
  const current = manager.getCurrent(), group = sender.getChatboxGroupId();
  assert.equal(manager.getOwner(), undefined);
  assert.equal(sender.getChatboxOwner(), undefined);
  const expected = new Map([[217,core.PlayerDialogue], [231,core.NpcDialogue],
    [229,core.StatementDialogue], [193,core.ItemStatementDialogue]]).get(group);
  assert.ok(expected && current instanceof expected, `native dialogue class/group ${group}`);
  const mount = sender.subInterfaceTargets.get(group);
  assert.ok(mount); assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
  return {current, group, text:ectoNorm(current.getText())};
}

async function ectoAdvance(f, npcId, choices, allowedLines, complete) {
  for (let step = 0; step < 40; step++) {
    if (complete()) return;
    const menu = pending(f);
    if (menu) {
      const wanted = choices.find(value => menu.options.includes(value));
      assert.ok(wanted, `unexpected native menu: ${JSON.stringify(menu.options)}`);
      if (wanted === "Yes") assert.equal(menu.title, "Start The Restless Ghost quest?");
      const mount = f.p.getPacketSender().subInterfaceTargets.get(219);
      assert.ok(mount); assert.equal(f.p.getPacketSender().getSubInterfaceAt(mount.targetUid), mount);
      assert.equal(f.p.getDialogueManager().getOwner(), undefined);
      assert.equal(f.p.getPacketSender().getChatboxOwner(), undefined);
      await ectoSend(f, {type:"dialogue_continue", widgetId:core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
        childIndex:menu.options.indexOf(wanted) + 1});
    } else {
      const {current, group, text} = ectoLine(f);
      if (group === 231) assert.equal(current.getNpcId(), npcId);
      assert.ok(allowedLines.includes(text), `unexpected native dialogue ${group}: ${text}`);
      assert.notEqual(group, 193, "the gifted amulet is the setup endpoint");
      await ectoSend(f, {type:"dialogue_continue", widgetId:(group << 16) | (group === 229 ? 4 : 5), childIndex:-1});
    }
  }
  assert.fail("native quest prerequisite did not reach its bounded endpoint");
}

async function ectoAcquireAmulet(t, f) {
  const p = f.p, quest = QuestRuntime.getRegisteredQuests().find(q => q.key === "the_restless_ghost");
  assert.ok(quest); assert.equal(quest.getStage(p), 0);
  assert.equal(f.inv.getAmount(I.GHOSTSPEAK_AMULET), 0);
  assert.notEqual(p.getEquipment().get(core.Equipment.AMULET_SLOT)?.getId(), I.GHOSTSPEAK_AMULET);
  await ectoScene(t, f, core.NpcIdentifiers.FATHER_AERECK, "Father Aereck", 3244, 3206);
  await ectoAdvance(f, core.NpcIdentifiers.FATHER_AERECK, ["I'm looking for a quest!", "Yes"], [
    "Welcome to the church of holy Saradomin.", "I'm looking for a quest.",
    "That's lucky, I need someone to do a quest for me.",
    "Before starting this quest, be aware that your combat level is lower than the recommended level of 10."
  ], () => quest.getStage(p) === 1);
  assert.equal(quest.getStage(p), 1);
  await ectoSend(f, {type:"interface_close"});
  await ectoScene(t, f, core.NpcIdentifiers.FATHER_URHNEY, "Father Urhney", 3146, 3174);
  await ectoAdvance(f, core.NpcIdentifiers.FATHER_URHNEY, ["Father Aereck sent me to talk to you.", "He's got a ghost haunting his graveyard."], [
    "Go away! I'm meditating!", "Father Aereck sent me to talk to you.",
    "I suppose I'd better talk to you then. What problems has he got himself into this time?",
    "He's got a ghost haunting his graveyard.", "Oh, the silly fool.",
    "I leave town for just five months, and ALREADY he can't manage.", "(sigh)",
    "Well, I can't go back and exorcise it. I vowed not to leave this place. Until I had done a full two years of prayer and meditation.",
    "Tell you what I can do though; take this amulet."
  ], () => quest.getStage(p) === 2);
  assert.equal(quest.getStage(p), 2); assert.equal(f.inv.getAmount(I.GHOSTSPEAK_AMULET), 1);
  const gift = ectoLine(f); assert.equal(gift.group, 193); assert.equal(gift.current.getItemId(), I.GHOSTSPEAK_AMULET);
  assert.equal(gift.text, "Father Urhney hands you an amulet.");
  await ectoSend(f, {type:"interface_close"});
  assert.equal(quest.getStage(p), 2);
  return quest;
}

test("Ectofuntus earned tokens stay owned or pending at stack capacity", async t => {
  const token = 4278, amulet = 552, slime = 4286, bucket = 1925, pot = 1931;
  const meal = core.CacheDefinitions.getObjId("pot_bonemeal");
  assert.equal(I.ECTO_TOKEN, token); assert.equal(I.GHOSTSPEAK_AMULET, amulet);
  assert.equal(I.BUCKET_OF_SLIME, slime); assert.equal(I.BUCKET, bucket); assert.equal(I.POT, pot);
  assert.ok(Number.isInteger(meal) && meal > 0);
  assert.equal(core.WorldDefinition.isMembersWorld(), true, "the real configured members world");
  for (const [id, name] of [[token,/ecto.token/i], [amulet,/ghostspeak amulet/i], [slime,/bucket of slime/i], [meal,/bonemeal/i]]) {
    const definition = core.ItemDefinition.forId(id);
    assert.match(definition.getName(), name); assert.equal(definition.isNoted(), false);
  }
  assert.equal(core.ItemDefinition.forId(token).isStackable(), true);
  assert.equal(Ecto.worshipFor(meal).xp, 18);
  const cases = [
    {name:"ordinary room and repeat", stock:0, capacity:5, expected:5, control:true, repeat:true},
    {name:"seven token headroom", stock:MAX_STACK_AMOUNT-7, capacity:5, expected:5, control:true},
    {name:"full inventory without a token stack", stock:0, capacity:0, expected:0, control:true, full:true},
    {name:"unworn amulet", stock:0, capacity:5, expected:0, control:true, noAmulet:true},
    {name:"two token headroom", stock:MAX_STACK_AMOUNT-2, capacity:2},
  ];
  let controlsPassed = 0;
  for (const scenario of cases) await t.test(scenario.name, async child => {
    if (!scenario.control) assert.equal(controlsPassed, 4, "all native controls must pass before a target");
    const f = actor(child, {desertDiary:false}), p = f.p, inv = f.inv;
    assert.ok(p.isRegistered() && p.getHitpoints() > 0); assert.equal(p.getPrivateArea(), null);
    child.after(() => {
      p.closeInterruptibleInterfaces(); PM.emitPlayerDisconnect({player:p, username:p.getUsername()});
      core.TaskManager.cancelTasks(p);
      for (const item of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) core.ItemOnGroundManager.deregister(item);
    });
    const stores = id => ({inventory:inv.getAmount(id), equipment:p.getEquipment().getAmount(id),
      bank:p.getBanks().reduce((n,b,tab) => n + (b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0),
      floor:core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername() &&
        g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === id).reduce((n,g) => n + g.getItem().getAmount(), 0)});
    const owned = id => Object.values(stores(id)).reduce((n,count) => n+count, 0);
    const xp = () => core.Skill.values().map(skill => p.getSkillManager().getExperience(skill));
    const pendingTokens = () => Ecto.tokens(p);
    const startXp = xp(); assert.equal(pendingTokens(), 0); assert.equal(owned(token), 0);
    const quest = await ectoAcquireAmulet(child, f);
    assert.deepEqual(xp(), startXp, "the first gift does not complete the quest or award XP");
    assert.equal(quest.getStage(p), 2);
    if (scenario.stock) {
      // An explicitly declared normal capped-XP state for the preowned stock.
      // This does not claim that its historical worships were executed here.
      assert.equal(scenario.stock % 5, 0); assert.equal(core.SkillManager.MAX_EXPERIENCE, 1000000000);
      const s = p.getSkillManager();
      s.setExperiences(core.Skill.PRAYER, core.SkillManager.MAX_EXPERIENCE, false);
      s.setMaxLevels(core.Skill.PRAYER, 99, false); s.setCurrentLevel(core.Skill.PRAYER, 99, true);
      assert.equal(s.getExperience(core.Skill.PRAYER), core.SkillManager.MAX_EXPERIENCE);
      assert.equal(s.getCurrentLevel(core.Skill.PRAYER), 99); assert.equal(s.getMaxLevel(core.Skill.PRAYER), 99);
      const expected = startXp.slice(); expected[core.Skill.PRAYER.getIndex()] = core.SkillManager.MAX_EXPERIENCE;
      assert.deepEqual(xp(), expected, "the declared Prayer baseline changes no other skill XP");
    }
    assert.notEqual(p.getAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE), true, "no XP-lock bypass");
    const amuletSlot = inv.getSlotForItemId(amulet);
    assert.ok(amuletSlot >= 0); assert.equal(inv.getItems()[amuletSlot].getMeta(), null);
    assert.ok(core.CacheDefinitions.getItem(amulet).inventoryActions.some(a => a?.toLowerCase() === "wear"));
    assert.notEqual(PM.emitCanUseItem(p, amulet, "use"), false);
    if (!scenario.noAmulet) {
      await ectoSend(f, {type:"inventory_action", widgetId:3214, slot:amuletSlot, itemId:amulet, option:"Wear"});
      assert.equal(p.getEquipment().get(core.Equipment.AMULET_SLOT)?.getId(), amulet);
      assert.equal(inv.getAmount(amulet), 0);
    } else assert.notEqual(p.getEquipment().get(core.Equipment.AMULET_SLOT)?.getId(), amulet);
    for (const id of [meal, slime]) {
      assert.notEqual(PM.emitCanUseItem(p,id,"use"), false);
      inv.add(plain(id), false);
      const slot = inv.getSlotForItemId(id); assert.ok(slot >= 0); assert.equal(inv.getItems()[slot].getMeta(), null);
    }
    if (scenario.stock) {
      inv.add(plain(token, scenario.stock), false);
      assert.equal(inv.getAmount(token), scenario.stock);
      assert.equal(inv.getItems()[inv.getSlotForItemId(token)].getMeta(), null);
    }
    if (scenario.full) fillTo(f, 0);
    const beforeWorship = {meal:owned(meal), slime:owned(slime), pot:owned(pot), bucket:owned(bucket), xp:xp(),
      prayer:p.getSkillManager().getExperience(core.Skill.PRAYER)};
    assert.equal(beforeWorship.meal, 1); assert.equal(beforeWorship.slime, 1);
    const worn = new Set(p.getEquipment().getItems().map(item => item?.getId()));
    for (const name of ["shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots"])
      assert.equal(worn.has(core.CacheDefinitions.getObjId(name)), false, "no Zealot save roll");
    assert.equal(pendingTokens(), 0);
    core.RegionManager.loadMapFiles(3658,3518);
    const spot = new core.Location(3658,3517,0), loc = new core.Location(3658,3518,0);
    assert.equal(core.RegionManager.blocked(spot, null), false); p.setLocation(spot);
    const object = core.MapObjects.get(16648, loc, null);
    assert.ok(object, "actual indexed Ectofuntus object");
    assert.equal(object.isMapOriginal(), true); assert.equal(object.getPrivateArea(), null);
    assert.equal(object.getDefinition().getName(), "Ectofuntus");
    assert.ok(object.getDefinition().getInteractions().includes("Worship"));
    const gains = [], skills = p.getSkillManager(), addExperience = skills.addExperiences.bind(skills);
    child.mock.method(skills, "addExperiences", (skill, value) => { gains.push({skill,value}); return addExperience(skill,value); });
    const xpGates = [], gate = PM.emitCanGainExperience.bind(PM);
    child.mock.method(PM, "emitCanGainExperience", (who, skill, value) => {
      const result = gate(who, skill, value); xpGates.push({who,skill,value,result}); return result;
    });
    const observed = [], emit = PM.emitObjectInteraction.bind(PM);
    child.mock.method(PM, "emitObjectInteraction", event => { observed.push({player:event.player, objectId:event.objectId, option:event.option}); return emit(event); });
    await ectoSend(f, {type:"object_option", id:16648, x:3658, y:3518, action:"Worship"});
    assert.ok(observed.some(e => e.player === p && e.objectId === 16648 && e.option === "worship"));
    assert.equal(pendingTokens(), 5, "genuine worship earned the pending entitlement");
    assert.equal(owned(meal), beforeWorship.meal-1); assert.equal(owned(slime), beforeWorship.slime-1);
    assert.equal(owned(pot), beforeWorship.pot+1); assert.equal(owned(bucket), beforeWorship.bucket+1);
    assert.ok(gains.some(g => g.skill === core.Skill.PRAYER && g.value === 18), "real bonemeal XP call");
    assert.ok(xpGates.some(g => g.who === p && g.skill === core.Skill.PRAYER && g.value === 18 && g.result.allow !== false), "the real XP gate does not veto worship");
    const prayer = p.getSkillManager().getExperience(core.Skill.PRAYER);
    if (scenario.stock) assert.equal(prayer, beforeWorship.prayer, "ordinary capped stored XP remains capped");
    else assert.ok(prayer > beforeWorship.prayer, "genuine Prayer XP in the fresh control");
    assert.equal(quest.getStage(p), 2);
    for (let n = 0; n < 4 && p.getPacketSender().isChatboxInterface(233); n++) {
      const mount = p.getPacketSender().subInterfaceTargets.get(233);
      assert.ok(mount); assert.equal(p.getPacketSender().getSubInterfaceAt(mount.targetUid), mount);
      await ectoSend(f, {type:"dialogue_continue", widgetId:(233 << 16) | 3, childIndex:-1});
    }
    assert.equal(p.getPacketSender().isChatboxInterface(233), false, "native level-up prompts resolved");
    const beforeClaim = {owned:owned(token), pending:pendingTokens(), xp:xp(), meal:owned(meal), slime:owned(slime), pot:owned(pot), bucket:owned(bucket)};
    assert.equal(beforeClaim.pending, 5, "the actual worship credit is still pending immediately before Talk-to");
    assert.equal(inv.getAddableAmount(plain(token, 5)), scenario.capacity, "actual current token headroom");
    if (scenario.full) { assert.equal(inv.getFreeSlots(), 0); assert.equal(inv.getAmount(token), 0); }
    const disciple = await ectoScene(child, f, 2988, "Ghost disciple", 3655, 3516);
    const first = ectoLine(f);
    if (scenario.noAmulet) {
      assert.equal(first.group, 231); assert.equal(first.current.getNpcId(), 2988);
      assert.equal(first.text, "Woooo wooo wooooo woooo");
    } else {
      assert.equal(first.group, 217); assert.equal(first.text, "Can I have the tokens I have earned?");
      await ectoSend(f, {type:"dialogue_continue", widgetId:(217 << 16) | 5, childIndex:-1});
      const reply = ectoLine(f); assert.equal(reply.group, 231); assert.equal(reply.current.getNpcId(), 2988);
      const claim = "Certainly, mortal. Here's 5 ectotokens.";
      const noRoom = "I have 5 ectotokens waiting for you mortal, but you do not have room in your inventory for them.";
      if (scenario.full) assert.equal(reply.text, noRoom);
      else if (scenario.control) assert.equal(reply.text, claim);
      else assert.ok([claim,noRoom].includes(reply.text), "native claim or genuine refusal line");
    }
    const afterClaim = {owned:owned(token), pending:pendingTokens(), xp:xp(), meal:owned(meal), slime:owned(slime), pot:owned(pot), bucket:owned(bucket)};
    assert.equal(afterClaim.owned - beforeClaim.owned + afterClaim.pending, 5,
      `earned tokens must be delivered or remain pending: ${JSON.stringify({beforeClaim, afterClaim, stores:stores(token)})}`);
    if (scenario.control) {
      assert.equal(afterClaim.owned - beforeClaim.owned, scenario.expected);
      assert.equal(afterClaim.pending, 5-scenario.expected);
    }
    assert.deepEqual(afterClaim.xp, beforeClaim.xp); assert.equal(afterClaim.meal, beforeClaim.meal);
    assert.equal(afterClaim.slime, beforeClaim.slime); assert.equal(afterClaim.pot, beforeClaim.pot); assert.equal(afterClaim.bucket, beforeClaim.bucket);
    assert.equal(quest.getStage(p), 2);
    if (scenario.repeat) {
      await ectoSend(f, {type:"dialogue_continue", widgetId:(231 << 16) | 5, childIndex:-1});
      const clickType = disciple.getCurrentDefinition(p).getActions().indexOf("Talk-to") + 1;
      assert.ok(clickType > 0);
      await ectoSend(f, {type:"npc_option", index:disciple.getIndex(), clickType});
      assert.notEqual(ectoLine(f).text, "Can I have the tokens I have earned?");
      assert.equal(owned(token), afterClaim.owned); assert.equal(pendingTokens(), 0);
    }
    if (scenario.control) controlsPassed++;
  });
});

// ------------------------------------------------------------------ Zahur: Clean

const grimyNote = () => noted(I.GRIMY_GUAM_LEAF);
const cleanNote = () => noted(I.GUAM_LEAF);

async function clean(t, f, { herbs, coins, free = null, held = 0 }) {
  f.inv.setItem(0, plain(grimyNote(), herbs));
  f.inv.setItem(1, plain(I.COINS, coins));
  if (held) f.inv.setItem(2, plain(cleanNote(), held));
  if (free !== null) fillTo(f, free);
  await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Clean");
  assert.ok(pending(f), "Zahur asks first");
  await answer(f, YES);
}

test("Zahur Clean: with no room for the clean herbs, nothing is taken", async (t) => {
  const control = actor(t);
  await clean(t, control, { herbs: 100, coins: COST * 10 + 100, free: 1 });
  assert.equal(amount(control, cleanNote()), 10, "control: ten cleaned");
  assert.equal(amount(control, grimyNote()), 90, "control: ten taken");
  assert.equal(amount(control, I.COINS), 100, "control: paid");
  assert.equal(creditedForCleaning(control), true, "control: the diary task is credited");

  const f = actor(t);
  await clean(t, f, { herbs: 100, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(f, grimyNote()), 100, "the herbs stay");
  assert.equal(amount(f, I.COINS), COST * 10 + 100, "the coins stay");
  assert.equal(amount(f, cleanNote()), 0, "nothing is made");
  assert.ok(f.messages.includes(NO_SPACE), "and the player is told");
  assert.equal(creditedForCleaning(f), false, "a refused clean credits no diary task");
});

test("Zahur Clean: a stack used up in full frees its slot for the clean herbs", async (t) => {
  const herbs = actor(t);
  await clean(t, herbs, { herbs: 10, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(herbs, cleanNote()), 10, "the herb stack's slot takes them");
  assert.equal(amount(herbs, I.COINS), 100);

  const coins = actor(t);
  await clean(t, coins, { herbs: 100, coins: COST * 10, free: 0 });
  assert.equal(amount(coins, cleanNote()), 10, "the coin stack's slot takes them");
  assert.equal(amount(coins, grimyNote()), 90);
});

test("Zahur Clean: a stack near the cap is charged only for what it holds", async (t) => {
  const control = actor(t);
  await clean(t, control, { herbs: 10, coins: COST * 10, held: 5 });
  assert.equal(amount(control, cleanNote()), 15, "control: all ten");

  const near = MAX_STACK_AMOUNT - 5;
  const f = actor(t);
  await clean(t, f, { herbs: 10, coins: COST * 10, held: near });
  assert.equal(amount(f, cleanNote()), MAX_STACK_AMOUNT, "the stack fills");
  assert.equal(amount(f, grimyNote()), 5, "the rest stay grimy");
  assert.equal(amount(f, I.COINS), COST * 5, "and aren't paid for");
});

test("Zahur Clean: unnoted herbs on a full inventory still clean", async (t) => {
  const f = actor(t);
  for (let slot = 0; slot < 3; slot++) f.inv.setItem(slot, plain(I.GRIMY_GUAM_LEAF));
  f.inv.setItem(3, plain(I.COINS, COST * 10));
  fillTo(f, 0);
  await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Clean");
  await answer(f, YES);
  assert.equal(amount(f, I.GUAM_LEAF), 3);
  assert.equal(amount(f, I.COINS), COST * 7);
});

// ------------------------------------------------------------------ Zahur: Make unfinished

const unfNote = () => noted(I.GUAM_POTION_UNF_);

async function unfinished(t, f, { herbs, vials, coins, free = null, held = 0 }) {
  f.inv.setItem(0, plain(noted(I.GUAM_LEAF), herbs));
  f.inv.setItem(1, plain(noted(I.VIAL_OF_WATER), vials));
  f.inv.setItem(2, plain(I.COINS, coins));
  if (held) f.inv.setItem(3, plain(unfNote(), held));
  if (free !== null) fillTo(f, free);
  await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Make unfinished potion(s)");
}

// rsprox_transcripts/232/03159.txt (a normal world): Zahur's own refusals as dialogue, by what is missing (no herbs
// 16028, no vials 12090, no coins 15340), and no line at all when she makes them (15767).
test("Zahur Make unfinished: her recorded refusals, and nothing said when she makes them", async (t) => {
  const cases = [
    [[[noted(I.VIAL_OF_WATER), 5], [I.COINS, COST * 5]], "You don't have anything for me to combine."],
    [[[noted(I.GUAM_LEAF), 5], [I.COINS, COST * 5]], "You need to bring along a base for me to make unfinished potions with."],
    [[[noted(I.GUAM_LEAF), 5], [noted(I.VIAL_OF_WATER), 5]], `I don't offer this service for free or at a discount. You'll need at least ${COST} coins.`],
  ];
  for (const [items, line] of cases) {
    const f = actor(t);
    const said = [];
    const sender = f.p.getPacketSender(), sendString = sender.sendString.bind(sender);
    t.mock.method(sender, "sendString", (text, ...rest) => { said.push(String(text)); return sendString(text, ...rest); });
    items.forEach(([id, n], slot) => f.inv.setItem(slot, plain(id, n)));
    await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Make unfinished potion(s)");
    assert.ok(said.some((text) => text.includes(line)), `${line} | ${said.join(" / ")}`);
    assert.deepEqual(f.messages, [], "dialogue, not a chat line");
  }
  const made = actor(t);
  await unfinished(t, made, { herbs: 4, vials: 4, coins: COST * 4 });
  assert.equal(amount(made, unfNote()), 4);
  assert.deepEqual(made.messages, [], "no line when they are made");
});

test("Zahur Make unfinished: with no room, nothing is taken", async (t) => {
  const control = actor(t);
  await unfinished(t, control, { herbs: 100, vials: 100, coins: COST * 10 + 100, free: 1 });
  assert.equal(amount(control, unfNote()), 10, "control: ten made");
  assert.equal(amount(control, noted(I.GUAM_LEAF)), 90);
  assert.equal(amount(control, I.COINS), 100);

  const f = actor(t);
  await unfinished(t, f, { herbs: 100, vials: 100, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(f, noted(I.GUAM_LEAF)), 100, "the herbs stay");
  assert.equal(amount(f, noted(I.VIAL_OF_WATER)), 100, "the vials stay");
  assert.equal(amount(f, I.COINS), COST * 10 + 100, "the coins stay");
  assert.ok(f.messages.includes(NO_SPACE), "and the player is told");
});

test("Zahur Make unfinished: a stack used up frees its slot, and a near-cap stack is charged for what it holds", async (t) => {
  const freed = actor(t);
  await unfinished(t, freed, { herbs: 100, vials: 10, coins: COST * 10 + 100, free: 0 });
  assert.equal(amount(freed, unfNote()), 10, "the vial stack's slot takes them");
  assert.equal(amount(freed, noted(I.GUAM_LEAF)), 90);

  const near = MAX_STACK_AMOUNT - 5;
  const f = actor(t);
  await unfinished(t, f, { herbs: 10, vials: 10, coins: COST * 10, held: near });
  assert.equal(amount(f, unfNote()), MAX_STACK_AMOUNT, "the stack fills");
  assert.equal(amount(f, noted(I.GUAM_LEAF)), 5, "the rest stay");
  assert.equal(amount(f, noted(I.VIAL_OF_WATER)), 5);
  assert.equal(amount(f, I.COINS), COST * 5, "and aren't paid for");
});

// Wiki (Zahur): "vials of water or vials of blood" (5 July 2018: "accept, and create potions using, Vials of blood").
test("Zahur Make unfinished: vials of blood make Cadantine blood potions, beside vials of water", async (t) => {
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  const f = actor(t);
  f.inv.setItem(0, plain(noted(obj("cadantine")), 3));
  f.inv.setItem(1, plain(noted(I.VIAL_OF_WATER), 1));
  f.inv.setItem(2, plain(noted(obj("vial_blood")), 2));
  f.inv.setItem(3, plain(I.COINS, COST * 3));
  await npcOption(t, f, core.NpcIdentifiers.ZAHUR, "Make unfinished potion(s)");
  assert.equal(amount(f, noted(obj("cadantinevial"))), 1, "one with the vial of water");
  assert.equal(amount(f, noted(obj("cadantine_bloodvial"))), 2, "two with the vials of blood");
  assert.equal(amount(f, noted(obj("cadantine"))), 0);
  assert.equal(amount(f, I.COINS), 0, "200 coins each");

  const blood = actor(t);
  blood.inv.setItem(0, plain(noted(obj("cadantine")), 2));
  blood.inv.setItem(1, plain(noted(obj("vial_blood")), 2));
  blood.inv.setItem(2, plain(I.COINS, COST * 2));
  await npcOption(t, blood, core.NpcIdentifiers.ZAHUR, "Make unfinished potion(s)");
  assert.equal(amount(blood, noted(obj("cadantine_bloodvial"))), 2, "blood alone is a base");
});

// ------------------------------------------------------------------ Mawnis

async function buyHelm(t, f, coins, { free = null, questDone = true, reachesAccept = true } = {}) {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_fremennik_isles");
  assert.ok(quest, "The Fremennik Isles is registered");
  if (questDone) quest.setStage(f.p, quest.completionValue ?? 2);
  f.inv.setItem(0, plain(I.COINS, coins));
  if (free !== null) fillTo(f, free);
  await npcOption(t, f, core.NpcIdentifiers.MAWNIS_BUROWGAR, "Talk-to");
  const seen = [];
  for (let i = 0; i < 30; i++) {
    const prompt = pending(f);
    if (prompt) {
      seen.push(prompt.options.join("/"));
      const index = prompt.options.findIndex((option) => /any more of those helms|accept/i.test(option));
      await answer(f, index >= 0 ? index + 1 : 1);
    } else if (f.p.getDialogueManager().isActive()) {
      const group = f.p.getPacketSender().chatboxGroupId;
      await send(f, { type: "dialogue_continue", widgetId: group << 16, childIndex: -1 });
    } else {
      break;
    }
    drain(f);
  }
  assert.equal(seen.some((menu) => /accept/i.test(menu)), reachesAccept, `the purchase menu: ${seen.join(" | ")}`);
}

function assertRefused(f, coins, message) {
  assert.equal(amount(f, I.HELM_OF_NEITIZNOT), 0, "no helm");
  assert.equal(amount(f, I.COINS), coins, "the coins stay");
  assert.ok(f.messages.includes(message), `the player is told: ${f.messages}`);
  assert.ok(!f.messages.includes(HANDS_OVER), "and the transcript doesn't say he handed it over");
  assert.equal(pending(f), null, "no question is left open");
  assert.equal(f.p.getDialogueManager().isActive(), false, "and the conversation has ended");
}

test("Mawnis: with room he sells the helm; with none it stays with him and so do the coins", async (t) => {
  const control = actor(t);
  await buyHelm(t, control, HELM_PRICE + 10000);
  assert.equal(amount(control, I.HELM_OF_NEITIZNOT), 1, "control: the helm");
  assert.equal(amount(control, I.COINS), 10000, "control: for 50,000");
  assert.ok(control.messages.includes(HANDS_OVER), "control: the transcript says so");

  const full = actor(t);
  await buyHelm(t, full, HELM_PRICE + 10000, { free: 0 });
  assertRefused(full, HELM_PRICE + 10000, NO_SPACE);
});

test("Mawnis: exactly the price frees the coins' slot on a full inventory", async (t) => {
  const f = actor(t);
  await buyHelm(t, f, HELM_PRICE, { free: 0 });
  assert.equal(amount(f, I.HELM_OF_NEITIZNOT), 1, "the coin stack's slot takes the helm");
  assert.equal(amount(f, I.COINS), 0);
});

// Live offers no menu with too few coins (RSProx 3027), and nor does the post-quest transcript. Before the
// quest reaches him, Talk-to falls through to his standard dialogue, which has no such condition.
test("Mawnis: too few coins is no sale, and the transcript doesn't say he handed it over", async (t) => {
  const control = actor(t);
  await buyHelm(t, control, HELM_PRICE - 1, { reachesAccept: false });
  assert.equal(amount(control, I.COINS), HELM_PRICE - 1, "control: after the quest he never offers it");
  assert.ok(!control.messages.includes(HANDS_OVER), "control: and says nothing of handing it over");

  const f = actor(t);
  await buyHelm(t, f, HELM_PRICE - 1, { questDone: false });
  assertRefused(f, HELM_PRICE - 1, NO_COINS);
});


test('deferred Thormac enchanting preserves a newer native main shop', async t => {
  const {ShopDefinitionLoader} = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
  assert.equal(new ShopDefinitionLoader().load(), true); core.ShopManager.initialize();
  const quest = QuestRuntime.getRegisteredQuests().find(q => q.key === 'scorpion_catcher'); assert.ok(quest);
  const ENCHANT = core.CacheDefinitions.getInterfaceId('thormac'); assert.equal(ENCHANT, 332);
  const terminalText = "Yes, it'll cost you [20,000 / 30,000 / 40,000] coins for the materials needed though. Which sort of staff did you want enchanting?";
  for (const mode of ['stationary enchant and close', 'direct shop', 'logout before deferred open', 'newer shop']) await t.test(mode, async child => {
    const f = actor(child), p = f.p, inv = f.inv;
    quest.setStage(p, quest.completionValue); assert.equal(quest.isComplete(p), true);
    assert.equal(p.getPacketSender().getVarp(76), 6, 'canonical saved completed quest, not natural quest completion here');
    PM.emitPlayerLogin({player:p, username:p.getUsername()}); p.closeInterruptibleInterfaces();
    const kandarin = {player:p, diary:'kandarin', tier:'hard', complete:null}; PM.emitCustomEvent('diary:is-complete', kandarin);
    assert.equal(kandarin.complete, false, 'ordinary fee control has no Kandarin discount');
    inv.add(plain(I.COINS, 80000), false); inv.add(plain(I.AIR_BATTLESTAFF), false); inv.add(plain(I.AIR_BATTLESTAFF), false);
    const npc = core.NPC.create(core.NpcIdentifiers.THORMAC, new core.Location(HOME[0] + 1, HOME[1], 0));
    const shopNpc = core.NPC.create(core.NpcIdentifiers.LOWE, new core.Location(HOME[0], HOME[1] + 1, 0));
    for (const n of [npc, shopNpc]) assert.equal(core.World.getNpcs().add(n), true);
    assert.equal(npc.getCurrentDefinition(p).getName(), 'Thormac'); assert.equal(shopNpc.getCurrentDefinition(p).getName(), 'Lowe');
    child.after(() => {
      p.closeInterruptibleInterfaces(); PM.emitPlayerDisconnect({player:p, username:p.getUsername()});
      core.TaskManager.cancelTasks(p); for (const n of [npc, shopNpc]) core.World.getNpcs().remove(n);
      for (const g of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) core.ItemOnGroundManager.deregister(g);
    });
    const stores = id => ({inventory:inv.getAmount(id), equipment:p.getEquipment().getAmount(id),
      bank:p.getBanks().reduce((n,b,tab) => n + (b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0),
      floor:core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername()
        && g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === id).reduce((n,g) => n + g.getItem().getAmount(), 0)});
    const owned = id => Object.values(stores(id)).reduce((n,a) => n + a, 0);
    const resources = () => ({coins:stores(I.COINS), staff:stores(I.AIR_BATTLESTAFF), mystic:stores(I.MYSTIC_AIR_STAFF),
      experience:core.Skill.values().map(skill => p.getSkillManager().getExperience(skill))});
    const initial = resources(), sender = p.getPacketSender(), manager = p.getDialogueManager();
    const unchanged = () => assert.deepEqual(resources(), initial, 'opening/replacing services takes no fee, item or XP');
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 28, 'bounded native task/input/movement phase budget'); p.resetUpdating();
      core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff; core.TaskManager.process();
      f.c.processTurnPackets(); const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
      if (q.hasPendingWork()) q.process(); core.TaskManager.processWalkTo(p.getIndex());
    };
    const input = async (...packets) => { await f.c.dispatch(packets); turn(); };
    const op = (n, label) => { const clickType = n.getCurrentDefinition(p).getActions().indexOf(label) + 1;
      assert.ok(clickType > 0, label); return {type:'npc_option', index:n.getIndex(), clickType}; };
    const line = () => {
      const current = manager.getCurrent(), group = sender.getChatboxGroupId();
      assert.ok(current instanceof core.NpcDialogue || current instanceof core.PlayerDialogue);
      assert.ok(group === 231 || group === 217); const mount = sender.subInterfaceTargets.get(group);
      assert.ok(mount); assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
      assert.equal(manager.getOwner(), undefined); return {current, group};
    };
    const resume = () => ({type:'dialogue_continue', widgetId:(line().group << 16) | 5, childIndex:-1});
    const shopMount = () => {
      assert.equal(p.getInterfaceId(), 300); assert.equal(core.ShopManager.getOpenShop(p)?.name, "Lowe's Archery Emporium");
      const mount = sender.subInterfaceTargets.get(300); assert.ok(mount);
      assert.equal(sender.getSubInterfaceAt((161 << 16) | 16), mount); return mount;
    };
    if (mode === 'direct shop') { await input(op(shopNpc, 'Trade')); const mount = shopMount(); unchanged(); turn();
      assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount); unchanged(); return; }
    await input(op(npc, 'Talk-to'));
    for (let n = 0; n < 5 && !core.MultiChatboxPrompt.getPending(p); n++) await input(resume());
    const prompt = core.MultiChatboxPrompt.getPending(p); assert.ok(prompt); assert.equal(manager.isActive(), false);
    const choice = prompt.options.indexOf("You said you'd enchant my battlestaff for me.") + 1; assert.ok(choice > 0);
    await input({type:'dialogue_continue', widgetId:core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex:choice});
    for (let n = 0; n < 4 && !/Which sort of staff did you want enchanting\?/.test((manager.getCurrent()?.getText?.() ?? '').replace(/\s+/g, ' ').trim()); n++) await input(resume());
    const terminal = line(); assert.ok(terminal.current instanceof core.NpcDialogue); assert.equal(terminal.group, 231);
    assert.equal(terminal.current.getText().replace(/\s+/g, ' ').trim(), terminalText);
    assert.equal(p.getInterfaceId(), -1); assert.equal(sender.isSubInterfaceOpen(ENCHANT), false); unchanged();
    const queued = [], submit = core.TaskManager.submit.bind(core.TaskManager);
    child.mock.method(core.TaskManager, 'submit', task => {
      if (task.constructor === core.CountdownTask && task.key === p && task.getDelay() === 1) queued.push(task);
      return submit(task);
    });
    // The real input queue drains both actions before the next global task phase.
    await input(resume(), ...(mode === 'newer shop' ? [op(shopNpc, 'Trade')] : []));
    assert.equal(queued.length, 1, 'yTpo85 produces one real player-object CountdownTask');
    assert.equal(queued[0].key, p); assert.equal(queued[0].isImmediate(), false); assert.equal(queued[0].isRunning(), true);
    assert.equal(sender.isSubInterfaceOpen(ENCHANT), false, 'the deferred open has not run'); unchanged();
    if (mode === 'logout before deferred open') {
      // Invoke the real production logout lifecycle, not a fabricated cancelTasks call or false flag.
      // Its caller's full World removal/socket handshake is outside this selected-phase fixture.
      p.onLogout(); assert.equal(queued[0].isStopped(), true, 'canonical logout cancels the exact raw-player-key task');
      turn(); assert.equal(sender.isSubInterfaceOpen(ENCHANT), false); assert.equal(manager.isActive(), false); unchanged(); return;
    }
    if (mode === 'newer shop') {
      const newer = shopMount(); assert.equal(queued[0].isRunning(), true, 'new NPC input did not cancel the raw-player-key request');
      turn(); const details = JSON.stringify({interface:p.getInterfaceId(), enchantMounted:sender.isSubInterfaceOpen(ENCHANT), resources:resources()});
      // First target: an old optional service cannot replace the exact newer main-modal lifetime.
      assert.equal(sender.getSubInterfaceAt(newer.targetUid), newer, 'newer shop mount must survive: ' + details);
      assert.equal(p.getInterfaceId(), 300); assert.equal(sender.isSubInterfaceOpen(ENCHANT), false); unchanged(); return;
    }
    turn(); assert.equal(p.getInterfaceId(), ENCHANT); assert.equal(sender.isSubInterfaceOpen(ENCHANT), true); unchanged();
    const enchant = {type:'widget_action', widgetId:(ENCHANT << 16) | 4, groupId:ENCHANT, childId:4, buttonNum:1, opId:1, slot:-1, itemId:-1};
    await input(enchant); assert.equal(owned(I.COINS), 40000); assert.equal(owned(I.AIR_BATTLESTAFF), 1); assert.equal(owned(I.MYSTIC_AIR_STAFF), 1);
    assert.deepEqual(resources().experience, initial.experience);
    await input({type:'interface_close'}); assert.equal(p.getInterfaceId(), -1); assert.equal(sender.isSubInterfaceOpen(ENCHANT), false);
    const closed = resources(); await input(enchant); assert.deepEqual(resources(), closed, 'only closing332 ends the admitted service; stale clicks cannot bill another staff');
  });
});


// Declared preowned barter inputs; no Wintertodt rewards are earned in this test.
test('Ignisia exchanges a glove for the full fifty owned burnt pages or refuses', async t => {
  const GLOVE = 20712, PAGE = 20718, NPC = 7374, X = 1634, Y = 3948;
  assert.equal(I.WARM_GLOVES, GLOVE); assert.equal(I.BURNT_PAGE, PAGE);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  for (const [id, name, stackable] of [[GLOVE, 'Warm gloves', false], [PAGE, 'Burnt page', true]]) {
    const definition = core.ItemDefinition.forId(id);
    assert.equal(definition.getName(), name); assert.equal(definition.isNoted(), false);
    assert.equal(definition.isStackable(), stackable);
  }
  const spawns = require('../data/definitions/npc-spawns.json');
  assert.ok(spawns.some(n => n.id === NPC && n.name === 'Ignisia' && n.x === X && n.y === Y
    && (n.level ?? 0) === 0 && n.wanderRadius === 0));
  const cases = [
    {name:'fifty headroom', gap:50, control:true},
    {name:'fifty-one headroom', gap:51, control:true},
    {name:'No at the real confirmation', gap:51, control:true, no:true},
    {name:'no glove offers nothing', gap:51, control:true, noGlove:true},
    {name:'full bag frees the glove slot', gap:MAX_STACK_AMOUNT, control:true, fullBag:true},
    {name:'twenty-five headroom', gap:25},
    {name:'full page stack', gap:0},
  ];
  let controlsPassed = 0;
  for (const mode of cases) await t.test(mode.name, async child => {
    if (!mode.control) assert.equal(controlsPassed, 5, 'all native controls qualify before a target');
    const f = actor(child, {desertDiary:false}), p = f.p, inv = f.inv;
    const sender = p.getPacketSender(), manager = p.getDialogueManager();
    let turns = 0;
    const turn = () => {
      assert.ok(++turns <= 96, 'bounded native input/task/movement turns');
      p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process(); f.c.processTurnPackets();
      const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
      if (q.hasPendingWork()) q.process(); core.TaskManager.processWalkTo(p.getIndex());
    };
    const input = async packet => { await f.c.dispatch([packet]); for (let n = 0; n < 6; n++) turn(); };
    const stores = id => ({inventory:inv.getAmount(id), equipment:p.getEquipment().getAmount(id),
      banks:p.getBanks().reduce((sum,b,tab) => sum + (b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0),
      floor:core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername()
        && g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === id)
        .reduce((sum,g) => sum + g.getItem().getAmount(), 0)});
    const total = vector => Object.values(vector).reduce((sum,n) => sum+n, 0);
    const xp = () => core.Skill.values().map(skill => p.getSkillManager().getExperience(skill));
    const current = (Type, group) => {
      const entry = manager.getCurrent(); assert.ok(entry instanceof Type);
      assert.equal(sender.getChatboxGroupId(), group);
      assert.equal(manager.getOwner(), undefined); assert.equal(sender.getChatboxOwner(), undefined);
      const mount = sender.subInterfaceTargets.get(group); assert.ok(mount);
      assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
      return entry;
    };
    const option = (title, options) => {
      assert.equal(core.MultiChatboxPrompt.getPending(p), null, 'this is the native OptionDialogue route');
      const entry = current(core.OptionDialogue, 219);
      assert.equal(entry.getTitle(), title); assert.deepEqual(entry.getOptions(), options);
      return entry;
    };
    const choose = number => input({type:'dialogue_continue', widgetId:core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex:number});
    assert.ok(p.isRegistered() && p.getHitpoints() > 0); assert.equal(p.getPrivateArea(), null);
    assert.equal(total(stores(GLOVE)), 0); assert.equal(total(stores(PAGE)), 0);
    if (!mode.noGlove) inv.add(plain(GLOVE), false);
    if (MAX_STACK_AMOUNT-mode.gap > 0) inv.add(plain(PAGE, MAX_STACK_AMOUNT-mode.gap), false);
    if (mode.fullBag) {
      assert.equal(core.ItemDefinition.forId(229).getName(), 'Vial');
      assert.equal(core.ItemDefinition.forId(229).isStackable(), false);
      for (let n = 0; n < 27; n++) inv.add(plain(229), false);
    }
    inv.refreshItems();
    const initialVials = stores(229);
    assert.equal(inv.getAmount(GLOVE), mode.noGlove ? 0 : 1);
    assert.equal(inv.getAmount(PAGE), MAX_STACK_AMOUNT-mode.gap);
    for (const id of [GLOVE, PAGE]) {
      const slot = inv.getSlotForItemId(id);
      if (slot >= 0) assert.equal(inv.getItems()[slot].getMeta(), null);
    }
    assert.equal(inv.getAddableAmount(plain(PAGE, 50)), mode.fullBag ? 0 : Math.min(mode.gap,50));
    assert.equal(inv.getFreeSlots(), mode.fullBag ? 0 : mode.noGlove ? 27 : 26, 'observed physical capacity before the trade');
    const initial = {glove:stores(GLOVE), pages:stores(PAGE), xp:xp()};
    core.RegionManager.loadMapFiles(X,Y);
    const stand = [[0,-1],[0,1],[-1,0],[1,0]].map(([dx,dy]) => new core.Location(X+dx,Y+dy,0))
      .find(at => !core.RegionManager.blocked(at,null));
    assert.ok(stand, 'a collision-checked adjacent approach at the actual indexed spawn');
    p.setLocation(stand); p.needsPlacement = false;
    const npc = core.NPC.create(NPC, new core.Location(X,Y,0));
    assert.equal(core.World.getNpcs().add(npc), true);
    child.after(() => {
      p.closeInterruptibleInterfaces(); PM.emitPlayerDisconnect({player:p, username:p.getUsername()});
      core.TaskManager.cancelTasks(p); core.World.getNpcs().remove(npc);
      for (const g of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) core.ItemOnGroundManager.deregister(g);
    });
    const definition = npc.getCurrentDefinition(p); assert.equal(definition.getName(), 'Ignisia');
    const clickType = definition.getActions().indexOf('Exchange')+1; assert.ok(clickType > 0, 'actual cache Exchange operation');
    await input({type:'npc_option', index:npc.getIndex(), clickType});
    const greeting = current(core.NpcDialogue,231);
    assert.equal(greeting.getNpcId(), NPC);
    assert.equal(greeting.getText().replace(/\s+/g,' ').trim(), 'Do you have something for me?');
    assert.deepEqual({glove:stores(GLOVE),pages:stores(PAGE),xp:xp()}, initial);
    await input({type:'dialogue_continue', widgetId:(231<<16)|5, childIndex:-1});
    option(undefined, ['Yes, I do.', 'Err... nope. Sorry.']); await choose(1);
    if (mode.noGlove) {
      assert.equal(manager.isActive(), false); assert.equal(core.MultiChatboxPrompt.getPending(p), null);
      assert.deepEqual({glove:stores(GLOVE),pages:stores(PAGE),xp:xp()}, initial);
      controlsPassed++; return;
    }
    option('What would you like to trade for?', ['Extra Crate.', 'Burnt Pages.']); await choose(2);
    option('Trade in 1x Warm gloves for 50x burnt pages?', ['Yes.', 'No.']);
    assert.equal(inv.getAmount(GLOVE), 1, 'the same declared glove is still carried at the actual confirmation');
    assert.equal(inv.getAddableAmount(plain(PAGE,50)), mode.fullBag ? 0 : Math.min(mode.gap,50));
    assert.deepEqual({glove:stores(GLOVE),pages:stores(PAGE),xp:xp()}, initial);
    await choose(mode.no ? 2 : 1);
    const after = {glove:stores(GLOVE),pages:stores(PAGE),xp:xp()};
    const spent = total(initial.glove)-total(after.glove), credited = total(after.pages)-total(initial.pages);
    // First economic target: the fixed invoice is fully delivered across owned stores or refused atomically.
    assert.equal(credited, spent*50, 'fixed fifty-page barter must conserve: '+JSON.stringify({mode:mode.name,initial,after,spent,credited}));
    assert.ok(spent === 0 || spent === 1);
    if (mode.control && !mode.no) { assert.equal(spent,1); assert.equal(credited,50); }
    if (mode.no) assert.deepEqual(after, initial);
    assert.deepEqual(after.xp, initial.xp);
    assert.deepEqual(stores(229), initialVials, 'barter retains all declared filler items');
    if (mode.control) {
      assert.equal(manager.isActive(), false); assert.equal(core.MultiChatboxPrompt.getPending(p), null);
      controlsPassed++;
    }
  });
});


// An older terminal conversation may open its menu next tick, but cannot own a newer completed main.
test('deferred Loinur menu preserves a completed newer native price checker', async t => {
  const { ItemContainer } = require('../dist/game/model/container/ItemContainer');
  const NPC = 7231, X = 1670, Y = 3834, MENU = 187, CHECKER = 464, SIDE = 238;
  const MAIN_TARGET = (161 << 16) | 16, SIDE_TARGET = (161 << 16) | 74;
  const PRICE_BUTTON = (387 << 16) | 3;
  const norm = text => String(text).replace(/\s+/g, ' ').trim();
  const data = require('../plugins/world/data/lovakengj-minecarts.json');
  const spawns = require('../data/definitions/npc-spawns.json');
  assert.ok(spawns.some(n => n.id === NPC && n.name === 'Loinur' && n.x === X && n.y === Y && n.level === 0));
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.equal(core.CacheDefinitions.getNpcId('lovakengj_minecart_arceuus'), NPC);
  assert.equal(core.CacheDefinitions.getInterfaceId('menu'), MENU);
  assert.equal(core.CacheDefinitions.getInterfaceId('ge_pricechecker'), CHECKER);
  assert.equal(core.CacheDefinitions.getInterfaceId('ge_pricechecker_side'), SIDE);
  assert.equal(core.CacheDefinitions.getComponentId('wornitems:pricechecker'), PRICE_BUTTON);
  const cases = ['stationary destination menu', 'direct price checker', 'newer price checker'];
  let controlsPassed = 0;
  for (const mode of cases) await t.test(mode, async child => {
    if (mode === 'newer price checker') assert.equal(controlsPassed, 2);
    const f = actor(child, {desertDiary:false}), p = f.p, sender = p.getPacketSender();
    const { MAIN_PROFILE } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
    assert.equal(p.getProfile(), MAIN_PROFILE); assert.equal(p.isPlayerBot(), false);
    assert.equal(p.getAttribute(Progress.TASKS_ATTRIBUTE), undefined, 'no diary eligibility was injected');
    const manager = p.getDialogueManager(), submitted = [], actions = [], widgets = [], completed = [], scripts = [];
    let npc, inAction = false, turns = 0, executed = 0, returned = 0;
    child.after(() => {
      // These are references submitted by this actual action, not the shared DEFAULT_KEY bucket.
      for (const task of submitted) task.stop();
      p.closeInterruptibleInterfaces();
      if (npc) core.World.getNpcs().remove(npc);
      for (const g of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) core.ItemOnGroundManager.deregister(g);
    });
    const items = container => container ? container.getItems().flatMap((item, slot) => item?.getId() > 0 && item.getAmount() > 0
      ? [{slot, id:item.getId(), amount:item.getAmount(), meta:item.getMeta()}] : []) : [];
    const resources = () => ({inventory:items(f.inv), equipment:items(p.getEquipment()),
      banks:p.getBanks().flatMap((bank, tab) => bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? [{tab, items:items(bank)}] : []),
      floor:core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername()
        && g.getPrivateArea() === p.getPrivateArea()).map(g => ({id:g.getItem().getId(), amount:g.getItem().getAmount(), meta:g.getItem().getMeta()})),
      checker:items(p.__priceCheckerContainer), xp:core.Skill.values().map(skill => p.getSkillManager().getExperience(skill))});
    const turn = () => {
      assert.ok(++turns <= 80, 'bounded native global/input/movement phases');
      p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process(); f.c.processTurnPackets();
      const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
      if (q.hasPendingWork()) q.process(); core.TaskManager.processWalkTo(p.getIndex());
    };
    const input = async packet => { await f.c.dispatch([packet]); for (let n = 0; n < 6; n++) turn(); };
    const current = (Type, group, text) => {
      const entry = manager.getCurrent(); assert.ok(entry instanceof Type);
      assert.equal(norm(entry.getText()), text); assert.equal(sender.getChatboxGroupId(), group);
      assert.equal(manager.getOwner(), undefined); assert.equal(sender.getChatboxOwner(), undefined);
      const mount = sender.subInterfaceTargets.get(group); assert.ok(mount);
      assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
      if (entry instanceof core.NpcDialogue) assert.equal(entry.getNpcId(), NPC);
      return entry;
    };
    const resume = group => ({type:'dialogue_continue', widgetId:(group << 16) | 5, childIndex:-1});
    const pricePacket = {type:'widget_action', widgetId:PRICE_BUTTON, groupId:387, childId:3, buttonNum:1};
    const emit = PM.emitCustomEvent;
    child.mock.method(PM, 'emitCustomEvent', function(name, event) {
      if (name === 'npc-dialogue:action' && event.player === p && event.stepId === '6kP-8W') {
        inAction = true;
        try { const result = emit.call(this, name, event); actions.push({event, cycle:core.World.getProcessCycle()}); return result; }
        finally { inAction = false; }
      }
      if (name === 'player:widget-action' && event.player === p && event.packet.widgetId === PRICE_BUTTON) {
        const observation = {before:event.handled, cycle:core.World.getProcessCycle()};
        const result = emit.call(this, name, event); observation.after = event.handled; widgets.push(observation); return result;
      }
      return emit.call(this, name, event);
    });
    const submit = core.TaskManager.submit;
    child.mock.method(core.TaskManager, 'submit', function(task) {
      const result = submit.call(this, task);
      if (inAction && task.pluginName === 'LovakengjMinecarts') submitted.push(task);
      return result;
    });
    const click = PM.emitInterfaceActionClick;
    child.mock.method(PM, 'emitInterfaceActionClick', function(event) {
      const result = click.call(this, event);
      if (event.player === p && event.buttonId === PRICE_BUTTON) completed.push({result, handled:event.handled,
        cycle:core.World.getProcessCycle(), mount:sender.getSubInterfaceAt(MAIN_TARGET), side:sender.getSubInterfaceAt(SIDE_TARGET),
        interfaceId:p.getInterfaceId(), status:p.getStatus(), container:p.__priceCheckerContainer});
      return result;
    });
    const clientScript = sender.sendClientScript;
    child.mock.method(sender, 'sendClientScript', function(...args) { scripts.push(args); return clientScript.apply(this, args); });
    assert.equal(f.inv.getAmount(I.COINS), 0); f.inv.add(plain(I.COINS,20), false); f.inv.refreshItems();
    assert.equal(f.inv.getAmount(I.COINS), 20); assert.equal(f.inv.getItems()[f.inv.getSlotForItemId(I.COINS)].getMeta(), null);
    assert.equal(p.getPrivateArea(), null); assert.ok(p.isRegistered() && p.getHitpoints() > 0);
    const initial = resources();
    const checker = () => {
      assert.equal(widgets.length,1); assert.equal(widgets[0].before,false); assert.equal(widgets[0].after,false);
      assert.equal(completed.length,1); assert.equal(completed[0].result,true);
      assert.equal(p.getInterfaceId(),CHECKER); assert.equal(p.getStatus(),core.PlayerStatus.PRICE_CHECKING);
      const mount = sender.getSubInterfaceAt(MAIN_TARGET), side = sender.getSubInterfaceAt(SIDE_TARGET);
      assert.ok(mount && side); assert.equal(mount.groupId,CHECKER); assert.equal(side.groupId,SIDE);
      assert.ok(Object.isFrozen(mount) && Object.isFrozen(side));
      assert.equal(completed[0].mount,mount); assert.equal(completed[0].side,side);
      assert.equal(completed[0].interfaceId,CHECKER); assert.equal(completed[0].status,core.PlayerStatus.PRICE_CHECKING);
      const container = p.__priceCheckerContainer;
      assert.ok(container instanceof ItemContainer); assert.equal(container.getPlayer(),p);
      assert.equal(container.capacity(),28); assert.deepEqual(container.getValidItems(),[]);
      assert.equal(completed[0].container,container); return {mount,side,container};
    };
    if (mode === 'direct price checker') {
      await input(pricePacket); const opened = checker();
      turn(); assert.equal(sender.getSubInterfaceAt(MAIN_TARGET),opened.mount);
      assert.deepEqual(resources(),initial); assert.equal(submitted.length,0); assert.equal(actions.length,0);
      controlsPassed++; return;
    }
    core.RegionManager.loadMapFiles(X,Y);
    const stand = [[0,-1],[0,1],[-1,0],[1,0]].map(([dx,dy]) => new core.Location(X+dx,Y+dy,0))
      .find(at => !core.RegionManager.blocked(at,null));
    assert.ok(stand, 'a collision-checked adjacent tile at the canonical conductor spawn');
    p.setLocation(stand); p.needsPlacement = false;
    npc = core.NPC.create(NPC,new core.Location(X,Y,0)); assert.equal(core.World.getNpcs().add(npc),true);
    const definition = npc.getCurrentDefinition(p); assert.equal(definition.getName(),'Loinur');
    const clickType = definition.getActions().indexOf('Talk-to')+1; assert.ok(clickType > 0);
    await input({type:'npc_option',index:npc.getIndex(),clickType});
    current(core.NpcDialogue,231,'Can I help you today?'); await input(resume(231));
    const pending = core.MultiChatboxPrompt.getPending(p);
    assert.ok(pending); assert.equal(pending.title,'Select an option');
    assert.deepEqual(pending.options,['Can I go for a ride?', "I'm fine, thanks."]);
    assert.equal(manager.getCurrent(),undefined); assert.equal(manager.getOwner(),undefined);
    assert.equal(sender.getChatboxOwner(),undefined); assert.equal(sender.getChatboxGroupId(),219);
    const optionMount = sender.subInterfaceTargets.get(219); assert.ok(optionMount);
    assert.equal(sender.getSubInterfaceAt(optionMount.targetUid),optionMount);
    await input({type:'dialogue_continue',widgetId:core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
      childIndex:pending.options.indexOf('Can I go for a ride?')+1});
    current(core.PlayerDialogue,217,'Can I go for a ride?'); await input(resume(217));
    current(core.NpcDialogue,231,'Of course.'); assert.equal(submitted.length,0); assert.equal(actions.length,0);
    assert.deepEqual(resources(),initial);
    // Both decoded packets are drained synchronously in ONE actual player's input phase.
    await f.c.dispatch(mode === 'newer price checker' ? [resume(231),pricePacket] : [resume(231)]);
    turn();
    assert.equal(actions.length,1); assert.equal(actions[0].event.handled,true); assert.equal(actions[0].event.end,true);
    assert.equal(actions[0].event.npcId,NPC); assert.equal(actions[0].event.text,'(Lovakengj Minecart Network interface opens.)');
    assert.equal(submitted.length,1); const task = submitted[0];
    assert.equal(task.key,core.Task.DEFAULT_KEY); assert.equal(task.getDelay(),1); assert.equal(task.getRemainingTicks(),1);
    assert.equal(task.isImmediate(),false); assert.equal(task.isRunning(),true);
    const execute = task.execute;
    child.mock.method(task,'execute',function() { executed++; const result = execute.call(this); returned++; return result; });
    let opened;
    if (mode === 'newer price checker') {
      opened = checker(); assert.equal(actions[0].cycle,widgets[0].cycle); assert.equal(widgets[0].cycle,completed[0].cycle);
      assert.deepEqual(resources(),initial); assert.equal(task.isRunning(),true);
    }
    assert.equal(executed,0); assert.equal(returned,0);
    turn();
    assert.equal(executed,1); assert.equal(returned,1); assert.equal(task.isStopped(),true);
    if (mode === 'stationary destination menu') {
      assert.equal(p.getInterfaceId(),MENU); assert.equal(sender.getSubInterfaceAt(MAIN_TARGET)?.groupId,MENU);
      assert.ok(scripts.some(args => args[0] === 217 && args[1] === 1 && args[2] === data.menuTitle
        && args[3] === data.stations.map(station => station.label).join('|')));
      assert.deepEqual(resources(),initial); controlsPassed++; return;
    }
    // First lifetime target; subsequent state/resource/XP checks remain UNREACHED on an earlier failure.
    assert.equal(sender.getSubInterfaceAt(MAIN_TARGET),opened.mount,'the completed newer main lifetime survives the older queued menu');
    assert.equal(p.getInterfaceId(),CHECKER); assert.equal(p.getStatus(),core.PlayerStatus.PRICE_CHECKING);
    assert.equal(sender.getSubInterfaceAt(SIDE_TARGET),opened.side); assert.equal(p.__priceCheckerContainer,opened.container);
    assert.deepEqual(resources(),initial);
  });
});
