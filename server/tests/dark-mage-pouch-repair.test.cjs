// Run after `yarn build`: node --test tests/dark-mage-pouch-repair.test.cjs
// The Dark Mage in the Abyss (2583, ops Talk-to / Repairs) repairs decayed essence pouches for free.
// - Talk-to, "I need your help with something." then "Can you repair my pouches?": rsprox_transcripts/227/01840.txt
//   and 227/01850.txt show "Fine. A simple transfiguration spell should resolve things for you." with the
//   inventory updating on that line.
// - Repairs (his transcript, "standard-dialogue-when-using-the-right-click-repair-option"): "There, I have repaired
//   your pouches. Now leave me alone. I'm concentrating!", or "You don't seem to have any pouches in need of
//   repair. Leave me alone!" when none have decayed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
let core, mage, nextIndex = 2950;
const bots = process.env.DISABLE_PLAYER_BOTS;
const AT = [3039, 4836, 0];
const MEDIUM = 5510, MEDIUM_DECAYED = 5511;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  mage = PM.spawnNpc({ id: core.NpcIdentifiers.DARK_MAGE, x: AT[0], y: AT[1] - 2, z: 0, wanderRadius: 0 });
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function harness(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`darkmage${nextIndex}`); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...AT)); player.needsPlacement = false;
  const connection = new ClientConnection(channel); connection.player = player;
  const lines = [];
  const sender = player.getPacketSender(), sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, ...rest) => { lines.push(String(text)); return sendString(text, ...rest); });
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  function tick() {
    core.World.processCycle++;
    core.TaskManager.process();
    connection.processTurnPackets();
    player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    for (const npc of core.World.getNpcs()) npc.process();
    core.World.updateLocalNpcs(player, [...core.World.getNpcs()]);
    player.getSession().flushClient(core.World.processCycle);
    player.resetUpdating(); for (const npc of core.World.getNpcs()) npc.resetUpdating();
  }
  async function send(packet) { await connection.dispatch([packet]); tick(); }
  async function option(name) {
    const all = [...mage.getCurrentDefinition(player).getActions()];
    const index = all.indexOf(name);
    assert.ok(index >= 0, `${name} in ${JSON.stringify(all)}`);
    await send({ type: "npc_option", index: mage.getIndex(), clickType: index + 1 });
    for (let i = 0; i < 8; i++) tick();
  }
  const group = () => sender.getChatboxGroupId();
  const nextLine = () => send({ type: "dialogue_continue", widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
  async function choose(text) {
    for (let i = 0; i < 40; i++) {
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending && pending.options.includes(text)) {
        await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: pending.options.indexOf(text) + 1 });
        return;
      }
      if (pending) assert.fail(`"${text}" not in ${JSON.stringify(pending.options)}`);
      await nextLine();
    }
    assert.fail(`never offered "${text}"`);
  }
  async function readOn(n = 6) { for (let i = 0; i < n && player.getDialogueManager().isActive(); i++) await nextLine(); }
  const inv = player.getInventory();
  return { player, inv, lines, option, choose, nextLine, readOn };
}

test("Repairs on the Dark Mage repairs a decayed pouch and says so", async (t) => {
  const h = harness(t);
  h.inv.add(new core.Item(MEDIUM_DECAYED, 1), true);
  await h.option("Repairs");
  await h.readOn(1);
  assert.equal(h.inv.getAmount(MEDIUM_DECAYED), 0, "the decayed pouch is gone");
  assert.equal(h.inv.getAmount(MEDIUM), 1, "a whole medium pouch is back");
  assert.ok(h.lines.some((l) => /There, I have repaired your pouches/.test(l)), JSON.stringify(h.lines.slice(-6)));
});

test("Repairs with nothing decayed says so and changes nothing", async (t) => {
  const h = harness(t);
  h.inv.add(new core.Item(MEDIUM, 1), true);
  await h.option("Repairs");
  assert.equal(h.inv.getAmount(MEDIUM), 1);
  assert.ok(h.lines.some((l) => /You don't seem to have any pouches in need of/.test(l)), JSON.stringify(h.lines.slice(-6)));
});

test("Talk-to, Can you repair my pouches? repairs them on the captured line (rsprox 227/01840)", async (t) => {
  const h = harness(t);
  h.inv.add(new core.Item(MEDIUM_DECAYED, 1), true);
  await h.option("Talk-to");
  await h.choose("I need your help with something.");
  await h.choose("Can you repair my pouches?");
  await h.readOn(3);
  assert.ok(h.lines.some((l) => /A simple transfiguration spell/.test(l)), JSON.stringify(h.lines.slice(-6)));
  assert.equal(h.inv.getAmount(MEDIUM_DECAYED), 0);
  assert.equal(h.inv.getAmount(MEDIUM), 1);
});
