// Run after `yarn build`: node --test tests/vineyard-foreman-barrel.test.cjs
//
// Issue #5743: the Vineyard foreman's transcript offers the grape barrel, but no plugin answered
// its message steps, so the barrel was never added. Real cache, every plugin loaded, a real Player
// and the foreman's own spawn; Talk-to is dispatched natively and the option is picked from the
// real multi-chatbox prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");

const FOREMAN = 13908;
const BARREL = 30037;
const AT = [1370, 2915, 0];
let core, foreman, next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  foreman = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === FOREMAN)
    ?? PM.spawnNpc({ id: FOREMAN, x: AT[0], y: AT[1], z: 0, wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

function player(freeSlots = 28) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("vineyard" + next); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  const at = foreman.getLocation();
  p.setLocation(new core.Location(at.getX() + 1, at.getY(), 0)); p.needsPlacement = false;
  if (freeSlots < 28) p.getInventory().adds(core.ItemIdentifiers.BONES, 28 - freeSlots);
  return p;
}

function tick(p, connection) {
  core.TaskManager.processWalkTo(p.getIndex()); p.getMovementQueue().process(); core.TaskManager.process(); connection.processTurnPackets();
}

/** Advances the open line dialogue until the multi-chatbox prompt appears. */
function promptFor(p) {
  for (let i = 0; i < 20; i++) {
    const pending = MultiChatboxPrompt.getPending(p);
    if (pending) return pending;
    const current = p.getDialogueManager().getCurrent?.();
    if (!current) return null;
    p.getDialogueManager().advance();
    for (let t = 0; t < 2; t++) core.TaskManager.process();
  }
  return MultiChatboxPrompt.getPending(p);
}

async function talk(p) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel); connection.player = p;
  const op = foreman.getCurrentDefinition(p).getActions().findIndex((action) => action === "Talk-to") + 1;
  assert.ok(op > 0, "the foreman has a Talk-to option");
  await connection.dispatch([{ type: "npc_option", index: foreman.getIndex(), clickType: op }]);
  for (let i = 0; i < 6; i++) tick(p, connection);
  return connection;
}

/** Ends the open branch after an option was picked, showing every line and box. */
function finish(p) {
  const seen = [];
  for (let i = 0; i < 30; i++) {
    const current = p.getDialogueManager().getCurrent?.();
    if (!current) return seen;
    seen.push(current);
    p.getDialogueManager().advance();
    core.TaskManager.process();
  }
  return seen;
}

async function askForWork(p) {
  await talk(p);
  const prompt = promptFor(p);
  assert.ok(prompt, "the foreman opens a menu");
  const index = prompt.options.findIndex((text) => text.startsWith("Do you need any help"));
  assert.ok(index >= 0, "the menu offers the vineyard work");
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: p, groupId: 219, slot: index + 1 }), true);
  return finish(p);
}

test("the foreman gives the grape barrel the first time the player asks for work (#5743)", async () => {
  const p = player();
  const seen = await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1, "the barrel is in the inventory");
  assert.ok(seen.some((entry) => entry instanceof ItemStatementDialogue
    && entry.getItemId() === BARREL
    && /The foreman gives you a grape barrel\./.test(entry.getText())),
  "the handout opens the recorded item box with the barrel");
});

test("asking again with the barrel does not give a second one", async () => {
  const p = player();
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1);
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1, "still one barrel");
});

test("a player with no inventory space is refused and gets no barrel", async () => {
  const p = player(0);
  const seen = await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 0, "no barrel when the inventory is full");
  assert.ok(!seen.some((entry) => entry instanceof ItemStatementDialogue && entry.getItemId() === BARREL),
    "the refusal does not open the barrel's item box");
});

test("a player who lost the barrel is given another on the repeat branch", async () => {
  const p = player();
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1);
  p.getInventory().deleteNumber(BARREL, 1);
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1, "the foreman replaces a lost barrel");
});

// ---- picking (issue 6108; RSProx 237/1098 ticks 11955-16598) ---------------------------------------

const Vineyard = require("../plugins/world/Vineyard.plugin.js")._test;

/** Pick on a vine tile through the object option packet, the player standing beside it. */
async function pickAt(p, connection, [x, y]) {
  p.moveTo(new core.Location(x + 1, y, 0)); p.needsPlacement = false;
  const vine = core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null).find((object) => object.getDefinition()?.getName() === "Grapevine");
  assert.ok(vine, `a grapevine at ${x},${y}`);
  await connection.dispatch([{ type: "object_option", id: vine.getId(), x, y, action: "Pick" }]);
  for (let i = 0; i < 4; i++) tick(p, connection);
}

function besideForeman(p) {
  const at = foreman.getLocation();
  p.moveTo(new core.Location(at.getX() + 1, at.getY(), 0)); p.needsPlacement = false;
}

function messagesOf(p) {
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => (messages.push(String(text)), send(text, ...rest));
  return messages;
}

test("four ripe vines of the player's own sparkle (map_anim 3005 at height 50) and fill the barrel 1/4..4/4; an unripe one does not", async () => {
  assert.ok(Vineyard.vineTiles().length > 20, `the vineyards' Pick grapevines: ${Vineyard.vineTiles().length}`);
  const p = player();
  const connection = new ClientConnection({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  connection.player = p;
  const messages = messagesOf(p);
  const graphics = [];
  const sendGraphic = p.getPacketSender().sendGraphic.bind(p.getPacketSender());
  p.getPacketSender().sendGraphic = (graphic, at) => (graphics.push([graphic.id, graphic.height, at.getX(), at.getY()]), sendGraphic(graphic, at));
  Vineyard.arrived(p);
  const ripe = p.getAttribute(Vineyard.RIPE_ATTRIBUTE);
  assert.equal(ripe.length, 4, "four ripe vines on arriving, before any barrel (tick 11955)");
  assert.equal(new Set(ripe.map(String)).size, 4, "four different ones");
  core.TaskManager.process();
  for (const [x, y] of ripe) assert.ok(graphics.some(([id, height, gx, gy]) => id === 3005 && height === 50 && gx === x && gy === y), `${x},${y} sparkles`);

  const unripe = Vineyard.vineTiles().find((tile) => !ripe.some((each) => String(each) === String(tile)));
  await pickAt(p, connection, unripe);
  assert.ok(messages.includes(Vineyard.UNRIPE), messages.join(" | "));
  await pickAt(p, connection, ripe[0]);
  assert.equal(messages.at(-1), "You don't have anything to put those grapes in.", "a ripe vine with no barrel (1098 tick 16266)");
  assert.equal(p.getAttribute(Vineyard.RIPE_ATTRIBUTE).length, 4, "and it stays ripe");

  besideForeman(p);
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1);
  Vineyard.check({ player: p });
  assert.equal(messages.at(-1), Vineyard.CHECK_EMPTY);
  for (let i = 0; i < 4; i++) {
    await pickAt(p, connection, ripe[i]);
    assert.equal(messages.at(-1), i < 3 ? Vineyard.PICKED(i + 1) : Vineyard.FULL, messages.join(" | "));
  }
  assert.equal(p.getAttribute(Vineyard.RIPE_ATTRIBUTE).length, 0, "every ripe vine picked");
  await pickAt(p, connection, ripe[0]);
  assert.equal(messages.at(-1), Vineyard.UNRIPE, "a picked vine is no longer ripe");
  Vineyard.check({ player: p });
  assert.equal(messages.at(-1), Vineyard.CHECK_FULL);

  // The full barrel: the foreman's full-barrel variant pays on "Great work!..." (tick 16598).
  const before = p.getInventory().getAmount(core.ItemIdentifiers.GRAPES_2);
  besideForeman(p);
  await talk(p);
  const seen = finish(p);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.GRAPES_2) - before, 5, "5 noted grapes");
  assert.equal(p.getAttribute(Vineyard.GRAPES_ATTRIBUTE), 0, "the barrel is empty again");
  assert.equal(p.getInventory().getAmount(BARREL), 1, "the barrel is kept");
  assert.equal(p.getAttribute(Vineyard.RIPE_ATTRIBUTE).length, 4, "four new ripe vines");
  assert.ok(seen.length >= 5, "the six-line conversation");
});

test("a barrel lost part-full: the replacement comes with four ripe vines again, so it can still be filled", async () => {
  const p = player();
  const connection = new ClientConnection({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  connection.player = p;
  const messages = messagesOf(p);
  besideForeman(p);
  await askForWork(p);
  const ripe = p.getAttribute(Vineyard.RIPE_ATTRIBUTE);
  assert.equal(ripe.length, 4);
  for (let i = 0; i < 2; i++) await pickAt(p, connection, ripe[i]);
  assert.equal(p.getAttribute(Vineyard.GRAPES_ATTRIBUTE), 2);
  p.getInventory().deleteNumber(BARREL, 1);
  besideForeman(p);
  await askForWork(p);
  assert.equal(p.getAttribute(Vineyard.GRAPES_ATTRIBUTE), 0, "the new barrel is empty");
  const fresh = p.getAttribute(Vineyard.RIPE_ATTRIBUTE);
  assert.equal(fresh.length, 4, "and four vines ripe for it");
  for (const tile of fresh) await pickAt(p, connection, tile);
  assert.equal(messages.at(-1), Vineyard.FULL, messages.join(" | "));
});

test("handing in with a full pack: the 5 noted grapes land at the player's feet, not lost", () => {
  const p = player(0);
  p.getInventory().resetItems();
  p.getInventory().adds(BARREL, 1);
  p.getInventory().adds(core.ItemIdentifiers.BONES, 27);
  p.setAttribute(Vineyard.GRAPES_ATTRIBUTE, 4);
  Vineyard.handIn(p);
  const floor = core.ItemOnGroundManager.getGroundItem?.(p.getUsername(), core.ItemIdentifiers.GRAPES_2, p.getLocation(), null)
    ?? [...(core.ItemOnGroundManager.getItems?.() ?? [])].find((drop) => drop.getItem().getId() === core.ItemIdentifiers.GRAPES_2 && drop.getPosition?.().equals(p.getLocation()));
  assert.ok(floor, "the grapes on the floor");
  assert.equal(floor.getItem().getAmount(), 5);
});
