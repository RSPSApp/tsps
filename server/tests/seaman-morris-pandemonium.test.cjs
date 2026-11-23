// Run after `yarn build`: node --test tests/seaman-morris-pandemonium.test.cjs
// Seaman Morris on the Pandemonium's northern dock (Wiki, Seaman Morris) through production dispatch: the real
// spawn row, real npc_option packets and his real Talk-to transcript. Naming a port in his dialogue sails there,
// as his Port Sarim and Musa Point options do; 30 coins either way, 15 to Musa Point in Karamja gloves.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const core = PluginManager.getCoreApi();

const COINS = 995;
const PORT_SARIM_LANDING = [3029, 3217, 0], MUSA_POINT_LANDING = [2956, 3146, 0];
let morris, nextIndex = 2400;
/** Seaman Morris's spoken lines, per player, as the dialogue plays them. */
const spoken = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core.RegionManager.init();
  for (const [x, y] of [[3064, 3003], PORT_SARIM_LANDING, MUSA_POINT_LANDING]) core.RegionManager.loadMapFiles(x, y);
  require("../plugins/quests/quests/PiratesTreasure.Quest")(PluginManager.createApi("SeamanMorrisTest"));
  require("../plugins/npcs/NpcDialogues.plugin.js").register(PluginManager.createApi("NpcDialoguesSeamanMorrisTest"));
  PluginManager.createApi("SeamanMorrisLines").onCustomEvent("npc-dialogue:line", ({ player, step, text }) => {
    if (typeof step?.npc === "string") spoken.set(player, [...(spoken.get(player) ?? []), text]);
  });
  const rows = require("../data/definitions/npc-spawns.json").filter((row) => row.id === core.NpcIdentifiers.SEAMAN_MORRIS);
  assert.equal(rows.length, 1, "one Seaman Morris");
  const [row] = rows;
  morris = PluginManager.spawnNpc({ id: row.id, x: row.x, y: row.y, z: row.level, wanderRadius: row.wanderRadius ?? 5 });
});

function harness(t, { coins = 100, gloves = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`morris${nextIndex}`); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(3064, 3005, 0));
  if (coins) player.getInventory().setItem(0, new core.Item(COINS, coins));
  if (gloves) player.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(core.ItemIdentifiers.KARAMJA_GLOVES_1, 1));
  const messages = [];
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { messages.push(String(text)); return sendMessage(text, ...rest); };
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const manager = player.getDialogueManager();
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
    const all = [...morris.getCurrentDefinition(player).getActions()];
    assert.ok(all.includes(name), `${name} in ${JSON.stringify(all)}`);
    await send({ type: "npc_option", index: morris.getIndex(), clickType: all.indexOf(name) + 1 });
    for (let i = 0; i < 4; i++) tick();
  }
  const group = () => player.getPacketSender().getChatboxGroupId();
  const nextLine = () => send({ type: "dialogue_continue", widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
  /** Talks to Morris and answers each menu in turn, then lets the conversation and any crossing play out. */
  async function talk(...answers) {
    await option("Talk-to");
    for (let i = 0; i < 40 && (answers.length || manager.isActive()); i++) {
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) {
        const at = pending.options.indexOf(answers[0]);
        assert.ok(at >= 0, `${answers[0]} in ${JSON.stringify(pending.options)}`);
        answers.shift();
        await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: at + 1 });
      } else if (manager.isActive()) {
        await nextLine();
      } else tick();
    }
    assert.deepEqual(answers, [], "every answer was offered");
    for (let i = 0; i < 12; i++) tick();
  }
  const where = () => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
  const coinsLeft = () => player.getInventory().getAmount(COINS);
  return { player, tick, option, talk, where, coinsLeft, messages, said: () => spoken.get(player) ?? [] };
}

test("Seaman Morris stands on the Pandemonium's northern dock with Port Sarim and Musa Point options", () => {
  const at = morris.getLocation();
  assert.ok(at.getX() >= 3063 && at.getX() <= 3065 && at.getY() >= 3002 && at.getY() <= 3004, `${at.getX()},${at.getY()}`);
  assert.deepEqual([...morris.getDefinition().getActions()].filter(Boolean), ["Talk-to", "Port Sarim", "Musa Point"]);
});

test("Talk-to: asking for Musa Point sails there for 30 coins", async (t) => {
  const h = harness(t);
  await h.talk("Yes please.", "I'd like to go to Musa Point.");
  assert.deepEqual(h.where(), MUSA_POINT_LANDING);
  assert.equal(h.coinsLeft(), 70);
  assert.ok(h.messages.includes("You board the ship and sail to Musa Point."), JSON.stringify(h.messages));
});

test("Talk-to: asking for Port Sarim sails there for 30 coins", async (t) => {
  const h = harness(t);
  await h.talk("Yes please.", "I'd like to go to Port Sarim.");
  assert.deepEqual(h.where(), PORT_SARIM_LANDING);
  assert.equal(h.coinsLeft(), 70);
  assert.ok(h.messages.includes("You board the ship and sail to Port Sarim."), JSON.stringify(h.messages));
});

test("Morris quotes the fares the player will pay: 30 coins, or 15 to Musa Point in Karamja gloves", async (t) => {
  const plain = harness(t);
  await plain.talk("No thank you.");
  assert.deepEqual(plain.said(), [
    "Hello there. Looking to travel somewhere? We can take you to Port Sarim or Musa Point. It only costs 30 coins.",
    "Fair enough.",
  ]);
  const gloved = harness(t, { gloves: true });
  await gloved.talk("No thank you.");
  assert.deepEqual(gloved.said(), [
    "Hello there. Do you want to travel somewhere? We can take you to Musa Point for 15 coins, or if you prefer, for 30 coins we can drop you off in Port Sarim.",
    "Fair enough.",
  ]);
});

test("Talk-to in Karamja gloves: 15 coins to Musa Point, still 30 to Port Sarim", async (t) => {
  const musa = harness(t, { gloves: true });
  await musa.talk("Yes please.", "I'd like to go to Musa Point.");
  assert.deepEqual(musa.where(), MUSA_POINT_LANDING);
  assert.equal(musa.coinsLeft(), 85);
  const sarim = harness(t, { gloves: true });
  await sarim.talk("Yes please.", "I'd like to go to Port Sarim.");
  assert.deepEqual(sarim.where(), PORT_SARIM_LANDING);
  assert.equal(sarim.coinsLeft(), 70);
});

test("Talk-to: declining, or not naming a port, sails nowhere and costs nothing", async (t) => {
  const declined = harness(t);
  await declined.talk("No thank you.");
  const undecided = harness(t);
  await undecided.talk("Yes please.", "Actually, I don't want to go anywhere.");
  for (const h of [declined, undecided]) {
    assert.ok(h.where()[1] < 3010, `still on the Pandemonium: ${h.where()}`);
    assert.equal(h.coinsLeft(), 100);
    assert.ok(!h.messages.some((line) => line.startsWith("You board the ship")), JSON.stringify(h.messages));
  }
});

test("Talk-to without the fare stays on the Pandemonium", async (t) => {
  const h = harness(t, { coins: 29 });
  await h.talk("Yes please.", "I'd like to go to Musa Point.");
  assert.ok(h.where()[1] < 3010, `still on the Pandemonium: ${h.where()}`);
  assert.equal(h.coinsLeft(), 29);
  assert.ok(!h.messages.some((line) => line.startsWith("You board the ship")), JSON.stringify(h.messages));
  assert.ok(h.messages.includes("You don't have enough coins to pay for passage."), JSON.stringify(h.messages));
});

test("the Port Sarim and Musa Point options sail from the spawned Morris; the gloves halve only Musa Point", async (t) => {
  const musa = harness(t, { gloves: true });
  await musa.option("Musa Point");
  const sarim = harness(t, { gloves: true });
  await sarim.option("Port Sarim");
  for (let i = 0; i < 12; i++) musa.tick();
  assert.deepEqual(musa.where(), MUSA_POINT_LANDING);
  assert.equal(musa.coinsLeft(), 85);
  assert.deepEqual(sarim.where(), PORT_SARIM_LANDING);
  assert.equal(sarim.coinsLeft(), 70);
});
