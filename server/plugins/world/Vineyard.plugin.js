"use strict";

/**
 * Aldarin's vineyard (Wiki: Vineyard foreman, Grape barrel, Grapevine): the foreman hands out a
 * grape barrel, four ripe grapevines are picked into it, and the full barrel goes back to him for 5
 * noted grapes. The foreman's words are the generated transcript; this plugin answers its four
 * barrel conditions, gives the barrel on the two handout steps, and picks the full-barrel variant.
 *
 * As RSProx 237/1098 shows (ticks 11955-16598, and 1105):
 * - A player arriving in Aldarin gets four ripe vines of their own (tick 11955, the quetzal
 *   landing, before any barrel); each sparkles, map_anim_specific league_trophy_glint_spotanim_silent
 *   (3005) at height 50 on the vine's tile, every tick while it is in view (seen up to 53 tiles off).
 *   They are kept across logins (1105 resumes with the same four).
 * - Pick on a ripe vine, on the arrival: busy, picking_mid_short; synth 2581 (delay 28) a tick on;
 *   the line ("You pick some grapes and place them in your grape barrel (N/4).", the fourth
 *   "<col=229628>Your grape barrel is now full. You should return it to the Vineyard
 *   foreman.</col>") two ticks on, and that vine is picked. An unripe one, on the arrival: "Those
 *   grapes don't look ripe enough to pick yet."
 * - The barrel's Check: "The grape barrel is empty." / "The grape barrel is full. You should return
 *   it to the Vineyard foreman."
 * - Talking to the foreman with a full barrel plays the transcript's full-barrel variant; his "Great
 *   work! Here, keep some grapes as payment." pays 5 noted grapes, empties the barrel and ripens four
 *   new vines (`vineyard:barrel-handed-in` { player }, the league's "Fill a Grape Barrel for the
 *   Foreman", on that line's tick).
 *
 * A barrel handed out after a batch was picked from comes with a fresh batch (ours: a barrel lost
 * part-full would otherwise be unfillable), and grapes that don't fit a full pack land at the player's feet (ours).
 *
 * Ours, no source: which vines can ripen (live numbers its ripe vines in 6-bit varbits 11343-11346,
 * aldarin_grapes_position_1..4, by a list the cache does not carry, so this server takes any Pick
 * grapevine of the three vineyards and sends no such varbit); a partly filled barrel's Check line. Recorded difference: live ripened one new vine the tick the barrel filled
 * (1098 tick 16588) and the other three at the hand-in; the Wiki says they refresh only after the
 * turn-in, which this follows.
 */

const FOREMAN_NPC_ID = 13908;
const BARREL_RECEIVED_ATTRIBUTE = "aldarin:vineyard-barrel-received";
/** "The foreman gives you a grape barrel." in the first-time and repeat branches. */
const BARREL_MESSAGE_IDS = new Set(["dH1XFF", "1VyjPI"]);

/** The ripe vines of this player's batch, [x, y] each, picked ones removed (persisted). */
const RIPE_ATTRIBUTE = "aldarin:vineyard-ripe";
/** Sets of grapes in the barrel, 0-4 (persisted). */
const GRAPES_ATTRIBUTE = "aldarin:vineyard-grapes";
const SETS = 4;
const PAYMENT = 5;
const VINE_NAME = "Grapevine";
const VINEYARDS = { minX: 1320, maxX: 1410, minY: 2880, maxY: 2990 };
/** The vineyards' middle, and how far from it the sparkles are kept up. */
const CENTRE = { x: 1365, y: 2935 };
const NEARBY = 64;
const SPARKLE = { id: 3005, height: 50, range: 53 };
const PICK_SOUND = { id: 2581, delay: 28 };
const PICKED = (sets) => `You pick some grapes and place them in your grape barrel (${sets}/${SETS}).`;
const FULL = "<col=229628>Your grape barrel is now full. You should return it to the Vineyard foreman.</col>";
const UNRIPE = "Those grapes don't look ripe enough to pick yet.";
const CHECK_EMPTY = "The grape barrel is empty.";
const CHECK_FULL = "The grape barrel is full. You should return it to the Vineyard foreman.";
const CHECK_SOME = (sets) => `The grape barrel contains ${sets}/${SETS} sets of grapes.`; // Ours
/** A ripe vine with no barrel carried (RSProx 237/1098 tick 16266, before the first barrel). */
const NO_BARREL = "You don't have anything to put those grapes in.";
const FULL_VARIANT = "standard-dialogue-talking-with-a-full-grape-barrel-in-your-inventory";
const PAYMENT_LINE = "Great work! Here, keep some grapes as payment.";

let core = null;
let api = null;
/** The Pick grapevines of the three vineyards, [x, y], read from the map once. */
let vines = null;
const sparkling = new WeakSet();
const picking = new WeakSet();

function hasBarrel(player) {
  return player.getInventory().contains(core.ItemIdentifiers.GRAPE_BARREL);
}

function hasSpace(player) {
  return player.getInventory().getFreeSlots() > 0;
}

function receivedBefore(player) {
  return player.getAttribute(BARREL_RECEIVED_ATTRIBUTE) === true;
}

/** The foreman's four sibling conditions, in the transcript's order. */
function barrelCondition({ player, npcId, stepId }) {
  if (npcId !== FOREMAN_NPC_ID) return null;
  const barrel = hasBarrel(player);
  switch (stepId) {
    case "RmkT70": // "If the player doesn't have a grape barrel:" (first time)
      return !barrel && hasSpace(player) && !receivedBefore(player);
    case "-pHm2N": // "If the player doesn't have a grape barrel but has received one before:"
      return !barrel && hasSpace(player) && receivedBefore(player);
    case "cPUyGi": // "If the player doesn't have a grape barrel and doesn't have inventory space:"
      return !barrel && !hasSpace(player);
    case "RoegjF": // "If the player already has a grape barrel:"
      return barrel;
    default:
      return null;
  }
}

/** The handout steps add the barrel; the transcript's own message still shows. */
function giveBarrel(event) {
  if (event.npcId !== FOREMAN_NPC_ID || event.kind !== "message") return;
  if (!BARREL_MESSAGE_IDS.has(event.stepId)) return;
  const { player } = event;
  if (hasBarrel(player) || !hasSpace(player)) return;
  player.getInventory().adds(core.ItemIdentifiers.GRAPE_BARREL, 1);
  player.setAttribute(BARREL_RECEIVED_ATTRIBUTE, true);
  // A new barrel is an empty one. A batch already picked from (a barrel lost part-full) is renewed,
  // or the new barrel could never be filled: the batch otherwise only renews at a hand-in. An
  // untouched batch stays, as live keeps the vines ripened on arrival (RSProx 237/1098 tick 16348).
  player.setAttribute(GRAPES_ATTRIBUTE, 0);
  if ((ripeOf(player)?.length ?? 0) < SETS) ripen(player);
  // The recorded handout opens OBJECTBOX 193 with the barrel and the message, not a bare chat line.
  event.box = { items: [core.ItemIdentifiers.GRAPE_BARREL] };
}

function grapes(player) {
  return Math.max(0, Math.min(SETS, Number(player.getAttribute(GRAPES_ATTRIBUTE)) || 0));
}

function ripeOf(player) {
  const value = player.getAttribute(RIPE_ATTRIBUTE);
  return Array.isArray(value) ? value.filter((tile) => Array.isArray(tile) && tile.length === 2) : null;
}

function inVineyards(x, y) {
  return x >= VINEYARDS.minX && x <= VINEYARDS.maxX && y >= VINEYARDS.minY && y <= VINEYARDS.maxY;
}

/** Every loc named Grapevine with a Pick option in the vineyards, from the map (loaded on the way). */
function vineTiles() {
  if (vines) return vines;
  const found = new Map();
  for (let x = VINEYARDS.minX; x <= VINEYARDS.maxX + 63; x += 64) {
    for (let y = VINEYARDS.minY; y <= VINEYARDS.maxY + 63; y += 64) core.RegionManager?.loadMapFiles?.(Math.min(x, VINEYARDS.maxX), Math.min(y, VINEYARDS.maxY));
  }
  for (let x = VINEYARDS.minX; x <= VINEYARDS.maxX; x++) {
    for (let y = VINEYARDS.minY; y <= VINEYARDS.maxY; y++) {
      for (const object of core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null) ?? []) {
        const definition = object.getDefinition?.();
        if (definition?.getName?.() === VINE_NAME && (definition.getActions?.() ?? []).includes("Pick")) found.set(`${x},${y}`, [x, y]);
      }
    }
  }
  // An unloaded map finds none; ask again next time rather than keep an empty list.
  if (found.size) vines = [...found.values()];
  return [...found.values()];
}

/** Four different ripe vines, drawn from every vine. */
function ripen(player, random = Math.random) {
  const pool = vineTiles().slice();
  if (!pool.length) return null;
  const ripe = [];
  while (ripe.length < SETS && pool.length) ripe.push(pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0]);
  player.setAttribute(RIPE_ATTRIBUTE, ripe);
  return ripe;
}

function nearVineyards(player) {
  const at = player.getLocation?.();
  return !!at && at.getZ() === 0 && Math.max(Math.abs(at.getX() - CENTRE.x), Math.abs(at.getY() - CENTRE.y)) <= NEARBY;
}

/** Arriving by the vineyards: the batch if there is none yet, and the sparkles, every tick while near. */
function arrived(player) {
  if (!player || !nearVineyards(player)) return;
  if (ripeOf(player) === null) ripen(player);
  if (sparkling.has(player)) return;
  sparkling.add(player);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player, true); }
    execute() {
      if (!player.isRegistered() || !nearVineyards(player)) {
        sparkling.delete(player);
        this.stop();
        return;
      }
      sparkle(player);
    }
  })());
}

function sparkle(player) {
  const at = player.getLocation();
  for (const [x, y] of ripeOf(player) ?? []) {
    if (Math.max(Math.abs(at.getX() - x), Math.abs(at.getY() - y)) > SPARKLE.range) continue;
    player.getPacketSender().sendGraphic(new core.Graphic(SPARKLE.id, 0, SPARKLE.height), new core.Location(x, y, 0));
  }
}

function setBusy(player, on) {
  const id = core.CacheDefinitions.getVarbitId("busy");
  if (id != null) player.getPacketSender().sendVarbit(id, on ? 1 : 0);
}

function pick({ player, object }) {
  const at = object?.getLocation?.();
  if (!at || picking.has(player)) return true;
  const x = at.getX(), y = at.getY();
  if (ripeOf(player) === null && inVineyards(x, y)) ripen(player);
  const ripe = ripeOf(player) ?? [];
  if (!ripe.some(([rx, ry]) => rx === x && ry === y)) {
    player.sendMessage(UNRIPE);
    return true;
  }
  if (!hasBarrel(player)) {
    player.sendMessage(NO_BARREL);
    return true;
  }
  if (grapes(player) >= SETS) {
    player.sendMessage(CHECK_FULL);
    return true;
  }
  picking.add(player);
  setBusy(player, true);
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("picking_mid_short")));
  let tick = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      if (!player.isRegistered()) {
        this.stop();
        return;
      }
      if (tick === 1) player.getPacketSender().sendSoundEffect(PICK_SOUND.id, 1, PICK_SOUND.delay);
      if (tick < 2) return;
      this.stop();
      const left = (ripeOf(player) ?? []).filter(([rx, ry]) => rx !== x || ry !== y);
      if (!hasBarrel(player) || left.length === (ripeOf(player) ?? []).length) return;
      player.setAttribute(RIPE_ATTRIBUTE, left);
      const sets = grapes(player) + 1;
      player.setAttribute(GRAPES_ATTRIBUTE, sets);
      player.sendMessage(sets >= SETS ? FULL : PICKED(sets));
    }
    stop() {
      super.stop();
      if (!picking.delete(player)) return;
      setBusy(player, false);
    }
  })());
  return true;
}

function check({ player }) {
  const sets = grapes(player);
  player.sendMessage(sets <= 0 ? CHECK_EMPTY : sets >= SETS ? CHECK_FULL : CHECK_SOME(sets));
  return true;
}

/** The full-barrel conversation, when the barrel carried is full. */
function variant({ player, npcId }) {
  if (npcId !== FOREMAN_NPC_ID) return null;
  return hasBarrel(player) && grapes(player) >= SETS ? FULL_VARIANT : null;
}

/** "Great work! Here, keep some grapes as payment.": the payment, on the line's own tick. */
function line(request) {
  if (request.npcId !== FOREMAN_NPC_ID || request.text !== PAYMENT_LINE) return;
  request.before = () => handIn(request.player);
}

function handIn(player) {
  if (!hasBarrel(player) || grapes(player) < SETS) return;
  player.setAttribute(GRAPES_ATTRIBUTE, 0);
  const payment = new core.Item(core.ItemIdentifiers.GRAPES_2, PAYMENT);
  // Ours (no recording with a full pack): what doesn't fit lands at the player's feet, theirs.
  if (player.getInventory().getAddableAmount(payment) >= PAYMENT) player.getInventory().adds(payment.getId(), PAYMENT);
  else {
    core.ItemOnGroundManager.register(new core.ItemOnGround(core.GroundItemState.SEEN_BY_PLAYER, player.getUsername(),
      player.getLocation().clone(), payment, false, -1, player.getPrivateArea?.() ?? null));
  }
  ripen(player);
  api.emitCustomEvent("vineyard:barrel-handed-in", { player });
}

module.exports = {
  name: "Vineyard",
  description: "Aldarin's vineyard: the foreman's grape barrel, picking four sparkling ripe grapevines into it, and the full barrel's payment.",
  members: true,
  _test: { barrelCondition, giveBarrel, pick, check, variant, line, handIn, ripen, arrived, vineTiles, BARREL_RECEIVED_ATTRIBUTE, RIPE_ATTRIBUTE, GRAPES_ATTRIBUTE, PICKED, FULL, UNRIPE, CHECK_EMPTY, CHECK_FULL, PAYMENT_LINE, FULL_VARIANT },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.persistAttribute(BARREL_RECEIVED_ATTRIBUTE, false);
    pluginApi.persistAttribute(RIPE_ATTRIBUTE);
    pluginApi.persistAttribute(GRAPES_ATTRIBUTE, 0);
    pluginApi.onNpcDialogueCondition(barrelCondition);
    pluginApi.onNpcDialogueVariant(variant);
    pluginApi.onCustomEvent("npc-dialogue:action", giveBarrel);
    pluginApi.onCustomEvent("npc-dialogue:line", line);
    pluginApi.onObjectInteraction(VINE_NAME, { Pick: pick });
    pluginApi.onItemAction("Grape barrel", { Check: check });
    pluginApi.onPlayerMapSquareChange?.(({ player }) => arrived(player));
    pluginApi.onPlayerLogin(({ player }) => arrived(player));
  },
};
