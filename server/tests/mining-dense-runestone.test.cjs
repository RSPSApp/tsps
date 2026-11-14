// From server/: node --test tests/mining-dense-runestone.test.cjs (after yarn build).
// Chipping the Arceuus dense runestones as live OSRS does: rsprox recordings 1669 (a full run to
// depletion with the medium Kourend diary, the respawn, a full inventory), 1670 (no tools) and
// 3899 (both pillars), and the Wiki's Dense runestone page (levels, XP, depletion chart).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { Player } = require("../dist/game/entity/impl/player/Player");
const DenseRunestone = require("../plugins/skills/mining/DenseRunestone.Mining");

let core;
const medium = new WeakSet();
const NORTH = { x: 1762, y: 3856 }, SOUTH = { x: 1762, y: 3844 };
const BLOCK = 13445;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SOUTH.x, SOUTH.y);
  PM.createApi("DenseRunestoneTest").onCustomEvent("diary:is-complete", (request) => {
    if (request.diary === "kourend" && request.tier === "medium" && medium.has(request.player)) request.complete = true;
  });
});
after(() => PM.emitServerShutdown({}));

const varbitId = (name) => core.CacheDefinitions.getVarbitId(name);

function pillar(spot, gameval) {
  const id = core.CacheDefinitions.getLocId(gameval);
  const object = core.MapObjects.get(id, new core.Location(spot.x, spot.y, 0), null);
  assert.ok(object, `${gameval} stands at ${spot.x},${spot.y} in the cache map`);
  return object;
}

function miner({ mining = 99, crafting = 99, tools = true, fill = 0, diary = false } = {}) {
  const player = new Player(new BotPlayerSession());
  player.setUsername(`dense${Math.floor(Math.random() * 1e6)}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(1765, 3849, 0));
  for (const [skill, value] of [[core.Skill.MINING, mining], [core.Skill.CRAFTING, crafting]]) {
    player.getSkillManager().setMaxLevel(skill, value);
    player.getSkillManager().setCurrentLevel(skill, value);
  }
  if (tools) {
    player.getInventory().adds(core.ItemIdentifiers.RUNE_PICKAXE, 1);
    player.getInventory().adds(core.ItemIdentifiers.CHISEL, 1);
  }
  if (fill) player.getInventory().adds(core.ItemIdentifiers.LOGS, fill);
  if (diary) medium.add(player);
  const log = { sounds: [], scripts: [], spam: [], boxes: [], anims: [] };
  const sender = player.getPacketSender();
  sender.sendSoundEffect = (id) => { log.sounds.push(id); return sender; };
  sender.sendClientScript = (...args) => { log.scripts.push(args); return sender; };
  sender.sendTypedMessage = (type, text) => { if (type === core.ChatType.SPAM) log.spam.push(text); return sender; };
  player.getDialogueManager = () => ({ startDialogues: (chain) => {
    for (const d of chain.getDialogues().values()) log.boxes.push([d.constructor.name, d.getText()]);
  } });
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { log.anims.push(animation.getId()); return perform(animation); };
  return { player, log };
}

function click(player, object, option) {
  const definition = core.ObjectDefinition.forPlayer(object.getId(), player);
  const handlers = { Chip: DenseRunestone._test.chip, Check: DenseRunestone._test.check };
  const event = { player, object, objectId: object.getId(), definition, option };
  return { name: definition.getName(), handled: handlers[option](event) };
}

function ticks(n) {
  for (let i = 0; i < n; i++) core.TaskManager.process();
}

const xp = (player, skill) => player.getSkillManager().getExperience(skill);

test("both pillars are the Dense runestone until a player depletes one", () => {
  const { player } = miner();
  for (const [spot, gameval] of [[NORTH, "arceuus_runestone_base_1"], [SOUTH, "arceuus_runestone_base_2"]]) {
    const definition = core.ObjectDefinition.forPlayer(pillar(spot, gameval).getId(), player);
    assert.equal(definition.getName(), "Dense runestone");
    assert.deepEqual(definition.getInteractions().slice(0, 1), ["Chip"]);
  }
});

test("a block every 9 ticks: swing, chisel 3 ticks on, 12 Mining and 8 Crafting XP (rec 1669 tick 6)", (t) => {
  t.mock.method(Math, "random", () => 0);
  const { player, log } = miner();
  const stone = pillar(SOUTH, "arceuus_runestone_base_2");
  const mining = xp(player, core.Skill.MINING), crafting = xp(player, core.Skill.CRAFTING);
  assert.equal(click(player, stone, "Chip").handled, true);
  const pickaxe = 624; // human_mining_rune_pickaxe
  const chisel = core.CacheDefinitions.getSeqId("arceuus_chisel_essence");
  ticks(1);
  assert.deepEqual(log.anims, [pickaxe], "the swing the tick after arrival");
  ticks(3);
  assert.deepEqual(log.anims, [pickaxe, chisel], "the chisel 3 ticks later");
  ticks(5);
  assert.equal(player.getInventory().getAmount(BLOCK), 0, "no block before the 9th tick");
  ticks(1);
  assert.equal(player.getInventory().getAmount(BLOCK), 1);
  assert.deepEqual(log.sounds, [3600]);
  assert.equal(xp(player, core.Skill.MINING) - mining, 12);
  assert.equal(xp(player, core.Skill.CRAFTING) - crafting, 8);
  assert.deepEqual(log.anims, [pickaxe, chisel, pickaxe], "the swing starts again with the block");
  ticks(9);
  assert.equal(player.getInventory().getAmount(BLOCK), 2, "the next block 9 ticks on");
  assert.deepEqual(log.spam, [], "no extra block without the medium diary");
  DenseRunestone._test.sessions.delete(player);
});

test("the medium Kourend diary: an extra block 5% of the time, a spam line and no extra XP", (t) => {
  const { player, log } = miner({ diary: true });
  const stone = pillar(SOUTH, "arceuus_runestone_base_2");
  const rolls = [0.04, 0]; // the extra-block roll, then the pillar stays
  t.mock.method(Math, "random", () => rolls.shift() ?? 0);
  const mining = xp(player, core.Skill.MINING), crafting = xp(player, core.Skill.CRAFTING);
  click(player, stone, "Chip");
  ticks(10);
  assert.equal(player.getInventory().getAmount(BLOCK), 2);
  assert.deepEqual(log.spam, ["You mined an extra block of essence thanks to your completion of the Kourend & Kebos Medium Diary."]);
  assert.equal(xp(player, core.Skill.MINING) - mining, 12);
  assert.equal(xp(player, core.Skill.CRAFTING) - crafting, 8);
  rolls.push(0.05, 0);
  ticks(9);
  assert.equal(player.getInventory().getAmount(BLOCK), 3, "a 5% roll or worse gives one block");
  DenseRunestone._test.sessions.delete(player);
});

test("depletion: varbits, reset, overlay timer, sound 2661, Check box, then the respawn (rec 1669 tick 43)", (t) => {
  const { player, log } = miner();
  const stone = pillar(SOUTH, "arceuus_runestone_base_2");
  const rolls = [0.95, 0.6]; // 0.95 >= 90.2% keep chance at 99: depletes; 0.6 picks 28 respawn ticks
  t.mock.method(Math, "random", () => rolls.shift() ?? 0);
  click(player, stone, "Chip");
  ticks(10);
  const sender = player.getPacketSender();
  assert.equal(player.getInventory().getAmount(BLOCK), 1, "the depleting chip still gives its block");
  assert.equal(sender.getVarbit(varbitId("arceuus_runestone_2")), 1);
  assert.equal(sender.getVarbit(varbitId("arceuus_runestones")), 2);
  assert.equal(log.anims.at(-1), core.Animation.DEFAULT_RESET_ANIMATION.getId());
  assert.deepEqual(log.sounds, [3600, 2661]);
  const location = stone.getLocation();
  const coord = (location.getZ() << 28) | (location.getX() << 14) | location.getY();
  assert.deepEqual(log.scripts, [[5474, coord, stone.getId(), 10, 1, 28, 16765184, 0]]);
  assert.equal(DenseRunestone._test.sessions.has(player), false, "chipping stops");

  const depleted = click(player, stone, "Check");
  assert.equal(depleted.name, "Depleted runestone");
  assert.deepEqual(log.boxes, [["StatementDialogue", "The runestone has been mined to depletion."]]);
  assert.equal(log.sounds.at(-1), 2661);

  const north = pillar(NORTH, "arceuus_runestone_base_1");
  assert.equal(core.ObjectDefinition.forPlayer(north.getId(), player).getName(), "Dense runestone", "the other pillar stays");
  ticks(27);
  assert.equal(sender.getVarbit(varbitId("arceuus_runestone_2")), 1, "still out before its timer");
  ticks(1);
  assert.equal(sender.getVarbit(varbitId("arceuus_runestone_2")), 0, "back when the timer ends");
  assert.equal(sender.getVarbit(varbitId("arceuus_runestones")), 0);
});

test("one pillar out at a time: depleting the other brings the first back", (t) => {
  const { player } = miner();
  const rolls = [0.95, 0, 0.95, 0];
  t.mock.method(Math, "random", () => rolls.shift() ?? 0);
  click(player, pillar(SOUTH, "arceuus_runestone_base_2"), "Chip");
  ticks(10);
  player.setLocation(new core.Location(1765, 3855, 0));
  click(player, pillar(NORTH, "arceuus_runestone_base_1"), "Chip");
  ticks(10);
  const sender = player.getPacketSender();
  assert.equal(sender.getVarbit(varbitId("arceuus_runestone_1")), 1);
  assert.equal(sender.getVarbit(varbitId("arceuus_runestone_2")), 0);
  assert.equal(sender.getVarbit(varbitId("arceuus_runestones")), 1);
  ticks(30);
  assert.equal(sender.getVarbit(varbitId("arceuus_runestones")), 0, "the restored pillar's old timer leaves the new one alone");
  assert.equal(sender.getVarbit(varbitId("arceuus_runestone_1")), 0);
});

test("refusals: no tools (rec 1670 tick 13), a full inventory (rec 1669 tick 209), under the levels", () => {
  const stone = pillar(SOUTH, "arceuus_runestone_base_2");
  const none = miner({ tools: false });
  click(none.player, stone, "Chip");
  assert.deepEqual(none.log.boxes, [["DoubleItemStatementDialogue", "You need a pickaxe and chisel to chip anything off this."]]);
  assert.deepEqual(none.log.sounds, [2277]);

  const full = miner({ fill: 26 });
  click(full.player, stone, "Chip");
  assert.deepEqual(full.log.boxes, [["StatementDialogue", "You don't have space to chip anything off."]]);
  assert.deepEqual(full.log.sounds, [2277]);

  for (const levels of [{ mining: 37 }, { crafting: 37 }]) {
    const low = miner(levels);
    low.player.getInventory().adds(core.ItemIdentifiers.BRONZE_PICKAXE, 1);
    click(low.player, stone, "Chip");
    assert.equal(low.log.boxes.length, 1);
    assert.match(low.log.boxes[0][1], /Mining level of 38 and a Crafting level of 38/);
    assert.equal(DenseRunestone._test.sessions.has(low.player), false);
  }
});

test("chipping ends when the inventory fills or the player walks off", (t) => {
  t.mock.method(Math, "random", () => 0);
  const { player, log } = miner({ fill: 25 });
  click(player, pillar(SOUTH, "arceuus_runestone_base_2"), "Chip");
  ticks(10);
  assert.equal(player.getInventory().getFreeSlots(), 0);
  ticks(9);
  assert.equal(player.getInventory().getAmount(BLOCK), 1);
  assert.deepEqual(log.boxes, [["StatementDialogue", "You don't have space to chip anything off."]]);
  assert.equal(DenseRunestone._test.sessions.has(player), false);

  const walker = miner();
  click(walker.player, pillar(SOUTH, "arceuus_runestone_base_2"), "Chip");
  ticks(2);
  walker.player.clearPendingAction();
  ticks(10);
  assert.equal(walker.player.getInventory().getAmount(BLOCK), 0);
});

test("the Wiki's keep chance by Mining level, and respawn timers within the captured 25-29 ticks", () => {
  const { keepChance, respawnTicks } = DenseRunestone._test;
  assert.equal(keepChance(38), 0.855);
  assert.equal(keepChance(42), 0.855);
  assert.equal(keepChance(43), 0.859);
  assert.equal(keepChance(76), 0.883);
  assert.equal(keepChance(97), 0.902);
  assert.equal(keepChance(120), 0.902);
  assert.equal(respawnTicks(() => 0), 25);
  assert.equal(respawnTicks(() => 0.999), 29);
});

test("a level-up pop-up holds chipping until Continue, then the swing starts again", (t) => {
  t.mock.method(Math, "random", () => 0);
  const { player } = miner();
  click(player, pillar(SOUTH, "arceuus_runestone_base_2"), "Chip");
  ticks(10);
  assert.equal(player.getInventory().getAmount(BLOCK), 1);
  let resume = null;
  PM.emitCustomEvent("level-up:popup-opened", { player, skill: core.Skill.MINING, pause: (session, onResume) => { resume = onResume; } });
  assert.ok(resume, "the session paused");
  ticks(27);
  assert.equal(player.getInventory().getAmount(BLOCK), 1, "no blocks while the pop-up is open");
  resume();
  ticks(9);
  assert.equal(player.getInventory().getAmount(BLOCK), 1, "the swing restarts: the next block is on the 10th tick");
  ticks(1);
  assert.equal(player.getInventory().getAmount(BLOCK), 2);
  DenseRunestone._test.sessions.delete(player);
});

test("chipping stops when a boost wears off below 38 or the pickaxe can no longer be used", (t) => {
  t.mock.method(Math, "random", () => 0);
  const { player } = miner({ mining: 36 });
  player.getInventory().adds(core.ItemIdentifiers.BRONZE_PICKAXE, 1);
  player.getSkillManager().setCurrentLevel(core.Skill.MINING, 38);
  click(player, pillar(SOUTH, "arceuus_runestone_base_2"), "Chip");
  ticks(10);
  assert.equal(player.getInventory().getAmount(BLOCK), 1, "a boosted 38 chips");
  player.getSkillManager().setCurrentLevel(core.Skill.MINING, 37);
  ticks(9);
  assert.equal(player.getInventory().getAmount(BLOCK), 1);
  assert.equal(DenseRunestone._test.sessions.has(player), false);
});
