// Run after `yarn build`: node --test tests/construction-clockwork-toys.test.cjs
//
// Clockwork toys (toy soldier, doll and mouse): Wind and Release had no handler, so winding did
// nothing and releasing only dropped the item. rsprox captures (rev 229 recording 2598, rev 226
// recording 1695): Wind swaps to the wound toy with "You wind up the <toy>." and synth 989; Release
// is refused in building mode, else spawns the toy NPC (area sound 941, varbit
// poh_clockwork_recentdrop -> 1 for 78 ticks so the owner sees the Pick-up form), which walks, then
// (soldier) falls over and leaves the unwound toy on the ground for its owner for 99 ticks.
// Real engine: every plugin loaded, real Players and a real seeded house.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, C, House, Instance, Toys;
const id = {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  PM.emitServerStartup({});
  C = core.CacheDefinitions;
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Toys = require("../plugins/skills/construction/ClockworkToys.Construction");
  for (const name of ["poh_toy_soldier_unwound", "poh_toy_soldier_wound", "poh_toy_doll_unwound", "poh_toy_doll_wound",
    "poh_toy_mouse_unwound", "poh_toy_mouse_wound"]) id[name] = C.getObjId(name);
  id.soldierNpc = C.getNpcId("poh_toy_soldier");
  id.mouseNpc = C.getNpcId("poh_toy_mouse");
  id.recentDrop = C.getVarbitId("poh_clockwork_recentdrop");
  id.fallover = C.getSeqId("poh_toy_soldier_fallover");
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 7759;
function newPlayer(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getSession().setPlayer?.(player);
  player.setUsername(`${name}${nextIndex++}`);
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const seen = { messages: [], sounds: [], areaSounds: [], varbits: [] };
  const sender = player.getPacketSender();
  const sendSound = sender.sendSound.bind(sender);
  sender.sendSound = (soundId, ...rest) => (seen.sounds.push(soundId), sendSound(soundId, ...rest));
  const sendAreaSound = sender.sendAreaSound.bind(sender);
  sender.sendAreaSound = (soundId, ...rest) => (seen.areaSounds.push(soundId), sendAreaSound(soundId, ...rest));
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (varbit, value, ...rest) => (seen.varbits.push([varbit, value]), sendVarbit(varbit, value, ...rest));
  player.sendMessage = (message) => seen.messages.push(message);
  t.after(() => {
    for (const [npc, entry] of [...Toys.released]) if (entry.owner === player) { Toys.released.delete(npc); entry.task.stop(); if (npc.isRegistered()) PM.removeNpc(npc); }
    try { House.releaseHouse(player, true); } finally { core.TaskManager.cancelTasks(player); core.World.getPlayers().remove(player); }
  });
  return { player, seen };
}

function ownerInHouse(t, buildingMode = false) {
  const owner = newPlayer(t, "toymaker");
  owner.player.setAttribute("construction:house", Instance.createDefaultHouseSave());
  owner.player.moveTo(new core.Location(2954, 3224, 0));
  owner.player.setNeedsPlacement(false);
  assert.equal(House.enterHouse(owner.player, buildingMode), true);
  const house = House.houseFor(owner.player);
  assert.ok(house instanceof Instance.PlayerHouseInstance);
  return { ...owner, house };
}

function click(player, itemId, option) {
  const slot = player.getInventory().getSlotForItemId(itemId);
  assert.ok(slot >= 0, `holds ${itemId}`);
  const event = { player, interfaceId: 149, item: player.getInventory().getItems()[slot], itemId, slot, clickType: option === "Release" ? 5 : 1, option, handled: false };
  return PM.emitItemAction(event), event;
}

function npcOption(player, npc, clickType) {
  const definition = npc.getCurrentDefinition(player);
  const event = { player, npc, definition, npcId: npc.getContentId(player), npcIndex: npc.getIndex(), clickType, handled: false };
  PM.emitNpcInteraction(event);
  return event;
}

function onlyToy(player) {
  const entries = [...Toys.released].filter(([, entry]) => entry.owner === player);
  assert.equal(entries.length, 1, "one toy out");
  return entries[0];
}

test("Wind turns each toy into its wound form, with the recorded message and sound", (t) => {
  const { player, seen } = newPlayer(t, "winder");
  for (const kind of ["soldier", "doll", "mouse"]) {
    player.getInventory().adds(id[`poh_toy_${kind}_unwound`], 1);
    assert.equal(click(player, id[`poh_toy_${kind}_unwound`], "Wind").handled, true);
    assert.equal(player.getInventory().getAmount(id[`poh_toy_${kind}_unwound`]), 0);
    assert.equal(player.getInventory().getAmount(id[`poh_toy_${kind}_wound`]), 1);
    assert.equal(seen.messages.at(-1), `You wind up the ${kind}.`);
    assert.equal(seen.sounds.at(-1), 989);
  }
});

test("Release in building mode is refused and the toy stays wound", (t) => {
  const { player, seen } = ownerInHouse(t, true);
  player.getInventory().adds(id.poh_toy_soldier_wound, 1);
  assert.equal(click(player, id.poh_toy_soldier_wound, "Release").handled, true);
  assert.deepEqual(seen.messages.slice(-1), ["You cannot release clockwork toys while in building mode."]);
  assert.equal(player.getInventory().getAmount(id.poh_toy_soldier_wound), 1);
  assert.equal(Toys.released.size, 0);
});

test("A released soldier walks off in the house, falls over and leaves the unwound toy for its owner", (t) => {
  const { player, seen, house } = ownerInHouse(t);
  const guest = newPlayer(t, "guest");
  player.getInventory().adds(id.poh_toy_soldier_wound, 1);
  const from = player.getLocation().clone();
  assert.equal(click(player, id.poh_toy_soldier_wound, "Release").handled, true);
  assert.equal(player.getInventory().getAmount(id.poh_toy_soldier_wound), 0);
  const [npc, entry] = onlyToy(player);
  assert.equal(npc.getId(), id.soldierNpc);
  assert.equal(npc.getPrivateArea(), house, "the toy walks in the owner's house");
  assert.ok(npc.getLocation().getDistance?.(from) <= 1 || Math.max(Math.abs(npc.getLocation().getX() - from.getX()), Math.abs(npc.getLocation().getY() - from.getY())) <= 1);
  assert.deepEqual(seen.varbits.filter(([varbit]) => varbit === id.recentDrop), [[id.recentDrop, 1]]);
  assert.ok(seen.areaSounds.includes(941), "release sound");
  // The owner's varbit picks the Pick-up form; a player without it sees no options.
  assert.equal(npc.getCurrentDefinition(player).getName(), "Toy Soldier");
  assert.deepEqual(npc.getCurrentDefinition(player).getActions()[0], "Pick-up");
  assert.notEqual(npc.getCurrentDefinition(guest.player)?.getActions?.()[0], "Pick-up");

  const task = entry.task;
  task.lasts = 3;
  let falls = 0;
  const perform = npc.performAnimation.bind(npc);
  npc.performAnimation = (animation) => (animation.getId() === id.fallover && falls++, perform(animation));
  task.execute(); task.execute();
  assert.equal(falls, 0);
  task.execute();
  assert.equal(falls, 1, "the soldier falls over when its walk ends");
  assert.ok(seen.areaSounds.includes(988), "fall sound");
  const at = npc.getLocation().clone();
  task.execute();
  assert.equal(npc.isRegistered(), false, "gone the tick after it falls");
  assert.equal(Toys.released.has(npc), false);
  const ground = core.ItemOnGroundManager.getGroundItem(player.getUsername(), id.poh_toy_soldier_unwound, at, house);
  assert.ok(ground, "the unwound toy lies where the soldier fell");
  assert.equal(ground.getDespawnDelay?.() ?? ground.despawnDelay, 99);
  assert.equal(core.ItemOnGroundManager.getGroundItem(guest.player.getUsername(), id.poh_toy_soldier_unwound, at, house), null,
    "only its owner sees it");
});

test("Pick-up takes a walking toy back unwound; another player's toy is not theirs to take", (t) => {
  const { player } = ownerInHouse(t);
  const other = newPlayer(t, "taker");
  player.getInventory().adds(id.poh_toy_mouse_wound, 1);
  const here = player.getLocation().clone();
  click(player, id.poh_toy_mouse_wound, "Release");
  const [npc] = onlyToy(player);
  assert.equal(npc.getId(), id.mouseNpc);
  assert.ok(npc.getLocation().equals?.(here) ?? (npc.getLocation().getX() === here.getX() && npc.getLocation().getY() === here.getY()),
    "the mouse starts on the player's tile");
  assert.equal(npcOption(other.player, npc, 1).handled, false);
  assert.equal(npcOption(player, npc, 1).handled, true);
  assert.equal(npc.isRegistered(), false);
  assert.equal(player.getInventory().getAmount(id.poh_toy_mouse_unwound), 1);
});

test("The varbit clears 78 ticks after the last release, not an earlier one", (t) => {
  const { player, seen } = ownerInHouse(t);
  const countdowns = [];
  const submit = core.TaskManager.submit;
  core.TaskManager.submit = (task) => (task instanceof core.CountdownTask && countdowns.push(task), submit.call(core.TaskManager, task));
  t.after(() => { core.TaskManager.submit = submit; });
  player.getInventory().adds(id.poh_toy_doll_wound, 2);
  click(player, id.poh_toy_doll_wound, "Release");
  click(player, id.poh_toy_doll_wound, "Release");
  assert.equal(countdowns.length, 2);
  for (const countdown of countdowns) assert.equal(countdown.getDelay?.() ?? countdown.delay, 78);
  const recent = () => seen.varbits.filter(([varbit]) => varbit === id.recentDrop).at(-1);
  countdowns[0].onComplete();
  assert.deepEqual(recent(), [id.recentDrop, 1], "the first release's timer leaves the varbit set");
  countdowns[1].onComplete();
  assert.deepEqual(recent(), [id.recentDrop, 0]);
});

test("A toy whose owner logs out goes back to their inventory", (t) => {
  const { player } = ownerInHouse(t);
  player.getInventory().adds(id.poh_toy_doll_wound, 1);
  click(player, id.poh_toy_doll_wound, "Release");
  const [npc] = onlyToy(player);
  PM.emitPlayerLogout({ player, username: player.getUsername() });
  assert.equal(npc.isRegistered(), false);
  assert.equal(player.getInventory().getAmount(id.poh_toy_doll_unwound), 1);
});
