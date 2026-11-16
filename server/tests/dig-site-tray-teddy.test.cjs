// Run after `yarn build`: node --test tests/dig-site-tray-teddy.test.cjs
//
// The Dig Site's mud tray keeps its mud when the coin reward can't be added (a stack at the cap), and
// the teddy bush gives no second teddy while one is banked. Real plugins, a real Player, Inventory
// and Bank; the clicks go through PluginManager.emitItemAction / emitObjectInteraction with the
// cache's own Search option. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const MAX_STACK = 2147483647;
let core;
let index = 7640;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(3370, 3378, 0));
  p.needsPlacement = false;
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { messages.push(String(text)); return send(text, ...rest); };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  return { p, messages };
}

const digSite = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_dig_site");

function searchTray(p, slot) {
  const item = p.getInventory().getItems()[slot];
  const action = [2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(item.getId(), op))
    .find((candidate) => candidate?.option?.toLowerCase() === "search");
  assert.ok(action, "the native resolver exposes Search");
  return PM.emitItemAction({ player: p, item, itemId: item.getId(), slot, interfaceId: (149 << 16),
    clickType: action.optionIndex, option: action.option, handled: false });
}

function searchBush(p) {
  const id = core.ObjectIdentifiers.BUSH_10;
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((option) => option?.toLowerCase() === "search") + 1;
  assert.ok(clickType > 0, "the bush has the cache's Search option");
  const at = { x: 3370, y: 3379, z: 0 };
  return PM.emitObjectInteraction({ player: p, object: { getId: () => id, getLocation: () => new core.Location(at.x, at.y, 0) },
    objectId: id, definition, clickType, location: at, sourceLocation: { x: 3370, y: 3378, z: 0 }, handled: false });
}

test("a coin stack at the cap leaves the mud in the tray instead of losing the coins", (t) => {
  const { p } = player(t, "digsitetray1");
  const I = core.ItemIdentifiers;
  const inventory = p.getInventory();
  inventory.setItem(0, new core.Item(I.PANNING_TRAY_3, 1));
  inventory.setItem(1, new core.Item(I.COINS, MAX_STACK));
  t.mock.method(Math, "random", () => 0); // roll 0: coins, then the smallest amount
  assert.equal(searchTray(p, 0), true);
  assert.equal(inventory.getItems()[0].getId(), I.PANNING_TRAY_3, "the mud stays for later");
  assert.equal(inventory.getAmount(I.COINS), MAX_STACK);

  inventory.setItem(1, new core.Item(I.COINS, 100));
  assert.equal(searchTray(p, 0), true);
  assert.equal(inventory.getItems()[0].getId(), I.PANNING_TRAY, "searched once there is room");
  assert.equal(inventory.getAmount(I.COINS), 101);
});

test("the teddy bush gives no second teddy while one is banked, and does once it is gone", (t) => {
  const { p, messages } = player(t, "digsiteteddy1");
  const I = core.ItemIdentifiers;
  digSite().setStage(p, 1);
  p.getBank(0).add(new core.Item(I.TEDDY, 1));
  assert.equal(searchBush(p), true);
  assert.equal(p.getInventory().getAmount(I.TEDDY), 0, "already owned in the bank");
  assert.ok(messages.includes("You find nothing of interest."));

  p.getBank(0).resetItems();
  p.getBank(0).add(new core.Item(I.TEDDY, 0)); // a placeholder is not a teddy
  assert.equal(searchBush(p), true);
  assert.equal(p.getInventory().getAmount(I.TEDDY), 1, "a lost teddy can be found again");
});

/** Real Talk-to variant selection, as the dialogue runtime asks every plugin. */
const talkToStudent = (p, npcId) => PM.emitNpcDialogueVariant({ player: p, npcId, pages: [] });

test("the three students ask for their own lost item and take it back on the second talk", (t) => {
  const { p } = player(t, "digsitestudents1");
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  digSite().setStage(p, 1);
  p.setAttribute("quest.the_dig_site.letter_stamped", true);
  p.setAttribute("quest.the_dig_site.letter_delivered", true);

  const cases = [
    [N.STUDENT, I.ANIMAL_SKULL, "green-top", "skull"],
    [N.STUDENT_2, I.TEDDY, "purple-skirt", "teddy-bear"],
    [N.STUDENT_3, I.SPECIAL_CUP, "orange-shirt", "cup"],
  ];
  for (const [npcId, itemId, who, lost] of cases) {
    const prefix = `the-first-exam-the-student-in-the-${who}`;
    assert.equal(talkToStudent(p, npcId), `${prefix}-asking-the-student-for-help`,
      `${who} asks for help on the first talk`);
    assert.equal(talkToStudent(p, npcId), `${prefix}-returning-to-the-student-without-the-${lost}`,
      `${who} asks for their own item while it is missing`);
    p.getInventory().adds(itemId, 1);
    assert.equal(talkToStudent(p, npcId), `${prefix}-returning-the-${lost}`,
      `${who} takes the item back`);
    assert.equal(p.getInventory().getAmount(itemId), 0, `${who} consumes the item`);
    assert.equal(talkToStudent(p, npcId), `${prefix}-talking-to-the-student-again`,
      `${who} repeats the answer after the item is returned`);
  }
});

/** Asks a student and hands their lost item back: two talks. */
function helpStudent(p, npcId, itemId) {
  talkToStudent(p, npcId);
  p.getInventory().adds(itemId, 1);
  return talkToStudent(p, npcId);
}

test("the level 1 certificate waits until all three lost items are back", (t) => {
  const { p } = player(t, "digsiteallthree1");
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  digSite().setStage(p, 1);
  p.setAttribute("quest.the_dig_site.letter_stamped", true);
  p.setAttribute("quest.the_dig_site.letter_delivered", true);

  // Green alone, item still missing: no certificate (the old shortcut signed on this talk).
  assert.equal(talkToStudent(p, N.STUDENT),
    "the-first-exam-the-student-in-the-green-top-asking-the-student-for-help");
  assert.equal(p.getInventory().getAmount(I.LEVEL_1_CERTIFICATE), 0, "no answers yet, no certificate");
  assert.equal(digSite().getStage(p), 1);

  // Green's skull back, two students still unhelped: still no certificate.
  p.getInventory().adds(I.ANIMAL_SKULL, 1);
  assert.equal(talkToStudent(p, N.STUDENT),
    "the-first-exam-the-student-in-the-green-top-returning-the-skull");
  assert.equal(p.getInventory().getAmount(I.LEVEL_1_CERTIFICATE), 0, "one of three answers");
  helpStudent(p, N.STUDENT_2, I.TEDDY);
  assert.equal(p.getInventory().getAmount(I.LEVEL_1_CERTIFICATE), 0, "two of three answers");
  assert.equal(digSite().getStage(p), 1);

  // The last hand-in signs level 1, whichever student it is.
  assert.equal(helpStudent(p, N.STUDENT_3, I.SPECIAL_CUP),
    "the-first-exam-the-student-in-the-orange-shirt-returning-the-cup");
  assert.equal(p.getInventory().getAmount(I.LEVEL_1_CERTIFICATE), 1);
  assert.equal(digSite().getStage(p), 2);

  // Levels 2 and 3 still come from the purple and the orange student.
  talkToStudent(p, N.STUDENT);
  assert.equal(p.getInventory().getAmount(I.LEVEL_2_CERTIFICATE), 0, "green does not sign level 2");
  assert.equal(talkToStudent(p, N.STUDENT_2),
    "the-first-exam-the-student-in-the-purple-skirt-talking-to-the-student-again");
  assert.equal(p.getInventory().getAmount(I.LEVEL_2_CERTIFICATE), 1);
  talkToStudent(p, N.STUDENT_3);
  assert.equal(p.getInventory().getAmount(I.LEVEL_3_CERTIFICATE), 1);
  assert.equal(digSite().getStage(p), 4);
});

test("a student asked before their exam still signs the certificate when it comes up", (t) => {
  const { p } = player(t, "digsiteearly1");
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  digSite().setStage(p, 1);
  p.setAttribute("quest.the_dig_site.letter_stamped", true);
  p.setAttribute("quest.the_dig_site.letter_delivered", true);

  // Purple is helped first, before her own (level 2) stage: no level 2 certificate yet.
  helpStudent(p, N.STUDENT_2, I.TEDDY);
  assert.equal(p.getInventory().getAmount(I.LEVEL_2_CERTIFICATE), 0);
  helpStudent(p, N.STUDENT_3, I.SPECIAL_CUP);
  assert.equal(p.getInventory().getAmount(I.LEVEL_3_CERTIFICATE), 0);

  // Green's hand-in completes the three answers and signs level 1.
  helpStudent(p, N.STUDENT, I.ANIMAL_SKULL);
  assert.equal(p.getInventory().getAmount(I.LEVEL_1_CERTIFICATE), 1);
  assert.equal(digSite().getStage(p), 2);

  // The early help does not block purple's certificate.
  assert.equal(talkToStudent(p, N.STUDENT_2),
    "the-first-exam-the-student-in-the-purple-skirt-talking-to-the-student-again");
  assert.equal(p.getInventory().getAmount(I.LEVEL_2_CERTIFICATE), 1);
  assert.equal(digSite().getStage(p), 3);
});

test("a full inventory does not lose the certificate opportunity", (t) => {
  const { p, messages } = player(t, "digsitefull1");
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  digSite().setStage(p, 1);
  // All three helped while the examiner still waits for the letter: no exam yet, no certificate.
  helpStudent(p, N.STUDENT, I.ANIMAL_SKULL);
  helpStudent(p, N.STUDENT_2, I.TEDDY);
  helpStudent(p, N.STUDENT_3, I.SPECIAL_CUP);
  assert.equal(p.getInventory().getAmount(I.LEVEL_1_CERTIFICATE), 0);
  p.setAttribute("quest.the_dig_site.letter_stamped", true);
  p.setAttribute("quest.the_dig_site.letter_delivered", true);
  const inventory = p.getInventory();
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.TROWEL, 1));
  assert.equal(inventory.getFreeSlots(), 0);

  // The answer plays, but the certificate has nowhere to go.
  assert.equal(talkToStudent(p, N.STUDENT),
    "the-first-exam-the-student-in-the-green-top-talking-to-the-student-again");
  assert.ok(messages.some((text) => text.includes("don't have enough inventory space")));
  assert.equal(inventory.getAmount(I.LEVEL_1_CERTIFICATE), 0);
  assert.equal(digSite().getStage(p), 1);

  // A later talk with a free slot still signs it.
  inventory.deleteAtSlot(0);
  assert.equal(talkToStudent(p, N.STUDENT),
    "the-first-exam-the-student-in-the-green-top-talking-to-the-student-again");
  assert.equal(inventory.getAmount(I.LEVEL_1_CERTIFICATE), 1);
  assert.equal(digSite().getStage(p), 2);
});
