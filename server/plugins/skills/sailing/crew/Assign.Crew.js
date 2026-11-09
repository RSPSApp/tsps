// Giving crewmates jobs aboard, as live (rsprox): the captain's Command on a crewmate opens
// "Crewmate Assignation: <name> (H# P# D#)" with the helm, repairs, the boat's crew facilities
// ("Other facility." when there is more than one) and idle, "Current - " marking their job; the
// sidepanel's crew button on a facility row picks a crewmate for it instead. A job their stat is
// too low for: "Your crewmate requires N <stat> to use that facility." Otherwise the captain
// orders them ("<name>, take control of the helm and sails!", "<name>, take a rest!"), the slot's
// position varbit is set and the crewmate walks to the facility and starts work there.
const common = require("./Common.Crew");
const helmCrew = require("./Helm.Crew");
const salvageCrew = require("./Salvage.Crew");
const cannonCrew = require("./Cannon.Crew");
const repairCrew = require("./Repair.Crew");
const lines = require("./Lines.Crew");
const cargo = require("../Cargo.Sailing");
const facilities = require("../BoatFacilities.Sailing");
const { partOptions, partTiers } = require("../BoatParts.Sailing");
const { boatType } = require("../SailingContent.Sailing");

const { POSITION, STAT, STAT_NAMES, VARBIT } = common;
const BOAT_TABLE = 166;
const STEERING_TABLE = 181;
const FACILITY_TABLE = 176;
const SIDEPANEL_GROUP = 937;
const SIDEPANEL_FACILITIES_CHILD = 25;
const SIDEPANEL_ASSIGNATION_CHILD = 20;
const SIDEPANEL_ASSIGNATION_BACK_CHILD = 29;
/** Each sidepanel facility row has four buttons; the fourth picks a crewmate for it. */
const ROW_BUTTONS = 4;
const CREW_BUTTON = 3;
/** Facility rows: the sails, the helm, hull repairs, then hotspot n at 3 + n (cache script 9027). */
const ROW_SAILS = 0;
const ROW_HELM = 1;
const ROW_REPAIRS = 2;
const ROW_HOTSPOT0 = 3;
/** Hull repairs need Deckhandiness 1 (every capture: "Repairs (D1)."); the hull tables hold none. */
const REPAIRS_REQUIREMENT = [STAT.DECKHANDINESS, 1];
/** A hotspot's side (table 166 hotspot tuples): 1 is starboard (west, facing the bow), 3 port (rsprox). */
const SIDE_NAMES = { 1: "Starboard side", 3: "Port side" };
/** Ticks a crewmate may take to reach their facility before they're placed there. */
const WALK_TIMEOUT = 20;
/** Repairs with no repair kits aboard: refused 2 ticks after the order, 1 when back at it after boarding (rsprox). */
const NO_KITS = "Your crew can only make repairs if the boat has repair kits in its cargo hold.";
const NO_KITS_TICKS = 2;
const NO_KITS_RESUMED_TICKS = 1;

function cache() {
  return common.core().CacheDefinitions;
}

function boatRow(owned) {
  const row = boatType(owned.type)?.sidepanelBoatType;
  return row === undefined ? undefined : cache().getDbRow(row);
}

function boatField(owned, name) {
  const column = cache().getDbColumn(BOAT_TABLE, name);
  return column === null ? 0 : boatRow(owned)?.int(column, 0) ?? 0;
}

/** How many crewmates a boat holds (table 166 `crew_capacity`: raft 0, skiff 2, sloop 5). */
function crewCapacity(owned) {
  return boatField(owned, "crew_capacity");
}

function requirementOf(table, row) {
  const column = cache().getDbColumn(table, "crew_stat_requirement");
  const values = column === null ? [] : cache().getDbRow(row)?.column(column) ?? [];
  return values.length >= 2 ? [Number(values[0]), Number(values[1])] : undefined;
}

/** The helm's job: its label, position and Helmsmanship need (the built helm's row, table 181). */
function helmJob(owned) {
  const combined = boatField(owned, "combined_navigation") === 1;
  const steering = partOptions(owned.type, "helm")[partTiers(owned).steering ?? 0];
  return {
    label: combined ? "Helm and sails" : "Helm",
    position: combined ? POSITION.HELM_AND_SAILS : POSITION.HELM,
    requirement: steering === undefined ? undefined : requirementOf(STEERING_TABLE, steering),
  };
}

/**
 * The facilities on a boat's hotspots a crewmate can work (table 176 with a
 * `crew_stat_requirement`), in the order live lists them: by `crew_facility` (wind catchers,
 * cannons, then hooks), starboard before port.
 */
function crewFacilities(owned) {
  const crewColumn = cache().getDbColumn(FACILITY_TABLE, "crew_facility");
  const sided = boatField(owned, "same_facilities_port_and_starboard") === 1;
  const hotspots = facilities.hotspotsOf(owned.type);
  const jobs = [];
  for (const hotspot of hotspots) {
    const row = facilities.facilityAt(owned, hotspot.id);
    if (row === undefined) continue;
    const requirement = requirementOf(FACILITY_TABLE, row);
    if (!requirement) continue;
    const name = facilities.facilityRequirements(row).name;
    const side = sided ? SIDE_NAMES[hotspot.side] : undefined;
    jobs.push({
      label: side ? `${side} ${name.toLowerCase()}` : name,
      position: POSITION.HOTSPOT0 + hotspot.id,
      requirement,
      hotspot: hotspot.id,
      kind: crewColumn === null ? 0 : cache().getDbRow(row)?.int(crewColumn, 0) ?? 0,
      side: hotspot.side,
    });
  }
  const sideOrder = (side) => (side === 1 ? 0 : side === 3 ? 1 : -1);
  return jobs.sort((a, b) => b.kind - a.kind || sideOrder(a.side) - sideOrder(b.side) || a.hotspot - b.hotspot);
}

function repairsJob() {
  return { label: "Repairs", position: POSITION.REPAIRS, requirement: REPAIRS_REQUIREMENT };
}

/** The job at a position on a boat, or undefined. */
function jobAt(owned, position) {
  if (position === POSITION.HELM || position === POSITION.HELM_AND_SAILS || position === POSITION.SAILS) {
    return helmJob(owned);
  }
  if (position === POSITION.REPAIRS) return repairsJob();
  return crewFacilities(owned).find((job) => job.position === position);
}

function optionLabel(job, current) {
  const [stat, level] = job.requirement ?? [];
  const needs = stat ? ` (${{ 1: "H", 2: "P", 3: "D" }[stat]}${level})` : "";
  return `${current ? "Current - " : ""}${job.label}${needs}.`;
}

function ownedAboard(player, boat) {
  return common.core().Sailing.instanceAboard(player) === boat ? common.core().Sailing.activeBoat(player) : undefined;
}

/** The captain's Command on a crewmate: the assignation menu. */
function command(event) {
  const { player, npc } = event;
  const found = common.memberFor(npc);
  if (!found || found.boat.ownerPlayerId !== player.getIndex()) return;
  const owned = ownedAboard(player, found.boat);
  if (!owned) return;
  openMenu(player, found.boat, owned, found.member);
}

let pluginApi;

/** A chatbox menu of up to five choices, four and "More..." when there are more. */
function prompt(player, title, choices, offset = 0) {
  const more = choices.length - offset > 5;
  const shown = choices.slice(offset, offset + (more ? 4 : 5));
  const pairs = shown.flatMap(({ label, choose }) => [label, () => {
    player.getPacketSender().sendVarbit(VARBIT.BUSY, 0);
    choose();
  }]);
  if (more) pairs.push("More...", () => prompt(player, title, choices, offset + 4));
  player.getPacketSender().sendVarbit(VARBIT.BUSY, 1);
  pluginApi.sendMultiChatboxPrompt(player, title, ...pairs);
}

function openMenu(player, boat, owned, member) {
  const title = `Crewmate Assignation: ${member.crew.name} (${common.statLine(member.crew)})`;
  const current = member.position;
  const helm = helmJob(owned);
  const facilityJobs = crewFacilities(owned);
  const choice = (job) => ({ label: optionLabel(job, job.position === current), choose: () => order(player, boat, owned, member, job) });
  const choices = [choice(helm), choice(repairsJob())];
  if (facilityJobs.length === 1) choices.push(choice(facilityJobs[0]));
  else if (facilityJobs.length > 1) {
    choices.push({ label: "Other facility.", choose: () => prompt(player, title, facilityJobs.map(choice)) });
  }
  const idle = { label: "Idle", position: POSITION.IDLE };
  choices.push({ label: current === POSITION.IDLE ? "Current - Idle." : "Idle.", choose: () => order(player, boat, owned, member, idle) });
  prompt(player, title, choices);
}

/** What the captain says giving an order (rsprox). */
function orderLine(member, job) {
  if (job.position === POSITION.IDLE) return `${member.crew.name}, take a rest!`;
  if (job.position === POSITION.REPAIRS) return `${member.crew.name}, make repairs!`;
  return `${member.crew.name}, take control of the ${job.label.toLowerCase()}!`;
}

/** Gives a crewmate a job: checks their stat, frees the facility, orders them and sends them there. */
function order(player, boat, owned, member, job) {
  if (common.core().Sailing.instanceAboard(player) !== boat || !common.crewAboard(boat).includes(member)) return;
  const [stat, level] = job.requirement ?? [];
  if (stat && common.statOf(owned, member.crew, stat) < level) {
    player.sendMessage(`Your crewmate requires ${level} ${STAT_NAMES[stat]} to use that facility.`);
    return;
  }
  if (job.kind === cannonCrew.CREW_FACILITY_CANNON && cannonCrew.refuseIfManned(player, boat, job.hotspot)) return;
  if (job.position !== POSITION.IDLE) {
    for (const other of common.crewAboard(boat)) {
      if (other !== member && other.position === job.position) setPosition(player, boat, other, POSITION.IDLE);
    }
  }
  player.forceChat(orderLine(member, job));
  setPosition(player, boat, member, job.position);
}

/** Sets a crewmate's position (saved and sent) and starts the job there. */
function setPosition(player, boat, member, position) {
  // Ordered to the helm again, they keep it: the boat sails on (rsprox).
  const keepHelm = isHelm(position) && boat.helmCrew === member.npc;
  stopJob(player, boat, member, { keepHelm });
  member.position = position;
  common.update(player, (crew) => {
    crew.positions[member.slot] = position;
  });
  player.getPacketSender().sendVarbit(VARBIT.SIDEPANEL_SLOT0_POSITION + member.slot, position);
  startJob(player, boat, member);
}

function stopJob(player, boat, member, { keepHelm = false } = {}) {
  const job = member.job;
  member.job = undefined;
  member.walk?.stop();
  member.walk = undefined;
  job?.stop();
  if (!keepHelm) helmCrew.release(player, boat, member);
}

/** The captain takes the helm from their crewmate, who goes idle (rsprox: position 4 -> 0). */
function helmTaken({ player, boat }) {
  const member = common.crewAboard(boat).find((candidate) => candidate.npc === boat.helmCrew);
  if (!member) return;
  helmCrew.release(player, boat, member, { stop: false });
  setPosition(player, boat, member, POSITION.IDLE);
}

/** The captain deploys the hook a crewmate works: the crewmate leaves it (rsprox). */
function hookTaken({ player, boat, hotspot }) {
  const member = common.crewAboard(boat).find((candidate) => candidate.position === POSITION.HOTSPOT0 + hotspot);
  if (member) setPosition(player, boat, member, POSITION.IDLE);
}

/**
 * Where a crewmate works a job: the helm's stand tile (boats.json `helmStand`, as players use),
 * or the deck tile inboard of a hotspot's facility, facing it; undefined for none (idle).
 */
function workTile(boat, owned, position) {
  const type = boatType(owned.type);
  if (position === POSITION.HELM || position === POSITION.HELM_AND_SAILS || position === POSITION.SAILS) {
    const helm = type?.locs?.find((loc) => loc.helm === true);
    if (!helm) return undefined;
    return { x: helm.x + (type.helmStand?.x ?? 0), y: helm.y + (type.helmStand?.y ?? 0), faceBow: true };
  }
  // A hotspot's facility is worked from its own tile, facing out over the boat's side (rsprox:
  // Jobless Jim on a skiff's mithril hook at 3,2 and a sloop's at 2,5, facing west on the
  // starboard side; Jenkins east on the port side).
  if (position >= POSITION.HOTSPOT0) {
    const hotspot = facilities.hotspotsOf(owned.type)[position - POSITION.HOTSPOT0];
    if (!hotspot) return undefined;
    const outboard = hotspot.side === 1 ? -1 : hotspot.side === 3 ? 1 : 0;
    // A cannon blocks its own tile: it's manned from the tile inboard of it, facing it (rsprox:
    // Jittery Jim at 3876 facing a skiff's adamant cannon at 3875 on the starboard side).
    if (jobAt(owned, position)?.kind === cannonCrew.CREW_FACILITY_CANNON && outboard) {
      return { x: hotspot.x - outboard, y: hotspot.y, face: { x: hotspot.x, y: hotspot.y } };
    }
    return { x: hotspot.x, y: hotspot.y, face: outboard ? { x: hotspot.x + outboard, y: hotspot.y } : undefined };
  }
  if (position === POSITION.REPAIRS) return undefined;
  return undefined;
}

/**
 * Walks a crewmate to their job's tile, then starts it; a job with no tile starts where they are.
 * `resumed`: back at a job they had before boarding, rather than newly ordered to it.
 */
function startJob(player, boat, member, { resumed = false } = {}) {
  const owned = ownedAboard(player, boat);
  if (!owned || member.position === POSITION.IDLE) return;
  const tile = workTile(boat, owned, member.position);
  const begin = () => {
    member.walk = undefined;
    if (tile?.face) {
      const { Location } = common.core();
      member.npc.setPositionToFace(new Location(boat.deckBaseX + tile.face.x, boat.deckBaseY + tile.face.y, 0));
    }
    member.job = beginJob(player, boat, owned, member, resumed);
  };
  // The helm is taken as the order is given: the captain steers from then on (rsprox).
  if (isHelm(member.position)) helmCrew.claimHelm(player, boat, member);
  if (!tile) return begin();
  const { Location, Task, TaskManager } = common.core();
  const target = new Location(boat.deckBaseX + tile.x, boat.deckBaseY + tile.y, 0);
  const npc = member.npc;
  npc.getMovementQueue().reset();
  common.walkTo(npc, target.getX(), target.getY(), { run: true });
  let ticks = 0;
  const walk = new (class extends Task {
    constructor() { super(1, npc, false); }
    execute() {
      if (!npc.isRegistered?.() || !common.crewAboard(boat).includes(member)) return this.stop();
      const here = npc.getLocation();
      const arrived = here.getX() === target.getX() && here.getY() === target.getY();
      if (!arrived && ++ticks < WALK_TIMEOUT) {
        if (npc.getMovementQueue().size() === 0) common.walkTo(npc, target.getX(), target.getY(), { run: true });
        return;
      }
      // A crewmate who couldn't path there (another standing on the tile) steps over.
      if (!arrived) common.placeAt(npc, target);
      npc.setMovementSteps(1);
      this.stop();
      begin();
    }
  })();
  member.walk = walk;
  TaskManager.submit(walk);
}

function isHelm(position) {
  return position === POSITION.HELM || position === POSITION.HELM_AND_SAILS || position === POSITION.SAILS;
}

/** The work itself, once there: the helm, repairs, salvaging hooks and cannons; other facilities are manned only. */
function beginJob(player, boat, owned, member, resumed) {
  if (isHelm(member.position)) return helmCrew.work(player, boat, member, { setSail: !resumed });
  if (member.position === POSITION.REPAIRS) return checkRepairKits(player, boat, owned, member, resumed);
  const job = jobAt(owned, member.position);
  if (job?.kind === salvageCrew.CREW_FACILITY_HOOK) return salvageCrew.work(player, boat, owned, member, job.hotspot);
  if (job?.kind === cannonCrew.CREW_FACILITY_CANNON) return cannonCrew.work(player, boat, owned, member, job.hotspot);
  return undefined;
}

/**
 * Repairs need repair kits in the cargo hold. Without one the crewmate is sent back to idle:
 * "Your crew can only make repairs if the boat has repair kits in its cargo hold." and their own
 * line about it (rsprox). With kits they repair the boat (Repair.Crew.js) until the kits run out.
 */
function checkRepairKits(player, boat, owned, member, resumed) {
  if (cargo.repairKitUses(owned) > 0) {
    return repairCrew.work(player, boat, owned, member, () => {
      if (member.position !== POSITION.REPAIRS || !common.crewAboard(boat).includes(member)) return;
      player.sendMessage(NO_KITS);
      setPosition(player, boat, member, POSITION.IDLE);
      lines.say(member.npc, member.crew, "noRepairKits");
    });
  }
  const { CountdownTask, TaskManager } = common.core();
  const task = new CountdownTask(member.npc, resumed ? NO_KITS_RESUMED_TICKS : NO_KITS_TICKS, () => {
    if (member.position !== POSITION.REPAIRS || !common.crewAboard(boat).includes(member)) return;
    player.sendMessage(NO_KITS);
    setPosition(player, boat, member, POSITION.IDLE);
    lines.say(member.npc, member.crew, "noRepairKits");
  });
  TaskManager.submit(task);
  return { stop: () => task.stop() };
}

/** A facility row's crew button (937:25, fourth button): opens the sidepanel's crew picker. */
function openCrewPicker(event) {
  if (event.groupId !== SIDEPANEL_GROUP || event.childId !== SIDEPANEL_FACILITIES_CHILD) return;
  const slot = event.slot ?? -1;
  if (slot < 0 || slot % ROW_BUTTONS !== CREW_BUTTON) return;
  event.handled = true;
  const sender = event.player.getPacketSender();
  sender.sendVarbit(VARBIT.ASSIGNATION, 1);
  sender.sendVarbit(VARBIT.ASSIGNATION_FACILITY, Math.floor(slot / ROW_BUTTONS));
}

/** The facility row's position (cache script 9031). */
function rowPosition(owned, row) {
  if (row === ROW_SAILS || row === ROW_HELM) return helmJob(owned).position;
  if (row === ROW_REPAIRS) return POSITION.REPAIRS;
  return POSITION.HOTSPOT0 + (row - ROW_HOTSPOT0);
}

/** The crew picker: a crewmate (by slot, from 1) for the facility row, or back. */
function pickCrewmate(event) {
  if (event.groupId !== SIDEPANEL_GROUP) return;
  if (event.childId !== SIDEPANEL_ASSIGNATION_CHILD && event.childId !== SIDEPANEL_ASSIGNATION_BACK_CHILD) return;
  event.handled = true;
  const { player } = event;
  const sender = player.getPacketSender();
  const row = sender.getVarbit(VARBIT.ASSIGNATION_FACILITY);
  sender.sendVarbit(VARBIT.ASSIGNATION, 0);
  if (event.childId === SIDEPANEL_ASSIGNATION_BACK_CHILD) return;
  const boat = common.core().Sailing.instanceAboard(player);
  const owned = boat && ownedAboard(player, boat);
  if (!owned) return;
  const member = common.crewAboard(boat).find((candidate) => candidate.slot === (event.slot ?? 0) - 1);
  if (!member) return;
  const job = jobAt(owned, rowPosition(owned, row));
  if (job) order(player, boat, owned, member, job);
}

function attach(api) {
  common.init(api);
  pluginApi = api;
  api.onNpcsInteraction(common.all().map((crew) => crew.name), { Command: command });
  api.onInterfaceActionClick(openCrewPicker);
  api.onInterfaceActionClick(pickCrewmate);
  api.onCustomEvent("sailing:helm-taken", helmTaken);
  api.onCustomEvent("sailing:hook-taken", hookTaken);
  api.onCustomEvent("sailing:cannon-taken", hookTaken);
}

module.exports = attach;
module.exports.crewCapacity = crewCapacity;
module.exports.crewFacilities = crewFacilities;
module.exports.helmJob = helmJob;
module.exports.jobAt = jobAt;
module.exports.startJob = startJob;
module.exports.stopJob = stopJob;
module.exports.setPosition = setPosition;
module.exports.order = order;
module.exports.optionLabel = optionLabel;
module.exports.orderLine = orderLine;
module.exports.isHelm = isHelm;
