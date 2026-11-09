// Mage Arena II's Enchanted symbol and followers (issue #3701). Run after `yarn build`:
// node --test tests/mage-arena-ii.test.cjs
// Every plugin is loaded through the real PluginManager; real Players, NPCs, hits and tasks. Only the network is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");

const core = PluginManager.getCoreApi();
const Items = core.ItemIdentifiers;
let MageArenaII;
let symbol;
let followers;
const WILDERNESS = [3200, 3880];
const BANK = [2539, 4712];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  await PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  MageArenaII = require("../plugins/minigames/magearena/MageArenaII.MageArena");
  ({ symbol, followers } = require("../plugins/minigames/MageArena.plugin")._test);
});

afterEach(() => {
  for (const [npc, state] of [...followers.active]) followers.dismiss(npc, state);
});

function makePlayer({ at = WILDERNESS, stage = MageArenaII.STAGE.HUNTING, components = 0, inventory = [Items.ENCHANTED_SYMBOL] } = {}) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true });
  player.setUsername("ma2 tester");
  player.setRegistered(true);
  player.messages = [];
  const send = player.sendMessage.bind(player);
  player.sendMessage = (message) => { player.messages.push(message); return send(message); };
  player.setLocation(new core.Location(at[0], at[1], 0));
  MageArenaII.setStage(player, stage);
  MageArenaII.setComponents(player, components);
  for (const id of inventory) player.getInventory().adds(id, 1);
  return player;
}

function activate(player) {
  return symbol.activate({ player, itemId: Items.ENCHANTED_SYMBOL });
}

function menu(player) {
  const current = player.getDialogueManager().getCurrent();
  return current instanceof OptionDialogue ? current.getOptions() : null;
}

function pick(player, option) {
  const options = menu(player);
  player.getDialogueManager().handleOption(options.indexOf(option) + 1);
}

/** The Wiki point (3215, 3883), open ground where a live-server Justiciar appeared. */
const OPEN_POINT = 5;

/** Gives the follower a spawn tile at OPEN_POINT and stands the player `distance` tiles south of it. */
function placeFollower(player, key, distance) {
  symbol.rotate(player);
  const spawn = require("../plugins/minigames/magearena/Followers.MageArena").spawnTile(symbol.SPAWN_POINTS[OPEN_POINT], () => 0.5);
  const at = [spawn.getX(), spawn.getY()];
  player.getAttribute(symbol.LOCATIONS_ATTRIBUTE)[key] = { point: OPEN_POINT, tile: at };
  player.setLocation(new core.Location(at[0], at[1] - distance, 0));
  return at;
}

const pendingDamage = (player) => player.getCombat().getHitQueue().pendingDamage.map((hit) => hit.getDamage());
const ownFollower = (player, key) => [...followers.active].find(([, state]) => state.player === player && state.follower.key === key);

test("the symbol only works in the Wilderness above ground", () => {
  const player = makePlayer({ at: BANK });
  assert.equal(activate(player), true);
  assert.deepEqual(player.messages, ["The symbol doesn't seem to work here, I should try using it in the Wilderness."]);
  assert.equal(pendingDamage(player).length, 0);
});

test("it lists the followers still to find, and each reading hurts 8 to 16", () => {
  const player = makePlayer();
  activate(player);
  assert.deepEqual(menu(player), ["Saradomin", "Guthix", "Zamorak", "Cancel"]);
  assert.equal(player.getDialogueManager().getCurrent().getTitle(), "Select an option");
  pick(player, "Guthix");
  assert.match(player.messages[0], /^The enchanted symbol is (ice cold|very cold|cold|warm|hot|very hot|incredibly hot|visibly shaking and burns to the touch)\.$/);
  assert.equal(player.messages[1], "The power of the enchanted symbol hurts you in the process.");
  const [damage] = pendingDamage(player);
  assert.ok(damage >= symbol.MIN_DAMAGE && damage <= symbol.MAX_DAMAGE, `8-16 (${damage})`);
  const rolls = [0, 0.999].map((r) => {
    const p = makePlayer();
    placeFollower(p, "guthix", 300);
    symbol.locate(p, MageArenaII.followerByKey("guthix"), () => r);
    return pendingDamage(p)[0];
  });
  assert.deepEqual(rolls, [8, 16]);
});

test("Cancel reads nothing and doesn't hurt", () => {
  const player = makePlayer();
  activate(player);
  pick(player, "Cancel");
  assert.equal(player.messages.length, 0);
  assert.equal(pendingDamage(player).length, 0);
});

test("handed-in and carried remains drop out of the list; one left needs no menu", () => {
  const player = makePlayer({ components: 1, inventory: [Items.ENCHANTED_SYMBOL, Items.ENTS_ROOTS] });
  activate(player);
  assert.equal(menu(player), null);
  assert.match(player.messages[0], /^The enchanted symbol is /);
  const after = makePlayer({ stage: MageArenaII.STAGE.COMPLETE, components: 1, inventory: [Items.ENCHANTED_SYMBOL, Items.DEMONS_HEART] });
  activate(after);
  assert.deepEqual(menu(after), ["Saradomin", "Guthix", "Cancel"], "after the miniquest all are tracked again but carried ones");
});

test("with every remains handed in it reads nothing and doesn't hurt", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.ALL_REMAINS, components: 7 });
  activate(player);
  assert.deepEqual(player.messages, []);
  assert.equal(pendingDamage(player).length, 0);
});

test("readings use the strange device's bands, and compare with the last one", () => {
  const player = makePlayer({ components: 3 });
  placeFollower(player, "zamorak", 120);
  activate(player);
  assert.equal(player.messages[0], "The enchanted symbol is warm.");
  const at = player.getLocation();
  player.setLocation(new core.Location(at.getX(), at.getY() + 60, 0));
  activate(player);
  assert.equal(player.messages[2], "The enchanted symbol is very hot, and warmer than last time.");
  activate(player);
  assert.equal(player.messages[4], "The enchanted symbol is very hot, and the same temperature as last time.");
  assert.deepEqual([14, 15, 29, 30, 69, 70, 99, 100, 149, 150, 199, 200, 499, 500].map(symbol.temperature), [
    "visibly shaking and burns to the touch", "incredibly hot", "incredibly hot", "very hot", "very hot", "hot", "hot",
    "warm", "warm", "cold", "cold", "very cold", "very cold", "ice cold",
  ]);
});

test("each rotation gives every follower its own point and a spawn tile within 5 of it", () => {
  const player = makePlayer();
  symbol.rotate(player);
  const points = MageArenaII.getFollowers().map((follower) => symbol.locationOf(player, follower));
  assert.equal(new Set(points.map((l) => l.point)).size, 3);
  for (const { point, tile } of points) {
    const [px, py] = symbol.SPAWN_POINTS[point];
    assert.ok((tile[0] - px) ** 2 + (tile[1] - py) ** 2 <= 25, `${tile} within 5 of ${px},${py}`);
  }
});

test("once the locations rotate the next use only says so, then asks", () => {
  const player = makePlayer();
  symbol.rotate(player);
  player.setAttribute(symbol.TIMER_ATTRIBUTE, 0);
  activate(player);
  assert.deepEqual(player.messages, [symbol.MESSAGES.moved]);
  assert.equal(pendingDamage(player).length, 0);
  assert.equal(String(player.getDialogueManager().getCurrent().getText()).replace(/\s+/g, " "), symbol.MESSAGES.moved);
  player.getDialogueManager().advance();
  assert.deepEqual(menu(player), ["Saradomin", "Guthix", "Zamorak", "Cancel"]);
  assert.equal(symbol.timerOf(player), symbol.TIMER_START);
});

test("the location timer steps every 18 ticks, only in the Wilderness", () => {
  const player = makePlayer();
  symbol.rotate(player);
  assert.equal(symbol.TIMER_STEP_TICKS * symbol.TIMER_START * 0.6, 45 * 60, "the Wiki's 45 minutes");
  for (let i = 1; i < symbol.TIMER_STEP_TICKS; i++) core.TaskManager.process();
  assert.equal(symbol.timerOf(player), symbol.TIMER_START, "not a step before 18 ticks");
  core.TaskManager.process();
  assert.equal(symbol.timerOf(player), symbol.TIMER_START - 1);
  player.setLocation(new core.Location(...BANK, 0));
  for (let i = 0; i < 2 * symbol.TIMER_STEP_TICKS; i++) core.TaskManager.process();
  assert.equal(symbol.timerOf(player), symbol.TIMER_START - 1);
});

test("at visibly shaking the follower appears at its own spawn tile, once, through its spawning form", () => {
  const player = makePlayer({ components: 6 });
  const tile = placeFollower(player, "saradomin", 12);
  activate(player);
  assert.equal(player.messages[0], "The enchanted symbol is visibly shaking and burns to the touch.");
  const [npc] = ownFollower(player, "saradomin");
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], tile, "12 tiles off, as live (11-16)");
  assert.equal(npc.getRealId(), core.NpcIdentifiers.JUSTICIAR_ZACHARIAH_2);
  assert.equal(npc.getId(), core.NpcIdentifiers.JUSTICIAR_ZACHARIAH, "his spawning form first");
  activate(player);
  assert.match(player.messages[2], /^The enchanted symbol is visibly shaking and burns to the touch, and the same temperature as last time\.$/);
  assert.equal([...followers.active].filter(([, s]) => s.player === player).length, 1, "no second one");
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(npc.getId(), core.NpcIdentifiers.JUSTICIAR_ZACHARIAH_2, "then himself, two ticks on (235/03344)");
});

test("only Derwen attacks as he arrives (Wiki: the other two aren't aggressive)", () => {
  const arrive = (key, components) => {
    const player = makePlayer({ components });
    placeFollower(player, key, 2);
    activate(player);
    for (let i = 0; i < 4; i++) core.TaskManager.process();
    const [npc, state] = ownFollower(player, key);
    const target = npc.getCombat().getTarget();
    followers.dismiss(npc, state);
    return target === player;
  };
  assert.equal(arrive("saradomin", 6), false);
  assert.equal(arrive("zamorak", 3), false);
  assert.equal(arrive("guthix", 5), true);
});

test("a follower leaves with its owner", () => {
  const player = makePlayer({ components: 3 });
  placeFollower(player, "zamorak", 1);
  activate(player);
  const [npc] = ownFollower(player, "zamorak");
  PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
  assert.equal(followers.stateOf(npc), null);
  assert.equal(npc.isRegistered(), false);
});

test("only a follower's own god spell hurts it", () => {
  const player = makePlayer({ components: 6 });
  placeFollower(player, "saradomin", 2);
  activate(player);
  const [npc] = ownFollower(player, "saradomin");
  const method = new core.MagicCombatMethod();
  const strike = new core.PendingHit(player, npc, method, 1).setSpell(core.CombatSpells.SARADOMIN_STRIKE.getSpell());
  const claws = new core.PendingHit(player, npc, method, 1).setSpell(core.CombatSpells.CLAWS_OF_GUTHIX.getSpell());
  const melee = new core.PendingHit(player, npc, new core.MeleeCombatMethod(), 1);
  for (const hit of [strike, claws, melee]) hit.setTotalDamage(20);
  for (const hit of [strike, claws, melee]) PluginManager.emitNpcHitModify(npc, hit);
  assert.equal(strike.getTotalDamage(), 20);
  assert.equal(claws.getTotalDamage(), 0);
  assert.equal(melee.getTotalDamage(), 0);
});

test("a follower only casts its god spell, up to its Wiki max, every 6 ticks", () => {
  const player = makePlayer({ components: 6 });
  player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99, false).setCurrentLevel(core.Skill.HITPOINTS, 99, false);
  placeFollower(player, "saradomin", 1);
  activate(player);
  const [npc] = ownFollower(player, "saradomin");
  const Method = followers.createCombatMethod();
  let landed = 0;
  for (let i = 0; i < 40; i++) {
    const method = new Method();
    method.start(npc, player);
    assert.equal(method.type(), core.CombatType.MAGIC);
    const [hit] = method.hits(npc, player);
    assert.ok(hit.getTotalDamage() <= 26);
    if (hit.isAccurate()) landed++;
  }
  assert.ok(landed > 0, "some casts land");
  assert.equal(new Method().attackSpeed(npc), 6);
});

test("Derwen's 2nd attack and every 6th after summon an energy ball between him and the player", () => {
  const player = makePlayer({ components: 5 });
  placeFollower(player, "guthix", 6);
  activate(player);
  const [npc, state] = ownFollower(player, "guthix");
  const summons = [];
  for (let attack = 1; attack <= 14; attack++) {
    if (followers.chooseAttack(npc, player, state) === null) summons.push(attack);
  }
  assert.deepEqual(summons, [2, 8, 14], "as live: t5836 and t5872 of a fight from t5830");
  for (let i = 0; i < 6; i++) core.TaskManager.process();
  assert.ok(state.healers.size >= 1, "a ball appears as the projectile lands");
  const [ball] = state.healers;
  const from = player.getLocation();
  const off = Math.max(Math.abs(ball.getLocation().getX() - from.getX()), Math.abs(ball.getLocation().getY() - from.getY()));
  assert.ok(off >= 2 && off <= 4, `2-4 tiles from the player (${off})`);
  assert.equal(ball.getRealId(), core.NpcIdentifiers.COL_FF9040_ENERGY_BALL_COL);
  followers.dismiss(npc, state);
  assert.equal(ball.isRegistered(), false, "its balls go with it");
});

test("remains drop for an owner without them, announced as untradeable", () => {
  const player = makePlayer({ components: 6 });
  placeFollower(player, "saradomin", 2);
  activate(player);
  const [npc] = ownFollower(player, "saradomin");
  const drops = [{ itemId: Items.JUSTICIARS_HAND, amount: 1 }];
  PluginManager.emitCustomEvent("npc-drops:roll", { player, npc, npcId: npc.getRealId(), drops, damagers: [player] });
  assert.equal(drops.length, 1);
  assert.ok(player.messages.includes("<col=ef1020>Untradeable drop: Justiciar's hand</col>"));
  player.getInventory().adds(Items.JUSTICIARS_HAND, 1);
  const again = [{ itemId: Items.JUSTICIARS_HAND, amount: 1 }];
  PluginManager.emitCustomEvent("npc-drops:roll", { player, npc, npcId: npc.getRealId(), drops: again, damagers: [player] });
  assert.equal(again.length, 0, "no second hand while one is carried");
});

test("its real death drops the remains for the killer, gated while one is carried", () => {
  const player = makePlayer({ components: 6 });
  placeFollower(player, "saradomin", 2);
  activate(player);
  const [npc] = ownFollower(player, "saradomin");
  const at = npc.getLocation();
  const death = () => PluginManager.emitNpcDeath({ killer: player, damagers: [player], npc, npcId: npc.getRealId(),
    location: { x: at.getX(), y: at.getY(), z: at.getZ() }, remains: null });
  death();
  assert.ok(player.messages.includes("<col=ef1020>Untradeable drop: Justiciar's hand</col>"), "the drop rolled with the follower still known");
  player.messages.length = 0;
  player.getInventory().adds(Items.JUSTICIARS_HAND, 1);
  death();
  assert.equal(player.messages.some((m) => /Untradeable drop/.test(m)), false, "no second hand while one is carried");
  core.TaskManager.process();
  assert.equal(followers.stateOf(npc), null, "forgotten a tick later");
  PluginManager.removeNpc(npc); // what the death task does; it doesn't run here
});

test("remains can't be banked (silently) and are always lost on death; the symbol can be", () => {
  const player = makePlayer();
  for (const id of [Items.JUSTICIARS_HAND, Items.ENTS_ROOTS, Items.DEMONS_HEART]) {
    assert.equal(PluginManager.emitCanBankItem(player, new core.Item(id, 1)), false);
    assert.equal(PluginManager.emitShouldKeepItemOnDeath(player, new core.Item(id, 1)), false);
  }
  assert.deepEqual(player.messages, []);
  assert.notEqual(PluginManager.emitCanBankItem(player, new core.Item(Items.ENCHANTED_SYMBOL, 1)), false);
});

test("Derwen's and Porazdir's spells drain 1 + 5%, as live (197 to 187, 195 to 185)", () => {
  const player = makePlayer();
  player.getSkillManager().setMaxLevel(core.Skill.DEFENCE, 99, false).setCurrentLevel(core.Skill.DEFENCE, 197, false);
  followers.drain(player, "DEFENCE");
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.DEFENCE), 187);
  player.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99, false).setCurrentLevel(core.Skill.MAGIC, 195, false);
  followers.drain(player, "MAGIC");
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.MAGIC), 185);
});

test("destroying the symbol or remains warns as the Wiki words it", () => {
  const prompt = { item: new core.Item(Items.ENCHANTED_SYMBOL, 1), warning: "" };
  PluginManager.emitCustomEvent("destroy-item:prompt", prompt);
  assert.equal(prompt.warning, "Kolodion will offer you a replacement at the Mage Arena bank.");
  const roots = { item: new core.Item(Items.ENTS_ROOTS, 1), warning: "" };
  PluginManager.emitCustomEvent("destroy-item:prompt", roots);
  assert.equal(roots.warning, "You will have to locate and defeat the Guthixian Ent again.");
});
