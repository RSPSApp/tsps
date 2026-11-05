// Run after `yarn build`: node --test tests/quetzals.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Quetzals = require("../plugins/world/Quetzals.plugin");

const { Common, Renu, Sites, Whistle, Pitri, Primio } = Quetzals._test;
const obj = (name) => CacheDefinitions.getObjId(name);
const varbitId = (name) => CacheDefinitions.getVarbitId(name);
const varpId = (name) => CacheDefinitions.getVarpId(name);

const tasks = [];
const hooks = { items: [], npcs: [], objects: [], clicks: [], events: new Map(), conditions: [], deaths: [], persisted: new Map() };
const dialogueStarts = [];
let completeQuests = new Set();
let rumours = 0;

class Task {
  constructor(delay, key) {
    this.delay = delay;
    this.key = key;
    this.running = true;
  }

  stop() {
    this.running = false;
  }
}

class StatementDialogue {
  constructor(index, text) {
    this.text = text;
  }
}

class DialogueChainBuilder {
  constructor() {
    this.entries = [];
  }

  add(entry) {
    this.entries.push(entry);
    return this;
  }
}

const api = {
  core: {
    CacheDefinitions, Location, Item, ItemIdentifiers, Task,
    TaskManager: { submit: (task) => tasks.push(task) },
    TeleportHandler: { checkReqs: () => true },
    Animation: class { constructor(id) { this.id = id; } },
    Graphic: class { constructor(id) { this.id = id; } },
    DialogueChainBuilder, StatementDialogue, EndDialogue: class {},
  },
  persistAttribute: (key, value) => hooks.persisted.set(key, value),
  onPlayerLogin: () => {},
  onPlayerDeath: (handler) => hooks.deaths.push(handler),
  onNpcInteraction: (name, actions) => hooks.npcs.push({ name, actions }),
  onObjectInteraction: (name, actions) => hooks.objects.push({ name, actions }),
  onItemAction: (name, actions) => hooks.items.push({ name, actions }),
  onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
  onCustomEvent: (name, handler) => hooks.events.set(name, [...(hooks.events.get(name) ?? []), handler]),
  onNpcDialogueCondition: (handler) => hooks.conditions.push(handler),
  emitCustomEvent: (name, request) => {
    if (name === "quest:is-complete") request.complete = completeQuests.has(request.key);
    if (name === "hunter:rumours-completed") request.completed = rumours;
    if (name === "npc-dialogue:start") {
      dialogueStarts.push(request);
      request.handled = true;
    }
  },
};

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const task of [...tasks]) {
      if (!task.running) continue;
      task.elapsed = (task.elapsed ?? 0) + 1;
      if (task.elapsed >= task.delay) {
        task.elapsed = 0;
        task.execute();
      }
    }
  }
  for (let i = tasks.length - 1; i >= 0; i--) if (!tasks[i].running) tasks.splice(i, 1);
}

function createPlayer({ at = new Location(1584, 3053, 0), items = [], varbits = {}, varps = {}, wilderness = 0, realInventory = false } = {}) {
  const varbitValues = new Map(Object.entries(varbits).map(([name, value]) => [varbitId(name), value]));
  const varpValues = new Map(Object.entries(varps).map(([name, value]) => [varpId(name), value]));
  const attributes = new Map();
  // Like ItemContainer, an empty slot is an Item with id -1, and deleting empties it in place.
  const slots = Array.from({ length: 28 }, () => new Item(-1, 0));
  items.forEach(([id, amount = 1], index) => { slots[index] = new Item(id, amount); });
  const sent = { subs: [], closed: [], flags: [], scripts: [], sounds: [], messages: [], boxes: [], anims: [], gfx: [] };
  let location = at;
  let interfaceId = -1;
  let blocked = false;
  let registered = true;
  let dying = false;
  const amountOf = (id) => (id < 0 ? 0 : slots.reduce((sum, item) => sum + (item.getId() === id ? item.getAmount() : 0), 0));
  const inventory = {
    getItems: () => slots,
    getAmount: amountOf,
    contains: (id) => amountOf(id) > 0,
    delete: (id, amount) => {
      for (let i = 0; i < slots.length && amount > 0; i++) {
        const item = slots[i];
        if (item?.getId() !== id) continue;
        const take = Math.min(amount, item.getAmount());
        amount -= take;
        item.setAmount(item.getAmount() - take);
        if (item.getAmount() < 1) item.setId(-1);
      }
      return inventory;
    },
    add: (item) => {
      const index = slots.findIndex((slot) => slot.getId() === -1);
      slots[index] = item;
      return inventory;
    },
    refreshItems: () => {},
  };
  const sender = {
    getVarbit: (id) => varbitValues.get(id) ?? 0,
    getVarp: (id) => varpValues.get(id) ?? 0,
    sendVarbit: (id, value) => { varbitValues.set(id, value); return sender; },
    sendConfig: (id, value) => { varpValues.set(id, value); return sender; },
    sendInterfaceScript: (id, args) => { sent.scripts.push([id, ...args]); return sender; },
    sendSubInterface: (uid, id, type, options) => { sent.subs.push({ uid, id, type, options }); return sender; },
    closeSubInterface: (uid) => { sent.closed.push(uid); return sender; },
    sendInterfaceFlagsRange: (uid, from, to, flags) => { sent.flags.push([uid, from, to, flags]); return sender; },
    sendSound: (id) => { sent.sounds.push(id); return sender; },
    sendSoundEffect: (id) => { sent.sounds.push(id); return sender; },
    sendItemContainer: () => sender,
  };
  const movement = { setBlockMovement: (value) => { blocked = value; return movement; }, reset: () => movement };
  const player = {
    sent,
    slots,
    get blocked() { return blocked; },
    logout() { registered = false; },
    varbit: (name) => varbitValues.get(varbitId(name)) ?? 0,
    varp: (name) => varpValues.get(varpId(name)) ?? 0,
    getPacketSender: () => sender,
    getInventory: () => inventory,
    getLocation: () => location,
    getMovementQueue: () => movement,
    getWildernessLevel: () => wilderness,
    moveTo: (target) => { location = target; },
    performAnimation: (animation) => sent.anims.push(animation.id),
    performGraphic: (graphic) => sent.gfx.push(graphic.id),
    getInterfaceId: () => interfaceId,
    setInterfaceId: (id) => { interfaceId = id; },
    isRegistered: () => registered,
    isPlayerBot: () => false,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => sent.messages.push(text),
    getDialogueManager: () => ({ startDialogues: (chain) => sent.boxes.push(chain.entries[0].text) }),
    isDyingReturn: () => dying,
    die() { dying = true; },
    // As PlayerDeathTask does: reset (dying off, movement unheld), the death hooks, then the respawn tile.
    respawn(target) {
      dying = false;
      blocked = false;
      for (const handler of hooks.deaths) handler({ player, killer: null, handled: false });
      location = target;
    },
  };
  if (realInventory) {
    const real = new Inventory(player);
    items.forEach(([id, amount = 1]) => real.add(new Item(id, amount), false));
    player.getInventory = () => real;
  }
  return player;
}

const site = (name) => Common.landingSites().find((entry) => entry.name === name);
const icons = (menu) => CacheDefinitions.getComponentId(`${menu}:icons`);
const group = (menu) => CacheDefinitions.getInterfaceId(menu);
const itemHook = (name, option) => hooks.items.find((hook) => hook.name === name && hook.actions[option])?.actions[option];
const click = (player, menu, slot) => {
  const component = icons(menu);
  const event = { player, buttonId: component, groupId: component >>> 16, childId: component & 0xffff, slot, handled: false };
  for (const handler of hooks.clicks) handler(event);
  return event;
};
const at = (location) => [location.getX(), location.getY(), location.getZ()];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Quetzals.register(api);
});

test("the maps' icons are <menu>:icons (874:12, 949:12) and a site is usable by client script 5015", () => {
  assert.equal(icons("quetzal_menu"), (874 << 16) | 12);
  assert.equal(icons("quetzalwhistle_menu"), (949 << 16) | 12);
  const player = createPlayer();
  const camTorum = site("Cam Torum Entrance");
  assert.equal(camTorum.autoUnlocked, false);
  assert.equal(Common.siteUsable(player, site("The Teomat")), true);
  assert.equal(Common.siteUsable(player, camTorum), false);
  // rsprox 223/3: quetzals_unlocked 32 with the Cam Torum site (id 5) built.
  assert.equal(Common.siteUsable(createPlayer({ varps: { quetzals_unlocked: 32 } }), camTorum), true);
});

test("Renu's map opens as captured, takes clicks on 874:12, and flies only once she is the player's", () => {
  const player = createPlayer({ varbits: { quetzal_base_appearance: 1 } });
  Renu.openMap({ player });
  assert.deepEqual(player.sent.scripts[0], [2524, -1, -1]);
  assert.equal(player.getInterfaceId(), 874);
  assert.deepEqual(player.sent.flags[0], [icons("quetzal_menu"), 0, 13, 2]);
  tick();
  assert.equal(player.varbit("busy"), 1);
  const aldarin = site("Aldarin");
  click(player, "quetzal_menu", Common.landingSites().indexOf(aldarin));
  assert.equal(player.varbit("quetzal_last_destination"), aldarin.id);
  tick(4);
  assert.deepEqual(at(player.getLocation()), [aldarin.x, aldarin.y, aldarin.z]);
  tick(3);
  assert.equal(player.blocked, false);

  const stranger = createPlayer();
  Renu.openMap({ player: stranger });
  click(stranger, "quetzal_menu", Common.landingSites().indexOf(aldarin));
  assert.equal(stranger.varbit("quetzal_last_destination"), 0, "no Renu, no flight");
  tasks.length = 0;
});

test("Build needs Twilight's Promise and the materials, then marks the site built after six ticks", () => {
  completeQuests = new Set();
  const build = hooks.objects.find((hook) => hook.name === "Unbuilt Landing Site").actions.Build;
  const loc = { objectId: CacheDefinitions.getLocId("quetzal_landing_site_camtorum"), location: { x: 1, y: 1, z: 0 } };
  const materials = [[obj("hg_seedsack"), 10], [obj("limestonebrick"), 3], [obj("softclay"), 4]];
  const camTorum = site("Cam Torum Entrance");
  assert.equal(Sites.siteOf(loc), camTorum);

  const early = createPlayer({ items: materials });
  build({ player: early, ...loc });
  assert.deepEqual(early.sent.boxes, ["You're not sure how to do that."]);

  completeQuests = new Set(["twilights_promise"]);
  const short = createPlayer({ items: [[obj("hg_seedsack"), 9], [obj("limestonebrick"), 3], [obj("softclay"), 4]] });
  build({ player: short, ...loc });
  assert.deepEqual(short.sent.boxes, ["You need ten quetzal feed sacks, three limestone bricks and four soft clay to build this landing site."]);

  const builder = createPlayer({ items: [...materials, [obj("hg_seedsack"), 1]], varbits: { quetzal_base_appearance: 2 } });
  build({ player: builder, ...loc });
  assert.equal(builder.blocked, true);
  tick(5);
  assert.equal(Common.siteBuilt(builder, camTorum), false);
  tick(1);
  assert.equal(builder.varp("quetzals_unlocked"), 1 << camTorum.id);
  assert.equal(builder.varbit("quetzal_camtorum"), 2, "the site shows Renu's appearance");
  assert.equal(builder.getInventory().getAmount(obj("hg_seedsack")), 1);
  assert.equal(builder.getInventory().getAmount(obj("softclay")), 0);
  assert.deepEqual(builder.sent.boxes, ["You build a quetzal landing site."]);
  assert.equal(builder.blocked, false);
  assert.ok(Object.values(builder.getAttribute(Common.VARPS_ATTRIBUTE)).includes(1 << camTorum.id), "saved for relog");
  completeQuests = new Set();
});

test("Signal opens the whistle map; a site flies on the captured ticks and spends a charge on landing", () => {
  const whistle = obj("hg_quetzalwhistle_enhanced");
  const player = createPlayer({ items: [[whistle]], at: new Location(1445, 3104, 0) });
  const enhanced = Whistle.whistleOf(whistle);
  Whistle.setCharges(player, enhanced, 14);
  itemHook("Enhanced quetzal whistle", "Signal")({ player, itemId: whistle });
  assert.equal(player.varbit("busy"), 1);
  assert.equal(player.getInterfaceId(), 949);
  assert.deepEqual(player.sent.flags.at(-1), [icons("quetzalwhistle_menu"), 0, 13, 2]);
  assert.ok(player.sent.sounds.includes(8413));

  // rsprox 237/4002: sub 0 is Civitas illa Fortis, landed at 1697,3140,0.
  const fortis = Common.landingSites()[0];
  click(player, "quetzalwhistle_menu", 0);
  assert.deepEqual(player.sent.anims, [CacheDefinitions.getSeqId("human_quetzal_whistle")]);
  assert.deepEqual(player.sent.gfx, [CacheDefinitions.getSpotanimId("spotanim_whistle_quetzal_backpack01")]);
  assert.equal(player.getInterfaceId(), -1);
  tick(6);
  assert.equal(player.varbit("minimap_state"), 0);
  tick(1);
  assert.equal(player.varbit("minimap_state"), 2);
  assert.deepEqual(player.sent.subs.at(-1).options.postScripts[0].args, [0, 255, 0, 0, 15]);
  tick(1);
  assert.deepEqual(at(player.getLocation()), [1697, 3140, 0]);
  assert.deepEqual([fortis.x, fortis.y], [1697, 3140]);
  tick(1);
  assert.equal(player.sent.messages.at(-1), "Your quetzal whistle has 13 charges remaining.");
  assert.equal(player.varbit("quetzal_last_destination"), fortis.id);
  assert.equal(player.varbit("busy"), 0);
  assert.equal(player.blocked, false);
  tick(2);
  assert.ok(player.sent.closed.includes((161 << 16) | 1));
  assert.equal(tasks.length, 0);
});

test("the whistle needs no Renu but needs a usable site, charges, and to be at most level 20 Wilderness", () => {
  const whistle = obj("hg_quetzalwhistle_basic");
  const basic = Whistle.whistleOf(whistle);
  const empty = createPlayer({ items: [[whistle]] });
  itemHook("Basic quetzal whistle", "Signal")({ player: empty, itemId: whistle });
  assert.equal(empty.getInterfaceId(), -1);
  assert.equal(empty.sent.messages.at(-1), "Your quetzal whistle has 0 charges remaining.");

  const deep = createPlayer({ items: [[whistle]], wilderness: 21 });
  Whistle.setCharges(deep, basic, 3);
  itemHook("Basic quetzal whistle", "Last-destination")({ player: deep, itemId: whistle });
  assert.deepEqual(deep.sent.messages, ["Unfortunately, large birds can't just fly you to Varlamore from here.", "You'll need to be below level 20 wilderness."]);

  const player = createPlayer({ items: [[whistle]] });
  Whistle.setCharges(player, basic, 9);
  assert.equal(Whistle.chargesOf(player, basic), 5, "a basic whistle holds five");
  itemHook("Basic quetzal whistle", "Signal")({ player, itemId: whistle });
  click(player, "quetzalwhistle_menu", Common.landingSites().indexOf(site("Cam Torum Entrance")));
  assert.equal(player.getInterfaceId(), 949, "an unbuilt site is not offered");
  itemHook("Basic quetzal whistle", "Check")({ player, itemId: whistle });
  assert.equal(player.sent.messages.at(-1), "Your quetzal whistle has 5 charges remaining.");
  tasks.length = 0;
});

test("Last-destination flies straight there, and the settings toggle sends Signal to the Hunter Guild", () => {
  const whistle = obj("hg_quetzalwhistle_perfected");
  const perfected = Whistle.whistleOf(whistle);
  const player = createPlayer({ items: [[whistle]], varbits: { quetzal_last_destination: site("Aldarin").id } });
  Whistle.setCharges(player, perfected, 50);
  itemHook("Perfected quetzal whistle", "Last-destination")({ player, itemId: whistle });
  assert.equal(player.getInterfaceId(), -1, "no map");
  tick(8);
  assert.deepEqual(at(player.getLocation()), [site("Aldarin").x, site("Aldarin").y, site("Aldarin").z]);
  tick(3);

  const toGuild = createPlayer({ items: [[whistle]], varbits: { settings_quetzalwhistle_default_tp: 1 } });
  Whistle.setCharges(toGuild, perfected, 50);
  itemHook("Perfected quetzal whistle", "Signal")({ player: toGuild, itemId: whistle });
  tick(8);
  assert.deepEqual(at(toGuild.getLocation()), [site("Hunter Guild").x, site("Hunter Guild").y, site("Hunter Guild").z]);
  tick(3);
  assert.equal(Whistle.chargesOf(toGuild, perfected), 49);
});

test("a logout mid-flight leaves the player where they were, unheld, with the charge kept", () => {
  const whistle = obj("hg_quetzalwhistle_enhanced");
  const enhanced = Whistle.whistleOf(whistle);
  const start = new Location(1445, 3104, 0);
  const player = createPlayer({ items: [[whistle]], at: start });
  Whistle.setCharges(player, enhanced, 4);
  itemHook("Enhanced quetzal whistle", "Signal")({ player, itemId: whistle });
  click(player, "quetzalwhistle_menu", 0);
  tick(3);
  player.logout();
  tick(10);
  assert.equal(player.getLocation(), start);
  assert.equal(player.blocked, false);
  assert.equal(Whistle.chargesOf(player, enhanced), 4);
  assert.equal(tasks.length, 0);
});

test("the imbued whistle needs no charges and says nothing about them", () => {
  const whistle = obj("hg_quetzalwhistle_perfected_infinite");
  const player = createPlayer({ items: [[whistle]] });
  itemHook("Perfected quetzal whistle(i)", "Signal")({ player, itemId: whistle });
  click(player, "quetzalwhistle_menu", 0);
  tick(11);
  assert.deepEqual(at(player.getLocation()), [1697, 3140, 0]);
  assert.equal(player.sent.messages.length, 0);
});

test("Craft makes a basic whistle from willow logs and upgrades keep the charges", () => {
  const knife = obj("knife");
  const player = createPlayer({ items: [[obj("hg_whistle_blueprint_1")], [obj("willow_logs")]] });
  itemHook("Basic quetzal whistle blueprint", "Craft")({ player, itemId: obj("hg_whistle_blueprint_1") });
  assert.equal(player.sent.messages.at(-1), "This whistle requires a knife and one set of willow logs.");
  player.getInventory().add(new Item(knife, 1));
  itemHook("Basic quetzal whistle blueprint", "Craft")({ player, itemId: obj("hg_whistle_blueprint_1") });
  assert.equal(player.sent.messages.at(-1), "You craft yourself a basic quetzal whistle.");
  assert.equal(player.getInventory().contains(obj("hg_quetzalwhistle_basic")), true);
  assert.equal(player.getInventory().contains(obj("willow_logs")), false);

  const basic = Whistle.whistleOf(obj("hg_quetzalwhistle_basic"));
  Whistle.setCharges(player, basic, 4);
  player.getInventory().add(new Item(obj("hg_whistle_blueprint_2_torn"), 1));
  player.getInventory().add(new Item(obj("yew_logs"), 1));
  itemHook("Torn enhanced quetzal whistle blueprint", "Craft")({ player, itemId: obj("hg_whistle_blueprint_2_torn") });
  assert.equal(player.sent.messages.at(-1), "You craft yourself an enhanced quetzal whistle.");
  assert.equal(player.getInventory().contains(obj("hg_quetzalwhistle_basic")), false);
  assert.equal(Whistle.chargesOf(player, Whistle.whistleOf(obj("hg_quetzalwhistle_enhanced"))), 4);

  const noBase = createPlayer({ items: [[obj("hg_whistle_blueprint_3")], [obj("redwood_logs")], [knife]] });
  itemHook("Perfected quetzal whistle blueprint", "Craft")({ player: noBase, itemId: obj("hg_whistle_blueprint_3") });
  assert.equal(noBase.sent.messages.at(-1), "You need an enhanced quetzal whistle to craft this whistle.");
  itemHook("Perfected quetzal whistle blueprint", "Check")({ player: noBase, itemId: obj("hg_whistle_blueprint_3") });
  assert.equal(noBase.sent.messages.at(-1), "This whistle requires a knife and one set of redwood logs.");
});

test("Pitri's transcript conditions recharge the first whistle from meat until it is full", () => {
  const definition = { getName: () => "Soar Leader Pitri", getId: () => 13135 };
  const answer = (player, text) => hooks.conditions.map((handler) => handler({ player, definition, text })).find((value) => value != null);
  const whistle = obj("hg_quetzalwhistle_basic");
  const basic = Whistle.whistleOf(whistle);

  const nothing = createPlayer();
  assert.equal(answer(nothing, "If the player does not have a whistle in their inventory:"), true);

  const player = createPlayer({ items: [[whistle], [obj("hunting_graahk_meat"), 1], [obj("hunting_graahk_meat"), 1], [obj("hunting_graahk_meat"), 1], [obj("hg_seedsack"), 5]] });
  Whistle.setCharges(player, basic, 0);
  assert.equal(answer(player, "If the player has a whistle with no raw hunter meats/Quetzal feed in their inventory or if the whistle is fully charged:"), false);
  assert.equal(answer(player, "If the player has at least one raw hunter meat or Quetzal feed to recharge their whistle:"), true);
  // Three graahk (2 each) fill five; the last one's extra charge is lost and the feed stays.
  assert.equal(Whistle.chargesOf(player, basic), 5);
  assert.equal(player.getInventory().getAmount(obj("hunting_graahk_meat")), 0);
  assert.equal(player.getInventory().getAmount(obj("hg_seedsack")), 5);
  assert.equal(answer(player, "If the player has a whistle with no raw hunter meats/Quetzal feed in their inventory or if the whistle is fully charged:"), true);

  // Talk-to: "Sure thing!", then full or partial after the exchange.
  const talker = createPlayer({ items: [[whistle], [obj("huntingbeast_wild_meat"), 2]] });
  Whistle.setCharges(talker, basic, 1);
  assert.equal(answer(talker, "If the player has one raw hunter meat or Quetzal feed:"), true);
  assert.equal(answer(talker, "If the whistle is fully charged after exchanging raw hunter meat or Quetzal feed:"), false);
  assert.equal(answer(talker, "If the whistle is partially charged after exchanging raw hunter meat or Quetzal feed:"), true);
  assert.equal(Whistle.chargesOf(talker, basic), 3);

  const recharge = hooks.npcs.find((hook) => hook.name === "Soar Leader Pitri").actions["Recharge-whistle"];
  recharge({ player: talker, npc: { getId: () => 13135 }, definition });
  assert.equal(dialogueStarts.at(-1).variant, "standard-dialogue-choosing-the-recharge-whistle-option");
});

test("Pitri gives the basic blueprint free after ten rumours, then for 500 coins", () => {
  const definition = { getName: () => "Soar Leader Pitri" };
  const answer = (player, text) => hooks.conditions.map((handler) => handler({ player, definition, text })).find((value) => value != null);
  const receive = (player) => {
    const event = { player, definition, action: "receive", target: "a Basic quetzal whistle blueprint", handled: false };
    for (const handler of hooks.events.get("npc-dialogue:action")) handler(event);
    return event;
  };
  const condition = "If the player has completed 10 rumours and has not claimed the free whistle blueprint:";
  const player = createPlayer({ items: [[ItemIdentifiers.COINS, 600]], realInventory: true });
  rumours = 9;
  assert.equal(answer(player, condition), false);
  rumours = 10;
  assert.equal(answer(player, condition), true);
  assert.equal(receive(player).handled, true);
  assert.equal(player.getInventory().getAmount(obj("hg_whistle_blueprint_1")), 1);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 600);
  assert.equal(answer(player, condition), false);
  receive(player);
  assert.equal(player.getInventory().getAmount(obj("hg_whistle_blueprint_1")), 2);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 100);
  receive(player);
  assert.equal(player.sent.messages.at(-1), "You need 500 coins to buy a blueprint.");
  assert.equal(player.getInventory().getAmount(obj("hg_whistle_blueprint_1")), 2);
  rumours = 0;
});

const pitri = { getName: () => "Soar Leader Pitri" };
const freeBlueprintCondition = "If the player has completed 10 rumours and has not claimed the free whistle blueprint:";
const answerPitri = (player, text) => hooks.conditions.map((handler) => handler({ player, definition: pitri, text })).find((value) => value != null);
const receiveBlueprint = (player) => {
  const event = { player, definition: pitri, action: "receive", target: "a Basic quetzal whistle blueprint", handled: false };
  for (const handler of hooks.events.get("npc-dialogue:action")) handler(event);
  return event;
};
const filler = (count) => Array.from({ length: count }, () => [obj("logs")]);

test("a full inventory keeps the free blueprint unclaimed until it can be given", () => {
  const player = createPlayer({ items: filler(28), realInventory: true });
  rumours = 10;
  assert.equal(answerPitri(player, freeBlueprintCondition), true);
  const event = receiveBlueprint(player);
  assert.equal(event.handled, true);
  assert.equal(event.end, true);
  assert.equal(player.getInventory().getAmount(obj("hg_whistle_blueprint_1")), 0);
  assert.notEqual(player.getAttribute(Pitri.BLUEPRINT_CLAIMED_ATTRIBUTE), true, "the free blueprint is still owed");
  assert.equal(player.sent.messages.at(-1), "Not enough space in your inventory.");
  assert.equal(answerPitri(player, freeBlueprintCondition), true);

  player.getInventory().delete(obj("logs"), 1);
  receiveBlueprint(player);
  assert.equal(player.getInventory().getAmount(obj("hg_whistle_blueprint_1")), 1);
  assert.equal(player.getAttribute(Pitri.BLUEPRINT_CLAIMED_ATTRIBUTE), true);
  rumours = 0;
});

test("a full inventory keeps the 500 coins, unless paying them frees the coins' slot", () => {
  const player = createPlayer({ items: [[ItemIdentifiers.COINS, 600], ...filler(27)], realInventory: true });
  player.setAttribute(Pitri.BLUEPRINT_CLAIMED_ATTRIBUTE, true);
  const event = receiveBlueprint(player);
  assert.equal(event.end, true);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 600, "no payment without the blueprint");
  assert.equal(player.getInventory().getAmount(obj("hg_whistle_blueprint_1")), 0);
  assert.equal(player.sent.messages.at(-1), "Not enough space in your inventory.");

  const exact = createPlayer({ items: [[ItemIdentifiers.COINS, 500], ...filler(27)], realInventory: true });
  exact.setAttribute(Pitri.BLUEPRINT_CLAIMED_ATTRIBUTE, true);
  assert.notEqual(receiveBlueprint(exact).end, true);
  assert.equal(exact.getInventory().getAmount(ItemIdentifiers.COINS), 0);
  assert.equal(exact.getInventory().getAmount(obj("hg_whistle_blueprint_1")), 1, "the emptied coin slot holds it");
});

test("a death mid-flight ends the whistle journey: the respawn stands and the charge is kept", () => {
  const whistle = obj("hg_quetzalwhistle_basic");
  const basic = Whistle.whistleOf(whistle);
  const respawnTile = new Location(3222, 3218, 0);
  const player = createPlayer({ items: [[whistle]], at: new Location(1445, 3104, 0) });
  Whistle.setCharges(player, basic, 5);
  itemHook("Basic quetzal whistle", "Signal")({ player, itemId: whistle });
  click(player, "quetzalwhistle_menu", Common.landingSites().indexOf(site("The Teomat")));
  tick(3);
  player.die();
  tick(3);
  player.respawn(respawnTile);
  tick(10);
  assert.deepEqual(at(player.getLocation()), at(respawnTile));
  assert.equal(Whistle.chargesOf(player, basic), 5);
  assert.equal(player.varbit("busy"), 0);
  assert.equal(player.varbit("minimap_state"), 0);
  assert.equal(player.blocked, false);
  assert.equal(tasks.length, 0);

  // A new flight after the respawn is not held up by the ended one.
  itemHook("Basic quetzal whistle", "Signal")({ player, itemId: whistle });
  click(player, "quetzalwhistle_menu", Common.landingSites().indexOf(site("The Teomat")));
  tick(11);
  assert.deepEqual(at(player.getLocation()), [site("The Teomat").x, site("The Teomat").y, site("The Teomat").z]);
  assert.equal(Whistle.chargesOf(player, basic), 4);
});

test("the plugin saves the quetzal varps, charges and the free blueprint", () => {
  assert.equal(Quetzals.members, true);
  assert.equal(hooks.persisted.get(Common.VARPS_ATTRIBUTE), null);
  assert.equal(hooks.persisted.get(Whistle.CHARGES_ATTRIBUTE), null);
  assert.equal(hooks.persisted.get(Pitri.BLUEPRINT_CLAIMED_ATTRIBUTE), false);
  const unlocked = createPlayer({ varps: { quetzals_unlocked: 32 } });
  Common.save(unlocked);
  assert.deepEqual(unlocked.getAttribute(Common.VARPS_ATTRIBUTE), { [varpId("quetzals_unlocked")]: 32 });
});

test("a finished Twilight's Promise unlocks Renu at login, and an unfinished one doesn't", () => {
  completeQuests = new Set();
  const unfinished = createPlayer();
  Renu.unlockOnLogin({ player: unfinished });
  assert.equal(Common.renuUnlocked(unfinished), false);
  assert.equal(unfinished.varbit("quetzal_auburnvalley"), 0, "a whistle user has no Renu to repair");
  assert.equal(unfinished.varp("quetzals_unlocked"), 0);
  assert.equal(unfinished.getAttribute(Common.VARPS_ATTRIBUTE), undefined, "an unfinished quest saves nothing");
  completeQuests = new Set(["twilights_promise"]);
  const finished = createPlayer({ varps: { quetzals_unlocked: 1 << site("Cam Torum Entrance").id } });
  Renu.unlockOnLogin({ player: finished });
  assert.equal(finished.varbit("quetzal_base_appearance"), 1);
  assert.equal(finished.varbit("quetzal_fortis"), 2, "the Fortis Renu travels");
  assert.equal(finished.varbit("quetzal_teomat"), 1);
  assert.equal(finished.varbit("quetzal_camtorum"), 1, "a built site shows too");
  assert.equal(finished.varbit("quetzal_kastori"), 0, "an unbuilt one doesn't");
  completeQuests = new Set();
});

test("an existing Renu owner's missing automatic sites are repaired at login, and nothing else moves", () => {
  completeQuests = new Set();
  const teomat = site("The Teomat");
  const camTorum = site("Cam Torum Entrance");
  const kastori = site("Kastori");
  const auburnvale = site("Auburnvale");
  const aldarin = site("Aldarin");
  const built = (1 << camTorum.id) | (1 << site("Outer Fortis").id);
  const player = createPlayer({
    varbits: {
      quetzal_base_appearance: 3,
      quetzal_fortis: 1,
      quetzal_teomat: 4,
      quetzal_camtorum: 2,
      quetzal_auburnvalley: 0,
      quetzal_last_destination: aldarin.id,
    },
    varps: { quetzals_unlocked: built },
  });

  Renu.unlockOnLogin({ player });
  assert.equal(auburnvale.autoUnlocked, true);
  assert.equal(player.varbit("quetzal_auburnvalley"), 3, "the missing automatic site shows Renu's colour");
  for (const entry of Common.landingSites()) {
    if (entry.autoUnlocked) assert.notEqual(player.varbit(Common.SITE_VARBITS[entry.id]), 0, `${entry.name} is visible`);
  }
  assert.equal(player.varbit("quetzal_fortis"), 1, "Fortis keeps her feed state");
  assert.equal(teomat.autoUnlocked, true);
  assert.equal(player.varbit("quetzal_teomat"), 4, "an existing colour is not replaced");
  assert.equal(player.varbit("quetzal_camtorum"), 2, "a built site keeps its colour");
  assert.equal(player.varbit("quetzal_kastori"), 0, "an unbuilt site stays hidden");
  assert.equal(kastori.autoUnlocked, false);
  assert.equal(player.varp("quetzals_unlocked"), built, "the built bitmap is untouched");
  assert.equal(player.varbit("quetzal_last_destination"), aldarin.id, "the last destination is untouched");
  const snapshot = player.getAttribute(Common.VARPS_ATTRIBUTE);
  assert.ok(snapshot, "the repair is saved through the quetzal snapshot");
  assert.equal(snapshot[varpId("quetzals_unlocked")], built);

  const saved = { keep: true };
  player.setAttribute(Common.VARPS_ATTRIBUTE, saved);
  Renu.unlockOnLogin({ player });
  assert.equal(player.getAttribute(Common.VARPS_ATTRIBUTE), saved, "a second login with nothing missing saves nothing");
  assert.equal(player.varbit("quetzal_auburnvalley"), 3);
  assert.equal(player.varbit("quetzal_fortis"), 1);
  completeQuests = new Set();
});

test("Primio's introduction and visit flags survive native saves without rewinding the shared quest stage", () => {
  const nativeCore = PluginManager.getCoreApi();
  Common.init({ ...api, core: { ...nativeCore, Task, TaskManager: api.core.TaskManager } });
  PlayerSave.persistAttribute(Common.VARPS_ATTRIBUTE, null);
  completeQuests = new Set(["children_of_the_sun"]);
  const nativePlayer = () => {
    const player = new Player(null, new Location(3281, 3413, 0));
    player.setRegistered(true);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    return player;
  };
  try {
    for (const state of [2, 3, 4]) {
      const original = nativePlayer();
      original.getPacketSender().sendVarbit(varbitId("vmq2"), 14);
      Common.setVarbits(original, { vmq2_first_travel: state, varlamore_visited: state >= 3 ? 1 : 0, quetzal_last_destination: 7 });
      const save = PlayerSave.fromPlayer(original);
      save.attributes = JSON.parse(JSON.stringify(save.attributes));
      const loaded = nativePlayer();
      save.applyToPlayer(loaded);
      const sender = loaded.getPacketSender();
      sender.sendVarbit(varbitId("vmq2"), 50);
      Common.restore({ player: loaded });
      assert.equal(sender.getVarbit(varbitId("vmq2_first_travel")), state);
      assert.equal(sender.getVarbit(varbitId("varlamore_visited")), state >= 3 ? 1 : 0);
      assert.equal(sender.getVarbit(varbitId("vmq2")), 50, "restoring travel bits cannot overwrite Twilight's Promise");
      assert.equal(sender.getVarbit(varbitId("quetzal_last_destination")), 7, "existing quetzal varp snapshots still restore");
      const menus = dialogueStarts.length;
      Primio.travel({ player: loaded, npcId: 12888 });
      if (state === 2) {
        assert.equal(dialogueStarts.at(-1).variant, "talking-in-varrock-talking-again-before-taking-the-first-trip");
        Primio.acceptFirstTrip({ player: loaded, npcId: 12884, stepId: "Kectpl" });
        loaded.setRegistered(false); tick(7);
        assert.deepEqual(at(loaded.getLocation()), [3281, 3413, 0]);
        assert.equal(sender.getVarbit(varbitId("varlamore_visited")), 0, "logging out before landing does not grant a visit");
      }
      else {
        assert.equal(dialogueStarts.length, menus, "a returning visitor does not repeat the introduction");
        tick(7);
        assert.deepEqual(at(loaded.getLocation()), [1700, 3141, 0]);
        assert.equal(sender.getVarbit(varbitId("quetzal_last_destination")), 7, "Primio leaves Renu's last destination unchanged");
      }
    }
  } finally {
    Common.init(api);
    completeQuests = new Set();
  }
});

test("native saved Renu owners can fly to Auburnvale and use its published bird to return; locked Varrock refuses", async (t) => {
  const core = PluginManager.getCoreApi();
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  const { NpcSpawnDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
  new NpcDefinitionLoader().load();
  core.RegionManager.init();
  for (const [x, y] of [[1697, 3140], [1411, 3361], [3281, 3413]]) core.RegionManager.loadMapFiles(x, y);
  const nativeApi = PluginManager.createApi("Quetzal native return regression");
  require("../plugins/npcs/NpcSpawns.plugin").register(nativeApi);
  Quetzals.register(nativeApi);
  require("../plugins/modes/league/Common.LeagueMode").init(nativeApi);
  require("../plugins/modes/league/Account.LeagueMode")(nativeApi);
  require("../plugins/modes/LeagueAreaUnlocks.plugin").register(nativeApi);
  require("../plugins/quests/quests/ChildrenOfTheSun.Quest")(nativeApi);
  const league = require("../plugins/modes/leagueareas/Common.LeagueAreaUnlocks");
  const loader = new NpcSpawnDefinitionLoader();
  loader.load();
  const channel = { kind: "test", binaryTransport: true, remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  let player = new Player(session, new Location(1697, 3140));
  session.setPlayer(player);
  Renu.unlock({ player });
  Common.setVarbits(player, { quetzal_base_appearance: 3, quetzal_auburnvalley: 0 });
  const save = PlayerSave.fromPlayer(player);
  save.attributes = JSON.parse(JSON.stringify(save.attributes));
  player = new Player(session);
  session.setPlayer(player);
  save.applyToPlayer(player);
  player.setUsername("quetzal-return-native");
  player.setAttribute(require("../plugins/bots/runtime/PersistenceConstants.PlayerBots").ATTR_SKIP_PERSISTENCE, true);
  // World registration/sync without account-file lifecycle or opening a socket.
  t.mock.method(player, "onAdd", () => {});
  t.mock.method(player, "onRemove", () => {});
  const messages = [];
  const send = player.sendMessage.bind(player);
  t.mock.method(player, "sendMessage", text => { messages.push(text); return send(text); });
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) core.World.process();
    session.flushPackets();
  };
  const connection = new ClientConnection(channel);
  connection.player = player;
  const input = async (raw) => { await connection.handle(raw); connection.processTurnPackets(); };
  const npcPacket = npc => Buffer.from([76, 0, npc.getIndex() >>> 8, (npc.getIndex() + 128) & 255]);
  const travel = async (npc) => {
    assert.equal(npc.getCurrentDefinition(player).getActions()[0], "Travel");
    const raw = npcPacket(npc);
    assert.deepEqual(decodeClientPackets(raw), [{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
    await input(raw);
    tick();
    assert.equal(player.getInterfaceId(), 874);
  };
  const select = async (siteId) => {
    const raw = Buffer.alloc(9);
    raw[0] = 23; // Native IF_BUTTON1, with the cache table's site slot.
    raw.writeUInt32BE(icons("quetzal_menu"), 1);
    raw.writeUInt16BE(Common.landingSites().findIndex(entry => entry.id === siteId), 5);
    raw.writeUInt16BE(65535, 7);
    await input(raw);
  };
  try {
    assert.equal(core.World.getPlayers().add(player), true);
    player.setNeedsPlacement(false);
    player.setRunning(false);
    assert.equal(Common.varbit(player, "quetzal_auburnvalley"), 0, "the loaded save predates the site");
    PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
    assert.equal(Common.varbit(player, "quetzal_auburnvalley"), 3, "real login restores the owner's colour");
    tick(3);
    const fortis = core.World.getNpcsNear(player.getLocation(), 15).find(npc => npc.getId() === 13355);
    assert.ok(fortis);
    await travel(fortis);
    await select(13);
    await select(13); // Duplicate input cannot schedule a second flight.
    tick(7);
    assert.deepEqual(at(player.getLocation()), [1411, 3361, 0]);
    const birds = [...core.World.getNpcs()].filter(npc => npc.getId() === 14690);
    assert.equal(birds.length, 1, "the canonical source activates the captured return bird");
    const bird = birds[0];
    assert.deepEqual(at(bird.getLocation()), [1410, 3362, 0]);
    assert.equal(player.getLocalNpcs().filter(npc => npc.getId() === 14690).length, 1, "World sync publishes the bird");
    assert.equal(bird.getCurrentDefinition(player).getId(), 13352, "the cache resolves the saved colour");
    assert.equal(Renu.flying(player), false);
    await travel(bird);
    await select(1);
    tick(7);
    assert.deepEqual(at(player.getLocation()), [1697, 3140, 0]);
    assert.equal(Common.varbit(player, "quetzal_last_destination"), 1);
    assert.equal(Common.varbit(player, "busy"), 0);
    assert.equal(player.getMovementQueue().isMovementBlocked(), false);

    // Varrock belongs to Primio's route; its existing league guard already sends the refusal.
    player.moveTo(new Location(1702, 3142));
    tick(2);
    player.setProfile("league");
    player.setAttribute("league:type", 6);
    player.setAttribute(league.AREAS_ATTRIBUTE, [league.areaByName("Varlamore").id]);
    player.setAttribute("quest.children_of_the_sun.stage", 24);
    player.getPacketSender().sendVarbit(varbitId("varlamore_visited"), 1);
    const primio = core.World.getNpcsNear(player.getLocation(), 15).find(npc => npc.getId() === 12889);
    assert.ok(primio);
    await input(npcPacket(primio));
    tick(8);
    assert.ok(messages.includes("You haven't unlocked that area yet."));
    assert.deepEqual(at(player.getLocation()), [1702, 3142, 0]);
    assert.equal(Renu.flying(player), false);
    assert.equal(Common.varbit(player, "busy"), 0);
  } finally {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    if (player.isRegistered()) core.World.getPlayers().remove(player);
    loader.applyToWorld([]);
    Common.init(api);
  }
});

test("every site's Renu stands on its landing site, facing the way the site does (#2449)", () => {
  // rsprox (226, 237): each site's quetzal_<site> NPC is added on its landing-site loc's tile.
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  const spawns = require("../data/definitions/npc-spawns.json");
  RegionManager.init();
  const npcNames = CacheDefinitions.getNpcNames();
  const locIds = [CacheDefinitions.getLocId("quetzal_landing_site_built")];
  for (const [id, name] of CacheDefinitions.getLocNames()) if (/^quetzal_landing_site_(?!built|unbuilt)/.test(name)) locIds.push(id);
  // Spawn directions (docs/npc-spawn-captures.md) for a loc's rotation: south, west, north, east.
  const facing = [1, 3, 6, 4];
  for (const varbit of Object.values(Common.SITE_VARBITS)) {
    const npc = [...npcNames].find(([, name]) => name === varbit)?.[0];
    assert.ok(npc !== undefined, `${varbit} is an NPC`);
    assert.equal(CacheDefinitions.getNpc(npc).transformVarbit, varbitId(varbit));
    const placed = spawns.filter((spawn) => spawn.id === npc);
    assert.equal(placed.length, 1, `${varbit} spawns once`);
    const [spawn] = placed;
    assert.equal(spawn.wanderRadius, 0);
    RegionManager.loadMapFiles(spawn.x, spawn.y);
    const loc = locIds.map((id) => MapObjects.get(id, new Location(spawn.x, spawn.y, spawn.level), null)).find(Boolean);
    assert.ok(loc, `${varbit} at ${spawn.x},${spawn.y} stands on a landing site`);
    assert.equal(spawn.direction ?? 1, facing[loc.getFace()], `${varbit} faces as its landing site`);
  }
});
