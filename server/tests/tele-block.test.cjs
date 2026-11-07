process.env.DISABLE_PLAYER_BOTS = "1";
// Run after `yarn build`: node --test tests/tele-block.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const { SecondsTimer } = require("../dist/game/model/SecondsTimer");
const { PrayerHandler } = require("../dist/game/content/PrayerHandler");
const { EffectTimer } = require("../dist/game/model/EffectTimer");
const TeleBlockPlugin = require("../plugins/combat/TeleBlock.plugin");
const DruidPlugin = require("../plugins/npcs/ElderChaosDruid.plugin");

let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  TeleBlockPlugin.register({ core, onPlayerProcess() {} });
  DruidPlugin.register({ core, registerNpcCombatMethodProvider() {} });
});

const WILDERNESS = new Location(3241, 3610, 0);
const LUMBRIDGE = new Location(3222, 3218, 0);

/** A player that records what the server sends it. */
function player({ at = WILDERNESS, protectMagic = false } = {}) {
  const timer = new SecondsTimer();
  const attributes = new Map();
  const sent = { messages: [], timers: [] };
  const active = [];
  active[PrayerHandler.PROTECT_FROM_MAGIC] = protectMagic;
  return {
    sent,
    timer,
    getLocation: () => at,
    getCombat: () => ({ getTeleblockTimer: () => timer }),
    getPrayerActive: () => active,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => sent.messages.push(text),
    getPacketSender: () => ({ sendEffectTimer: (seconds, type) => sent.timers.push([seconds, type.clientSprite]) }),
  };
}

test("durations read as the captured messages do", () => {
  const { TeleBlock } = core;
  assert.equal(TeleBlock.describe(300), "5 minutes");
  assert.equal(TeleBlock.describe(150), "2 minutes, 30 seconds");
  assert.equal(TeleBlock.describe(87), "1 minute, 27 seconds");
  assert.equal(TeleBlock.describe(30), "30 seconds");
  assert.equal(TeleBlock.describe(1), "1 second");
});

test("a cast tells the target the caster and the time (recordings 435, 437, 438)", () => {
  const { TeleBlock } = core;
  const open = player();
  assert.equal(TeleBlock.apply(open, "an Elder Chaos druid"), 300);
  assert.deepEqual(open.sent.messages, ["<col=c356ef>A Tele Block spell has been cast on you by an Elder Chaos druid. It will expire in 5 minutes.</col>"]);
  assert.equal(open.timer.secondsRemaining(), 300);
  const protectedPlayer = player({ protectMagic: true });
  assert.equal(TeleBlock.apply(protectedPlayer, "an Elder Chaos druid"), 150);
  assert.match(protectedPlayer.sent.messages[0], /It will expire in 2 minutes, 30 seconds\.<\/col>$/);
});

test("a teleport attempt while blocked names the time left (recording 435)", () => {
  const { TeleBlock } = core;
  const blocked = player();
  blocked.timer.start(87);
  assert.equal(TeleBlock.attemptMessage(blocked), "A teleport block has been cast on you. It should wear off in 1 minute, 27 seconds.");
});

test("the 30 second warning comes once, and the block is dropped on leaving the Wilderness", () => {
  const { TeleBlock } = core;
  const tick = (p) => TeleBlockPlugin._test.tickTeleBlock({ player: p });
  const warned = player();
  TeleBlock.apply(warned, "a player");
  warned.sent.messages.length = 0;
  tick(warned);
  assert.deepEqual(warned.sent.messages, [], "no warning with five minutes left");
  warned.timer.start(30);
  tick(warned);
  tick(warned);
  assert.deepEqual(warned.sent.messages, ["<col=c356ef>Your Tele Block will expire in 30 seconds."]);

  const leaver = player({ at: LUMBRIDGE });
  TeleBlock.apply(leaver, "a player");
  tick(leaver);
  assert.equal(leaver.timer.isRunning(), false);
  assert.deepEqual(leaver.sent.timers.at(-1), [0, EffectTimer.TELE_BLOCK.clientSprite]);
});

test("an Elder Chaos druid casts Tele Block only when none is running or it is nearly over", () => {
  const { blockWanted } = DruidPlugin._test;
  const target = player();
  target.isPlayer = () => true;
  target.getAsPlayer = () => target;
  assert.equal(blockWanted(target), true, "nothing running");
  target.timer.start(300);
  assert.equal(blockWanted(target), false, "five minutes left");
  target.timer.start(12);
  assert.equal(blockWanted(target), true, "about 20 ticks left");
  assert.equal(blockWanted({ isPlayer: () => false }), false, "never at a monster");
});
