// Run after `yarn build`: node --test tests/in-aid-of-the-myreque-tithe.test.cjs
//
// In Aid of the Myreque, stages 210-280 (the Tithe unit) against the live capture (revision 242, the
// user's recording; ticks in docs/quests/in-aid-of-the-myreque): lighting the furnace, the Castle
// Drakan scene, the blood-tithe chats, the store fight in its copy, the wounded Gadderanks, the
// Gadderhammer and store Veliaf. Real plugins, real Players and NPCs, the real dialogue runtime and
// tasks; clicks go through PluginManager's own emitters. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { STAGE, VARBIT, impliedVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/inaid/State.InAidOfTheMyreque");

const STAGE_ATTRIBUTE = "quest.in_aid_of_the_myreque.stage";
const TINDERBOX = 590, GADDERHAMMER = 7668, COINS = 995;
const MESBOX = 229, OBJECTBOX = 193;
let core;
let next = 6100;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[3514, 3240], [3527, 3209], [3553, 3337], [3572, 3331]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});

function actor(t, stage, x, y, extra = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("iaotm" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  const varbits = new Map(), sounds = [], chatboxes = [], items = [], messages = [];
  const sender = player.getPacketSender();
  const wrap = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  wrap("sendVarbit", (id, value) => varbits.set(id, value));
  wrap("sendSound", (id) => sounds.push(id));
  wrap("sendChatboxInterface", (id) => chatboxes.push(id));
  wrap("sendItemOnInterfaces", (uid, item) => items.push(item));
  const anims = [];
  const perform = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { anims.push(animation.getId()); return perform(animation); };
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = (text) => { messages.push(String(text)); return sendMessage(text); };
  player.setAttribute(SAVE_VERSION_ATTRIBUTE, 2);
  player.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(stage), ...extra });
  player.setAttribute(STAGE_ATTRIBUTE, stage);
  for (const [id, value] of Object.entries(player.getAttribute(VARS_ATTRIBUTE))) sender.sendVarbit(Number(id), value);
  players.push(player);
  const npcs = [];
  t.after(() => {
    player.getDialogueManager().reset?.();
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    players.splice(players.indexOf(player), 1);
    for (const npc of npcs) if (npc?.isRegistered?.()) PM.removeNpc(npc);
  });
  const spawn = (id, nx, ny) => {
    const npc = PM.spawnNpc({ id, x: nx, y: ny, z: 0, wanderRadius: 0 }, "InAidTitheTest");
    npcs.push(npc);
    return npc;
  };
  return { player, varbits, sounds, chatboxes, items, messages, anims, spawn };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

const stageOf = (player) => player.getAttribute(STAGE_ATTRIBUTE);
const saved = (player, id) => Number(player.getAttribute(VARS_ATTRIBUTE)?.[id]) || 0;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const current = (player) => player.getDialogueManager().getCurrent();
const text = (player) => current(player)?.getText?.() ?? null;
const head = (player) => current(player)?.getNpcId?.() ?? null;
const cont = (player) => player.getDialogueManager().advance();
/** A held box (no continue): the runtime's self-advancing entry is what the dialogue manager shows. */
const held = (player) => current(player)?.isSelfAdvancing?.() === true;
function continueUntilHeld(player, limit = 40) {
  for (let i = 0; i < limit && !held(player); i++) cont(player);
  return held(player);
}
function continueUntil(player, predicate, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if (predicate(text(player) ?? "")) return true;
    cont(player);
  }
  return predicate(text(player) ?? "");
}
function talk(player, npc) {
  const npcId = npc.getContentId(player);
  return PM.emitNpcInteraction({ player, npc, npcId, npcIndex: npc.getIndex(), clickType: 1,
    location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: 0 }, handled: false });
}
function tinderboxOnFurnace(player) {
  const definition = core.ObjectDefinition.forPlayer(12805, player);
  return PM.emitItemOnObject({ player, object: { getId: () => 12805, getLocation: () => new core.Location(3527, 3209, 0) },
    definition, objectId: 12805, item: new core.Item(TINDERBOX, 1), itemId: TINDERBOX, itemSlot: 0, interfaceType: 149,
    location: { x: 3527, y: 3209, z: 0 }, handled: false });
}

/** Opens the store fight the way live does: the third chat, then the copy and the reprise of the challenge. */
function intoFight(t, extraVars = {}) {
  const f = actor(t, STAGE.GADDERANKS, 3514, 3240, { [VARBIT.GADDERANKS_CHAT]: 1, [VARBIT.JUVINATE_CHAT]: 1, ...extraVars });
  const wiskit = f.spawn(4479, 3515, 3242);
  assert.equal(talk(f.player, wiskit), true);
  assert.ok(continueUntil(f.player, (line) => line.startsWith("They're draining")));
  cont(f.player);
  tick(5);
  assert.equal(stageOf(f.player), STAGE.FIGHT);
  return f;
}

function fightNpcs(player) {
  return Array.from(PM.getCoreApi().World.getNpcs()).filter((npc) => npc?.isRegistered?.() && npc.getOwner?.() === player);
}
const byId = (player, id) => fightNpcs(player).find((npc) => npc.getContentId(player) === id);

test("the tinderbox on the fuelled furnace: held item box, fire anim, lit five ticks on, then the castle copy", (t) => {
  const { player, varbits, sounds, chatboxes, items, anims } = actor(t, STAGE.FURNACE_FIXED, 3526, 3209, { [VARBIT.FURNACE]: 2 });
  player.getInventory().adds(TINDERBOX, 1);
  assert.equal(tinderboxOnFurnace(player), true);
  assert.equal(chatboxes.at(-1), OBJECTBOX, "an objectbox (t2202)");
  assert.equal(items.at(-1), TINDERBOX);
  assert.ok(held(player), "no continue button");
  assert.deepEqual(anims, [733], "human_createfire");
  tick(4);
  assert.equal(stageOf(player), STAGE.FURNACE_FIXED, "not lit before the fifth tick");
  tick(1);
  assert.equal(stageOf(player), STAGE.FURNACE_LIT, "220 (t2207)");
  assert.equal(varbits.get(VARBIT.FURNACE), 3);
  assert.ok(sounds.includes(2596), "fire_lit");
  tick(3);
  assert.notDeepEqual(at(player), [3526, 3209], "in the castle copy (t2210)");
  assert.equal(varbits.get(542), 1, "cutscene_status");
  const cast = fightNpcs(player).map((npc) => npc.getId()).sort();
  assert.deepEqual(cast, [9632, 9635], "Vanstrom and the scene's Gadderanks");
  tick(6);
  assert.equal(text(player), "Gadderanks.", "Vanstrom's first line (t2216)");
  assert.equal(head(player), 9632);
});

test("the furnace is only lit fuelled at 210", (t) => {
  const { player } = actor(t, STAGE.FURNACE_FIXED, 3526, 3209, { [VARBIT.FURNACE]: 1 });
  player.getInventory().adds(TINDERBOX, 1);
  tinderboxOnFurnace(player);
  tick(6);
  assert.equal(stageOf(player), STAGE.FURNACE_FIXED);
  assert.equal(saved(player, VARBIT.FURNACE), 1);
});

test("the castle scene: 230 and the tithe cast on Vanstrom's last line, back by the furnace, Gabriela, aggression", (t) => {
  const { player, varbits } = actor(t, STAGE.FURNACE_FIXED, 3526, 3209, { [VARBIT.FURNACE]: 2 });
  player.getInventory().adds(TINDERBOX, 1);
  tinderboxOnFurnace(player);
  tick(14);
  assert.ok(continueUntil(player, (line) => line.startsWith("No. Burgh de Rott was abandoned")));
  assert.equal(stageOf(player), STAGE.FURNACE_LIT, "still 220 a line before");
  cont(player);
  assert.ok(text(player).startsWith("It seems you have a fresh appointment"));
  assert.equal(stageOf(player), STAGE.GADDERANKS, "230 as the line shows (t2270)");
  assert.equal(varbits.get(VARBIT.BLOOD_TITHE), 1);
  cont(player);
  tick(2);
  assert.deepEqual(at(player), [3526, 3209], "back on the map (t2276)");
  assert.equal(varbits.get(542), 0);
  tick(3);
  assert.equal(text(player), "It's Gadderanks! He's found us!");
  assert.equal(head(player), 4461, "Gabriela's head (t2279)");
  assert.notEqual(varbits.get(VARBIT.VAMPYRE_AGGRESSION), 1);
  cont(player);
  assert.equal(varbits.get(VARBIT.VAMPYRE_AGGRESSION), 1, "t2282");
});

test("the tithe chats set 1995/1997 on their last line; talking again plays the repeat", (t) => {
  const { player, varbits, spawn } = actor(t, STAGE.GADDERANKS, 3514, 3240);
  const gadderanks = spawn(6218, 3515, 3241);
  assert.equal(gadderanks.getContentId(player), 4483, "the multinpc shows Gadderanks at 1981=1");
  assert.equal(talk(player, gadderanks), true);
  assert.equal(text(player), "What's going on here?");
  assert.ok(continueUntil(player, (line) => line === "Ha! We'll see about that!"));
  assert.equal(varbits.get(VARBIT.GADDERANKS_CHAT), undefined);
  cont(player);
  assert.equal(varbits.get(VARBIT.GADDERANKS_CHAT), 1, "t2328");
  talk(player, gadderanks);
  assert.ok(continueUntil(player, (line) => line.startsWith("Do I need to explain")));
  player.getDialogueManager().reset();
  const juvinate = spawn(6217, 3513, 3242);
  assert.equal(juvinate.getContentId(player), 4482, "the tithe juvinate (not 3695)");
  talk(player, juvinate);
  assert.ok(continueUntil(player, (line) => line.startsWith("We're getting some delicious")));
  cont(player);
  assert.equal(varbits.get(VARBIT.JUVINATE_CHAT), 1, "t2338");
  assert.equal(stageOf(player), STAGE.GADDERANKS, "two chats do not start the fight");
});

test("the third chat chains into the challenge, the copy four ticks on and 240 with the line again", (t) => {
  const { player, varbits, spawn } = actor(t, STAGE.GADDERANKS, 3514, 3240, { [VARBIT.GADDERANKS_CHAT]: 1, [VARBIT.JUVINATE_CHAT]: 1 });
  const wiskit = spawn(4479, 3515, 3242);
  assert.equal(wiskit.getContentId(player), 4480);
  talk(player, wiskit);
  assert.ok(continueUntil(player, (line) => line.startsWith("They're draining")));
  cont(player);
  assert.equal(varbits.get(VARBIT.VILLAGER_CHAT), 1, "t2347");
  assert.ok(text(player).startsWith("I've had enough of you poking"), "the challenge opens by itself");
  assert.equal(head(player), 4483);
  tick(4);
  assert.notDeepEqual(at(player), [3514, 3240], "in the store's copy (t2351)");
  const ids = fightNpcs(player).map((npc) => npc.getId()).sort((a, b) => a - b);
  assert.deepEqual(ids, [4484, 4486, 4487, 9634]);
  assert.equal(stageOf(player), STAGE.GADDERANKS);
  tick(1);
  assert.equal(stageOf(player), STAGE.FIGHT, "240 (t2352)");
  assert.ok(text(player).startsWith("I've had enough of you poking"), "the line again");
  cont(player);
  tick(1);
  for (const id of [4486, 4487]) assert.equal(byId(player, id).getCombat().getTarget?.(), player, `juvinate ${id} attacks (t2357)`);
});

test("Gadderanks is wounded, not killed; Veliaf comes five ticks on; any juvinate death counts; 260 opens the lines", (t) => {
  const { player, varbits } = intoFight(t);
  const gadderanks = byId(player, 4484);
  gadderanks.setHitpoints(0);
  assert.equal(gadderanks.isRegistered(), true, "he stays (t2415)");
  assert.equal(gadderanks.getContentId(player), 4485, "the wounded Gadderanks");
  assert.equal(varbits.get(VARBIT.JUVINATE_DEATHS), 1, "Gadderanks counts");
  tick(4);
  assert.equal(stageOf(player), STAGE.FIGHT);
  tick(1);
  assert.equal(stageOf(player), STAGE.VELIAF_ARRIVED, "250 (t2420)");
  assert.ok(byId(player, 989), "Veliaf at the door");
  tick(4);
  const first = byId(player, 4486);
  first.setHitpoints(0); // no player's blow
  tick(1);
  assert.equal(first.isRegistered(), false, "the juvinate goes a tick on (t2500)");
  assert.ok(byId(player, 4435), "its mist");
  assert.equal(varbits.get(VARBIT.JUVINATE_DEATHS), 2);
  byId(player, 4487).setHitpoints(0);
  tick(1);
  assert.equal(varbits.get(VARBIT.JUVINATE_DEATHS), 3);
  assert.equal(stageOf(player), STAGE.JUVINATES_DEAD, "260 (t2517)");
  assert.equal(text(player), "*cough*");
  assert.equal(head(player), 4485);
  cont(player);
  assert.ok(text(player).startsWith("Huh, it looks like Gadderanks is still alive"));
  assert.equal(head(player), 989);
  tick(10);
  assert.equal(byId(player, 4435), undefined, "the mists fade");
});

test("the wounded talk starts from the player's line; passing away: 280, 1981=2, out, the hammer before Aurel's line", (t) => {
  const { player, varbits, chatboxes, items } = intoFight(t);
  byId(player, 4484).setHitpoints(0);
  tick(5);
  byId(player, 4486).setHitpoints(0);
  byId(player, 4487).setHitpoints(0);
  tick(1);
  player.getDialogueManager().reset();
  const wounded = byId(player, 4485);
  assert.equal(talk(player, wounded), true);
  assert.ok(text(player).startsWith("You don't look too well, Gadderanks"), "t2530");
  assert.ok(continueUntil(player, (line) => line.startsWith("It's too late for me")));
  cont(player);
  assert.ok(held(player), "Gadderanks passes away: held while the screen fades (t2595)");
  assert.equal(chatboxes.at(-1), MESBOX, "a mesbox");
  tick(4);
  assert.equal(stageOf(player), STAGE.GADDERANKS_DEAD, "280 (t2599)");
  assert.equal(varbits.get(VARBIT.BLOOD_TITHE), 2);
  assert.deepEqual(at(player), [3512, 3241], "out of the copy");
  assert.equal(player.getInventory().getAmount(GADDERHAMMER), 0);
  tick(1);
  assert.equal(text(player), "Gadderanks passes away.", "the box again (t2600)");
  cont(player);
  assert.equal(varbits.get(VARBIT.WARHAMMER_GIVEN), 1, "t2605");
  assert.equal(player.getInventory().getAmount(GADDERHAMMER), 1);
  assert.ok(text(player).startsWith("Hey there! Gadderanks dropped this warhammer"));
  assert.equal(head(player), 4445);
  cont(player);
  assert.equal(chatboxes.at(-1), OBJECTBOX, "Aurel's item box (t2610)");
  assert.equal(items.at(-1), GADDERHAMMER);
});

test("Escape on the store door leaves the copy and resets the fight", (t) => {
  const { player, varbits } = intoFight(t);
  byId(player, 4484).setHitpoints(0);
  tick(5);
  assert.equal(stageOf(player), STAGE.VELIAF_ARRIVED);
  const door = { getId: () => 12761, getLocation: () => player.getLocation() };
  const handled = PM.emitObjectInteraction({ player, object: door, objectId: 12761, definition: core.ObjectDefinition.forId(12761),
    clickType: 1, option: "Escape", location: { x: 0, y: 0, z: 0 }, handled: false });
  assert.equal(handled, true);
  assert.deepEqual(at(player), [3514, 3237]);
  assert.equal(varbits.get(VARBIT.JUVINATE_DEATHS), 0);
  assert.equal(stageOf(player), STAGE.FIGHT);
  assert.equal(fightNpcs(player).length, 0);
});

test("store Veliaf (4479 at 1981=2): his talk, then he heads back to the Hollows (1981=3); the stage stays 280", (t) => {
  const { player, varbits, spawn } = actor(t, STAGE.GADDERANKS_DEAD, 3516, 3242);
  const veliaf = spawn(4479, 3517, 3242);
  assert.equal(veliaf.getContentId(player), 9633);
  assert.equal(talk(player, veliaf), true);
  assert.ok(text(player).startsWith("Phew! Thanks for your help Veliaf"));
  cont(player);
  assert.equal(head(player), 989, "live's head (t2623)");
  assert.ok(continueUntil(player, (line) => line === "Sure."));
  cont(player);
  assert.ok(held(player), "the mesbox held through the fade (t2632)");
  assert.equal(varbits.get(VARBIT.BLOOD_TITHE), 2);
  tick(2);
  assert.equal(varbits.get(VARBIT.BLOOD_TITHE), 3, "t2634");
  tick(1);
  assert.equal(text(player), "Veliaf heads back to the Hollows.", "the box again (t2635)");
  assert.equal(stageOf(player), STAGE.GADDERANKS_DEAD, "live's 290 is the Hollows talk");
});

test("Aurel after the tithe: the hero page, the lost-hammer page, and a hammer that waited for a free slot", (t) => {
  const kept = actor(t, STAGE.GADDERANKS_DEAD, 3516, 3241);
  const aurel = kept.spawn(4445, 3517, 3241);
  kept.player.getInventory().adds(GADDERHAMMER, 1);
  assert.equal(talk(kept.player, aurel), true);
  assert.ok(text(kept.player).startsWith("Hey it's the hero!"));

  const lost = actor(t, STAGE.GADDERANKS_DEAD, 3516, 3241);
  lost.player.getInventory().adds(COINS, 3000);
  talk(lost.player, aurel);
  assert.ok(continueUntil(lost.player, (line) => line === "You're more than welcome."));
  cont(lost.player);
  const menu = core.MultiChatboxPrompt.getPending(lost.player);
  assert.ok(menu?.options.includes("I've lost Gadderanks' Warhammer."), "the recovery page's menu");

  const waiting = actor(t, STAGE.GADDERANKS_DEAD, 3516, 3241, { [VARBIT.WARHAMMER_GIVEN]: 0 });
  const vars = { ...waiting.player.getAttribute(VARS_ATTRIBUTE) };
  delete vars[VARBIT.WARHAMMER_GIVEN];
  waiting.player.setAttribute(VARS_ATTRIBUTE, vars);
  talk(waiting.player, aurel);
  assert.equal(waiting.player.getInventory().getAmount(GADDERHAMMER), 1, "the Wiki: claimed from him later");
  assert.ok(text(waiting.player).startsWith("Hey there! Gadderanks dropped this warhammer"));
});

test("Aurel and the citizens during the tithe take the post-furnace lines; the tithe cast is not ours before 230", (t) => {
  const during = actor(t, STAGE.FIGHT, 3516, 3241);
  const aurel = during.spawn(4445, 3517, 3241);
  assert.equal(talk(during.player, aurel), true);
  assert.ok(text(during.player).startsWith("Well done big shot!"), "K_irY5, Aurel's own line");
  during.player.getDialogueManager().reset();
  const razvan = during.spawn(4468, 3512, 3241);
  assert.equal(talk(during.player, razvan), true);
  assert.ok(text(during.player).startsWith("Well done big shot!"));
  const early = actor(t, STAGE.FURNACE_FIXED, 3516, 3241, { [VARBIT.FURNACE]: 2 });
  const wiskit = early.spawn(4479, 3515, 3242);
  assert.notEqual(wiskit.getContentId(early.player), 4480, "no tithe cast before 1981=1");
  const gadderanks = early.spawn(6218, 3515, 3241);
  talk(early.player, gadderanks);
  assert.equal(saved(early.player, VARBIT.GADDERANKS_CHAT), 0);
});

test("Inspect on the fuelled furnace asks to light it; Yes with a tinderbox lights it", (t) => {
  const { player, chatboxes } = actor(t, STAGE.FURNACE_FIXED, 3526, 3209, { [VARBIT.FURNACE]: 2 });
  player.getInventory().adds(TINDERBOX, 1);
  const definition = core.ObjectDefinition.forPlayer(12805, player);
  assert.equal(definition.getName(), "Repaired furnace");
  const handled = PM.emitObjectInteraction({ player, object: { getId: () => 12805, getLocation: () => new core.Location(3527, 3209, 0) },
    objectId: 12805, definition, clickType: 1, option: "Inspect", location: { x: 3527, y: 3209, z: 0 }, handled: false });
  assert.equal(handled, true);
  assert.equal(chatboxes.at(-1), MESBOX, "the transcript's statement in a mesbox");
  cont(player);
  const menu = core.MultiChatboxPrompt.getPending(player);
  assert.ok(menu?.options.includes("Yes."));
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    slot: menu.options.indexOf("Yes.") + 1, handled: false });
  tick(5);
  assert.equal(stageOf(player), STAGE.FURNACE_LIT);
});

test("a logout inside the fight comes back outside the store with the fight reset", (t) => {
  const { player, varbits } = intoFight(t);
  byId(player, 4484).setHitpoints(0);
  tick(5);
  player.getArea().leave(player, true); // the logout path's area leave
  assert.equal(varbits.get(VARBIT.JUVINATE_DEATHS), 0);
  assert.equal(stageOf(player), STAGE.FIGHT);
  assert.deepEqual(at(player), [3514, 3237]);
  assert.equal(fightNpcs(player).length, 0);
});
