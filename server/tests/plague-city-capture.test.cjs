// Run after `yarn build`: node --test tests/plague-city-capture.test.cjs
//
// Issue 3976: Plague City against a complete live run (revision 242 capture 20261110T113734-5ab63b4;
// docs/quests/plague-city/README.md). Real engine, as priest-in-peril-doors.test.cjs: every plugin
// loaded, real Players at real quest stages, the real map and Doors, clicks through
// ObjectActionPacketListener.executeAction and the ticks running. Talk steps are the transcript
// events NpcDialogues emits (npc-dialogue:line / npc-dialogue:action), sent as it sends them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const INVISWALL = 38848;
let core, quest;
let next = 5900;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[2566, 3332], [2514, 9739], [2531, 3328], [2529, 3303], [2540, 3273], [2539, 9672]]) {
    core.RegionManager.loadMapFiles(x, y);
  }
  PluginManager.emitServerStartup({});
  quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "plague_city");
});

function actor(t, stage, x, y, z = 0) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("pcity" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  const varbits = new Map(), messages = [], sounds = [];
  const sender = player.getPacketSender();
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { varbits.set(id, value); return sendVarbit(id, value); };
  const chatboxes = [];
  const sendChatbox = sender.sendChatboxInterface.bind(sender);
  sender.sendChatboxInterface = (id) => { chatboxes.push(id); return sendChatbox(id); };
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text) => { messages.push(String(text)); return sendMessage(text); };
  players.push(player);
  t.after(() => {
    player.getDialogueManager().reset?.();
    player.setRegistered(false);
    players.splice(players.indexOf(player), 1);
  });
  quest.setStage(player, stage);
  return { player, varbits, messages, chatboxes, inv: player.getInventory() };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}
const until = (condition, limit = 12) => { for (let i = 0; i < limit && !condition(); i++) tick(); return condition(); };
const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const locAt = (id, x, y, z = 0) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === z) return object;
    }
  }
  return null;
};
const click = (player, id, x, y) => new ObjectActionPacketListener().executeAction(player, id, x, y, 1);
const action = (player, npcId, stepId, kind = "message") => {
  const event = { player, npcId, stepId, kind, handled: false };
  PluginManager.emitCustomEvent("npc-dialogue:action", event);
  return event;
};
const line = (player, npcId, text, step = {}) => {
  const event = { player, npcId, text, step, skip: false };
  PluginManager.emitCustomEvent("npc-dialogue:line", event);
  return event;
};
const itemOnObject = (player, itemId, objectId, x, y, z = 0) => PluginManager.emitItemOnObject({
  player, object: locAt(objectId, x, y, z), objectId, item: new core.Item(itemId, 1), itemId, itemSlot: 0,
  interfaceType: 149, location: { x, y, z }, handled: false,
});
const box = (player) => player.getDialogueManager().getCurrent?.();

test("hand-outs show in the item box live uses, statements in a message box", (t) => {
  const { player } = actor(t, 1, 2573, 3332);
  const I = core.ItemIdentifiers;
  player.getInventory().adds(I.DWELLBERRIES, 1);
  assert.deepEqual(action(player, core.NpcIdentifiers.ALRENA, "JytUi6").box, { items: [I.DWELLBERRIES] });
  assert.equal(player.getInventory().getAmount(I.DWELLBERRIES), 1, "the berries go with the mask, not the first box (tick 126)");
  assert.deepEqual(action(player, core.NpcIdentifiers.ALRENA, "GOZhMg").box, { statement: true });
  assert.deepEqual(action(player, core.NpcIdentifiers.ALRENA, "Br9tOd").box, { items: [I.GAS_MASK] });
  assert.equal(player.getInventory().getAmount(I.GAS_MASK), 1);
  assert.equal(quest.getStage(player), 2);
});

test("pouring and digging: message boxes, the dig moves the player into the sewer three ticks later", (t) => {
  const { player, varbits, messages, chatboxes } = actor(t, 6, 2566, 3331);
  const I = core.ItemIdentifiers;
  player.getInventory().adds(I.BUCKET_OF_WATER, 1);
  player.getInventory().adds(I.SPADE, 1);
  assert.equal(itemOnObject(player, I.BUCKET_OF_WATER, 2532, 2566, 3332), true);
  assert.equal(quest.getStage(player), 7);
  assert.deepEqual(chatboxes, [229], "the pour shows in a message box (tick 181)");
  assert.equal(messages.length, 0, "not as a chat message");
  player.getDialogueManager().reset();
  assert.equal(itemOnObject(player, I.SPADE, 2532, 2566, 3332), true);
  tick(2);
  assert.equal(quest.getStage(player), 7, "the stage waits for the fall");
  tick(1);
  assert.equal(quest.getStage(player), 8);
  assert.deepEqual(at(player), [2518, 9759, 0], "tick 191's landing");
  assert.equal(varbits.get(1785), 1, "the dug hole");
  assert.equal(varbits.get(1783), 1, "edmond_bottom shows in the sewer, edmond_top goes");
});

test("the grill: pull, then rope; the rope's box comes a tick after the tie", (t) => {
  const { player, varbits, messages } = actor(t, 8, 2514, 9740);
  const I = core.ItemIdentifiers;
  player.getInventory().adds(I.ROPE, 1);
  assert.equal(itemOnObject(player, I.ROPE, 11422, 2514, 9739), true);
  assert.equal(quest.getStage(player), 8, "rope first only asks to try the grill");
  player.getDialogueManager().reset();
  click(player, 11422, 2514, 9739);
  assert.ok(until(() => varbits.get(1786) === 1, 4), "the first pull is remembered");
  assert.equal(messages.includes("The grill is too secure. You can't pull it off alone."), false, "a message box, not chat");
  player.getDialogueManager().reset();
  assert.equal(itemOnObject(player, I.ROPE, 11422, 2514, 9739), true);
  assert.equal(quest.getStage(player), 9);
  assert.equal(player.getInventory().getAmount(I.ROPE), 0);
  assert.equal(varbits.get(1787), 1);
});

test("Edmond's pull ends the transcript and plays the scene; the pipe opens at its end", (t) => {
  const { player, varbits } = actor(t, 9, 2517, 9751);
  const pull = action(player, core.NpcIdentifiers.EDMOND_2, "oCU2uO", "action");
  assert.equal(pull.handled, true);
  assert.equal(pull.end, true, "the transcript's own pull and lines give way to the scene");
  tick(3);
  assert.notDeepEqual(at(player), [2517, 9751, 0], "the copy of the sewer (tick 271)");
  tick(10);
  const current = box(player);
  assert.ok(current, "Edmond's advice after the pull");
  player.getDialogueManager().advance?.();
  player.getDialogueManager().advance?.();
  tick(4);
  assert.equal(quest.getStage(player), 10);
  assert.equal(varbits.get(1787), 2);
  assert.deepEqual(at(player), [2514, 9740, 0], "back in the real sewer at the pipe (tick 301)");
});

test("the pipe: a grill, Edmond without the mask, the squeeze into West Ardougne with the mask", (t) => {
  const { player } = actor(t, 10, 2514, 9739);
  const I = core.ItemIdentifiers;
  click(player, core.ObjectIdentifiers.PIPE, 2514, 9737);
  tick(2);
  assert.deepEqual(at(player), [2514, 9739, 0], "no mask, no entry");
  player.getDialogueManager().reset();
  player.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.GAS_MASK, 1));
  click(player, core.ObjectIdentifiers.PIPE, 2514, 9737);
  assert.ok(until(() => at(player)[1] === 9736, 3), "the exactmove three tiles in (tick 316)");
  assert.ok(until(() => at(player)[1] === 3304, 8), "and up by the manhole (tick 322)");
  assert.deepEqual(at(player), [2529, 3304, 0]);
});

test("the gas mask stays on in West Ardougne", (t) => {
  const { player, messages } = actor(t, 20, 2538, 3306);
  const I = core.ItemIdentifiers;
  const mask = new core.Item(I.GAS_MASK, 1);
  player.getEquipment().setItem(core.Equipment.HEAD_SLOT, mask);
  assert.equal(PluginManager.emitCanUnequip(player, core.Equipment.HEAD_SLOT, mask), false);
  assert.equal(PluginManager.emitCanEquip(player, core.Equipment.HEAD_SLOT, new core.Item(I.GRACEFUL_HOOD, 1)), false);
  assert.ok(messages.includes("You should leave your gas mask on while you're in West Ardougne."));
  player.setLocation(new core.Location(2566, 3332, 0));
  assert.notEqual(PluginManager.emitCanUnequip(player, core.Equipment.HEAD_SLOT, mask), false, "East Ardougne is free");
});

test("Jethick moves the stage as he knows the picture; a declined book is offered again", (t) => {
  const { player, inv } = actor(t, 10, 2538, 3306);
  const I = core.ItemIdentifiers, jethick = core.NpcIdentifiers.JETHICK;
  inv.adds(I.PICTURE, 1);
  line(player, jethick, "Ah yes. She came over here to help the plague victims. I think she is staying over with the Rehnison family.");
  assert.equal(quest.getStage(player), 20, "tick 384, before the book is offered");
  assert.equal(inv.getAmount(I.BOOK_2), 0);
  const book = action(player, jethick, "_dk_wV");
  assert.equal(inv.getAmount(I.BOOK_2), 1);
  assert.deepEqual(book.box, { items: [I.BOOK_2] });
  assert.equal(quest.getStage(player), 20);
});

test("the Rehnisons, Milli and the mourner move the stage on their own lines", (t) => {
  const { player } = actor(t, 21, 2531, 3330);
  const N = core.NpcIdentifiers;
  line(player, N.MARTHA_REHNISON, "Yes she was staying here, but slightly over a week ago she was getting ready to go back. However she never managed to leave.");
  assert.equal(quest.getStage(player), 22);
  line(player, N.MILLI_REHNISON, "It was the boarded up building with no windows in the south east corner of West Ardougne.");
  assert.equal(quest.getStage(player), 23);
  const door = action(player, N.MOURNER, "LILHam");
  assert.equal(quest.getStage(player), 23, "the black cross is not the clearance");
  assert.deepEqual(door.box, { statement: true });
  line(player, N.MOURNER, "Well you'd need to apply to the head mourner, or I suppose Bravek the city warder.");
  assert.equal(quest.getStage(player), 24, "tick 544");
});

test("Bravek: the note at the third talk, the stage with the cure, then the warrant", (t) => {
  const { player, inv } = actor(t, 25, 2535, 3314);
  const I = core.ItemIdentifiers, bravek = core.NpcIdentifiers.BRAVEK;
  action(player, bravek, "nxSgWb");
  assert.equal(inv.getAmount(I.A_SCRUFFY_NOTE), 1);
  assert.equal(quest.getStage(player), 26, "tick 649");
  inv.adds(I.HANGOVER_CURE, 1);
  action(player, bravek, "Z2OftI");
  assert.equal(inv.getAmount(I.HANGOVER_CURE), 0);
  assert.equal(quest.getStage(player), 27, "tick 672: the cure, not the warrant");
  action(player, bravek, "Pn2ogc");
  assert.equal(inv.getAmount(I.WARRANT), 1);
  action(player, bravek, "Pn2ogc");
  assert.equal(inv.getAmount(I.WARRANT), 1, "one warrant");
});

test("an old save that gave the cure without a warrant still gets it", (t) => {
  const { player, inv } = actor(t, 26, 2535, 3314);
  player.setAttribute("plague-city:cure-given", true);
  action(player, core.NpcIdentifiers.BRAVEK, "Pn2ogc");
  assert.equal(inv.getAmount(core.ItemIdentifiers.WARRANT), 1);
  assert.equal(quest.getStage(player), 27);
});

test("Rehnisons' door: a pass-through door once the book is back", (t) => {
  const { player } = actor(t, 22, 2531, 3328);
  tick(2);
  assert.ok(locAt(core.ObjectIdentifiers.DOOR_85, 2531, 3328), "the closed door is on the map");
  click(player, core.ObjectIdentifiers.DOOR_85, 2531, 3328);
  assert.ok(until(() => locAt(core.ObjectIdentifiers.DOOR_86, 2531, 3329) !== null, 4), "the leaf swings onto the tile north");
  assert.ok(locAt(INVISWALL, 2531, 3328), "with the blocker on the doorway (tick 424)");
  assert.ok(until(() => at(player)[1] === 3329, 4), "the player walks in");
  tick(4);
  assert.equal(locAt(core.ObjectIdentifiers.DOOR_86, 2531, 3329), null, "and the door shuts");
});

test("the plague house with the warrant: the mourner talks first, the sneak-in walks the player through", (t) => {
  const { player, messages } = actor(t, 27, 2540, 3273);
  player.getInventory().adds(core.ItemIdentifiers.WARRANT, 1);
  tick(2);
  click(player, 37321, 2540, 3273);
  tick(2);
  assert.ok(box(player), "the mourner's warning starts");
  assert.equal(at(player)[1], 3273, "the door stays shut");
  const cross = action(player, core.NpcIdentifiers.MOURNER, "ZoJIvd");
  assert.equal(cross.handled, true, "no black cross box with the warrant (ticks 716-722)");
  assert.equal(messages.length, 0);
  player.getDialogueManager().reset();
  const sneak = action(player, core.NpcIdentifiers.MOURNER, "uflJGj");
  assert.deepEqual(sneak.box, { statement: true });
  assert.ok(until(() => at(player)[1] === 3272, 4), "into the house (tick 734)");
});

test("Elena's cell door: locked from outside, the key lets the player in, out freely", (t) => {
  const { player, inv } = actor(t, 27, 2539, 9671);
  const O = core.ObjectIdentifiers;
  tick(2);
  click(player, O.DOOR_78, 2539, 9672);
  tick(2);
  assert.ok(box(player), "the locked door and Elena's plea (tick 762)");
  assert.equal(at(player)[0], 2539);
  player.getDialogueManager().reset();
  inv.adds(core.ItemIdentifiers.A_SMALL_KEY, 1);
  click(player, O.DOOR_78, 2539, 9672);
  assert.ok(until(() => at(player)[0] === 2540, 6), "unlocked, the player walks in (tick 752)");
  assert.equal(inv.getAmount(core.ItemIdentifiers.A_SMALL_KEY), 1, "the key is kept");
  player.getDialogueManager().reset();
  tick(4);
  click(player, O.DOOR_78, 2539, 9672);
  assert.ok(until(() => at(player)[0] === 2539, 6), "and out again with no word (tick 757)");
});

test("Elena leaves once the player continues past her last line", (t) => {
  const { player, varbits } = actor(t, 27, 2540, 9672);
  const event = line(player, core.NpcIdentifiers.ELENA_2, "Go and see my father, I'll make sure he adequately rewards you. Now I'd better leave while I still can.");
  assert.equal(quest.getStage(player), 27);
  event.after();
  assert.equal(quest.getStage(player), 28);
  assert.equal(varbits.get(1784), 1, "Elena at home");
  assert.equal(varbits.get(1783), 0, "the top Edmond is back");
});

test("completion takes the warrant, key, note and picture and leaves the worn mask", (t) => {
  const { player, inv } = actor(t, 28, 2567, 3336);
  const I = core.ItemIdentifiers;
  for (const id of [I.WARRANT, I.A_SMALL_KEY, I.A_SCRUFFY_NOTE, I.PICTURE]) inv.adds(id, 1);
  player.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.GAS_MASK, 1));
  action(player, core.NpcIdentifiers.EDMOND_2, "aGVmkR", "action");
  assert.equal(quest.isComplete(player), true);
  for (const id of [I.WARRANT, I.A_SMALL_KEY, I.A_SCRUFFY_NOTE, I.PICTURE]) assert.equal(inv.getAmount(id), 0);
  assert.equal(inv.getAmount(I.ARDOUGNE_TELEPORT_SCROLL), 1);
  assert.equal(player.getEquipment().get(core.Equipment.HEAD_SLOT)?.getId(), I.GAS_MASK);
});

test("after the quest, Edmond thanks a player holding the scroll and offers one to a player without", (t) => {
  const { player, inv } = actor(t, 29, 2567, 3336);
  const npcId = core.NpcIdentifiers.EDMOND_2;
  const definition = core.NpcDefinition.forId(npcId);
  const variant = () => PluginManager.emitNpcDialogueVariant({ player, npcId, definition, pages: [] });
  inv.adds(core.ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL, 1);
  assert.equal(variant(), "standard-dialogue-after-plague-city", "tick 889: no scroll menu");
  inv.deleteNumber(core.ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL, 1);
  assert.match(variant(), /again-before-using-the-ardougne-teleport-scroll/);
});

test("Elena can't be talked to through her cell wall", (t) => {
  const { player, messages } = actor(t, 27, 2539, 9673);
  const elena = { getId: () => 6206, getLocation: () => new core.Location(2540, 9673, 0), getCurrentDefinition: () => core.NpcDefinition.forId(4257) };
  const event = { player, npc: elena, npcId: 6206, clickType: 1, handled: false, location: { x: 2540, y: 9673, z: 0 } };
  assert.equal(PluginManager.emitNpcInteraction(event), true);
  assert.deepEqual(messages, ["I can't reach that!"], "tick 775");
});

test("the West Ardougne manhole opens with its cover and closes again", (t) => {
  const { player, messages } = actor(t, 20, 2530, 3304);
  const O = core.ObjectIdentifiers;
  tick(1);
  if (!locAt(O.MANHOLE_3, 2529, 3303)) {
    click(player, O.MANHOLE_COVER, 2529, 3302);
    tick(3);
  }
  click(player, O.MANHOLE_3, 2529, 3303);
  assert.ok(until(() => locAt(O.MANHOLE_4, 2529, 3303) !== null, 4), "open");
  assert.ok(locAt(O.MANHOLE_COVER, 2529, 3302), "the cover lies beside it, as live shows it (tick 322)");
  assert.ok(messages.includes("You pull back the manhole cover."));
  click(player, O.MANHOLE_COVER, 2529, 3302);
  assert.ok(until(() => locAt(O.MANHOLE_3, 2529, 3303) !== null, 4), "closed again");
  assert.equal(locAt(O.MANHOLE_COVER, 2529, 3302), null);
});

test("cured Bravek but no warrant: the plague house stays shut", (t) => {
  const { player } = actor(t, 27, 2540, 3273);
  tick(2);
  click(player, 37321, 2540, 3273);
  tick(2);
  action(player, core.NpcIdentifiers.MOURNER, "uflJGj");
  tick(4);
  assert.equal(at(player)[1], 3273, "no sneak-in without the warrant");
  const npcId = 7382;
  assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId, definition: core.NpcDefinition.forId(8975), pages: [] }), null);
});

test("after Elena is freed the cell door is only locked", (t) => {
  const { player, chatboxes } = actor(t, 29, 2539, 9671);
  tick(2);
  click(player, core.ObjectIdentifiers.DOOR_78, 2539, 9672);
  tick(2);
  assert.deepEqual(chatboxes, [229], "the locked box, not Elena's plea");
});

test("a second spade use during the fall does nothing", (t) => {
  const { player, chatboxes } = actor(t, 7, 2566, 3331);
  player.getInventory().adds(core.ItemIdentifiers.SPADE, 1);
  itemOnObject(player, core.ItemIdentifiers.SPADE, 2532, 2566, 3332);
  tick(1);
  itemOnObject(player, core.ItemIdentifiers.SPADE, 2532, 2566, 3332);
  tick(4);
  assert.equal(chatboxes.length, 2, "one dig: the box and its repeat after the fall");
  assert.deepEqual(at(player), [2518, 9759, 0]);
});
