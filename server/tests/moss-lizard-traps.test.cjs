// Run after `yarn build`: node --test tests/moss-lizard-traps.test.cjs
// Neypotzli's moss lizard traps as rsprox 1693 shows them (#6917): two neighbouring rocks make a trap (the
// rope stays), a rustled bush sends lizards at the trap sites, and one reaching a set trap leaves a raw lizard.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, afterEach, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const C = require("../plugins/skills/hunter/Context.Hunter");
const { H } = C;
const Dungeon = require("../plugins/skills/hunter/Dungeon.Hunter");

let core, index = 9400, drops = [], lizards = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  H.api = {
    emitCustomEvent() {},
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z);
      const flags = new Map();
      const npc = { definition, removed: false, animations: [], steps: null,
        getLocation: () => location, setLocation: (to) => { location = to; }, isRegistered: () => !npc.removed,
        setScriptedMovement() {}, setFlag: (key, value) => flags.set(key, value), setMovementSteps: (n) => { npc.run = n; },
        setPositionToFace() {}, setArea() {}, performAnimation: (a) => npc.animations.push(a.getId()),
        getMovementQueue: () => ({ size: () => (npc.steps ? 1 : 0), addSteps: (to) => { npc.steps = to; } }) };
      lizards.push(npc);
      return npc;
    },
    removeNpc(npc) { npc.removed = true; },
  };
  H.core = { ...core, ItemOnGroundManager: { registerLocation(_player, item, location) { drops.push([item.getId(), location.getX(), location.getY()]); } } };
});
afterEach(() => { H.actions.clear(); H.players.clear(); drops = []; lizards = []; });

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername("lizard" + player.getIndex()); player.setRegistered(true);
  player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 99).setMaxLevel(core.Skill.HUNTER, 99);
  const messages = [], varbits = new Map();
  const sender = player.getPacketSender();
  t.mock.method(sender, "sendMessage", (text) => { messages.push(text); return sender; });
  t.mock.method(player, "sendMessage", (text) => { messages.push(text); });
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.set(id, value); return sender; });
  t.after(() => { Dungeon.cleanup({ player }); player.setRegistered(false); });
  return { player, messages, varbits };
}

function tick(times = 1) {
  for (let i = 0; i < times; i++) { H.tick++; C.processActions(); Dungeon.process(); }
}

function click(player, op, id, x, y, from) {
  player.setLocation(new core.Location(from[0], from[1], 0));
  const object = new core.GameObject(id, new core.Location(x, y, 0), 10, 0, null);
  assert.equal(op({ player, object }), true);
}

test("two neighbouring rocks make a trap, a rustled bush sends three lizards, and the trap catches one", (t) => {
  const { player, messages, varbits } = actor(t);
  const rock = core.ObjectIdentifiers.ROCK_167, bush = core.ObjectIdentifiers.BUSH_63;
  player.getInventory().adds(core.ItemIdentifiers.ROPE, 1);

  click(player, Dungeon.rock, rock, 1381, 9680, [1382, 9680]);
  tick();
  assert.deepEqual(messages.splice(0), ["You set up the first half of the trap."]);
  click(player, Dungeon.rock, rock, 1383, 9678, [1383, 9679]);
  tick();
  assert.deepEqual(messages.splice(0), ["You finish setting up the trap.", "You set up the first half of the trap."]);
  assert.equal(varbits.get(9873), 1, "the trap between those rocks is set");
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ROPE), 1, "the rope stays");

  const random = Math.random;
  Math.random = () => 0;
  t.after(() => { Math.random = random; });
  click(player, Dungeon.rustle, bush, 1380, 9684, [1380, 9683]);
  tick();
  assert.deepEqual(messages.splice(0), ["Your hunting knowledge allows you to spook more lizards!"]);
  tick(5);
  assert.equal(lizards.length, 3, "one a tick from two ticks after the rustle");
  assert.deepEqual(lizards.map((npc) => [npc.steps.getX(), npc.steps.getY()]), [[1382, 9679], [1380, 9680], [1378, 9681]],
    "the set trap first, then the other sites");
  assert.equal(lizards[0].run, 2, "running");

  click(player, Dungeon.rustle, bush, 1380, 9684, [1380, 9683]);
  tick();
  assert.deepEqual(messages.splice(0), ["This bush has been shaken too recently."]);

  for (const npc of lizards) npc.setLocation(npc.steps.clone());
  const xp = player.getSkillManager().getExperience(core.Skill.HUNTER);
  tick(3);
  assert.equal(varbits.get(9873), 2, "the trap springs three ticks after the lizard's last step");
  assert.deepEqual(lizards[0].animations, [11066]);
  assert.deepEqual(lizards.slice(1).map((npc) => npc.removed), [true, true], "no trap where the others ran to");
  tick();
  assert.equal(varbits.get(9873), 0);
  assert.deepEqual(drops, [[core.ItemIdentifiers.RAW_MOSS_LIZARD, 1382, 9679]]);
  assert.ok(player.getSkillManager().getExperience(core.Skill.HUNTER) > xp);
  assert.equal(lizards[0].removed, true);
});

test("rocks that aren't neighbours make no trap, and the traps can be set up again and again", (t) => {
  const { player, messages, varbits } = actor(t);
  const rock = core.ObjectIdentifiers.ROCK_167;
  click(player, Dungeon.rock, rock, 1377, 9682, [1377, 9681]);
  assert.deepEqual(messages.splice(0), ["You need a rope to set a trap between the rocks."]);
  player.getInventory().adds(core.ItemIdentifiers.ROPE, 1);

  click(player, Dungeon.rock, rock, 1377, 9682, [1377, 9681]);
  tick();
  click(player, Dungeon.rock, rock, 1383, 9678, [1383, 9679]);
  tick();
  assert.ok(!messages.includes("You finish setting up the trap."));
  messages.length = 0;

  for (const [x, y] of [[1381, 9680], [1379, 9680], [1377, 9682]]) {
    click(player, Dungeon.rock, rock, x, y, [x, y - 1]);
    tick();
  }
  assert.deepEqual([varbits.get(9871), varbits.get(9872), varbits.get(9873)], [1, 1, 1], "all three sites");

  player.setLocation(new core.Location(1440, 9620, 0));
  Dungeon.process();
  assert.deepEqual([varbits.get(9871), varbits.get(9872), varbits.get(9873)], [0, 0, 0], "leaving takes them down");
});
