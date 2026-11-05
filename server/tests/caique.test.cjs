// Run after `yarn build`: node --test tests/caique.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const Caique = require("../plugins/npcs/Caique.plugin");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

function scene(hitpoints = 10) {
  const tasks = [], log = [];
  let blocked = false, at = new core.Location(1368, 3081, 0);
  const tick = () => log.push("|");
  const player = {
    isRegistered: () => true,
    getHitpoints: () => hitpoints,
    getLocation: () => at,
    performAnimation: (animation) => log.push(`player ${animation.getId()}`),
    getPacketSender: () => ({
      sendVarbit: (id, value) => log.push(`varbit ${id}=${value}`),
      sendSoundEffect: (id, loops, delay) => log.push(`sound ${id} delay ${delay}`),
    }),
    getMovementQueue: () => ({ isMovementBlocked: () => blocked, setBlockMovement(value) { blocked = value; return this; }, reset() {} }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: ([hit]) => log.push(`hit ${hit.getDamage()}`) }) }),
    getDialogueManager: () => ({ startDialogues: (chain) => log.push(chain) }),
  };
  const npc = { isRegistered: () => true, performAnimation: (animation) => log.push(`bird ${animation.getId()}`) };
  const fake = { ...core, TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } } };
  return {
    log, player, npc, tasks, get blocked() { return blocked; }, move: (location) => { at = location; },
    pet: () => Caique._test.pet(fake, { player, npc }),
    run: (count) => { for (let i = 0; i < count; i++) { tick(); for (const task of tasks) task.tick(); } },
  };
}

test("only the sitting caiques offer Pet", () => {
  const ids = core.CacheDefinitions;
  for (const side of ["north", "south", "east", "west"]) {
    assert.deepEqual(NpcDefinition.forId(ids.getNpcId(`varlamore_parrot_caique_rock_${side}`)).getActions().filter(Boolean), ["Pet"]);
  }
  for (const gameval of ["varlamore_parrot_caique", "varlamore_parrot_ulama02"]) {
    assert.deepEqual(NpcDefinition.forId(ids.getNpcId(gameval)).getActions().filter(Boolean), []);
  }
});

test("a sitting caique pecks as captured: 1 damage, the message box, then Ouch! (#2449)", () => {
  const ids = core.CacheDefinitions;
  const busy = ids.getVarbitId("busy");
  const s = scene();
  assert.equal(s.pet(), true);
  assert.equal(s.blocked, true);
  assert.equal(s.pet(), true, "a second click while pecked does nothing");
  assert.equal(s.tasks.length, 1);
  s.run(5);
  const [chain] = s.log.splice(s.log.findIndex((entry) => typeof entry === "object"), 1);
  // RSProx 237/1098, from the arrival.
  assert.deepEqual(s.log, [
    `varbit ${busy}=1`,
    "|",
    "|", `player ${ids.getSeqId("vmq4_human_caique_pet")}`, `bird ${ids.getSeqId("vmq4_caique_peck")}`,
    "|",
    "|", "hit 1", "sound 521 delay 20", `varbit ${busy}=0`,
    "|",
  ]);
  assert.equal(s.blocked, false);
  const dialogues = chain.getDialogues();
  assert.equal(dialogues.get(0).getText(), Caique._test.PECKED, "the message box");
  assert.equal(dialogues.get(1).constructor.name, "PlayerDialogue");
  assert.equal(dialogues.get(1).getText(), Caique._test.OUCH);
});

test("at 1 Hitpoints the peck does no damage; walking off ends it and frees the player", () => {
  const low = scene(1);
  low.pet();
  low.run(5);
  assert.ok(low.log.includes("hit 0"));
  const away = scene();
  away.pet();
  away.run(1);
  away.move(new core.Location(1367, 3081, 0));
  away.run(4);
  assert.equal(away.log.some((entry) => typeof entry === "string" && entry.startsWith("hit")), false);
  assert.equal(away.blocked, false);
});

test("spawns use the variants captured on each tile: sitting caiques, pettable dogs, the cabbage pair (#2449)", () => {
  // RSProx (226-237) adds these NPC ids on these Wiki LocLine tiles.
  const spawns = require("../data/definitions/npc-spawns.json");
  const ids = core.CacheDefinitions;
  const at = (name, x, y) => spawns.find((spawn) => spawn.name === name && spawn.x === x && spawn.y === y)?.id;
  assert.equal(at("Caique", 1369, 3081), ids.getNpcId("varlamore_parrot_caique_rock_west"), "Kastori, by the statue of Ates");
  assert.equal(at("Caique", 1320, 3181), ids.getNpcId("varlamore_parrot_caique_rock_south"), "the north of the Tlati Rainforest");
  assert.equal(at("Caique", 1224, 3134), ids.getNpcId("varlamore_parrot_ulama02"));
  assert.equal(at("Xolo", 1749, 3049), ids.getNpcId("varlamore_dog_xolo_cabbage"));
  assert.equal(at("Molossus", 1748, 3050), ids.getNpcId("varlamore_dog_molossus_cabbage"));
  const pettable = (spawn) => NpcDefinition.forId(spawn.id).getActions().includes("Pet");
  const named = (name) => spawns.filter((spawn) => spawn.name === name);
  assert.equal(named("Caique").filter(pettable).length, 2, "two sitting caiques");
  for (const name of ["Xolo", "Molossus"]) {
    assert.deepEqual(named(name).filter((spawn) => !pettable(spawn)).map((spawn) => [spawn.x, spawn.y]), [[name === "Xolo" ? 1749 : 1748, name === "Xolo" ? 3049 : 3050]], `${name}: only the cabbage dog can't be petted`);
  }
});
