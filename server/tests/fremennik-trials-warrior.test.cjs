// Run after `yarn build`: node --test tests/fremennik-trials-warrior.test.cjs
//
// The Fremennik Trials: Thorvald the Warrior's trial, as rsprox 1002236 (rev 242, ticks
// 8254-9696) and 1001646 (rev 241, ticks 2279-2722) show it: accepting spawns nothing; the hut
// ladder (4187) takes an unarmed player to the battleground; Koschei appears next to a player who
// has stood a while; one NPC transforms through four forms with a chat line each; form 4's
// would-be killing hit is the pass (kneel, balcony, Thorvald's talk); the balcony ladder (4189).
// Real Player, session and connection, the real plugins, cache and map; ticks are World.process.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const WARRIOR = 5;
const MERCHANT = 2;
const VARP_VIKING = 347;
const THORVALD = 3896;
const FORMS = [3897, 3898, 3899, 3900];
const HUT_LADDER = { id: 4187, x: 2667, y: 3694, z: 0 };
const ARENA_LADDER = { id: 4188, x: 2672, y: 10099, z: 2 };
const BALCONY_LADDER = { id: 4189, x: 2667, y: 3694, z: 1 };
const BY_HUT_LADDER = [2666, 3694, 0];
const ENTRY = [2671, 10098, 2];
const STAND = [2664, 10093, 2];
const BALCONY = [2667, 3692, 1];
const BELOW_BALCONY = [2666, 3694, 0];
const HINT_VARBIT = 14192;
const BUSY_VARBIT = 12393;
const OVERHEADS = [
  "Prepare to die, NAME!", "I will crush your dead bones!", "Outerlander... you have made a mistake coming down here!",
  "What kind of a person calls himself NAME?", "You have no idea of my true power, outerlander!",
  "Today is the day you die, outerlander!", "NAME! Meet your doom!", "Prepare to face my power, outerlander!",
];
const FORM_LINES = {
  2: "It seems you have some idea of combat after all, outerlander! I will not hold back so much this time!",
  3: "Impressive start... But now we fight for real!",
  4: "You show some skill at combat... I will hold back no longer! This time you lose your prayer however, and fight like a warrior!",
};

let core;
let next = 5100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  await new NpcDefinitionLoader().load();
  core.RegionManager.loadMapFiles(HUT_LADDER.x, HUT_LADDER.y);
  core.RegionManager.loadMapFiles(ENTRY[0], ENTRY[1]);
  PM.emitServerStartup({});
  const forceChat = core.NPC.prototype.forceChat;
  core.NPC.prototype.forceChat = function (text) { said.push({ npc: this, text }); return forceChat.call(this, text); };
});
const said = [];
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");
const trial = (f) => (Number(f.player.getAttribute("quest.fremennik_trials.trials")) >>> (WARRIOR * 3)) & 7;

function actor(t, { at = BY_HUT_LADDER, warrior = 1, items = [], worn = [], prayer = 44 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("warr" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, messages: [], anims: [], varbits: [], graphics: [], sounds: [], configs: [], hints: [] };
  const send = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { f.messages.push({ tick: f.tick, text }); return send(text, ...rest); };
  const anim = player.performAnimation.bind(player);
  player.performAnimation = (a) => { f.anims.push({ tick: f.tick, id: a.getId?.() ?? a.id }); return anim(a); };
  const sender = player.getPacketSender();
  const wrap = (name, fn) => { const original = sender[name].bind(sender); sender[name] = (...args) => { fn(...args); return original(...args); }; };
  wrap("sendVarbit", (id, value) => f.varbits.push({ tick: f.tick, id, value }));
  wrap("sendConfig", (id, value) => f.configs.push({ tick: f.tick, id, value }));
  wrap("sendGraphic", (g, loc) => f.graphics.push({ tick: f.tick, id: g.id, x: loc.getX(), y: loc.getY() }));
  wrap("sendAreaSound", (id, x, y, z, loops, delay, radius) => f.sounds.push({ tick: f.tick, id, x, y, radius }));
  wrap("sendEntityHint", (npc) => f.hints.push({ tick: f.tick, npc }));
  wrap("clearHintArrow", () => f.hints.push({ tick: f.tick, npc: null }));
  const skills = player.getSkillManager();
  for (const [s, level] of [[core.Skill.HITPOINTS, 73], [core.Skill.PRAYER, 44], [core.Skill.ATTACK, 60], [core.Skill.DEFENCE, 60]]) {
    skills.setMaxLevel(s, level, false).setCurrentLevel(s, level, false);
  }
  skills.setCurrentLevel(core.Skill.PRAYER, prayer, false);
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    if (player.isRegistered()) core.World.getPlayers().remove(player);
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, warrior === 2 ? 3 : 2);
  player.setAttribute("quest.fremennik_trials.trials", (warrior << (WARRIOR * 3)) | (2 << (MERCHANT * 3)));
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  for (const [slot, id] of worn) player.getEquipment().setItem(slot, new core.Item(id, 1));
  tick(f);
  f.messages.length = 0;
  return f;
}

function tick(f) {
  f.tick++;
  core.World.process();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };
const atTile = (f, tile) => {
  const l = f.player.getLocation();
  return l.getX() === tile[0] && l.getY() === tile[1] && l.getZ() === tile[2];
};
const MUSIC = /^You have unlocked a new music track/;
const texts = (f) => f.messages.map((m) => m.text).filter((text) => !MUSIC.test(text));
const koschei = (f) => [...core.World.getNpcs()].find((npc) => npc && FORMS.includes(npc.getRealId?.() ?? npc.getId()) && npc.isRegistered() && npc.getOwner?.() === f.player);
const shown = (f) => {
  const current = f.player.getDialogueManager().getCurrent?.();
  return current && typeof current.getText === "function" ? current.getText() : null;
};
const busy = (f) => f.varbits.filter((v) => v.id === BUSY_VARBIT).at(-1)?.value ?? 0;
const prayer = (f) => f.player.getSkillManager().getCurrentLevel(core.Skill.PRAYER);
const hp = (f) => f.player.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS);

async function continueLine(f) {
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (231 << 16) | 4, childIndex: -1 }]);
  tick(f);
}

async function climb(f, ladder, clickType) {
  await f.connection.dispatch([{ type: "object_option", id: ladder.id, x: ladder.x, y: ladder.y, clickType }]);
  for (let i = 0; i < 6; i++) tick(f);
}

/** Into the arena and standing still until Koschei comes. */
async function untilKoschei(f) {
  f.player.moveTo(new core.Location(...STAND));
  for (let i = 0; i < 25 && !koschei(f); i++) tick(f);
  const npc = koschei(f);
  assert.ok(npc, "Koschei appears");
  return npc;
}

/** Koschei to 0 HP; returns once the new form's line is shown. */
function knockOut(f, npc) {
  npc.setHitpoints(0);
  for (let i = 0; i < 4 && !shown(f); i++) tick(f);
}

test("accepting the trial spawns nothing; the trial is started", async (t) => {
  const f = actor(t, { warrior: 0 });
  // The "Yes" choice of Thorvald's offer, as the dialogue engine emits it.
  PM.emitCustomEvent?.("npc-dialogue:choice", { player: f.player, npcId: THORVALD, option: "Yes" });
  ticks(f, 3);
  assert.equal(trial(f), 1);
  assert.equal(koschei(f), undefined);
  assert.deepEqual(texts(f), []);
});

test("the hut ladder refuses a player with a weapon or armour, with Thorvald's rule", async (t) => {
  const f = actor(t, { items: [core.ItemIdentifiers.BRONZE_DAGGER] });
  await climb(f, HUT_LADDER, 2);
  assert.ok(atTile(f, BY_HUT_LADDER) || f.player.getLocation().getZ() === 0);
  assert.equal(shown(f), "You may not enter the battleground with any armour or weaponry of any kind.");
  const worn = actor(t, { worn: [[core.Equipment.BODY_SLOT, core.ItemIdentifiers.BRONZE_PLATEBODY]] });
  await climb(worn, HUT_LADDER, 2);
  assert.equal(worn.player.getLocation().getZ(), 0);
  assert.ok(shown(worn));
  const runes = actor(t, { items: [core.ItemIdentifiers.AIR_RUNE] });
  await climb(runes, HUT_LADDER, 2);
  assert.equal(runes.player.getLocation().getZ(), 0);
});

test("unarmed (food and jewellery allowed), the ladder takes the player down; no drops in the arena", async (t) => {
  const f = actor(t, { items: [core.ItemIdentifiers.LOBSTER], worn: [[core.Equipment.RING_SLOT, core.ItemIdentifiers.RING_OF_RECOIL]] });
  await f.connection.dispatch([{ type: "object_option", id: HUT_LADDER.id, x: HUT_LADDER.x, y: HUT_LADDER.y, clickType: 2 }]);
  for (let i = 0; i < 6 && !atTile(f, ENTRY); i++) tick(f);
  assert.ok(atTile(f, ENTRY), `at ${f.player.getLocation()}`);
  const moved = f.tick;
  assert.ok(f.anims.some((a) => a.id === 828 && a.tick === moved), JSON.stringify({ moved, anims: f.anims }));
  ticks(f, 3);
  assert.deepEqual(f.messages.filter((m) => m.text.startsWith("Explore")), [{ tick: moved + 3, text: "Explore this battleground and find your foe..." }]);
  assert.equal(koschei(f), undefined, "nobody yet");
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.LOBSTER);
  const handled = PM.emitItemDropPolicy({ player: f.player, interfaceId: 149, item: f.player.getInventory().forSlot(slot), itemId: core.ItemIdentifiers.LOBSTER, slot, dropToGround: true, handled: false });
  assert.equal(handled, true);
  assert.ok(texts(f).includes("You cannot drop items in this area."));
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.LOBSTER), 1);
});

test("Koschei appears next to a player who has stood a while, owner-only, with smoke, sound and hint", async (t) => {
  const f = actor(t, { at: ENTRY });
  f.player.moveTo(new core.Location(...STAND));
  tick(f);
  const stopped = f.tick;
  let npc;
  for (let i = 0; i < 25 && !(npc = koschei(f)); i++) tick(f);
  assert.ok(npc);
  const after = f.tick - stopped;
  assert.ok(after >= 9 && after <= 16, `came ${after} ticks after stopping`);
  assert.equal(npc.getId(), FORMS[0]);
  assert.equal(npc.isOwnerOnly(), true);
  const dx = Math.abs(npc.getLocation().getX() - STAND[0]);
  const dy = Math.abs(npc.getLocation().getY() - STAND[1]);
  assert.ok(Math.max(dx, dy) === 1, "on a tile next to the player");
  const name = f.player.getDisplayName?.() ?? f.player.getUsername();
  const overhead = said.filter((entry) => entry.npc === npc).map((entry) => entry.text);
  assert.equal(overhead.length, 1);
  assert.ok(OVERHEADS.map((line) => line.replace("NAME", name)).includes(overhead[0]), overhead[0]);
  assert.deepEqual(f.graphics.map(({ id, x, y }) => ({ id, x, y })), [{ id: 86, x: npc.getLocation().getX(), y: npc.getLocation().getY() }]);
  assert.deepEqual(f.sounds.map(({ id, radius }) => ({ id, radius })), [{ id: 1930, radius: 10 }]);
  assert.ok(f.varbits.some((v) => v.id === HINT_VARBIT && v.value === 7));
  assert.equal(f.hints.at(-1).npc, npc);
  // He attacks first.
  ticks(f, 4);
  assert.equal(npc.getCombat().getTarget?.(), f.player);
});

test("one NPC transforms through the forms with each form's line; form 4 takes the prayer", async (t) => {
  const f = actor(t, { at: ENTRY });
  const npc = await untilKoschei(f);
  for (const form of [2, 3, 4]) {
    const before = f.tick;
    knockOut(f, npc);
    assert.equal(koschei(f), npc, "the same NPC");
    assert.equal(npc.getId(), FORMS[form - 1]);
    assert.equal(npc.getHitpoints(), [0, 30, 50, 70, 255][form]);
    assert.equal(shown(f), FORM_LINES[form] && shown(f));
    assert.equal(shown(f).replace(/<br>/g, " "), FORM_LINES[form]);
    assert.equal(busy(f), 1, "the player is busy");
    assert.ok(f.tick - before <= 3);
    if (form === 4) assert.equal(prayer(f), 0, "prayer drained with the line");
    else assert.equal(prayer(f), 44);
    await continueLine(f);
    assert.equal(shown(f), null);
    assert.equal(busy(f), 0);
  }
  // Form 4 fights with its own definition: 1-tick attacks, max hit 1.
  assert.equal(npc.getBaseAttackSpeed(), 1);
  assert.equal(npc.getCurrentDefinition().getMaxHit(), 1);
  const swings = [];
  const animate = npc.performAnimation.bind(npc);
  npc.performAnimation = (a) => { swings.push(f.tick); return animate(a); };
  f.player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 30, true);
  tick(f);
  assert.equal(prayer(f), 0, "kept at 0 through form 4");
  ticks(f, 10);
  assert.ok(swings.length >= 9, `form 4 swings every tick: ${swings}`);
  assert.ok(hp(f) >= 73 - 11, "for at most 1 a hit");
});

test("form 4 without prayer says only its first sentence", async (t) => {
  const f = actor(t, { at: ENTRY, prayer: 0 });
  const npc = await untilKoschei(f);
  knockOut(f, npc); await continueLine(f);
  knockOut(f, npc); await continueLine(f);
  knockOut(f, npc);
  assert.equal(shown(f).replace(/<br>/g, " "), "You show some skill at combat... I will hold back no longer!");
});

test("form 4's would-be killing hit is the pass: kneel, balcony, Thorvald's talk, then the balcony ladder", async (t) => {
  const f = actor(t, { at: ENTRY });
  const npc = await untilKoschei(f);
  for (let i = 0; i < 3; i++) { knockOut(f, npc); await continueLine(f); }
  assert.equal(npc.getId(), FORMS[3]);
  f.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 1, true);
  let hit;
  for (let i = 0; i < 60 && trial(f) !== 2; i++) tick(f);
  hit = f.tick;
  assert.equal(trial(f), 2, "passed on the hit");
  assert.equal(hp(f), 1, "no damage");
  assert.equal(quest().getStage(f.player), 3, "viking +1 on the hit's tick");
  assert.equal(busy(f), 1);
  ticks(f, 11);
  assert.ok(f.anims.some((a) => a.id === 1331 && a.tick === hit + 2), JSON.stringify(f.anims));
  assert.deepEqual(f.messages.filter((m) => m.tick === hit + 6 && !MUSIC.test(m.text)).map((m) => m.text), ["Oh dear you are..."]);
  assert.equal(koschei(f), undefined, "Koschei gone");
  assert.ok(f.varbits.some((v) => v.id === HINT_VARBIT && v.value === 0 && v.tick === hit + 6));
  assert.deepEqual(f.messages.filter((m) => m.tick === hit + 11 && !MUSIC.test(m.text)).map((m) => m.text),
    ["...still alive somehow?", "Congratulations! You have passed the warrior's trial!"]);
  assert.ok(atTile(f, BALCONY));
  assert.equal(hp(f), 73);
  assert.equal(prayer(f), 44);
  assert.ok(f.anims.some((a) => a.id === 1332 && a.tick === hit + 11));
  assert.equal(shown(f).replace(/<br>/g, " "), "Hahaha! Well fought outerlander! Now come down from there, you have passed my trial with flying colours!");
  await continueLine(f);
  assert.equal(shown(f).replace(/<br>/g, " "), "But... I don't understand... I did not manage to beat Koschei...");
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (217 << 16) | 4, childIndex: -1 }]);
  tick(f);
  assert.equal(shown(f).replace(/<br>/g, " "), "I would be honoured to represent you to the council as worthy of being a Fremennik after watching that superb battle!");
  await continueLine(f);
  assert.equal(shown(f), null);
  await f.connection.dispatch([{ type: "object_option", id: BALCONY_LADDER.id, x: BALCONY_LADDER.x, y: BALCONY_LADDER.y, clickType: 1 }]);
  for (let i = 0; i < 6 && !atTile(f, BELOW_BALCONY); i++) tick(f);
  assert.ok(atTile(f, BELOW_BALCONY), `at ${f.player.getLocation()}`);
  // Down the hut ladder again: the player's own line, and no arena.
  await climb(f, HUT_LADDER, 2);
  assert.equal(f.player.getLocation().getZ(), 0);
  assert.equal(shown(f), "I'd really rather not go back down there again, now that I have Thorvald's vote at the council of elders.");
});

test("after passing, Thorvald answers with b1Fki8", async (t) => {
  const f = actor(t, { warrior: 2 });
  PM.emitCustomEvent?.("npc-dialogue:start", { player: f.player, npcId: THORVALD });
  tick(f);
  assert.equal(shown(f), "So can I count on your vote at the council of elders now Thorvald?");
});

test("a relog mid-fight removes Koschei and he comes back, in form 1", async (t) => {
  const f = actor(t, { at: ENTRY });
  const npc = await untilKoschei(f);
  knockOut(f, npc); await continueLine(f);
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  tick(f);
  assert.equal(npc.isRegistered(), false);
  assert.equal(trial(f), 1, "still started");
  const again = await untilKoschei(f);
  assert.notEqual(again, npc);
  assert.equal(again.getId(), FORMS[0]);
});

test("the arena ladder leaves: the fight resets, the trial can be retried", async (t) => {
  const f = actor(t, { at: ENTRY });
  const npc = await untilKoschei(f);
  f.player.moveTo(new core.Location(2671, 10098, 2));
  tick(f);
  await climb(f, ARENA_LADDER, 1);
  assert.ok(atTile(f, BELOW_BALCONY), `at ${f.player.getLocation()}`);
  assert.equal(npc.isRegistered(), false);
  assert.equal(trial(f), 1);
});

test("a death in forms 1-3 is safe: no item lost, outside, retryable", async (t) => {
  const f = actor(t, { at: ENTRY, items: [core.ItemIdentifiers.LOBSTER] });
  const npc = await untilKoschei(f);
  f.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 0, true);
  f.player.appendDeath();
  tick(f);
  assert.equal(npc.isRegistered(), false);
  assert.ok(atTile(f, BELOW_BALCONY));
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.LOBSTER), 1);
  assert.equal(hp(f), 73);
  assert.equal(trial(f), 1);
});

test("killing form 4 (Wiki) gives the Fremennik blade and passes", async (t) => {
  const f = actor(t, { at: ENTRY });
  const npc = await untilKoschei(f);
  for (let i = 0; i < 3; i++) { knockOut(f, npc); await continueLine(f); }
  npc.setHitpoints(0);
  tick(f);
  assert.equal(npc.isRegistered(), false);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.FREMENNIK_BLADE), 1);
  assert.equal(trial(f), 2);
  assert.ok(texts(f).includes("Congratulations! you have completed the warriors trial!"));
});

test("ten minutes in form 3 (Wiki, data ppj2xU): Koschei leaves and the fight starts over", async (t) => {
  const f = actor(t, { at: ENTRY });
  const npc = await untilKoschei(f);
  for (let i = 0; i < 2; i++) { knockOut(f, npc); await continueLine(f); }
  assert.equal(npc.getId(), FORMS[2]);
  // Nobody wins: the player only stands there.
  f.player.setAutoRetaliate(false);
  f.player.getCombat().reset();
  for (let i = 0; i < 1005 && npc.isRegistered(); i++) {
    f.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 73, false);
    tick(f);
  }
  assert.equal(npc.isRegistered(), false, JSON.stringify({ at: String(f.player.getLocation()), hp: hp(f), id: npc.getId(), msgs: texts(f), shown: shown(f) }));
  assert.deepEqual(texts(f).slice(-2), ["You have failed to impress Koschei. He has left in disgust.",
    "You will need to improve your combat skills before challenging him again."]);
  assert.equal(trial(f), 1);
  assert.equal(f.hints.at(-1).npc, null);
});
