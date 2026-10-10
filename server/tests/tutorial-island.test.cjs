// Run after `yarn build`: node --test tests/tutorial-island.test.cjs
// Tutorial Island as recorded on OSRS (docs/tutorial-island.md): progress is the `tutorial` varp,
// hand-outs arrive with the step they complete, tab clicks and the island's own skilling move the
// steps on, and the Ironman tutor's setup sets the mode (plugins/areas/tutorialisland/,
// plugins/modes/ironman/Setup.Ironman.js).
const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const ROOT = path.resolve(__dirname, "..");
const ITEM = { NET: 303, AXE: 1351, TINDERBOX: 590, PICKAXE: 1265, AIR: 556, MIND: 558, TUTORIAL_LOGS: 2511, TUTORIAL_RAW_SHRIMPS: 2514 };
const NPC = { SURVIVAL_EXPERT: 8503, MINING_INSTRUCTOR: 3311, MAGIC_INSTRUCTOR: 3309, FISHING_SPOT: 3317, ADAM: 311 };
const PROGRESS = "tutorial-island:progress";
const PROGRESS_VARP = 281;
const INVENTORY_TAB_BUTTON = (161 << 16) | 62;
const IRONMAN_SETUP_HARDCORE = (890 << 16) | 24;
const IRONMAN_SETUP_IRONMAN = (890 << 16) | 22;

let PluginManager, core, Player, NPCClass, TaskManager;

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(ROOT);
  ({ PluginManager } = require("../dist/plugins/PluginManager"));
  // world.json ships the tutorial disabled; load every plugin for these tests.
  PluginManager.loadDisabledPluginNames = () => new Set();
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    try { PluginManager.emitServerStartup({ timestamp: Date.now() }); } catch {}
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require("../dist/game/entity/impl/player/Player"));
  ({ NPC: NPCClass } = require("../dist/game/entity/impl/npc/NPC"));
  ({ TaskManager } = require("../dist/game/task/TaskManager"));
});

// Plugin startup leaves world timers running; end the process once the tests are done.
after(() => setImmediate(() => process.exit()));

/** A player on the island at `progress`, recording what is sent to them. */
function tutorialPlayer(progress, x = 3102, y = 3095) {
  const player = new Player(null);
  player.setUsername("tutorial");
  player.setLocation(new core.Location(x, y, 0));
  const sent = { messages: [], varps: new Map(), scripts: [] };
  const sender = new Proxy({}, {
    get: (_, key) => (...args) => {
      if (key === "sendMessage") sent.messages.push(args[0]);
      if (key === "sendConfig") sent.varps.set(args[0], args[1]);
      if (key === "sendClientScript") sent.scripts.push(args);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  player.isRegistered = () => true;
  player.setAttribute(PROGRESS, progress);
  return { player, sent };
}

function dialogueTexts(player) {
  const current = player.getDialogueManager().getCurrent();
  return current ? String(current.getText?.() ?? "") : "";
}

/** Talk-to; `lines` dialogue boxes are clicked through (all of them by default). */
function talk(player, npcId, lines = Infinity, definition = undefined) {
  const npc = new NPCClass(npcId, player.getLocation().clone());
  const event = { player, npc, npcId, npcIndex: 1, clickType: 1, location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: 0 }, handled: false, definition };
  assert.ok(PluginManager.emitNpcInteraction(event), "Talk-to is handled");
  const seen = [];
  const dialogues = player.getDialogueManager();
  for (let i = 0; i < Math.min(lines, 40) && dialogues.isActive(); i++) {
    seen.push(dialogueTexts(player));
    dialogues.advance();
  }
  if (dialogues.isActive()) dialogues.reset();
  return seen;
}

function click(player, buttonId, action = 1) {
  PluginManager.emitInterfaceActionClick({ player, buttonId, action, opId: 1, handled: false });
}

function clickNpc(player, npc, clickType) {
  const at = npc.getLocation();
  PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getId(), npcIndex: 1, clickType, location: { x: at.getX(), y: at.getY(), z: 0 }, handled: false });
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

const amount = (player, id) => player.getInventory().getAmount(id);
const progress = (player) => player.getAttribute(PROGRESS);

test("the Survival Expert's net comes with the step it completes", () => {
  const { player, sent } = tutorialPlayer(20);
  talk(player, NPC.SURVIVAL_EXPERT);
  assert.equal(amount(player, ITEM.NET), 1);
  assert.equal(progress(player), 30);
  assert.equal(sent.varps.get(PROGRESS_VARP), 30);
});

test("a first talk closed before the net is handed over leaves the step to replay", () => {
  const { player } = tutorialPlayer(20);
  talk(player, NPC.SURVIVAL_EXPERT, 1);
  assert.equal(amount(player, ITEM.NET), 0);
  assert.equal(progress(player), 20, "the step only moves with the net");
  talk(player, NPC.SURVIVAL_EXPERT);
  assert.equal(amount(player, ITEM.NET), 1);
  assert.equal(progress(player), 30);
});

test("clicking the flashing inventory tab completes the 'open your inventory' step", () => {
  const { player } = tutorialPlayer(30);
  click(player, INVENTORY_TAB_BUTTON);
  assert.equal(progress(player), 40);
});

test("the tutorial pond gives its own raw shrimps after the captured six ticks", () => {
  const { player } = tutorialPlayer(40, 3101, 3093);
  player.getInventory().adds(ITEM.NET, 1);
  const spot = new NPCClass(NPC.FISHING_SPOT, new core.Location(3101, 3092, 0));
  clickNpc(player, spot, 1);
  ticks(5);
  assert.equal(amount(player, ITEM.TUTORIAL_RAW_SHRIMPS), 0, "still fishing");
  ticks(1);
  assert.equal(amount(player, ITEM.TUTORIAL_RAW_SHRIMPS), 1);
  assert.equal(progress(player), 50);
  assert.match(dialogueTexts(player), /You manage to catch some shrimp\./);
});

test("after the skills menu the Survival Expert gives the axe and tinderbox, with the step", () => {
  const { player } = tutorialPlayer(60);
  const seen = talk(player, NPC.SURVIVAL_EXPERT);
  assert.equal(amount(player, ITEM.AXE), 1);
  assert.equal(amount(player, ITEM.TINDERBOX), 1);
  assert.equal(progress(player), 70);
  assert.ok(seen.some((text) => text.includes("gives you a <col=000080>bronze axe") || text.includes("gives you a bronze axe")), "shown as an item box");
});

test("a dropped axe is given back while cutting the tree is the step; only what's missing", () => {
  const { player, sent } = tutorialPlayer(70);
  player.getInventory().adds(ITEM.TINDERBOX, 1);
  talk(player, NPC.SURVIVAL_EXPERT);
  assert.equal(amount(player, ITEM.AXE), 1);
  assert.equal(amount(player, ITEM.TINDERBOX), 1);
  assert.ok(sent.messages.includes("The survival expert gives you a bronze axe."));
});

test("the mining instructor's pickaxe comes with the mining step, and is given back if lost", () => {
  const { player } = tutorialPlayer(260, 3081, 9504);
  talk(player, NPC.MINING_INSTRUCTOR);
  assert.equal(amount(player, ITEM.PICKAXE), 1);
  assert.equal(progress(player), 300);
  player.getInventory().deleteNumber(ITEM.PICKAXE, 1);
  talk(player, NPC.MINING_INSTRUCTOR);
  assert.equal(amount(player, ITEM.PICKAXE), 1);
});

test("Terrova's runes come with the Wind Strike step, and she tops them up", () => {
  const { player } = tutorialPlayer(640, 3141, 3088);
  talk(player, NPC.MAGIC_INSTRUCTOR);
  assert.ok(amount(player, ITEM.AIR) >= 5 && amount(player, ITEM.MIND) >= 5);
  assert.equal(progress(player), 650);
  player.getInventory().deleteNumber(ITEM.AIR, amount(player, ITEM.AIR));
  talk(player, NPC.MAGIC_INSTRUCTOR);
  assert.ok(amount(player, ITEM.AIR) >= 5);
});

test("a save from before the varp values migrates to the step its stage showed", () => {
  const { player } = tutorialPlayer(undefined);
  player.setAttribute(PROGRESS, undefined);
  player.setAttribute("tutorial.island.stage", 6); // the old SURVIVAL_INV
  talk(player, NPC.SURVIVAL_EXPERT); // anything that reads the progress migrates it
  assert.equal(progress(player), 30);
  assert.equal(player.getAttribute("tutorial.island.stage"), null);
});

test("the Ironman tutor's setup sets the mode on Proceed; off the island Adam only downgrades", () => {
  const { player, sent } = tutorialPlayer(671, 3132, 3085);
  PluginManager.emitCustomEvent("ironman:open-setup", { player, upgrades: true, handled: false });
  click(player, IRONMAN_SETUP_HARDCORE);
  player.getEnteredAmountAction().execute(1);
  assert.equal(player.getAttribute("ironman:mode"), "hardcore");
  const query = { player, mode: "none" };
  PluginManager.emitCustomEvent("ironman:mode", query);
  assert.equal(query.label, "Hardcore Ironman");

  // Adam (upgrades: false): Ironman is a downgrade from Hardcore and is allowed; back up is not.
  PluginManager.emitCustomEvent("ironman:open-setup", { player, upgrades: false, handled: false });
  click(player, IRONMAN_SETUP_IRONMAN);
  player.getEnteredAmountAction().execute(1);
  assert.equal(player.getAttribute("ironman:mode"), "ironman");
  PluginManager.emitCustomEvent("ironman:open-setup", { player, upgrades: false, handled: false });
  click(player, IRONMAN_SETUP_HARDCORE);
  assert.equal(player.getAttribute("ironman:mode"), "ironman");
  assert.ok(sent.messages.some((text) => text.includes("only switch your restrictions downwards")));
});

test("Adam hands out the mode's armour", () => {
  const { player } = tutorialPlayer(1000, 3229, 3228);
  player.setAttribute("ironman:mode", "hardcore");
  const adam = new NPCClass(NPC.ADAM, new core.Location(3229, 3228, 0));
  clickNpc(player, adam, 3);
  for (const id of [20792, 20794, 20796]) assert.equal(amount(player, id), 1);
});

test("the step data is consistent: ordered values, real follow-up steps, captured hint range", () => {
  const data = require("../plugins/areas/data/tutorial-island.json");
  const values = data.steps.map((step) => step.value);
  assert.deepEqual(values, [...values].sort((a, b) => a - b), "steps are in progress order");
  assert.equal(new Set(values).size, values.length, "no duplicate values");
  for (const step of data.steps) {
    if (step.tabOpens !== undefined) assert.ok(values.includes(step.tabOpens), `${step.name}: tabOpens is a step`);
    if (step.hint !== undefined) assert.ok(step.hint >= 1 && step.hint <= 23, `${step.name}: hint picture 1-23`);
    if (step.text) assert.equal(step.text.length, 2, `${step.name}: title and body`);
  }
  const tutorialNpcs = new Set([3308, 8503, 3317, 3305, 3312, 3311, 3307, 3313, 3310, 3319, 3309, 3316]);
  for (const step of data.steps) {
    if (step.arrow?.npc !== undefined) assert.ok(tutorialNpcs.has(step.arrow.npc), `${step.name}: arrow NPC ${step.arrow.npc}`);
  }
});

test("new accounts answer the past-experience screen first; the answer picks the Magic Instructor's lines", () => {
  const { player } = tutorialPlayer(undefined, 3094, 3104);
  player.setAttribute(PROGRESS, undefined);
  PluginManager.emitPlayerLogin({ player, username: "tutorial", isNewAccount: true });
  assert.equal(progress(player), 1);
  click(player, (929 << 16) | 4, 3); // "I'm an experienced player."
  assert.equal(player.getAttribute("tutorial-island:experience"), "experienced");
  assert.equal(progress(player), 2);

  const ask = (text) => PluginManager.emitNpcDialogueCondition({ player, npcId: NPC.MAGIC_INSTRUCTOR, text });
  const BRAND_NEW = "If the player chose 'I am brand new! This is my first time here.' when talking to the Gielinor Guide and has not chosen to be an Ironman:";
  const RETURNING = "If the player chose 'I've played in the past, but not recently.' or 'I am an experienced player.' when talking to the Gielinor Guide:";
  assert.equal(ask(BRAND_NEW), false);
  assert.equal(ask(RETURNING), true, "experienced players are asked about Ironman");
  player.setAttribute("tutorial-island:experience", "new");
  assert.equal(ask(BRAND_NEW), true);
  assert.equal(ask(RETURNING), false);
});

test("a new account skips the welcome screen, designs its character, then gets the experience screen", async () => {
  const { player, sent } = tutorialPlayer(undefined, 3094, 3104);
  player.setAttribute(PROGRESS, undefined);
  const roots = [];
  const subs = [];
  let interfaceId = -1;
  const base = player.getPacketSender();
  const sender = new Proxy({}, {
    get: (_, key) => (...args) => {
      if (key === "sendRootInterface") roots.push(args[0]);
      if (key === "sendSubInterface") subs.push(args[1]);
      if (key === "sendInterface") interfaceId = args[0];
      if (key === "sendInterfaceRemoval") {
        const closed = interfaceId;
        interfaceId = -1;
        if (closed > 0) PluginManager.emitCustomEvent("interface:closed", { player, interfaceId: closed });
      }
      base[key](...args);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  player.setInterfaceId = (id) => { interfaceId = id; };
  player.getInterfaceId = () => interfaceId;

  PluginManager.emitPlayerLogin({ player, username: "tutorial", isNewAccount: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(roots, [], "no welcome screen (378)");
  assert.ok(subs.includes(679), "the character design opens");
  assert.equal(interfaceId, 679);
  assert.ok(!sent.messages.some((text) => text.includes("::mm")), "no ::mm hint");

  PluginManager.emitPlayerProcess({ player });
  assert.ok(sent.scripts.some(([id, text]) => id === 1974 && String(text).includes("Setting your appearance")));
  assert.notEqual(interfaceId, 929, "the experience screen waits for the design");

  // Confirming the design closes it; the experience screen follows.
  sender.sendInterfaceRemoval();
  ticks(1);
  assert.equal(interfaceId, 929);
  assert.ok(sent.scripts.some(([id, text]) => id === 1974 && String(text).includes("Past Experience")));
});

test("an existing player still gets the welcome screen", async () => {
  const { player } = tutorialPlayer(1000, 3222, 3218);
  const roots = [];
  const base = player.getPacketSender();
  player.getPacketSender = () => new Proxy({}, {
    get: (_, key) => (...args) => {
      if (key === "sendRootInterface") roots.push(args[0]);
      return base[key](...args);
    },
  });
  PluginManager.emitPlayerLogin({ player, username: "tutorial", isNewAccount: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(roots, [378]);
});

test("the Ironman tutor plays his own transcript (spawned as 7942, he talks as the 7941 he shows as)", () => {
  const { player } = tutorialPlayer(620, 3132, 3085);
  const seen = talk(player, 7941, 1, core.NpcDefinition.forId(7941));
  assert.match(seen[0] ?? "", /I'm Paul, the Ironman tutor/);
});

test("with the chef's flour and water in hand, the step highlights them instead of pointing at the chef", () => {
  const { player, sent } = tutorialPlayer(150, 3075, 3084);
  talk(player, 3305); // "before cooking the dough": he hands both over
  assert.equal(amount(player, 2516), 1);
  assert.equal(amount(player, 1929), 1);
  const highlighted = sent.scripts.filter(([id]) => id === 8461).map(([, item]) => item);
  assert.ok(highlighted.includes(2516) && highlighted.includes(1929));
  assert.ok(sent.scripts.some(([id, text]) => id === 1974 && String(text).includes("click on the flour in your inventory")));
});

test("the tutorial furnace smelts the bronze bar straight away, without the smelting menu", () => {
  const { player } = tutorialPlayer(320, 3078, 9496);
  player.getInventory().adds(438, 1); // tin ore
  player.getInventory().adds(436, 1); // copper ore
  const at = new core.Location(3078, 9495, 0);
  const object = new core.GameObject(core.ObjectIdentifiers.FURNACE_7, at, 10, 0, null);
  const event = { player, object, objectId: core.ObjectIdentifiers.FURNACE_7, clickType: 1, location: at, handled: false };
  PluginManager.emitObjectInteraction(event);
  assert.ok(event.handled, "the tutorial handles the furnace");
  ticks(3);
  assert.equal(amount(player, 2349), 1, "a bronze bar");
  assert.equal(progress(player), 330);
});

test("asking Adam for armour hands it over with his line", () => {
  const { player } = tutorialPlayer(1000, 3229, 3228);
  player.setAttribute("ironman:mode", "ultimate");
  PluginManager.emitCustomEvent("npc-dialogue:choice", { player, npcId: 311, option: "Have you any armour for me, please?" });
  for (const id of [12813, 12814, 12815]) assert.equal(amount(player, id), 1);
});

test("a tutorial door walks the player through and closes again; the step moves on", () => {
  const { player } = tutorialPlayer(10, 3097, 3107);
  const door = { player, objectId: 9398, location: new core.Location(3098, 3107, 0), handled: false };
  PluginManager.emitCustomEvent("door:toggle", door);
  assert.ok(door.handled, "the tutorial passes its own doors instead of opening them");
  ticks(4);
  assert.equal(player.getLocation().getX(), 3098, "through the doorway");
  assert.equal(progress(player), 20);
});

test("the player can't walk away while fishing", () => {
  const { player } = tutorialPlayer(40, 3101, 3093);
  player.getInventory().adds(ITEM.NET, 1);
  clickNpc(player, new NPCClass(NPC.FISHING_SPOT, new core.Location(3101, 3092, 0)), 1);
  player.getMovementQueue().walkStep(1, 0);
  ticks(2);
  assert.equal(player.getLocation().getX(), 3101, "still at the pond");
  ticks(4);
  assert.equal(amount(player, ITEM.TUTORIAL_RAW_SHRIMPS), 1);
  assert.equal(player.getMovementQueue().blockMovement ?? false, false, "free to move again");
});

test("a door clicked from beside it (not in line with it) still walks out, not in and out", () => {
  // Inside the Gielinor Guide's house, diagonally next to the door (it's on the west edge of 3098,3107).
  const { player } = tutorialPlayer(10, 3097, 3106);
  PluginManager.emitCustomEvent("door:toggle", { player, objectId: 9398, location: new core.Location(3098, 3107, 0), handled: false });
  const visited = [];
  for (let i = 0; i < 4; i++) {
    ticks(1);
    visited.push(`${player.getLocation().getX()},${player.getLocation().getY()}`);
  }
  assert.equal(player.getLocation().getX(), 3098, "ends outside");
  assert.ok(!visited.slice(visited.indexOf("3098,3107") + 1).some((tile) => tile.startsWith("3097")), "never back inside");
});

test("the Wind Strike highlight is cleared once the spell is cast, as captured", () => {
  const { player, sent } = tutorialPlayer(640, 3141, 3088);
  const T = require("../plugins/areas/tutorialisland/Common.TutorialIsland");
  T.setProgress(player, 650);
  assert.ok(sent.scripts.some(([id, , , component]) => id === 8478 && component === ((218 << 16) | 11)), "Wind Strike highlighted");
  T.setProgress(player, 670);
  assert.ok(sent.scripts.some(([id, a, b]) => id === 8484 && a === 3 && b === 3), "ui_highlight_clear 3, 3");
});

test("the combat tab stays locked when a weapon is wielded, then opens (after the flash) at its step", () => {
  const { player } = tutorialPlayer(420, 3106, 9509);
  const calls = [];
  const base = player.getPacketSender();
  const sender = new Proxy({}, {
    get: (_, key) => (...args) => {
      calls.push([key, ...args]);
      base[key](...args);
      return sender;
    },
  });
  player.getPacketSender = () => sender;
  PluginManager.emitPlayerProcess({ player }); // the tutorial UI goes up: the combat tab is locked
  player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(1277, 1); // the bronze sword
  calls.length = 0;
  PluginManager.emitPlayerProcess({ player });
  assert.ok(calls.some(([key, uid]) => key === "closeSubInterface" && uid === ((161 << 16) | 76)), "closed again");

  calls.length = 0;
  require("../plugins/areas/tutorialisland/Common.TutorialIsland").setProgress(player, 430);
  const flash = calls.findIndex(([key, id, value]) => key === "sendVarbit" && id === 3756 && value === 1);
  const opened = calls.findIndex(([key, tab]) => key === "sendTabInterface" && tab === 0);
  assert.ok(flash >= 0 && opened > flash, "flash first, then the combat tab opens with its weapon interface");
});

test("arriving in Lumbridge clears the worn items completely: the weapon interface goes back to unarmed", () => {
  const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
  const { player } = tutorialPlayer(680, 3222, 3218); // the Home Teleport landed off the island
  const equipment = player.getEquipment();
  equipment.getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(841, 1); // shortbow
  equipment.getItems()[core.Equipment.AMMUNITION_SLOT] = new core.Item(882, 47); // bronze arrows
  core.WeaponInterfaceManager.assign(player);
  assert.notEqual(player.getWeapon(), WeaponInterfaces.UNARMED, "the bow's interface while worn");

  PluginManager.emitPlayerProcess({ player });
  assert.equal(progress(player), 1000);
  assert.equal(equipment.getValidItems().length, 0, "nothing worn");
  assert.equal(player.getWeapon(), WeaponInterfaces.UNARMED, "fights unarmed, not with the bow");
});
