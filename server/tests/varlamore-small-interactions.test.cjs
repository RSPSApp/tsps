// Run after `yarn build`: node --test tests/varlamore-small-interactions.test.cjs
//
// Issue 6108: the Varlamore interactions behind five league tasks, through the real plugins: the
// bird bath's four outcomes and its vessel line (Wiki: Transcript:Bird bath), the Dairy Buffalo
// with no bucket, and Oli's recorded reply to the stew (RSProx 237/1098 tick 15381).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, next = 6108;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("varlamore" + next); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(1556, 3170, 0)); p.needsPlacement = false;
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => (messages.push(String(text)), send(text, ...rest));
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { p, messages };
}

const BirdBath = require("../plugins/objects/BirdBath.plugin.js")._test;

test("bird bath: each of the transcript's four outcomes, two ticks after the Yes, with its line and effect", (t) => {
  for (const [roll, check] of [
    [0, (p) => assert.equal(p.getHitpoints(), 10, "nothing")],
    [0.3, (p) => assert.deepEqual(p.getCombat().getHitQueue().pendingDamage.map((hit) => hit.getDamage()), [1], "a 1 damage hit queued")],
    [0.6, (p) => assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), 3, "Defence +2")],
    [0.9, (p) => assert.equal(p.getPoisonDamage(), 2, "poisoned, 2 severity (varp 102 = 2 in 1098 tick 14897)")],
  ]) {
    const { p } = player(t);
    BirdBath.drink(p, () => roll);
    assert.equal(p.getAnimation()?.getId(), core.CacheDefinitions.getSeqId("poh_pool_drink_silent"));
    core.TaskManager.process();
    assert.equal(p.getDialogueManager().getCurrent(), undefined, "nothing a tick on");
    core.TaskManager.process();
    core.TaskManager.process();
    const line = BirdBath.OUTCOMES[Math.floor(roll * 4)].line;
    assert.equal(p.getDialogueManager().getCurrent()?.text ?? p.getDialogueManager().getCurrent()?.getText?.(), line);
    check(p);
  }
});

test("bird bath: No closes the menu; a bowl, jug, bucket or vial used on it says there is not enough water (Wiki)", (t) => {
  const { p, messages } = player(t);
  BirdBath.drinkFrom({ player: p });
  p.getDialogueManager().getCurrent().execute(2);
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.equal(p.getAnimation()?.getId() === core.CacheDefinitions.getSeqId("poh_pool_drink_silent"), false, "no drink");
  core.RegionManager.loadMapFiles(1555, 3170);
  const bath = core.MapObjects.getObjectsAt(new core.Location(1555, 3170, 0), null).find((object) => object.getDefinition()?.getName() === "Bird bath");
  const event = { player: p, itemId: core.ItemIdentifiers.BOWL, object: bath, objectId: bath.getId(), handled: false };
  PM.emitItemOnObject(event);
  assert.ok(messages.includes(BirdBath.NOT_ENOUGH_WATER), messages.join(" | "));
});

test("Dairy Buffalo: no empty bucket, no milking", (t) => {
  const { p, messages } = player(t);
  const Buffalo = require("../plugins/objects/DairyBuffalo.plugin.js")._test;
  Buffalo.milk({ player: p });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.ok(messages.includes(Buffalo.NO_BUCKET));
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BUCKET_OF_MILK), 0);
});

test("Oli and the stew: the item box, then his thanks, the player's 'more?' and his refusal, as recorded", (t) => {
  const { p } = player(t);
  const Oli = require("../plugins/npcs/OliStew.plugin.js")._test;
  const oli = core.NPC.create(Oli.OLI, new core.Location(1557, 3170, 0));
  p.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.STEW, 1));
  const event = { player: p, target: oli, itemId: core.ItemIdentifiers.STEW, slot: 0, item: p.getInventory().getItems()[0], handled: false };
  Oli.giveStew(event);
  assert.equal(event.handled, true);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STEW), 0);
  const manager = p.getDialogueManager();
  assert.equal(manager.getCurrent().getItemId(), core.ItemIdentifiers.STEW);
  const texts = [];
  for (let i = 0; i < 6 && manager.getCurrent(); i++) {
    const current = manager.getCurrent();
    const text = current.getText?.() ?? current.text;
    if (text) texts.push(text);
    manager.advance();
  }
  assert.deepEqual(texts, [Oli.BOX, ...Oli.LINES.map((line) => line.npc ?? line.player)]);
  const other = { player: p, target: oli, itemId: core.ItemIdentifiers.BREAD ?? 2309, slot: 0, handled: false };
  Oli.giveStew(other);
  assert.equal(other.handled, false, "another item is not the stew");
});
