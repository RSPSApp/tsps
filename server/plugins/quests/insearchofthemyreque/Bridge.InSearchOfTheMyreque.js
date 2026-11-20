/**
 * In Search of the Myreque: the Hollows rope bridge, as live plays it (rsprox capture of a full playthrough, revision 242,
 * docs/in-search-of-the-myreque.md; ticks are that recording's).
 *
 * - The trees (loc 5003, shown by varbit 3928 as "Tree" with Climb, op 2, until every rung is repaired, then with
 *   Cross-bridge, op 1): human_reachforladder (828) on the click, "You climb up the tree." and the move up the next tick
 *   (ticks 665-666, 835-836); human_pickupfloor (827) with "You climb down the tree." and the move down the next tick
 *   (ticks 684-685, 841-842). Up from the south bank lands on (3502,3427), down from the top rung lands on (3502,3432).
 * - A broken rung's Repair (locs 26245-26247, varbits 176-178): pest_repair_quick (15168) and hammer_wood (2101) three
 *   times, 0, 20 and 40 client cycles apart, on the click; three ticks later "You repair a section of the bridge.", one
 *   plank and 75 steel nails go, the rung's varbit and its bit of route_bridgecomplete (3928) are set, and the player
 *   walks onto the rung (ticks 668-681: 3928 goes 1, 3, 7).
 * - A repaired bridge is walked along (tick 837: (3502,3427) to (3502,3430)). The map keeps the broken rungs' floor
 *   decoration clipping for everyone, so a player on the bridge is in their own area that clears it on their repaired
 *   rungs and the landing; it counts as the main world, so nobody is hidden. Broken rungs still block.
 * - Completing the quest sets every rung (tick 1617), so the bridge stays repaired afterwards.
 */
const RUNG_VARBITS = [176, 177, 178];
const BRIDGE_COMPLETE_VARBIT = 3928; // route_bridgecomplete, one bit per repaired rung
const CLIMB_UP_ANIMATION = 828; // human_reachforladder
const CLIMB_DOWN_ANIMATION = 827; // human_pickupfloor
const REPAIR_ANIMATION = 15168; // pest_repair_quick
const HAMMER_SOUND = 2101; // hammer_wood
const HAMMER_SOUND_DELAYS = [0, 20, 40];
const REPAIR_TICKS = 3;
const NAILS_PER_RUNG = 75;
const FLOOR_DECORATION_CLIP = 0x40000;

module.exports = function createMyrequeBridge(api, { quest, attribute, stageReachedHollows }) {
  const { Animation, Boundary, CountdownTask, ItemIdentifiers, Location, PrivateArea, RegionManager, TaskManager } = api.core;

  const BRIDGE_X = 3502;
  const LANDING_Y = 3427; // loc 5002, "Rope bridge"
  const RUNG_Y = [3428, 3429, 3430]; // rungs 26245, 26246, 26247
  const SOUTH_TREE_Y = 3426;
  const NORTH_TREE_Y = 3431;
  const SOUTH_BANK = { x: 3502, y: 3425 };
  const NORTH_BANK = { x: 3502, y: 3432 };
  const RUNG_LOC_VARBITS = new Map([[26245, 176], [26246, 177], [26247, 178]]);

  function bits(player) {
    if (quest.isComplete(player)) return 0b111;
    return (Number(player.getAttribute(attribute)) || 0) & 0b111;
  }
  const rungRepaired = (player, varbit) => (bits(player) & (1 << (varbit - RUNG_VARBITS[0]))) !== 0;
  const repaired = (player) => bits(player) === 0b111;

  function send(player) {
    const value = bits(player);
    const sender = player.getPacketSender();
    RUNG_VARBITS.forEach((varbit, index) => { if (value & (1 << index)) sender.sendVarbit(varbit, 1); });
    if (value) sender.sendVarbit(BRIDGE_COMPLETE_VARBIT, value);
  }

  /** The bridge tile a player stands on is open to them when it is the landing or one of their repaired rungs. */
  function openFor(player, x, y) {
    if (x !== BRIDGE_X) return false;
    if (y === LANDING_Y) return true;
    const index = RUNG_Y.indexOf(y);
    return index >= 0 && rungRepaired(player, RUNG_VARBITS[index]);
  }

  /** One player's walk along the bridge: the map's clipping, without the floor decoration on the tiles open to them. */
  class BridgeArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(BRIDGE_X, BRIDGE_X, LANDING_Y, RUNG_Y[RUNG_Y.length - 1], 0)]);
      this.owner = owner;
    }
    getName() { return "Hollows rope bridge"; }
    countsAsMainWorld() { return true; }
    hasClip(location) {
      return location.getZ() === 0 && openFor(this.owner, location.getX(), location.getY()) || super.hasClip(location);
    }
    getClip(location) {
      if (super.hasClip(location)) return super.getClip(location);
      const region = RegionManager.getRegion(location.getX(), location.getY());
      const clip = region?.getClip(location.getX(), location.getY(), location.getZ()) ?? 0;
      return openFor(this.owner, location.getX(), location.getY()) ? clip & ~FLOOR_DECORATION_CLIP : clip;
    }
  }

  function onBridge(player) {
    const at = player.getLocation();
    return at.getZ() === 0 && at.getX() === BRIDGE_X && at.getY() >= LANDING_Y && at.getY() <= RUNG_Y[RUNG_Y.length - 1];
  }

  function enterBridge(player) {
    const area = player.getArea?.();
    if (area instanceof BridgeArea && area.owner === player) return;
    new BridgeArea(player).enter(player);
  }

  function climb(player, up, landing, message) {
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(up ? CLIMB_UP_ANIMATION : CLIMB_DOWN_ANIMATION));
    TaskManager.submit(new CountdownTask(player, 1, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.sendMessage(message);
      player.moveTo(new Location(landing.x, landing.y, 0));
      if (up) enterBridge(player);
    }));
  }

  /**
   * Either tree, from either side. The south tree climbs between the south bank and the landing; the north tree between
   * the top rung and the north bank. Ours: the north tree is refused until every rung is repaired (no capture climbs it
   * earlier), with the gate's old text; the "no reason" refusal before the Hollows is also ours.
   */
  function climbTree(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < stageReachedHollows && !quest.isComplete(player)) {
      player.sendMessage("You have no reason to cross here.");
      return;
    }
    const tree = event.location ?? event.object?.getLocation?.();
    const treeY = tree?.y ?? tree?.getY?.() ?? player.getLocation().getY();
    const north = treeY === NORTH_TREE_Y;
    const y = player.getLocation().getY();
    if (north) {
      if (!repaired(player)) {
        player.sendMessage("This bridge run looks broken; you would have nowhere to stand. The southern side of the rope bridge looks much less damaged.");
        return;
      }
      const up = y >= NORTH_TREE_Y;
      climb(player, up, up ? { x: BRIDGE_X, y: RUNG_Y[RUNG_Y.length - 1] } : NORTH_BANK,
        up ? "You climb up the tree." : "You climb down the tree.");
      return;
    }
    const up = y <= SOUTH_TREE_Y;
    climb(player, up, up ? { x: BRIDGE_X, y: LANDING_Y } : SOUTH_BANK, up ? "You climb up the tree." : "You climb down the tree.");
  }

  const held = (player, itemId, amount) => player.getInventory().getAmount(itemId) >= amount;

  /** Repair on a broken rung (the op the rung's varbit shows). Ours: the two refusals keep the old texts. */
  function repairRung(event) {
    const { player, objectId } = event;
    event.handled = true;
    if (quest.getStage(player) < stageReachedHollows) return;
    const varbit = RUNG_LOC_VARBITS.get(objectId) ?? RUNG_VARBITS.find((value) => !rungRepaired(player, value));
    if (varbit === undefined || rungRepaired(player, varbit)) {
      player.sendMessage("This bridge run already looks fixed, that's why you're able to stand on it.");
      return;
    }
    const { PLANK, STEEL_NAILS, HAMMER } = ItemIdentifiers;
    if (!held(player, PLANK, 1) || !held(player, STEEL_NAILS, NAILS_PER_RUNG) || !held(player, HAMMER, 1)) {
      player.sendMessage("You don't have the required materials to fix this part of the bridge.");
      return;
    }
    const rung = event.location ?? event.object?.getLocation?.();
    const rungX = rung?.x ?? rung?.getX?.(), rungY = rung?.y ?? rung?.getY?.();
    const sender = player.getPacketSender();
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(REPAIR_ANIMATION));
    for (const delay of HAMMER_SOUND_DELAYS) sender.sendSound(HAMMER_SOUND, 1, delay);
    TaskManager.submit(new CountdownTask(player, REPAIR_TICKS, () => {
      player.getMovementQueue().setBlockMovement(false);
      if (rungRepaired(player, varbit) || !held(player, PLANK, 1) || !held(player, STEEL_NAILS, NAILS_PER_RUNG)) return;
      player.getInventory().deleteNumber(PLANK, 1);
      player.getInventory().deleteNumber(STEEL_NAILS, NAILS_PER_RUNG);
      const value = bits(player) | (1 << (varbit - RUNG_VARBITS[0]));
      player.setAttribute(attribute, value);
      sender.sendVarbit(varbit, 1).sendVarbit(BRIDGE_COMPLETE_VARBIT, value);
      player.sendMessage("You repair a section of the bridge.");
      player.performAnimation(new Animation(-1));
      // Onto the rung just repaired, a normal walk step: the bridge area now has it open.
      if (Number.isInteger(rungX) && Number.isInteger(rungY) && onBridge(player)) {
        enterBridge(player);
        const here = player.getLocation();
        const dx = rungX - here.getX(), dy = rungY - here.getY();
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy)) player.getMovementQueue().walkStep(dx, dy);
      }
    }));
  }

  /** A player saved on the bridge is put back in their bridge area, so they can walk off it again. */
  function login(player) {
    send(player);
    if (onBridge(player)) enterBridge(player);
  }

  return { climbTree, repairRung, repaired, rungRepaired, send, login, onBridge, BridgeArea };
};
