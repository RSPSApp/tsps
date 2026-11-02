"use strict";

/**
 * The Portal Guardians, the altar trips they open and guardian essence crafted at the altars.
 *
 * rsprox captures (rev 241):
 * - Enter on an active Portal Guardian: on arrival the HUD closes, gotr_overlay opens with the
 *   altar's colours (script 5984) and sound 1098; two ticks later "You step through the rift and
 *   find yourself at the <Rune> Altar." (spam), the move and script 5985; a tick later the HUD is
 *   back. The altar's portal returns the same way to 3615,9491 with "You step through the portal
 *   and find yourself back in the temple."
 * - A dormant Guardian: mesbox "The Guardian is dormant. Its energy might return soon."
 * - Holding guardian stones: the Great Guardian's "Human, I need the power of the guardian
 *   stones." and "You should feed the guardian stones to the Great Guardian before making more of
 *   them." (its transcript).
 * - A quest the altar needs: mesbox "You must complete Mourning's End Part II before you can
 *   enter this rift."
 * - Crafting guardian essence: human_runecraft with the runecrafting spotanim (height 92) and
 *   sound 2710; the runes, one guardian stone an essence (elemental at air, water, earth and
 *   fire), the altar's XP (22 law essence: 209), and one uncharged cell charged to the altar's tier
 *   with "Your cell absorbs a small/moderate/high/immense amount of excess energy."
 * Wiki: cells are weak at air, mind and body, medium at water, cosmic and chaos, strong at earth,
 * nature and law, overcharged at fire, death and blood; Lost City, Troll Stronghold, Mourning's
 * End Part II and Sins of the Father open cosmic, law, death and blood; a portal talisman (1/250 an
 * essence, unless Toggle-talisman turned them off) enters its Guardian even while dormant and is
 * used up unless the Guardian is active ("The portal talisman shatters and you find yourself at
 * the altar it originated from.").
 * The overlay colours of earth, mind, cosmic and death aren't captured; they borrow the closest.
 */

const Shared = require("./Shared.GuardiansOfTheRift");
const Game = require("./Game.GuardiansOfTheRift");
const Records = require("./Records.GuardiansOfTheRift");
const Temple = require("./Temple.GuardiansOfTheRift");

const ELEMENTAL = "elemental";
const CATALYTIC = "catalytic";

/** `index` is the HUD's enum 4270/4271 value; `tier` the cell the altar charges. */
const ALTARS = [
  { key: "air", name: "Air", type: ELEMENTAL, index: 1, tier: 1, arrival: [2841, 4829], overlay: [38742, 15724013], tile: [3617, 9494, 10, 2] },
  { key: "water", name: "Water", type: ELEMENTAL, index: 2, tier: 2, arrival: [2726, 4832], overlay: [44091, 527582], tile: [3623, 9500, 10, 1] },
  { key: "earth", name: "Earth", type: ELEMENTAL, index: 3, tier: 3, arrival: [2655, 4830], overlay: [44089, 2809369], tile: [3623, 9505, 10, 1] },
  { key: "fire", name: "Fire", type: ELEMENTAL, index: 4, tier: 4, arrival: [2574, 4849], overlay: [44092, 16293385], tile: [3617, 9511, 10, 0] },
  { key: "mind", name: "Mind", type: CATALYTIC, index: 1, tier: 1, arrival: [2793, 4828], overlay: [44092, 16293385], tile: [3612, 9494, 10, 2] },
  { key: "body", name: "Body", type: CATALYTIC, index: 2, tier: 1, arrival: [2521, 4834], overlay: [44091, 527582], tile: [3608, 9496, 11, 2] },
  { key: "cosmic", name: "Cosmic", type: CATALYTIC, index: 3, tier: 2, arrival: [2162, 4833], overlay: [44091, 527582], tile: [3621, 9496, 11, 1], quest: ["lost_city", "Lost City"] },
  { key: "chaos", name: "Chaos", type: CATALYTIC, index: 4, tier: 2, arrival: [2281, 4837], overlay: [44092, 16293385], tile: [3606, 9500, 10, 3] },
  { key: "nature", name: "Nature", type: CATALYTIC, index: 5, tier: 3, arrival: [2400, 4835], overlay: [44089, 2809369], tile: [3621, 9509, 11, 0] },
  { key: "law", name: "Law", type: CATALYTIC, index: 6, tier: 3, arrival: [2464, 4818], overlay: [44091, 527582], tile: [3608, 9509, 11, 3], quest: ["troll_stronghold", "Troll Stronghold"] },
  { key: "death", name: "Death", type: CATALYTIC, index: 7, tier: 4, arrival: [2208, 4830], overlay: [38742, 15724013], tile: [3606, 9505, 10, 3], quest: ["mournings_end_part_ii", "Mourning's End Part II"] },
  { key: "blood", name: "Blood", type: CATALYTIC, index: 8, tier: 4, arrival: [3239, 4832], overlay: [35737, 12262933], tile: [3612, 9511, 10, 0], quest: ["sins_of_the_father", "Sins of the Father"] },
].map((altar) => ({
  ...altar,
  guardian: `gotr_portal_${altar.key}`,
  altar: `${altar.key}_altar`,
  exit: `${altar.key}temple_exit_portal`,
  talisman: `gotr_portal_talisman_${altar.key}`,
  toggle: `gotr_talisman_toggle_${altar.key}`,
}));

const RETURN_TILE = { x: 3615, y: 9491 };
const PORTAL_SOUND = 1098;
const CRAFT_SOUND = 2710;
const TALISMAN_CHANCE = 250;
/** The away check: an altar trip stays within the altar's map square. */
const ALTAR_RANGE = 64;
const ABSORB = ["small", "moderate", "high", "immense"];
const STONE_VARIANT = "standard-dialogue-entering-a-portal-guardian-with-any-type-of-guardian-stone";
/** The Great Guardian transcript's stone conditions, by step id. */
const STEP = { ELEMENTAL: "c7UcIl", CATALYTIC: "YnTvsE", POLY_ONLY: "ufD52G" };

function byGuardian(objectId) {
  return ALTARS.find((altar) => Shared.loc(altar.guardian) === objectId) ?? null;
}

function byExit(objectId) {
  return ALTARS.find((altar) => Shared.loc(altar.exit) === objectId) ?? null;
}

function byAltar(objectId) {
  return ALTARS.find((altar) => Shared.loc(altar.altar) === objectId) ?? null;
}

function isActive(altar) {
  if (!Game.altarsOpen()) return false;
  const active = Game.activeAltars();
  return altar.index === (altar.type === ELEMENTAL ? active.elemental : active.catalytic);
}

function holdsStones(player) {
  return Shared.STONES.some((stone) => Shared.count(player, stone) > 0);
}

function questDone(player, key) {
  const request = { player, key, complete: false };
  Shared.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

// ------------------------------------------------------------------ trips

function overlay(player, altar, on) {
  if (Records.setting(player, "gotr_colourful_fade_disabled") === 1) return;
  const sender = player.getPacketSender();
  if (on) {
    Game.closeHud(player);
    sender.sendSubInterface(Shared.OVERLAY_ATMOSPHERE_UID, Shared.iface(Shared.INTERFACE.OVERLAY), 1, {
      postScripts: [{ scriptId: Shared.SCRIPT.OVERLAY_PORTAL, args: altar.overlay }],
    });
  } else {
    sender.closeSubInterface(Shared.OVERLAY_ATMOSPHERE_UID);
    if (Game.isPlaying(player)) Game.openHud(player);
  }
}

/** Into the altar (going) or back to the temple. */
function travel(player, altar, going, message) {
  player.getMovementQueue().reset();
  Shared.animate(player, null);
  overlay(player, altar, true);
  Shared.sound(player, PORTAL_SOUND);
  Shared.later(2, () => {
    if (!player.isRegistered()) return;
    player.__gotrTrip = going ? altar : null;
    Shared.spam(player, message);
    const [x, y] = going ? altar.arrival : [RETURN_TILE.x, RETURN_TILE.y];
    player.moveTo(Shared.location({ x, y }));
    if (Records.setting(player, "gotr_colourful_fade_disabled") !== 1) {
      player.getPacketSender().sendClientScript(Shared.SCRIPT.REMOVE_PORTAL);
    }
    Shared.later(1, () => {
      if (!player.isRegistered()) return;
      overlay(player, altar, false);
      // The Guardians may have changed while the player was away.
      if (!going) animateGuardians([player]);
    });
  });
}

function enterAltar(player, altar) {
  player.__gotrTrip = altar;
  travel(player, altar, true, `You step through the rift and find yourself at the ${altar.name} Altar.`);
}

/** Who may refuse this player the rift, or null to let them in. */
function refuse(player, altar) {
  if (holdsStones(player)) {
    Shared.npcSays(player, Shared.npc(Shared.NPC.GREAT_GUARDIAN), STONE_VARIANT);
    return true;
  }
  if (altar.quest && !questDone(player, altar.quest[0])) {
    Shared.statement(player, `You must complete ${altar.quest[1]} before you can enter this rift.`);
    return true;
  }
  return false;
}

function enter({ player, objectId }) {
  const altar = byGuardian(objectId);
  if (!altar || !Shared.inTemple(player.getLocation()) || !Shared.questComplete(player)) return false;
  if (!Game.isPlaying(player)) {
    player.sendMessage("There's no need to do that right now.");
    return true;
  }
  if (!isActive(altar)) {
    Shared.statement(player, "The Guardian is dormant. Its energy might return soon.");
    return true;
  }
  if (!refuse(player, altar)) enterAltar(player, altar);
  return true;
}

/** A portal talisman enters its Guardian even while dormant, and is used up unless it's active. */
function useTalisman(event) {
  const { player, objectId, itemId } = event;
  const altar = byGuardian(objectId);
  if (!altar || itemId !== Shared.obj(altar.talisman) || !Game.isPlaying(player)) return false;
  if (refuse(player, altar)) return true;
  if (!isActive(altar)) {
    player.getInventory().delete(itemId, 1);
    player.getInventory().refreshItems();
    Shared.spam(player, "The portal talisman shatters and you find yourself at the altar it originated from.");
  }
  enterAltar(player, altar);
  return true;
}

function toggleTalisman({ player, objectId }) {
  const altar = byGuardian(objectId);
  if (!altar || !Shared.inTemple(player.getLocation())) return false;
  const off = Records.setting(player, altar.toggle) === 1 ? 0 : 1;
  Records.setSetting(player, altar.toggle, off);
  player.sendMessage(off
    ? `You will no longer find portal talismans at the ${altar.name} Altar.`
    : `You will now find portal talismans at the ${altar.name} Altar.`);
  return true;
}

function leaveAltar({ player, objectId }) {
  const altar = byExit(objectId);
  if (!altar || !player.__gotrTrip || !Game.isPlaying(player)) return false;
  travel(player, altar, false, "You step through the portal and find yourself back in the temple.");
  return true;
}

/** Temple: a player on an altar trip stays in the game while they're at that altar. */
function onTrip(player) {
  const altar = player.__gotrTrip;
  if (!altar) return false;
  const location = player.getLocation();
  const near = Math.abs(location.getX() - altar.arrival[0]) < ALTAR_RANGE && Math.abs(location.getY() - altar.arrival[1]) < ALTAR_RANGE;
  if (!near && !Shared.inTemple(location)) player.__gotrTrip = null;
  return near;
}

// ------------------------------------------------------------------ crafting

// The ordinary essence fallback still runs the generic handler during an altar trip.
// Eligibility belongs to the active game, not the essence or handler that bound it.
function excludeRiftGuardianRoll(event) {
  if (event.skill === Shared.core().Skill.RUNECRAFTING && Game.isPlaying(event.player)) event.eligible = false;
}

function altarRune(player, objectId) {
  const request = { player, objectId, rune: null };
  Shared.api().emitCustomEvent("runecrafting:altar-rune", request);
  return request.rune;
}

function craft(event) {
  const { player, objectId } = event;
  const altar = byAltar(objectId);
  const essence = Shared.count(player, Shared.ITEM.ESSENCE);
  if (!altar || essence <= 0 || !Game.isPlaying(player)) return false;
  const rune = altarRune(player, objectId);
  if (!rune) return false;
  if (player.getSkillManager().getCurrentLevel(Shared.core().Skill.RUNECRAFTING) < rune.level) {
    player.sendMessage(`You need a Runecrafting level of at least ${rune.level} to craft this.`);
    return true;
  }
  const inventory = player.getInventory();
  inventory.delete(Shared.obj(Shared.ITEM.ESSENCE), essence);
  inventory.adds(rune.runeId, essence * rune.amount);
  inventory.adds(Shared.obj(altar.type === ELEMENTAL ? Shared.ITEM.ELEMENTAL_STONE : Shared.ITEM.CATALYTIC_STONE), essence);
  chargeCell(player, altar);
  findTalisman(player, altar, essence);
  inventory.refreshItems();
  Shared.animate(player, "human_runecraft");
  Shared.graphic(player, "runecrafting", 92);
  Shared.sound(player, CRAFT_SOUND);
  Shared.addXp(player, "RUNECRAFTING", essence * rune.xp);
  Game.addContribution(player, essence);
  // Wiki / Mod Elena (30 March 2022): guardian essence cannot award a Rift guardian.
  // Keep the success receipt for other consumers without an ordinary altar pet rate.
  Shared.api().emitCustomEvent("runecrafting:success", {
    player, skill: Shared.core().Skill.RUNECRAFTING, rolls: essence, runeId: rune.runeId, amountPerEssence: rune.amount,
  });
  return true;
}

/** One uncharged cell takes the altar's charge, while no charged cell is held (Wiki). */
function chargeCell(player, altar) {
  if (Shared.count(player, Shared.ITEM.UNCHARGED_CELL) <= 0) return;
  if (Shared.ITEM.CELLS.some((cell) => Shared.count(player, cell) > 0)) return;
  const inventory = player.getInventory();
  inventory.delete(Shared.obj(Shared.ITEM.UNCHARGED_CELL), 1);
  inventory.adds(Shared.obj(Shared.ITEM.CELLS[altar.tier - 1]), 1);
  player.sendMessage(`Your cell absorbs a ${ABSORB[altar.tier - 1]} amount of excess energy.`);
}

function findTalisman(player, altar, essence) {
  if (Records.setting(player, altar.toggle) === 1) return;
  for (let i = 0; i < essence; i++) {
    if (Math.random() * TALISMAN_CHANCE >= 1) continue;
    player.getInventory().adds(Shared.obj(altar.talisman), 1);
    player.sendMessage("You discover a strange talisman during the runecrafting process!");
    return;
  }
}

/**
 * On a trip the altar and its exit portal are this game's, whatever loads first: they are the
 * ordinary Runecrafting locs, whose own handlers would craft only rune/pure essence and send the
 * player out to the ruins. Unclaimed clicks (no guardian essence) fall through to them.
 */
function claimTrip(event) {
  if (!event.player?.__gotrTrip) return;
  const option = String(event.option ?? "").toLowerCase();
  const claim = option === "use" ? leaveAltar : option === "craft-rune" ? craft : null;
  if (claim && claim(event)) event.handled = true;
}

// ------------------------------------------------------------------ the Guardians' looks

/** Active Guardians play statue_runestone01_active, the rest the inactive loop (rsprox captures). */
function animateGuardians(players = Temple.inTemple()) {
  const { Location, Animation } = Shared.core();
  const active = Shared.seq("statue_runestone01_active");
  const inactive = Shared.seq("statue_runestone01_inactive");
  for (const altar of ALTARS) {
    const [x, y, type, face] = altar.tile;
    const loc = { getId: () => Shared.loc(altar.guardian), getLocation: () => new Location(x, y, 0), getType: () => type, getFace: () => face };
    const animation = new Animation(isActive(altar) ? active : inactive);
    for (const player of players) player.getPacketSender().sendObjectAnimation(loc, animation);
  }
}

function answerCondition({ npcId, player, stepId }) {
  if (npcId !== Shared.npc(Shared.NPC.GREAT_GUARDIAN)) return null;
  const has = (item) => Shared.count(player, item) > 0;
  if (stepId === STEP.ELEMENTAL) return has(Shared.ITEM.ELEMENTAL_STONE);
  if (stepId === STEP.CATALYTIC) return has(Shared.ITEM.CATALYTIC_STONE);
  if (stepId === STEP.POLY_ONLY) return has(Shared.ITEM.POLYELEMENTAL_STONE) || has(Shared.ITEM.POLYCATALYTIC_STONE);
  return null;
}

function altarsChanged() {
  animateGuardians();
}

function joined({ player }) {
  animateGuardians([player]);
}

function attachGuardians(api) {
  for (const altar of ALTARS) {
    api.onObjectInteraction(`Guardian of ${altar.name}`, { Enter: enter, "Toggle-talisman": toggleTalisman });
    api.onItemOnObject(`Portal talisman (${altar.key})`, `Guardian of ${altar.name}`, useTalisman);
  }
}

module.exports = {
  ALTARS, isActive,
  attach(api) {
    attachGuardians(api);
    api.onBeforeObjectInteraction(claimTrip);
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("pets:skilling-eligibility", excludeRiftGuardianRoll);
    Temple.allowAway(onTrip);
    Game.on("altars", altarsChanged);
    Game.on("join", joined);
  },
};
