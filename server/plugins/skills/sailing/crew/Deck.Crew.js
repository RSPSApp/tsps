// The crew aboard, as live (rsprox, boarding a skiff with Jobless Jim and Cabin Boy Jenkins):
// boarding brings the crew in the first slots, as many as the boat holds (table 166
// `crew_capacity`: raft 0, skiff 2, sloop 5), onto the boarding tile as their ship NPCs, which
// show Command to the captain (sidepanel role 10). The sidepanel lists them; each goes back to
// the job they had (Wiki: crew remember their jobs), and the idle ones wander the deck. Leaving
// takes them off; disembarking at a dock leaves the first slot's crewmate waiting on the docks
// (varbit 19503) while the player is ashore.
const common = require("./Common.Crew");
const lines = require("./Lines.Crew");
const assign = require("./Assign.Crew");
const { boatType } = require("../SailingContent.Sailing");

const { POSITION, VARBIT } = common;
/** An idle crewmate steps somewhere new about this often a tick (shortcut: live walks them a lot). */
const WANDER_CHANCE = 1 / 8;
const WANDER_RANGE = 3;
/** Idle chatter: about a line every 220 ticks (rsprox: Jobless Jim, 5,783 idle lines in 1.26M ticks in view). */
const CHATTER_CHANCE = 1 / 220;
const TOO_MANY = "One or more members of your crew cannot board this boat due to its limited size.";
/** The sidepanel's crew tab: its radio buttons show the players aboard (0) or the crew (2). */
const SIDEPANEL_GROUP = 937;
const CREW_RADIO_BUTTONS = 38;
const VARBIT_CREW_PLAYER_VIEW = 19234;

let pluginApi;

/** A job saved for a slot that this boat can't offer (another boat's facility) is idle here. */
function validPosition(owned, member) {
  if (member.position === POSITION.IDLE) return POSITION.IDLE;
  const job = assign.jobAt(owned, member.position);
  const [stat, level] = job?.requirement ?? [];
  if (!job || (stat && common.statOf(owned, member.crew, stat) < level)) return POSITION.IDLE;
  return member.position;
}

/** Puts the crew aboard: spawned on the boarding tile, listed on the sidepanel, back at work. */
function bringAboard(player, boat, owned) {
  const { BoatManager } = common.core();
  const spec = BoatManager.getSpec(boat);
  const deck = BoatManager.getDeck(boat);
  if (!spec || !deck || common.crewAboard(boat).length) return;
  const capacity = assign.crewCapacity(owned);
  const state = common.state(player);
  // After "You board your boat." (rsprox: the same tick there; the gangplank sends its message
  // after boarding here, so this waits for the deck).
  if (state.slots.filter(Boolean).length > capacity) {
    player.getPacketSender().sendTypedMessage(common.core().ChatType.SPAM, TOO_MANY);
  }
  const members = [];
  for (let slot = 0; slot < common.MAX_SLOTS && members.length < capacity; slot++) {
    const crew = common.byId(state.slots[slot]);
    if (!crew || crew.shipNpc < 0) continue;
    const npc = pluginApi.spawnNpc({
      id: crew.shipNpc,
      x: boat.deckBaseX + spec.boardingTile.x,
      y: boat.deckBaseY + spec.boardingTile.y,
      z: 0,
      owner: player,
    });
    if (!npc) continue;
    // Crew walk through the players and each other on a crowded deck, as followers do, or one
    // standing in the way would hold them off their job until it moved.
    npc.setFlag?.(common.core().NPC.WALK_THROUGH_ENTITIES_FLAG, true);
    deck.enter(npc);
    members.push({ slot, crew, npc, position: state.positions[slot] });
  }
  common.setCrewAboard(boat, members);
  for (const member of members) member.position = validPosition(owned, member);
  common.update(player, (crew) => {
    crew.onDock = false;
    for (const member of members) crew.positions[member.slot] = member.position;
  });
  sendSidepanel(player, members);
  for (const member of members) assign.startJob(player, boat, member, { resumed: true });
  if (members.length) wander(player, boat);
}

/** The sidepanel's crew list: who is aboard in each slot, and where they work. */
function sendSidepanel(player, members) {
  const sender = player.getPacketSender();
  for (let slot = 0; slot < common.MAX_SLOTS; slot++) {
    const member = members.find((candidate) => candidate.slot === slot);
    sender.sendVarbit(VARBIT.SIDEPANEL_SLOT0 + slot, member ? member.crew.id : 0);
    sender.sendVarbit(VARBIT.SIDEPANEL_SLOT0_POSITION + slot, member ? member.position : 0);
  }
}

function walkableTiles(boat, owned) {
  return boatType(owned.type)?.walkableDeck ?? [];
}

/** Idle crewmates walk the deck and say something now and then, for as long as the boat sails. */
function wander(player, boat) {
  const { BoatManager, Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, boat, false); }
    execute() {
      const members = common.crewAboard(boat);
      const owned = common.core().Sailing.instanceAboard(player) === boat ? common.core().Sailing.activeBoat(player) : undefined;
      if (!BoatManager.getSpec(boat) || !members.length || !owned) return this.stop();
      for (const member of members) {
        if (member.position !== POSITION.IDLE || member.walk) continue;
        if (Math.random() < CHATTER_CHANCE) lines.say(member.npc, member.crew, "idle");
        if (member.npc.getMovementQueue().size() > 0 || Math.random() >= WANDER_CHANCE) continue;
        const here = member.npc.getLocation();
        const near = walkableTiles(boat, owned)
          .map((tile) => ({ x: boat.deckBaseX + tile.x, y: boat.deckBaseY + tile.y }))
          .filter((tile) => Math.max(Math.abs(tile.x - here.getX()), Math.abs(tile.y - here.getY())) <= WANDER_RANGE);
        const target = near[Math.floor(Math.random() * near.length)];
        if (target) common.walkTo(member.npc, target.x, target.y);
      }
    }
  })());
}

/** A tick after boarding, once the deck is in place (as the sidepanel waits). */
function onBoarded({ player, boat, owned }) {
  const { Sailing, CountdownTask, TaskManager } = common.core();
  // The shipyard's preview boat is not sailed: no crew there.
  if (Sailing.instanceAboard(player) !== boat || !owned) return;
  TaskManager.submit(new CountdownTask(player, 1, () => {
    if (Sailing.instanceAboard(player) !== boat) return;
    bringAboard(player, boat, owned);
  }));
}

/** The crew leave with the boat; disembarking at a dock leaves the first slot's crewmate there. */
function onLeft({ player, boat, reason }) {
  const members = common.crewAboard(boat);
  if (!members.length && reason !== "disembark") return;
  // The boat has gone: nothing is left to stop or lower.
  boat.helmCrew = undefined;
  for (const member of members) {
    assign.stopJob(player, boat, member);
    pluginApi.removeNpc(member.npc);
  }
  common.setCrewAboard(boat, []);
  const state = common.state(player);
  state.onDock = reason === "disembark" && state.slots[0] !== 0;
  player.setAttribute(common.CREW_ATTRIBUTE, state);
  if (reason === "logout") return;
  sendSidepanel(player, []);
  common.sendVarbits(player);
}

function sendOnLogin({ player }) {
  common.sendVarbits(player);
}

/** The crew tab's radio buttons (rsprox): the players aboard (button 0) or the crew (button 2). */
function switchCrewView(event) {
  if (event.groupId !== SIDEPANEL_GROUP || event.childId !== CREW_RADIO_BUTTONS) return;
  if (event.slot !== 0 && event.slot !== 2) return;
  event.handled = true;
  event.player.getPacketSender().sendVarbit(VARBIT_CREW_PLAYER_VIEW, event.slot === 2 ? 1 : 0);
}

function attach(api) {
  common.init(api);
  pluginApi = api;
  api.persistAttribute(common.CREW_ATTRIBUTE, {});
  api.onPlayerLogin(sendOnLogin);
  api.onCustomEvent("sailing:boarded", onBoarded);
  api.onCustomEvent("sailing:left", onLeft);
  api.onInterfaceActionClick(switchCrewView);
}

module.exports = attach;
module.exports.bringAboard = bringAboard;
module.exports.sendSidepanel = sendSidepanel;
