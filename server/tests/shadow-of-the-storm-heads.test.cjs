// Run after `yarn build`: node --test tests/shadow-of-the-storm-heads.test.cjs
//
// #2577, Jennifer's chatbox in the first ritual's closing scene. Rsprox 3333 (rev 235), lines 21827
// and 21981: her boxes carry npc head 905. By name alone a transcript line finds 305, the Shayzien
// general store's Jennifer, a different person with another head.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const RITUAL_TILE = [2720, 4903, 2];
const STAGE_BOOK_SHOWN = 70;
const CONTINUE_CHILD = { 231: 5, 217: 5, 193: 0, 229: 2 };
const WORDS = ["Nahudu", "Caldar", "Tarren", "Agrith-Naar", "Camerinthum"];

let core;
let I;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(RITUAL_TILE[0], RITUAL_TILE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.name === "Shadow of the Storm");

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9100);
  p.setUsername("headsqa");
  p.setRegistered(true);
  p.setLocation(new core.Location(RITUAL_TILE[0], RITUAL_TILE[1], RITUAL_TILE[2]));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  quest().setStage(p, STAGE_BOOK_SHOWN);
  p.getInventory().add(new core.Item(I.DEMONIC_SIGIL), false);
  p.getInventory().add(new core.Item(I.SILVERLIGHT_2), false);
  PM.emitPlayerLogin({ player: p, username: p.getUsername(), isNewAccount: false });
  const f = { p, c, inv: p.getInventory() };
  ticks(f, 2);
  return f;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const owned = (f) => [...core.World.getNpcs()].filter((npc) => npc.getOwner?.() === f.p);

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
    // The end of a world tick: overhead lines need the speakers in the player's local npc list, and a
    // moved npc leaves it until the tick after. The player isn't in World's list, so this is called here.
    core.World.updateLocalNpcs(f.p, owned(f));
    for (const npc of owned(f)) npc.setNeedsPlacement(false);
  }
}

/** Answers the word menus, and returns each npc box after them as [text, head]. */
async function playRitual(f) {
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === I.DEMONIC_SIGIL);
  PM.emitItemAction({
    player: f.p, item: f.inv.getItems()[slot], itemId: I.DEMONIC_SIGIL, slot,
    interfaceId: core.CacheDefinitions.getComponentId("inventory:items"), option: "Chant", clickType: 2, handled: false,
  });
  ticks(f, 1);
  const queue = [...WORDS];
  const boxes = [];
  for (let i = 0; i < 200; i++) {
    const menu = core.MultiChatboxPrompt.getPending(f.p);
    if (menu) {
      const word = queue.shift();
      if (word === undefined) break;
      const choice = menu.options.indexOf(word);
      assert.ok(choice >= 0, `${word} is on the menu: ${JSON.stringify(menu.options)}`);
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice + 1 });
      ticks(f, 1);
      continue;
    }
    const manager = f.p.getDialogueManager();
    if (manager.isActive()) {
      const current = manager.getCurrent();
      if (typeof current?.getNpcId === "function") {
        boxes.push([String(current.getText()).replace(/<br>/g, " "), current.getNpcId()]);
      }
      // An overhead line is timed: a client has no continue to send, and one would skip the chain.
      const group = f.p.getPacketSender().getChatboxGroupId();
      if (!(current instanceof ActionDialogue) && group in CONTINUE_CHILD) {
        await send(f, { type: "dialogue_continue", widgetId: (group << 16) | CONTINUE_CHILD[group], childIndex: -1 });
      }
    } else if (queue.length === 0) {
      ticks(f, 2);
      if (!f.p.getDialogueManager().isActive() && !core.MultiChatboxPrompt.getPending(f.p)) break;
    }
    ticks(f, 1);
  }
  return boxes;
}

test("Jennifer's boxes in the closing scene carry her own head, and the others' are unchanged", async (t) => {
  const boxes = await playRitual(actor(t));
  t.diagnostic(JSON.stringify(boxes));
  const head = (text) => {
    const box = boxes.find(([line]) => line === text);
    assert.ok(box, `the scene plays "${text}"`);
    return box[1];
  };
  assert.equal(head("Oh my gods!"), 905, "3333 line 21827");
  assert.equal(head("What was that?!"), 905, "3333 line 21981");
  assert.equal(head("He disappeared!"), 899, "control: Eric, 3333 line 21845");
  assert.equal(head("Where'd he go?"), 909, "control: Patrick, 3333 line 21864");
  assert.equal(boxes.some(([, id]) => id === 305), false, "never the store's Jennifer");
});
