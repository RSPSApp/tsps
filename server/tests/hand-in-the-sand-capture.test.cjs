// Run after `yarn build`: node --test tests/hand-in-the-sand-capture.test.cjs
//
// The Hand in the Sand from stage 0 to 160 along a whole revision 242 run (rsprox capture local 1002235; ticks in
// docs/quests/hand-in-the-sand/README.md), with a real Player, the real plugins and cache, real packets for every
// click and continue, and the world's tasks ticking. Each step checks what the capture sent: the stage and the
// moment it is set, menus, item and statement boxes, sounds, varbits, items, the bell, the teleport and the sandpit
// cutscene. Bots off. No client ran.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const SPAWNS = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-spawns.json"), "utf8"));

let core;
let next = 7660;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
});
after(() => PM.emitServerShutdown({}));

const KEY = "hand_in_the_sand";
const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === KEY);
const stage = (f) => quest().getStage(f.p);
const varbit = (f, id) => f.p.getPacketSender().getVarbit(id);
const amount = (f, id) => f.p.getInventory().getAmount(id);
const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];

const ITEM = {
  BEER: 1917, VIAL: 229, REDBERRIES: 1951, WHITE_BERRIES: 239, LANTERN_LENS: 4542, EARTH_RUNE: 557, BUCKET_OF_SAND: 1783,
  SANDY_HAND: 6945, BEER_HAND: 6946, BERTS_ROTA: 6947, SANDYS_ROTA: 6948, SCROLL: 6949, ORB: 6950, ORB_FULL: 6951,
  TRUTH_SERUM: 6952, BOTTLED_WATER: 6953, REDBERRY_JUICE: 6954, PINK_DYE: 6955, ROSE_LENS: 6956, HEAD: 6957, SAND: 6958,
};
const BELL = { id: 6847, x: 2598, y: 3085 };

function actor(t, x, y, z = 0) {
  core.RegionManager.loadMapFiles(x, y);
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("handsandqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, z));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const log = [];
  // The world tick each row was sent on, for the capture's timings.
  const when = [];
  const record = (row) => {
    log.push(row);
    when.push(f.now);
  };
  const sender = p.getPacketSender();
  const wrap = (name, entry) => {
    const original = sender[name].bind(sender);
    t.mock.method(sender, name, (...args) => {
      const row = entry(...args);
      if (row) record(row);
      return name === "sendMessage" ? sender : original(...args);
    });
  };
  wrap("sendMessage", (text) => ["message", text]);
  wrap("sendVarbit", (id, value) => ["varbit", id, value]);
  wrap("sendSound", (id) => ["sound", id]);
  wrap("sendJingle", (id) => ["jingle", id]);
  wrap("sendItemOnInterfaces", (_uid, id) => ["item", id]);
  wrap("sendObjectAnimation", (object, animation) => ["locanim", animation?.getId?.() ?? animation?.id]);
  wrap("sendTypedMessage", (type, text) => (type === 114 ? ["line", String(text).split("|").slice(1).join("|")] : ["box", text]));
  wrap("sendClientScript", (id, ...args) => (id === 58 ? ["menu", args[0], String(args[1]).split("|")] : null));
  const playAreaSound = core.Sounds.playAreaSound;
  t.mock.method(core.Sounds, "playAreaSound", (options) => {
    record(["areasound", options.soundId, options.x, options.y, options.radius]);
    return playAreaSound.call(core.Sounds, options);
  });
  t.mock.method(p, "performAnimation", (animation) => record(["anim", animation?.getId?.() ?? animation?.id]));
  t.mock.method(p, "performGraphic", (graphic) => record(["gfx", graphic?.getId?.() ?? graphic?.id]));
  const npcAnimation = core.NPC.prototype.performAnimation;
  t.mock.method(core.NPC.prototype, "performAnimation", function (animation) {
    record(["npcanim", this.getId(), animation?.getId?.() ?? animation?.id]);
    return npcAnimation.call(this, animation);
  });
  const npcFace = core.NPC.prototype.setPositionToFace;
  t.mock.method(core.NPC.prototype, "setPositionToFace", function (tile) {
    if (tile) record(["npcface", this.getId(), tile.getX(), tile.getY()]);
    return npcFace.call(this, tile);
  });
  const forceChat = core.NPC.prototype.forceChat;
  t.mock.method(core.NPC.prototype, "forceChat", function (text) {
    record(["say", this.getId(), text, f.plugin.includes(this)]);
    return forceChat.call(this, text);
  });
  const spawnNpc = PM.spawnNpc.bind(PM);
  t.mock.method(PM, "spawnNpc", (definition, plugin) => {
    record(["spawn", definition.id, definition.x, definition.y]);
    const npc = spawnNpc(definition, plugin);
    if (npc) f.plugin.push(npc);
    return npc;
  });
  const npcs = [];
  const f = { p, c, log, when, record, now: 0, npcs, plugin: [], spawned: new Map() };
  t.after(() => {
    npcs.forEach((npc) => core.World.getNpcs().remove(npc));
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return f;
}

/** Every NPC the spawn list gives this name, at its real tile. */
function spawnAll(f, name) {
  const rows = SPAWNS.filter((row) => row.name === name);
  assert.ok(rows.length > 0, `${name} has spawns`);
  const npcs = rows.map((row) => {
    core.RegionManager.loadMapFiles(row.x, row.y);
    const npc = core.NPC.create(row.id, new core.Location(row.x, row.y, row.level ?? 0));
    core.World.getNpcs().add(npc);
    f.npcs.push(npc);
    return npc;
  });
  f.spawned.set(name, npcs);
  return npcs;
}

function nearest(f, name, id) {
  const here = f.p.getLocation();
  return f.spawned.get(name)
    .filter((npc) => id === undefined || npc.getId() === id)
    .sort((a, b) => here.getDistance(a.getLocation()) - here.getDistance(b.getLocation()))[0];
}

function tick(f, count = 1) {
  for (let i = 0; i < count; i++) {
    // The world's NPCs as the tick sees them: the test's spawns and the ones the plugins place (the bell's Zavistic,
    // the cutscene's Bert).
    core.World.updateLocalNpcs(f.p, [...f.npcs, ...f.plugin.filter((npc) => npc.isRegistered())]);
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    // The plugins' own NPCs walk too (the cutscene's Bert); where each stands after the tick, for the capture's steps.
    for (const npc of f.plugin.filter((npc) => npc.isRegistered())) {
      npc.getMovementQueue().process();
      f.record(["npcat", npc.getId(), npc.getLocation().getX(), npc.getLocation().getY()]);
    }
    core.TaskManager.process();
    f.p.resetUpdating();
    f.now++;
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function place(f, x, y, z = 0) {
  core.RegionManager.loadMapFiles(x, y);
  f.p.moveTo(new core.Location(x, y, z));
  tick(f, 2);
}

/**
 * Sends `packet`, then plays what it opens with real continues, answering each menu with the first `choices` pattern
 * its options match. Returns what was sent, from the click on.
 */
async function play(f, packet, choices = []) {
  const from = f.log.length;
  tick(f);
  await send(f, packet);
  const manager = f.p.getDialogueManager();
  let idle = 0;
  for (let i = 0; i < 400; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    const current = manager.getCurrent();
    if (pending) {
      const texts = pending.options.map((option) => option.text ?? option);
      let index = -1;
      for (const wanted of choices) {
        index = texts.findIndex((text) => wanted.test(text));
        if (index >= 0) break;
      }
      assert.ok(index >= 0, `no choice for ${JSON.stringify(texts)}`);
      f.record(["continue", texts[index]]);
      await send(f, { type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: index + 1 });
      tick(f);
      idle = 0;
    } else if (current && !current.constructor.name.includes("Action")) {
      const group = f.p.getPacketSender().getChatboxGroupId();
      const child = [231, 217].includes(group) ? 5 : group === 229 ? 4 : 0;
      f.record(["continue"]);
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | child, childIndex: -1 });
      tick(f);
      idle = 0;
    } else {
      if (++idle > 25) break;
      tick(f);
    }
  }
  const rows = f.log.slice(from);
  rows.when = f.when.slice(from);
  return rows;
}

const npcOption = (npc, clickType = 1) => ({ type: "npc_option", index: npc.getIndex(), clickType });
const ring = () => ({ type: "object_option", clickType: 1, ...BELL });
function slotOf(f, id) {
  const items = f.p.getInventory().getItems();
  return items.findIndex((item) => item && item.getId() === id && item.getAmount() > 0);
}
const useOn = (f, itemId, target) => ({ type: "inventory_use_on", slot: slotOf(f, itemId), itemId, target });
const lines = (rows) => rows.filter(([kind]) => kind === "line").map(([, text]) => text);
const indexOf = (rows, predicate) => rows.findIndex(predicate);
const isVarbit = (id, value) => ([kind, at, to]) => kind === "varbit" && at === id && (value === undefined || to === value);

test("The Hand in the Sand plays as the revision 242 run, stage 0 to 160", async (t) => {
  const f = actor(t, 2550, 3098);
  const skills = f.p.getSkillManager();
  skills.setMaxLevel(core.Skill.THIEVING, 43).setCurrentLevel(core.Skill.THIEVING, 43);
  skills.setMaxLevel(core.Skill.CRAFTING, 58).setCurrentLevel(core.Skill.CRAFTING, 58);
  for (const [id, count] of [[ITEM.BEER, 1], [ITEM.VIAL, 2], [ITEM.REDBERRIES, 1], [ITEM.WHITE_BERRIES, 1], [ITEM.LANTERN_LENS, 1],
    [ITEM.EARTH_RUNE, 5], [ITEM.BUCKET_OF_SAND, 1]]) f.p.getInventory().add(new core.Item(id, count));
  for (const name of ["Bert", "Guard Captain", "Sandy", "Betty", "Mazion"]) spawnAll(f, name);
  const random = t.mock.method(Math, "random", () => 0.1);

  // t7226-7282: Bert's start, its prompt, the stage and question varbits on the continue of "Nae", the hand's box.
  let rows = await play(f, npcOption(nearest(f, "Bert", 5382)), [/Eww a hand/, /^Yes\.$/]);
  assert.deepEqual(rows.find(([kind, title]) => kind === "menu" && /quest\?$/.test(title)),
    ["menu", "Start The Hand in the Sand quest?", ["Yes.", "No."]]);
  const nae = indexOf(rows, ([kind, text]) => kind === "line" && text.startsWith("..... Nae"));
  const started = indexOf(rows, isVarbit(1527, 10));
  const handBox = indexOf(rows, ([kind, text]) => kind === "box" && text.startsWith("Bert gives you"));
  assert.ok(nae < started && started < handBox, "10 between Bert's 'Nae' and the hand's box");
  for (const id of [1528, 1529, 1530]) assert.equal(varbit(f, id), 1, `question varbit ${id}`);
  assert.deepEqual(rows[handBox + 1], ["item", ITEM.SANDY_HAND], "the hand's item box");
  assert.equal(amount(f, ITEM.SANDY_HAND), 1);

  // t7303-7350: the beer's box, its gulp on the continue, then 20 with the drop sound and the beer soaked hand.
  place(f, 2552, 3081);
  rows = await play(f, npcOption(nearest(f, "Guard Captain", 5383)));
  assert.equal(lines(rows)[0], "Sir? I have some more beer for you...");
  const beerBox = indexOf(rows, ([kind, text]) => kind === "box" && text.startsWith("You give the beer"));
  assert.deepEqual(rows[beerBox + 1], ["item", ITEM.BEER]);
  assert.ok(indexOf(rows, ([kind, id]) => kind === "sound" && id === 1589) > beerBox, "the gulp after the beer's box");
  const toTwenty = indexOf(rows, isVarbit(1527, 20));
  assert.ok(toTwenty > 0 && rows.slice(toTwenty - 1, toTwenty + 4).some(([kind, id]) => kind === "sound" && id === 1588));
  assert.equal(amount(f, ITEM.BEER), 0);
  assert.equal(amount(f, ITEM.BEER_HAND), 1);
  assert.equal(stage(f), 20);

  // t7398-7474: the bell swings, Zavistic comes out to (2598,3087), the ringing lines, the wave and the hand-over (30).
  place(f, 2598, 3084);
  rows = await play(f, ring());
  assert.ok(rows.some(([kind, id]) => kind === "locanim" && id === 2103), "the bell swings");
  const swing = indexOf(rows, ([kind, id]) => kind === "locanim" && id === 2103);
  const arrival = indexOf(rows, ([kind, id]) => kind === "spawn" && id === 881);
  assert.deepEqual(rows[arrival], ["spawn", 881, 2598, 3087], "Zavistic comes out north of the bell");
  assert.ok(swing < arrival && arrival < indexOf(rows, ([kind]) => kind === "line"), "the swing, Zavistic, then his words");
  const ringing = indexOf(rows, ([kind, id]) => kind === "areasound" && id === 1959);
  assert.deepEqual(rows[ringing], ["areasound", 1959, 2598, 3086, 5], "the bell rings over 5 tiles");
  assert.equal(rows.when[ringing], rows.when[swing], "as it swings (t7399)");
  assert.equal(rows.when[arrival] - rows.when[swing], 1, "Zavistic a tick after the swing (t7399-7400)");
  assert.equal(rows.when[indexOf(rows, ([kind]) => kind === "line")], rows.when[arrival], "and his words with him");
  assert.deepEqual(lines(rows).slice(0, 3), [
    "What are you doing ringing that bell?! Don't you think some of us have work to do?",
    "But I was told to ring the bell if I wanted some attention.",
    "Well...anyway...we're very busy here, hurry up what do you want?",
  ]);
  assert.ok(!rows.some(([kind]) => kind === "menu"), "no Zogre menu before Zogre Flesh Eaters");
  assert.deepEqual(rows[indexOf(rows, ([kind, text]) => kind === "box" && text === "You wave the hand at the wizard.") + 1], ["item", ITEM.BEER_HAND]);
  assert.equal(stage(f), 30);
  assert.equal(amount(f, ITEM.BEER_HAND), 0);

  // t7511-7563: Bert's rota and 40.
  place(f, 2550, 3098);
  await play(f, npcOption(nearest(f, "Bert", 5382)));
  assert.equal(stage(f), 40);
  assert.equal(amount(f, ITEM.BERTS_ROTA), 1);

  // t7668-7671: Sandy's desk: 50, its statement box and Sandy's rota.
  place(f, 2787, 3175);
  rows = await play(f, { type: "object_option", clickType: 1, id: 10805, x: 2788, y: 3174 });
  assert.equal(stage(f), 50);
  assert.ok(rows.some(([kind, text]) => kind === "box" && text.startsWith("You quickly sift through")));
  assert.equal(amount(f, ITEM.SANDYS_ROTA), 1);

  // t7675-7690: every pickpocket plays its animation; a miss, then each success another sand.
  const sandy = nearest(f, "Sandy", 6405);
  random.mock.mockImplementation(() => 0.9);
  rows = await play(f, npcOption(sandy, 3));
  assert.ok(rows.some(([kind, id]) => kind === "anim" && id === 881));
  assert.ok(rows.some(([kind, text]) => kind === "box" && text === "You felt something but it slipped through your fingers..."));
  assert.equal(amount(f, ITEM.SAND), 0);
  random.mock.mockImplementation(() => 0.1);
  for (let attempt = 1; attempt <= 2; attempt++) {
    rows = await play(f, npcOption(sandy, 3));
    assert.ok(rows.some(([kind, id]) => kind === "anim" && id === 881));
    assert.equal(amount(f, ITEM.SAND), attempt, `sand after success ${attempt}`);
  }

  // t7856-7887: Bert takes both rotas for the scroll (60).
  place(f, 2550, 3098);
  await play(f, npcOption(nearest(f, "Bert", 5382)));
  assert.equal(stage(f), 60);
  assert.equal(amount(f, ITEM.SCROLL), 1);
  assert.equal(amount(f, ITEM.BERTS_ROTA) + amount(f, ITEM.SANDYS_ROTA), 0);

  // t7925-7987: no menu after the greeting; the orb's item box and 70.
  place(f, 2598, 3084);
  rows = await play(f, ring());
  assert.ok(!rows.some(([kind]) => kind === "menu"));
  assert.deepEqual(lines(rows).slice(0, 2), [
    "What are you doing...Oh, it's you...sorry...didn't realise...what can I do for you?",
    "I talked to Bert and found something very strange about his hours.",
  ]);
  assert.equal(stage(f), 70);
  assert.equal(amount(f, ITEM.ORB), 1);

  // t7989-8037: the guild menu, a vial for the teleport: 1531 and the vial on the continue, the cast two ticks on,
  // Betty's shop two after that.
  rows = await play(f, ring(), [/Can you help me more\?/, /^Yes, that would be great!$/]);
  assert.deepEqual(rows.find(([kind]) => kind === "menu"), ["menu", "Select an option", [
    "What is there to do in the Wizards' Guild?", "What are the requirements to get in the Wizards' Guild?",
    "What do you do in the Guild?", "Can you help me more?",
  ]]);
  assert.equal(varbit(f, 1531), 1);
  assert.equal(amount(f, ITEM.VIAL), 1);
  const cast = indexOf(rows, ([kind, id]) => kind === "anim" && id === 3041);
  assert.equal(rows.when[cast] - rows.when[indexOf(rows, isVarbit(1531, 1))], 2, "the cast two ticks after the continue");
  assert.ok(rows.slice(cast).some(([kind, id]) => kind === "gfx" && id === 111));
  assert.ok(rows.slice(cast).some(([kind, id]) => kind === "sound" && id === 200));
  assert.deepEqual(at(f), [3014, 3259, 0]);
  const teleported = indexOf(rows, isVarbit(1531, 1));
  const zavisticCast = indexOf(rows, ([kind, id, anim]) => kind === "npcanim" && id === 881 && anim === 710);
  assert.ok(zavisticCast >= 0, "Zavistic casts (human_castentangle, t8033)");
  assert.equal(rows.when[zavisticCast], rows.when[teleported], "on the continue, with 1531");
  // t8037: human_shrink ends shrunk to nothing and lasts ~668 ticks; the landing clears it, else the player is invisible.
  const reset = indexOf(rows, ([kind, id]) => kind === "anim" && id === 65535);
  assert.ok(reset > cast, "the shrink is cleared on landing");
  assert.equal(rows.when[reset] - rows.when[cast], 2, "two ticks after the cast, with the teleport (t8035-8037)");

  // t8045-8063: Betty's bottle for the second vial on the continue of "I have one here!".
  rows = await play(f, npcOption(nearest(f, "Betty")), [/about the Hand in the Sand/]);
  assert.equal(varbit(f, 1532), 1);
  assert.equal(amount(f, ITEM.VIAL), 0);
  assert.equal(amount(f, ITEM.BOTTLED_WATER), 1);

  // t8068-8078: the juice (Wiki's {{Mes}}), the dye, the lens with its item box and drip.
  rows = await play(f, useOn(f, ITEM.REDBERRIES, { kind: "inventory", slot: slotOf(f, ITEM.BOTTLED_WATER) }));
  assert.equal(varbit(f, 1532), 2);
  assert.ok(rows.some(([kind, text]) => kind === "message" && /white berries to make the pink dye/.test(text)));
  await play(f, useOn(f, ITEM.WHITE_BERRIES, { kind: "inventory", slot: slotOf(f, ITEM.REDBERRY_JUICE) }));
  assert.equal(varbit(f, 1532), 3);
  rows = await play(f, useOn(f, ITEM.PINK_DYE, { kind: "inventory", slot: slotOf(f, ITEM.LANTERN_LENS) }));
  assert.equal(varbit(f, 1532), 4);
  assert.ok(rows.some(([kind, id]) => kind === "sound" && id === 2392));
  assert.ok(rows.some(([kind, id]) => kind === "item" && id === ITEM.ROSE_LENS));

  // t8082-8118: Betty's vial on the counter (1537, put_down), then the lens: serum 5, the shatter, the serum's box.
  rows = await play(f, npcOption(nearest(f, "Betty")), [/about the Hand in the Sand/]);
  assert.equal(varbit(f, 1537), 1);
  assert.ok(rows.some(([kind, id]) => kind === "sound" && id === 2739));
  assert.ok(rows.some(([kind, id]) => kind === "item" && id === ITEM.VIAL));
  rows = await play(f, useOn(f, ITEM.ROSE_LENS, { kind: "loc", id: 10812, x: 3013, y: 3258 }));
  assert.deepEqual(at(f), [3016, 3259, 0], "the lens is used from Betty's doorway (t8111-8118)");
  assert.equal(varbit(f, 1532), 5);
  assert.equal(varbit(f, 1537), 0);
  assert.ok(rows.some(([kind, id]) => kind === "sound" && id === 1587));
  assert.equal(amount(f, ITEM.TRUTH_SERUM), 1);

  // t8121-8149: the sand in the serum (80, serum 6).
  rows = await play(f, npcOption(nearest(f, "Betty")), [/about the Hand in the Sand/]);
  assert.equal(stage(f), 80);
  assert.equal(varbit(f, 1532), 6);
  assert.equal(amount(f, ITEM.SAND), 1, "Betty takes one of the two sands");

  // t8250-8266: a tall tale; on the continue of "Wow!" Sandy turns to the window (1535) with 90 and the hint.
  place(f, 2787, 3175);
  rows = await play(f, npcOption(sandy), [/mutant herring/]);
  const wow = indexOf(rows, ([kind, text]) => kind === "line" && text === "Wow! I must see this!");
  assert.ok(wow >= 0 && indexOf(rows, isVarbit(1527, 90)) > wow, "90 after Sandy's 'Wow!'");
  assert.equal(varbit(f, 1535), 1);
  assert.ok(rows.some(([kind, text]) => kind === "message" && text === "Sandy turns to look out of the window, now is your chance!"));

  // t8275-8287: the serum in the coffee: 100, Sandy back (1535 0), the serum sound and a statement box.
  rows = await play(f, useOn(f, ITEM.TRUTH_SERUM, { kind: "loc", id: 10806, x: 2789, y: 3176 }));
  assert.equal(stage(f), 100);
  assert.equal(varbit(f, 1535), 0);
  assert.ok(rows.some(([kind, id]) => kind === "sound" && id === 1592));
  assert.equal(amount(f, ITEM.TRUTH_SERUM), 0);

  // t8280: rubbing the orb: 110, its sound and its item box.
  rows = await play(f, { type: "inventory_action", slot: slotOf(f, ITEM.ORB), itemId: ITEM.ORB, widgetId: 149 << 16, option: "Activate" });
  assert.equal(stage(f), 110);
  assert.ok(rows.some(([kind, id]) => kind === "sound" && id === 1590));
  assert.equal(amount(f, ITEM.ORB_FULL), 1);

  // t8292-8353: the menu loses each question once asked, the player asks each one, its varbit clears; 120.
  rows = await play(f, npcOption(sandy), [/Why is Bert's rota/, /Why doesn't Bert remember/, /What happened to the wizard/]);
  assert.deepEqual(rows.filter(([kind]) => kind === "menu").map(([, , options]) => options.length), [4, 3, 2]);
  for (const question of ["Why is Bert's rota different from the original?", "Why doesn't Bert remember the change in his hours?", "What happened to the wizard?"]) {
    assert.ok(lines(rows).includes(question), `the player asks ${question}`);
  }
  for (const id of [1528, 1529, 1530]) assert.equal(varbit(f, id), 0);
  assert.equal(stage(f), 120);

  // t8539-8574: the orb's statement box, no menu, 130.
  place(f, 2598, 3084);
  rows = await play(f, ring());
  assert.ok(!rows.some(([kind]) => kind === "menu"));
  assert.ok(rows.some(([kind, text]) => kind === "box" && text.startsWith("You hand the magical scrying orb")));
  assert.equal(stage(f), 130);
  assert.equal(amount(f, ITEM.ORB_FULL), 0);

  // t8578-8650: one greeting, the cutscene in a copy of the sandpit with its jingle, the swirl and Bert, back at the
  // bell with 140 and the runes and bucket spent.
  rows = await play(f, ring());
  assert.deepEqual(lines(rows).slice(0, 3), [
    "What are you doing...Oh, it's you...sorry...didn't realise...what can I do for you?",
    "I've brought what you wanted, what are you going to do?",
    "Ahh excellent, let's have those! Watch and learn...",
  ]);
  assert.ok(rows.some(([kind, id]) => kind === "jingle" && id === 114));
  assert.ok(rows.some(([kind, id]) => kind === "locanim" && id === 3037));
  assert.ok(rows.some(([kind, id]) => kind === "sound" && id === 1591));
  const firstBox = indexOf(rows, ([kind, text]) => kind === "box" && text.startsWith("The Wizard chants"));
  const secondBox = indexOf(rows, ([kind, text]) => kind === "box" && text.startsWith("Something very strange"));
  const spent = indexOf(rows, isVarbit(1527, 140));
  assert.ok(firstBox >= 0 && firstBox < secondBox && secondBox < spent, "the boxes, then 140");
  const learn = indexOf(rows, ([kind, text]) => kind === "line" && text === "Ahh excellent, let's have those! Watch and learn...");
  const continued = (from) => from + 1 + indexOf(rows.slice(from + 1), ([kind]) => kind === "continue");
  const swirl = indexOf(rows, ([kind, id]) => kind === "locanim" && id === 3037);
  assert.equal(rows.when[firstBox] - rows.when[continued(learn)], 12, "the first box 12 ticks into the scene (t8593-8605)");
  assert.equal(rows.when[swirl] - rows.when[continued(firstBox)], 7, "the swirl 7 ticks after it is continued (t8609-8616)");
  assert.equal(rows.when[secondBox] - rows.when[swirl], 2, "the second box 2 ticks later (t8618)");
  // t8610-8614: from the tick after the first box's continue Bert walks NW, W, W, NW to the pit's edge, then faces it.
  const bertSteps = [];
  rows.forEach(([kind, id, x, y], i) => {
    if (kind !== "npcat" || id !== 5382 || i < learn || i > swirl) return;
    if (i < continued(firstBox)) {
      bertSteps[0] = [x, y, 0]; // where he stands before the continue
      return;
    }
    const last = bertSteps[bertSteps.length - 1];
    if (!last || last[0] !== x || last[1] !== y) bertSteps.push([x, y, rows.when[i] - rows.when[continued(firstBox)]]);
  });
  const sceneTiles = bertSteps.map(([x, y, when]) => [x - bertSteps[0][0], y - bertSteps[0][1], when]);
  assert.deepEqual(sceneTiles, [[0, 0, 0], [-1, 1, 1], [-2, 1, 2], [-3, 1, 3], [-4, 2, 4]],
    "Bert's four steps from (2546,3099) to (2542,3101), one a tick from t8610");
  const bertFaces = indexOf(rows, ([kind, id], i) => kind === "npcface" && id === 5382 && i > continued(firstBox));
  assert.ok(bertFaces >= 0, "Bert turns to the pit");
  assert.deepEqual([rows[bertFaces][2] - bertSteps[0][0], rows[bertFaces][3] - bertSteps[0][1]], [-4, 3], "towards (2542,3102)");
  assert.equal(rows.when[bertFaces] - rows.when[continued(firstBox)], 5, "a tick after he arrives (t8614)");
  assert.equal(rows.when[spent] - rows.when[continued(secondBox)], 13, "140 13 ticks after it is continued (t8625-8638)");
  // The 120 ring's Zavistic has walked off by now, so this ring's own comes first: find the one after the cutscene.
  const after = continued(secondBox);
  const back = after + indexOf(rows.slice(after), ([kind, id]) => kind === "spawn" && id === 881);
  assert.deepEqual(rows[back], ["spawn", 881, 2597, 3086], "Zavistic beside the bell again (t8635)");
  assert.equal(rows.when[back] - rows.when[continued(secondBox)], 10, "back at the bell 10 ticks after the second box");
  assert.equal(rows.when[indexOf(rows, ([kind, id]) => kind === "jingle" && id === 114)] - rows.when[continued(learn)], 3,
    "the copy and its jingle 3 ticks into the scene (t8596)");
  assert.deepEqual(rows.filter(([kind, , text]) => kind === "say" && text === "My sand! My lovely sand!").map(([, id, , own]) => [id, own]),
    [[5382, true]], "the cutscene's own Bert cries it overhead; the world's Bert says nothing");
  assert.ok(lines(rows).includes("There, the sand pit will now magically refill. No more work for Bert!"));
  assert.deepEqual(at(f), [2598, 3086, 0]);
  assert.equal(amount(f, ITEM.EARTH_RUNE) + amount(f, ITEM.BUCKET_OF_SAND), 0);

  // t8785-8828: Mazion's head (150).
  place(f, 2816, 3341);
  rows = await play(f, npcOption(nearest(f, "Mazion")));
  assert.equal(stage(f), 150);
  assert.ok(rows.some(([kind, id]) => kind === "item" && id === ITEM.HEAD));

  // t9004-9032: the head's box, then Sandy and the mug gone, 160 with jingle 152, the head taken.
  place(f, 2598, 3084);
  rows = await play(f, ring());
  assert.ok(rows.some(([kind, text]) => kind === "box" && text === "You show the wizard the head."));
  assert.equal(stage(f), 160);
  assert.equal(varbit(f, 1535), 2);
  assert.equal(varbit(f, 1536), 1);
  assert.ok(rows.some(([kind, id]) => kind === "jingle" && id === 152));
  assert.equal(amount(f, ITEM.HEAD), 0);
});

/** A player at `tile` at `value`, carrying `items`, with the quest's NPCs at their spawns. */
function at_stage(t, tile, value, items = []) {
  const f = actor(t, ...tile);
  const skills = f.p.getSkillManager();
  skills.setMaxLevel(core.Skill.THIEVING, 43).setCurrentLevel(core.Skill.THIEVING, 43);
  skills.setMaxLevel(core.Skill.CRAFTING, 58).setCurrentLevel(core.Skill.CRAFTING, 58);
  for (const [id, count] of items) f.p.getInventory().add(new core.Item(id, count));
  for (const name of ["Bert", "Sandy"]) spawnAll(f, name);
  if (value) quest().setStage(f.p, value);
  return f;
}

test("after Zogre Flesh Eaters the bell's Zavistic knows the player and asks first, as the Wiki has it", async (t) => {
  const f = at_stage(t, [2598, 3084], 20, [[ITEM.BEER_HAND, 1]]);
  const zogre = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "zogre_flesh_eaters");
  zogre.setStage(f.p, zogre.completionValue);
  const rows = await play(f, ring(), [/sandy problem/]);
  assert.deepEqual(rows.find(([kind]) => kind === "menu")?.[2],
    ["I'm here about the sicks...err Zogres", "I have a rather sandy problem that I'd like to palm off on you."]);
  assert.equal(lines(rows)[0], "What are you doing...Oh, it's you...sorry...didn't realise...what can I do for you?");
  assert.ok(!lines(rows).some((text) => text.startsWith("What are you doing ringing that bell")), "no ringing lines for a known face");
  assert.ok(rows.some(([kind, text]) => kind === "box" && text === "You wave the hand at the wizard."));
  assert.equal(stage(f), 30);
});

test("a tall tale Sandy doesn't fall for leaves him at his desk", async (t) => {
  const f = at_stage(t, [2787, 3175], 80, [[ITEM.TRUTH_SERUM, 1]]);
  t.mock.method(Math, "random", () => 0.9);
  const rows = await play(f, npcOption(nearest(f, "Sandy", 6405)), [/pygmy shrews/]);
  assert.ok(lines(rows).includes("I'm not falling for that one!"));
  assert.equal(stage(f), 80);
  assert.equal(varbit(f, 1535), 0);
  assert.ok(!rows.some(([kind, text]) => kind === "message" && /now is your chance/.test(text)));
});

test("Bert's \"Yes.\" refuses without 17 Thieving and 49 Crafting", async (t) => {
  const f = at_stage(t, [2550, 3098], 0);
  const skills = f.p.getSkillManager();
  skills.setMaxLevel(core.Skill.THIEVING, 16).setCurrentLevel(core.Skill.THIEVING, 16);
  const rows = await play(f, npcOption(nearest(f, "Bert", 5382)), [/Eww a hand/, /^Yes\.$/]);
  assert.ok(rows.some(([kind, text]) => kind === "message" && /requirements to start The Hand in the Sand/.test(text)));
  assert.equal(stage(f), 0);
  assert.equal(amount(f, ITEM.SANDY_HAND), 0);
  assert.ok(!lines(rows).includes("Sure, I'll give you a hand."));
});

test("the sandpit spell spends 5 earth runes and one bucket once, and the orb step spends none", async (t) => {
  const f = at_stage(t, [2598, 3084], 120, [[ITEM.ORB_FULL, 1], [ITEM.EARTH_RUNE, 10], [ITEM.BUCKET_OF_SAND, 2]]);
  await play(f, ring());
  assert.equal(stage(f), 130);
  assert.equal(amount(f, ITEM.EARTH_RUNE), 10);
  assert.equal(amount(f, ITEM.BUCKET_OF_SAND), 2);
  await play(f, ring());
  assert.equal(stage(f), 140);
  assert.equal(amount(f, ITEM.EARTH_RUNE), 5);
  assert.equal(amount(f, ITEM.BUCKET_OF_SAND), 1);
});

test("a logout in the sandpit cutscene saves the player at the bell, the step to play again", async (t) => {
  const f = at_stage(t, [2598, 3084], 130, [[ITEM.EARTH_RUNE, 5], [ITEM.BUCKET_OF_SAND, 1]]);
  tick(f);
  await send(f, ring());
  for (let i = 0; i < 40 && !f.log.some(([kind, id]) => kind === "jingle" && id === 114); i++) {
    const group = f.p.getPacketSender().getChatboxGroupId();
    if (f.p.getDialogueManager().getCurrent() && [231, 217].includes(group)) {
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 });
    }
    tick(f);
  }
  assert.ok(f.log.some(([kind, id]) => kind === "jingle" && id === 114), "the cutscene began");
  assert.deepEqual(f.p.getAttribute("hand-in-the-sand:scene-exit"), [2598, 3086, 0], "the bell is saved as the way out");
  // The core's logout: the player leaves the scene's area, then the plugins' logout hooks.
  f.p.getArea().leave(f.p, true);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  assert.deepEqual(at(f), [2598, 3086, 0], "saved beside the bell");
  assert.equal(f.p.getAttribute("hand-in-the-sand:scene-exit") ?? null, null, "nothing left to recover");
  assert.equal(stage(f), 130);
  assert.equal(amount(f, ITEM.EARTH_RUNE), 5);
  assert.equal(amount(f, ITEM.BUCKET_OF_SAND), 1);
});

test("Esc in the sandpit cutscene leaves it as the second box's continue does: back at the bell, the step to play again", async (t) => {
  const f = at_stage(t, [2598, 3084], 130, [[ITEM.EARTH_RUNE, 5], [ITEM.BUCKET_OF_SAND, 1]]);
  tick(f);
  await send(f, ring());
  for (let i = 0; i < 60 && f.p.getPacketSender().getChatboxGroupId() !== 229; i++) {
    const group = f.p.getPacketSender().getChatboxGroupId();
    if (f.p.getDialogueManager().getCurrent() && [231, 217].includes(group)) {
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 });
    }
    tick(f);
  }
  assert.equal(f.p.getPacketSender().getChatboxGroupId(), 229, "the first statement box shows");
  await send(f, { type: "interface_close" });
  for (let i = 0; i < 50; i++) tick(f);
  assert.deepEqual(at(f), [2598, 3086, 0], "back beside the bell");
  assert.equal(f.p.getMovementQueue().isMovementBlocked(), false, "free to move");
  assert.equal(f.p.getAttribute("hand-in-the-sand:scene-exit") ?? null, null, "no scene left to recover");
  assert.equal(stage(f), 130, "the step to play again");
  await play(f, ring());
  assert.equal(stage(f), 140, "ringing again plays it through");
});

test("each ringer's Zavistic is theirs alone: another player neither sees him nor loses him", async (t) => {
  const first = at_stage(t, [2598, 3084], 20, [[ITEM.BEER_HAND, 1]]);
  const second = actor(t, 2599, 3084);
  const zavistics = (f) => f.p.getLocalNpcs().filter((npc) => npc.getId() === 881 && npc.getLocation().getY() >= 3086);
  tick(first);
  await send(first, ring());
  tick(first, 3);
  core.World.updateLocalNpcs(second.p, [...first.plugin, ...second.plugin].filter((npc) => npc.isRegistered()));
  assert.equal(zavistics(first).length, 1, "the ringer's Zavistic comes out");
  assert.equal(zavistics(second).length, 0, "the other player sees nobody at the bell");
  const own = zavistics(first)[0];
  assert.equal(own.getOwner(), first.p);
  assert.equal(own.isOwnerOnly(), true);
  // The other player walking off or logging out leaves the ringer's Zavistic where he is.
  PM.emitPlayerLogout({ player: second.p, username: second.p.getUsername() });
  second.p.setRegistered(false);
  tick(first, 2);
  assert.equal(own.isRegistered(), true);
});
