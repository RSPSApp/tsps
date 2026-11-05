"use strict";

/**
 * The Resource Area's gate (loc 26760, wilderness_resource_gate, at 3184,3944; Mandrith stands at 3183,3945)
 * and its entrance fee (https://oldschool.runescape.wiki/w/Resource_Area).
 *
 * Captured (rsprox 1444, rev 224, ticks 173-180; the medium-diary fee flow): the click walks the player to
 * 3184,3945; the modal "Pay 6000 coins to enter?" offers Yes|No; Yes: the game message (spam) "You pay 6000
 * coins and enter the resource arena.", the coins go, sounds 71 and 2400 play, the gate swings (26760 at
 * 3184,3944 becomes the invisible wall 38848 and the open leaf 1548 stands at 3184,3945), the player is on
 * 3184,3944 the next tick, and the gate is restored two ticks later.
 *
 * Captured too (rsprox 1444, ticks 780-792; leaving from inside): the click runs the player to 3185,3943, sound
 * 71 plays on arrival (no 2400), two ticks later the gate swings and the player steps out onto 3184,3945, and
 * two ticks after that the gate is restored. No prompt, no coins, no message.
 *
 * The fee follows the COMPLETED Wilderness Diary tiers (Wiki; agent/data/transports.json keys its rows to the
 * tiers' complete varbits 4467/4468/4469): 7,500; 6,000 after the medium; 3,750 after the hard; free after the
 * elite. INFERRED, no capture: the hard prompt follows the medium one; the elite entry has no prompt and no
 * message; "You don't have enough coins." (AlKharidGate's string, ours here) when the player cannot pay; and
 * a player who logs in inside is put on 3184,3945 (Wiki: "brought outside the area entrance") with no message.
 * "diary:is-complete" means the tier is completed; the Wiki's footnotes say "claimed".
 *
 * Not done: Peek (op 2), and preset coins (the fee is paid by id, as at the Al Kharid gate).
 *
 * The swing is only what the client is shown, as at the Al Kharid gate: the server keeps the gate's clipping,
 * so nobody follows a paying player through, and the player is walked across by the agility runner.
 */
const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

const GATE_ID = 26760;
const GATE_TILE = { x: 3184, y: 3944, z: 0 };
const OUTSIDE_TILE = { x: 3184, y: 3945, z: 0 };
const INVISIBLE_WALL_ID = 38848;
const OPEN_LEAF_ID = 1548;
const OPEN_LEAF_FACE = 2;
const ENTER_SOUNDS = [71, 2400];
const LEAVE_SOUND = 71;
const LEAVE_DELAY_TICKS = 2;
/** The enclosure (Wiki map x 3174-3197, y 3924-3945): its inside is up to the gate's own row. */
const AREA = { minX: 3174, maxX: 3197, minY: 3925, maxY: 3944 };
const CLOSE_DELAY_TICKS = 2;
const NOT_ENOUGH_COINS = "You don't have enough coins.";
const FEES = [["elite", 0], ["hard", 3750], ["medium", 6000]];
const FULL_FEE = 7500;

let api;
let core;

function inArea(location) {
  return location.getZ() === 0 && location.getX() >= AREA.minX && location.getX() <= AREA.maxX
    && location.getY() >= AREA.minY && location.getY() <= AREA.maxY;
}

function completed(player, tier) {
  const request = { player, diary: "wilderness", tier, complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** What entering costs this player now, by the highest completed tier. */
function feeFor(player) {
  for (const [tier, fee] of FEES) if (completed(player, tier)) return fee;
  return FULL_FEE;
}

/** Where the gate answers: the captured tile outside, the gate's own tile and the captured row inside. */
const GATE_STANDS = new Set(["3184,3945", "3184,3944", "3183,3943", "3184,3943", "3185,3943"]);

function nearGate(player) {
  const at = player.getLocation();
  return at.getZ() === 0 && GATE_STANDS.has(`${at.getX()},${at.getY()}`);
}

const isOutside = (player) => player.getLocation().getY() >= OUTSIDE_TILE.y;

/** The gate loc the map holds (its type and facing), or the captured one. */
function gateObject() {
  const at = new core.Location(GATE_TILE.x, GATE_TILE.y, GATE_TILE.z);
  return core.MapObjects.get(GATE_ID, at, null) ?? new core.GameObject(GATE_ID, at, 0, 1, null);
}

/** Shows the gate open (or shut again) to everyone with it in view; the server's clipping stays shut. */
function swing(opening) {
  const closed = gateObject();
  const at = closed.getLocation();
  const wall = new core.GameObject(INVISIBLE_WALL_ID, at.clone(), closed.getType(), closed.getFace(), null);
  const leaf = new core.GameObject(OPEN_LEAF_ID, new core.Location(OUTSIDE_TILE.x, OUTSIDE_TILE.y, OUTSIDE_TILE.z), 0, OPEN_LEAF_FACE, null);
  const from = opening ? [closed] : [wall, leaf];
  const to = opening ? [wall, leaf] : [closed];
  core.World.forEachNetworkPlayer((viewer) => {
    const area = viewer.getPrivateArea?.();
    if (area && !area.countsAsMainWorld?.()) return;
    if (!viewer.getSession().isTileInScene(GATE_TILE.x, GATE_TILE.y, GATE_TILE.z)) return;
    const sender = viewer.getPacketSender();
    for (const object of from) sender.sendObjectRemoval(object);
    for (const object of to) sender.sendObject(object);
  });
}

const crossing = new WeakSet();

function later(ticks, run) {
  const task = new core.Task(ticks, false);
  task.execute = () => {
    task.stop();
    run();
  };
  api.getTaskManager().submit(task);
}

function walkTo(player, target) {
  ObstacleRunner.run({ player }, [{ walk: [[target.x, target.y]] }]);
}

/**
 * Entering (captured): both sounds, the swing and the step on the Yes tick, the gate restored two ticks on.
 * Leaving (captured): sound 71 on arrival, then two ticks later the swing and the step out, and two more to
 * restore the gate.
 */
function cross(player, entering) {
  if (ObstacleRunner.isBusy(player) || crossing.has(player)) return;
  crossing.add(player);
  const swingAndStep = (target) => {
    swing(true);
    walkTo(player, target);
    later(CLOSE_DELAY_TICKS, () => {
      swing(false);
      crossing.delete(player);
    });
  };
  if (entering) {
    for (const sound of ENTER_SOUNDS) player.getPacketSender().sendSound(sound, 1, 0);
    swingAndStep(GATE_TILE);
    return;
  }
  player.getPacketSender().sendSound(LEAVE_SOUND, 1, 0);
  later(LEAVE_DELAY_TICKS, () => swingAndStep(OUTSIDE_TILE));
}

function pay(player, asked) {
  if (!nearGate(player) || !isOutside(player) || ObstacleRunner.isBusy(player)) return;
  const fee = feeFor(player);
  // The tier moved since the question: ask again, so the price asked is the price paid.
  if (fee !== asked) {
    ask(player);
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getAmount(core.ItemIdentifiers.COINS) < fee) {
    player.sendMessage(NOT_ENOUGH_COINS);
    return;
  }
  inventory.deleteNumber(core.ItemIdentifiers.COINS, fee);
  inventory.refreshItems();
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `You pay ${fee} coins and enter the resource arena.`);
  cross(player, true);
}

function ask(player) {
  const fee = feeFor(player);
  if (fee === 0) {
    cross(player, true);
    return;
  }
  api.sendMultiChatboxPrompt(player, `Pay ${fee} coins to enter?`, "Yes", () => pay(player, fee), "No", () => {});
}

function openGate(event) {
  const { player } = event;
  if (!nearGate(player)) return true;
  if (isOutside(player)) ask(player);
  else cross(player, false);
  return true;
}

/** Wiki: a player who logs out inside the area is brought outside its entrance. */
function login({ player }) {
  if (inArea(player.getLocation())) player.moveTo(new core.Location(OUTSIDE_TILE.x, OUTSIDE_TILE.y, OUTSIDE_TILE.z));
}

module.exports = {
  name: "ResourceArea",
  members: true,
  register(registry) {
    api = registry;
    core = registry.core;
    ObstacleRunner.init(registry);
    registry.onObjectClick(GATE_ID, 1, openGate);
    registry.onPlayerLogin(login);
  },
  _test: { feeFor, inArea, nearGate },
};
