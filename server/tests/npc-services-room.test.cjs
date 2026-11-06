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

function actor(t) {
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
  const desert = DIARIES.find((diary) => diary.key === "desert");
  p.setAttribute(Progress.TASKS_ATTRIBUTE, { desert: desert.tiers.hard.tasks.map((task) => task.key) });
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
