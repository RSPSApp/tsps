// Run after `yarn build`: node --test tests/mahogany-homes-contract-work.test.cjs
// Real cache, plugins, Player, NPC/object hooks and native dialogue continuation.
// Players/locations and an existing house are seeded; this does not cover walking or rendered UI.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
let core, Mahogany, Instance;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  Mahogany = require("../plugins/skills/construction/MahoganyHomes.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9250;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  const index = next++;
  p.setIndex(index); p.setUsername(`homes${index}`); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setAttribute("construction:house", Instance.createDefaultHouseSave());
  p.setAttribute("construction:contract-discussed", true);
  // Seed the restored client's native state too, as Mahogany Homes' login hook does.
  // The cache resolves Marlo to his Talk-to-only form until this varbit is set.
  const discussed = core.CacheDefinitions.getVarbitId("con_contract_discussed");
  p.getPacketSender().sendVarbit(discussed, 1);
  assert.equal(p.getPacketSender().getVarbit(discussed), 1, "restored client exposes contract actions");
  p.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 99, false)
    .setExperiences(core.Skill.CONSTRUCTION, 13034431, false).setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  t.after(() => { core.TaskManager.cancelTasks(p); p.getDialogueManager().reset(); p.setRegistered(false); });
  const displays = new Map();
  const sender = p.getPacketSender();
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value, ...rest) => { displays.set(id, value); return sendVarbit(id, value, ...rest); });
  return { p, displays };
}
function name(home) { return core.CacheDefinitions.getNpc(home.client).name; }
function homeFor(client) {
  const home = Mahogany.HOMES.find(h => name(h) === client);
  assert.ok(home, `${client} exists in active cache`);
  return home;
}
function npcEvent(p, id, option) {
  const npc = core.NPC.create(id, p.getLocation().clone());
  const definition = npc.getCurrentDefinition(p);
  const clickType = definition.getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} exposes ${option}`);
  return { player: p, npc, npcId: npc.getContentId(p), definition, clickType, handled: false };
}
function npcClick(p, id, option) {
  assert.equal(PM.emitNpcInteraction(npcEvent(p, id, option)), true);
}
function contract(p, home, tier, layout = 0, count = 3) {
  p.setAttribute("construction:contract", null);
  p.setAttribute("construction:contract-last-tier", tier);
  // Only the assignment call is under deterministic RNG; normal engine setup is untouched.
  const values = [(Mahogany.HOMES.indexOf(home) + 0.5) / Mahogany.HOMES.length, (layout + 0.5) / count];
  const event = npcEvent(p, core.CacheDefinitions.getNpcId("con_contractor_varrock"), "Last-tier contract");
  let calls = 0;
  const original = Math.random;
  Math.random = () => values[calls++] ?? 0;
  try { assert.equal(PM.emitNpcInteraction(event), true); }
  finally { Math.random = original; }
  const saved = p.getAttribute("construction:contract");
  assert.equal(saved.home, home.key, "the ordinary contractor route selected the intended home");
  assert.equal(saved.tier, tier, "and the requested tier");
  return structuredClone(saved);
}
function stateString(saved) { return Array.from({ length: 8 }, (_, i) => saved.states[i + 1] ?? 0).join(""); }
function drain(p) {
  const lines = [], dm = p.getDialogueManager();
  for (let count = 0; dm.isActive(); count++) {
    assert.ok(count < 25, "dialogue terminates");
    const current = dm.getCurrent();
    if (typeof current.getText === "function") lines.push(current.getText());
    const group = current instanceof core.PlayerDialogue ? 217 : 231;
    assert.equal(dm.handleResume((group << 16) | 5, -1), true, "native continue accepts displayed chatbox");
  }
  return lines;
}
// Supplied restored-contract checkpoint, including the client-side state that login sends.
function seedContract(p, saved) {
  p.setAttribute("construction:contract", structuredClone(saved));
  for (let index = 1; index <= 8; index++) {
    p.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(`con_contract_hotspot_${index}_display`), saved.states[index] ?? 0);
  }
}
function work(p, home, index, clickType) {
  const h = home.hotspots.find(h => h.index === index);
  assert.ok(h, `hotspot ${index} exists`);
  const at = p.getLocation().clone();
  const object = new core.GameObject(h.loc, at, 10, 0, null);
  const definition = core.ObjectDefinition.forPlayer(h.loc, p);
  const option = definition?.getInteractions()?.[clickType - 1]?.toLowerCase();
  assert.equal(option, { 2: "remove", 3: "repair", 4: "build" }[clickType], "the current cache variant exposes the requested operation");
  const location = { x: at.getX(), y: at.getY(), z: at.getZ() };
  // Match ObjectActionPacketListener's actual event, including generic quest consumers.
  assert.equal(PM.emitObjectInteraction({ player: p, object, definition, objectId: h.loc, clickType, option,
    location, sourceLocation: { ...location }, handled: false }), true);
}
function tools(p) {
  for (const id of [core.ItemIdentifiers.HAMMER, core.ItemIdentifiers.SAW]) p.getInventory().add(new core.Item(id, 1), false);
}

// Wiki Mechanics Beginner Jeff row1: shelf, bed, drawers, dresser, mirror, chair.
// Recording1863 rev227.1 lines88589-88820 gives the same successive checklist, not an item count.
test("a Beginner Jeff contract assigns a complete documented work order", (t) => {
  const { p, displays } = actor(t), home = homeFor("Jeff");
  const saved = contract(p, home, 0);
  assert.equal(stateString(saved), "00333313", "feature-absence target: a documented layout replaces independent piece rolls");
  for (let i = 1; i <= 8; i++) assert.equal(displays.get(core.CacheDefinitions.getVarbitId(`con_contract_hotspot_${i}_display`)), saved.states[i] ?? 0);
  assert.equal(p.getAttribute("construction:carpenter-points") ?? 0, 0, "assignment pays no completion reward");
});

test("the homeowner lists unfinished work and the native continues preserve the contract", (t) => {
  const { p } = actor(t), home = homeFor("Jeff");
  const saved = contract(p, home, 0);
  npcClick(p, home.client, "Talk-to");
  assert.deepEqual(drain(p), [
    "Hey, I'm your contractor from Mahogany Homes, what did you want done?",
    "I'd like a Wooden shelf built.", "I'd like a Wooden bed built.", "I'd like a Wooden drawer built.",
    "I'd like a Wooden dresser built.", "I'd like my mirror fixed.", "I'd like a Wooden chair built.",
  ]);
  assert.deepEqual(p.getAttribute("construction:contract"), saved);
  assert.equal(p.getAttribute("construction:carpenter-points") ?? 0, 0);
});

test("both contractor options preserve an unfinished saved contract, including legacy layouts", (t) => {
  const { p } = actor(t), home = homeFor("Jeff");
  // A legacy individually rolled layout and removed space remain actionable after the update.
  const saved = { home: home.key, tier: 0, states: { 3: 4, 7: 1 } };
  seedContract(p, saved);
  p.setAttribute("construction:contract-last-tier", 0);
  for (const option of ["Contract", "Last-tier contract"]) {
    npcClick(p, core.CacheDefinitions.getNpcId("con_contractor_varrock"), option);
    assert.deepEqual(p.getAttribute("construction:contract"), saved, `${option} cannot abandon work`);
    assert.match(drain(p)[0], /already working for Jeff/);
  }
  tools(p);
  work(p, home, 3, 4); // no planks: refused without losing the removed space
  assert.deepEqual(p.getAttribute("construction:contract"), saved);
});

test("worklists track removal, rebuild and repair; another player's state and rewards stay isolated", (t) => {
  const a = actor(t), b = actor(t), home = homeFor("Jeff");
  const saved = contract(a.p, home, 0);
  assert.equal(stateString(saved), "00333313", "the documented work order precedes object actions");
  seedContract(b.p, saved);
  tools(a.p); tools(b.p);
  // Only the first assigned object is removed. It must still appear on the worklist.
  work(a.p, home, 3, 2);
  assert.equal(a.p.getAttribute("construction:contract").states[3], 4);
  assert.equal(b.p.getAttribute("construction:contract").states[3], 3);
  assert.equal(b.p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId("con_contract_hotspot_3_display")), 3);
  npcClick(a.p, home.client, "Talk-to");
  assert.ok(drain(a.p).includes("I'd like a Wooden shelf built."));
  // Beginner Jeff row1 costs 11 planks:2+3+2+2+1+1, including the mirror repair.
  a.p.getInventory().add(new core.Item(core.ItemIdentifiers.PLANK, 11), false);
  for (const hotspot of home.hotspots) {
    let state = a.p.getAttribute("construction:contract").states[hotspot.index];
    if (state === 3) work(a.p, home, hotspot.index, 2);
    state = a.p.getAttribute("construction:contract").states[hotspot.index];
    if (state === 4) work(a.p, home, hotspot.index, 4);
    else if (state === 1) work(a.p, home, hotspot.index, 3);
  }
  assert.equal(a.p.getInventory().getAmount(core.ItemIdentifiers.PLANK), 0);
  assert.equal(Object.values(a.p.getAttribute("construction:contract").states).some(s => [1, 3, 4].includes(s)), false);
  assert.deepEqual(b.p.getAttribute("construction:contract"), saved);
  assert.equal(a.p.getAttribute("construction:carpenter-points") ?? 0, 0, "work alone does not award the contract");
  npcClick(a.p, home.client, "Talk-to"); drain(a.p);
  assert.equal(a.p.getAttribute("construction:contract"), null);
  assert.equal(a.p.getAttribute("construction:carpenter-points"), 2);
  assert.equal(a.p.getAttribute("construction:contracts-completed"), 1);
  npcClick(a.p, home.client, "Talk-to"); drain(a.p);
  assert.equal(a.p.getAttribute("construction:carpenter-points"), 2, "repeat talk cannot repay the contract");
  assert.equal(b.p.getAttribute("construction:carpenter-points") ?? 0, 0);
});


test("an above-level assignment is refused before state or rewards change", (t) => {
  const { p } = actor(t);
  p.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 1, false);
  p.setAttribute("construction:contract-last-tier", 3);
  npcClick(p, core.CacheDefinitions.getNpcId("con_contractor_varrock"), "Last-tier contract");
  assert.equal(p.getAttribute("construction:contract") ?? null, null);
  assert.match(drain(p)[0], /Construction level of 70/);
  assert.equal(p.getAttribute("construction:carpenter-points") ?? 0, 0);
});

test("all 137 distinct documented work orders are reachable at every client/tier and match active-cache hotspots", (t) => {
  // Rule-derived table, independent of the production module so the same native fixture
  // can run on the baseline without importing a feature that does not yet exist.
  // Wiki Mechanics oldid15141725; full domain checked against the cache in this test.
  const layouts = {
  "Jess": [
    [
      "33330011",
      "00333310",
      "33003310"
    ],
    [
      "33003310",
      "00333310",
      "33330011"
    ],
    [
      "33333010",
      "33333311",
      "33333011"
    ],
    [
      "33333301",
      "33333311",
      "33333310"
    ]
  ],
  "Noella": [
    [
      "33103301",
      "33010331",
      "00113331"
    ],
    [
      "33103301",
      "00113331",
      "33010331"
    ],
    [
      "33013330",
      "33113331",
      "33113300"
    ],
    [
      "33013331",
      "33113331",
      "33113301"
    ]
  ],
  "Ross": [
    [
      "13331000",
      "03331310",
      "03301310"
    ],
    [
      "03331310",
      "13331000",
      "03301310"
    ],
    [
      "13301310",
      "13331310",
      "13331000"
    ],
    [
      "03331310",
      "13331310",
      "13331300"
    ]
  ],
  "Larry": [
    [
      "03331300",
      "13331000",
      "03331310"
    ],
    [
      "03331310",
      "13331000",
      "03331300"
    ],
    [
      "03331300",
      "13301310",
      "13331310"
    ],
    [
      "03331310",
      "13331310"
    ]
  ],
  "Norman": [
    [
      "01333300",
      "11330330"
    ],
    [
      "10333300",
      "11330330",
      "01333300"
    ],
    [
      "11333330",
      "01330330",
      "10303330"
    ],
    [
      "11333330",
      "10333330",
      "01333330"
    ]
  ],
  "Tau": [
    [
      "10333300",
      "13033310",
      "13033010",
      "03333300"
    ],
    [
      "03333300",
      "13033010",
      "13033310"
    ],
    [
      "03333300",
      "03333310",
      "13033300"
    ],
    [
      "13333300",
      "03333310",
      "13333310"
    ]
  ],
  "Barbara": [
    [
      "10333000",
      "11000330",
      "01333000"
    ],
    [
      "01333000",
      "11000330",
      "10333000"
    ],
    [
      "01333330",
      "10333330",
      "11333330"
    ],
    [
      "11333330",
      "10333330",
      "01333330"
    ]
  ],
  "Leela": [
    [
      "00033130",
      "33130100",
      "00133130"
    ],
    [
      "00133130",
      "00033130",
      "33130100"
    ],
    [
      "33030130",
      "33130130",
      "00133130"
    ],
    [
      "33033130",
      "33133130",
      "33133030"
    ]
  ],
  "Mariah": [
    [
      "31333300",
      "00033331",
      "01333001"
    ],
    [
      "31333300",
      "00033331",
      "01333001"
    ],
    [
      "30330331",
      "31333331",
      "31333300"
    ],
    [
      "31333331",
      "30333331",
      "31333330"
    ]
  ],
  "Bob": [
    [
      "30303333",
      "31330033",
      "31333300"
    ],
    [
      "31333300",
      "30303333",
      "31330033"
    ],
    [
      "30303333",
      "31333333",
      "31330033"
    ],
    [
      "31333333",
      "30333333"
    ]
  ],
  "Jeff": [
    [
      "00333313",
      "33300313",
      "33333010"
    ],
    [
      "00333313",
      "33333010",
      "33300313"
    ],
    [
      "33333313",
      "33300313",
      "33333010"
    ],
    [
      "33333313",
      "33333303"
    ]
  ],
  "Sarah": [
    [
      "33331300",
      "33330300"
    ],
    [
      "33331300",
      "33330300"
    ],
    [
      "33331300",
      "33330300"
    ],
    [
      "33331300",
      "33330300"
    ]
  ]
};
  const { p } = actor(t);
  assert.equal(Mahogany.HOMES.length, 12);
  assert.equal(Object.values(layouts).flat(2).length, 137);
  assert.deepEqual(layouts.Norman.map(x => x.length), [2, 3, 3, 3]);
  assert.deepEqual(layouts.Tau.map(x => x.length), [4, 3, 3, 3]);
  assert.deepEqual(layouts.Sarah.map(x => x.length), [2, 2, 2, 2]);
  assert.equal(layouts.Bob[3].length, 2); assert.equal(layouts.Jeff[3].length, 2);
  assert.equal(layouts.Larry[3].length, 2, "the repeated Wiki row is not a third distinct work order");
  for (const home of Mahogany.HOMES) {
    const orders = layouts[name(home)];
    assert.equal(orders.length, 4);
    orders.forEach((tierOrders, tier) => tierOrders.forEach((order, ordinal) => {
      assert.match(order, /^[013]{8}$/);
      const saved = contract(p, home, tier, ordinal, tierOrders.length);
      assert.equal(stateString(saved), order, `${name(home)} tier${tier} order${ordinal}`);
      assert.ok(Object.keys(saved.states).length > 0);
      for (let index = 1; index <= 8; index++) {
        if (!saved.states[index]) continue;
        const hotspot = home.hotspots.find(h => h.index === index);
        assert.ok(hotspot, `${name(home)} slot${index} exists in active cache`);
        assert.equal(saved.states[index], hotspot.buildable ? 3 : 1, "work agrees with cache repair/build affordance");
        const transforms = core.CacheDefinitions.getObject(hotspot.loc).transforms;
        const display = transforms[hotspot.buildable ? 5 + tier : 1];
        assert.ok(core.CacheDefinitions.getObject(display)?.name, "worklist display label exists at the selected tier");
      }
      p.getDialogueManager().reset();
    }));
  }
});

test("a documented range repair refuses missing steel without spending planks and consumes one bar on success", (t) => {
  const { p } = actor(t), home = homeFor("Sarah");
  const saved = contract(p, home, 0, 0, 2);
  assert.equal(stateString(saved), "33331300");
  tools(p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.PLANK, 1), false);
  const xp = () => p.getSkillManager().skills.experience[core.Skill.CONSTRUCTION.getIndex()];
  const before = xp();
  work(p, home, 5, 3);
  assert.deepEqual(p.getAttribute("construction:contract"), saved);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.PLANK), 1);
  assert.equal(xp(), before);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.STEEL_BAR, 1), false);
  work(p, home, 5, 3);
  assert.equal(p.getAttribute("construction:contract").states[5] ?? 0, 0);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STEEL_BAR), 0);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.PLANK), 1);
  assert.equal(Math.round((xp() - before) * 10) / 10, 120);
  assert.equal(p.getAttribute("construction:carpenter-points") ?? 0, 0);
});


test("duplicate requests use tiered dialogue nouns and update after one of a pair is built", (t) => {
  const { p } = actor(t), home = homeFor("Bob");
  const saved = contract(p, home, 0);
  assert.equal(stateString(saved), "30303333", "documented Bob order is established before object actions");
  npcClick(p, home.client, "Talk-to");
  const first = drain(p);
  assert.ok(first.includes("I'd like two Wooden bookcases built."));
  assert.ok(first.includes("I'd like a Wooden cabinet built."));
  assert.equal(first.filter(line => line.includes("bookcase")).length, 1);
  tools(p);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.PLANK, 2), false);
  work(p, home, 5, 2); // the first bookcase becomes an empty space, still requiring work
  npcClick(p, home.client, "Talk-to");
  assert.ok(drain(p).includes("I'd like two Wooden bookcases built."));
  work(p, home, 5, 4);
  npcClick(p, home.client, "Talk-to");
  const last = drain(p);
  assert.ok(last.includes("I'd like a Wooden bookcase built."));
  assert.ok(!last.includes("I'd like two Wooden bookcases built."));
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.PLANK), 0);
  assert.equal(p.getAttribute("construction:carpenter-points") ?? 0, 0);
});
