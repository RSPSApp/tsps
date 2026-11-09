// Run after `yarn build`: node --test tests/barnaby-charos-native.test.cjs
//
// Captain Barnaby's free trip with a Ring of charos(a) (Wiki: "Going through his dialogue with a Ring of Charos(a)
// equipped will make the trip there and back free"), through a real Talk-to: every plugin loaded, a real Player, the
// canonical Rimmington spawn (8763) and native npc_option / dialogue_continue packets.
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

const RIMMINGTON = [2916, 3225, 0];
const ARDOUGNE_LANDING = [2680, 3274, 0];
const CHAROS_A = 6465;
const CHARM = "Or I could pay you nothing at all...";
let core, barnaby, next = 9980;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(RIMMINGTON[0], RIMMINGTON[1]);
  core.RegionManager.loadMapFiles(ARDOUGNE_LANDING[0], ARDOUGNE_LANDING[1]);
  PM.emitServerStartup({});
  barnaby = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === 8763)
    ?? PM.spawnNpc({ id: 8763, x: RIMMINGTON[0], y: RIMMINGTON[1], z: 0, wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

function harness(t, { ring = 0, coins = 0 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername("charos" + next); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  const at = barnaby.getLocation();
  player.setLocation(new core.Location(at.getX() + 1, at.getY(), 0)); player.needsPlacement = false;
  if (ring) player.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(ring, 1));
  if (coins) player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, coins), false);
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
    c.processTurnPackets();
  };
  const send = async (packet) => { await c.dispatch([packet]); tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  /** Continues lines until a menu shows; returns its options. */
  async function menu() {
    for (let i = 0; i < 30; i++) {
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      await send({ type: "dialogue_continue", widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
    return null;
  }
  async function choose(match) {
    const options = await menu();
    assert.ok(options, "a menu opened");
    const at = options.findIndex((option) => option.includes(match));
    assert.ok(at >= 0, `${match} in ${JSON.stringify(options)}`);
    await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: at + 1 });
  }
  const talk = async () => {
    const actions = [...barnaby.getCurrentDefinition(player).getActions()];
    await send({ type: "npc_option", index: barnaby.getIndex(), clickType: actions.indexOf("Talk-to") + 1 });
    for (let i = 0; i < 4; i++) tick();
  };
  const where = () => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
  return { player, tick, send, menu, choose, talk, where };
}

test("with a Ring of charos(a) and no coins: Talk-to, the charm, Ardougne, and he sails free", async (t) => {
  const f = harness(t, { ring: CHAROS_A });
  await f.talk();
  await f.choose(CHARM);
  await f.choose("Ardougne");
  for (let i = 0; i < 20 && String(f.where()) !== String(ARDOUGNE_LANDING); i++) {
    if (MultiChatboxPrompt.getPending(f.player) == null && f.player.getDialogueManager().isActive()) await f.menu();
    f.tick();
  }
  assert.deepEqual(f.where(), ARDOUGNE_LANDING, "arrives at Ardougne");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0, "nothing paid");
});

test("without the charged ring the charm isn't offered (a plain Ring of charos, or none)", async (t) => {
  for (const ring of [0, 4202]) {
    const f = harness(t, { ring, coins: 100 });
    await f.talk();
    const options = await f.menu();
    assert.ok(options && options.some((option) => option.includes("I'm good thanks.")), JSON.stringify(options));
    assert.ok(!options.some((option) => option.includes(CHARM)), `ring ${ring}: ${JSON.stringify(options)}`);
  }
});
