// Run after `yarn build`: node --test tests/brain-living-lower-door.test.cjs
// rsprox 3032 (rev 231), ticks 4905-4910 and 5074-5076: east-west crossing, sound 62,
// immediate in-reach Open, approach Open two ticks after arrival, and restore two ticks later.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test, mock } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const DOOR = { id: 22007, x: 3817, y: 2841, z: 0 };
const OPEN = 21953;
const INVISWALL = 38848;
let core;
let next = 6100;
const syncRows = new Map();
let bindPair = null;
const hookErrors = [];
const originalError = console.error;
console.error = (...args) => { hookErrors.push(args.map(String)); originalError(...args); };

before(async () => {
  const worldConfig = require("../dist/game/definition/WorldDefinition");
  const readConfig = worldConfig.readWorldConfig;
  const config = mock.method(worldConfig, "readWorldConfig", (...args) => {
    const actual = readConfig(...args);
    return { ...actual, plugins: { ...actual.plugins, WorldAdmin: false } };
  });
  try {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
    core = PluginManager.getCoreApi();
    core.ObjectDefinition.init();
    core.RegionManager.init();
    core.RegionManager.loadMapFiles(DOOR.x, DOOR.y);
    PluginManager.emitServerStartup({});
    const probe = PluginManager.createApi("LivingLowerDoorNativeProbe");
    probe.onCustomEvent("network:sync-views", (event) => {
      for (const view of event.players) {
        const rows = syncRows.get(view.index);
        if (rows) rows.push({ tick: event.tick, x: view.x, y: view.y, faceDirection: view.faceDirection });
      }
    });
    probe.onCanAttack((event) => {
      if (bindPair?.caster === event.attacker && bindPair?.opener === event.target) event.allow = true;
    });
    probe.onCombatHitRoll((event) => {
      if (bindPair?.caster === event.attacker && bindPair?.opener === event.target) event.forceAccurate = true;
    });
  } finally { config.mock.restore(); }
});

after(() => {
  try { PluginManager.emitServerShutdown({}); }
  finally { console.error = originalError; assert.deepEqual(hookErrors, [], "no runtime hook errors"); }
});

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const locAt = (id, x, y) => {
  for (const list of core.MapObjects.mapObjects.values()) {
    for (const object of list) {
      const where = object.getLocation();
      if (object.getId() === id && where.getX() === x && where.getY() === y && where.getZ() === DOOR.z) return object;
    }
  }
  return null;
};
const isOpen = () => locAt(INVISWALL, DOOR.x, DOOR.y) != null && locAt(OPEN, DOOR.x - 1, DOOR.y) != null
  && locAt(DOOR.id, DOOR.x, DOOR.y) == null;
const isShut = () => locAt(DOOR.id, DOOR.x, DOOR.y) != null && locAt(INVISWALL, DOOR.x, DOOR.y) == null
  && locAt(OPEN, DOOR.x - 1, DOOR.y) == null;

function nativeActor(t, from, running = false) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const session = new PlayerSession(channel);
  const player = new Player(session, new core.Location(...from, DOOR.z));
  const name = "livingdoor" + next++;
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const playerSync = [];
  syncRows.set(player.getIndex(), playerSync);
  const connection = new ClientConnection(channel);
  connection.player = player;
  session.setPlayer(player);
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  player.setRunning(running);
  for (let turns = 0; turns < 3; turns++) core.World.process();
  player.setRunEnergyUnits(9000);
  const sounds = [];
  const sender = player.getPacketSender();
  const sendSound = sender.sendSoundEffect.bind(sender);
  t.mock.method(sender, "sendSoundEffect", (...args) => {
    sounds.push([core.World.getProcessCycle(), ...args]);
    return sendSound(...args);
  });
  t.after(() => {
    try {
      player.closeInterruptibleInterfaces();
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    } finally {
      core.TaskManager.cancelTasks(player.getIndex());
      core.TaskManager.cancelTasks(player);
      syncRows.delete(player.getIndex());
      if (player.isRegistered()) core.World.getPlayers().remove(player);
    }
  });
  return { player, connection, sounds, syncRows: playerSync };
}

const settle = () => { for (let i = 0; i < 12; i++) core.World.process(); };

async function openAndCross(t, { from, to, running = false, approached = false }) {
  settle();
  assert.ok(isShut(), "door starts shut");
  const f = nativeActor(t, from, running);
  const inputCycle = core.World.getProcessCycle();
  await f.connection.dispatch([{ type: "object_option", id: DOOR.id, x: DOOR.x, y: DOOR.y, clickType: 1 }]);
  let arrivalCycle = approached ? undefined : inputCycle;
  let openCycle, crossCycle, closeCycle;
  for (let turns = 0; turns < 20 && closeCycle == null; turns++) {
    core.World.process();
    const cycle = core.World.getProcessCycle();
    const position = at(f.player);
    if (arrivalCycle == null && position[0] === DOOR.x - 1 && position[1] === DOOR.y) arrivalCycle = cycle;
    if (isOpen() && openCycle == null) openCycle = cycle;
    if (position[0] === to[0] && position[1] === to[1] && crossCycle == null) crossCycle = cycle;
    if (openCycle != null && isShut()) closeCycle = cycle;
  }
  assert.ok(Number.isInteger(openCycle), "Open swaps the door locs");
  assert.equal(crossCycle, openCycle, "the player crosses on the opening tick");
  assert.equal(openCycle, arrivalCycle + (approached ? 2 : 1), approached
    ? "a walked approach opens two ticks after arrival" : "an in-reach click opens on its input tick");
  assert.equal(closeCycle, openCycle + 2, "the closed loc returns two ticks after opening");
  assert.deepEqual(f.sounds.filter(([, id]) => id === 62).map(([cycle]) => cycle), [openCycle],
    "one door_open (62) on the opening tick");
  settle();
  assert.deepEqual(at(f.player), to, "the player remains on the opposite side");
  assert.ok(isShut());
  return { f, arrivalCycle, openCycle, crossCycle };
}

test("Living lower door: west-side Open crosses east through the west edge", async (t) => {
  await openAndCross(t, { from: [DOOR.x - 1, DOOR.y], to: [DOOR.x, DOOR.y] });
});

test("Living lower door: east-side in-reach Open crosses west on the input tick", async (t) => {
  const { f, openCycle } = await openAndCross(t, { from: [DOOR.x, DOOR.y], to: [DOOR.x - 1, DOOR.y] });
  assert.equal(f.syncRows.find((row) => row.tick === openCycle)?.faceDirection, undefined,
    "the crossing turn has no local face mask");
  assert.equal(f.syncRows.find((row) => row.tick === openCycle + 1)?.faceDirection, 1536,
    "the next turn faces east toward the doorway");
});

test("Living lower door: running approach opens two ticks after arrival", async (t) => {
  const { f, arrivalCycle, openCycle } = await openAndCross(t, {
    from: [DOOR.x - 1, DOOR.y + 3], to: [DOOR.x, DOOR.y], running: true, approached: true,
  });
  const firstRunStep = f.syncRows.find((row) => row.tick === arrivalCycle - 1);
  const waiting = f.syncRows.find((row) => row.faceDirection === 1536 && row.x === DOOR.x - 1 && row.y === DOOR.y);
  const crossing = f.syncRows.find((row) => row.tick === openCycle);
  assert.equal(firstRunStep?.faceDirection, undefined, "the input and first run step have no local face mask");
  assert.equal(waiting?.tick, arrivalCycle + 1, "the face update is deferred to the recorded wait turn");
  assert.equal(waiting?.faceDirection, 1536, "the approach faces east toward the doorway");
  assert.equal(crossing?.faceDirection, undefined, "the eastward crossing has no local face mask");
});

test("Equipment Stats interrupts a delayed door Open even when Escape closes it in the same turn", async (t) => {
  settle();
  assert.ok(isShut());
  const f = nativeActor(t, [DOOR.x - 1, DOOR.y + 3], true);
  f.player.getPacketSender().sendChatboxInterface(231);
  const sender = f.player.getPacketSender();
  let statsModalOpens = 0;
  const sendSubInterface = sender.sendSubInterface.bind(sender);
  t.mock.method(sender, "sendSubInterface", (...args) => {
    if (args[1] === 84) statsModalOpens++;
    return sendSubInterface(...args);
  });

  await f.connection.dispatch([{ type: "object_option", id: DOOR.id, x: DOOR.x, y: DOOR.y, clickType: 1 }]);
  let arrivalCycle;
  for (let turns = 0; turns < 12 && arrivalCycle == null; turns++) {
    core.World.process();
    if (at(f.player)[0] === DOOR.x - 1 && at(f.player)[1] === DOOR.y) arrivalCycle = core.World.getProcessCycle();
  }
  assert.ok(Number.isInteger(arrivalCycle), "the approached player reaches the doorway");
  core.World.process(); // Captured waiting/facing turn; the delayed Open is still pending.
  assert.ok(isShut());

  await f.connection.dispatch([
    { type: "widget_action", widgetId: (387 << 16) | 1, groupId: 387, childId: 1, buttonNum: 1, simple: true },
    { type: "interface_close" },
  ]);
  core.World.process();
  assert.equal(statsModalOpens, 1, "View equipment stats opened modal 84 before Escape");
  assert.equal(f.player.getInterfaceId(), -1, "Escape closed the modal in the same input batch");

  assert.deepEqual(at(f.player), [DOOR.x - 1, DOOR.y], "the interrupted interaction does not revive");
  assert.ok(isShut(), "the door remains closed after the replacement modal closes");
  assert.deepEqual(f.sounds.filter(([, id]) => id === 62), [], "the canceled Open sends no sound");
});

test("Equipment Stats cancels only the pending route: an ongoing attack keeps its target", async (t) => {
  // Live 227/1000539 t1780-1781: the attack continues after View equipment stats is clicked.
  settle();
  const f = nativeActor(t, [DOOR.x - 1, DOOR.y + 3]);
  const npc = core.NPC.create(3106, new core.Location(DOOR.x - 1, DOOR.y + 4, DOOR.z));
  assert.equal(core.World.getNpcs().add(npc), true);
  t.after(() => { npc.getCombat().reset?.(); if (npc.isRegistered()) core.World.getNpcs().remove(npc); });
  f.player.getCombat().attack(npc);
  core.World.process();
  assert.ok(f.player.getCombat().getTarget() === npc, "the attack has started");

  await f.connection.dispatch([
    { type: "widget_action", widgetId: (387 << 16) | 1, groupId: 387, childId: 1, buttonNum: 1, simple: true },
  ]);
  core.World.process();
  assert.ok(f.player.getCombat().getTarget() === npc, "View equipment stats keeps the combat target");
});

test("Zanaris Market charges only after its frozen opener's crossing is accepted", async (t) => {
  const market = { id: core.ObjectIdentifiers.MAGIC_DOOR_2, x: 2469, y: 4438, z: 0 };
  core.RegionManager.loadMapFiles(market.x, market.y);
  const f = nativeActor(t, [market.x, market.y]);
  const diamond = core.ItemIdentifiers.DIAMOND;
  f.player.getInventory().add(new core.Item(diamond, 1));
  f.player.getTimers().registers(core.TimerKey.FREEZE, 10);
  const door = core.MapObjects.getPrivateArea(f.player, market.id, new core.Location(market.x, market.y, market.z));
  const openAndPay = async () => {
    await f.connection.dispatch([{ type: "object_option", id: market.id, x: market.x, y: market.y, clickType: 1 }]);
    core.World.process();
    const pay = { player: f.player, npcId: core.NpcIdentifiers.GATEKEEPER, stepId: "8FWu8-", handled: false };
    PluginManager.emitCustomEvent("npc-dialogue:action", pay);
    return pay;
  };

  const refused = await openAndPay();
  assert.equal(refused.handled, true, "the toll dialogue consumes its final action");
  assert.equal(f.player.getInventory().getAmount(diamond), 1, "a refused crossing keeps the diamond");
  assert.equal(core.MapObjects.getPrivateArea(f.player, market.id, new core.Location(market.x, market.y, market.z)), door,
    "the closed market door remains in place while frozen");
  assert.deepEqual(at(f.player), [market.x, market.y]);

  f.player.getTimers().cancel(core.TimerKey.FREEZE);
  f.player.getDialogueManager().reset();
  f.player.getPacketSender().sendInterfaceRemoval();
  f.player.setInterfaceId(-1);
  const accepted = await openAndPay();
  assert.equal(accepted.handled, true);
  assert.equal(f.player.getInventory().getAmount(diamond), 0, "the retry charges one diamond");
  core.World.process();
  assert.deepEqual(at(f.player), [market.x + 1, market.y], "the accepted crossing enters the market");
});

test("a pass-through close timer does not repopulate a destroyed private area", async (t) => {
  const { PrivateArea } = require("../dist/game/model/areas/impl/PrivateArea");
  const { Boundary } = require("../dist/game/model/Boundary");
  const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
  const f = nativeActor(t, [DOOR.x, DOOR.y]);
  const area = new PrivateArea([new Boundary(3800, 3830, 2820, 2860, DOOR.z)]);
  area.enter(f.player);
  t.after(() => { if (!area.isDestroyed()) area.destroy(); });
  const door = new GameObject(DOOR.id, new core.Location(DOOR.x, DOOR.y, DOOR.z), 0, 0, area);
  core.ObjectManager.register(door, true);

  const open = { player: f.player, object: door, handled: false };
  PluginManager.emitCustomEvent("door:open", open);
  assert.equal(open.handled, true);
  core.World.process();
  assert.ok(area.getObjects().length > 0, "the private open state was registered in the instance");
  area.leave(f.player, true); // Last player logout tears down the private area during the two-tick hold.
  assert.equal(area.getObjects().length, 0);
  core.World.process();
  core.World.process();
  assert.equal(area.isDestroyed(), true);
  assert.equal(area.getObjects().length, 0, "the close callback does not register the loc into a destroyed area");
  assert.equal(core.World.getObjects().some((object) => object.getPrivateArea?.() === area && object.getId() === DOOR.id), false,
    "the close task does not restore the closed loc into the destroyed world index");
});

test("Living lower door: Bind landing on the delayed commit cancels Open without sound or loc swap", async (t) => {
  settle();
  assert.ok(isShut());
  const opener = nativeActor(t, [DOOR.x - 1, DOOR.y + 3], true);
  const caster = nativeActor(t, [DOOR.x - 1, DOOR.y + 1]);
  caster.player.getSkillManager().setMaxLevel(core.Skill.MAGIC, 20);
  caster.player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 20, false);
  const spell = core.CombatSpells.BIND;
  for (const rune of spell.itemsRequired(caster.player)) {
    caster.player.getInventory().add(new core.Item(rune.getId(), rune.getAmount() * 2));
  }
  bindPair = { caster: caster.player, opener: opener.player };
  t.after(() => { bindPair = null; });

  await opener.connection.dispatch([{ type: "object_option", id: DOOR.id, x: DOOR.x, y: DOOR.y, clickType: 1 }]);
  let arrivalCycle;
  for (let turns = 0; turns < 12 && arrivalCycle == null; turns++) {
    core.World.process();
    const position = at(opener.player);
    if (position[0] === DOOR.x - 1 && position[1] === DOOR.y) arrivalCycle = core.World.getProcessCycle();
  }
  assert.ok(Number.isInteger(arrivalCycle), "the running approach reaches the west tile");

  await caster.connection.dispatch([{
    type: "spell_on_player", targetIndex: opener.player.getIndex(), spellWidget: 192 << 16,
    spellChild: spell.spellId(), spellItemId: -1,
  }]);
  let freezeCycle;
  for (let turns = 0; turns < 12 && freezeCycle == null; turns++) {
    core.World.process();
    if (opener.player.getTimers().has(core.TimerKey.FREEZE)) freezeCycle = core.World.getProcessCycle();
  }
  assert.ok(Number.isInteger(freezeCycle), "the native Bind hit lands on the opener");
  assert.equal(freezeCycle, arrivalCycle + 2, "Bind lands on the delayed commit turn");
  assert.equal(at(opener.player)[0], DOOR.x - 1, "the frozen opener cannot cross the west edge");
  assert.ok(isShut(), "the door remains closed when the crossing step is refused");
  assert.deepEqual(opener.sounds.filter(([, id]) => id === 62), [], "a failed crossing produces no Open sound");
});
