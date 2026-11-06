// Run after `yarn build`: node --test tests/quest-activity-pet-sources.test.cjs
// Quest and activity pet sources on a real Player and Inventory: the Bloodhound from a master
// casket, Felkrash's wily cats, the wily/lazy cycle and a grown cat's hellcat.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const BLOODHOUND = 19730;
const MASTER_CASKET = require("../data/definitions/clue-caskets.json").tables.master.casket_item_id;
const events = new Map();
const emitted = [];
// The world registers an added NPC, as World.getNpcs().add does in game.
const worldNpcs = Object.assign([], { add: (npc) => { npc.setRegistered?.(true); return true; }, get: () => null });
const addQueue = [];
const removeQueue = [];
const world = { sendMessage() {}, getNpcs: () => worldNpcs, getAddNPCQueue: () => addQueue, getRemoveNPCQueue: () => removeQueue };
let core, Pets, Caskets, fixtures = 0;
const syntheticPlayers = [], syntheticTasks = [], syntheticLogoutHooks = [];
let originalSubmit;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    getWorld: () => world,
    getRegionManager: () => ({ blocked: () => true, canMovestart: () => true }),
    getItemOnGroundManager: () => ({ registerNonGlobal() {}, registerLocation() {} }),
    onPlayerLogout: handler => { syntheticLogoutHooks.push(handler); },
    onCustomEvent: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
    emitCustomEvent: (name, request) => {
      emitted.push([name, request]);
      for (const handler of events.get(name) ?? []) handler(request);
    },
  }, { get: (target, name) => target[name] ?? (() => {}) });
  Pets = require("../plugins/npcs/Pets.plugin");
  Pets.register(api);
  require("../plugins/treasuretrails/TreasureTrails.plugin").register(api);
  // ClueCapacity owns the scroll-case milestones; none fall on these completions.
  api.onCustomEvent("treasure-trails:milestone-rewards", (request) => { request.handled = true; });
  Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
});

const realRandom = Math.random;
beforeEach(() => {
  originalSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function(task) {
    if (syntheticPlayers.length) syntheticTasks.push(task);
    return originalSubmit.call(this, task);
  };
  Math.random = realRandom;
  emitted.length = 0;
  worldNpcs.length = 0;
  addQueue.length = 0;
  removeQueue.length = 0;
});

afterEach(() => {
  try {
    for (const player of syntheticPlayers.splice(0)) {
      for (const handler of syntheticLogoutHooks) handler({ player, username: player.getUsername() });
    }
    assert.equal(syntheticTasks.some(task => task.isRunning()), false, "synthetic fixture tasks are stopped");
  } finally {
    syntheticTasks.length = 0;
    core.TaskManager.submit = originalSubmit;
    Math.random = realRandom;
  }
});

function realPlayer({ follower = null } = {}) {
  const player = new Player(null);
  syntheticPlayers.push(player);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.setUsername(`pet-sources-${++fixtures}`);
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  player.setLocation(new core.Location(3222, 3218, 0));
  if (follower) player.setAttribute("pets:current", follower);
  return { player, messages, inventory: player.getInventory() };
}

/** Someone else's follower: the slot is taken, so a new pet goes to the backpack. */
const OTHER_FOLLOWER = { isRegistered: () => true, getId: () => -1 };

function catNpc(player, npcId) {
  return {
    id: npcId,
    isRegistered: () => true,
    isPet: () => true,
    getId() { return this.id; },
    getIndex: () => 7,
    getOwner: () => player,
    getLocation: () => new core.Location(3222, 3219, 0),
    getDefinition: () => ({ getName: () => "cat" }),
  };
}

function follow(player, npcId) {
  const npc = catNpc(player, npcId);
  player.setAttribute("pets:current", npc);
  Pets.__internals.trackCatFollower(player, npc, Pets.__internals.PET_BY_ID.get(npcId));
  return npc;
}

function vermin(name) {
  const npc = { isRegistered: () => true, getLocation: () => new core.Location(3223, 3219, 0), getDefinition: () => ({ getName: () => name }) };
  worldNpcs.length = 0;
  worldNpcs.push(npc);
  return npc;
}

/** One successful catch by the current follower. */
function catchOne(player, name) {
  vermin(name);
  const npc = player.getAttribute("pets:current");
  Math.random = () => 0;
  try {
    assert.equal(Pets.__internals.chaseVermin(player, npc, Pets.__internals.PET_BY_ID.get(npc.getId())), true);
  } finally {
    Math.random = realRandom;
  }
}

function emit(name, request) {
  for (const handler of events.get(name) ?? []) handler(request);
  return request;
}

function openMasterCasket(player, random) {
  player.getInventory().setItem(0, new core.Item(MASTER_CASKET, 1));
  Math.random = random;
  try {
    const event = { player, slot: 0, item: player.getInventory().getItems()[0], itemId: MASTER_CASKET };
    assert.equal(Caskets.open(event), true);
    assert.equal(event.error, undefined);
  } finally {
    Math.random = realRandom;
  }
}

test("a master casket's Bloodhound joins the backpack through the pet path, not the reward screen", () => {
  const { player, messages, inventory } = realPlayer({ follower: OTHER_FOLLOWER });
  openMasterCasket(player, () => 0);
  assert.equal(inventory.getAmount(BLOODHOUND), 1, "one Bloodhound");
  assert.ok(messages.includes("You feel something weird sneaking into your backpack."));
  assert.ok(Pets.__internals.getOwnedPetItems(player).includes(BLOODHOUND), "insured for Probita");
  const awards = emitted.filter(([name, request]) => name === "pets:award" && request.itemId === BLOODHOUND);
  assert.equal(awards.length, 1);
  assert.equal(awards[0][1].source, "treasure-trails:casket");
  assert.equal(awards[0][1].awarded, true);
  const logged = emitted.filter(([name, request]) => name === "collection-log:obtain" && request.itemId === BLOODHOUND);
  assert.equal(logged.length, 1, "logged once, by the pet record");
  assert.ok(messages.some((text) => text.startsWith("Well done, you've completed")), "the casket itself still opened");
});

test("a Bloodhound rolled with a follower out and a full backpack goes to Probita", () => {
  const { player, messages, inventory } = realPlayer({ follower: OTHER_FOLLOWER });
  inventory.add(new core.Item(core.ItemIdentifiers.SPADE, 27), false);
  openMasterCasket(player, () => 0);
  assert.equal(inventory.getAmount(BLOODHOUND), 0);
  assert.ok(Pets.__internals.getOwnedPetItems(player).includes(BLOODHOUND));
  assert.ok(messages.some((text) => text.includes("Probita can help")));
});

test("an owned Bloodhound is a would-have-been-followed miss and a casket without the roll awards none", () => {
  const { player, messages, inventory } = realPlayer({ follower: OTHER_FOLLOWER });
  player.setAttribute("pets.owned", [BLOODHOUND]);
  openMasterCasket(player, () => 0);
  assert.equal(inventory.getAmount(BLOODHOUND), 0);
  assert.ok(messages.includes("You have a funny feeling like you would have been followed..."));

  const second = realPlayer({ follower: OTHER_FOLLOWER });
  openMasterCasket(second.player, () => 0.5);
  assert.equal(second.inventory.getAmount(BLOODHOUND), 0);
  assert.equal(emitted.filter(([name]) => name === "pets:award").length, 1, "only the first player's roll");
});

test("Felkrash trains a carried overgrown cat into a wily cat of its colour, one at a time", () => {
  const { player, inventory } = realPlayer();
  const I = core.ItemIdentifiers;
  inventory.add(new core.Item(1568, 1), false); // overgrown cat, white
  assert.deepEqual(pick(emit("pets:wily-cat-status", { player, overgrown: false, wily: false })), { overgrown: true, wily: false });

  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, true);
  assert.equal(inventory.getAmount(1568), 0);
  assert.equal(inventory.getAmount(I.WILY_CAT), 1, "white wily cat 6555");
  assert.deepEqual(pick(emit("pets:wily-cat-status", { player, overgrown: false, wily: false })), { overgrown: false, wily: true });

  inventory.add(new core.Item(1567, 1), false);
  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, false, "a wily cat already owned");
  assert.equal(inventory.getAmount(1567), 1);
  assert.equal(inventory.getAmount(I.WILY_CAT_2), 0);
});

test("an overgrown hellcat follower becomes a wily hellcat in place", () => {
  const { player } = realPlayer();
  follow(player, 5604);
  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, true);
  assert.equal(player.getAttribute("pets:current").getId(), core.NpcIdentifiers.WILY_HELLCAT);
  assert.equal(player.getAttribute("pets:last"), core.ItemIdentifiers.WILY_HELLCAT);
  assert.equal(player.getAttribute("pets:cat").stage, "wily_hellcat");
});

test("a wily cat turns lazy, and about fifteen rats retrain it a few minutes later", () => {
  const { player } = realPlayer();
  const N = core.NpcIdentifiers;
  follow(player, N.WILY_CAT); // white
  const state = player.getAttribute("pets:cat");
  assert.equal(state.stage, "wily");
  state.lazyIn = 2;
  assert.equal(Pets.__internals.catTick(player), true);
  assert.equal(player.getAttribute("pets:current").getId(), N.WILY_CAT, "still wily after one tick");
  assert.equal(Pets.__internals.catTick(player), true);
  assert.equal(player.getAttribute("pets:current").getId(), N.LAZY_CAT, "white lazy cat 1626");
  assert.equal(player.getAttribute("pets:cat").stage, "lazy");

  for (let i = 0; i < 14; i++) catchOne(player, "Rat");
  assert.ok(!(player.getAttribute("pets:cat").wilyIn > 0), "fourteen rats are not enough");
  catchOne(player, "Hell-Rat"); // hell-rats count too (Wiki "Lazy cat")
  const waiting = player.getAttribute("pets:cat");
  assert.ok(waiting.wilyIn - waiting.growth >= 4 && waiting.wilyIn - waiting.growth <= 6);
  while (player.getAttribute("pets:cat").stage === "lazy") assert.equal(Pets.__internals.catTick(player), true);
  assert.equal(player.getAttribute("pets:current").getId(), N.WILY_CAT);
  assert.equal(player.getAttribute("pets:last"), core.ItemIdentifiers.WILY_CAT);
});

test("an adult cat becomes a hellcat on its seventh hell-rat, keeps its age, and milk turns it back", () => {
  const { player, messages, inventory } = realPlayer();
  follow(player, 1620); // adult cat, white
  player.getAttribute("pets:cat").growth = 230;
  for (let i = 0; i < 6; i++) catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 1620, "six are not enough");
  catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 1625, "hellcat");
  const state = player.getAttribute("pets:cat");
  assert.equal(state.stage, "hellcat");
  assert.equal(state.growth, 230, "a cat that turns hell continues to age (Wiki, Mod Ash)");
  assert.equal(state.colour, 1);
  assert.equal(messages.at(-1), "Your cat catches the hell-rat and turns into a hellcat.");

  inventory.add(new core.Item(core.ItemIdentifiers.BUCKET_OF_MILK, 1), false);
  Pets.__internals.handleItemOnCat({ player, target: player.getAttribute("pets:current"), itemId: core.ItemIdentifiers.BUCKET_OF_MILK });
  assert.equal(player.getAttribute("pets:current").getId(), 1620, "back to the white adult cat");
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BUCKET), 1);
});

test("an overgrown cat never turns hell from hell-rats", () => {
  const { player } = realPlayer();
  follow(player, 5599); // overgrown cat, white
  for (let i = 0; i < 7; i++) catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 5599);
  assert.equal(player.getAttribute("pets:cat").stage, "overgrown");
});

test("a lazy cat that turns hell keeps its retraining progress", () => {
  const { player } = realPlayer();
  const N = core.NpcIdentifiers;
  follow(player, N.LAZY_CAT); // white
  for (let i = 0; i < 6; i++) catchOne(player, "Rat");
  for (let i = 0; i < 7; i++) catchOne(player, "Hell-Rat");
  const state = player.getAttribute("pets:cat");
  assert.equal(player.getAttribute("pets:current").getId(), N.LAZY_HELLCAT);
  assert.equal(state.stage, "lazy_hellcat");
  assert.equal(state.lazyRats, 13, "every catch, hell-rats included, still counts toward retraining");
});

test("Felkrash training a carried overgrown hellcat keeps its colour for the wily hellcat", () => {
  const { player, inventory } = realPlayer();
  player.setAttribute("pets:cat", { stage: "overgrown_hellcat", colour: 1, growth: 0, hungerAt: 0, attentionAt: 0 });
  inventory.add(new core.Item(core.ItemIdentifiers.OVERGROWN_HELLCAT, 1), false);
  assert.equal(emit("pets:train-wily-cat", { player, trained: false }).trained, true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.WILY_HELLCAT), 1);
  assert.equal(player.getAttribute("pets:cat").stage, "wily_hellcat");

  // Summoned and given milk, it is the white wily cat, not the default colour.
  const npc = follow(player, core.NpcIdentifiers.WILY_HELLCAT);
  assert.equal(player.getAttribute("pets:cat").colour, 1);
  inventory.add(new core.Item(core.ItemIdentifiers.BUCKET_OF_MILK, 1), false);
  Pets.__internals.handleItemOnCat({ player, target: npc, itemId: core.ItemIdentifiers.BUCKET_OF_MILK });
  assert.equal(player.getAttribute("pets:current").getId(), core.NpcIdentifiers.WILY_CAT, "white wily cat 5584");
});

test("a cat does not turn while the player already has a hellcat outside the menagerie", () => {
  const { player, inventory } = realPlayer();
  inventory.add(new core.Item(7582, 1), false); // a hellcat carried
  follow(player, 1620); // adult cat, white
  for (let i = 0; i < 7; i++) catchOne(player, "Hell-Rat");
  assert.equal(player.getAttribute("pets:current").getId(), 1620);
  assert.equal(player.getAttribute("pets:cat").stage, "cat");
});

function pick({ overgrown, wily }) {
  return { overgrown, wily };
}

// UNEXECUTED DRAFT: append to server/tests/quest-activity-pet-sources.test.cjs.
// That file already registers Pets with a synthetic API; this final case rebinds
// Pets to the real API only after those cases. QuestRuntime has not been loaded
// or stubbed by its preceding tests, so its first registration is real.
const runtime = require('../plugins/quests/QuestRuntime');
const { Player: NativePlayer } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession: NativeSession } = require('../dist/net/PlayerSession');
const { ClientConnection: NativeConnection } = require('../dist/net/NetworkBuilder');
const { NpcDefinitionLoader: NativeNpcLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { MultiChatboxPrompt: NativePrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { PlayerSave: NativePlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
let nativeRatcatchers, felkrash, nativeIndex = 1800;

test('native Felkrash training control reaches naming interface after quest completion', async (t) => {
  // Register only the three needed plugins; no directory load, startup, or bots.
  // A single test owns these registrations and all mutable world objects.
  assert.equal(PluginManager.loadedPlugins.includes('PlayerBots'), false, 'bots are off in this selectively registered fixture');
  const previousCycle = core.World.processCycle;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  new NativeNpcLoader().load();
  require('../plugins/npcs/Pets.plugin').register(PluginManager.createApi('FelkrashPetsNative'));
  require('../plugins/npcs/NpcDialogues.plugin').register(PluginManager.createApi('FelkrashDialoguesNative'));
  require('../plugins/quests/quests/Ratcatchers.Quest')(PluginManager.createApi('FelkrashQuestNative'));
  const lines = [];
  PluginManager.createApi('FelkrashLineObserver').onCustomEvent('npc-dialogue:line', e => {
    if (e.npcId === core.NpcIdentifiers.FELKRASH) lines.push({
      text:e.text, speakerId:e.speakerId, speakerName:e.speakerName, speaker:e.step?.speaker,
    });
  });
  nativeRatcatchers = runtime.getRegisteredQuests().findLast(q => q.key === 'ratcatchers');
  assert.ok(nativeRatcatchers, 'production Ratcatchers quest registered');
  const channel = { kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true, send:()=>true,
    close(){}, onData(){}, onError(){}, onClose(){} };
  const p = new NativePlayer(new NativeSession(channel));
  p.setIndex(nativeIndex++); p.setUsername('felkrash-native'); p.setRegistered(true);
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.setNeedsPlacement(false);
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.CATSPEAK_AMULET));
  const c = new NativeConnection(channel); c.player = p;
  const sender = p.getPacketSender(), namingWrites = [];
  const originalSendString = sender.sendString;
  t.mock.method(sender, 'sendString', function(value, id) {
    if ((id >>> 16) === 61) namingWrites.push({value, child:id & 0xffff});
    return originalSendString.call(this, value, id);
  });
  felkrash = new core.NPC(core.NpcIdentifiers.FELKRASH, new core.Location(3223, 3218, 0));
  assert.equal(core.World.getNpcs().add(felkrash, true), true, 'Felkrash registered');
  assert.equal(felkrash.isRegistered(), true, 'NPC is registered for actual option dispatch');
  const originalTasks = new Set([...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks]);
  const ownedTasks = new Set();
  function recordTasks() {
    for (const task of [...core.TaskManager.pendingTasks.toArray(), ...core.TaskManager.activeTasks]) {
      if (!originalTasks.has(task)) ownedTasks.add(task);
    }
  }
  t.after(() => {
    p.getPacketSender().sendInterfaceRemoval();
    PluginManager.emitPlayerLogout({player:p, username:p.getUsername()});
    p.setRegistered(false); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n === felkrash || n?.getOwner?.() === p) core.World.getNpcs().remove(n);
    for (const queue of [core.World.getAddNPCQueue(), core.World.getRemoveNPCQueue()]) {
      for (let i=queue.length-1; i>=0; i--) if (queue[i] === felkrash || queue[i]?.getOwner?.() === p) queue.splice(i,1);
    }
    channel.close(); core.World.processCycle = previousCycle;
    assert.equal([...core.World.getNpcs()].some(n => n === felkrash || n?.getOwner?.() === p), false, 'owned NPCs removed');
    assert.equal([...ownedTasks].some(task => task.isRunning()), false, 'fixture tasks stopped');
  });
  function tick() {
    core.World.processCycle++;
    core.TaskManager.process();
    c.processTurnPackets();
    p.getMovementQueue().process(); core.TaskManager.processWalkTo(p.getIndex());
    for (const n of core.World.getNpcs()) n.process();
    core.World.updateLocalNpcs(p, [...core.World.getNpcs()]);
    p.getSession().flushClient(core.World.processCycle);
    p.resetUpdating(); for (const n of core.World.getNpcs()) n.resetUpdating();
    recordTasks();
  }
  async function send(packet) { await c.dispatch([packet]); tick(); }
  async function next() {
    const group = p.getPacketSender().getChatboxGroupId();
    await send({type:'dialogue_continue', widgetId:(group << 16) | (group === 229 ? 4 : 5), childIndex:-1});
  }
  nativeRatcatchers.setStage(p, 22);
  assert.equal(nativeRatcatchers.isComplete(p), true, 'quest completion precondition');
  const completeRequest = {player:p, key:'ratcatchers', complete:null};
  PluginManager.emitCustomEvent('quest:is-complete', completeRequest);
  assert.equal(completeRequest.complete, true, 'native quest query is registered and sees completion');
  const item = core.ItemIdentifiers.PET_CAT_7; // 1567: first overgrown colour in Pets CAT_STAGES.
  assert.ok(Number.isInteger(item), 'cache identifier for overgrown cat');
  p.getInventory().add(new core.Item(item), true);
  const slot = p.getInventory().getSlotForItemId(item);
  assert.ok(slot >= 0, 'real inventory contains an overgrown cat');
  await send({type:'inventory_action', itemId:item, slot, widgetId:149 << 16, option:'Drop', optionIndex:5});
  const cat = p.getAttribute('pets:current');
  assert.ok(cat?.isRegistered() && cat.getOwner() === p, 'real pet drop created owned follower');
  assert.equal(p.getInventory().getAmount(item), 0, 'cat item became follower');
  const option = felkrash.getCurrentDefinition(p).getActions().indexOf('Talk-to') + 1;
  assert.ok(option > 0, 'cache supplies Talk-to');
  await send({type:'npc_option', index:felkrash.getIndex(), clickType:option});
  for (let i=0; i<12; i++) tick();
  const menu = NativePrompt.getPending(p);
  assert.ok(menu, 'real NPC talk reaches post-quest menu');
  const choice = menu.options.indexOf('Can you train my cat for me?');
  assert.ok(choice >= 0, 'training option is offered');
  await send({type:'dialogue_continue', widgetId:NativePrompt.OPTIONS_WIDGET_ID, childIndex:choice + 1});
  for (let i=0; i<25 && p.getAttribute('pets:current')?.getId() !== core.NpcIdentifiers.WILY_CAT_2; i++) {
    assert.ok(p.getDialogueManager().isActive(), 'training dialogue remains active');
    await next();
  }
  assert.equal(p.getAttribute('pets:current')?.getId(), core.NpcIdentifiers.WILY_CAT_2,
    'existing Felkrash training actually produced a wily follower');
  assert.equal(p.getAttribute('pets:current')?.getOwner(), p, 'trained cat remains owned');
  for (let i=0; i<25 && p.getDialogueManager().isActive() && p.getInterfaceId() !== 61; i++) await next();
  assert.equal(p.getInterfaceId(), 61, 'Felkrash opens the native cat naming interface');
  assert.equal(lines.some(line => /finally got around to naming|Sorry I took so long/i.test(line.text)), false,
    'the post-enter conversation has not run before enter');
  await send({type:'widget_action', widgetId:(61 << 16) | 18, groupId:61, childId:18, buttonNum:1});
  assert.equal(p.getInterfaceId(), 61, 'editing a letter leaves the naming interface open');
  await send({type:'widget_action', widgetId:(61 << 16) | 32, groupId:61, childId:32, buttonNum:1});
  assert.notEqual(p.getInterfaceId(), 61, 'enter closes the naming interface');
  assert.equal(p.getAttribute('ratcatchers:cat-name'), 'BAAAAA', 'the chosen shared name is saved');
  const spokenCat = lines.find(line => /finally got around to naming/i.test(line.text));
  assert.ok(spokenCat, 'catspeak continuation is shown after enter');
  assert.equal(spokenCat.speakerId, p.getAttribute('pets:current').getId(), 'real cat supplies the dialogue head');
  assert.ok(spokenCat.speakerName, 'cat dialogue has an explicit speaker');
  const reply = p.getDialogueManager().getCurrent();
  assert.ok(reply, 'confirmed cat reply is active');
  const replyOwner = p.getDialogueManager().getOwner();
  assert.ok(replyOwner, 'confirmed reply has an explicit playback owner');
  await send({type:'widget_action', widgetId:(61 << 16) | 32, groupId:61, childId:32, buttonNum:1});
  assert.equal(p.getDialogueManager().getCurrent(), reply, 'duplicate enter cannot close the active cat reply');
  await next();
  assert.match(p.getDialogueManager().getCurrent()?.getText?.() ?? '', /Sorry I took so long, BAAAAA/i,
    'player dialogue actually presents the selected name');
  assert.equal(sender.getChatboxGroupId(), 217, 'normal cat-to-player transition mounts player dialogue');
  assert.equal(p.getDialogueManager().getOwner(), replyOwner, 'normal transition retains named playback owner');
  assert.equal(sender.getChatboxOwner(), replyOwner, 'normal transition retains actual chatbox owner');
  const restored = new NativePlayer(new NativeSession({...channel}));
  let restoredCleaned = false;
  function cleanupRestored() {
    if (restoredCleaned) return;
    restoredCleaned = true;
    recordTasks();
    PluginManager.emitPlayerLogout({player:restored, username:restored.getUsername()});
    restored.setRegistered(false); core.TaskManager.cancelTasks(restored); core.TaskManager.cancelTasks(restored.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === restored) core.World.getNpcs().remove(n);
    for (const queue of [core.World.getAddNPCQueue(), core.World.getRemoveNPCQueue()]) {
      for (let i=queue.length-1; i>=0; i--) if (queue[i]?.getOwner?.() === restored) queue.splice(i,1);
    }
  }
  t.after(cleanupRestored);
  restored.setIndex(nativeIndex++); restored.setUsername('felkrash-reloaded'); restored.setRegistered(true);
  NativePlayerSave.fromPlayer(p).applyToPlayer(restored);
  assert.equal(restored.getAttribute('ratcatchers:cat-name'), 'BAAAAA', 'real player save roundtrip retains the shared name');
  restored.setAttribute('bot-skip-persistence', true);
  PluginManager.emitPlayerLogin({player:restored, username:restored.getUsername(), isNewAccount:false});
  assert.equal(restored.getAttribute('ratcatchers:cat-name'), 'BAAAAA', 'production login hooks retain the saved name');
  cleanupRestored();

  async function openRename() {
    p.getPacketSender().sendInterfaceRemoval();
    await send({type:'npc_option', index:felkrash.getIndex(), clickType:option});
    for (let i=0; i<12; i++) tick();
    const menu = NativePrompt.getPending(p);
    assert.ok(menu, 'Felkrash post-quest menu opens for rename');
    const choice = menu.options.indexOf('Can you rename my cat?');
    assert.ok(choice >= 0, 'rename option offered');
    await send({type:'dialogue_continue', widgetId:NativePrompt.OPTIONS_WIDGET_ID, childIndex:choice + 1});
    for (let i=0; i<25 && p.getDialogueManager().isActive() && p.getInterfaceId() !== 61; i++) await next();
    assert.equal(p.getInterfaceId(), 61, 'rename opens native interface');
  }
  const enter = {type:'widget_action', widgetId:(61 << 16) | 32, groupId:61, childId:32, buttonNum:1};
  const arrow = {type:'widget_action', widgetId:(61 << 16) | 18, groupId:61, childId:18, buttonNum:1};
  const button = child => ({type:'widget_action', widgetId:(61 << 16) | child, groupId:61, childId:child, buttonNum:1});
  await openRename();
  for (const child of [20, 22, 24, 26]) await send(button(child));
  await send(button(27));
  assert.deepEqual(namingWrites.at(-1), {value:'B', child:15}, 'final right arrow increments sixth letter');
  await send(button(28));
  assert.deepEqual(namingWrites.at(-1), {value:'A', child:15}, 'final left arrow decrements sixth letter');
  await send(button(17)); await send(button(17));
  await send(enter);
  let sharedName = ' BBBBA';
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName,
    'all six columns, the reversed final arrows and a space edit the shared name');
  await openRename();
  await send(arrow);
  assert.deepEqual(namingWrites.at(-1), {value:'A', child:10}, 'space cycles to A under TSPS UI policy');
  for (let i=0; i<25; i++) await send(arrow);
  assert.deepEqual(namingWrites.at(-1), {value:'Z', child:10}, 'alphabet reaches Z');
  await send(arrow);
  assert.deepEqual(namingWrites.at(-1), {value:' ', child:10}, 'Z cycles to space under TSPS UI policy');
  await send(arrow);
  assert.deepEqual(namingWrites.at(-1), {value:'A', child:10}, 'space cycles back to A');
  await send({type:'interface_close'});
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'unconfirmed alphabet edits are discarded');
  await openRename();
  await send(arrow);
  const priorFollower = p.getAttribute('pets:current');
  const catState = p.getAttribute('pets:cat');
  catState.lazyIn = (Number(catState.growth) || 0) + 1;
  assert.equal(Pets.__internals.catTick(p), true, 'real cat lifecycle producer runs');
  assert.notEqual(p.getAttribute('pets:current'), priorFollower, 'wily-to-lazy stage replaced the follower');
  assert.equal(p.getAttribute('pets:current')?.getId(), core.NpcIdentifiers.LAZY_CAT_2, 'replacement is the lazy form');
  assert.equal(p.getInterfaceId(), 61, 'naming remains open while the follower changes');
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'changed candidate cannot commit a pending edit');
  assert.notEqual(p.getInterfaceId(), 61, 'invalidated owned naming mount closes safely');
  await openRename();
  await send(arrow);
  await send({type:'interface_close'});
  assert.notEqual(p.getInterfaceId(), 61, 'IF_CLOSE cancels the pending edit');
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'cancel does not save edits');
  const replacement = {player:p, npc:felkrash, npcId:core.NpcIdentifiers.FELKRASH,
    variant:{page:'Felkrash',variant:'standard-dialogue-after-ratcatchers'}, exact:true,
    select:() => [{npc:'Unrelated replacement dialogue.'}], handled:false};
  PluginManager.emitCustomEvent('npc-dialogue:start', replacement);
  assert.equal(replacement.handled, true, 'replacement uses the native dialogue player');
  const unrelated = p.getDialogueManager().getCurrent();
  assert.ok(unrelated, 'replacement dialogue is active');
  await send(enter);
  assert.equal(p.getDialogueManager().getCurrent(), unrelated, 'stale enter leaves unrelated dialogue intact');
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'stale enter cannot save');

  await openRename();
  const beforeWrong = namingWrites.length;
  await send({...arrow, buttonNum:2});
  assert.equal(p.getInterfaceId(), 61, 'wrong operation cannot close the naming interface');
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'wrong operation cannot save');
  assert.equal(namingWrites.length, beforeWrong, 'wrong operation does not change any displayed letter');
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'confirm after wrong operation retains the original name');
  await openRename();
  await send(arrow);
  p.getPacketSender().sendInterface(324);
  await send(enter);
  assert.equal(p.getInterfaceId(), 324, 'stale enter cannot close a replacement modal');
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'replacement modal blocks stale save');

  await openRename();
  await send(enter);
  const previousGroup = p.getPacketSender().getChatboxGroupId();
  assert.ok(p.getDialogueManager().isActive(), 'new name starts the native cat reply');
  p.getPacketSender().sendChatboxInterface(previousGroup); // unrelated, unowned same-group replacement
  await next();
  assert.equal(p.getDialogueManager().isActive(), false, 'prebuilt named continuation is cancelled after replacement');
  assert.equal(p.getPacketSender().getChatboxGroupId(), previousGroup, 'replacement chatbox remains open');

  await openRename();
  const movementPacket = {type:'movement_input', seq:1, dx:0, dy:0, rotation:0, duration:1, active:false, running:false};
  await send(movementPacket);
  assert.equal(p.getInterfaceId(), 61, 'inactive continuous-input heartbeat preserves naming');
  await send(arrow);
  await send({...movementPacket, seq:2, dx:1, active:true});
  assert.notEqual(p.getInterfaceId(), 61, 'active continuous-input movement cancels naming');
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'continuous movement leaves no stale commit');

  await openRename();
  await send(arrow);
  await send({type:'move', worldX:3224, worldY:3218, modifierFlags:0});
  assert.notEqual(p.getInterfaceId(), 61, 'a normal walk cancels naming');
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'walked-away stale enter cannot save');

  p.getMovementQueue().reset(); p.setLocation(new core.Location(3222, 3218, 0)); p.setNeedsPlacement(false); tick();
  await openRename();
  await send(arrow);
  const oldArea = p.getArea(), privateRoom = new core.PrivateArea([]);
  let inPrivateRoom = false;
  function restoreArea() {
    if (!inPrivateRoom) return;
    inPrivateRoom = false; privateRoom.remove(p); p.setArea(oldArea);
  }
  t.after(restoreArea);
  privateRoom.add(p); inPrivateRoom = true;
  assert.equal(p.getPrivateArea(), privateRoom, 'actual private-area membership changed');
  await c.dispatch([enter]); c.processTurnPackets();
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'private-area change prevents stale commit');
  restoreArea(); p.getPacketSender().sendInterfaceRemoval(); tick();

  async function replaceFollower(itemId, npcId) {
    p.getPacketSender().sendInterfaceRemoval();
    const old = p.getAttribute('pets:current');
    const oldItem = Pets.__internals.PET_BY_ID.get(old.getId()).itemId;
    const pick = old.getCurrentDefinition(p).getActions().indexOf('Pick-up') + 1;
    assert.ok(pick > 0, 'current cat supports native pickup');
    await send({type:'npc_option', index:old.getIndex(), clickType:pick});
    for (let i=0; i<12 && p.getAttribute('pets:current'); i++) tick();
    assert.equal(p.getAttribute('pets:current'), null, 'old follower was actually picked up');
    p.getInventory().deleteNumber(oldItem, 1);
    p.getInventory().add(new core.Item(itemId), true);
    const slot = p.getInventory().getSlotForItemId(itemId);
    assert.ok(slot >= 0, 'replacement cat is carried');
    await send({type:'inventory_action', itemId, slot, widgetId:149 << 16, option:'Drop', optionIndex:5});
    for (let i=0; i<4; i++) tick();
    assert.equal(p.getAttribute('pets:current')?.getId(), npcId, 'native drop creates the expected cat form');
    assert.equal(p.getAttribute('pets:current')?.getOwner(), p, 'replacement follower is owned');
  }
  for (const [itemId, npcId] of [
    [core.ItemIdentifiers.WILY_HELLCAT, core.NpcIdentifiers.WILY_HELLCAT],
    [core.ItemIdentifiers.LAZY_CAT_2, core.NpcIdentifiers.LAZY_CAT_2],
    [core.ItemIdentifiers.LAZY_HELL_CAT, core.NpcIdentifiers.LAZY_HELLCAT],
  ]) {
    await replaceFollower(itemId, npcId);
    const before = namingWrites.length;
    await openRename();
    assert.equal(namingWrites.slice(before).filter(write => write.child >= 10 && write.child <= 15)
      .slice(-6).map(write => write.value).join(''), sharedName,
      'each eligible cat form displays the same saved name');
    await send({type:'interface_close'});
  }
  await openRename();
  await send(arrow);
  const previousCat = p.getAttribute('pets:current');
  const pick = previousCat.getCurrentDefinition(p).getActions().indexOf('Pick-up') + 1;
  assert.ok(pick > 0, 'eligible cat has a real pickup option');
  await send({type:'npc_option', index:previousCat.getIndex(), clickType:pick});
  for (let i=0; i<12 && p.getAttribute('pets:current'); i++) tick();
  assert.equal(p.getAttribute('pets:current'), null, 'the cat changed while an edit was pending');
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'stale edit cannot commit after cat pickup');
  const itemId = core.ItemIdentifiers.LAZY_HELL_CAT;
  p.getInventory().deleteNumber(itemId, 1);
  p.getPacketSender().sendInterfaceRemoval();
  await send({type:'npc_option', index:felkrash.getIndex(), clickType:option});
  for (let i=0; i<12; i++) tick();
  const emptyMenu = NativePrompt.getPending(p);
  assert.ok(emptyMenu, 'Felkrash still offers the post-quest menu with no eligible cat');
  const emptyChoice = emptyMenu.options.indexOf('Can you rename my cat?');
  assert.ok(emptyChoice >= 0);
  await send({type:'dialogue_continue', widgetId:NativePrompt.OPTIONS_WIDGET_ID, childIndex:emptyChoice + 1});
  for (let i=0; i<12 && p.getDialogueManager().isActive()
      && !String(p.getDialogueManager().getCurrent()?.getText?.() ?? '').includes("I'll only help"); i++) await next();
  assert.match(p.getDialogueManager().getCurrent()?.getText?.() ?? '', /only help you name wily or lazy cats/i,
    'Felkrash refuses naming when the player has no eligible cat');
  assert.notEqual(p.getInterfaceId(), 61, 'no eligible cat never opens the naming interface');

  p.getPacketSender().sendInterfaceRemoval();
  p.getInventory().add(new core.Item(itemId), true);
  await openRename();
  const beforeCarried = lines.length;
  await send(arrow);
  await send(enter);
  assert.notEqual(p.getInterfaceId(), 61, 'a carried eligible cat can be named');
  assert.equal(p.getAttribute('ratcatchers:cat-name'), 'ABBBBA', 'carried cat commits a distinct edited name');
  sharedName = 'ABBBBA';
  assert.equal(lines.slice(beforeCarried).some(line => /finally got around to naming|Miaaow!/i.test(line.text)), false,
    'a carried cat does not speak from the ground');
  p.getPacketSender().sendInterfaceRemoval();
  const heldSlot = p.getInventory().getSlotForItemId(itemId);
  assert.ok(heldSlot >= 0, 'picked-up cat is held');
  await send({type:'inventory_action', itemId, slot:heldSlot, widgetId:149 << 16, option:'Drop', optionIndex:5});
  for (let i=0; i<4; i++) tick();
  assert.equal(p.getAttribute('pets:current')?.getId(), core.NpcIdentifiers.LAZY_HELLCAT, 'cat is resummoned');
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, null);
  await openRename();
  await send(enter);
  assert.match(p.getDialogueManager().getCurrent()?.getText?.() ?? '', /So cat, what do you think/i,
    'grounded cat without catspeak gets the non-catspeak conversation');
  await next();
  assert.match(p.getDialogueManager().getCurrent()?.getText?.() ?? '', /Miaaow!/i,
    'grounded cat visibly replies without catspeak');
  assert.equal(lines.findLast(line => /^Miaaow!$/i.test(line.text))?.speakerId,
    p.getAttribute('pets:current').getId(), 'non-catspeak reply uses the actual cat head');
  await openRename();
  await send(arrow);
  nativeRatcatchers.setStage(p, 21);
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'quest state is rechecked at commit');
  assert.notEqual(p.getInterfaceId(), 61, 'invalid quest state closes its own naming interface');
  nativeRatcatchers.setStage(p, 22);
  await openRename();
  await send(arrow);
  p.setLocation(new core.Location(3230, 3218, 0)); p.setNeedsPlacement(false);
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'distance change prevents stale commit');
  assert.notEqual(p.getInterfaceId(), 61, 'distance-invalid session closes its own interface');
  p.setLocation(new core.Location(3222, 3218, 0)); p.setNeedsPlacement(false); tick();
  await openRename();
  await send(arrow);
  PluginManager.emitPlayerLogout({player:p, username:p.getUsername()});
  await send(enter);
  assert.equal(p.getAttribute('ratcatchers:cat-name'), sharedName, 'logout prevents stale naming commit');
});
