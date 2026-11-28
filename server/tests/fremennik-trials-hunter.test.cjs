// Run after `yarn build`: node --test tests/fremennik-trials-hunter.test.cjs
//
// The Fremennik Trials: Sigli the Huntsman's trial, as rsprox 1002236 (rev 242, ticks 3327-3461
// and 4833-5674), 1002250, 1002249 (rev 242) and 1001646 (rev 241) show it: the talisman hand-out,
// Locate tracking a roaming viking_draugen_safe "butterfly" with 8-way directions, "moved", the
// Draugen spawning next to the player within 3 tiles, its smoke-puff death that charges the
// talisman, and the return to Sigli that passes the trial on the continue of "Thanks!". Real
// Player, session and connection, the real plugins, cache and map: clicks are packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HUNTER = 6;
const MERCHANT = 2;
const FLAG_DRAUGEN = 6;
const SIGLI_ID = 3924;
const SIGLI_AT = [2660, 3653, 0];
const BY_SIGLI = [2661, 3653, 0];
const DRAUGEN = 3922;
const BUTTERFLY = 3923;
const TALISMAN = 3697;
const CHARGED = 3696;
const SMOKEPUFF = 86;
const GHOST_DEATH = 438;
const AREA = { minX: 2605, maxX: 2743, minY: 3496, maxY: 3733 };
const VARP_VIKING = 347;

let core;
let next = 9100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  // The Draugen's real stats and animations (60 HP, max 7, slash 390 / block 388), as the server loads them.
  await new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (let x = AREA.minX; x <= AREA.maxX + 64; x += 64) for (let y = AREA.minY; y <= AREA.maxY + 64; y += 64) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");
const trial = (f) => (Number(f.player.getAttribute("quest.fremennik_trials.trials")) >>> (HUNTER * 3)) & 7;
const flagged = (f) => ((Number(f.player.getAttribute("quest.fremennik_trials.flags")) >>> FLAG_DRAUGEN) & 1) === 1;
const held = (f, id) => f.player.getInventory().getAmount(id);

function actor(t, { at = BY_SIGLI, hunter = 0, flag = false, items = [], sigli = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("hunt" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, messages: [], said: [], sounds: [], graphics: [], configs: [] };
  const send = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { f.messages.push(text); f.said.push({ tick: f.tick, text }); return send(text, ...rest); };
  const sender = player.getPacketSender();
  const sound = sender.sendSound.bind(sender);
  sender.sendSound = (id, ...rest) => { f.sounds.push({ tick: f.tick, id }); return sound(id, ...rest); };
  const graphic = sender.sendGraphic.bind(sender);
  sender.sendGraphic = (g, loc) => { f.graphics.push({ tick: f.tick, id: g.id, x: loc.getX(), y: loc.getY() }); return graphic(g, loc); };
  const config = sender.sendConfig.bind(sender);
  sender.sendConfig = (id, value, ...rest) => { f.configs.push({ id, value }); return config(id, value, ...rest); };
  if (sigli) {
    f.npc = core.NPC.create(SIGLI_ID, new core.Location(...SIGLI_AT));
    core.World.getNpcs().add(f.npc);
  }
  t.after(() => {
    if (f.npc) core.World.getNpcs().remove(f.npc);
    if (player.isRegistered()) core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, 1 + (hunter === 2 ? 1 : 0));
  player.setAttribute("quest.fremennik_trials.trials", (hunter << (HUNTER * 3)) | (2 << (MERCHANT * 3)));
  if (flag) player.setAttribute("quest.fremennik_trials.flags", 1 << FLAG_DRAUGEN);
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  tick(f);
  f.messages.length = 0;
  return f;
}

/** The hunt's own NPCs (the butterflies and the Draugen) for this player. */
const owned = (f, id) => [...core.World.getNpcs()].filter((npc) => npc?.getId() === id && npc.isRegistered() && npc.getOwner?.() === f.player);

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  for (const npc of owned(f, DRAUGEN)) npc.process();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", options: menu.options };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText() };
}
const text = (f) => shown(f)?.text ?? null;

async function continueLine(f) {
  // The open chatbox's own group (231 NPC head, 217 player head, 229 statement).
  const group = f.player.getPacketSender().getChatboxGroupId?.() ?? 229;
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | 4, childIndex: -1 }]);
  tick(f);
}

async function choose(f, option) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(option);
  assert.ok(index >= 0, `"${option}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

async function talk(f) {
  await f.connection.dispatch([{ type: "npc_option", index: f.npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 12 && !shown(f); i++) tick(f);
}

/** Reads every line up to a menu or the end; `onLine(text)` sees each one as it shows. */
async function readAll(f, onLine = () => {}, max = 30) {
  const lines = [];
  for (let i = 0; i < max; i++) {
    const now = shown(f);
    if (!now || now.who === "menu") break;
    lines.push(now.text);
    onLine(now.text);
    await continueLine(f);
  }
  return lines;
}

async function locate(f, itemId = TALISMAN) {
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  assert.ok(slot >= 0, `holds ${itemId}`);
  const before = f.messages.length;
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot, itemId, option: "Locate", optionIndex: 2 }]);
  tick(f);
  // Walking into a new music area unlocks its track; only the talisman's lines are checked.
  return f.messages.slice(before).filter((line) => !line.startsWith("You have unlocked a new music track"));
}

const place = (f, x, y) => f.player.moveTo(new core.Location(x, y, 0));
const chebyshev = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
function expected(from, to) {
  const dx = Math.sign(to.getX() - from.getX());
  const dy = Math.sign(to.getY() - from.getY());
  const ns = dy > 0 ? "north" : dy < 0 ? "south" : "";
  const ew = dx > 0 ? "east" : dx < 0 ? "west" : "";
  return `The talisman guides you ${ns && ew ? `${ns}-${ew}` : ns || ew}.`;
}
const NO_MOVE = 0.99;
/** Runs `fn` with the Locate's own move roll fixed to `value` (other rolls stay random). */
async function withMoveRoll(value, fn) {
  const real = Math.random;
  Math.random = () => {
    const stack = new Error().stack;
    return stack.includes("Hunter.FremennikTrials") && stack.includes("locate") && !stack.includes("butterflyTile") ? value : real();
  };
  try { return await fn(); } finally { Math.random = real; }
}

test("Sigli's offer: Yes hands over the uncharged talisman as its line shows (1002236 t3448)", async (t) => {
  const f = actor(t, { sigli: true });
  await talk(f);
  const first = await readAll(f);
  assert.equal(first[0], "What do you want outerlander?");
  assert.equal(first.at(-1), "I suspect you are mocking me outerlander. You will need to prove your skill as a hunter to me by tracking and defeating... The Draugen.");
  assert.deepEqual(shown(f).options, ["What's a Draugen?", "Forget it."]);
  await choose(f, "What's a Draugen?");
  const middle = await readAll(f);
  assert.equal(middle.at(-1), "Well outerlander, should you accept my challenge I will show you a special hunter's trick that will help you. Do you accept the challenge?");
  await choose(f, "Yes");
  let heldAtHandOut = null;
  const rest = await readAll(f, (line) => {
    if (line.startsWith("We do this with a special talisman.")) heldAtHandOut = held(f, TALISMAN);
  });
  assert.equal(heldAtHandOut, 1, "the talisman arrives with its line");
  assert.equal(rest.at(-1), "Take care of the talisman, and see me when you have completed this task.");
  assert.equal(held(f, TALISMAN), 1);
  assert.equal(trial(f), 1);
  assert.deepEqual(f.messages, [], "no game message (1002236 t3327-t3461)");
});

test("the first Locate spawns a butterfly 35-80 tiles off in the hunt area and points at it", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN] });
  const said = await locate(f);
  const flies = owned(f, BUTTERFLY);
  assert.equal(flies.length, 1);
  const fly = flies[0];
  const at = fly.getLocation();
  assert.ok(at.getX() >= AREA.minX && at.getX() <= AREA.maxX && at.getY() >= AREA.minY && at.getY() <= AREA.maxY, `${at}`);
  const distance = chebyshev(f.player.getLocation(), at);
  assert.ok(distance >= 35 && distance <= 80, `distance ${distance}`);
  assert.equal(core.RegionManager.blocked(at, null), false, "on a walkable tile");
  assert.equal(fly.isOwnerOnly?.() ?? false, false, "everyone sees it (1002160)");
  assert.deepEqual(said, [expected(f.player.getLocation(), at)], "no 'moved' on a fresh hunt (1002236 t4833)");
  assert.equal(owned(f, DRAUGEN).length, 0);
});

test("the direction follows the butterfly's live tile, in 8 directions", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN] });
  await locate(f);
  const fly = owned(f, BUTTERFLY)[0];
  const at = fly.getLocation();
  const cases = [[0, 10, "south"], [0, -10, "north"], [10, 0, "west"], [-10, 0, "east"],
    [10, 10, "south-west"], [-10, 10, "south-east"], [10, -10, "north-west"], [-10, -10, "north-east"]];
  for (const [dx, dy, dir] of cases) {
    place(f, at.getX() + dx, at.getY() + dy);
    const said = await withMoveRoll(NO_MOVE, () => locate(f));
    const now = fly.getLocation();
    assert.deepEqual(said, [expected(f.player.getLocation(), now)]);
    if (now.equals(at)) assert.deepEqual(said, [`The talisman guides you ${dir}.`]);
  }
  assert.equal(owned(f, BUTTERFLY).length, 1);
});

test("'moved' sends a new butterfly and points at it; the old one keeps wandering", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN] });
  await locate(f);
  const first = owned(f, BUTTERFLY)[0];
  const said = await withMoveRoll(0, () => locate(f));
  const flies = owned(f, BUTTERFLY);
  assert.equal(flies.length, 2, "the old butterfly stays (1002236 t4921: 46501 still seen at t5374)");
  assert.ok(flies.includes(first));
  const fresh = flies.find((npc) => npc !== first);
  assert.deepEqual(said, ["The Draugen has moved elsewhere...", expected(f.player.getLocation(), fresh.getLocation())]);
  // Ours: they cannot pile up.
  for (let i = 0; i < 10; i++) await withMoveRoll(0, () => locate(f));
  assert.ok(owned(f, BUTTERFLY).length <= 4, `${owned(f, BUTTERFLY).length} butterflies`);
});

test("within 3 tiles: 'here', the Draugen beside the player facing them, attacking 2 ticks later", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN] });
  await locate(f);
  const fly = owned(f, BUTTERFLY)[0];
  // Out of range at 4 (1002236 t4892 (2,-4) still gave a direction).
  let at = fly.getLocation();
  place(f, at.getX() + 4, at.getY() - 2);
  const far = await withMoveRoll(NO_MOVE, () => locate(f));
  if (chebyshev(f.player.getLocation(), fly.getLocation()) > 3) assert.notDeepEqual(far, ["The Draugen is here! Beware!"]);
  // Stand on a free tile 2-3 off the butterfly's current tile (1002236 t5535: (-2,0)).
  at = fly.getLocation();
  const spot = [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 1], [1, 3], [-3, -1], [-1, -3]]
    .map(([dx, dy]) => [at.getX() + dx, at.getY() + dy])
    .find(([x, y]) => !core.RegionManager.blocked(new core.Location(x, y, 0), null));
  assert.ok(spot);
  place(f, ...spot);
  fly.getMovementQueue().reset();
  const swings = [];
  const realSpawn = PM.spawnNpc;
  PM.spawnNpc = function (...args) {
    const npc = realSpawn.apply(this, args);
    if (npc?.getId() === DRAUGEN) {
      const animate = npc.performAnimation.bind(npc);
      npc.performAnimation = (animation, ...rest) => { swings.push({ tick: f.tick, id: animation.getId() }); return animate(animation, ...rest); };
    }
    return npc;
  };
  let said;
  try { said = await locate(f); } finally { PM.spawnNpc = realSpawn; }
  assert.deepEqual(said, ["The Draugen is here! Beware!"]);
  const hereTick = f.said.findLast((line) => line.text === "The Draugen is here! Beware!").tick;
  const draugens = owned(f, DRAUGEN);
  assert.equal(draugens.length, 1);
  const draugen = draugens[0];
  const p = f.player.getLocation();
  const d = draugen.getLocation();
  assert.equal(Math.abs(d.getX() - p.getX()) + Math.abs(d.getY() - p.getY()), 1, "orthogonally adjacent");
  assert.ok(draugen.getPositionToFace()?.equals(p), "faces the player");
  ticks(f, 3);
  // 1002236 t5535 "here" -> t5537 the first swing, before the player's own attack.
  assert.equal(swings[0]?.tick, hereTick + 2, JSON.stringify({ hereTick, swings }));
  assert.equal(draugen.getCombat().getTarget(), f.player, "aggressive: it attacks first");
  // One per hunt: another Locate does not spawn a second.
  assert.deepEqual(await locate(f), ["The Draugen is here! Beware!"]);
  assert.equal(owned(f, DRAUGEN).length, 1);
  // Another player cannot fight someone else's Draugen (Ours).
  const other = actor(t, { at: [p.getX(), p.getY() + 1, 0], hunter: 1 });
  assert.equal(core.CombatFactory.validTarget(other.player, draugen), false);
  assert.deepEqual(other.messages, ["This npc was not spawned for you."]);
  assert.equal(core.CombatFactory.validTarget(f.player, draugen), true);
});

test("the kill: gone next tick with a smoke puff and ghost_death, the talisman charged (1002236 t5572-5573)", async (t) => {
  const f = actor(t, { hunter: 1, items: [core.ItemIdentifiers.COINS, TALISMAN] });
  await locate(f);
  const fly = owned(f, BUTTERFLY)[0];
  const at = fly.getLocation();
  place(f, at.getX(), at.getY());
  await locate(f);
  const draugen = owned(f, DRAUGEN)[0];
  assert.ok(draugen);
  const tile = draugen.getLocation().clone();
  f.messages.length = 0;
  draugen.setHitpoints(0);
  assert.equal(draugen.isRegistered(), true, "still there in the tick of the killing hit");
  tick(f);
  assert.equal(draugen.isRegistered(), false);
  assert.ok(f.graphics.some((g) => g.id === SMOKEPUFF && g.x === tile.getX() && g.y === tile.getY()), JSON.stringify(f.graphics));
  assert.ok(f.sounds.some((s) => s.id === GHOST_DEATH));
  assert.deepEqual(f.messages, ["You absorb the Draugen's essence into your talisman."]);
  assert.equal(held(f, TALISMAN), 0);
  assert.equal(held(f, CHARGED), 1);
  assert.equal(f.player.getInventory().getItems()[1]?.getId() ?? -1, CHARGED, "into the first free slot");
  assert.equal(flagged(f), true);
  assert.equal(owned(f, DRAUGEN).length, 0);
  // 1001646 t363.
  assert.deepEqual(await locate(f, CHARGED), ["You have already captured the Draugen."]);
});

test("back to Sigli: the trial passes on the continue of 'Thanks!', with no message (1002236 t5664-5674)", async (t) => {
  const f = actor(t, { hunter: 1, flag: true, items: [CHARGED], sigli: true });
  await talk(f);
  assert.equal(text(f), "I saw the entire hunt. Let me take that talisman from you; I would be honoured to speak out for you to our council of elders after such a hunt, outerlander.");
  await continueLine(f);
  assert.equal(text(f), "Thanks!");
  assert.equal(trial(f), 1, "not on the click");
  assert.equal(held(f, CHARGED), 1);
  f.configs.length = 0;
  await continueLine(f);
  assert.equal(trial(f), 2);
  assert.equal(held(f, CHARGED), 0);
  assert.equal(shown(f), null, "the chat closes");
  assert.deepEqual(f.messages, []);
  // viking = 1 + trials passed: the fixture's Merchant vote and now this one.
  assert.ok(f.configs.some((c) => c.id === VARP_VIKING && c.value === 3), JSON.stringify(f.configs));
  // Afterwards: the player's question, then Sigli's line (rsprox 1002313 t1987).
  await talk(f);
  assert.equal(text(f), "So can I rely on your vote with the council of elders in my favour?");
  await continueLine(f);
  assert.equal(text(f), "Absolutely outerlander! Anyone brave enough to hunt and defeat the Draugen will be a great addition to our clan!");
});

test("Sigli mid-hunt: 'Not yet...' with the talisman, a new one when it was lost", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN], sigli: true });
  await talk(f);
  assert.deepEqual(await readAll(f), ["Hello again outerlander. Have you managed to hunt down the terrible Draugen yet?", "Not yet...",
    "Hmmm. Laziness is not a trait that I admire. I suggest you go and do so if you wish me to vouchsafe for you to our council of elders."]);
  assert.equal(trial(f), 1);

  const lost = actor(t, { hunter: 1, sigli: true });
  await talk(lost);
  const lines = await readAll(lost);
  assert.equal(lines[1], "Not yet... I lost the talisman you gave me.");
  assert.equal(held(lost, TALISMAN), 1);

  // Wiki: losing the charged talisman after the kill restarts the hunt.
  const dropped = actor(t, { hunter: 1, flag: true, sigli: true });
  await talk(dropped);
  await readAll(dropped);
  assert.equal(held(dropped, TALISMAN), 1);
  assert.equal(flagged(dropped), false);
});

test("logout clears the butterflies and the Draugen; the hunt restarts cleanly", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN] });
  await locate(f);
  const fly = owned(f, BUTTERFLY)[0];
  place(f, fly.getLocation().getX(), fly.getLocation().getY());
  await locate(f);
  const draugen = owned(f, DRAUGEN)[0];
  assert.ok(draugen);
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.equal(fly.isRegistered(), false);
  assert.equal(draugen.isRegistered(), false);
  place(f, ...BY_SIGLI.slice(0, 2));
  const said = await locate(f);
  assert.equal(owned(f, BUTTERFLY).length, 1);
  assert.equal(said.length, 1, "a fresh hunt: no 'moved'");
  assert.match(said[0], /^The talisman guides you (north|south|east|west|north-east|north-west|south-east|south-west)\.$/);
});

test("a Draugen left behind goes, so the hunt goes on (Ours)", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN] });
  await locate(f);
  const fly = owned(f, BUTTERFLY)[0];
  place(f, fly.getLocation().getX(), fly.getLocation().getY());
  await locate(f);
  const draugen = owned(f, DRAUGEN)[0];
  place(f, ...BY_SIGLI.slice(0, 2));
  const said = await withMoveRoll(NO_MOVE, () => locate(f));
  assert.equal(draugen.isRegistered(), false);
  assert.deepEqual(said, [expected(f.player.getLocation(), fly.getLocation())]);
});

test("an expired butterfly: the next Locate says it moved and finds a new one", async (t) => {
  const f = actor(t, { hunter: 1, items: [TALISMAN] });
  await locate(f);
  const fly = owned(f, BUTTERFLY)[0];
  ticks(f, 1001);
  assert.equal(fly.isRegistered(), false, "Wiki: ten minutes");
  const said = await locate(f);
  assert.equal(said[0], "The Draugen has moved elsewhere...");
  assert.equal(owned(f, BUTTERFLY).length, 1);
});

test("a banked talisman is kept: Sigli's 'Laziness' line and no second one (rsprox 1002313 t1550, t1587)", async (t) => {
  const f = actor(t, { hunter: 1, sigli: true });
  f.player.getBank(0).add(new core.Item(TALISMAN, 1), false);
  await talk(f);
  const lines = await readAll(f);
  assert.equal(lines[1], "Not yet...");
  assert.ok(lines[2].startsWith("Hmmm. Laziness is not a trait that I admire."));
  assert.equal(held(f, TALISMAN), 0, "no new talisman while one is in the bank");
});
