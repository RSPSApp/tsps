// Run after `yarn build`: node --test tests/brimhaven-backdoor.test.cjs
// Banisoch's fee and the Brimhaven Dungeon's back entrance, with every plugin loaded, the shipped
// map and a real Player (its own Inventory, MovementQueue, PacketSender and DialogueManager; only
// the network is stubbed). Recorded in rsprox 1002134 (ticks 5793-5843, 8373).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const ROOT = path.resolve(__dirname, "..");

let PluginManager, core, Player, CacheDefinitions, ObjectDefinition, MapObjects, OptionDialogue, Backdoor;
const HOLE = [2759, 3062, 0];
const BESIDE_HOLE = [2760, 3061, 0];
const CREVICE = [2734, 9477, 0];
const BANISOCH_TILE = [2757, 3061, 0];

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(ROOT);
  ({ PluginManager } = require("../dist/plugins/PluginManager"));
  ({ CacheDefinitions } = require("../dist/game/cache/CacheDefinitions"));
  ({ ObjectDefinition } = require("../dist/game/definition/ObjectDefinition"));
  ({ MapObjects } = require("../dist/game/entity/impl/object/MapObjects"));
  ({ OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue"));
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require("../dist/game/entity/impl/player/Player"));
  Backdoor = require("../plugins/areas/BrimhavenDungeon.plugin")._test.Backdoor;
  core.RegionManager.loadMapFiles(HOLE[0], HOLE[1]);
  core.RegionManager.loadMapFiles(CREVICE[0], CREVICE[1]);
});

const sticksId = () => CacheDefinitions.getObjId("village_trade_sticks");

/** A real player beside the hole, carrying `sticks` trading sticks; sounds are kept in `sounds`. */
function visitor(t, sticks = 0) {
  const p = new Player(null);
  p.setUsername(`backdoor${Math.floor(Math.random() * 1e6)}`);
  p.setLocation(new core.Location(...BESIDE_HOLE));
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  p.isRegistered = () => true;
  p.getInventory().refreshItems = () => {};
  if (sticks) p.getInventory().adds(sticksId(), sticks);
  const sounds = [];
  const sender = p.getPacketSender();
  const sendSound = sender.sendSound.bind(sender);
  t.mock.method(sender, "sendSound", (id, ...rest) => { sounds.push(id); return sendSound(id, ...rest); });
  return { p, sounds };
}

function shown(p) {
  const prompt = core.MultiChatboxPrompt.getPending(p);
  if (prompt) return { options: prompt.options, prompt: true };
  const entry = p.getDialogueManager().getCurrent();
  if (!entry) return null;
  if (entry instanceof OptionDialogue) return { options: entry.getOptions(), title: entry.getTitle() };
  return { text: entry.getText?.(), npcId: entry.getNpcId?.() };
}

/** Plays the open dialogue to its end, picking each option in `choices` by its text. */
function drive(p, choices = []) {
  const seen = [];
  const dialogues = p.getDialogueManager();
  for (let guard = 0; guard < 60; guard++) {
    core.TaskManager.process();
    const now = shown(p);
    if (!now) return seen;
    seen.push(now);
    if (now.options) {
      const wanted = choices.shift();
      const index = now.options.indexOf(wanted);
      assert.ok(index >= 0, `no option "${wanted}" in ${now.options.join(" | ")}`);
      if (now.prompt) {
        const { MultiChatboxPrompt } = core;
        MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: MultiChatboxPrompt.INTERFACE_ID, slot: index + 1 });
      } else {
        dialogues.handleResume(OptionDialogue.OPTIONS_WIDGET_ID, index + 1);
      }
    } else {
      dialogues.advance();
    }
  }
  assert.fail("the dialogue never ended");
}

const lines = (seen) => seen.filter((entry) => entry.text).map((entry) => entry.text.replace(/<br>/g, " ").replace(/\s+/g, " "));
const varbit = (p) => p.getPacketSender().getVarbit(CacheDefinitions.getVarbitId("karam_dungeon_backdoor"));
const at = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };

function talkTo(p) {
  const id = CacheDefinitions.getNpcId("karam_dungeon_backdoor");
  const npc = new core.NPC(id, new core.Location(...BANISOCH_TILE));
  const definition = core.NpcDefinition.forId(CacheDefinitions.getNpcId(varbit(p) ? "karam_dungeon_backdoor_paid" : "karam_dungeon_backdoor_unpaid"));
  assert.equal(PluginManager.emitNpcInteraction({
    player: p, npc, definition, npcId: id, npcIndex: -1, clickType: 1,
    location: { x: BANISOCH_TILE[0], y: BANISOCH_TILE[1], z: 0 }, handled: false,
  }), true);
}

/** A click on a loc as the client sends it: the base multiloc and the variant this player sees. */
function clickLoc(p, name, tile) {
  const object = MapObjects.get(CacheDefinitions.getLocId(name), new core.Location(...tile), null);
  assert.ok(object, `${name} is on the map`);
  const definition = ObjectDefinition.forPlayer(object.getId(), p);
  const option = definition.getInteractions()?.[0] ?? null;
  const event = { player: p, object, objectId: object.getId(), definition, clickType: 1, option: option?.toLowerCase(), location: { x: tile[0], y: tile[1], z: tile[2] }, handled: false };
  const handled = option ? PluginManager.emitObjectInteraction(event) : false;
  return { handled, option, name: definition.getName() };
}

/** Already paid (1) or told not to warn again (2), as a login would sync it. */
function paidAs(p, value) {
  p.setAttribute(Backdoor.BACKDOOR_ATTRIBUTE, value);
  p.getPacketSender().sendVarbit(CacheDefinitions.getVarbitId("karam_dungeon_backdoor"), value);
}

const clickHole = (p) => clickLoc(p, "brimhaven_backdoor_entrance", HOLE);

function useOnHole(p, itemId) {
  const object = MapObjects.get(CacheDefinitions.getLocId("brimhaven_backdoor_entrance"), new core.Location(...HOLE), null);
  p.getInventory().adds(itemId, 1);
  const slot = p.getInventory().getSlot(itemId);
  return PluginManager.emitItemOnObject({
    player: p, object, definition: ObjectDefinition.forPlayer(object.getId(), p), objectId: object.getId(),
    item: p.getInventory().get(slot), itemId, itemSlot: slot, interfaceType: 0,
    location: { x: HOLE[0], y: HOLE[1], z: 0 }, handled: false,
  });
}

test("unpaid, the hole has no options; Talk-to pays 5,000 trading sticks and the hole becomes the rope", (t) => {
  const { p, sounds } = visitor(t, 5100);
  assert.deepEqual(clickHole(p), { handled: false, option: null, name: "Hole" });
  talkTo(p);
  const seen = drive(p, ["Tell me about this hole.", "Can I go down?", "It's a deal - here's 5,000 trading sticks."]);
  assert.deepEqual(seen[1].options, ["Who are you?", "Tell me about this hole.", "I'll leave you alone."]);
  assert.deepEqual(lines(seen).slice(-2), [
    "It's a deal - here's 5,000 trading sticks.",
    "You pay 5,000 trading sticks. Banisoch adds a climbing rope to the hole for you.",
  ]);
  assert.equal(p.getInventory().getAmount(sticksId()), 100, "as recorded, 100 left of 5,100");
  assert.equal(varbit(p), 1);
  assert.equal(p.getPacketSender().getVarbit(CacheDefinitions.getVarbitId("karam_dungeon_doordata")), 2, "as recorded (1002134)");
  assert.ok(sounds.includes(3023), "slug_dry_sticks on the payment");
  const hole = clickLoc(p, "brimhaven_backdoor_entrance", HOLE);
  assert.equal(hole.name, "Rope");
  assert.equal(hole.option, "Climb");

  talkTo(p);
  const after = drive(p, ["Can I climb down that hole now?"]);
  assert.ok(lines(after).includes("Yes, you've paid, you can climb down there whenever you like. Go, go."));
  assert.equal(p.getInventory().getAmount(sticksId()), 100, "nothing more taken");
});

test("without 5,000 trading sticks he only gets an Oh.", (t) => {
  const { p } = visitor(t, 4999);
  talkTo(p);
  const seen = drive(p, ["Tell me about this hole.", "Can I go down?"]);
  assert.equal(lines(seen).at(-1), "Oh.");
  assert.equal(p.getInventory().getAmount(sticksId()), 4999);
  assert.equal(varbit(p), 0);
});

test("the first Climb warns; 'don't see this warning again' goes down and skips it after", (t) => {
  const { p, sounds } = visitor(t);
  paidAs(p, 1);
  assert.equal(clickHole(p).handled, true);
  const warning = shown(p);
  assert.equal(warning.text, "I think there's dragons down there.<br>Make sure you're prepared.");
  assert.equal(warning.npcId, CacheDefinitions.getNpcId("karam_dungeon_backdoor_paid"));
  p.getDialogueManager().advance();
  const menu = shown(p);
  assert.deepEqual(menu.options, ["Enter the dungeon.", "Enter, and don't see this warning again.", "Stay out."]);
  assert.equal(menu.title, "Select an option");
  p.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, 2);
  assert.equal(varbit(p), 2);
  assert.deepEqual(at(p), BESIDE_HOLE, "the fade first");
  ticks(1);
  assert.deepEqual(at(p), Backdoor.INSIDE, "the move a tick after the fade out");
  assert.ok(sounds.includes(2495), "tightrope on the move");
  ticks(2);

  // Out through the crevice, then straight down again with no warning.
  assert.equal(clickLoc(p, "brimhaven_backdoor_exit", CREVICE).handled, true);
  ticks(3);
  assert.deepEqual(at(p), Backdoor.OUTSIDE);
  assert.equal(clickHole(p).handled, true);
  assert.equal(shown(p), null, "no warning");
  ticks(3);
  assert.deepEqual(at(p), Backdoor.INSIDE);
});

test("'Enter the dungeon.' keeps the warning; 'Stay out.' stays", (t) => {
  const { p } = visitor(t);
  paidAs(p, 1);
  clickHole(p);
  drive(p, ["Stay out."]);
  ticks(3);
  assert.deepEqual(at(p), BESIDE_HOLE);
  clickHole(p);
  drive(p, ["Enter the dungeon."]);
  ticks(3);
  assert.deepEqual(at(p), Backdoor.INSIDE);
  assert.equal(varbit(p), 1, "the warning shows next time");
});

test("the crevice does nothing of ours for a player who hasn't paid", (t) => {
  const { p } = visitor(t);
  p.setLocation(new core.Location(CREVICE[0], CREVICE[1] + 1, 0));
  assert.equal(clickLoc(p, "brimhaven_backdoor_exit", CREVICE).handled, false);
  ticks(3);
  assert.deepEqual(at(p), [CREVICE[0], CREVICE[1] + 1, 0]);
});

test("items on the hole: a rope before paying, anything after, get his lines", (t) => {
  const unpaid = visitor(t);
  assert.equal(useOnHole(unpaid.p, CacheDefinitions.getObjId("bronze_axe")), false, "other items: nothing of ours");
  assert.equal(useOnHole(unpaid.p, CacheDefinitions.getObjId("rope")), true);
  assert.deepEqual(lines(drive(unpaid.p)), ["Hey, I didn't say you could do that!"]);

  const paid = visitor(t);
  paidAs(paid.p, 2);
  assert.equal(useOnHole(paid.p, CacheDefinitions.getObjId("bronze_axe")), true);
  assert.deepEqual(lines(drive(paid.p)), ["Either go down it or don't go down it, but stop messing around with it!"]);
});

test("login sends the saved state, so the rope and the paid Banisoch stay after a relog", (t) => {
  const { p } = visitor(t);
  p.setAttribute(Backdoor.BACKDOOR_ATTRIBUTE, 2);
  assert.equal(varbit(p), 0);
  PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(varbit(p), 2);
  assert.equal(clickHole(p).name, "Rope");
});
