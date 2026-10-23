const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const core = require("../dist/plugins/PluginManager").PluginManager.getCoreApi();
const {Inventory} = require("../dist/game/model/container/impl/Inventory");
const TIERS = ["beginner", "easy", "medium", "hard", "elite", "master"];

function fixture(complete = true, members = true) {
  const actions = new Map(), events = new Map(), attributes = new Map(), persisted = new Map(), logins = [], sent = [];
  const banks = Array.from({length: core.Bank.TOTAL_BANK_TABS}, () => []);
  const sender = new Proxy({}, {get: (_, name) => (...args) => sent.push([name, ...args])});
  const player = {getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender, sendMessage: message => sent.push(["message", message]),
    getBank: tab => ({getItems: () => banks[tab]}), getUsername: () => "ClueCapacityTest"};
  const inventory = new Inventory(player);
  player.getInventory = () => inventory;
  const api = {core: {...core, WorldDefinition: {isMembersWorld: () => members}},
    persistAttribute: (key, value) => persisted.set(key, value), onPlayerLogin: fn => logins.push(fn),
    onItemAction: (name, handlers) => actions.set(name, handlers), onGroundItemPickup() {},
    onCustomEvent(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent(name, request) { for (const fn of events.get(name) ?? []) fn(request); },
  };
  api.onCustomEvent("quest:is-complete", request => { if (request.key === "x_marks_the_spot") request.complete = complete; });
  require("../plugins/treasuretrails/ClueCapacity.plugin").register(api);
  function query(name, payload) { api.emitCustomEvent(name, payload); return payload; }
  function capacity(tier) { return query("treasure-trails:capacity", {player, tier, capacity: null}).capacity; }
  function open(id, slot = 0) {
    const item = new core.Item(id); inventory.setItem(slot, item);
    return actions.get(core.ItemDefinition.forId(id).getName()).Open({player, slot, item, itemId: id});
  }
  return {player, inventory, banks, attributes, persisted, actions, api, logins, sent, query, capacity, open};
}

for (const tier of TIERS) test(`${tier} capacity requires the quest and each consumed case adds exactly one`, () => {
  const before = fixture(false);
  assert.equal(before.capacity(tier), 1);
  const f = fixture();
  assert.equal(f.capacity(tier), 2);
  f.open(core.ItemIdentifiers[`MINOR_${tier.toUpperCase()}_SCROLL_CASE`]);
  assert.equal(f.capacity(tier), 3);
  f.open(core.ItemIdentifiers[`MAJOR_${tier.toUpperCase()}_SCROLL_CASE`]);
  assert.equal(f.capacity(tier), 4);
  f.open(core.ItemIdentifiers.MIMIC_SCROLL_CASE);
  assert.equal(f.capacity(tier), 5);
  f.open(core.ItemIdentifiers.MIMIC_SCROLL_CASE);
  assert.equal(f.capacity(tier), 5);
  assert.equal(f.inventory.getItems()[0].getId(), core.ItemIdentifiers.MIMIC_SCROLL_CASE);
  for (const other of TIERS.filter(value => value !== tier)) assert.equal(f.capacity(other), 3);
});

test("saved beginner case attributes retain their meaning and login sends the cache varbits", () => {
  const f = fixture();
  f.attributes.set("treasure-trails:beginner-minor-case", true);
  f.attributes.set("treasure-trails:beginner-major-case", true);
  assert.equal(f.capacity("beginner"), 4);
  f.open(core.ItemIdentifiers.MIMIC_SCROLL_CASE);
  f.sent.length = 0;
  for (const fn of f.logins) fn({player: f.player});
  for (const name of ["scroll_case_beginner_minor", "scroll_case_beginner_major", "scroll_case_mimic"])
    assert.ok(f.sent.some(([method, id, value]) => method === "sendVarbit" && id === core.CacheDefinitions.getVarbitId(name) && value === 1));
  assert.equal(f.persisted.get("treasure-trails:beginner-minor-case"), false);
  assert.equal(f.persisted.get("treasure-trails:mimic-case"), false);
});

test("all tier receipt queries count banked forms and the global Mimic case benefit", () => {
  const f = fixture();
  for (const tier of TIERS) {
    const id = core.ItemIdentifiers[`SCROLL_BOX_${tier.toUpperCase()}_`];
    f.banks[0] = [new core.Item(id, 2)];
    assert.equal(f.query("treasure-trails:can-receive", {player: f.player, tier, allowed: null}).allowed, false);
  }
  f.open(core.ItemIdentifiers.MIMIC_SCROLL_CASE);
  for (const tier of TIERS) {
    f.banks[0] = [new core.Item(core.ItemIdentifiers[`SCROLL_BOX_${tier.toUpperCase()}_`], 2)];
    assert.equal(f.query("treasure-trails:can-receive", {player: f.player, tier, allowed: null}).allowed, true);
  }
});

test("NPC clue drops become boxes only after the quest and honor the shared cap", () => {
  for (const complete of [false, true]) {
    const f = fixture(complete);
    const scroll = core.ItemIdentifiers.CLUE_SCROLL_EASY_, box = core.ItemIdentifiers.SCROLL_BOX_EASY_;
    const drops = [{itemId: scroll, amount: 1}, {itemId: scroll, amount: 1}, {itemId: 995, amount: 10}];
    f.query("npc-drops:roll", {player: f.player, drops});
    assert.deepEqual(drops.filter(drop => drop.itemId !== 995).map(drop => [drop.itemId, drop.amount]), complete ? [[box, 1], [box, 1]] : [[scroll, 1]]);
    f.banks[0] = [new core.Item(complete ? box : scroll, complete ? 2 : 1)];
    const capped = [{itemId: scroll, amount: 1}]; f.query("npc-drops:roll", {player: f.player, drops: capped});
    assert.deepEqual(capped, []);
  }
});

test("boxes refuse a second active clue in bank or grave and preserve full stacks", () => {
  const f = fixture(), box = core.ItemIdentifiers.SCROLL_BOX_BEGINNER_, scroll = core.ItemIdentifiers.CLUE_SCROLL_BEGINNER_;
  const item = new core.Item(box, 2); f.inventory.setItem(0, item);
  const click = () => f.actions.get("Scroll box (beginner)").Open({player: f.player, slot: 0, item, itemId: box});
  f.banks[0] = [new core.Item(scroll)]; click(); assert.equal(item.getAmount(), 2);
  f.banks[0] = [];
  let grave = [{id: scroll, amount: 1}];
  f.api.onCustomEvent("gravestones:state", request => { request.grave = {items: grave}; request.office = []; });
  click(); assert.equal(item.getAmount(), 2);
  grave = [];
  for (let slot = 1; slot < 28; slot++) f.inventory.setItem(slot, new core.Item(385));
  click(); assert.equal(item.getAmount(), 2);
  f.inventory.setItem(1, new core.Item(-1, 0)); click();
  assert.equal(item.getAmount(), 1); assert.equal(f.inventory.getItems()[1].getId(), scroll);
  click(); assert.equal(item.getAmount(), 1);
});

test("Mimic case eligibility excludes held, banked and consumed copies; members cases cannot open on free worlds", () => {
  const f = fixture(), id = core.ItemIdentifiers.MIMIC_SCROLL_CASE;
  const eligible = () => f.query("treasure-trails:case-eligible", {player: f.player, itemId: id, eligible: null}).eligible;
  assert.equal(eligible(), true);
  f.banks[0] = [new core.Item(id)]; assert.equal(eligible(), false);
  f.banks[0] = []; f.inventory.setItem(0, new core.Item(id)); assert.equal(eligible(), false);
  f.open(id); assert.equal(eligible(), false);
  const free = fixture(true, false); free.open(id);
  assert.equal(free.capacity("beginner"), 2);
  assert.equal(free.inventory.getItems()[0].getId(), id);
  free.open(core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE); assert.equal(free.capacity("beginner"), 3);
});

test("free-world NPC drops cannot create members clues", () => {
  const f = fixture(true, false);
  assert.equal(f.query("treasure-trails:can-receive", {player: f.player, tier: "easy", allowed: null}).allowed, false);
  const drops = [{itemId: core.ItemIdentifiers.CLUE_SCROLL_EASY_, amount: 1},
    {itemId: core.ItemIdentifiers.CLUE_SCROLL_BEGINNER_, amount: 1}];
  f.query("npc-drops:roll", {player: f.player, drops});
  assert.deepEqual(drops.map(drop => drop.itemId), [core.ItemIdentifiers.SCROLL_BOX_BEGINNER_]);
});

test("real mining and woodcutting award boxes after the quest and empty nests land on the ground", () => {
  const f = fixture(), ground = [];
  f.api.core.ItemOnGroundManager = {registers: (_player, item) => ground.push(item)};
  f.player.getSkillManager = () => ({getCurrentLevel: () => 99});
  const nests = require("../plugins/skills/woodcutting/ClueNests.Woodcutting");
  const geodes = require("../plugins/skills/mining/ClueGeodes.Mining");
  nests.attach(f.api); geodes.attach(f.api);
  const original = Math.random;
  try { Math.random = () => 0; nests.rollClueNests(f.player, {petBase: 10000}); }
  finally { Math.random = original; }
  geodes.rollClueGeodes({player: f.player, skill: core.Skill.MINING, petBase: 10000}, () => 0);
  assert.equal(f.inventory.getAmount(core.ItemIdentifiers.SCROLL_BOX_BEGINNER_), 2);
  assert.equal(f.inventory.getAmount(core.ItemIdentifiers.CLUE_GEODE_BEGINNER_), 0);
  assert.deepEqual(ground.map(item => item.getId()), Array(5).fill(core.ItemIdentifiers.BIRD_NEST_6));
});

test("legacy vessels honor active clues before the quest and yield boxes after it", () => {
  for (const complete of [false, true]) {
    const f = fixture(complete);
    require("../plugins/skills/mining/ClueGeodes.Mining").attach(f.api);
    const id = core.ItemIdentifiers.CLUE_GEODE_BEGINNER_;
    const item = new core.Item(id); f.inventory.setItem(0, item);
    f.banks[0] = [new core.Item(core.ItemIdentifiers.CLUE_SCROLL_BEGINNER_)];
    f.actions.get("Clue geode (beginner)").Open({player: f.player, slot: 0, item, itemId: id});
    assert.equal(f.inventory.getItems()[0].getId(), complete ? core.ItemIdentifiers.SCROLL_BOX_BEGINNER_ : id);
  }
});

test("mining stacks a converted box into a full inventory while under the clue limit", () => {
  const f = fixture(), ground = [], box = core.ItemIdentifiers.SCROLL_BOX_BEGINNER_;
  f.api.core.ItemOnGroundManager = {registers: (_player, item) => ground.push(item)};
  f.player.getSkillManager = () => ({getCurrentLevel: () => 99});
  f.inventory.setItem(0, new core.Item(box));
  for (let slot = 1; slot < 28; slot++) f.inventory.setItem(slot, new core.Item(385));
  f.banks[0] = TIERS.slice(1).map(tier => new core.Item(core.ItemIdentifiers[`SCROLL_BOX_${tier.toUpperCase()}_`], 2));
  const geodes = require("../plugins/skills/mining/ClueGeodes.Mining"); geodes.attach(f.api);
  geodes.rollClueGeodes({player: f.player, skill: core.Skill.MINING, petBase: 10000}, () => 0);
  assert.equal(f.inventory.getAmount(box), 2); assert.deepEqual(ground, []);
});

for (const [module, name, idName] of [
  ["mining/ClueGeodes.Mining", "Clue geode (beginner)", "CLUE_GEODE_BEGINNER_"],
  ["woodcutting/ClueNests.Woodcutting", "Clue nest (beginner)", "CLUE_NEST_BEGINNER_"],
]) test(`${name} stale clicks through the actual source wrapper cannot grant or consume another item`, () => {
  const f = fixture(); require(`../plugins/skills/${module}`).attach(f.api);
  const id = core.ItemIdentifiers[idName], stale = new core.Item(id), held = new core.Item(id);
  f.inventory.setItem(1, held);
  const open = f.actions.get(name).Open;
  open({player: f.player, slot: 0, itemId: id, item: stale});
  assert.equal(f.inventory.getItems()[1], held);
  assert.equal(f.inventory.getAmount(core.ItemIdentifiers.CLUE_SCROLL_BEGINNER_), 0);
  assert.equal(f.inventory.getAmount(core.ItemIdentifiers.SCROLL_BOX_BEGINNER_), 0);
  f.inventory.setItem(0, new core.Item(385));
  f.api.emitCustomEvent = () => {}; // The legacy fallback must also reject stale snapshots.
  open({player: f.player, slot: 0, itemId: id, item: stale});
  assert.equal(f.inventory.getItems()[0].getId(), 385);
  assert.equal(f.inventory.getItems()[1], held);
});

test("impling and drift-net rewards choose boxes after the quest", () => {
  const C = require("../plugins/skills/hunter/Context.Hunter"), previous = {api: C.H.api, core: C.H.core}, random = Math.random;
  try {
    for (const complete of [false, true]) {
      const f = fixture(complete); C.H.api = f.api; C.H.core = core;
      f.player.getSkillManager = () => ({getMaxLevel: () => 99});
      Math.random = () => 0;
      const loot = require("../plugins/skills/hunter/Catching.Hunter").rewards(f.player, {key: "BABY"});
      assert.ok(loot.some(([id]) => id === core.ItemIdentifiers[`${complete ? "SCROLL_BOX" : "CLUE_SCROLL"}_BEGINNER_`]));
      let draws = [0.5, 0]; Math.random = () => draws.shift() ?? 0.5;
      const fish = require("../plugins/skills/hunter/DriftNets.Hunter").rewards(f.player, 1);
      assert.deepEqual(fish, [[core.ItemIdentifiers[`${complete ? "SCROLL_BOX" : "CLUE_BOTTLE"}_MEDIUM_`], 1]]);
    }
  } finally { C.H.api = previous.api; C.H.core = previous.core; Math.random = random; }
});

test("case registration retains consumed bonuses through the actual player save/load path", () => {
  const {Player} = require("../dist/game/entity/impl/player/Player");
  const {PlayerSave} = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const f = fixture();
  require("../plugins/treasuretrails/ClueCapacity.plugin").register({...f.api,
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value)});
  const player = new Player(null);
  player.setAttribute("treasure-trails:beginner-minor-case", true);
  player.setAttribute("treasure-trails:mimic-case", true);
  const loaded = new Player(null); PlayerSave.fromPlayer(player).applyToPlayer(loaded);
  assert.equal(loaded.getAttribute("treasure-trails:mimic-case"), true);
  assert.equal(loaded.getAttribute("treasure-trails:beginner-minor-case"), true);
  assert.equal(f.query("treasure-trails:capacity", {player: loaded, tier: "beginner", capacity: null}).capacity, 4);
  assert.equal(f.query("treasure-trails:capacity", {player: loaded, tier: "master", capacity: null}).capacity, 3);
});

test("retrieval owners expose stored items without consuming or changing them, and boxes respect them", () => {
  require("../plugins/skills/farming/Core.Farming").init({core});
  const sources = [
    [require("../plugins/bosses/zulrah/Shrine.Zulrah"), "zulrah:retrieval", {items: [[23182, 1]]}],
    [require("../plugins/bosses/nightmare/Retrieval.Nightmare"), "nightmare:held-items", {holder: "shura", items: [[23182, 1]]}],
    [require("../plugins/bosses/yama/Voice.Yama"), "yama:held-items", {items: [[23182, 1]]}],
    [require("../plugins/minigames/tob/Retrieval.TheatreOfBlood"), "tob:retrieval", [{id: 23182, amount: 1}]],
    [require("../plugins/skills/farming/Patches.Farming"), "farming:state", {deathbank: [{id: 23182, amount: 1, meta: {test: true}}]}],
  ];
  // Use each owner's actual attribute constant for Zulrah rather than guessing its namespace.
  sources[0][1] = require("../plugins/bosses/zulrah/Shared.Zulrah").ATTR.RETRIEVAL;
  for (const [owner, key, saved] of sources) {
    const f = fixture();
    f.attributes.set(key, saved);
    const before = JSON.stringify(saved);
    assert.equal(typeof owner.retrievalItems, "function", key);
    f.api.onCustomEvent("item-retrieval:items", owner.retrievalItems);
    const request = {player: f.player, items: []}; f.api.emitCustomEvent("item-retrieval:items", request);
    assert.deepEqual(request.items, [{itemId: 23182, amount: 1}], key);
    f.open(core.ItemIdentifiers.SCROLL_BOX_BEGINNER_);
    assert.equal(f.inventory.getItems()[0].getId(), core.ItemIdentifiers.SCROLL_BOX_BEGINNER_, key);
    assert.equal(JSON.stringify(saved), before, key);
  }
});

for (const [metadata, freeSlots, shouldOpen] of [[{source: "old"}, 0, false], [null, 0, true], [{source: "old"}, 1, true]]) {
  test(`nest opening reserves both outputs with ${JSON.stringify(metadata)} box metadata and ${freeSlots} free slots`, () => {
    const f = fixture(), I = core.ItemIdentifiers, box = I.SCROLL_BOX_BEGINNER_, nest = I.CLUE_NEST_BEGINNER_;
    require("../plugins/skills/woodcutting/ClueNests.Woodcutting").attach(f.api);
    const existing = new core.Item(box, 1, metadata), source = new core.Item(nest);
    f.inventory.setItem(0, existing); f.inventory.setItem(1, source);
    for (let slot = 2; slot < 28 - freeSlots; slot++) f.inventory.setItem(slot, new core.Item(385));
    const before = JSON.stringify(f.inventory.getItems());
    f.actions.get("Clue nest (beginner)").Open({player: f.player, slot: 1, itemId: nest, item: source});
    if (!shouldOpen) {
      assert.equal(JSON.stringify(f.inventory.getItems()), before, "failed reservation preserves the complete inventory");
      assert.equal(f.inventory.getAmount(I.BIRD_NEST_6), 0);
    } else {
      assert.equal(f.inventory.getAmount(nest), 0); assert.equal(f.inventory.getAmount(box), 2);
      assert.equal(f.inventory.getAmount(I.BIRD_NEST_6), 1, "the empty nest must never be lost");
      assert.deepEqual(existing.getMeta(), metadata);
    }
  });
}

for (const [name, idName] of [["Clue geode (beginner)", "CLUE_GEODE_BEGINNER_"],
  ["Clue bottle (beginner)", "CLUE_BOTTLE_BEGINNER_"], ["Clue nest (beginner)", "CLUE_NEST_BEGINNER_"]]) {
  test(`${name} preserves its source when the output's matching stack is capped`, () => {
    const f = fixture(), I = core.ItemIdentifiers;
    const {MAX_STACK_AMOUNT} = require("../dist/game/model/container/StackType");
    if (name.includes("geode")) require("../plugins/skills/mining/ClueGeodes.Mining").attach(f.api);
    if (name.includes("nest")) require("../plugins/skills/woodcutting/ClueNests.Woodcutting").attach(f.api);
    const source = new core.Item(I[idName]);
    f.inventory.setItem(0, new core.Item(I.SCROLL_BOX_BEGINNER_, MAX_STACK_AMOUNT));
    f.inventory.setItem(1, source);
    const before = JSON.stringify(f.inventory.getItems());
    f.actions.get(name).Open({player: f.player, slot: 1, itemId: I[idName], item: source});
    assert.equal(JSON.stringify(f.inventory.getItems()), before, "a capped output cannot consume the vessel even with free slots");
  });
}

test("vessel opening rechecks the clicked source after quest callbacks move it", () => {
  const f = fixture(), I = core.ItemIdentifiers, source = new core.Item(I.CLUE_BOTTLE_BEGINNER_);
  f.inventory.setItem(0, source);
  f.api.onCustomEvent("quest:is-complete", () => {
    f.inventory.setItem(0, new core.Item(385)); f.inventory.setItem(1, source);
  });
  f.actions.get("Clue bottle (beginner)").Open({player: f.player, slot: 0, itemId: source.getId(), item: source});
  assert.equal(f.inventory.getItems()[0].getId(), 385); assert.equal(f.inventory.getItems()[1], source);
  assert.equal(f.inventory.getAmount(I.SCROLL_BOX_BEGINNER_), 0);
});
