/**
 * The Clan Wars free-for-all arena behind Ferox Enclave's white portal (Wiki: Clan Wars,
 * Free-for-all portal; OSRS captures, docs/ferox-enclave.md):
 *
 * - "Enter" takes you in a tick after the click; the exit portal brings you out. Entering and
 *   leaving by any route fully restores you.
 * - Past the line (y 4761 and up), any player may attack any other, at any combat level and
 *   without a skull; south of it is a safe zone. The north (y 4800 and up, world.json) is
 *   multi-combat. Deaths are safe: everything and any skull are
 *   kept, and you come back out by the portal at Ferox, restored.
 * - "Disable-XP" toggles XP gains inside (varbit 20231).
 * - Meteors fall in the north, for show.
 */
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const Ferox = require("./Common.FeroxEnclave");

const LANDING = new Location(3327, 4751, 0);
const RETURN = new Location(3128, 3629, 0);
const AREA = { minX: 3264, maxX: 3391, minY: 4736, maxY: 4863 };
/** The line across the arena (ground decoration 8875 at y 4759-4760); south of it, and on it, is safe. */
const SAFE_MAX_Y = 4760;
const OVERLAY = 199; // clanwars_ffa
const OVERLAY_HUD_UID = (161 << 16) | 8;
const PVP_BLOCK_UID = (90 << 16) | 43;
const PVP_SAFE_UID = (90 << 16) | 47;
const PVP_AREA_VARBIT = 8121; // pvp_area_client
const XP_DISABLE_VARBIT = 20231; // clan_wars_xp_disable
/** The client shows "Attack" on players from option slot 1 (as the Duel Arena sends it). */
const ATTACK_OPTION_SLOT = 1;
const IN_FFA_ATTRIBUTE = "ferox:in-ffa";
const XP_DISABLE_ATTRIBUTE = "ferox:ffa-xp-disabled";
const MYSTERIOUS_PORTAL = 56373;

/** Meteors (projectile 660, blast 659, sound 594): launched from around here, every few ticks. */
const METEOR = { minX: 3297, maxX: 3317, minY: 4818, maxY: 4828, everyTicks: 4, projectile: 660, blast: 659, sound: 594 };

const inArena = (location) => location?.getZ?.() === 0
  && location.getX() >= AREA.minX && location.getX() <= AREA.maxX
  && location.getY() >= AREA.minY && location.getY() <= AREA.maxY;

/** Past the line: where players may fight. */
const inFightingArea = (location) => inArena(location) && location.getY() > SAFE_MAX_Y;

const savedSkulls = new WeakMap();
const lastSafeZoneNotice = new WeakMap();
let meteorTick = 0;

/** Ours (not captured); attack checks repeat while pursuing, so at most every 3 seconds. */
function tellSafeZone(player) {
  const now = Date.now();
  if (now - (lastSafeZoneNotice.get(player) ?? 0) < 3000) return;
  lastSafeZoneNotice.set(player, now);
  player.sendMessage("You can't fight in the safe zone.");
}

function showOverlays(player, shown) {
  const sender = player.getPacketSender();
  sender.sendInterfaceDisplayState(PVP_BLOCK_UID, !shown).sendInterfaceDisplayState(PVP_SAFE_UID, !shown);
  sender.sendVarbit(PVP_AREA_VARBIT, shown ? 1 : 0);
  // sendPlayerOption, not the legacy sendInteractionOption (a no-op for this client).
  sender.sendPlayerOption(ATTACK_OPTION_SLOT, shown ? "Attack" : "", shown);
  if (shown) sender.sendSubInterface(OVERLAY_HUD_UID, OVERLAY, 1);
  else sender.closeSubInterface(OVERLAY_HUD_UID);
}

/** The arena as an Area; defined once the plugin hands over `core`. */
function defineArena() {
  return class FreeForAllArena extends Ferox.core.Area {
    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      player.setAttribute(IN_FFA_ATTRIBUTE, true);
      showOverlays(player, true);
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer() || logout) return;
      const player = mobile.getAsPlayer();
      player.setAttribute(IN_FFA_ATTRIBUTE, false);
      showOverlays(player, false);
      Ferox.restore(player, { prayersOff: false });
    }

    /** Any two players past the line, at any level; no other rules apply here. */
    canAttack(attacker, target) {
      if (!attacker.isPlayer() || !target.isPlayer()) return null;
      if (!inArena(attacker.getLocation()) || !inArena(target.getLocation())) return false;
      if (inFightingArea(attacker.getLocation()) && inFightingArea(target.getLocation())) return true;
      tellSafeZone(attacker.getAsPlayer());
      return false;
    }

    process(mobile) {
      if (mobile.isPlayer() && mobile.getAsPlayer() === firstPlayerInside()) meteorShower();
    }
  };
}

function firstPlayerInside() {
  for (const player of Ferox.core.World.getPlayers()) if (player && inArena(player.getLocation())) return player;
  return null;
}

// ---------------------------------------------------------------- the portals

function enter({ player }) {
  Ferox.later(player, 1, () => {
    Ferox.restore(player, { prayersOff: false });
    player.moveTo(LANDING.clone());
  });
}

/** The exit portal: a tick after arriving, back outside the Clan Wars building, facing north. */
function exit(event) {
  if (!inArena(event.player.getLocation())) return false;
  const { player } = event;
  Ferox.later(player, 1, () => {
    const sender = player.getPacketSender();
    sender.sendVarbit(Ferox.BUSY_VARBIT, 1);
    player.moveTo(RETURN.clone());
    player.setPositionToFace(RETURN.transform(0, 1));
    Ferox.later(player, 1, () => sender.sendVarbit(Ferox.BUSY_VARBIT, 0));
  });
  return true;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Ferox.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new ActionDialogue(1, { execute: () => player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 0) }),
  ));
}

/** "Disable-XP": a Yes/No question, then the setting and a message (as captured). */
function toggleXp({ player }) {
  const disabled = player.getAttribute(XP_DISABLE_ATTRIBUTE) === true;
  player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 1);
  Ferox.api.sendMultiChatboxPrompt(player, disabled ? "Enable XP gains in Clan Wars?" : "Disable XP gains in Clan Wars?",
    "Yes.", () => {
      player.setAttribute(XP_DISABLE_ATTRIBUTE, !disabled);
      player.getPacketSender().sendVarbit(XP_DISABLE_VARBIT, disabled ? 0 : 1);
      statement(player, disabled ? "You will now gain XP in Clan Wars." : "You will no longer gain XP in Clan Wars.");
    },
    "No.", () => player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 0));
}

function mysteriousPortal({ player }) {
  player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 1);
  statement(player, "This portal is unavailable on this world.");
  return true;
}

// ---------------------------------------------------------------- rules

function blockXp(event) {
  if (event.player?.getAttribute?.(XP_DISABLE_ATTRIBUTE) === true && inArena(event.player.getLocation())) event.allow = false;
}

/** Safe: nothing is dropped; the skull is kept through the death reset (Wiki). */
function keepItems(event) {
  if (!inArena(event.player?.getLocation?.())) return;
  event.shouldDrop = false;
  savedSkulls.set(event.player, { timer: event.player.getSkullTimer(), type: event.player.getSkullType?.() });
}

function respawn(event) {
  const { player } = event;
  const skull = savedSkulls.get(player);
  if (!skull) return;
  savedSkulls.delete(player);
  event.handled = true;
  player.moveTo(RETURN.clone());
  if (skull.timer > 0) {
    if (skull.type) player.setSkullType(skull.type);
    player.setSkullTimer(skull.timer);
    player.getUpdateFlag().flag(Ferox.core.Flag.APPEARANCE);
  }
}

function sendXpSetting({ player }) {
  if (player.getAttribute(XP_DISABLE_ATTRIBUTE) === true) player.getPacketSender().sendVarbit(XP_DISABLE_VARBIT, 1);
}

// ---------------------------------------------------------------- meteors

const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function meteorShower() {
  if (++meteorTick % METEOR.everyTicks !== 0) return;
  const from = new Location(between(METEOR.minX, METEOR.maxX), between(METEOR.minY, METEOR.maxY), 0);
  const dx = between(-2, 2);
  const dy = between(-2, 2) || 1;
  const mid = from.transform(dx * 2, dy * 2);
  const to = mid.transform(dx * 2, dy * 2);
  new Ferox.core.Projectile(from, mid, null, METEOR.projectile, 0, 60, 0, 250, null).withAngle(7).withProgress(0).sendProjectile();
  new Ferox.core.Projectile(mid, to, null, METEOR.projectile, 60, 120, 250, 0, null).withAngle(7).withProgress(0).sendProjectile();
  Ferox.core.Sounds.playAreaSound({ soundId: METEOR.sound, x: from.getX(), y: from.getY(), level: 0, radius: 10 });
  for (const player of Ferox.core.World.getPlayers()) {
    if (player && inArena(player.getLocation()) && player.getLocation().isWithinDistance(to, 15)) {
      player.getPacketSender().sendGraphic(new Ferox.core.Graphic(METEOR.blast, 120), to);
    }
  }
}

module.exports = function attachFreeForAll(api) {
  const FreeForAllArena = defineArena();
  api.persistAttribute(IN_FFA_ATTRIBUTE);
  api.persistAttribute(XP_DISABLE_ATTRIBUTE);
  api.registerArea(new FreeForAllArena([new api.core.Boundary(AREA.minX, AREA.maxX, AREA.minY, AREA.maxY, 0)]));
  api.onObjectInteraction("Free-for-all portal", { Enter: enter, "Disable-XP": toggleXp });
  api.onObjectInteraction("Portal", { Exit: exit });
  api.onObjectFirstClick([MYSTERIOUS_PORTAL], mysteriousPortal);
  api.onCanGainExperience(blockXp);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onPlayerDeath(respawn);
  api.onPlayerLogin(sendXpSetting);
};

Object.assign(module.exports, {
  enter, exit, toggleXp, mysteriousPortal, blockXp, keepItems, respawn, meteorShower, defineArena,
  inArena, inFightingArea, SAFE_MAX_Y, LANDING, RETURN, AREA, IN_FFA_ATTRIBUTE, XP_DISABLE_ATTRIBUTE,
});
