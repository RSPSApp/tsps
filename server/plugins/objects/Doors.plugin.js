"use strict";

const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { MapObjects } = require("../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");

let ObjectManager;
let TaskManager;

// OSRS: an opened door/gate that nobody interacts with reverts on its own after
// 300 seconds (500 ticks @ 600ms/tick). Cross-checked against rsmod/OpenRune-Server
// (DoorConstants.DURATION = 500) and a from-scratch OSRS-parity server (DOOR_AUTO_CLOSE_TICKS).
const DOOR_AUTO_CLOSE_TICKS = 500;

// Single-door closed/open pairs are discovered from this server's own cache instead of a
// hand-picked ID list: OSRS models every plain door as two consecutive loc ids where the
// closed variant offers "Open" and closedId+1 offers "Close" (verified live against this
// cache: e.g. 23972 "Door" Open -> 23973 "Door" Close). A hardcoded whitelist can only ever
// cover the handful of doors someone happened to test; this covers all of them.
function hasAction(actions, keyword) {
  return Array.isArray(actions) && actions.some((action) => typeof action === "string" && action.toLowerCase() === keyword);
}

const DOOR_NAMES = new Set([
  "Door", "Doors", "Large door", "Castle door", "Cell Door", "Cell door",
  "Glass door", "Magic door", "Metal door", "Mind Door", "Tent door",
  "Gate", "Metal gate", "Doorway",
]);
let DOOR_CATALOG = null;

function buildDoorCatalog() {
  const closedToOpen = new Map();
  const openToClosed = new Map();
  const total = CacheDefinitions.getCounts().objects;
  for (let id = 0; id < total; id++) {
    const def = CacheDefinitions.getObject(id);
    if (!def || !DOOR_NAMES.has(def.name) || !hasAction(def.actions, "open")) {
      continue;
    }
    const partner = CacheDefinitions.getObject(id + 1);
    if (!partner || partner.name !== def.name) {
      continue;
    }
    if (hasAction(partner.actions, "open") || !hasAction(partner.actions, "close")) {
      continue;
    }
    closedToOpen.set(id, id + 1);
    openToClosed.set(id + 1, id);
  }
  return { closedToOpen, openToClosed };
}

function getDoorCatalog() {
  if (!DOOR_CATALOG) {
    DOOR_CATALOG = buildDoorCatalog();
  }
  return DOOR_CATALOG;
}

const OPEN_OBJECT_STATES = new Map();
const DOOR_RESYNC_TICKS_ATTR = "doors:resyncTicks";
const DOUBLE_DOOR_ID_FAMILIES = Object.freeze([
  Object.freeze([1506, 1507, 1508, 1511]),
  Object.freeze([1512, 1513, 1514]),
  Object.freeze([1516, 1517, 1519, 1520]),
  Object.freeze([1727, 1728, 1571, 1572]),
  Object.freeze([14751, 14752, 14753, 14754]),
  Object.freeze([1521, 1522, 1524, 1525]),
  Object.freeze([1551, 1552, 1553, 1554]),
  Object.freeze([1557, 1558, 1559]),
  Object.freeze([1568, 1569, 1571, 1572]),
  Object.freeze([1589, 1590, 1591]),
  Object.freeze([1596, 1597, 1598]),
  Object.freeze([4423, 4424, 4425]),
  Object.freeze([2039, 2041, 1571, 1572]),
]);
const SPECIAL_DOUBLE_DOOR_LEFT_IDS = new Set([1568, 1571, 1727, 14751, 14753, 2039]);
const SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID = new Map([
  [1568, [1569]],
  [1569, [1568]],
  [1571, [1572]],
  [1572, [1571]],
  [1727, [1728]],
  [1728, [1727]],
  [14751, [14752, 14754]],
  [14752, [14751, 14753]],
  [14753, [14752, 14754]],
  [14754, [14751, 14753]],
  [2039, [2041]],
  [2041, [2039]],
]);
const SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID = new Map([
  [1568, 1571],
  [1569, 1572],
  [1727, 1571],
  [1728, 1572],
  [14751, 14753],
  [14752, 14754],
  [2039, 1571],
  [2041, 1572],
]);
const DOUBLE_DOOR_FAMILY_IDS_BY_ID = new Map(
  DOUBLE_DOOR_ID_FAMILIES.flatMap((familyIds) =>
    familyIds.map((id) => [id, familyIds])
  )
);

const COORD_OFFSETS = Object.freeze([
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
]);

const RUNTIME_DOUBLE_DOOR_RECORDS = [];

function doorSound(id, open) {
  const gate = CacheDefinitions.getObject(id)?.name === "Gate";
  return gate ? (open ? Sound.GATE_OPEN : Sound.GATE_CLOSE) : (open ? Sound.DOOR_OPEN : Sound.DOOR_CLOSE);
}

function cloneLocation(x, y, z) {
  return new Location(x, y, z);
}

function locationKey(location) {
  if (!location) {
    return "0,0,0";
  }
  const x = location.getX?.() ?? location.x ?? 0;
  const y = location.getY?.() ?? location.y ?? 0;
  const z = location.getZ?.() ?? location.z ?? 0;
  return `${x},${y},${z}`;
}

function locationRegionId(location) {
  const x = location.getX?.() ?? location.x ?? 0;
  const y = location.getY?.() ?? location.y ?? 0;
  return ((x >> 6) << 8) | (y >> 6);
}

function toObjectSnapshot(object) {
  const location = object?.getLocation?.() ?? object?.location;
  return {
    id: Number(object?.getId?.() ?? object?.id ?? -1),
    type: Number(object?.getType?.() ?? object?.type ?? 0),
    face: Number(object?.getFace?.() ?? object?.face ?? 0) & 0x3,
    location: {
      x: location?.getX?.() ?? location?.x ?? 0,
      y: location?.getY?.() ?? location?.y ?? 0,
      z: location?.getZ?.() ?? location?.z ?? 0,
    },
  };
}

function objectFromSnapshot(snapshot, privateArea = null) {
  return new GameObject(
    snapshot.id,
    cloneLocation(snapshot.location.x, snapshot.location.y, snapshot.location.z),
    snapshot.type,
    snapshot.face,
    privateArea
  );
}

function resolveClosedId(objectId) {
  const catalog = getDoorCatalog();
  if (catalog.closedToOpen.has(objectId)) {
    return objectId;
  }
  const closedId = catalog.openToClosed.get(objectId);
  return closedId ?? null;
}

function findOpenDoorState(closedId, location) {
  const directKey = locationKey(location);
  const direct = OPEN_OBJECT_STATES.get(directKey);
  if (direct?.closed?.length === 1 && direct.closed[0]?.id === closedId) {
    return [directKey, direct];
  }

  for (const [anchorKey, state] of OPEN_OBJECT_STATES.entries()) {
    if (state.closed?.length !== 1 || state.closed[0]?.id !== closedId) {
      continue;
    }
    if (locationKey(state.current[0]?.location) === directKey) {
      return [anchorKey, state];
    }
  }

  return [directKey, null];
}

function rememberOpenObjects(anchorKey, closedObjects, currentObjects) {
  OPEN_OBJECT_STATES.set(anchorKey, {
    closed: closedObjects.map(toObjectSnapshot),
    current: currentObjects.map(toObjectSnapshot),
  });
  scheduleAutoClose(anchorKey);
}

function clearOpenDoor(anchorKey) {
  OPEN_OBJECT_STATES.delete(anchorKey);
  TaskManager?.cancelTasks?.(anchorKey);
}

// Reverts every object tracked under an anchor back to its closed snapshot. Shared by
// the auto-close task and (indirectly, via clearOpenDoor's cancellation) manual closes.
class AutoCloseDoorTask extends Task {
  constructor(delayTicks, anchorKey) {
    super(Math.max(1, delayTicks), anchorKey);
    this.anchorKey = anchorKey;
  }

  execute() {
    const state = OPEN_OBJECT_STATES.get(this.anchorKey);
    if (state) {
      for (const snapshot of state.current ?? []) {
        ObjectManager.deregister(objectFromSnapshot(snapshot), true);
      }
      for (const snapshot of state.closed ?? []) {
        ObjectManager.register(objectFromSnapshot(snapshot), true);
      }
      for (let i = RUNTIME_DOUBLE_DOOR_RECORDS.length - 1; i >= 0; i--) {
        const record = RUNTIME_DOUBLE_DOOR_RECORDS[i];
        if (state.closed.some((snapshot) => snapshot.id === record.originalId &&
          snapshot.location.x === record.originalX && snapshot.location.y === record.originalY &&
          snapshot.location.z === record.z)) {
          RUNTIME_DOUBLE_DOOR_RECORDS.splice(i, 1);
        }
      }
      OPEN_OBJECT_STATES.delete(this.anchorKey);
      const closedSample = state.closed?.[0];
      if (closedSample) {
        Sounds.sendSound(objectFromSnapshot(closedSample), doorSound(closedSample.id, false));
      }
    }
    this.stop();
  }
}

function scheduleAutoClose(anchorKey) {
  if (!TaskManager) {
    return;
  }
  TaskManager.cancelTasks(anchorKey);
  TaskManager.submit(new AutoCloseDoorTask(DOOR_AUTO_CLOSE_TICKS, anchorKey));
}

function stateMatchesPlayer(player, state) {
  if (!player || !state) {
    return false;
  }
  if (player.getPrivateArea?.() != null) {
    return false;
  }
  const playerLocation = player.getLocation?.();
  if (!playerLocation) {
    return false;
  }
  const snapshots = [...(state.closed ?? []), ...(state.current ?? [])];
  return snapshots.some((snapshot) => {
    const snapshotLocation = cloneLocation(
      snapshot.location.x,
      snapshot.location.y,
      snapshot.location.z
    );
    return playerLocation.isWithinDistance?.(snapshotLocation, 64) === true;
  });
}

function syncOpenDoorsToPlayer(player) {
  if (!player || player.getPrivateArea?.() != null) {
    return;
  }
  for (const state of OPEN_OBJECT_STATES.values()) {
    if (!stateMatchesPlayer(player, state)) {
      continue;
    }
    for (const snapshot of state.closed ?? []) {
      player.getPacketSender?.().sendObjectRemoval?.(objectFromSnapshot(snapshot));
    }
    for (const snapshot of state.current ?? []) {
      player.getPacketSender?.().sendObject?.(objectFromSnapshot(snapshot));
    }
  }
}

function requestDoorResync(player, ticks = 3) {
  if (!player || player.getPrivateArea?.() != null) {
    return;
  }
  const current = Number(player.getAttribute?.(DOOR_RESYNC_TICKS_ATTR) ?? 0);
  if (ticks > current) {
    player.setAttribute?.(DOOR_RESYNC_TICKS_ATTR, ticks);
  }
}

function reapplyOpenDoorsForRegion(regionId) {
  for (const state of OPEN_OBJECT_STATES.values()) {
    const inRegion = [...(state.closed ?? []), ...(state.current ?? [])].some(
      (snapshot) => locationRegionId(snapshot.location) === regionId
    );
    if (!inRegion) {
      continue;
    }
    for (const snapshot of state.closed ?? []) {
      MapObjects.remove(objectFromSnapshot(snapshot));
    }
    for (const snapshot of state.current ?? []) {
      MapObjects.add(objectFromSnapshot(snapshot));
    }
  }
}

function handleMappedDoor(player, object, objectId, location) {
  if (!object || !location) {
    return false;
  }

  const closedId = resolveClosedId(objectId);
  if (closedId == null) {
    return false;
  }

  const [anchorKey, existingState] = findOpenDoorState(closedId, location);
  const activeObject = existingState?.current?.[0]
    ? objectFromSnapshot(existingState.current[0], player?.getPrivateArea?.() ?? null)
    : object;
  const activeLocation = activeObject.getLocation?.() ?? location;
  const open = (activeObject.getId?.() ?? objectId) !== closedId;
  const nextId = open ? closedId : closedId + 1;
  const type = Number(activeObject.getType?.() ?? activeObject.type ?? 0);
  const rotation = Number(activeObject.getFace?.() ?? activeObject.face ?? 0) & 0x3;
  const nextRotation = open ? ((rotation + 1) & 0x3) : rotation;
  const offsetIndex = type === 9 ? ((nextRotation + 1) & 0x3) : nextRotation;
  const [dx, dy] = COORD_OFFSETS[offsetIndex] ?? [0, 0];
  const privateArea = player?.getPrivateArea?.() ?? null;

  const previousObject = activeObject;
  const nextObject = new GameObject(
    nextId,
    cloneLocation(
      (activeLocation.getX?.() ?? activeLocation.x ?? 0) + dx,
      (activeLocation.getY?.() ?? activeLocation.y ?? 0) + dy,
      activeLocation.getZ?.() ?? activeLocation.z ?? 0
    ),
    type,
    open ? ((rotation - 1) & 0x3) : ((rotation + 1) & 0x3),
    privateArea
  );

  ObjectManager.register(nextObject, true);
  ObjectManager.deregister(previousObject, true);
  requestDoorResync(player);

  console.warn(
    `[door-debug] user=${player.isPlayerBot?.() ? "BOT:" + player.getUsername?.() : player.getUsername?.()} ${open ? "CLOSE" : "OPEN"} click id=${objectId} closedId=${closedId} ` +
    `prev(id=${previousObject.getId()},loc=${previousObject.getLocation().getX()},${previousObject.getLocation().getY()},${previousObject.getLocation().getZ()},face=${previousObject.getFace()}) ` +
    `next(id=${nextObject.getId()},loc=${nextObject.getLocation().getX()},${nextObject.getLocation().getY()},${nextObject.getLocation().getZ()},face=${nextObject.getFace()}) ` +
    `postCheck=${MapObjects.get(nextObject.getId(), nextObject.getLocation(), privateArea) ? "FOUND" : "MISSING"}`
  );

  if (open) {
    clearOpenDoor(anchorKey);
  } else {
    const closedObject = new GameObject(
      closedId,
      cloneLocation(
        location.getX?.() ?? location.x ?? 0,
        location.getY?.() ?? location.y ?? 0,
        location.getZ?.() ?? location.z ?? 0
      ),
      type,
      rotation,
      privateArea
    );
    rememberOpenObjects(anchorKey, [closedObject], [nextObject]);
  }

  Sounds.sendSound(player, doorSound(closedId, !open));

  return true;
}

function findDoubleDoorRecord(id, x, y, z) {
  return RUNTIME_DOUBLE_DOOR_RECORDS.find(
    (record) => record.currentId === id && record.x === x && record.y === y && record.z === z
  ) ?? null;
}

function createDynamicDoubleDoorRecord(object, location, originalId) {
  return {
    originalId,
    currentId: Number(object.getId?.() ?? object.id ?? originalId),
    open: 0,
    x: Number(location.getX?.() ?? location.x ?? 0),
    y: Number(location.getY?.() ?? location.y ?? 0),
    z: Number(location.getZ?.() ?? location.z ?? 0),
    originalX: Number(location.getX?.() ?? location.x ?? 0),
    originalY: Number(location.getY?.() ?? location.y ?? 0),
    currentFace: Number(object.getFace?.() ?? object.face ?? 0) & 0x3,
    originalFace: Number(object.getFace?.() ?? object.face ?? 0) & 0x3,
    type: Number(object.getType?.() ?? object.type ?? 0),
  };
}

function ensureDynamicDoubleDoorRecords(object, objectId, location, privateArea = null) {
  if (!object || !location) {
    return null;
  }

  const familyIds = DOUBLE_DOOR_FAMILY_IDS_BY_ID.get(objectId);
  if (!familyIds) {
    return null;
  }

  for (const [dx, dy] of COORD_OFFSETS) {
    const candidateLocation = cloneLocation(
      (location.getX?.() ?? location.x ?? 0) + dx,
      (location.getY?.() ?? location.y ?? 0) + dy,
      location.getZ?.() ?? location.z ?? 0
    );
    for (const partnerId of familyIds) {
      const partnerObject = MapObjects.get(partnerId, candidateLocation, privateArea);
      if (!partnerObject) {
        continue;
      }

      const clickedRecord = createDynamicDoubleDoorRecord(
        object,
        location,
        Number(object.getId?.() ?? object.id ?? objectId)
      );
      const partnerRecord = createDynamicDoubleDoorRecord(
        partnerObject,
        candidateLocation,
        Number(partnerObject.getId?.() ?? partnerObject.id ?? partnerId)
      );
      RUNTIME_DOUBLE_DOOR_RECORDS.push(clickedRecord, partnerRecord);
      return [clickedRecord, partnerRecord];
    }
  }

  return null;
}

function buildDoubleDoorAnchorKey(records) {
  return records
    .map((record) => `${record.originalId}:${record.originalX},${record.originalY},${record.z}`)
    .sort()
    .join("|");
}

function cloneDoubleDoorRecord(record) {
  return { ...record };
}

function isDoubleDoorOpen(record) {
  return (
    record.currentId !== record.originalId ||
    record.x !== record.originalX ||
    record.y !== record.originalY ||
    record.currentFace !== record.originalFace
  );
}

function doubleDoorRecordToObject(record, privateArea = null) {
  return new GameObject(
    record.currentId,
    cloneLocation(record.x, record.y, record.z),
    Number(record.type ?? 0),
    record.currentFace,
    privateArea
  );
}

function resolveOpenedDoubleDoorId(record) {
  return SPECIAL_DOUBLE_DOOR_OPEN_IDS_BY_CLOSED_ID.get(record.originalId) ?? (record.originalId + 1);
}

function getNextLeftFace(record) {
  let face = record.originalFace;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 3;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 0;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 0;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 2;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 2;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  }

  record.currentFace = face;
  return face;
}

function getNextRightFace(record) {
  let face = record.originalFace;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 2;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 3;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 2;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      face = 3;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      face = 0;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      face = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      face = 2;
    } else if (record.originalFace !== record.currentFace) {
      face = record.originalFace;
    }
  }

  record.currentFace = face;
  return face;
}

function changeLeftDoubleDoor(record) {
  let xAdjustment = 0;
  let yAdjustment = 0;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      xAdjustment = -1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      yAdjustment = 1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      xAdjustment = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      yAdjustment = -1;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      yAdjustment = -1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      xAdjustment = -1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      xAdjustment = -1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      xAdjustment = -1;
    }
  }

  if (record.x === record.originalX && record.y === record.originalY) {
    record.x += xAdjustment;
    record.y += yAdjustment;
  } else {
    record.x = record.originalX;
    record.y = record.originalY;
  }

  if (record.currentId === record.originalId) {
    record.currentId = resolveOpenedDoubleDoorId(record);
  } else {
    record.currentId = record.originalId;
  }

  getNextLeftFace(record);
}

function changeRightDoubleDoor(record) {
  let xAdjustment = 0;
  let yAdjustment = 0;

  if (record.open === 0) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      xAdjustment = -1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      yAdjustment = 1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      xAdjustment = 1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      yAdjustment = -1;
    }
  } else if (record.open === 1) {
    if (record.originalFace === 0 && record.currentFace === 0) {
      xAdjustment = 1;
    } else if (record.originalFace === 1 && record.currentFace === 1) {
      xAdjustment = -1;
    } else if (record.originalFace === 2 && record.currentFace === 2) {
      yAdjustment = -1;
    } else if (record.originalFace === 3 && record.currentFace === 3) {
      xAdjustment = -1;
    }
  }

  if (record.x === record.originalX && record.y === record.originalY) {
    record.x += xAdjustment;
    record.y += yAdjustment;
  } else {
    record.x = record.originalX;
    record.y = record.originalY;
  }

  if (record.currentId === record.originalId) {
    record.currentId = resolveOpenedDoubleDoorId(record);
  } else {
    record.currentId = record.originalId;
  }

  getNextRightFace(record);
}

function resolveDoubleDoorPair(clicked) {
  const specialPartnerIds = SPECIAL_DOUBLE_DOOR_PARTNER_IDS_BY_ID.get(clicked.currentId);
  if (specialPartnerIds) {
    for (const [dx, dy] of COORD_OFFSETS) {
      const candidateX = clicked.x + dx;
      const candidateY = clicked.y + dy;
      for (const partnerId of specialPartnerIds) {
        const partner = findDoubleDoorRecord(partnerId, candidateX, candidateY, clicked.z);
        if (!partner) {
          continue;
        }
        return SPECIAL_DOUBLE_DOOR_LEFT_IDS.has(clicked.currentId)
          ? [clicked, partner]
          : [partner, clicked];
      }
    }
  }

  let leftDoor = null;
  let rightDoor = null;
  const { currentId: id, x, y, z, originalFace, open } = clicked;

  if (open === 0) {
    if (originalFace === 0) {
      const lowerDoor = findDoubleDoorRecord(id - 3, x, y - 1, z);
      const upperDoor = findDoubleDoorRecord(id + 3, x, y + 1, z);
      if (lowerDoor) {
        leftDoor = lowerDoor;
        rightDoor = clicked;
      } else if (upperDoor) {
        leftDoor = clicked;
        rightDoor = upperDoor;
      }
    } else if (originalFace === 1) {
      const westDoor = findDoubleDoorRecord(id - 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id + 3, x + 1, y, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    } else if (originalFace === 2) {
      const lowerDoor = findDoubleDoorRecord(id - 3, x, y + 1, z);
      const upperDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (lowerDoor) {
        leftDoor = lowerDoor;
        rightDoor = clicked;
      } else if (upperDoor) {
        leftDoor = clicked;
        rightDoor = upperDoor;
      }
    } else if (originalFace === 3) {
      const westDoor = findDoubleDoorRecord(id + 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id - 3, x + 1, y, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    }
  } else if (open === 1) {
    if (originalFace === 0) {
      const westDoor = findDoubleDoorRecord(id - 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id + 3, x + 1, y, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    } else if (originalFace === 1) {
      const northDoor = findDoubleDoorRecord(id - 3, x, y + 1, z);
      const southDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (northDoor) {
        leftDoor = northDoor;
        rightDoor = clicked;
      } else if (southDoor) {
        leftDoor = clicked;
        rightDoor = southDoor;
      }
    } else if (originalFace === 2) {
      const westDoor = findDoubleDoorRecord(id - 3, x - 1, y, z);
      const eastDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (westDoor) {
        leftDoor = westDoor;
        rightDoor = clicked;
      } else if (eastDoor) {
        leftDoor = clicked;
        rightDoor = eastDoor;
      }
    } else if (originalFace === 3) {
      const northDoor = findDoubleDoorRecord(id - 3, x, y + 1, z);
      const southDoor = findDoubleDoorRecord(id + 3, x, y - 1, z);
      if (northDoor) {
        leftDoor = northDoor;
        rightDoor = clicked;
      } else if (southDoor) {
        leftDoor = clicked;
        rightDoor = southDoor;
      }
    }
  }

  return leftDoor && rightDoor ? [leftDoor, rightDoor] : null;
}

function handleDoubleDoor(player, object, objectId, location) {
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  const z = location?.getZ?.() ?? location?.z ?? 0;
  let clickedDoor = findDoubleDoorRecord(objectId, x, y, z);
  if (!clickedDoor) {
    ensureDynamicDoubleDoorRecords(object, objectId, location, player?.getPrivateArea?.() ?? null);
    clickedDoor = findDoubleDoorRecord(objectId, x, y, z);
  }
  if (!clickedDoor) {
    return false;
  }
  if (clickedDoor.currentId > 15000) {
    return true;
  }

  const pair = resolveDoubleDoorPair(clickedDoor);
  if (!pair) {
    return false;
  }

  const previousStates = pair.map(cloneDoubleDoorRecord);
  const previousObjects = previousStates.map((record) => doubleDoorRecordToObject(record));

  changeLeftDoubleDoor(pair[0]);
  changeRightDoubleDoor(pair[1]);

  const currentObjects = pair.map((record) => doubleDoorRecordToObject(record));
  for (const previousObject of previousObjects) {
    ObjectManager.deregister(previousObject, true);
  }
  for (const currentObject of currentObjects) {
    ObjectManager.register(currentObject, true);
  }

  requestDoorResync(player);

  const anchorKey = buildDoubleDoorAnchorKey(pair);
  if (pair.some(isDoubleDoorOpen)) {
    rememberOpenObjects(anchorKey, previousObjects, currentObjects);
  } else {
    clearOpenDoor(anchorKey);
  }

  Sounds.sendSound(
    player,
    doorSound(pair[0].originalId, pair.some(isDoubleDoorOpen))
  );

  return true;
}

module.exports = {
  name: "Doors",
  register: (api) => {
    ObjectManager = api.getObjectManager();
    TaskManager = api.getTaskManager();
    const toggleDoor = ({ player, object, objectId, location }) => {
      if (!player || !object || !location) {
        return false;
      }
      if (handleDoubleDoor(player, object, objectId, location)) {
        return true;
      }
      return handleMappedDoor(player, object, objectId, location);
    };
    for (const name of DOOR_NAMES) {
      api.onObjectInteraction(name, { Open: toggleDoor, Close: toggleDoor });
    }
    api.onRegionLoaded(({ regionId }) => {
      if (!Number.isInteger(regionId)) {
        return;
      }
      reapplyOpenDoorsForRegion(regionId);
    });
    api.onPlayerProcess(({ player }) => {
      if (!player || player.isPlayerBot?.() === true) {
        return;
      }
      if (player.isNeedsPlacement?.() === true || player.isAllowRegionChangePacket?.() === true) {
        requestDoorResync(player, 4);
      }
      const remaining = Number(player.getAttribute?.(DOOR_RESYNC_TICKS_ATTR) ?? 0);
      if (remaining <= 0) {
        return;
      }
      if (player.isAllowRegionChangePacket?.() === true) {
        return;
      }
      syncOpenDoorsToPlayer(player);
      player.setAttribute?.(DOOR_RESYNC_TICKS_ATTR, remaining - 1);
    });
  },
};
