// Run after `yarn build`: node --test tests/quest-reward-room.test.cjs
//
// Quest steps that lose an item, or the money for it, on a full inventory. No capture shows a full
// bag at any of these, so refusal wording is ours; the rest is the Wiki:
// - Grip's keyring: "Once he dies, pick up Grip's keyring", so it can lie on the ground.
// - Arkan blade: "any dropped blades are deleted upon repurchasing", so it is refused, not dropped.
// - Grish's supplies: Transcript:Zogre_Flesh_Eaters, "Goes to ground with full inventory".
// Real dispatch where there is one: death as NPCDeathTask sends it, item on loc and Talk-to by packet.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [3222, 3218];
const CHEST = 2632;
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };
const NO_ROOM = "You don't have enough inventory space.";
const STAGE_PHOENIX_CHARLIE = 4;
const STAGE_PHOENIX_GRIP = 5;
const STAGE_BLACK_GRIP = 11;
const STAGE_BLACK_CANDLESTICK = 12;
const FINAL_DAWN_DONE = 68;

let core;
let I;
let N;
let next = 9300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("roomqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, c, inv: p.getInventory(), messages };
}

const quest = (key) => {
  const found = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);
  assert.ok(found, `quest ${key} is registered`);
  return found;
};

const put = (f, id, slot, amount = 1) => f.inv.setItem(slot, new core.Item(id, amount));

function fill(f, leave = 0) {
  while (f.inv.getFreeSlots() > leave) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), leave, "control: the bag is as full as asked");
}

function freeSlot(f) {
  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === I.RAKE), new core.Item(-1, 0));
  f.inv.refreshItems();
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const onGround = (f, id) => ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), null);

/** Plays the open conversation, answering each menu from `answers`, and returns what it showed. */
async function playChat(f, answers) {
  const queue = [...answers];
  const shown = [];
  for (let i = 0; i < 120; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const choice = menu.options.findIndex((option) => option.startsWith(queue[0] ?? "\0"));
      assert.ok(choice >= 0, `"${queue[0]}" is on the menu: ${JSON.stringify(menu.options)}`);
      queue.shift();
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 });
      ticks(f, 1);
      continue;
    }
    const manager = f.p.getDialogueManager();
    if (!manager.isActive()) {
      ticks(f, 2);
      if (!manager.isActive() && !core.MultiChatboxPrompt.getPending(f.p)) break;
      continue;
    }
    const current = manager.getCurrent();
    if (typeof current?.getText === "function") shown.push(String(current.getText()).replace(/<br>/g, " "));
    const group = f.p.getPacketSender().getChatboxGroupId();
    if (!(current instanceof ActionDialogue) && group in CONTINUE_CHILD) {
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | CONTINUE_CHILD[group], childIndex: -1 });
    }
    ticks(f, 1);
  }
  assert.deepEqual(queue, [], "every expected menu came up");
  return shown;
}

async function talk(t, f, npcId, answers) {
  const npc = core.NPC.create(npcId, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const actions = npc.getCurrentDefinition(f.p).getActions();
  const index = actions.findIndex((action) => action === "Talk-to");
  assert.ok(index >= 0, `control: ${npcId} has Talk-to: ${JSON.stringify(actions)}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
  ticks(f, 3);
  return playChat(f, answers);
}

// ------------------------------------------------------------------ Grip's keyring

function killGrip(f) {
  const npc = core.NPC.create(N.GRIP, new core.Location(HOME[0] + 1, HOME[1], 0));
  PM.emitNpcDeath({
    npc, killer: f.p, npcId: npc.getContentId(f.p), remains: null,
    location: { x: HOME[0] + 1, y: HOME[1], z: 0 },
  });
}

const heroes = () => quest("heroes_quest");

function atStage(t, stage) {
  const f = actor(t);
  heroes().setStage(f.p, stage);
  return f;
}

test("Grip's keyring: with room in the bag; on a full bag on the ground, as the stage moves", (t) => {
  const control = atStage(t, STAGE_PHOENIX_CHARLIE);
  killGrip(control);
  assert.equal(control.inv.getAmount(I.GRIPS_KEYRING), 1, "control: in the bag");
  assert.equal(onGround(control, I.GRIPS_KEYRING), null, "control: not on the ground");
  assert.equal(heroes().getStage(control.p), STAGE_PHOENIX_GRIP, "control: the stage moves");

  const f = atStage(t, STAGE_PHOENIX_CHARLIE);
  fill(f);
  killGrip(f);
  assert.equal(f.inv.getAmount(I.GRIPS_KEYRING), 0, "control: no room");
  assert.equal(heroes().getStage(f.p), STAGE_PHOENIX_GRIP, "the stage still moves");
  assert.ok(onGround(f, I.GRIPS_KEYRING), "the keyring lies on the ground");
});

test("Grip's keyring: a player who lost it kills him again, and one who didn't gets no second", (t) => {
  const lost = atStage(t, STAGE_PHOENIX_GRIP);
  killGrip(lost);
  assert.equal(lost.inv.getAmount(I.GRIPS_KEYRING), 1, "he gives it again");
  assert.equal(heroes().getStage(lost.p), STAGE_PHOENIX_GRIP, "the stage stays");

  const holding = atStage(t, STAGE_PHOENIX_GRIP);
  put(holding, I.GRIPS_KEYRING, 0);
  killGrip(holding);
  assert.equal(holding.inv.getAmount(I.GRIPS_KEYRING), 1, "control: no second keyring");

  const done = atStage(t, STAGE_PHOENIX_GRIP);
  put(done, I.PETES_CANDLESTICK, 0);
  killGrip(done);
  assert.equal(done.inv.getAmount(I.GRIPS_KEYRING), 0, "control: none once the candlestick is held");

  const early = atStage(t, 3);
  killGrip(early);
  assert.equal(early.inv.getAmount(I.GRIPS_KEYRING), 0, "control: none before the route reaches him");
});

// ------------------------------------------------------------------ Pete's candlestick

async function useKeyOnChest(t, f) {
  const at = new core.Location(HOME[0] + 1, HOME[1], 0);
  const chest = new core.GameObject(CHEST, at, 10, 0);
  MapObjects.add(chest);
  t.after(() => MapObjects.remove(chest));
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === I.GRIPS_KEYRING);
  await send(f, {
    type: "inventory_use_on", slot, itemId: I.GRIPS_KEYRING,
    target: { kind: "loc", id: CHEST, x: at.getX(), y: at.getY(), level: 0 },
  });
  ticks(f, 3);
}

function withKey(t, stage) {
  const f = atStage(t, stage);
  put(f, I.GRIPS_KEYRING, 0);
  return f;
}

test("the candlestick chest gives it with room, and refuses a full bag without moving the stage", async (t) => {
  const control = withKey(t, STAGE_BLACK_GRIP);
  await useKeyOnChest(t, control);
  assert.equal(control.inv.getAmount(I.PETES_CANDLESTICK), 1, "control: the candlestick");
  assert.equal(heroes().getStage(control.p), STAGE_BLACK_CANDLESTICK, "control: and the stage");

  for (const stage of [STAGE_BLACK_GRIP, STAGE_PHOENIX_GRIP]) {
    const f = withKey(t, stage);
    fill(f);
    await useKeyOnChest(t, f);
    assert.equal(heroes().getStage(f.p), stage, `stage ${stage} waits`);
    assert.ok(f.messages.includes(NO_ROOM), `stage ${stage} says why: ${JSON.stringify(f.messages)}`);
    assert.equal(f.messages.some((text) => text.startsWith("You unlock the chest")), false, "and unlocks nothing");
    freeSlot(f);
    await useKeyOnChest(t, f);
    assert.equal(f.inv.getAmount(I.PETES_CANDLESTICK), 1, `stage ${stage}: with room it gives it`);
  }
});

test("the chest gives it again after the stage moved, and no second one", async (t) => {
  const lost = withKey(t, STAGE_BLACK_CANDLESTICK);
  await useKeyOnChest(t, lost);
  assert.equal(lost.inv.getAmount(I.PETES_CANDLESTICK), 1, "a player who lost it gets another");
  assert.equal(heroes().getStage(lost.p), STAGE_BLACK_CANDLESTICK, "the stage stays");

  const holding = withKey(t, STAGE_BLACK_CANDLESTICK);
  put(holding, I.PETES_CANDLESTICK, 1);
  await useKeyOnChest(t, holding);
  assert.equal(holding.inv.getAmount(I.PETES_CANDLESTICK), 1, "control: no second candlestick");
});

// ------------------------------------------------------------------ Arkan blade

const BLADE_ANSWERS = ["You don't happen to have another sword", "Yes."];

function bladeBuyer(t, coins) {
  const f = actor(t);
  quest("the_final_dawn").setStage(f.p, FINAL_DAWN_DONE);
  put(f, I.COINS, 0, coins);
  return f;
}

test("Arkan blade: a full bag keeps its coins and the conversation stops", async (t) => {
  const control = bladeBuyer(t, 300000);
  await talk(t, control, N.PRINCE_ITZLA_ARKAN, BLADE_ANSWERS);
  assert.deepEqual([control.inv.getAmount(I.COINS), control.inv.getAmount(I.ARKAN_BLADE)], [50000, 1], "control: room");

  const exact = bladeBuyer(t, 250000);
  fill(exact);
  await talk(t, exact, N.PRINCE_ITZLA_ARKAN, BLADE_ANSWERS);
  assert.deepEqual([exact.inv.getAmount(I.COINS), exact.inv.getAmount(I.ARKAN_BLADE)], [0, 1], "control: exact coins free their slot");

  const f = bladeBuyer(t, 300000);
  fill(f);
  await talk(t, f, N.PRINCE_ITZLA_ARKAN, BLADE_ANSWERS);
  assert.deepEqual([f.inv.getAmount(I.COINS), f.inv.getAmount(I.ARKAN_BLADE)], [300000, 0], "nothing changes hands");
  assert.ok(f.messages.includes(NO_ROOM), JSON.stringify(f.messages));
  assert.equal(f.messages.some((text) => text.startsWith("You give Itzla")), false, "and it isn't said to");
  assert.equal(onGround(f, I.ARKAN_BLADE), null, "control: no blade on the ground, which the Wiki warns of");
  assert.equal(f.p.getDialogueManager().isActive(), false, "the conversation is over");
});

// ------------------------------------------------------------------ Grish's supplies

const GRISH_ANSWERS = [
  "What do you mean sickies?", "Can I help in any way?", "Ok, I'll check things out", "Yes, I'm really sure!",
];

const groundAmount = (f, id) => onGround(f, id)?.getItem().getAmount() ?? 0;

/** What Grish asks before the start: without these the conversation ends at "too green". */
function qualifiedForGrish(t) {
  const f = actor(t);
  const skills = f.p.getSkillManager();
  for (const [skill, level] of [[core.Skill.RANGED, 30], [core.Skill.FLETCHING, 30], [core.Skill.SMITHING, 4], [core.Skill.HERBLORE, 8]]) {
    skills.setCurrentLevel(skill, level, false);
  }
  f.p.setAttribute("quest.jungle_potion.stage", 12);
  f.p.setAttribute("quest.big_chompy_bird_hunting.stage", 65);
  return f;
}

test("Grish's supplies: in the bag with room, and what doesn't fit goes to the ground", async (t) => {
  const control = qualifiedForGrish(t);
  await talk(t, control, N.GRISH, GRISH_ANSWERS);
  assert.deepEqual([control.inv.getAmount(I.COOKED_CHOMPY), control.inv.getAmount(I.SUPER_RESTORE_3_)], [3, 2], "control: room");
  assert.equal(groundAmount(control, I.COOKED_CHOMPY), 0, "control: nothing on the ground");

  const full = qualifiedForGrish(t);
  fill(full);
  await talk(t, full, N.GRISH, GRISH_ANSWERS);
  assert.ok(quest("zogre_flesh_eaters").getStage(full.p) > 0, "control: the quest starts");
  assert.deepEqual([groundAmount(full, I.COOKED_CHOMPY), groundAmount(full, I.SUPER_RESTORE_3_)], [3, 2], "all on the ground");

  const partial = qualifiedForGrish(t);
  fill(partial, 1);
  await talk(t, partial, N.GRISH, GRISH_ANSWERS);
  assert.equal(partial.inv.getAmount(I.COOKED_CHOMPY), 1, "what fits goes in the bag");
  assert.deepEqual([groundAmount(partial, I.COOKED_CHOMPY), groundAmount(partial, I.SUPER_RESTORE_3_)], [2, 2], "the rest on the ground");
});


// Fixed-package NPC sale: payment/first-purchase credit may not outpace delivered feathers.
test('native Fycie first purchase conserves its fixed feather package at stack limits', async t => {
  const {MAX_STACK_AMOUNT: CAP} = require('../dist/game/model/container/StackType');
  const {SkillManager} = require('../dist/game/content/skill/SkillManager');
  const q = quest('big_chompy_bird_hunting'), FLAG = 'big-chompy-bird-hunting:fycie-feathers-bought';
  const FEATHER = I.FEATHER, COINS = I.COINS, R = I.RAKE;
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const priceChoice = "Ok, I'll give you 50 bright pretties.";
  assert.equal(FEATHER,314); assert.equal(core.ItemDefinition.forId(FEATHER).isStackable(),true); assert.equal(q.startedValue,5);
  for (const mode of ['room', 'exact headroom', 'poor wallet', 'physical full', 'capped stack', 'ten stack spaces']) await t.test(mode, async child => {
    const f = actor(child), p = f.p, inv = f.inv;
    for (const [s, level] of [[core.Skill.RANGED,30],[core.Skill.COOKING,30],[core.Skill.FLETCHING,5]]) {
      p.getSkillManager().setExperience(s,SkillManager.getExperienceForLevel(level));
      p.getSkillManager().setMaxLevels(s,level,false).setCurrentLevels(s,level,false);
    }
    q.setStage(p,q.startedValue); assert.equal(q.getStage(p),5);
    assert.equal(p.getAttribute(FLAG) ?? 0,0,'ordinary never-purchased claim, no credit injected');
    PM.emitPlayerLogin({player:p,username:p.getUsername()}); p.closeInterruptibleInterfaces();
    inv.add(new core.Item(COINS,mode === 'poor wallet' ? 49 : 100),false);
    const headroom = mode === 'capped stack' ? 0 : mode === 'ten stack spaces' ? 10 : mode === 'exact headroom' ? 25 : null;
    if (headroom !== null) inv.add(new core.Item(FEATHER,CAP-headroom-1),false);
    if (mode === 'physical full') fill(f);
    const npc = core.NPC.create(N.FYCIE,new core.Location(HOME[0]+1,HOME[1],0));
    assert.equal(core.World.getNpcs().add(npc),true); assert.equal(npc.getCurrentDefinition(p).getName(),'Fycie');
    child.after(() => {
      p.closeInterruptibleInterfaces(); PM.emitPlayerDisconnect({player:p,username:p.getUsername()});
      core.TaskManager.cancelTasks(p); core.World.getNpcs().remove(npc);
      for (const g of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) ItemOnGroundManager.deregister(g);
    });
    const stores = id => ({inventory:inv.getAmount(id),equipment:p.getEquipment().getAmount(id),
      bank:p.getBanks().reduce((n,b,tab) => n+(b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0),0),
      floor:core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername()
        && g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === id).reduce((n,g) => n+g.getItem().getAmount(),0)});
    const owned = row => Object.values(row).reduce((n,a) => n+a,0);
    const snapshot = () => ({coins:stores(COINS),feathers:stores(FEATHER),rake:stores(R),stage:q.getStage(p),claim:p.getAttribute(FLAG) ?? 0,
      xp:core.Skill.values().map(s => p.getSkillManager().getExperience(s))});
    let phases = 0;
    const turn = () => {
      assert.ok(++phases <= 120,'bounded native task/input/movement budget'); p.resetUpdating();
      core.World.processCycle = (core.World.processCycle+1) & 0x7fffffff; core.TaskManager.process();
      f.c.processTurnPackets(); const movement = p.getMovementQueue(); movement.beginCycle(); movement.processEntityPursuit();
      if (movement.hasPendingWork()) movement.process(); core.TaskManager.processWalkTo(p.getIndex());
    };
    const input = async packet => { await f.c.dispatch([packet]); turn(); };
    if (headroom !== null) {
      const at = p.getLocation(); ItemOnGroundManager.registerLocation(p,new core.Item(FEATHER),at.clone());
      assert.equal(stores(FEATHER).floor,1);
      await input({type:'ground_item_action',itemId:FEATHER,x:at.getX(),y:at.getY(),option:'Take',optionIndex:3});
      for (let n=0; stores(FEATHER).floor && n<4; n++) turn();
      assert.equal(inv.getAmount(FEATHER),CAP-headroom,'real owned Take fills the declared ordinary feather stack'); assert.equal(stores(FEATHER).floor,0);
      const held = inv.getItems().find(item => item.getId() === FEATHER);
      assert.deepEqual(held.getMeta(),new core.Item(FEATHER).getMeta(),'same ordinary metadata as the real sale output');
    }
    const expectedSpace = mode === 'physical full' ? 0 : headroom === null ? 25 : Math.min(25,headroom);
    assert.equal(inv.getAddableAmount(new core.Item(FEATHER,25)),expectedSpace,'observed native capacity, not a stub');
    assert.equal(inv.getFreeSlots(),mode === 'physical full' ? 0 : headroom === null ? 27 : 26);
    const before = snapshot(), actions = [], choices = [], originalEmit = PM.emitCustomEvent.bind(PM);
    child.mock.method(PM,'emitCustomEvent',(...args) => {
      const [name,event] = args;
      if (name === 'npc-dialogue:action' && event?.player === p && event.stepId === 'EA27SG') {
        assert.equal(event.npcId,N.FYCIE); assert.equal(event.npc,npc); assert.equal(event.kind,'message'); actions.push(event.stepId);
      }
      if (name === 'npc-dialogue:choice' && event?.player === p && normalize(event.option) === normalize(priceChoice)) {
        assert.equal(event.npcId,N.FYCIE); assert.equal(event.npc,npc); choices.push(event.option);
      }
      return originalEmit(...args);
    });
    const manager = p.getDialogueManager(), sender = p.getPacketSender(), seen = [];
    const speech = async () => {
      const current = manager.getCurrent(), group = sender.getChatboxGroupId();
      assert.ok(current instanceof core.NpcDialogue || current instanceof core.PlayerDialogue,'actual imported speech entry required');
      assert.equal(group,current instanceof core.NpcDialogue ? 231 : 217); assert.equal(manager.getOwner(),undefined);
      if (current instanceof core.NpcDialogue) assert.equal(current.getNpcId(),N.FYCIE);
      const mount = sender.subInterfaceTargets.get(group); assert.ok(mount); assert.equal(sender.getSubInterfaceAt(mount.targetUid),mount);
      seen.push(normalize(current.getText())); await input({type:'dialogue_continue',widgetId:(group<<16)|5,childIndex:-1});
    };
    const talkType = npc.getCurrentDefinition(p).getActions().indexOf('Talk-to')+1; assert.ok(talkType>0);
    await input({type:'npc_option',index:npc.getIndex(),clickType:talkType});
    for (let n=0; !core.MultiChatboxPrompt.getPending(p) && n<12; n++) await speech();
    assert.equal(seen[0],normalize("Hey you Creature, I know's what you is You's a 'uman!"));
    const prompt = core.MultiChatboxPrompt.getPending(p); assert.ok(prompt); assert.equal(manager.isActive(),false); assert.equal(manager.getOwner(),undefined);
    assert.equal(normalize(prompt.title),normalize('Select an option'));
    assert.deepEqual(prompt.options.map(normalize),[priceChoice,"Er, sorry, I can't give you that many..."].map(normalize));
    assert.equal(sender.getChatboxGroupId(),219); const menuMount = sender.subInterfaceTargets.get(219);
    assert.ok(menuMount); assert.equal(sender.getSubInterfaceAt(menuMount.targetUid),menuMount); assert.deepEqual(snapshot(),before);
    await input({type:'dialogue_continue',widgetId:core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,childIndex:prompt.options.map(normalize).indexOf(normalize(priceChoice))+1});
    for (let n=0; manager.isActive() && n<8; n++) await speech();
    assert.equal(manager.isActive(),false); assert.equal(core.MultiChatboxPrompt.getPending(p),null);
    const after = snapshot(), paid = owned(before.coins)-owned(after.coins), credit = owned(after.feathers)-owned(before.feathers);
    const refused = mode === 'poor wallet' || mode === 'physical full';
    assert.equal(choices.length,1,'the real ordinary price choice was accepted once');
    if (mode === 'capped stack' || mode === 'ten stack spaces') assert.ok(actions.length <= 1,'canonical preflight refusal may protect the real choice');
    else assert.equal(actions.length,refused ? 0 : 1,'actual EA27SG agrees with ordinary native quote conditions');
    if (mode === 'capped stack' || mode === 'ten stack spaces') {
      assert.ok(paid === 50 && credit === 25 || paid === 0 && credit === 0,
        JSON.stringify({rule:'fixed package must deliver25 across all stores if50 is charged, or refuse atomically',mode,paid,credit,actionCount:actions.length,before,after}));
    } else { assert.equal(paid,refused ? 0 : 50); assert.equal(credit,refused ? 0 : 25); }
    assert.equal(after.claim,paid === 50 ? 1 : 0,'a refusal retains the unconsumed first-purchase claim');
    assert.equal(after.stage,before.stage); assert.deepEqual(after.rake,before.rake); assert.deepEqual(after.xp,before.xp);
    if (paid === 0) assert.deepEqual(after,before,'safe refusal preserves exact inputs and claim');
    if (mode === 'room') {
      assert.equal(inv.getAmount(COINS),50,'the second price remains affordable in the actual wallet');
      await input({type:'npc_option',index:npc.getIndex(),clickType:talkType});
      assert.ok(manager.getCurrent() instanceof core.NpcDialogue); assert.equal(manager.getCurrent().getNpcId(),N.FYCIE);
      assert.equal(normalize(manager.getCurrent().getText()),normalize("I's sorry creature, I don't got no more flufsies! But I got lots of bright pretties! Hope you's get da stabbers for Dad soonly!"));
      await speech(); assert.deepEqual(snapshot(),after,'actual postpurchase variant cannot take the remaining affordable50 coins');
    }
  });
});

// ------------------------------------------------------------------ Luthas's banana wages

test("Luthas pays for a completed crate without losing earned wages", async (t) => {
  const { MAX_STACK_AMOUNT: CAP } = require("../dist/game/model/container/StackType");
  const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
  const q = quest("pirates_treasure"), COINS = I.COINS, BANANA = I.BANANA;
  const EMPLOYMENT = "pirates-treasure.employment", PACKED = "pirates-treasure.bananas", RUM = "pirates-treasure.rum";
  const NPC_ID = N.LUTHAS, CRATE_ID = core.ObjectIdentifiers.CRATE_15;
  const home = new core.Location(2939, 3154, 0); // Luthas's recorded spawn.
  const normalize = value => String(value ?? "").replace(/<br>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(NPC_ID, 3647);
  assert.equal(CRATE_ID, 2072);
  assert.equal(core.ItemDefinition.forId(COINS).isStackable(), true);
  assert.equal(core.ItemDefinition.forId(BANANA).isStackable(), false);
  core.RegionManager.loadMapFiles(home.getX(), home.getY());
  assert.equal(core.RegionManager.getRegion(home.getX(), home.getY()).isLoaded(), true);

  for (const mode of ["room", "exact headroom", "not employed", "nine packed", "full coin stack", "ten coin spaces"]) {
    await t.test(mode, async (child) => {
      const f = actor(child), p = f.p, inv = f.inv;
      PM.emitPlayerLogin({ player: p, username: p.getUsername() });
      p.closeInterruptibleInterfaces();
      assert.equal(q.getStage(p), 0, "a fresh ordinary player has not started the quest");
      assert.equal(p.getAttribute(EMPLOYMENT) ?? 0, 0);
      assert.equal(p.getAttribute(PACKED) ?? 0, 0);
      assert.equal(p.getAttribute(RUM) ?? 0, 0);
      assert.ok(p.getHitpoints() > 0, "the native player is alive");
      assert.equal(inv.getAmount(COINS), 0, "no pre-existing coins are overwritten");
      assert.equal(inv.getAmount(BANANA), 0, "no pre-existing bananas are overwritten");
      const wallet = mode === "exact headroom" ? CAP - 30 : mode === "full coin stack" ? CAP : mode === "ten coin spaces" ? CAP - 10 : 100;
      const bananas = mode === "nine packed" ? 9 : 10;
      inv.add(new core.Item(COINS, wallet), false);
      inv.add(new core.Item(BANANA, bananas), false);
      assert.equal(inv.getAmount(COINS), wallet);
      assert.equal(inv.getAmount(BANANA), bananas);
      const coinItem = inv.getItems().find(item => item.getId() === COINS);
      assert.deepEqual(coinItem.getMeta(), new core.Item(COINS, 1).getMeta(), "the wage would use the ordinary coin stack");

      const npc = core.NPC.create(NPC_ID, home.clone());
      assert.equal(core.World.getNpcs().add(npc), true, "register the Luthas at his recorded spawn");
      child.after(() => {
        p.closeInterruptibleInterfaces();
        PM.emitPlayerDisconnect({ player: p, username: p.getUsername() });
        core.TaskManager.cancelTasks(p);
        core.World.getNpcs().remove(npc);
      });
      const npcDefinition = npc.getCurrentDefinition(p);
      assert.equal(npcDefinition.getName(), "Luthas");
      const talkOption = npcDefinition.getActions().findIndex(option => option === "Talk-to") + 1;
      assert.ok(talkOption > 0, "the real NPC offers Talk-to");

      // Find a walkable starting tile beside the actual spawn, before the job begins.
      const sides = [[0, -1], [-1, 0], [1, 0], [0, 1]];
      const start = sides.map(([dx, dy]) => new core.Location(home.getX() + dx, home.getY() + dy, 0)).find(at => {
        p.setLocation(at);
        p.needsPlacement = false;
        return !core.RegionManager.blocked(at, p.getPrivateArea()) && PathFinder.reachedObj(p, home);
      });
      assert.ok(start, "the registered NPC has a reachable neighbouring tile");
      p.setLocation(start);
      p.needsPlacement = false;
      assert.equal(p.busy(), false);

      // Use an indexed cache-map crate near Luthas, not a test-created object.
      const crates = [...core.MapObjects.mapObjects.values()].flat().filter(object => {
        const at = object.getLocation();
        return object.getId() === CRATE_ID && at.getZ() === 0 && object.getPrivateArea() == null
          && Math.max(Math.abs(at.getX() - home.getX()), Math.abs(at.getY() - home.getY())) <= 32;
      }).sort((a, b) => a.getLocation().getDistance(home) - b.getLocation().getDistance(home));
      assert.ok(crates.length > 0, "the loaded plantation map contains the crate");
      const crate = crates[0], crateAt = crate.getLocation();
      if (crates.length > 1) assert.notEqual(crates[1].getLocation().getDistance(home), crateAt.getDistance(home), "the nearest crate is unambiguous");
      assert.equal(core.MapObjects.getPrivateArea(p, CRATE_ID, crateAt), crate);
      const crateDefinition = core.ObjectDefinition.forPlayer(CRATE_ID, p);
      const fillOption = crateDefinition.getInteractions().findIndex(option => String(option ?? "").toLowerCase().includes("fill")) + 1;
      assert.ok(fillOption > 0, "the actual crate definition offers Fill");

      const stores = id => ({
        inventory: inv.getAmount(id), equipment: p.getEquipment().getAmount(id),
        bank: p.getBanks().reduce((sum, bank, tab) => sum + (bank && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? bank.getAmount(id) : 0), 0),
        floor: core.World.getItems().filter(item => !item.isPendingRemoval() && item.getOwner() === p.getUsername()
          && item.getPrivateArea() === p.getPrivateArea() && item.getItem().getId() === id)
          .reduce((sum, item) => sum + item.getItem().getAmount(), 0),
      });
      const snapshot = () => ({ coins: stores(COINS), bananas: stores(BANANA), stage: q.getStage(p),
        employment: p.getAttribute(EMPLOYMENT) ?? 0, packed: p.getAttribute(PACKED) ?? 0,
        rum: p.getAttribute(RUM) ?? 0, xp: core.Skill.values().map(skill => p.getSkillManager().getExperience(skill)) });
      const owned = row => Object.values(row).reduce((sum, count) => sum + count, 0);
      const events = [], originalEmit = PM.emitCustomEvent.bind(PM);
      child.mock.method(PM, "emitCustomEvent", (...args) => {
        const [name, event] = args;
        if (event?.player === p && name === "npc-dialogue:action" && ["A0JWWz", "76-Dox", "1YHx0E"].includes(event.stepId)) {
          assert.equal(event.npcId, NPC_ID);
          assert.equal(event.npc, npc);
          if (event.stepId === "A0JWWz") assert.equal(event.kind, "message");
          events.push(event.stepId);
        }
        if (event?.player === p && name === "npc-dialogue:choice" && event.option === "Could you offer me employment on your plantation?") {
          assert.equal(event.npcId, NPC_ID);
          assert.equal(event.npc, npc);
          events.push("employment");
        }
        return originalEmit(...args);
      });
      let phases = 0;
      const turn = () => {
        assert.ok(++phases <= 250, "bounded global, input and movement phases");
        p.resetUpdating();
        core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
        core.TaskManager.process();
        f.c.processTurnPackets();
        const movement = p.getMovementQueue();
        movement.beginCycle();
        movement.processEntityPursuit();
        if (movement.hasPendingWork()) movement.process();
        core.TaskManager.processWalkTo(p.getIndex());
      };
      const input = async packet => { await f.c.dispatch([packet]); turn(); };
      const manager = p.getDialogueManager(), sender = p.getPacketSender();
      const shownStrings = [], originalString = sender.sendString.bind(sender);
      child.mock.method(sender, "sendString", (text, id, ...rest) => {
        if (id === (229 << 16 | 3)) shownStrings.push(normalize(text));
        return originalString(text, id, ...rest);
      });
      const speech = async (text, fromNpc) => {
        const current = manager.getCurrent(), group = sender.getChatboxGroupId();
        assert.ok(current instanceof (fromNpc ? core.NpcDialogue : core.PlayerDialogue), "current native speech type");
        if (fromNpc) assert.equal(current.getNpcId(), NPC_ID);
        assert.equal(group, fromNpc ? 231 : 217);
        assert.equal(normalize(current.getText()), normalize(text));
        assert.equal(manager.getOwner(), undefined);
        assert.equal(sender.getChatboxOwner(), undefined);
        const mount = sender.subInterfaceTargets.get(group);
        assert.ok(mount);
        assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
        await input({ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 });
      };
      const talk = async () => {
        await input({ type: "npc_option", index: npc.getIndex(), clickType: talkOption });
        for (let n = 0; !manager.isActive() && n < 60; n++) turn();
        assert.ok(manager.isActive(), "the actual NPC interaction reaches dialogue");
      };
      const choice = async (expected, options) => {
        const prompt = core.MultiChatboxPrompt.getPending(p);
        assert.ok(prompt, "the native choice is current");
        assert.equal(manager.isActive(), false);
        assert.equal(manager.getOwner(), undefined);
        assert.equal(sender.getChatboxOwner(), undefined);
        assert.equal(sender.getChatboxGroupId(), 219);
        const mount = sender.subInterfaceTargets.get(219);
        assert.ok(mount);
        assert.equal(sender.getSubInterfaceAt(mount.targetUid), mount);
        assert.deepEqual(prompt.options.map(normalize), options.map(normalize));
        const index = prompt.options.map(normalize).indexOf(normalize(expected));
        assert.ok(index >= 0);
        await input({ type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
      };
      const fill = async expected => {
        const before = p.getAttribute(PACKED) ?? 0;
        await input({ type: "object_option", id: CRATE_ID, x: crateAt.getX(), y: crateAt.getY(), clickType: fillOption });
        for (let n = 0; (p.getAttribute(PACKED) ?? 0) === before && !f.messages.includes("Why would I want to do that?") && n < 80; n++) turn();
        assert.equal(p.getAttribute(PACKED) ?? 0, expected, "actual crate Fill reaches its earned count");
      };

      if (mode === "not employed") {
        const before = snapshot();
        await fill(0);
        assert.ok(f.messages.includes("Why would I want to do that?"));
        assert.deepEqual(snapshot(), before, "the unaccepted job cannot consume bananas or pay wages");
        assert.deepEqual(events, []);
        return;
      }

      await talk();
      await speech("Hello I'm Luthas, I run the banana plantation here.", true);
      await choice("Could you offer me employment on your plantation?", [
        "Could you offer me employment on your plantation?", "That customs officer is annoying isn't she?",
      ]);
      assert.deepEqual(events, ["employment"]);
      assert.equal((p.getAttribute(EMPLOYMENT) ?? 0) & 1, 1, "the real choice establishes employment");
      await speech("Could you offer me employment on your plantation?", false);
      await speech("Yes, I can sort something out. There's a crate ready to be loaded onto the ship.", true);
      await speech("You wouldn't believe the demand for bananas from Wydin's shop over in Port Sarim. I think this is the third crate I've shipped him this month..", true);
      await speech("If you could fill it up with bananas, I'll pay you 30 gold.", true);
      assert.equal(q.getStage(p), 0, "employment did not inject quest progression");

      await fill(bananas);
      assert.equal(inv.getAmount(BANANA), 0, "the crate consumed the actual carried bananas");
      assert.equal(sender.getChatboxGroupId(), 229, "the crate showed its native message box");
      assert.equal(shownStrings.at(-1), bananas === 10 ? "You fill the crate with bananas." : "You pack all your bananas into the crate.");
      const crateMessage = sender.subInterfaceTargets.get(229);
      assert.ok(crateMessage);
      assert.equal(sender.getSubInterfaceAt(crateMessage.targetUid), crateMessage);
      const before = snapshot();
      assert.equal(before.packed, bananas);
      assert.equal(owned(before.coins), wallet);
      assert.equal(before.rum, 0);
      if (mode === "nine packed") {
        await talk();
        await speech("Have you completed your task yet?", true);
        assert.deepEqual(snapshot(), before, "nine packed bananas do not earn a wage");
        assert.deepEqual(events, ["employment"]);
        return;
      }

      assert.equal(before.packed, 10, "the completed job is earned by real crate input");
      const expectedCapacity = mode === "full coin stack" ? 0 : mode === "ten coin spaces" ? 10 : 30;
      assert.equal(inv.getAddableAmount(new core.Item(COINS, 30)), expectedCapacity, "actual ordinary coin headroom");
      await talk();
      await speech("I've filled a crate with bananas.", false);
      assert.deepEqual(snapshot(), before, "no payment before Luthas's current line");
      await speech("Well done, here's your payment.", true);
      const after = snapshot(), credit = owned(after.coins) - owned(before.coins);
      assert.ok((credit === 30 && after.packed === 0) || (credit === 0 && after.packed === 10),
        JSON.stringify({ mode, credit, beforeCoins: before.coins, afterCoins: after.coins, beforePacked: before.packed, afterPacked: after.packed }));
      assert.deepEqual(events, credit === 30 ? ["employment", "A0JWWz", "76-Dox"] : ["employment", "A0JWWz"],
        "the real payment action follows the unboxed message only when payment can fit");
      if (mode === "room" || mode === "exact headroom") assert.deepEqual([credit, after.packed], [30, 0], "a complete wage is paid and consumed once");
      assert.deepEqual(after.bananas, before.bananas);
      assert.equal(after.stage, before.stage);
      assert.equal(after.employment, before.employment);
      assert.equal(after.rum, before.rum);
      assert.deepEqual(after.xp, before.xp);
      if (credit === 0) {
        assert.deepEqual(after, before, "refusal keeps the completed entitlement and resources");
        assert.ok(f.messages.includes("You can't carry all of your wages."));
        assert.equal(f.messages.includes("Luthas hands you 30 coins."), false, "a refusal does not claim payment");
        assert.equal(manager.isActive(), false);
        assert.equal(sender.getChatboxGroupId(), -1);
        assert.equal(core.MultiChatboxPrompt.getPending(p), null);
      }
      if (mode === "room" || mode === "exact headroom") {
        await talk();
        await speech("Have you completed your task yet?", true);
        assert.deepEqual(snapshot(), after, "talking again cannot pay a second time");
        assert.deepEqual(events, ["employment", "A0JWWz", "76-Dox"]);
      }
    });
  }
});

// A single tomato and pie shell make the first garden-pie part on a members world.
test('a members-world player can assemble the first garden-pie part', async (t) => {
  const TOMATO = 1982, SHELL = 2315, PART = 7172;
  const world = core.WorldDefinition;
  assert.equal(world.isMembersWorld(), true);
  assert.ok(world.getWorldDefinition().zones.some(zone => zone.tags.includes('f2p') && world.zoneContains(zone, HOME[0], HOME[1])));
  assert.deepEqual(['tomato', 'pie_shell', 'unfinished_garden_pie_1'].map(name => core.CacheDefinitions.getObjId(name)), [TOMATO, SHELL, PART]);
  for (const [id, members] of [[TOMATO, false], [SHELL, false], [PART, true]]) {
    assert.equal(core.CacheDefinitions.getItem(id).isMembers, members);
    assert.equal(core.ItemDefinition.forId(id).isNoted(), false);
    assert.equal(core.ItemDefinition.forId(id).isStackable(), false);
  }
  for (const id of [TOMATO, SHELL]) assert.equal(core.CacheDefinitions.getItem(id).isTradable, true);
  const f = actor(t), p = f.p, inv = f.inv, skills = p.getSkillManager(), cooking = core.Skill.COOKING;
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  p.closeInterruptibleInterfaces();
  t.after(() => PM.emitPlayerDisconnect({ player: p, username: p.getUsername() }));
  assert.ok(p.isRegistered() && p.getHitpoints() > 0);
  assert.equal(core.RegionManager.blocked(p.getLocation(), p.getPrivateArea()), false);
  const xp = core.SkillManager.getExperienceForLevel(34);
  skills.setExperience(cooking, xp).setMaxLevels(cooking, 34, false).setCurrentLevels(cooking, 34, false);
  assert.deepEqual([skills.getExperience(cooking), skills.getMaxLevel(cooking), skills.getCurrentLevel(cooking)], [xp, 34, 34]);
  for (const id of [TOMATO, SHELL]) {
    assert.equal(inv.getAmount(id), 0);
    inv.add(new core.Item(id, 1), false);
    assert.notEqual(PM.emitCanUseItem(p, id, 'use'), false);
  }
  assert.notEqual(PM.emitCanUseItem(p, PART, 'use'), false);
  const slots = [TOMATO, SHELL].map(id => inv.getSlotForItemId(id));
  assert.ok(slots.every(slot => slot >= 0));
  assert.notEqual(slots[0], slots[1]);
  for (const slot of slots) assert.equal(inv.getItems()[slot].getMeta(), null);
  assert.equal(inv.getAmount(PART), 0);
  const uses = [], produced = [], tasks = [], original = PM.emitItemOnItem.bind(PM);
  t.mock.method(PM, 'emitItemOnItem', event => {
    const result = original(event);
    if (event.player === p) uses.push([event.usedItemId, event.usedWithItemId, result]);
    return result;
  });
  PM.createApi('GardenPieMembersObserver').onCustomEvent('skills:produced', event => {
    if (event.player === p) produced.push([event.itemId, event.amount, event.xp, event.kind]);
  });
  const submit = core.TaskManager.submit.bind(core.TaskManager);
  t.mock.method(core.TaskManager, 'submit', task => {
    if (task.key === p.getIndex() && task.pluginName === 'Cooking') tasks.push(task);
    return submit(task);
  });
  let turns = 0;
  const turn = () => {
    assert.ok(++turns <= 6);
    p.resetUpdating();
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    f.c.processTurnPackets();
    const movement = p.getMovementQueue();
    movement.beginCycle(); movement.processEntityPursuit();
    if (movement.hasPendingWork()) movement.process();
    core.TaskManager.processWalkTo(p.getIndex());
  };
  await f.c.dispatch([{ type: 'inventory_use_on', slot: slots[0], itemId: TOMATO,
    target: { kind: 'inventory', slot: slots[1], itemId: SHELL } }]);
  turn();
  assert.deepEqual(uses, [[TOMATO, SHELL, true]], 'the real item-on-item path handles the pair');
  assert.equal(tasks.length, 1, 'the actual Cooking handler submits a task');
  assert.equal(tasks[0].isRunning(), true);
  assert.deepEqual([inv.getAmount(TOMATO), inv.getAmount(SHELL), inv.getAmount(PART)], [1, 1, 0]);
  for (let i = 0; i < 4; i++) turn();
  assert.equal(tasks[0].isRunning(), false, 'the actual Cooking task completes');
  assert.deepEqual([inv.getAmount(TOMATO), inv.getAmount(SHELL), inv.getAmount(PART)], [0, 0, 1]);
  assert.equal(skills.getExperience(cooking), xp);
  assert.deepEqual(produced, [[PART, 1, 0, 'make']]);
});
