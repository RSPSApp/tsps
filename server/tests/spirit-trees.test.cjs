// Run after `yarn build`: node --test tests/spirit-trees.test.cjs
// The spirit tree network and Fossil Island's Magic Mushtrees (docs/spirit-trees.md), as the
// rsprox captures show them: the menu, the choice, and the move.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const SpiritTrees = require("../plugins/world/SpiritTrees.plugin");
const MagicMushtrees = require("../plugins/world/MagicMushtrees.plugin");
const { Dialogue } = require("../dist/game/model/dialogues/entries/Dialogue");

let quests = [];
QuestRuntime.getRegisteredQuests = () => quests;

let core;
let grown = [];
let loginHook = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  const api = {
    core,
    persistAttribute() {},
    onObjectInteraction() {},
    onInterfaceActionClick() {},
    onCustomEvent() {},
    onPlayerLogin: (hook) => { loginHook = hook; },
    emitCustomEvent: (name, request) => {
      if (name === "spirit-trees:grown") request.patches.push(...grown);
    },
  };
  SpiritTrees.register(api);
  MagicMushtrees.register(api);
});

/** A real player whose packets are recorded per tick. */
function traveller(at) {
  const player = new Player(null);
  player.setUsername(`traveller${Math.random()}`);
  player.setLocation(new core.Location(...at));
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "sendClientScript") return (id, ...args) => (log(`script ${id} ${JSON.stringify(args)}`), sender);
      if (key === "sendSubInterface") return (uid, id) => (log(`open ${id}`), sender);
      if (key === "closeSubInterface") return (uid) => (log(`close ${uid >>> 16}:${uid & 0xffff}`), sender);
      if (key === "sendChatboxInterface") return (id) => (log(`chatbox ${id}`), sender);
      if (key === "sendString") return (text, uid) => (log(`text ${uid >>> 16}:${uid & 0xffff} ${text}`), sender);
      if (key === "sendTypedMessage") return (type, text) => (log(`chat ${type} ${text}`), sender);
      if (key === "sendItemOnInterfaces") return (uid, item, zoom) => (log(`item ${uid >>> 16}:${uid & 0xffff} ${item} ${zoom}`), sender);
      if (key === "sendInterfaceFlagsRange") return (uid, from, to, flags) => (log(`events ${uid >>> 16}:${uid & 0xffff} ${from}..${to} ${flags}`), sender);
      if (key === "sendVarbit") return (id, value) => (log(`varbit ${id}=${value}`), sender);
      if (key === "sendSound") return (id) => (log(`sound ${id}`), sender);
      if (key === "sendInterfaceScript") return (id) => (id === 2158 && log("restore chat input"), sender);
      if (key === "getVarbit" || key === "getVarp") return () => 0;
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => log(`message ${text}`);
  player.performAnimation = (animation) => log(`anim ${animation.getId()}`);
  player.isRegistered = () => true;
  const moveTo = player.moveTo.bind(player);
  player.moveTo = (location) => (log(`move ${location.getX()},${location.getY()},${location.getZ()}`), moveTo(location));
  const spoken = [];
  // What the tree says: each chain's lines, in order.
  player.getDialogueManager().startDialogues = (chain) => {
    const entries = [...chain.getDialogues().values()];
    spoken.push(entries.map((entry) => entry.text ?? "").join(" / "));
    const box = entries.find((entry) => entry instanceof core.ItemStatementDialogue);
    if (!box) return;
    // The box logs its own chat line as it opens, as the real one does.
    Dialogue.sendBoxChatLine(player, box.getText());
    log(`item box ${box.getItemId()} ${box.getText()}`);
  };
  return { player, ticks, spoken, nextTick: () => ticks.push([]) };
}

function runTicks(visit, count) {
  for (let i = 0; i < count; i++) {
    visit.nextTick();
    core.TaskManager.process();
  }
}

const tree = (x, y, z = 0) => ({ getLocation: () => new core.Location(x, y, z), getId: () => 0 });
const choose = (visit, group, child, action) => {
  const event = { player: visit.player, groupId: group, childId: child, action, handled: false };
  (group === 187 ? SpiritTrees : MagicMushtrees)._test[group === 187 ? "chooseTree" : "chooseMushtree"](event);
  return event.handled;
};

test("the menu lists every tree in the game's order, greying out those the player can't use", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  grown = [];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  const menu = visit.ticks[0].find((line) => line.startsWith("script 217"));
  assert.equal(menu, `script 217 ${JSON.stringify(["Spirit Tree Locations", [
    "Tree Gnome Village", "Gnome Stronghold", "Battlefield of Khazard", "Grand Exchange", "Feldip Hills", "Prifddinas",
    "<col=5f5f5f>Port Sarim</col>", "<col=5f5f5f>Etceteria</col>", "<col=5f5f5f>Brimhaven</col>", "<col=5f5f5f>Hosidius</col>",
    "<col=5f5f5f>Farming Guild</col>", "<col=5f5f5f>Your house</col>", "Poison Waste", "<col=5f5f5f>Laguna Aurorae</col>", "Cancel",
  ].join("|"), 1])}`, "grown trees aren't grown; Laguna Aurorae needs 58 Sailing");
  assert.ok(visit.ticks[0].includes("open 187"));
});

const BARK = "You place your hands on the dry tough bark of the spirit tree, and feel a surge of energy run through your veins.";
const BARK_BOX = "You place your hands on the dry tough bark of the<br>spirit tree, and feel a surge of energy run through<br>your veins.";

test("choosing a tree: the bark box and the reach, the move two ticks later, then the box with its continue button", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  visit.ticks.length = 0;
  visit.nextTick();
  assert.equal(choose(visit, 187, 3, 1), true, "slot 1: Gnome Stronghold");
  runTicks(visit, 3);
  assert.deepEqual(visit.ticks, [
    ["close 161:16", "restore chat input", "varbit 20252=2", `chat 115 ${BARK}`, "chatbox 193", 'script 2868 [""]',
      "events 193:0 -1..-1 0", "item 193:1 6063 400", `text 193:2 ${BARK_BOX}`, "anim 828"],
    [],
    ["move 2461,3444,0"],
    [`chat 115 ${BARK}`, `item box 6063 ${BARK_BOX}`],
  ]);
  assert.equal(visit.player.getMovementQueue().isMovementBlocked(), false, "free to walk once the box shows");
});

test("the player can't walk off between the landing and the second box", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  choose(visit, 187, 3, 4);
  const movement = visit.player.getMovementQueue();
  runTicks(visit, 2);
  assert.equal(movement.isMovementBlocked(), true, "held still on the landing tick");
  runTicks(visit, 1);
  assert.equal(movement.isMovementBlocked(), false);
});

test("a trip started on the landing tick takes over: the first trip's box doesn't open over it", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  choose(visit, 187, 3, 4);
  runTicks(visit, 2);
  visit.ticks.length = 0;
  visit.nextTick();
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(2488, 2850) });
  choose(visit, 187, 3, 3);
  runTicks(visit, 1);
  assert.ok(!visit.ticks[1].some((line) => line.startsWith("item box")), "no box from the first trip");
  assert.equal(visit.player.getMovementQueue().isMovementBlocked(), true, "still held for the second trip");
  runTicks(visit, 2);
  assert.deepEqual(visit.ticks.slice(2), [["move 3185,3508,0"], [`chat 115 ${BARK}`, `item box 6063 ${BARK_BOX}`]]);
  assert.equal(visit.player.getMovementQueue().isMovementBlocked(), false);
});

test("spirit_tree_previous: the last tree's menu slot plus one, sent again on login", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  choose(visit, 187, 3, 4);
  assert.ok(visit.ticks.flat().includes("varbit 20252=5"), "Feldip Hills, slot 4");
  runTicks(visit, 3);
  visit.ticks.length = 0;
  visit.nextTick();
  loginHook({ player: visit.player });
  assert.deepEqual(visit.ticks, [["varbit 20252=5"]]);
  const fresh = traveller([3185, 3508, 0]);
  loginHook({ player: fresh.player });
  assert.deepEqual(fresh.ticks, [[]], "nothing before the first trip");
});

test("a greyed tree, or the tree the player is at, makes the tree speak instead", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  choose(visit, 187, 3, 6);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  choose(visit, 187, 3, 3);
  const lines = visit.spoken;
  assert.match(lines[0], /You cannot travel to that land at this time\./, "Port Sarim isn't grown");
  assert.match(lines[1], /You're already here\./, "at the Grand Exchange's tree");
});

test("a grown, checked spirit tree patch is offered, and lands where the capture shows", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  grown = [{ x: 3059, y: 3257, z: 0 }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  assert.ok(!visit.ticks[0].find((line) => line.startsWith("script 217")).includes("5f5f5f>Port Sarim"));
  choose(visit, 187, 3, 6);
  runTicks(visit, 2);
  assert.ok(visit.ticks.flat().includes("move 3058,3257,0"));
  grown = [];
});

test("the network needs Tree Gnome Village; leaving the Stronghold needs The Grand Tree", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => false }];
  const locked = traveller([3185, 3508, 0]);
  SpiritTrees._test.travelOption({ player: locked.player, object: tree(3184, 3509) });
  assert.match(locked.ticks.flat().join("\n"), /Tree Gnome Village/);
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }, { name: "The Grand Tree", isComplete: () => false }];
  const stronghold = traveller([2461, 3444, 0]);
  SpiritTrees._test.travelOption({ player: stronghold.player, object: tree(2460, 3446) });
  assert.match(stronghold.ticks.flat().join("\n"), /The Grand Tree/);
  assert.ok(!stronghold.ticks.flat().includes("open 187"));
});

test("Last-destination: the first time the tree asks; then straight to the last tree", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.lastDestinationOption({ player: visit.player, object: tree(3184, 3509) });
  assert.match(visit.spoken[0], /This once, you will have to tell me where you wish to go/);
  SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
  choose(visit, 187, 3, 4);
  runTicks(visit, 2);
  visit.player.setLocation(new core.Location(3185, 3508, 0));
  visit.ticks.length = 0;
  visit.nextTick();
  SpiritTrees._test.lastDestinationOption({ player: visit.player, object: tree(3184, 3509) });
  runTicks(visit, 2);
  assert.ok(visit.ticks.flat().includes("move 2488,2850,0"), "Feldip Hills again");
});

test("every landing tile can be stood on", () => {
  for (const entry of [...SpiritTrees._test.loadTrees(), ...MagicMushtrees._test.mushtrees]) {
    if (!entry.landing) continue;
    const [x, y, z] = entry.landing;
    core.RegionManager.loadMapFiles(x, y);
    assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false, `${entry.name} ${entry.landing}`);
  }
});

test("a Magic Mushtree opens its interface with the four names, and crawls to the chosen one", () => {
  const visit = traveller([3760, 3758, 0]);
  MagicMushtrees._test.useMushtree({ player: visit.player, object: tree(3758, 3756) });
  assert.deepEqual(visit.ticks[0].filter((line) => line.startsWith("text")), [
    "text 608:5 <col=8f8f8f>1.</col> House on the Hill", "text 608:9 <col=8f8f8f>2.</col> Verdant Valley",
    "text 608:13 <col=8f8f8f>3.</col> Sticky Swamp", "text 608:17 <col=8f8f8f>4.</col> Mushroom Meadow",
  ]);
  choose(visit, 608, 8, 0);
  assert.deepEqual(visit.ticks[0].slice(-1), ["message You are already at that Magic Mushtree."], "Verdant Valley is this one");
  assert.equal(choose(visit, 608, 16, 0), true);
  assert.deepEqual(visit.ticks[0].slice(-1), ["message You haven't discovered that Magic Mushtree yet."], "not used yet");
  // Used once (Wiki: "After attempting to use them, the location will be unlocked").
  MagicMushtrees._test.useMushtree({ player: visit.player, object: tree(3674, 3871) });
  assert.equal(MagicMushtrees._test.discovered(visit.player, 3), true);
  assert.equal(visit.player.getAttribute(MagicMushtrees._test.DISCOVERED_ATTRIBUTE), 0b1010, "Verdant Valley and Mushroom Meadow");
  MagicMushtrees._test.useMushtree({ player: visit.player, object: tree(3758, 3756) });
  visit.ticks.length = 0;
  visit.nextTick();
  assert.equal(choose(visit, 608, 16, 0), true, "Mushroom Meadow");
  runTicks(visit, 6);
  assert.deepEqual(visit.ticks, [["anim 844", "sound 2266", "open 174", "close 161:16", "restore chat input"], [], [], ["move 3676,3871,0"], ["open 174"], [], ["close 161:1"]]);
});

test("Talk-to: the tree greets the player, then the menu opens", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([3185, 3508, 0]);
  SpiritTrees._test.talkToOption({ player: visit.player, object: tree(3184, 3509) });
  assert.match(visit.spoken[0], /Hello gnome friend\. Where would you like to go\?/);
});

test("\"Spirit Tree\" is the Poison Waste tree's name and the farming patches': only the listed tree is taken", () => {
  quests = [{ name: "Tree Gnome Village", isComplete: () => true }];
  const visit = traveller([2339, 3109, 0]);
  const event = { player: visit.player, object: tree(2338, 3110), handled: false };
  assert.equal(SpiritTrees._test.ownTreeTravel(event), true);
  assert.ok(visit.ticks.flat().includes("open 187"));
  const patch = { player: traveller([3061, 3257, 0]).player, object: tree(3060, 3258) };
  assert.equal(SpiritTrees._test.ownTreeTravel(patch), false, "Port Sarim's patch stays Farming's");
});

test("Poison Waste opens once the crystal chime heals Incomitatus (stage 38), before The Path of Glouphrie is complete", () => {
  grown = [];
  const menuFor = (stage) => {
    quests = [
      { name: "Tree Gnome Village", isComplete: () => true },
      { name: "The Path of Glouphrie", isComplete: () => stage >= 50, getStage: () => stage },
    ];
    const visit = traveller([3185, 3508, 0]);
    SpiritTrees._test.travelOption({ player: visit.player, object: tree(3184, 3509) });
    return visit.ticks[0].find((line) => line.startsWith("script 217"));
  };
  assert.ok(menuFor(37).includes("<col=5f5f5f>Poison Waste</col>"), "greyed before the chime");
  assert.ok(menuFor(38).includes("|Poison Waste|"), "open once chimed (Wiki: Spirit Tree (Incomitatus))");
  assert.ok(menuFor(50).includes("|Poison Waste|"));
});
