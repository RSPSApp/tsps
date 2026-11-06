// Run after `yarn build`: node --test tests/hueycoatl.test.cjs
// The Hueycoatl: the ids against the cache's gamevals, the captured slams and symbols, the
// pillars' rules, the tail's cap, contribution and loot, and the fight's timings, each against
// the captures and Wiki facts in docs/hueycoatl.md.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Shared = require("../plugins/bosses/hueycoatl/Shared.Hueycoatl");
const Attacks = require("../plugins/bosses/hueycoatl/Attacks.Hueycoatl");
const Pillars = require("../plugins/bosses/hueycoatl/Pillars.Hueycoatl");
const Kills = require("../plugins/bosses/hueycoatl/Kills.Hueycoatl");
const Fight = require("../plugins/bosses/hueycoatl/Fight.Hueycoatl");
const Area = require("../plugins/bosses/hueycoatl/Area.Hueycoatl");
const CombatAchievements = require("../plugins/bosses/hueycoatl/CombatAchievements.Hueycoatl");

const core = PluginManager.getCoreApi();
let gamevals = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  gamevals = new Gamevals();
  const api = new Proxy({ core }, { get: (target, key) => target[key] ?? (() => {}) });
  Shared.init(api);
  Attacks.attach(api);
  Pillars.attach(api);
  Kills.attach(api);
  CombatAchievements.attach(api);
});

const named = (kind, id) => gamevals.namesOf(kind).get(id);

test("npc and loc ids are the cache's huey gamevals", () => {
  assert.equal(named(GamevalKind.NPC, Shared.NPC.HEAD), "huey_head");
  assert.equal(named(GamevalKind.NPC, Shared.NPC.HEAD_SHIELDED), "huey_head_invulnerable");
  assert.equal(named(GamevalKind.NPC, Shared.NPC.HEAD_DEFEATED), "huey_head_defeated");
  assert.equal(named(GamevalKind.NPC, Shared.NPC.TAIL), "huey_tail");
  assert.equal(named(GamevalKind.NPC, Shared.NPC.TAIL_BROKEN), "huey_tail_broken");
  assert.equal(named(GamevalKind.NPC, Shared.NPC.BODY), "huey_body_part");
  assert.equal(named(GamevalKind.NPC, Shared.NPC.RUBBLE), "huey_body_part_broken");
  assert.equal(named(GamevalKind.NPC, Shared.NPC.ARENA_SEER), "huey_seer");
  assert.equal(named(GamevalKind.LOC, Shared.LOC.CHAIN), "huey_fight_entrance");
  assert.equal(named(GamevalKind.LOC, Shared.LOC.SLOPE), "huey_fight_exit_shortcut");
  assert.equal(named(GamevalKind.LOC, Shared.LOC.BARRIER), "huey_p2_barrier");
  assert.equal(named(GamevalKind.LOC, Shared.LOC.BARRIER_RETRACTED), "huey_p2_barrier_retracted");
  assert.equal(named(GamevalKind.LOC, Shared.LOC.SYMBOL), "huey_attack_tiles_loc");
  assert.equal(named(GamevalKind.LOC, Shared.LOC.CAVE_BODY), "df_cave_snow01_entrance03_huey");
  for (const pillar of Shared.PILLARS) {
    const kind = pillar.kind === "missiles" ? "ranged" : pillar.kind;
    assert.equal(named(GamevalKind.LOC, pillar.stages[0]), `huey_prayer_pillar_${kind}_empty`);
    assert.equal(named(GamevalKind.LOC, pillar.stages[5]), `huey_prayer_pillar_${kind}_s5`);
    assert.equal(named(GamevalKind.LOC, pillar.on), `huey_prayer_pillar_${kind}_brazier_on`);
  }
});

test("animations and graphics are the cache's", () => {
  assert.equal(named(GamevalKind.SEQ, Shared.SEQ.SHIELD_ACTIVATION), "huey_shield_activation");
  assert.equal(named(GamevalKind.SEQ, Shared.SEQ.TAIL_BREAK), "npc_huey_tail_break_01");
  assert.equal(named(GamevalKind.SEQ, Shared.SEQ.BARRIER_TRANSITION), "huey_p2_barrier_transition");
  for (const style of ["melee", "magic"]) {
    assert.equal(named(GamevalKind.SEQ, Shared.SEQ.HEAD_ATTACK[style]), `huey_attack_${style}`);
    assert.equal(named(GamevalKind.SPOTANIM, Shared.GFX.FEATHER[style]), `vfx_huey_attack_${style}_projanim_01`);
  }
  assert.equal(named(GamevalKind.SEQ, Shared.SEQ.HEAD_ATTACK.missiles), "huey_attack_range");
  assert.equal(named(GamevalKind.SPOTANIM, Shared.GFX.FEATHER.missiles), "vfx_huey_attack_ranged_projanim_01");
  assert.equal(named(GamevalKind.SPOTANIM, Shared.GFX.SYMBOL), "vfx_hueycoatl_prayer_02");
  for (const [wave, impact] of Object.entries(Shared.GFX.SHOCKWAVE_IMPACT)) {
    const direction = named(GamevalKind.SPOTANIM, Number(wave)).replace("vfx_huey_tail_slam_shockwave_", "");
    assert.equal(named(GamevalKind.SPOTANIM, impact), `vfx_huey_tail_slam_shockwave_impact_${direction}`);
  }
});

test("the varbits are huey_in_area, huey_encountered and huey_intro", () => {
  assert.equal(named(GamevalKind.VARBIT, Shared.VARBIT.IN_AREA), "huey_in_area");
  assert.equal(named(GamevalKind.VARBIT, Shared.VARBIT.ENCOUNTERED), "huey_encountered");
  assert.equal(named(GamevalKind.VARBIT, Shared.VARBIT.INTRO), "huey_intro");
});

test("the chain is a multiloc on huey_in_area: Peek only from the camp", () => {
  const chain = CacheDefinitions.getObject(Shared.LOC.CHAIN);
  assert.equal(chain.transformVarbit, Shared.VARBIT.IN_AREA);
  const outside = CacheDefinitions.getObject(chain.transforms[0]).actions.filter(Boolean);
  const inside = CacheDefinitions.getObject(chain.transforms[1]).actions.filter(Boolean);
  assert.deepEqual(outside, ["Climb", "Quick-climb", "Peek"]);
  assert.deepEqual(inside, ["Climb", "Quick-climb"]);
});

test("the slams are the captured waves: 195 tiles west, 190 east, 15 cycles a tile", () => {
  assert.equal(Shared.SHOCKWAVES.west.length, 195);
  assert.equal(Shared.SHOCKWAVES.east.length, 190);
  for (const tiles of Object.values(Shared.SHOCKWAVES)) {
    for (const [, , delay, gfx] of tiles) {
      assert.equal(delay % 15, 0);
      assert.ok(delay >= 30 && delay <= 270);
      assert.ok(Shared.GFX.SHOCKWAVE_IMPACT[gfx], `no impact for ${gfx}`);
    }
  }
});

test("a symbol cast lights each occupied part's fixed tiles and fills up to the captured count", () => {
  const players = [{ part: Shared.SUMMIT_BOUNDS }];
  const session = { inBounds: (player, bounds) => player.part === bounds };
  const tiles = Attacks._test.symbolTiles(session, players);
  assert.equal(tiles.length, 22);
  for (const [x, y] of Shared.SYMBOLS.summit.fixed) assert.ok(tiles.some((tile) => tile[0] === x && tile[1] === y));
  assert.equal(Shared.SYMBOLS.summit.fixed.length, 12);
  assert.equal(Shared.SYMBOLS.mountainside.fixed.length, 6);
  assert.deepEqual(Attacks._test.symbolTiles(session, []), []);
});

test("pillars need more prayers as the team grows (Wiki)", () => {
  assert.deepEqual([1, 5, 6, 8, 9, 12, 15, 18, 20].map(Shared.prayersPerPillar), [1, 1, 2, 2, 3, 4, 5, 6, 6]);
  const { nextStage } = Pillars._test;
  assert.equal(nextStage(0, true), 1);
  assert.equal(nextStage(5, true), 5);
  assert.equal(nextStage(3, false), 2);
  assert.equal(nextStage(0, false), 0);
});

test("lit braziers boost hits by 30%", () => {
  assert.equal(Pillars.damageBoost({ pillars: { lit: true } }), 1.3);
  assert.equal(Pillars.damageBoost({ pillars: { lit: false } }), 1);
});

test("the tail's cap is 9 only when crush is the attacker's highest attack bonus", () => {
  const player = (bonuses) => ({ getBonusManager: () => ({ getAttackBonus: () => bonuses }) });
  assert.equal(Kills._test.crushHighest(player([10, 20, 85, 0, 0])), true);
  assert.equal(Kills._test.crushHighest(player([10, 90, 85, 0, 0])), false);
  assert.equal(Kills._test.crushHighest(player([0, 0, 5, 0, 90])), false);
});

test("drop qualification follows the team size (Wiki)", () => {
  const { qualifies } = Kills._test;
  assert.equal(qualifies({ body: 25, head: 50, tail: 25 }, 5), true);
  assert.equal(qualifies({ body: 24, head: 500, tail: 0 }, 5), false);
  assert.equal(qualifies({ body: 30, head: 40, tail: 0 }, 3), false);
  assert.equal(qualifies({ body: 0, head: 75, tail: 0 }, 6), true);
  assert.equal(qualifies({ body: 25, head: 0, tail: 0 }, 6), true);
  assert.equal(qualifies({ body: 10, head: 40, tail: 0 }, 8), false);
});

test("loot quantities scale to the share and never below one", () => {
  const { scaled } = Kills._test;
  assert.deepEqual(scaled([{ itemId: 557, amount: 3000 }], 0.5), [{ itemId: 557, amount: 1500 }]);
  assert.deepEqual(scaled([{ itemId: 557, amount: 150 }], 0.001), [{ itemId: 557, amount: 1 }]);
});

test("the head attacks every 20 ticks on the body, 18/18/24 on the head, 15 shielded, 11s with a 16 last", () => {
  const { ATTACK_INTERVALS, SYMBOL_INTERVALS } = Fight._test;
  assert.deepEqual(ATTACK_INTERVALS.body, [20]);
  assert.equal(ATTACK_INTERVALS.head.reduce((a, b) => a + b, 0) / ATTACK_INTERVALS.head.length, 20);
  assert.deepEqual(ATTACK_INTERVALS.tail, [15]);
  assert.deepEqual(ATTACK_INTERVALS.final, [11, 11, 11, 11, 16]);
  assert.deepEqual(SYMBOL_INTERVALS, { body: 26, head: 26, tail: 36, final: 24 });
});

test("the peek's respawn line is the captured one", () => {
  assert.equal(Area._test.PEEK_LINES.defeated, "The Hueycoatl has been subdued!");
});

test("only earth spells count for You're a wizard", () => {
  const { isEarthSpell } = CombatAchievements._test;
  assert.equal(isEarthSpell(core.CombatSpells.EARTH_SURGE), true);
  assert.equal(isEarthSpell(core.CombatSpells.FIRE_SURGE), false);
  assert.equal(isEarthSpell(null), false);
});

test("the arena, the summit and the mountainside hold the captured spawn tiles", () => {
  const inArena = ([x, y]) => Shared.ARENA_BOUNDS.some((bounds) => Shared.within(bounds, x, y));
  for (const tile of [Shared.ARENA_ENTRY, Shared.HEAD_TILE, Shared.KNOCKBACK_TILE, Shared.SLOPE_TOP, ...Shared.SEGMENTS.map((s) => s.tile)]) {
    assert.ok(inArena(tile), `${tile} outside the arena`);
  }
  assert.ok(!inArena(Shared.CAMP_LANDING));
  assert.ok(!inArena(Shared.PRIVATE_LANDING));
  for (const segment of Shared.SEGMENTS) assert.ok(Shared.within(Shared.MOUNTAINSIDE_BOUNDS, ...segment.tile));
});

test("public and private fights leave aggression to the scripted attacks", (t) => {
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
  const { NpcAggression } = require("../dist/game/entity/impl/npc/NpcAggression");
  const { Player } = require("../dist/game/entity/impl/player/Player");
  let arena;
  Area.attach(new Proxy({ core, registerArea: (area) => { arena = area; } }, {
    get: (target, key) => target[key] ?? (() => {}),
  }));
  const player = new Player(null);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.setLocation(new core.Location(Shared.HEAD_TILE[0] - 1, Shared.HEAD_TILE[1], 0));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  // Use the real instance policy without allocating a map instance.
  for (const area of [arena, Object.create(Area._test.InstanceArea.prototype)]) {
    t.mock.method(player, "getArea", () => area);
    for (const id of [Shared.NPC.HEAD, Shared.NPC.HEAD_SHIELDED, Shared.NPC.HEAD_DEFEATED, Shared.NPC.TAIL, Shared.NPC.BODY]) {
      const npc = core.NPC.create(id, new core.Location(...Shared.HEAD_TILE, 0));
      npc.setRegistered(true);
      npc.setNeedsPlacement(false);
      npc.setFlag("combat:no-retaliate");
      npc.setMultiCombat(true);
      npc.getMovementQueue().setBlockMovement(true);
      t.mock.method(npc, "getArea", () => area);
      assert.equal(npc.getCurrentDefinition().isAggressive(), true, `source aggression: ${id}`);
      NpcAggression.runAggression(player, [npc]);
      assert.equal(npc.getCombat().getTarget(), null, `${area.getName()}: ${id}`);
    }
  }
});

// Native fee transaction through the registered meeting flag, menu and CA producer.
test("private Hueycoatl fees follow the current Hard Combat Achievement threshold", async (t) => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
  const Progress = require("../plugins/achievements/combatachievements/Progress.CombatAchievements");
  const priorBots = process.env.DISABLE_PLAYER_BOTS;
  const oldSessions = new Set(Shared.sessions), tasks = new Set(), actors = [];
  const originalSubmit = core.TaskManager.submit, originalDeregister = core.ObjectManager.deregister;
  const oldError = console.error, errors = [], publicScene = new Map();
  let started = false, oldThreshold = null, hard = null;
  process.env.DISABLE_PLAYER_BOTS = "1";
  t.after(() => {
    try {
      if (hard && oldThreshold !== null) hard.threshold = oldThreshold;
      for (const task of tasks) task.stop();
      const owned = [...Shared.sessions].filter((session) => !oldSessions.has(session));
      const ownedNpcs = new Set(owned.flatMap((session) => [...session.npcs, ...session.lobby, ...(session.area?.getNpcs() ?? [])]));
      const privateAreas = owned.flatMap((session) => session.area ? [session.area] : []);
      for (const actor of actors) {
        const area = actor.player.getPrivateArea();
        if (area && owned.some((session) => session.area === area) && area.hasMember(actor.player)) area.leave(actor.player, false);
      }
      for (const session of owned) {
        if (session.area) session.area.destroy();
        else { session.dispose(); Shared.sessions.delete(session); }
      }
      for (const object of publicScene.values()) core.ObjectManager.register(object, true);
      for (const actor of actors) {
        PluginManager.emitPlayerLogout({ player: actor.player, username: actor.player.getUsername() });
        if (actor.player.isRegistered()) core.World.getPlayers().removes(actor.player);
      }
      if (started) PluginManager.emitServerShutdown({});
      for (const task of tasks) task.stop();
      core.World.process(); // drains the fixture sessions' queued NPC removals
      assert.equal([...Shared.sessions].some((session) => !oldSessions.has(session)), false, "fixture sessions removed");
      assert.ok([...tasks].every((task) => !task.isRunning()), "fixture tasks stopped");
      assert.ok(privateAreas.every((area) => area.isDestroyed()), "fixture private areas destroyed");
      assert.ok([...ownedNpcs].every((npc) => !npc.isRegistered() && !core.World.getAddNPCQueue().includes(npc)), "fixture NPCs removed or dequeued");
      for (const object of publicScene.values()) {
        const current = core.MapObjects.get(object.getId(), object.getLocation(), null);
        assert.ok(current && current.getType() === object.getType(), "displaced public scene object restored");
      }
      assert.deepEqual(errors, [], "native execution and cleanup report no errors");
    } finally {
      core.TaskManager.submit = originalSubmit;
      core.ObjectManager.deregister = originalDeregister;
      console.error = oldError;
      if (priorBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
      else process.env.DISABLE_PLAYER_BOTS = priorBots;
    }
  });
  core.TaskManager.submit = function (...args) {
    if (args[0]) tasks.add(args[0]);
    return originalSubmit.apply(this, args);
  };
  core.ObjectManager.deregister = function (object, ...args) {
    const caller = new Error().stack.split("\n")[2] ?? "";
    if (object && !object.getPrivateArea() && caller.includes("setLoc") && caller.includes("Session.Hueycoatl")) {
      const at = object.getLocation(), key = `${at.getX()},${at.getY()},${at.getZ()},${object.getType()}`;
      if (!publicScene.has(key)) publicScene.set(key, object);
    }
    return originalDeregister.call(this, object, ...args);
  };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); return oldError.apply(console, args); };
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(1525, 3295);
  PluginManager.emitServerStartup({});
  started = true;

  const { World, Location, Item, ItemIdentifiers: I } = core;
  const flagAt = new Location(1525, 3295, 0), chainAt = new Location(1527, 3285, 0);
  const flag = core.MapObjects.get(Shared.LOC.FLAG, flagAt, null);
  const chain = core.MapObjects.get(Shared.LOC.CHAIN, chainAt, null);
  assert.ok(flag, "control: the real cache map contains the meeting flag");
  assert.ok(chain, "control: the real cache map contains the entrance chain");
  assert.ok(CacheDefinitions.getObject(Shared.LOC.FLAG).actions.includes("Fight-privately"));
  const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  function actor(name, coins) {
    const wire = channel(), player = new Player(new PlayerSession(wire));
    const result = { player, client: null }; actors.push(result);
    player.setUsername(name);
    // Mirror the real login path: setUsername alone does not initialize the
    // base-37 identity used by the native friends list.
    player.setLongUsername(core.Misc.stringToLongBigInt(name));
    assert.notEqual(player.getLongUsername(), 0n, "native actor has a login-format identity");
    player.setAttribute("bot-skip-persistence", true);
    player.setLocation(new Location(1524, 3295, 0));
    assert.equal(World.getPlayers().add(player), true, "native player joins World");
    player.needsPlacement = false;
    if (coins) player.getInventory().add(new Item(I.COINS, coins), true);
    const client = new ClientConnection(wire); client.player = player;
    result.client = client; return result;
  }
  async function packet(actor, input) {
    await actor.client.dispatch([input]); actor.client.processTurnPackets(); World.process();
  }
  async function choose(actor, text) {
    const prompt = MultiChatboxPrompt.getPending(actor.player);
    assert.equal(prompt?.title, "Select an option", "the actor owns the native meeting-flag prompt");
    assert.equal(actor.player.getPacketSender().isChatboxInterface(219), true, "the options interface is mounted");
    assert.deepEqual(prompt.options, [FRIENDS, SOLO, JOIN, "Cancel."], "complete native option text");
    const choice = prompt?.options.indexOf(text) ?? -1;
    assert.ok(choice >= 0, `real meeting-flag menu contains ${text}`);
    await packet(actor, { type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: choice + 1 });
  }
  async function openFlag(actor) {
    await packet(actor, { type: "object_option", id: Shared.LOC.FLAG, x: 1525, y: 3295, action: "Fight-privately" });
  }
  const FRIENDS = "Start a public/friends fight (based on privacy setting).";
  const SOLO = "Start a solo fight.";
  const JOIN = "Join a public/friends fight.";
  function ca(actor) {
    const request = { player: actor.player, tier: "Hard" };
    PluginManager.emitCustomEvent("combat-achievements:tier", request); return request;
  }
  function earnHard(actor, omitEasyTask = false) {
    const tiers = Data.tiers();
    for (const tier of tiers.slice(0, 3)) for (const task of tier.tasks) {
      if (omitEasyTask && tier.index === 0 && task === tier.tasks[0]) continue;
      assert.equal(Progress.complete(actor.player, task, { silent: true }), true);
    }
  }
  hard = Data.tiers().find((tier) => tier.name === "Hard");
  assert.equal(hard.threshold, 436, "rev-241 cache Hard threshold");
  const poor = actor("hueypoor", 25000);
  earnHard(poor, true);
  assert.equal(Progress.points(poor.player), hard.threshold - 1);
  assert.equal(ca(poor).currentThresholdMet, false);
  await openFlag(poor); await choose(poor, SOLO);
  assert.equal(poor.player.getInventory().getAmount(I.COINS), 25000, "below threshold cannot pay 25k");
  assert.equal([...Shared.sessions].some((session) => session.owner === poor.player), false);

  const host = actor("hueyhost", 50000);
  assert.equal(ca(host).currentThresholdMet, false);
  await openFlag(host); await choose(host, FRIENDS);
  const hostSession = [...Shared.sessions].find((session) => session.owner === host.player);
  assert.ok(hostSession && hostSession.kind === "friends", "control: normal 50k creates a real friends instance");
  assert.equal(host.player.getInventory().getAmount(I.COINS), 0, "control: normal fee is debited");
  for (let i = 0; i < 5; i++) World.process();
  assert.equal(host.player.getPrivateArea(), hostSession.area, "control: scheduled travel enters the instance");

  const eligible = actor("hueyhard", 25000);
  earnHard(eligible);
  assert.equal(Progress.points(eligible.player), hard.threshold);
  const status = ca(eligible);
  assert.deepEqual([status.currentThresholdMet, status.claimed], [true, false], "eligible without claiming rewards");
  await openFlag(eligible); await choose(eligible, SOLO);
  assert.deepEqual(errors, [], "control: registered plugin and World paths report no errors before the fee target");
  assert.equal(eligible.player.getInventory().getAmount(I.COINS), 0, "eligible private fight debits exactly 25k");
  const solo = [...Shared.sessions].find((session) => session.owner === eligible.player);
  assert.ok(solo && solo.kind === "solo", "eligible player creates a real solo instance");
  for (let i = 0; i < 5; i++) World.process();
  assert.equal(eligible.player.getPrivateArea(), solo.area);

  // The existing fee message is estimated wording; check that it uses the same
  // discounted amount as the actual funds check, without claiming a live line.
  assert.equal(Progress.complete(poor.player, Data.tiers()[0].tasks[0], { silent: true }), true);
  assert.equal(ca(poor).currentThresholdMet, true);
  poor.player.getInventory().deleteNumber(I.COINS, 1);
  const messages = [], sendMessage = poor.player.sendMessage.bind(poor.player);
  t.mock.method(poor.player, "sendMessage", (message, ...args) => { messages.push(message); return sendMessage(message, ...args); });
  await openFlag(poor); await choose(poor, SOLO);
  assert.equal(poor.player.getInventory().getAmount(I.COINS), 24999);
  assert.ok(messages.includes("You need 25,000 coins to start a private fight."));
  assert.equal([...Shared.sessions].some((session) => session.owner === poor.player), false);

  const guest = actor("hueyguest", 12345);
  assert.notEqual(guest.player.getLongUsername(), host.player.getLongUsername(), "friends have distinct identities");
  host.player.getRelations().addFriend(guest.player.getLongUsername());
  assert.equal(host.player.getRelations().isFriendWith(guest.player.getUsername()), true);
  await openFlag(guest); await choose(guest, JOIN);
  assert.ok(guest.player.getEnteredSyntaxAction(), "real join menu requests a name");
  await packet(guest, { type: "dialogue_input", value: host.player.getUsername() });
  for (let i = 0; i < 5; i++) World.process();
  assert.equal(guest.player.getPrivateArea(), hostSession.area, "friend joins the existing instance");
  assert.equal(guest.player.getInventory().getAmount(I.COINS), 12345, "joining does not charge a fee");

  const publicPlayer = actor("hueypublic", 0);
  publicPlayer.player.setAttribute(Area.TAALA_INTRO_ATTRIBUTE, true);
  publicPlayer.player.setLocation(new Location(1528, 3285, 0));
  await packet(publicPlayer, { type: "object_option", id: Shared.LOC.CHAIN, x: 1527, y: 3285, action: "Quick-climb" });
  for (let i = 0; i < 3; i++) World.process();
  assert.deepEqual([publicPlayer.player.getLocation().getX(), publicPlayer.player.getLocation().getY()], Shared.ARENA_ENTRY);
  assert.equal(publicPlayer.player.getInventory().getAmount(I.COINS), 0, "public entrance does not charge a fee");

  // Simulate a previously claimed tier after a later threshold increase. This uses
  // the real saved-status producer, not a claim through Ghommal's dialogue.
  const stale = actor("hueystale", 25000);
  earnHard(stale); Progress.setClaimed(stale.player, hard);
  oldThreshold = hard.threshold;
  try {
    hard.threshold = oldThreshold + 1;
    const raised = ca(stale);
    assert.deepEqual([raised.unlocked, raised.claimed, raised.currentThresholdMet], [true, true, false]);
    await openFlag(stale); await choose(stale, SOLO);
    assert.equal(stale.player.getInventory().getAmount(I.COINS), 25000, "old claim does not bypass current threshold");
    assert.equal([...Shared.sessions].some((session) => session.owner === stale.player), false);
  } finally { hard.threshold = oldThreshold; oldThreshold = null; }
  assert.deepEqual(errors, [], "native plugin, task and World paths report no errors");
});
