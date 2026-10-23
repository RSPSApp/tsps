"use strict";

/**
 * The Nexus: its doors, the way back from each boss, and the Alliance between bosses.
 *
 * Captured (spectator recordings, docs/fractured-archive.md):
 * - The Nexus has three sections of two doors, west (x 4113) and east (x 4141), at y 5584, 5597
 *   and 5610. Section 1's open on the Guardian's level (0) when it falls: "slightly", then
 *   "slightly opened" three ticks later. Back from a boss, the party is on level 2 beside the
 *   door it took, and the next section's doors are open there. After the third boss the Archive
 *   Door to Ocellus (4124,5621) opens.
 * - By the rooms they lead to: section 1 is Ezekiel (west) or Bork (east), section 2 Moia (west)
 *   or Dreadnoth (east), section 3 the Dagon'hai (west) or Xarth (east).
 * - After a boss, the Alliance Navigator ("Follow", "Quick-follow") leads the way back.
 * - Each visit has its own staff and lines ("There's no time to waste, pick a side!", and so
 *   on). The Quartermaster (Resupply) and his wheelbarrow are there after the second boss.
 * Estimates:
 * - Taking a door picks that side for the whole party, and the other door closes. The
 *   spectator never saw how a party chooses.
 * - "Enter" asks first, while "Quick-enter" doesn't.
 * - Moia's and the Dagon'hai's doors stay shut until their fights are captured.
 */

const path = require("path");
const fs = require("fs");
const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "fractured-archive.json"), "utf8")).hub;

const SIDES = { west: { x: 4113, face: 3, returnX: 4116 }, east: { x: 4141, face: 1, returnX: 4139 } };
/** The rooms each section's doors lead to; null where the fight isn't captured yet. */
const SECTIONS = {
  1: { y: 5584, west: "EZEKIEL", east: "BORK" },
  2: { y: 5597, west: null, east: "DREADNOTH" },
  3: { y: 5610, west: null, east: "XARTH" },
};
const OCELLUS_DOOR = { x: 4124, y: 5621, z: 2, face: 0 };
/** The Guardian's door opens three ticks after the kill's "slightly" (captured). */
const DOOR_OPENS = 3;
const NOT_OPEN = "That way isn't open yet.";
const OTHER_SIDE = "Your party has already gone the other way.";

function doorName(section, side, opened) {
  return `tfa_nexus_section${section}_door_${side}_slightly${opened ? "_opened" : ""}`;
}

function locId(name) {
  const id = Shared.core().CacheDefinitions.getLocId(name);
  if (id === null || id === undefined) throw new Error(`[FracturedArchive] no loc named ${name}`);
  return id;
}

/** Places a section's two doors in a room: open where they may be taken, otherwise closed. */
function placeSection(room, section, z, { open, opened = true }) {
  const placed = {};
  for (const [side, def] of Object.entries(SIDES)) {
    const leadsTo = SECTIONS[section][side];
    const taken = room.raid.path[section];
    const usable = open && leadsTo && (!taken || taken === side);
    const id = usable ? locId(doorName(section, side, opened)) : Shared.id("loc", "SECTION_DOOR");
    placed[side] = room.placeObject(id, { x: def.x, y: SECTIONS[section].y, z }, 10, def.face);
  }
  return placed;
}

/** The Nexus' doors in the Guardian's room (level 0): all shut until it falls. */
function placeGuardianDoors(room) {
  room.doors = {};
  for (const section of [1, 2, 3]) room.doors[section] = placeSection(room, section, 0, { open: false });
}

/** The Guardian has fallen: section 1's doors open on its level, as captured. */
function openFirstSection(room) {
  const swap = (opened) => {
    for (const object of Object.values(room.doors[1])) room.removeObject(object);
    room.doors[1] = placeSection(room, 1, 0, { open: true, opened });
  };
  swap(false);
  room.later(DOOR_OPENS, () => swap(true));
}

// ---------------------------------------------------------------- the Nexus between bosses

/**
 * Where the Nexus between bosses comes from: map square 64,87's levels 2 and 3. Live copies them
 * onto its instance's levels 0 and 1 (captured build_area). On the real map those levels stand
 * on the Guardian's, whose heights differ under the Archive Door's end, so drawn there that end
 * sinks a level and a half; copied as live does, the floor is level.
 */
const TEMPLATE = { x: 4096, y: 5568, plane: 2, chunks: 8 };
let NexusArea = null;

function nexusAreaClass() {
  if (NexusArea) return NexusArea;
  const { TemplatedInstanceArea } = Shared.core();
  NexusArea = class FracturedArchiveNexus extends TemplatedInstanceArea {
    constructor(raid) {
      super(TEMPLATE.chunks, TEMPLATE.chunks);
      for (let plane = 0; plane < 2; plane++) {
        for (let chunkX = 0; chunkX < TEMPLATE.chunks; chunkX++) {
          for (let chunkY = 0; chunkY < TEMPLATE.chunks; chunkY++) {
            this.setChunk(plane, chunkX, chunkY, {
              sourceChunkX: (TEMPLATE.x >> 3) + chunkX,
              sourceChunkY: (TEMPLATE.y >> 3) + chunkY,
              sourcePlane: TEMPLATE.plane + plane,
              rotation: 0,
            });
          }
        }
      }
      this.raid = raid;
    }

    getName() {
      return "The Fractured Archive";
    }

    allowSummonPet() {
      return false;
    }

    /** A logout here is saved on a real tile: the instance goes when the raid does. */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) {
        if (logout) mobile.setLocation(Shared.loc(Shared.TILE.LEAVE));
        this.raid.onAreaLeave(mobile.getAsPlayer(), logout);
      }
      super.postLeave(mobile, logout);
    }

    process() {
      this.raid.processOnce();
    }

    canTeleport(player) {
      Shared.mesbox(player, "You can't teleport out of the Archive.");
      return false;
    }

    canAttack() {
      return false;
    }
  };
  return NexusArea;
}

class HubRoom extends Raid.Room {
  constructor(raid, def) {
    super(raid, def);
    this.hubArea = new (nexusAreaClass())(raid);
  }

  get area() {
    return this.hubArea;
  }

  /** A Nexus tile (real map, level 2 or 3) as the instance's (level 0 or 1); instance tiles pass. */
  worldLoc(tile) {
    if (tile.getX) return tile;
    if (tile.x >= this.hubArea.getBaseX()) return Shared.loc(tile);
    return this.hubArea.tile(tile.x - TEMPLATE.x, tile.y - TEMPLATE.y, Math.max(0, (tile.z ?? TEMPLATE.plane) - TEMPLATE.plane));
  }

  /** An instance tile as the real map's. */
  templateTile(location) {
    return {
      x: location.getX() - this.hubArea.getBaseX() + TEMPLATE.x,
      y: location.getY() - this.hubArea.getBaseY() + TEMPLATE.y,
      z: location.getZ() + TEMPLATE.plane,
    };
  }

  spawn(npcId, tile, options) {
    const at = this.worldLoc(tile);
    return super.spawn(npcId, { x: at.getX(), y: at.getY(), z: at.getZ() }, options);
  }

  placeObject(objectId, tile, type, face) {
    const at = this.worldLoc(tile);
    return super.placeObject(objectId, { x: at.getX(), y: at.getY(), z: at.getZ() }, type, face);
  }

  destroy() {
    super.destroy();
    if (!this.hubArea.isDestroyed()) this.hubArea.destroy();
  }

  onBuild() {
    const raid = this.raid;
    const visit = String(raid.section);
    this.doors = {};
    for (const section of [1, 2, 3]) this.doors[section] = placeSection(this, section, 2, { open: section === raid.section + 1 });
    const ocellusOpen = raid.section >= 3;
    this.placeObject(Shared.id("loc", ocellusOpen ? "OCELLUS_DOOR_OPEN" : "OCELLUS_DOOR"), OCELLUS_DOOR, 10, OCELLUS_DOOR.face);
    this.staff = [];
    for (const member of DATA.visits[visit] ?? []) {
      const npcId = Shared.core().CacheDefinitions.getNpcId(member.npc);
      if (npcId === null || npcId === undefined) continue;
      const npc = this.spawn(npcId, { x: member.tile[0], y: member.tile[1], z: member.tile[2] }, { face: Shared.core().Direction[member.face].getId() });
      if (npc) this.staff.push({ npc, lines: member.lines ?? [] });
    }
    const barrow = DATA.wheelbarrow;
    if (barrow.visit === visit) this.placeObject(locId(barrow.loc), { x: barrow.tile[0], y: barrow.tile[1], z: barrow.tile[2] }, 10, barrow.face);
    this.repeat(DATA.linesEvery, () => {
      for (const { npc, lines } of this.staff) if (lines.length) npc.forceChat(Shared.randomOf(lines));
      return true;
    });
  }
}

/** The tile beside a door on the Nexus' level 2, where the way back from its boss arrives. */
function returnTile(section, side) {
  return { x: SIDES[side].returnX, y: SECTIONS[section].y + 2, z: 2 };
}

// ---------------------------------------------------------------- clicks

function raidHere(player) {
  const raid = Raid.raidOf(player);
  return raid && raid.contains(player) ? raid : null;
}

/** A loc's real-map tile: the Nexus instance's tiles map back to the template's. */
function realTile(raid, location) {
  const hub = raid.rooms.get("HUB");
  if (hub?.hubArea?.contains(location)) return hub.templateTile(location);
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

/** A section door: its section by row, its side by column (captured layout). */
function doorAt(raid, object) {
  const at = realTile(raid, object.getLocation());
  const section = Object.keys(SECTIONS).map(Number).find((key) => SECTIONS[key].y === at.y);
  const side = Object.keys(SIDES).find((key) => SIDES[key].x === at.x);
  return section && side ? { section, side } : null;
}

function takeDoor(event, quick) {
  const { player, object } = event;
  const raid = raidHere(player);
  const door = raid && doorAt(raid, object);
  if (!door) return false;
  const bossKey = SECTIONS[door.section][door.side];
  if (!bossKey || door.section !== raid.section + 1) {
    player.sendMessage(NOT_OPEN);
    return true;
  }
  const taken = raid.path[door.section];
  if (taken && taken !== door.side) {
    player.sendMessage(OTHER_SIDE);
    return true;
  }
  const go = () => {
    if (raid.over) return;
    if (!raid.path[door.section]) {
      raid.path[door.section] = door.side;
      closeOtherSide(raid, door);
    }
    raid.moveTo(player, bossKey);
  };
  if (quick) go();
  else Shared.options(player, "Enter this chamber?", "Yes.", go, "No.", () => {});
  return true;
}

/** Once a side is taken, the other door of that section closes for everyone (estimate). */
function closeOtherSide(raid, door) {
  const other = door.side === "west" ? "east" : "west";
  for (const room of raid.rooms.values()) {
    const doors = room.doors?.[door.section];
    if (!doors?.[other]) continue;
    const closed = room.replaceObject(doors[other], Shared.id("loc", "SECTION_DOOR"));
    doors[other] = closed;
  }
}

function enterDoor(event) {
  return takeDoor(event, false);
}

function quickEnterDoor(event) {
  return takeDoor(event, true);
}

/** The Archive Door to Ocellus, open once the third boss is beaten. */
function enterOcellus(event) {
  const { player, object } = event;
  const raid = raidHere(player);
  if (!raid || realTile(raid, object.getLocation()).y !== OCELLUS_DOOR.y) return false;
  if (raid.section < 3) {
    player.sendMessage(NOT_OPEN);
    return true;
  }
  raid.moveTo(player, "OCELLUS");
  return true;
}

/** The Alliance Navigator: back to the Nexus, beside the door the party took. */
function followNavigator(event) {
  const { player } = event;
  const raid = raidHere(player);
  const room = raid?.room;
  const section = room?.def.section;
  if (!section || !room.isCompleted()) return false;
  raid.moveTo(player, "HUB", returnTile(section, raid.path[section] ?? "east"));
  return true;
}

module.exports = function registerHub(api) {
  Shared.bind(api);
  Raid.registerRoom("HUB", HubRoom);
  api.onObjectInteraction("Door", { Enter: enterDoor, "Quick-enter": quickEnterDoor });
  api.onObjectInteraction("Archive Door", { Enter: enterOcellus, "Quick-enter": enterOcellus });
  api.onNpcInteraction("Alliance Navigator", { Follow: followNavigator, "Quick-follow": followNavigator });
};

Object.assign(module.exports, { SECTIONS, SIDES, OCELLUS_DOOR, HubRoom, placeGuardianDoors, openFirstSection, placeSection, returnTile, takeDoor });
