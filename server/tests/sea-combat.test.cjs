// Run after `yarn build`: node --test tests/sea-combat.test.cjs
// Sailing's boat combat: cannons (the player's and a crewmate's), sea creatures fighting the boat,
// the boat's HP and repairs, corpses and their loot, bounty tasks and fighting from the deck,
// against the cache and the rsprox captures (docs/sailing.md, Combat).
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { Location } = require("../dist/game/model/Location");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { emptySailingState } = require("../dist/game/content/sailing/SailingState");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { World } = require("../dist/game/World");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Skill } = require("../dist/game/model/Skill");
const { CombatPosition } = require("../dist/game/content/combat/CombatPosition");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");

const common = require("../plugins/skills/sailing/seacombat/Common.SeaCombat");
const Cannon = require("../plugins/skills/sailing/seacombat/Cannon.SeaCombat");
const BoatHp = require("../plugins/skills/sailing/seacombat/BoatHp.SeaCombat");
const Creatures = require("../plugins/skills/sailing/seacombat/Creatures.SeaCombat");
const Loot = require("../plugins/skills/sailing/seacombat/Loot.SeaCombat");
const Repairs = require("../plugins/skills/sailing/seacombat/Repairs.SeaCombat");
const DeckCombat = require("../plugins/skills/sailing/seacombat/DeckCombat.SeaCombat");
const ShipCombat = require("../plugins/skills/sailing/ShipCombat.Sailing");
const Bounty = require("../plugins/skills/sailing/porttasks/Bounty.PortTasks");
const portCommon = require("../plugins/skills/sailing/porttasks/Common.PortTasks");
const crewCommon = require("../plugins/skills/sailing/crew/Common.Crew");
const assign = require("../plugins/skills/sailing/crew/Assign.Crew");
const cargo = require("../plugins/skills/sailing/Cargo.Sailing");
const facilities = require("../plugins/skills/sailing/BoatFacilities.Sailing");
const { content, facilityRowSlot } = require("../plugins/skills/sailing/SailingContent.Sailing");

const OSPREY = 15222;
const OSPREY_DEAD = 15223;
const TERN = 15228;
const RUNE_CANNONBALL = 31914;
const ADAMANT_CANNONBALL = 31912;
const JITTERY_JIM = 3;

let api;

before(() => {
  new NpcDefinitionLoader().load();
  content();
  const real = PluginManager.createApi("SeaCombatTest");
  api = { ...real, persistAttribute() {}, sendMultiChatboxPrompt: () => true };
  require("../plugins/skills/sailing/Sailing.plugin").register(api);
  require("../plugins/skills/sailing/Crew.plugin").register(api);
  require("../plugins/skills/sailing/SeaCombat.plugin").register(api);
  require("../plugins/skills/sailing/StaticShips.plugin").register(api);
  require("../plugins/skills/sailing/PortTasks.plugin").register(api);
  require("../plugins/npcs/NpcDrops.plugin").register(api);
});

let nextIndex = 600;
/** A player on the real Mobile prototype, recording what they're sent, said and given. */
function captain({ sailing = 99, ranged = 99 } = {}) {
  const player = Object.create(Mobile.prototype);
  const index = nextIndex++;
  const varbits = new Map();
  const varps = new Map();
  const attributes = new Map();
  const sent = [];
  const said = [];
  const xp = [];
  const anims = [];
  const levels = new Map([["Sailing", sailing], ["Ranged", ranged]]);
  let location = new Location(3060, 2980, 0);
  let state = emptySailingState();
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "getVarbit") return varbits.get(args[0]) ?? 0;
      if (key === "getVarp") return varps.get(args[0]) ?? 0;
      if (key === "sendVarbit") varbits.set(args[0], args[1]);
      if (key === "sendConfig") varps.set(args[0], args[1]);
      sent.push([key, ...args]);
      return sender;
    },
  });
  Object.assign(player, {
    varbits, varps, attributes, sent, said, xp, anims, levels,
    messages: () => sent.filter(([key]) => key === "sendMessage" || key === "sendTypedMessage").map((entry) => entry.at(-1)),
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    getAsPlayer: () => player,
    getUsername: () => "One Signal", getDisplayName: () => "One Signal",
    sendMessage: (message) => sent.push(["sendMessage", message]),
    forceChat: (text) => { said.push(text); return player; },
    performAnimation: (anim) => anims.push(anim.getId()),
    performGraphic() {},
    setPositionToFace() { return player; },
    getLocation: () => location,
    setLocation: (next) => { location = next; return player; },
    moveTo: (next) => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {}, size: () => 0 }),
    setNeedsPlacement() {},
    setResetMovementQueue() {},
    setMobileInteraction() {},
    getLocalPlayers: () => [],
    getLocalNpcs: () => player.localNpcs ?? [],
    getSailing: () => state,
    setSailing: (next) => { state = next; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      getMaxLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      addExperiences: (skill, amount) => xp.push([skill.getName?.() ?? skill, amount]),
    }),
    getEquipment: () => ({ get: () => undefined, getItems: () => [] }),
    getFightType: () => ({ getStyle: () => "RAPID" }),
    isSpecialActivated: () => false,
    getBonusManager: () => ({ getAttackBonus: () => [0, 0, 0, 0, 0], getDefenceBonus: () => [0, 0, 0, 0, 0], getOtherBonus: () => [0, 0, 0, 0] }),
    getDialogueManager: () => ({ startDialogues() {}, getCurrent: () => undefined, reset() {}, isActive: () => false }),
    getPacketSender: () => sender,
    getInterfaceId: () => -1,
    setInterfaceId() {},
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  World.getPlayers().get = ((get) => (i) => (i === index ? player : get(i)))(World.getPlayers().get.bind(World.getPlayers()));
  return player;
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    World.processCycle += 1;
    TaskManager.process();
    Cannon.tick();
    Creatures.tick();
  }
}

/** Builds a facility by name on the boat (on a side, when given). */
function build(owned, name, side) {
  for (const hotspot of facilities.hotspotsOf(owned.type)) {
    if (side !== undefined && hotspot.side !== side) continue;
    const row = hotspot.allowed.find((candidate) => facilities.facilityRequirements(candidate).name.toLowerCase() === name);
    if (row === undefined) continue;
    facilities.setFacility(owned, hotspot.id, row);
    return hotspot;
  }
  throw new Error(`no hotspot takes ${name}`);
}

/** Boards a boat with a cannon built (and the crew in their slots). */
function aboardWithCannon(player, { type = "sloop", cannon = "rune cannon", crew = [] } = {}) {
  crewCommon.update(player, (state) => {
    for (const id of crew) {
      if (!state.recruited.includes(id)) state.recruited.push(id);
      if (!state.met.includes(id)) state.met.push(id);
    }
    crew.forEach((id, slot) => { state.slots[slot] = id; });
  });
  const owned = Sailing.giveBoat(player, type, "the_pandemonium");
  const hotspot = build(owned, cannon);
  assert.equal(Sailing.board(player, "the_pandemonium"), null);
  const boat = Sailing.instanceAboard(player);
  tick();
  const loc = BoatManager.getSpec(boat).locs.find((candidate) => candidate.hotspot === hotspot.id && common.cannonAt(candidate.id));
  assert.ok(loc, "the cannon is on its hotspot");
  return { boat, owned, hotspot, loc };
}

function standBeside(player, boat, loc) {
  player.setLocation(new Location(boat.deckBaseX + loc.x + 1, boat.deckBaseY + loc.y, 0));
}

function operate(player, boat, loc, clickType = 1) {
  const event = {
    player, objectId: loc.id, clickType, handled: false,
    location: { x: boat.deckBaseX + loc.x, y: boat.deckBaseY + loc.y, z: 0 },
  };
  if (clickType === 2) Cannon._test.checkAmmunition(player);
  else if (clickType === 3) Cannon._test.resetAmmunition(player);
  else Cannon._test.operate(event);
  return event;
}

function seaNpc(id, location) {
  const npc = new NPC(id, location);
  assert.equal(World.getNpcs().add(npc, true), true);
  npc.setNeedsPlacement(false);
  return npc;
}

/** A tile `distance` tiles out from the cannon, on the side it faces. */
function outboard(boat, owned, hotspotId, loc, distance) {
  const side = facilities.hotspotsOf(owned.type)[hotspotId].side;
  const outward = side === 1 ? -1 : 1;
  const radians = (boat.angle * Math.PI) / 1024;
  const from = common.worldTile(boat, boat.deckBaseX + loc.x, boat.deckBaseY + loc.y);
  return new Location(Math.round(from.getX() + outward * Math.cos(radians) * distance),
    Math.round(from.getY() - outward * Math.sin(radians) * distance), 0);
}

function leave(player) {
  if (Sailing.instanceAboard(player)) Sailing.disembark(player, "the_pandemonium");
}

test("cannon stats come from the cache: table 176's facility row and its table 162 row", () => {
  const rune = common.cannonAt(59451);
  assert.deepEqual(
    [rune.dataRow, rune.accuracy, rune.strength, rune.maxTier, rune.attackRate, rune.sailing, rune.ranged, rune.privateering],
    [8081, 163, 26, 7, 7, 80, 40, 4], "rsprox: sailing_combat_facility_data 8081; Wiki: +163/+26, Sailing 80, Ranged 40, P4");
  const adamant = common.cannonAt(59450);
  assert.deepEqual([adamant.dataRow, adamant.maxTier, adamant.privateering], [8080, 6, 3], "rsprox: 8080; the crew capture's P3 refusal");
  assert.equal(common.cannonsByLoc().size, 7, "bronze to dragon");
});

test("the side panel's per-hotspot varbits follow the gamevals, 11 and 12 in their own block", () => {
  assert.equal(common.PANEL.playerAtFacility(1), 19194);
  assert.equal(common.PANEL.playerAtFacility(11), 20187);
  assert.equal(common.PANEL.hasTarget(1), 19213);
  assert.equal(common.PANEL.hasTarget(11), 20202);
  assert.equal(common.PANEL.followingTarget(1), 20190);
  assert.equal(common.PANEL.followingTarget(12), 20205);
  assert.equal(common.PANEL.ammoType(11), 13297);
  assert.equal(common.PANEL.ammoFlags(11), 13310);
  assert.equal(common.PANEL.ammoCount(1), 5130);
  assert.equal(common.PANEL.ammoCount(11), 5474);
});

test("a player's cannon max hit: their ranged max hit with the cannon's and cannonball's strength", () => {
  const player = new Player(null);
  const sender = new Proxy({}, { get: (_t, key) => (key === "getVarbit" ? () => 0 : () => sender) });
  player.getPacketSender = () => sender;
  player.getSkillManager().setCurrentLevel(Skill.RANGED, 99, false);
  player.getSkillManager().setMaxLevel?.(Skill.RANGED, 99, false);
  const rune = common.cannonAt(59451);
  const ball = common.ballByItem(RUNE_CANNONBALL);
  // 99 Ranged, no prayer, no gear: floor((107 * (26 + 201 + 64) + 320) / 640) = 49.
  assert.equal(Cannon._test.playerMaxHit(player, rune, ball), 49);
});

test("a crewmate's max hit: the captain's Sailing, scaled by Privateering (Wiki)", () => {
  const player = captain({ sailing: 72 });
  const adamant = common.cannonAt(59450);
  const ball = common.ballByItem(ADAMANT_CANNONBALL);
  // floor((72 * (23 + 157 + 64) + 320) / 640) = 27, * (4 + 13) / 20 = 22.
  assert.equal(Cannon._test.crewMaxHit(player, adamant, ball, 4), 22);
  assert.equal(Cannon._test.crewMaxHit(player, adamant, ball, 1), 18);
});

test("Operate mans the cannon with the captured varbits; Operate again disengages", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  try {
    player.inventory.add(new (require("../dist/game/model/Item").Item)(RUNE_CANNONBALL, 847));
    standBeside(player, boat, loc);
    player.sent.length = 0;
    assert.equal(operate(player, boat, loc).handled, true);
    assert.equal(player.varbits.get(19105), 4, "facility_lockedin");
    assert.equal(player.varps.get(5042), 59451, "the cannon in use");
    assert.equal(player.varps.get(5043), 8081, "its table 162 row");
    assert.equal(player.varbits.get(19103), hotspot.id + 1, "the hotspot number");
    assert.equal(player.varbits.get(357), 33, "Category: Cannon");
    assert.equal(player.varps.get(43), 5, "com_mode");
    assert.equal(player.messages().at(-1), "You man the cannon and take aim...");
    assert.equal(player.varbits.get(common.PANEL.playerAtFacility(hotspot.id)), 1);
    assert.equal(player.varps.get(common.PANEL.ammoCount(hotspot.id)), 847);
    assert.equal(player.varbits.get(common.PANEL.ammoType(hotspot.id)), 7, "rune");
    assert.equal(player.varbits.get(common.PANEL.ammoFlags(hotspot.id)), 4);
    assert.equal(player.anims.at(-1), 13325, "the engage animation");
    assert.ok(Cannon.mannedBy(player));

    operate(player, boat, loc);
    assert.equal(player.messages().at(-1), "You disengage from the cannon.");
    assert.equal(player.varbits.get(19105), 0);
    assert.equal(player.varps.get(5042), -1);
    assert.equal(player.varps.get(5043), -1);
    assert.equal(player.varbits.get(357), 0, "back to what it was");
    assert.equal(Cannon.mannedBy(player), undefined);
  } finally {
    leave(player);
  }
});

test("stepping away from a manned cannon disengages without a message", () => {
  const player = captain();
  const { boat, loc } = aboardWithCannon(player);
  try {
    standBeside(player, boat, loc);
    operate(player, boat, loc);
    player.setLocation(new Location(player.getLocation().getX(), player.getLocation().getY() + 1, 0));
    const before = player.messages().length;
    tick();
    assert.equal(Cannon.mannedBy(player), undefined);
    assert.equal(player.messages().length, before, "no message (rsprox: walking to the helm)");
  } finally {
    leave(player);
  }
});

test("preferred ammunition: a cannonball on a cannon sets it, Check shows it, Reset clears it (rsprox)", () => {
  const player = captain();
  const { boat, loc } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon" });
  try {
    operate(player, boat, loc, 2);
    assert.equal(player.messages().at(-1), "You have no preferred ammunition type set. Set it by using a cannonball on any cannon.");
    const used = { player, itemId: ADAMANT_CANNONBALL, objectId: loc.id, handled: false };
    Cannon._test.useBall(used);
    assert.equal(used.handled, true);
    assert.equal(player.varbits.get(19101), 6);
    assert.equal(player.messages().at(-1), "Your preferred ammunition has been set to <col=ef1020>adamant cannonballs</col>.");
    operate(player, boat, loc, 2);
    assert.equal(player.messages().at(-1), "Your preferred ammunition is set to <col=ef1020>adamant cannonballs</col>.");
    operate(player, boat, loc, 3);
    assert.equal(player.varbits.get(19101), 0);
    assert.equal(player.messages().at(-1), "Your preferred ammunition type has been reset.");
  } finally {
    leave(player);
  }
});

test("the cannon fires the preferred cannonball if there is one, else the best it can, from the hold too", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon" });
  try {
    standBeside(player, boat, loc);
    operate(player, boat, loc);
    const gunner = Cannon.mannedBy(player);
    cargo.store(owned, RUNE_CANNONBALL, 10);
    assert.equal(Cannon.ammoFor(gunner), undefined, "an adamant cannon can't fire rune");
    cargo.store(owned, 31908, 5);
    cargo.store(owned, ADAMANT_CANNONBALL, 3);
    assert.equal(Cannon.ammoFor(gunner).ball.type, 6, "the best it can fire");
    player.varbits.set(19101, 2);
    assert.equal(Cannon.ammoFor(gunner).ball.type, 2, "the preferred iron");
    player.varbits.set(19101, 1);
    assert.equal(Cannon.ammoFor(gunner).ball.type, 6, "no bronze: the best instead");
    assert.ok(hotspot);
  } finally {
    leave(player);
  }
});

test("a shot: ammo, projectile timing, XP for the rolled damage and the hit on the creature", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const { DamageFormulas, AccuracyFormulasDpsCalc } = PluginManager.getCoreApi();
  const original = [DamageFormulas.rangedMaxHitWithStrength, AccuracyFormulasDpsCalc.rangedAttackRollWithBonus];
  const random = Math.random;
  DamageFormulas.rangedMaxHitWithStrength = () => 59;
  AccuracyFormulasDpsCalc.rangedAttackRollWithBonus = () => 1e9;
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 5));
  try {
    cargo.store(owned, RUNE_CANNONBALL, 847);
    standBeside(player, boat, loc);
    operate(player, boat, loc);
    Math.random = () => 0.4;
    const event = { player, npc: osprey, npcId: OSPREY, clickType: 2, handled: false };
    Cannon._test.attackOption(event);
    assert.equal(event.handled, true, "core combat doesn't start");
    player.xp.length = 0;
    tick();
    assert.equal(cargo.countIn(owned, RUNE_CANNONBALL), 846, "one cannonball from the hold");
    assert.equal(player.varps.get(common.PANEL.ammoCount(hotspot.id)), 846, "rsprox: 847 -> 846");
    assert.equal(player.varbits.get(common.PANEL.hasTarget(hotspot.id)), 1);
    assert.equal(player.varbits.get(19102), 7, "the last fired: rune");
    assert.equal(player.anims.at(-1), 13326, "the attack animation");
    // 0.4 of (59 + 1) = 24 rolled: 24 Sailing and 96 Ranged (Wiki: 1 and 4 per point).
    assert.deepEqual(player.xp, [["Sailing", 24], ["Ranged", 96]]);
    assert.equal(osprey.getCombat().getHitQueue().isEmpty(null), false, "the hit is on its way");
    const gunner = Cannon.mannedBy(player);
    assert.equal(gunner.nextAttackTick, World.getProcessCycle() + 7, "every 7 ticks (attack_rate)");
    assert.equal(Creatures.fightOf(osprey)?.boat, boat, "the osprey takes the boat on");
  } finally {
    Math.random = random;
    [DamageFormulas.rangedMaxHitWithStrength, AccuracyFormulasDpsCalc.rangedAttackRollWithBonus] = original;
    Creatures.release(osprey);
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("out of a cannon's reach or behind it: \"I can't reach that!\"", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const far = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 20));
  const behind = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, -6));
  try {
    standBeside(player, boat, loc);
    operate(player, boat, loc);
    const gunner = Cannon.mannedBy(player);
    assert.equal(Cannon.inReach(gunner, far), false, "past 15 tiles");
    assert.equal(Cannon.inReach(gunner, behind), false, "on the other side of the boat");
    Cannon._test.attackOption({ player, npc: far, npcId: OSPREY, clickType: 2, handled: false });
    assert.equal(player.messages().at(-1), "I can't reach that!");
  } finally {
    World.getNpcs().remove(far);
    World.getNpcs().remove(behind);
    leave(player);
  }
});

test("a crewmate on the cannon: Privateering, the cargo hold's ammo, the orders and their XP", () => {
  const player = captain({ sailing: 72 });
  const { boat, owned, loc, hotspot } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon", crew: [JITTERY_JIM, 1] });
  const random = Math.random;
  try {
    const aboard = crewCommon.crewAboard(boat);
    const jobless = aboard.find((member) => member.crew.id === 1);
    const jittery = aboard.find((member) => member.crew.id === JITTERY_JIM);
    const job = assign.crewFacilities(owned).find((candidate) => candidate.hotspot === hotspot.id);
    assign.order(player, boat, owned, jobless, job);
    assert.equal(player.messages().at(-1), "Your crewmate requires 3 Privateering to use that facility.");

    standBeside(player, boat, loc);
    operate(player, boat, loc);
    assign.order(player, boat, owned, jittery, job);
    assert.equal(player.messages().at(-1), "A player is already working at that facility.");
    assert.equal(Cannon.manByCrew(player, boat, owned, jittery, hotspot.id), undefined,
      "arriving at a cannon the player took on their way, the crewmate leaves it to them");
    assert.ok(Cannon.mannedBy(player), "the player still mans it");
    operate(player, boat, loc);

    assign.order(player, boat, owned, jittery, job);
    assert.equal(player.said.at(-1), "Jittery Jim, take control of the adamant cannon!");
    tick(25);
    assert.equal(jittery.position, 6 + hotspot.id, "at the cannon");

    // Fire at will with nothing in the hold: their line (rsprox).
    const tern = seaNpc(TERN, outboard(boat, owned, hotspot.id, loc, 4));
    player.localNpcs = [tern];
    Cannon.setOrder(player, boat, hotspot.id, Cannon.ORDER.FIRE_AT_WILL);
    tick();
    assert.equal(player.messages().at(-1), "Your crewmate on the cannon can't find any ammo in the cargo hold.");

    cargo.store(owned, ADAMANT_CANNONBALL, 10);
    Math.random = () => 0.5;
    player.xp.length = 0;
    tick(8);
    assert.equal(cargo.countIn(owned, ADAMANT_CANNONBALL) < 10, true, "from the hold");
    const sailing = player.xp.filter(([skill]) => skill === "Sailing");
    assert.ok(sailing.length > 0, "the captain gets Sailing XP");
    assert.equal(player.xp.some(([skill]) => skill === "Ranged"), false, "no Ranged XP for crew shots (Wiki)");
    assert.equal(sailing[0][1], 11 * 0.7, "0.7 of the 11 rolled (rsprox)");
    assert.ok(player.messages().includes("You gain some experience by watching your crew work."));
    World.getNpcs().remove(tern);
  } finally {
    Math.random = random;
    leave(player);
  }
});

test("the crew's order buttons cycle Await, Fire at will and Attack my targets; Hold fire (rsprox)", () => {
  const player = captain({ sailing: 72 });
  const { boat, hotspot } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon", crew: [JITTERY_JIM] });
  try {
    const slot = facilityRowSlot(hotspot.id, 0);
    assert.equal(slot, 16, "a skiff's hotspot 1: slot 16 (rsprox)");
    const handlers = [];
    require("../plugins/skills/sailing/crew/Cannon.Crew")({ ...api, onInterfaceActionClick: (fn) => handlers.push(fn) });
    const click = (s) => handlers.forEach((fn) => fn({ player, groupId: 937, childId: 25, slot: s, handled: false }));
    click(slot);
    assert.equal(player.said.at(-1), "Await further orders!");
    assert.equal(player.varbits.get(common.PANEL.followingTarget(hotspot.id)), 1);
    click(slot);
    assert.equal(player.said.at(-1), "Fire at will!");
    assert.equal(player.varbits.get(common.PANEL.followingTarget(hotspot.id)), 2);
    click(slot);
    assert.equal(player.said.at(-1), "Attack my targets!");
    assert.equal(player.varbits.get(common.PANEL.followingTarget(hotspot.id)), 0);
    click(slot + 1);
    assert.equal(player.said.at(-1), "Hold fire!");
  } finally {
    leave(player);
  }
});

test("a creature's hit on the boat: its roll less 1 per 100 of the keel's armour (Wiki)", () => {
  const player = captain();
  const owned = Sailing.giveBoat(player, "sloop", "the_pandemonium");
  const osprey = new NPC(OSPREY, new Location(3000, 3000, 0));
  const random = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(Creatures.rollHit(osprey, owned, () => 0), 0, "rolled 0");
    owned.parts.keel = 0; // bronze: 100 armour
    assert.equal(Creatures.rollHit(osprey, owned, (() => { let n = 0; return () => (n++ === 0 ? 0 : 0.99); })()), 5, "6 - 1");
    owned.parts.keel = 4; // adamant: 600 armour
    assert.equal(Creatures.rollHit(osprey, owned, (() => { let n = 0; return () => (n++ === 0 ? 0 : 0.99); })()), 0, "6 - 6: immune");
  } finally {
    Math.random = random;
  }
});

test("a creature fighting the boat: it attacks every attack speed ticks; the hitsplat on the HP-bar NPC", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 2));
  const events = [];
  const previous = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => { if (name === "sailing:ship-attacked") events.push(payload); return previous.call(PluginManager, name, payload); };
  try {
    const hpNpc = BoatHp.hpNpcOf(boat);
    assert.equal(hpNpc?.getId(), 15188, "a sloop's boat_hp_npc_medium");
    assert.deepEqual([hpNpc.getLocation().getX() - boat.deckBaseX, hpNpc.getLocation().getY() - boat.deckBaseY], [3, 8], "rsprox");
    Creatures.engage(osprey, player);
    assert.ok(Creatures.fightOf(osprey), "it takes the boat on");
    tick(9);
    assert.ok(events.length >= 2, "an osprey attacks every 4 ticks");
    assert.equal(events[0].creature, osprey);
    assert.equal(player.varbits.get(19181), BoatHp.hitpointsOf(owned));
  } finally {
    PluginManager.emitCustomEvent = previous;
    Creatures.release(osprey);
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("a Barracuda Trial's hazards sink a boat without its cargo going", () => {
  const player = captain();
  const { owned } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon" });
  cargo.store(owned, ADAMANT_CANNONBALL, 100);
  ShipCombat.damagePlayerBoat(player, 10_000);
  assert.equal(Sailing.instanceAboard(player), undefined, "escaped, as before");
  assert.equal(cargo.countIn(owned, ADAMANT_CANNONBALL), 100);
});

test("at 0 HP the boat is lost with all of its cargo, and the player escapes to shore", () => {
  const player = captain();
  const { owned } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon" });
  cargo.store(owned, ADAMANT_CANNONBALL, 100);
  cargo.store(owned, cargo.REPAIR_KIT, 2);
  ShipCombat.damagePlayerBoat(player, 10_000, { creature: new NPC(OSPREY, new Location(3000, 3000, 0)) });
  assert.equal(Sailing.instanceAboard(player), undefined, "escaped");
  assert.equal(owned.location.kind, "sunk", "until a shipwright recovers it");
  assert.equal(owned.cargo.filter(Boolean).length, 0, "all cargo lost (Wiki)");
});

test("a repair kit's Apply repairs the boat as captured; its hitpoints by tier", () => {
  const player = captain();
  const { owned } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon" });
  const { Item } = require("../dist/game/model/Item");
  try {
    owned.damage = 30;
    player.inventory.add(new Item(31967, 1));
    const event = { player, itemId: 31967, clickType: 1, handled: false };
    assert.equal(Repairs.apply(event), true);
    assert.equal(owned.damage, 20, "an oak kit repairs 10");
    assert.equal(player.inventory.getAmount(31967), 0);
    assert.equal(player.anims.at(-1), 13252, "human_repairkit");
    assert.equal(player.messages().at(-1), "You use the repair kit to fix up the boat.");
    assert.equal(player.varbits.get(19181), BoatHp.hitpointsOf(owned));
    assert.equal(cargo.repairKitUses({ ...owned, cargo: [{ id: 31964, amount: 2 }, { id: 31982, amount: 1 }] }), 60,
      "the side panel counts the hold's kits by what they repair (5 per repair kit, rsprox)");
  } finally {
    leave(player);
  }
});

test("a dead creature lies as its corpse; Harvest beside the hull puts its loot in the inventory", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 1));
  try {
    const death = { killer: player, npc: osprey, npcId: OSPREY, location: {}, remains: null };
    const claim = { killer: player, npcId: OSPREY, handled: false };
    api.emitCustomEvent("npc-drops:claim", claim);
    assert.equal(claim.handled, true, "nothing lands on the water");
    PluginManager.emitNpcDeath(death);
    assert.equal(osprey.getId(), OSPREY_DEAD);
    assert.equal(death.remains.ticks, 200, "two minutes (Wiki)");
    const before = player.inventory.getFreeSlots();
    const event = { player, npc: osprey, clickType: 1, handled: false };
    Loot.harvest(event);
    tick(2);
    assert.ok(player.inventory.getFreeSlots() < before, "the loot is in the inventory");
    assert.ok(player.sent.some(([key, id]) => key === "sendClientScript" && id === 7192), "each item flies in (script 7192)");
    assert.equal(Loot.corpses.has(osprey), false, "harvested");
  } finally {
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("bounty tasks: accepting sets the counter, harvesting rolls the part, a port master takes them in", () => {
  const player = captain();
  const task = portCommon.DATA.tasks.find((candidate) => candidate.id === 449);
  assert.equal(task.name, "Pandemonium tern bounty");
  const bounty = Bounty.bountyOf(task);
  assert.deepEqual([bounty.creature, bounty.part, bounty.amount, bounty.rarity, bounty.xp], [15228, 32842, 5, 10, 3465]);
  const held = portCommon.slots(player);
  held[0] = { id: 449, taken: 0, delivered: 0 };
  player.setAttribute(portCommon.SLOTS_ATTRIBUTE, held);
  api.emitCustomEvent("port-tasks:bounty-accepted", { player, index: 0, task });
  assert.equal(player.varbits.get(14662), 5, "rsprox: bounty_task_item_counter_1 0 -> 5");
  const creature = common.DATA.creatures.find((candidate) => candidate.npc === TERN);
  for (let i = 0; i < 5; i++) {
    const harvest = { player, creature, extra: [] };
    Bounty.onHarvest(harvest, () => 0);
    assert.deepEqual(harvest.extra, [{ itemId: 32842, amount: 1 }]);
    for (const drop of harvest.extra) player.inventory.add(new (require("../dist/game/model/Item").Item)(drop.itemId, drop.amount));
  }
  assert.equal(player.varbits.get(14662), 0);
  assert.ok(player.messages().includes("One Signal has harvested 1x Tern beak."));
  assert.ok(player.messages().includes("<col=ef1020>Untradeable drop: Tern beak</col>"));
  const extra = { player, creature, extra: [] };
  Bounty.onHarvest(extra, () => 0);
  assert.deepEqual(extra.extra, [], "no more once all five are in");
  const claim = { player, handedIn: false };
  Bounty.claim(claim, () => 1);
  assert.equal(claim.handedIn, true);
  assert.equal(player.inventory.getAmount(32842), 0, "the beaks handed in");
  assert.equal(player.inventory.getAmount(995), 3465, "coins as the base XP (Wiki)");
  assert.ok(player.xp.some(([skill, amount]) => skill === "Sailing" && amount === 3465));
  assert.equal(portCommon.slots(player)[0], null);
});

test("a second bounty for the same part doesn't count the parts the first one holds", () => {
  const player = captain();
  const { Item } = require("../dist/game/model/Item");
  const tern = portCommon.DATA.tasks.find((candidate) => candidate.id === 449);
  const other = portCommon.DATA.tasks.find((candidate) => candidate.id !== 449 && Bounty.bountyOf(candidate)?.part === 32842);
  assert.ok(other, "another tern beak bounty");
  const held = portCommon.slots(player);
  held[0] = { id: 449, taken: 0, delivered: 0, collected: 5 };
  held[1] = { id: other.id, taken: 0, delivered: 0 };
  player.setAttribute(portCommon.SLOTS_ATTRIBUTE, held);
  player.inventory.add(new Item(32842, 5));
  api.emitCustomEvent("port-tasks:bounty-accepted", { player, index: 1, task: other });
  assert.equal(portCommon.slots(player)[1].collected, 0, "the five beaks are the first bounty's");
  assert.equal(player.varbits.get(Bounty.COUNTER_VARBITS[1]), Bounty.bountyOf(other).amount);
});

test("from a deck: ranged and magic at sea creatures are allowed, melee isn't, nor land targets", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 4));
  const goblin = new NPC(3029, new Location(3061, 2981, 0));
  try {
    assert.equal(CombatPosition.acrossDeck(player, osprey), true);
    assert.equal(CombatPosition.location(player, osprey).getX() < 9000, true, "measured from the sea");
    const method = (type) => ({ type: () => type });
    const ranged = { attacker: player, target: osprey, method: method(CombatType.RANGED), allow: null };
    DeckCombat.canAttack(ranged);
    assert.equal(ranged.allow, true);
    const melee = { attacker: player, target: osprey, method: method(CombatType.MELEE), allow: null };
    DeckCombat.canAttack(melee);
    assert.equal(melee.allow, false);
    assert.equal(player.messages().at(-1), "I can't reach that!");
    const land = { attacker: player, target: goblin, method: method(CombatType.RANGED), allow: null };
    DeckCombat.canAttack(land);
    assert.equal(land.allow, null, "left to core, which refuses a fight across a deck");
  } finally {
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("the first heading after taking the helm sets sail; a heading with the sails lowered only turns (rsprox)", () => {
  const helm = require("../plugins/skills/sailing/Helm.plugin");
  const player = captain();
  const { boat } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon" });
  const listeners = [];
  const onHeadingSet = BoatManager.onHeadingSet;
  BoatManager.onHeadingSet = (fn) => listeners.push(fn);
  try {
    helm.register({ ...api, onObjectInteraction() {}, onObjectRoute() {}, onInterfaceActionClick() {}, onCustomEvent() {}, onPlayerLogout() {}, onCommand() {} });
    const raise = listeners.at(-1);
    player.varbits.set(19175, 0);
    raise(player, boat);
    assert.equal(player.varbits.get(19175), 0, "stopped: the sails stay down");
    player.varbits.set(19175, 4);
    raise(player, boat);
    assert.equal(player.varbits.get(19175), 2, "moored: full sail");
  } finally {
    BoatManager.onHeadingSet = onHeadingSet;
    leave(player);
  }
});

test("the side panel's Release wind mote is the first button of the catcher's hotspot row", () => {
  assert.equal(facilityRowSlot(0, 0), 12, "hotspot 0: slot 12, as every recording");
  assert.equal(facilityRowSlot(2, 0), 20);
  assert.equal(facilityRowSlot(1, 3), 19, "the fourth button picks a crewmate");
});

test("a stopped boat turns to a new heading on the spot, 128 a tick (rsprox)", () => {
  const { tickBoat } = require("../dist/game/content/sailing/BoatMovement");
  const { BoatMoveMode } = require("../dist/game/content/sailing/Boat");
  const player = captain();
  const { boat } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon" });
  try {
    boat.moveMode = BoatMoveMode.Stopped;
    boat.velocity = 0;
    const [x, y] = [boat.fineX, boat.fineY];
    boat.heading = (boat.angle + 512) & 2047;
    const start = boat.angle;
    tickBoat(boat, () => true);
    assert.equal(boat.angle, (start + 128) & 2047);
    assert.deepEqual([boat.fineX, boat.fineY], [x, y], "without moving");
  } finally {
    leave(player);
  }
});

test("a player aboard walks to the deck tile nearest a creature out of reach", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 12));
  try {
    const spec = BoatManager.getSpec(boat);
    // Stand on the deck tile furthest from it: a nearer one is offered.
    const far = spec.walkableDeck.map((tile) => new Location(boat.deckBaseX + tile.x, boat.deckBaseY + tile.y, 0))
      .sort((a, b) => common.distanceToNpc(common.worldTile(boat, b.getX(), b.getY()), osprey)
        - common.distanceToNpc(common.worldTile(boat, a.getX(), a.getY()), osprey))[0];
    player.setLocation(far);
    const tile = BoatManager.deckTileToward(player, osprey);
    assert.ok(tile, "somewhere nearer on the deck");
    assert.ok(common.distanceToNpc(common.worldTile(boat, tile.getX(), tile.getY()), osprey)
      < common.distanceToNpc(common.worldTile(boat, far.getX(), far.getY()), osprey));
    player.setLocation(tile);
    assert.equal(BoatManager.deckTileToward(player, osprey), undefined, "as near as the boat lets them");
  } finally {
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("a cannon's flash plays on its deck tile by its rotation; the ball leaves the tile outboard, at a quarter of v2's heights", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 5));
  const { Projectile } = require("../dist/game/model/Projectile");
  const sent = [];
  const original = Projectile.prototype.sendProjectile;
  Projectile.prototype.sendProjectile = function () { sent.push(this); };
  try {
    cargo.store(owned, RUNE_CANNONBALL, 10);
    standBeside(player, boat, loc);
    operate(player, boat, loc);
    player.sent.length = 0;
    Cannon.fire(Cannon.mannedBy(player), { npc: osprey });
    const flash = player.sent.find(([key]) => key === "sendGraphic");
    assert.equal(flash[1].getId(), 3537 + loc.rotation, "attack02 facing 1, attack04 facing 3 (rsprox)");
    assert.deepEqual([flash[2].getX(), flash[2].getY()], [boat.deckBaseX + loc.x, boat.deckBaseY + loc.y], "on the cannon's deck tile");
    const shot = sent[0];
    const outboard = loc.rotation === 1 ? -1 : 1;
    const muzzle = common.worldTile(boat, boat.deckBaseX + loc.x + outboard, boat.deckBaseY + loc.y);
    assert.deepEqual([shot.start.getX(), shot.start.getY()], [muzzle.getX(), muzzle.getY()]);
    assert.deepEqual([shot.startHeight, shot.endHeight], [30, 53], "120 -> 210 in rsprox's v2 print, an osprey");
  } finally {
    Projectile.prototype.sendProjectile = original;
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("a netted corpse is pulled a tile a tick towards the player, then looted (rsprox)", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 9));
  // The Pandemonium's pier is no open sea; here every tile is water.
  const isSailable = BoatManager.isSailable;
  BoatManager.isSailable = () => true;
  try {
    PluginManager.emitNpcDeath({ killer: player, npc: osprey, npcId: OSPREY, location: {}, remains: null });
    const before = common.distanceToBoat(osprey, boat);
    assert.ok(before > 1, "out where the net is thrown");
    Loot.harvest({ player, npc: osprey, clickType: 1, handled: false });
    assert.equal(player.anims.at(-1), 13273, "the net");
    for (let i = 0; i < 3; i++) {
      tick();
      osprey.getMovementQueue().process();
    }
    assert.ok(common.distanceToBoat(osprey, boat) < before, "pulled in");
    tick(7);
    assert.equal(Loot.corpses.has(osprey), false, "looted at 9 ticks");
  } finally {
    BoatManager.isSailable = isSailable;
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("facilities show Modify only in the shipyard; at sea their other ops (rsprox: 0b1111 / 0b10000)", () => {
  const player = captain();
  const owned = Sailing.giveBoat(player, "sloop", "the_pandemonium");
  build(owned, "rune cannon");
  const atSea = facilities.hotspotLocs(owned).find((loc) => common.cannonAt(loc.id));
  const inYard = facilities.hotspotLocs(owned, true).find((loc) => common.cannonAt(loc.id));
  assert.equal(atSea.opFlags, 0b1111);
  assert.equal(inYard.opFlags, 0b10000);
});

test("a crewmate mans a cannon from the tile inboard of it, facing it (rsprox)", () => {
  const player = captain({ sailing: 72 });
  const { boat, owned, hotspot } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon", crew: [JITTERY_JIM] });
  try {
    const [jim] = crewCommon.crewAboard(boat);
    const job = assign.crewFacilities(owned).find((candidate) => candidate.hotspot === hotspot.id);
    assign.order(player, boat, owned, jim, job);
    tick(25);
    const outboard = hotspot.side === 1 ? -1 : 1;
    assert.deepEqual([jim.npc.getLocation().getX() - boat.deckBaseX, jim.npc.getLocation().getY() - boat.deckBaseY],
      [hotspot.x - outboard, hotspot.y], "beside the cannon, inboard");
  } finally {
    leave(player);
  }
});

test("harvesting frees the corpse to be pulled and refreshes the inventory with the loot", () => {
  const player = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 9));
  const refresh = player.inventory.refreshItems.bind(player.inventory);
  let refreshed = 0;
  player.inventory.refreshItems = () => { refreshed++; return refresh(); };
  try {
    osprey.getMovementQueue().setBlockMovement(true); // as NPCDeathTask leaves it
    PluginManager.emitNpcDeath({ killer: player, npc: osprey, npcId: OSPREY, location: {}, remains: null });
    Loot.harvest({ player, npc: osprey, clickType: 1, handled: false });
    assert.equal(osprey.getMovementQueue().isMovementBlocked(), false, "the net can move it");
    tick(10);
    assert.ok(refreshed > 0, "the loot shows at once");
  } finally {
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("bounty parts in a creature's drop table only come from an active bounty", () => {
  const player = captain();
  const creature = common.DATA.creatures.find((candidate) => candidate.npc === OSPREY);
  const harvest = { player, creature, drops: [{ itemId: 526, amount: 1 }, { itemId: 32824, amount: 1 }, { itemId: 32843, amount: 1 }], extra: [] };
  Bounty.onHarvest(harvest, () => 0);
  assert.deepEqual(harvest.drops.map((drop) => drop.itemId), [526], "the feather and beak go without a task");
  assert.deepEqual(harvest.extra, []);
});

test("harvest loot goes through the kill's loot rules with everyone who damaged it (an Ironman's shared kill)", () => {
  const player = captain();
  const helper = captain();
  const { boat, owned, loc, hotspot } = aboardWithCannon(player);
  const osprey = seaNpc(OSPREY, outboard(boat, owned, hotspot.id, loc, 1));
  const seen = [];
  let active = true;
  // As Loot.Ironman.js does for an Ironman whose kill someone helped with: nothing is kept.
  api.onCustomEvent("npc-drops:roll", (event) => {
    if (!active || event.npcId !== OSPREY) return;
    seen.push(event);
    if ((event.damagers ?? []).some((other) => other !== event.player)) event.drops.splice(0);
  });
  const held = portCommon.slots(player);
  const task = portCommon.DATA.tasks.find((candidate) => Bounty.bountyOf(candidate)?.creature === OSPREY);
  held[0] = { id: task.id, taken: 0, delivered: 0 };
  player.setAttribute(portCommon.SLOTS_ATTRIBUTE, held);
  const random = Math.random;
  try {
    PluginManager.emitNpcDeath({ killer: player, damagers: [player, helper], npc: osprey, npcId: OSPREY, location: {}, remains: null });
    const before = player.inventory.getFreeSlots();
    Math.random = () => 0;
    Loot.harvest({ player, npc: osprey, clickType: 1, handled: false });
    tick(2);
    assert.equal(seen.length, 1, "npc-drops:roll ran for the harvest");
    assert.deepEqual(seen[0].damagers, [player, helper], "with the kill's damagers");
    assert.equal(player.inventory.getFreeSlots(), before, "a shared kill's loot is lost");
    assert.equal(portCommon.slots(player)[0].collected ?? 0, 0, "and its bounty part isn't counted");
  } finally {
    Math.random = random;
    active = false;
    World.getNpcs().remove(osprey);
    leave(player);
  }
});

test("crew following the captain take the captain's target when the captain attacks off the cannon", () => {
  const player = captain({ sailing: 72 });
  const { boat, owned, loc, hotspot } = aboardWithCannon(player, { type: "skiff", cannon: "adamant cannon", crew: [JITTERY_JIM] });
  const tern = seaNpc(TERN, outboard(boat, owned, hotspot.id, loc, 4));
  try {
    const [jim] = crewCommon.crewAboard(boat);
    const job = assign.crewFacilities(owned).find((candidate) => candidate.hotspot === hotspot.id);
    assign.order(player, boat, owned, jim, job);
    tick(25);
    assert.equal(Cannon.mannedBy(player), undefined, "the captain isn't on a cannon");
    const event = { player, npc: tern, npcId: TERN, clickType: 2, handled: false };
    Cannon._test.attackOption(event);
    assert.equal(event.handled, false, "the captain's own attack goes on as normal combat");
    assert.equal(Cannon._test.gunners.get(Cannon._test.keyOf(boat, hotspot.id))?.target, tern, "Jittery Jim takes it");
    assert.equal(player.said.at(-1), "Fire!");
  } finally {
    World.getNpcs().remove(tern);
    leave(player);
  }
});
