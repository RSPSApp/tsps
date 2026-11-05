// Run after `yarn build`: node --test tests/first-blood-gates.test.cjs
//
// The Blood Moon Rises, First Blood: no damage to Lowerniel until the player has dodged his lunges (Wiki: 3-5
// strikes; 3 is the plugin's). Native fixture: real transcript actions begin it, hits are real PendingHits
// through NPC.manipulateHit, dodges are real move packets through ClientConnection.dispatch and the real
// movement queue, onto the tile the real safe-tile graphic marks. Each tick runs in World's order: the NPC's
// area first, then the player. The strike comes 3 ticks after the telegraph, as in rsprox 4288, so a click
// reaching the server on either of the two ticks after the mark is in time. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { World } = require("../dist/game/World");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const ARENA = [2712, 7840];
const BEGIN_STEPS = ["lKvIyH", "D5qF0g", "sw9z49"];
const SAFE_TILE_GRAPHICS = [3896, 3897];
const DODGED = /spear lunges dodged/;
const CAUGHT = /spear lunge catches you/;
const UNLOCKED = /You can now strike him/;
const LUNGES_TO_UNLOCK = 3;

let core;
let next = 7000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...ARENA);
});
after(() => PM.emitServerShutdown({}));

function encounter(t) {
  const spawned = [];
  const spawn = PM.spawnNpc;
  t.mock.method(PM, "spawnNpc", (...args) => {
    const npc = spawn.apply(PM, args);
    if (npc) spawned.push(npc);
    return npc;
  });
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("firstblood" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(ARENA[0], ARENA[1], 0));
  const c = new ClientConnection(channel);
  c.player = p;
  const sender = p.getPacketSender();
  const f = { p, c, messages: [], marks: [] };
  t.mock.method(sender, "sendMessage", (message) => {
    f.messages.push(message);
    return sender;
  });
  const sendGraphic = sender.sendGraphic;
  t.mock.method(sender, "sendGraphic", function (graphic, location, ...rest) {
    if (SAFE_TILE_GRAPHICS.includes(graphic.getId())) f.marks.push([location.getX(), location.getY()]);
    return sendGraphic.call(this, graphic, location, ...rest);
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_blood_moon_rises");
  quest.setStage(p, 50);
  p.setAttribute("quest.the_blood_moon_rises.blood-hunt", { drawbridgeRepaired: true });
  for (const stepId of BEGIN_STEPS) PM.emitCustomEvent("npc-dialogue:action", { player: p, stepId });
  f.boss = spawned.find((npc) => npc.getId() === core.NpcIdentifiers.LOWERNIEL_DRAKAN_20);
  f.ally = spawned.find((npc) => npc.getId() === core.NpcIdentifiers.VANESCULA_DRAKAN_20);
  assert.ok(f.boss && f.ally, "the encounter began");
  return f;
}

const count = (f, pattern) => f.messages.filter((message) => pattern.test(message)).length;

function landed(attacker, target, damage) {
  const hit = new PendingHit(attacker, target, core.CombatFactory.MELEE_COMBAT);
  hit.getHits()[0].setDamage(damage);
  return target.manipulateHit(hit).getHits()[0].getDamage();
}

/** One tick in World's order. `click` is a tile the player clicked since the last tick. */
async function tick(f, click = null) {
  // A mark goes out in the NPC phase, so the earliest answer is next tick's.
  World.processCycle++;
  AreaManager.process(f.boss);
  f.p.setNeedsPlacement(false);
  if (click) await f.c.dispatch([{ type: "move", worldX: click[0], worldY: click[1], modifierFlags: 0, run: false }]);
  f.c.processTurnPackets();
  f.p.getMovementQueue().process();
}

test("before the lunges a player's hit on Lowerniel does nothing, and nor does his on Vanescula, which is ours", (t) => {
  const f = encounter(t);
  const stranger = core.NPC.create(core.NpcIdentifiers.MAN, new core.Location(3222, 3218, 0));
  assert.equal(landed(f.p, stranger, 20), 20, "control: a hit elsewhere stands");
  assert.equal(landed(f.p, f.boss, 20), 0, "the player's hit");
  assert.equal(landed(f.boss, f.ally, 69), 0, "his hit on the ally");
});

test("walking onto three marked tiles unlocks him, and real damage lands", async (t) => {
  const still = encounter(t);
  for (let i = 0; i < 40 && count(still, CAUGHT) < LUNGES_TO_UNLOCK; i++) await tick(still);
  assert.equal(count(still, CAUGHT), LUNGES_TO_UNLOCK, "control: standing still is caught each time");
  assert.equal(count(still, DODGED), 0, "and dodges nothing");
  assert.equal(landed(still.p, still.boss, 20), 0, "so he stays shut");

  const f = encounter(t);
  let answered = 0;
  for (let i = 0; i < 60 && count(f, UNLOCKED) === 0; i++) {
    // A mark sent last tick is on the client now, so the click comes in this tick.
    const click = f.marks.length > answered ? f.marks[answered++] : null;
    await tick(f, click);
  }
  t.diagnostic(`marks ${JSON.stringify(f.marks)}; at ${f.p.getLocation().getX()},${f.p.getLocation().getY()}`);
  assert.equal(count(f, DODGED), LUNGES_TO_UNLOCK, f.messages.join(" | "));
  assert.equal(count(f, CAUGHT), 0, "none of the walked dodges was caught");
  assert.equal(count(f, UNLOCKED), 1, "he turns to the player");
  assert.equal(landed(f.p, f.boss, 20), 20, "the player's hit now lands");
  assert.equal(landed(f.boss, f.ally, 69), 69, "and so does his on the ally, the gate having opened");

  // The last moment: the click arrives on the second tick after the mark, the tick the strike's cue is out.
  const late = encounter(t);
  let lateAnswered = 0;
  const wait = new Map();
  for (let i = 0; i < 60 && count(late, UNLOCKED) === 0; i++) {
    if (late.marks.length > lateAnswered) {
      const mark = lateAnswered++;
      wait.set(mark, 1);
    }
    let click = null;
    for (const [mark, left] of wait) {
      if (left === 0) {
        click = late.marks[mark];
        wait.delete(mark);
      } else wait.set(mark, left - 1);
    }
    await tick(late, click);
  }
  assert.equal(count(late, DODGED), LUNGES_TO_UNLOCK, `a click on the last tick dodges: ${late.messages.join(" | ")}`);
  assert.equal(count(late, CAUGHT), 0);
});
