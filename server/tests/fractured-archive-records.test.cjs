// Run after `yarn build`: node --test tests/fractured-archive-records.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let Records;
let PlayerSave;
let next = 2500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ({ PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave"));
  Records = require("../plugins/minigames/tfa/Records.FracturedArchive");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(4096, 5568);
  PM.emitServerStartup({});
});

after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("tfarec" + next);
  player.setRegistered(true);
  player.setLocation(new core.Location(4125, 5597, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === player) core.World.getNpcs().remove(npc);
  });
  return { player, connection };
}

function setCompletions(player, count) {
  player.setAttribute(Records.ATTR, { overall: { completions: count } });
}

function guardianComplete(player) {
  const at = new core.Location(4125, 5597, 0);
  PM.emitCustomEvent("fractured-archive:room-complete", {
    room: "GUARDIAN",
    players: [player],
    raid: { rooms: new Map([["GUARDIAN", { guardian: { getLocation: () => at } }]]) },
  });
}

function groundKeyCount(player) {
  const key = Records.keyItemId();
  return [...core.World.getItems()].filter((item) => item.getOwner?.() === player.getUsername() && item.getItem?.().getId?.() === key).length;
}

test("the archive key is a Guardian reward only from 100 completions", (t) => {
  const { player } = actor(t);
  setCompletions(player, 99);
  guardianComplete(player);
  assert.equal(groundKeyCount(player), 0);

  setCompletions(player, 100);
  guardianComplete(player);
  assert.equal(groundKeyCount(player), 1);
});

test("using the key unlocks the strange door permanently and enters the records room", (t) => {
  const { player } = actor(t);
  player.getInventory().adds(Records.keyItemId(), 1);
  const event = { player, itemId: Records.keyItemId(), objectId: core.ObjectIdentifiers.STRANGE_DOOR, handled: false };
  assert.equal(Records.useKeyOnDoor(event), true);
  assert.equal(event.handled, true);
  assert.equal(player.getInventory().contains(Records.keyItemId()), false);
  assert.equal(player.getAttribute(Records.ATTR_UNLOCKED), true);

  Records.enterRecordsRoom({ player, object: { getLocation: () => new core.Location(4123, 5573, 0) } });
  assert.deepEqual(
    [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()],
    [4108, 5573, 1],
  );

  Records.exitRecordsRoom({ player, object: { getId: () => core.ObjectIdentifiers.EXIT_38, getLocation: () => new core.Location(4109, 5573, 1) } });
  assert.deepEqual(
    [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()],
    [4124, 5573, 0],
  );

  const restored = actor(t);
  PlayerSave.fromPlayer(player).applyToPlayer(restored.player);
  assert.equal(restored.player.getAttribute(Records.ATTR_UNLOCKED), true);
});

test("a Living record claim is one item, logged once, and reclaims only when missing", (t) => {
  const { player } = actor(t);
  const messages = [];
  player.sendMessage = (message) => messages.push(message);
  setCompletions(player, 100);
  const tier1 = core.ItemIdentifiers.LIVING_RECORD_TIER_1_;
  const objectId = core.ObjectIdentifiers.LIVING_RECORD_TIER_1_;

  Records.claimRecord({ player, objectId });
  assert.equal(player.getInventory().getAmount(tier1), 1);
  assert.equal(player.getAttribute("clog.items")[tier1], 1);

  Records.claimRecord({ player, objectId });
  assert.equal(player.getInventory().getAmount(tier1), 1, "holding the cape is not a duplicate claim");
  assert.equal(player.getAttribute("clog.items")[tier1], 1);

  player.getInventory().deleteNumber(tier1, 1);
  Records.claimRecord({ player, objectId });
  assert.equal(player.getInventory().getAmount(tier1), 1, "a lost cape can be reclaimed");
  assert.equal(player.getAttribute("clog.items")[tier1], 1, "reclaiming does not add another log credit");

  const restored = actor(t);
  PlayerSave.fromPlayer(player).applyToPlayer(restored.player);
  assert.equal(restored.player.getInventory().getAmount(tier1), 1);
  assert.equal(restored.player.getAttribute("clog.items")[tier1], 1);

  setCompletions(player, 500);
  while (player.getInventory().getFreeSlots() > 0) player.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE), false);
  Records.claimRecord({ player, objectId: core.ObjectIdentifiers.LIVING_RECORD_TIER_2_ });
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.LIVING_RECORD_TIER_2_), 0);
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.LIVING_RECORD_TIER_2_], undefined);
  assert.ok(messages.includes("You don't have enough inventory space."));
});

test("the door/cape varbits follow the saved unlock and completion thresholds", (t) => {
  const { player } = actor(t);
  const Shared = require("../plugins/minigames/tfa/Shared.FracturedArchive");
  const sent = new Map();
  const sender = player.getPacketSender();
  const original = sender.sendVarbit;
  t.after(() => { sender.sendVarbit = original; });
  sender.sendVarbit = (id, value) => { sent.set(id, value); return sender; };
  player.setAttribute(Records.ATTR_UNLOCKED, true);
  setCompletions(player, 500);
  Records.updateVisibility(player);
  const varbit = (name) => Shared.named("varbit", name);
  assert.equal(sent.get(varbit("tfa_records_room_unlocked")), 1);
  assert.equal(sent.get(varbit("tfa_cape_claim_t1_visible")), 1);
  assert.equal(sent.get(varbit("tfa_cape_claim_t2_visible")), 1);
  assert.equal(sent.get(varbit("tfa_cape_claim_t3_visible")), 0);
});

test("the Living record inspect text is the Wiki transcript and uses the cache threshold", (t) => {
  const { player } = actor(t);
  const started = [];
  player.getDialogueManager().startDialogues = (chain) => started.push(chain);
  Records.inspectRecord({ player, objectId: core.ObjectIdentifiers.LIVING_RECORD_TIER_2_ });
  assert.equal(started.length, 1);
  const lines = [...started[0].getDialogues().values()].filter((entry) => typeof entry.getText === "function").map((entry) => entry.getText());
  assert.deepEqual(lines, [
    "These ancient capes were awarded to the archivists of this place. Today they are used to honour those who defend them.",
    "While many archivists travelled the world, some remained behind in the Archive. This cape was given to recognise their work.",
    "500 completions required.",
  ]);
  assert.equal(Records.claimRequirement(core.ItemIdentifiers.LIVING_RECORD_TIER_2_), 500);
  assert.equal(Records.claimRequirement(core.ItemIdentifiers.LIVING_RECORD_TIER_1_), 100);
});
