// Run after `yarn build`: node --test tests/rogue-trader-maintainer.test.cjs
//
// Maintainer review of #2639:
//  1. A player who starts Rogue Trader before finishing Icthlarin's Little Helper is given the Siamun errand (912 = 1) on a later
//     visit once it is done, and can go through Siamun to the finish and the 914 reward. Checked for every gate in the start: only the
//     Siamun errand is gated at the first talk (Aubury's proposal waits for Rune Mysteries at his own talk, not at Ali's).
//  2. A casket's runes in the casket shop are surplus (original amount 0): bought out, they stay out however long the shop restocks.
//  3. Ali's menus, the expand answers and the blackjack and clothes hand-over lines are the generated page's variant
//     standard-dialogue-after-completing-rogue-trader, cut to what the player has unlocked.
//  4. Switching the outfit either way resets 915, so Siamun only offers the next switch after Ali's next report.
// Real packets, real dispatch.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const H = require('./helpers/rogue-trader-replay.cjs');

let core;
before(async () => { core = await H.setup(); });
after(() => H.teardown());

const state = (f) => f.p.getAttribute('rogue-trader:state');
const done = { experience: false, scroll: false, announce: false };
const finishIlh = (f) => H.Quests().questNamed("Icthlarin's Little Helper").complete(f.p, done);
const constant = (t, value) => t.mock.method(Math, 'random', () => value);
function siamunNear(f) {
  core.RegionManager.loadMapFiles(3314, 2785);
  f.p.setLocation(new core.Location(3313, 2785, 0)); f.p.setNeedsPlacement(false);
  const npc = core.NPC.create(4205, new core.Location(3314, 2785, 0));
  core.World.getNpcs().add(npc); npc.setRegistered(true);
  return npc;
}
function backAtAli(f) {
  f.p.setLocation(new core.Location(3303, 3211, 0)); f.p.setNeedsPlacement(false);
}
const give = (f, id, n) => { for (let i = 0; i < n; i++) f.p.getInventory().add(new core.Item(id, 1), true); };

test('1. started before Icthlarin\'s Little Helper, finished after: Ali gives the Siamun errand on the next visit (the reported repro)', async (t) => {
  const f = H.actor(t, { icthlarin: false });
  H.setState(f, { blackjacks: 1, runes: 1 });
  await H.talk(f);
  const before = await H.read(f);
  assert.ok(before.lines.some((l) => l.includes('~Sigh.')), 'without it Ali still sighs');
  assert.equal(state(f).clothes, undefined);
  finishIlh(f);
  f.p.closeInterruptibleInterfaces();
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(lines.some((l) => l.includes('I have an old friend - a cloth merchant Siamun')), lines.join('|'));
  assert.equal(state(f).clothes, 1);
  assert.deepEqual(f.varbits.filter(([id]) => id === 912), [[912, 1]]);
  assert.ok(!lines.some((l) => l.includes('~Sigh.')));
});

test('1. the same on the later-visit menu (Aubury asked, caskets not yet)', async (t) => {
  const f = H.actor(t, { icthlarin: false });
  H.setState(f, { blackjacks: 4, runes: 2, toldAli: 1, cheapflights: 1 });
  finishIlh(f);
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(lines.some((l) => l.includes('I have an old friend - a cloth merchant Siamun')));
  assert.equal(state(f).clothes, 1);
});

test('1. through Siamun to the finish: the errand completes and the reward comes', async (t) => {
  const f = H.actor(t, { icthlarin: false }); const siamun = siamunNear(f);
  H.setState(f, { blackjacks: 4, runes: 2, toldAli: 1 });
  finishIlh(f);
  backAtAli(f);
  await H.talk(f); await H.read(f);
  assert.equal(state(f).clothes, 1);
  give(f, core.ItemIdentifiers.BLUE_DYE, 3);
  f.p.setLocation(new core.Location(3313, 2785, 0)); f.p.setNeedsPlacement(false); // back beside Siamun after Ali
  await H.talkTo(f, siamun); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(state(f).clothes, 3);
  backAtAli(f);
  f.p.closeInterruptibleInterfaces();
  await H.talk(f);
  const { lines } = await H.read(f);
  assert.ok(lines.some((l) => l.includes('selfless help')), 'the finishing talk plays');
  assert.equal(state(f).cheapflights, 1);
});

test('2. a casket shop that is really bought out stays out, and what is left falls back by one every 100 ticks', async (t) => {
  const f = H.actor(t); constant(t, 0.0);
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 100000), true);
  H.setState(f, { clothes: 1, blackjacks: 1, runes: 2, stallvar: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 1); await H.read(f);
  await H.choose(f, 1); await H.read(f); await H.choose(f, 1); await H.read(f);
  core.ShopManager.open.mock.restore(); // the shop opens for real, so it can be bought from
  await H.choose(f, 2); // Find out what the runes are.
  const id = core.ShopManager.activeShopByPlayer.get(f.p);
  const shop = core.ShopManager.shopsById.get(id);
  assert.ok([...shop.originalAmounts.values()].every((n) => n === 0), 'none of the casket\'s runes is original stock');
  const [first, second] = [...shop.stock.keys()];
  const left = shop.stock.get(second);
  assert.ok(left >= 3, 'enough of the second rune to watch it fall');
  const display = core.ShopManager.displayEntries(shop);
  const buy = (itemId, option) => core.ShopManager.handleWidgetAction(f.p, {
    groupId: core.ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option, slot: display.findIndex((e) => e.itemId === itemId) + 1, itemId,
  });
  for (let i = 0; i < 20 && (shop.stock.get(first) ?? 0) > 0; i++) buy(first, 'Buy 50');
  assert.equal(shop.stock.get(first) ?? 0, 0, 'the first rune is bought out');
  for (let tick = 0; tick < 1000; tick++) core.ShopManager.restockShop(shop);
  assert.equal(shop.stock.get(first) ?? 0, 0, 'and stays out');
  assert.equal(shop.stock.get(second) ?? 0, 0, 'what was left fell back to nothing (one every 100 ticks), it did not restock');
});

test('2. the elemental, other-runes, blackjack and clothes shops keep their Wiki base as original stock (they restock to it)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, runes: 5, stallvar: 1, toldAli: 1, garments: 1, cheapflights: 1 });
  const original = () => core.ShopManager.shopsById.get(f.shops.at(-1)).originalAmounts;
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 1); // View blackjacks.
  assert.deepEqual([...original().values()], [25, 25, 25, 25, 25]);
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 2); // View clothes.
  assert.deepEqual([...original().values()], [25, 25, 25, 25, 25, 25, 25, 25]);
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 3); await H.read(f); await H.choose(f, 3); // View runes., Buy elemental runes.
  assert.deepEqual([...original().values()], [20, 20, 20, 20, 3, 3, 3, 3]);
  await H.talk(f, 'Trade'); await H.read(f); await H.choose(f, 3); await H.read(f); await H.choose(f, 4); // Buy other runes.
  assert.deepEqual([...original().values()], [100, 100, 100, 100, 100, 100, 100, 10, 100, 5, 5]);
});

test('3. Ali\'s later visit is the generated page\'s variant, expand answers included', async (t) => {
  const PM = require('../dist/plugins/PluginManager').PluginManager;
  const starts = [];
  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, 'emitCustomEvent', (name, event) => { if (name === 'npc-dialogue:start' && event?.variant) starts.push(event.variant); return emit(name, event); });
  const generated = require('../data/definitions/npc-dialogues.json')['Ali Morrisane'].variants['standard-dialogue-after-completing-rogue-trader'];
  const expand = generated.find((step) => step.type === 'choice').options.find((o) => o.text.includes('expand your business'));
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, runes: 5, stallvar: 1, toldAli: 1, garments: 1, cheapflights: 1 });
  await H.talk(f); await H.read(f);
  assert.deepEqual(starts.at(-1), { page: 'Ali Morrisane', variant: 'standard-dialogue-after-completing-rogue-trader' });
  await H.choose(f, 5);
  const { lines } = await H.read(f);
  for (const step of expand.steps.filter((s) => s.npc)) assert.ok(lines.includes(step.npc.replace(/\s+/g, ' ')), `"${step.npc}" is the page\'s`);
});

test('3. the Captain Dalbur options of the generated page are not offered (nothing tracks the question; fails if aliCondition goes)', async (t) => {
  const f = H.actor(t);
  H.setState(f, { clothes: 3, blackjacks: 4, runes: 5, toldAli: 1, garments: 1, cheapflights: 1 });
  await H.talk(f); await H.read(f); await H.choose(f, 5);
  const { pending } = await H.read(f);
  assert.ok(!pending.options.includes('What will you do about the gnomes?'));
});

test('4. switching back to the Menaphite clothes resets 915 as well: Siamun asks about the sales until Ali\'s next report', async (t) => {
  const f = H.actor(t); const siamun = siamunNear(f);
  H.setState(f, { clothes: 4, blackjacks: 4, runes: 5, garments: 1, toldAli: 1, cheapflights: 1 });
  give(f, core.ItemIdentifiers.BLUE_DYE, 3);
  await H.talkTo(f, siamun); await H.read(f); await H.choose(f, 2); await H.read(f);
  assert.equal(state(f).clothes, 3);
  assert.equal(state(f).garments, 0, '915 -> 0 on this switch too');
  f.p.closeInterruptibleInterfaces();
  await H.talkTo(f, siamun);
  const { lines, pending } = await H.read(f);
  assert.ok(lines.includes('Hello adventurer. Have you checked with Ali M whether my garments are selling or not?'));
  assert.equal(pending, null, 'no offer to switch again');
});

// The condition handler answers Ali's page only. The dialogue runtime asks every plugin; a handler that matches on the text alone also
// answered Gianne jnr.'s "Captain Dalbur:" delivery steps (Gnome Restaurant, npc 2547), which are not ours to answer.
const askCondition = (f, npcId, text) => require('../dist/plugins/PluginManager').PluginManager.emitNpcDialogueCondition({ player: f.p, npc: f.npc, npcId, pages: [], text });

test("3a. the Dalbur condition of Ali's page is answered false for Ali (3533)", async (t) => {
  const f = H.actor(t);
  assert.equal(askCondition(f, 3533, 'If the player has asked Captain Dalbur what he thinks of Ali Morrisane:'), false);
  assert.equal(askCondition(f, 3533, 'If the player has asked Captain Dalbur what he thinks of Ali'), false);
});

test("3b. Gianne jnr.'s Captain Dalbur: delivery step (2547) is not answered by Rogue Trader", async (t) => {
  const f = H.actor(t);
  assert.notEqual(askCondition(f, 2547, 'Captain Dalbur:'), false, 'not forced to false by our handler');
  assert.equal(askCondition(f, 2547, 'Captain Dalbur:'), null, 'and nothing else answers it either');
});


// Keep the completed named page's next-tick stock opening from replacing a newer main.
test('Ali clothing stock deferral preserves a newer native shop', async t => {
  const PM = require('../dist/plugins/PluginManager').PluginManager;
  const {ShopDefinitionLoader} = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
  // Match GameBuilder's boot pair after legacy cleanup and before any new per-player shops.
  assert.equal(new ShopDefinitionLoader().load(),true);
  core.ShopManager.initialize();
  assert.equal(core.ShopDefinition.forId(1221)?.getName(),"Lowe's Archery Emporium");
  assert.equal(core.ShopManager.hasShop(1221),true,'canonical static Lowe runtime is initialized');
  const MAIN = (161 << 16) | 16, CLOTHES = 'I would like to have a look at your selection of clothes.';
  const clean = H.clean, terminalText = 'Hang on a second while I get the garments.';
  for (const mode of ['stationary clothes', 'direct shop', 'newer shop']) await t.test(mode, async child => {
    const f = H.actor(child), p = f.p, sender = p.getPacketSender(), manager = p.getDialogueManager();
    // This existing helper's replay spy cannot prove a real main mount. The same restoration is
    // used above by the casket purchase test; all other helper/startup/legacy checks stay intact.
    assert.equal(typeof core.ShopManager.open.mock?.restore, 'function'); core.ShopManager.open.mock.restore();
    const stores = id => ({ inventory:p.getInventory().getAmount(id), equipment:p.getEquipment().getAmount(id),
      bank:p.getBanks().reduce((n,b,tab) => n + (b && tab !== core.Bank.BANK_SEARCH_TAB_INDEX ? b.getAmount(id) : 0), 0),
      floor:core.World.getItems().filter(g => !g.isPendingRemoval() && g.getOwner() === p.getUsername()
        && g.getPrivateArea() === p.getPrivateArea() && g.getItem().getId() === id).reduce((n,g) => n + g.getItem().getAmount(), 0) });
    const resources = () => ({ coins:stores(core.ItemIdentifiers.COINS), dyes:stores(core.ItemIdentifiers.BLUE_DYE),
      helperRewards:[core.ItemIdentifiers.DESERT_DISGUISE,core.ItemIdentifiers.CATSPEAK_AMULET,core.ItemIdentifiers.AIR_TALISMAN].map(stores),
      experience:core.Skill.values().map(skill => p.getSkillManager().getExperience(skill)) });
    const initial = resources(); assert.deepEqual(initial.coins,{inventory:500,equipment:0,bank:0,floor:0},'The Feud helper completion grants 499 coins plus its generic one-coin reward');
    assert.deepEqual(initial.helperRewards,[1,1,1].map(inventory => ({inventory,equipment:0,bank:0,floor:0})),'retain the helper disguise, catspeak amulet and air talisman');
    assert.equal(Object.values(initial.dyes).reduce((n,v) => n+v,0), 0);
    for (let i=0;i<3;i++) p.getInventory().add(new core.Item(core.ItemIdentifiers.BLUE_DYE,1),false);
    assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BLUE_DYE),3);
    // Saved quest completion still grants its items and invokes XP callbacks; preserve the actual resulting XP snapshot.
    for (const name of ['The Feud', "Icthlarin's Little Helper", 'Rune Mysteries']) assert.equal(H.Quests().questNamed(name).isComplete(p),true);
    assert.equal(Number(state(f)?.clothes)||0,0,'no injected stock unlock');
    await H.talk(f); const first = await H.read(f);
    assert.deepEqual(first.pending?.options,["So what's in this for me?","Ok I'll get on to it."]);
    assert.equal(state(f).clothes,1,'ordinary Ali introduction actually assigns the errand');
    const siamun = siamunNear(f), lowe = core.NPC.create(core.NpcIdentifiers.LOWE,new core.Location(3303,3212,0));
    assert.equal(core.World.getNpcs().add(lowe),true);
    child.after(() => {
      p.closeInterruptibleInterfaces(); PM.emitPlayerDisconnect({player:p,username:p.getUsername()});
      core.TaskManager.cancelTasks(p);
      for (const n of [siamun,lowe]) { n.setRegistered(false); core.World.getNpcs().remove(n); }
      for (const g of core.World.getItems().filter(g => g.getOwner() === p.getUsername())) core.ItemOnGroundManager.deregister(g);
    });
    await H.talkTo(f,siamun); const materials = await H.read(f);
    assert.deepEqual(materials.pending?.options,['What do you mean by animal pelt?',"Ok, I'll get you the materials."]);
    await H.choose(f,materials.pending.options.map(clean).indexOf("Ok, I'll get you the materials.")+1); await H.read(f);
    assert.equal(state(f).clothes,3,'real Siamun hand-in unlocks Menaphite stock');
    assert.deepEqual(resources(),initial,'the declared three dyes were consumed, no fee/output/XP was invented');
    backAtAli(f); await H.talk(f); const visit = await H.read(f);
    assert.equal(state(f).clothes,3); assert.equal(state(f).garments,1);
    assert.deepEqual(visit.pending,{title:'Select an option',options:[CLOTHES,'I would like to have a look at your general stock.','Who did you want me to talk to again?']});
    assert.equal(manager.getOwner(),undefined,'MultiChatboxPrompt resets the native manager');
    const menuOwner = sender.getChatboxOwner(); assert.ok(menuOwner && Object.isFrozen(menuOwner),'explicit named Ali page owns the chatbox');
    const menuMount = sender.subInterfaceTargets.get(219); assert.ok(menuMount); assert.equal(sender.getSubInterfaceAt(menuMount.targetUid),menuMount);
    const steady = resources(), unchanged = () => assert.deepEqual(resources(),steady,'stock viewing preserves all declared stores and every skill XP');
    let turns=0;
    const turn = () => {
      assert.ok(++turns <= 12,'bounded native input/task/movement phases'); p.resetUpdating();
      core.World.processCycle=(core.World.processCycle+1)&0x7fffffff; core.TaskManager.process();
      f.c.processTurnPackets(); const q=p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
      if (q.hasPendingWork()) q.process(); core.TaskManager.processWalkTo(p.getIndex());
    };
    const input = async (...packets) => { await f.c.dispatch(packets); turn(); };
    const trade = () => {
      assert.equal(core.ShopManager.hasShop(1221),true,'static Lowe runtime remains available before the genuine NPC Trade');
      const actions=lowe.getCurrentDefinition(p).getActions(), clickType=actions.indexOf('Trade')+1;
      assert.ok(clickType>0,JSON.stringify({npc:lowe.getId(),actions})); return {type:'npc_option',index:lowe.getIndex(),clickType}; };
    const shop = name => {
      assert.equal(p.getInterfaceId(),300,JSON.stringify({staticShopReady:core.ShopManager.hasShop(1221),npcId:lowe.getContentId(p),npcRegistered:lowe.isRegistered(),npcCurrent:core.World.getNpcs().get(lowe.getIndex())===lowe,playerBusy:p.busy(),movementPending:p.getMovementQueue().hasPendingWork()}));
      assert.equal(core.ShopManager.getOpenShop(p)?.name,name);
      const mount=sender.subInterfaceTargets.get(300); assert.ok(mount); assert.equal(sender.getSubInterfaceAt(MAIN),mount);
      return {mount,id:core.ShopManager.activeShopByPlayer.get(p)};
    };
    if (mode === 'direct shop') {
      await input(trade()); const newer=shop("Lowe's Archery Emporium"); unchanged(); turn();
      assert.equal(sender.getSubInterfaceAt(MAIN),newer.mount); assert.equal(core.ShopManager.activeShopByPlayer.get(p),newer.id); unchanged(); return;
    }
    await input({type:'dialogue_continue',widgetId:H.MultiChatboxPrompt.OPTIONS_WIDGET_ID,childIndex:visit.pending.options.map(clean).indexOf(CLOTHES)+1});
    const current=manager.getCurrent(), group=sender.getChatboxGroupId();
    assert.ok(current instanceof core.NpcDialogue,JSON.stringify({type:current?.constructor?.name,text:current?.getText?.(),group}));
    assert.equal(group,231); assert.equal(clean(current.getText()),terminalText);
    assert.equal(manager.getOwner(),menuOwner); assert.equal(sender.getChatboxOwner(),menuOwner);
    const terminalMount=sender.subInterfaceTargets.get(group); assert.ok(terminalMount); assert.equal(sender.getSubInterfaceAt(terminalMount.targetUid),terminalMount);
    assert.equal(p.getInterfaceId(),-1); unchanged();
    const queued=[],actions=[],submit=core.TaskManager.submit.bind(core.TaskManager),emit=PM.emitCustomEvent.bind(PM); let inStockAction=false;
    child.mock.method(PM,'emitCustomEvent',(name,event) => {
      if (name!=='npc-dialogue:action' || event?.npcId!==3533 || event?.stepId!=='ckDN2A') return emit(name,event);
      inStockAction=true;
      try { return emit(name,event); }
      finally { inStockAction=false; actions.push({npc:event.npc,action:event.action,target:event.target,handled:event.handled,end:event.end}); }
    });
    child.mock.method(core.TaskManager,'submit',task => { if(inStockAction) queued.push(task); return submit(task); });
    // Both genuine packets drain in this player's input phase before the next global task phase.
    await input({type:'dialogue_continue',widgetId:(group<<16)|5,childIndex:-1},...(mode==='newer shop'?[trade()]:[]));
    assert.equal(actions.length,1); assert.equal(actions[0].npc,f.npc); assert.equal(actions[0].action,'open_interface');
    assert.ok(actions[0].target.startsWith("Ali's Discount Wares.#Clothing")); assert.equal(actions[0].handled,true); assert.equal(actions[0].end,true);
    assert.equal(queued.length,1,'the actual stock action produces exactly one deferred task');
    assert.equal(queued[0].key,core.Task.DEFAULT_KEY,'null constructor key resolves to canonical DEFAULT_KEY');
    assert.equal(queued[0].pluginName,'RogueTrader'); assert.equal(queued[0].getDelay(),1); assert.equal(queued[0].isImmediate(),false); assert.equal(queued[0].isRunning(),true);
    assert.equal(p.isRegistered(),true); assert.equal(manager.isActive(),false); unchanged();
    if (mode==='stationary clothes') {
      assert.equal(core.ShopManager.getOpenShop(p),null); turn(); assert.equal(queued[0].isStopped(),true);
      const opened=shop("Ali's Discount wares."); assert.equal(opened.id,700000+p.getIndex()*8+4); assert.equal(state(f).stallvar,5); unchanged(); return;
    }
    const newer=shop("Lowe's Archery Emporium"); assert.equal(queued[0].isRunning(),true); unchanged(); turn();
    assert.equal(queued[0].isStopped(),true,'the old callback phase actually executed');
    const diagnostic=JSON.stringify({interface:p.getInterfaceId(),activeShop:core.ShopManager.activeShopByPlayer.get(p),shop:core.ShopManager.getOpenShop(p)?.name,resources:resources()});
    // First behavior target; same group300 alone cannot distinguish the two shop lifetimes.
    assert.equal(sender.getSubInterfaceAt(MAIN),newer.mount,'newer native shop mount must survive: '+diagnostic);
    assert.equal(core.ShopManager.activeShopByPlayer.get(p),newer.id); assert.equal(core.ShopManager.getOpenShop(p)?.name,"Lowe's Archery Emporium");
    assert.equal(p.getInterfaceId(),300); unchanged();
  });
});
