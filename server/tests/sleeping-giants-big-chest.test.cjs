// Run after `yarn build`: node --test tests/sleeping-giants-big-chest.test.cjs
// Sleeping Giants: while the quest keeps the foundry the player's own, the bank chest's tile (3375, 11493) holds
// giants_foundry_chest_cutscene (44613) through the introduction and then giants_foundry_chest_quest, "Big chest"
// (43866): Use opens the bank, Inspect plays the Wiki's big-chest lines, Collect opens the collection box (rsprox
// captures 1001431 ticks 2445/2552/2780-2800, 1001436, 1001438). Real engine: every plugin loaded, a real Player in
// the World, the quest's own intro hook and dialogue lines.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const CHEST = { x: 3375, y: 11493 };
const BIG_CHEST = 43866;
const CUTSCENE_CHEST = 44613;
const BANK = 12;
const GE_COLLECT = 402;
let core;
let next = 9160;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** A fresh player through the quest start: the intro cutscene puts them in their own workshop. */
function startIntro(t) {
  const channel = { kind: "test", binaryTransport: true, remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session);
  session.setPlayer(p);
  p.setUsername("sgchest" + next++); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3368, 3152, 0)); p.setNeedsPlacement(false);
  t.mock.method(p, "onAdd", () => {}); t.mock.method(p, "onRemove", () => {});
  const c = new ClientConnection(channel); c.player = p;
  session.setTurnPacketProcessor(() => c.processTurnPackets());
  assert.equal(core.World.getPlayers().add(p), true);
  core.World.refreshActiveRegions();
  const strings = [];
  const sender = p.getPacketSender(), sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, ...rest) => { strings.push(String(text)); return sendString(text, ...rest); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.TaskManager.cancelTasks(p);
    core.World.getPlayers().remove(p); core.World.refreshActiveRegions();
  });
  PM.emitCustomEvent("npc-dialogue:hook", { player: p, hook: "quest:sleeping-giants:start" });
  PM.emitCustomEvent("npc-dialogue:action", { player: p, npcId: core.NpcIdentifiers.KOVAC, stepId: "Y4oYGg", kind: "dialogue" });
  core.World.process();
  return { p, strings };
}

/** The chest the player's workshop holds on the bank chest's tile. */
function chestFor(p) {
  const at = new core.Location(CHEST.x, CHEST.y, 0);
  return core.ObjectManager.objectsAt(at).find((o) => o.getPrivateArea() && o.getPrivateArea() === p.getPrivateArea() && o.getType() === 10);
}

function endIntro(p) {
  const line = { player: p, npcId: core.NpcIdentifiers.KOVAC, text: "We fix tools...", step: { type: "line", speaker: "Kovac", text: "We fix tools..." }, after: null };
  PM.emitCustomEvent("npc-dialogue:line", line);
  line.after();
}

function click(p, object, option) {
  const definition = object.getDefinition();
  const clickType = definition.getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `the chest offers ${option}`);
  const event = { player: p, object, definition, objectId: object.getId(), clickType, option: option.toLowerCase(), location: { x: CHEST.x, y: CHEST.y, z: 0 }, handled: false };
  return PM.emitObjectInteraction(event);
}

test("the workshop shows the cutscene chest during the introduction, then the quest's Big chest", (t) => {
  const { p } = startIntro(t);
  assert.ok(p.getPrivateArea(), "the intro puts the player in their workshop");
  assert.equal(chestFor(p)?.getId(), CUTSCENE_CHEST, "the cutscene's chest");
  assert.equal(chestFor(p).getFace(), 1, "facing as captured");
  endIntro(p);
  assert.equal(chestFor(p)?.getId(), BIG_CHEST, "the Big chest once Kovac sends the player off to fix the tools");
});

test("Big chest: Use opens the bank and Collect the collection box", (t) => {
  const { p } = startIntro(t);
  endIntro(p);
  const chest = chestFor(p);
  assert.equal(click(p, chest, "Use"), true, "Use handled");
  assert.equal(p.getInterfaceId(), BANK, "the bank is open");
  p.getPacketSender().sendInterfaceRemoval();
  core.Bank.isOpen(p) && p.getBank(p.getCurrentBankTab()).close?.();
  p.setStatus?.(core.PlayerStatus.NONE);
  p.setInterfaceId?.(-1);
  assert.equal(click(p, chest, "Collect"), true, "Collect handled");
  assert.equal(p.getInterfaceId(), GE_COLLECT, "the collection box is open");
});

test("Big chest: Inspect plays the big-chest lines", (t) => {
  const { p, strings } = startIntro(t);
  endIntro(p);
  p.getDialogueManager().reset();
  strings.length = 0;
  assert.equal(click(p, chestFor(p), "Inspect"), true, "Inspect handled");
  assert.ok(strings.includes("Kovac, where did you get this chest from?"), "the player asks first");
});

test("a relog mid-introduction gets the Big chest, not the optionless cutscene chest", (t) => {
  const { p } = startIntro(t);
  assert.equal(chestFor(p)?.getId(), CUTSCENE_CHEST, "the cutscene's chest while the scene plays");
  PM.emitPlayerLogout({ player: p, username: p.getUsername() });
  p.setLocation(new core.Location(3368, 11485, 0));
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.ok(p.getPrivateArea(), "back in the workshop");
  assert.equal(chestFor(p)?.getId(), BIG_CHEST, "no scene runs after the relog");
});
