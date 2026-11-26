"use strict";
const data = require("../data/duke-sucellus.json");
const sessions = new Map();
const INSIDE_ATTRIBUTE = "duke-sucellus:inside";
const KILLS_ATTRIBUTE = "duke-sucellus:kills";
const BEST_ATTRIBUTE = "duke-sucellus:best-ticks";
const DEMONBANE_ATTRIBUTE = "combat:demonbane-vulnerability";
const combatMethods = new Map();
let api;
function init(pluginApi) {
  api = pluginApi;
}
function sessionOf(player) {
  const session = sessions.get(player);
  return session && !session.ended ? session : null;
}
function random(maximum) {
  return Math.floor(Math.random() * (Math.max(0, maximum) + 1));
}
function count(player, key) {
  return Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));
}
function kills(player) {
  const request = { player, monster: "Duke Sucellus", total: 0 };
  api.emitCustomEvent("combat-achievements:count", request);
  return Math.max(count(player, KILLS_ATTRIBUTE), Math.max(0, Math.trunc(Number(request.total) || 0)));
}
/** Translate an instance tile back to the source room used by the encounter data. */
function source(session, location) {
  return [
    (location.getX?.() ?? location.x) - session.area.getBaseX() + data.instance.sourceChunkX * 8,
    (location.getY?.() ?? location.y) - session.area.getBaseY() + data.instance.sourceChunkY * 8,
  ];
}
function protectedFrom(player, prayer) {
  const handler = api.core.PrayerHandler;
  return handler.isActivated(player, handler[prayer]);
}
function graphic(session, id, tile, delay = 0, height = 0) {
  const location = tile?.getX ? tile : session.tile(tile);
  session.player.getPacketSender().sendGraphic(api.core.Graphic.delayed(id, delay, height), location);
}
/** A positioned sound ({ id, radius }) on a source-room tile, as the recordings send them. */
function areaSound(session, spec, tile, delay = 0) {
  const location = tile?.getX ? tile : session.tile(tile);
  session.player.getPacketSender().sendAreaSound(spec.id, location.getX(), location.getY(), location.getZ(), 1, delay, spec.radius);
}
/** Precise timing, m:ss.cc, as the kill messages show it. */
function formatTicks(ticks) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}
function messageBox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}
function sound(player, id, delay = 0) {
  player.getPacketSender().sendSoundEffect(id, 1, delay, 1);
}
/** Leave the inventory unchanged when an encounter reward cannot fit. */
function give(player, id, amount = 1) {
  const item = new api.core.Item(id, amount);
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(item) < amount) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  inventory.add(item, true);
  return true;
}
function track(fight, hit, avoidable, evenZero = false) {
  fight.pending.add(hit);
  hit.onApplied((amount) => {
    fight.pending.delete(hit);
    if (fight.over || fight.stopped || fight.session.ended || fight.session.fight !== fight)
      return;
    if (avoidable && (amount > 0 || evenZero))
      fight.perfect = false;
  });
}
function hurt(fight, maximum, { min = 0, avoidable = true, evenZero = false } = {}) {
  if (fight.over || fight.stopped || fight.session.ended || fight.player.getHitpoints() <= 0)
    return;
  const hit = new api.core.HitDamage(min + random(maximum - min), api.core.HitMask.RED);
  hit.setSource(fight.boss);
  track(fight, hit, avoidable, evenZero);
  fight.player.getCombat().getHitQueue().addPendingDamage([hit]);
  return hit;
}
function strike(fight, style, maximum, { accurate = true, avoidable = true, evenZero = false } = {}) {
  if (fight.over || fight.stopped || fight.session.ended || fight.session.fight !== fight || fight.player.getHitpoints() <= 0)
    return;
  const { CombatMethod, CombatType, PendingHit, World } = api.core;
  if (!combatMethods.has(style)) {
    combatMethods.set(style, new (class extends CombatMethod {
      type() {
        return style === "magic" ? CombatType.MAGIC : CombatType.MELEE;
      }
      hits() {
        return [];
      }
    })());
  }
  const hit = new PendingHit(fight.boss, fight.player, combatMethods.get(style), {
    // Duke already chose the protected range; resolve its actual damage once so
    // armour reactions cannot run for both a dummy zero and the real strike.
    delay: 0, damage: random(maximum), bypassProtectionPrayer: true, rollAccuracy: !accurate, experience: false, handleAfterHitEffects: false,
  });
  fight.pendingStrikes ??= new Set();
  fight.pendingStrikes.add(hit);
  for (const part of hit.getHits()) {
    track(fight, part, avoidable, evenZero);
    part.onApplied(() => fight.pendingStrikes.delete(hit));
  }
  fight.player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
  return hit;
}
function cancelPending(fight) {
  for (const hit of fight.pending)
    hit.setDamage(0);
  // Retaliation reads the cached PendingHit total, not its displayed parts.
  for (const hit of fight.pendingStrikes ?? [])
    hit.updateTotalDamage();
  fight.pendingStrikes?.clear();
  fight.pending.clear();
}
function drainPrayer(player, amount) {
  const skills = player.getSkillManager();
  const prayer = api.core.Skill.PRAYER;
  skills.setCurrentLevels(prayer, Math.max(0, skills.getCurrentLevel(prayer) - amount));
}
function faceCovered(player) {
  const head = player.getEquipment().get(api.core.Equipment.HEAD_SLOT);
  const name = head?.getDefinition?.()?.getName?.()?.toLowerCase() || "";
  return name === "gas mask" || name.includes("slayer helmet");
}
function clearSupplies(player) {
  const { arder, musca, arderPowder, muscaPowder, salt, poison } = data.items;
  for (const id of [arder, musca, arderPowder, muscaPowder, salt, poison]) {
    player.getInventory().deleteNumber(id, player.getInventory().getAmount(id));
  }
}
module.exports = {
  init, data, sessions, sessionOf, random, count, kills, source, protectedFrom,
  graphic, areaSound, formatTicks, messageBox, sound, give, hurt, strike, cancelPending, drainPrayer, faceCovered, clearSupplies,
  INSIDE: INSIDE_ATTRIBUTE, KILLS: KILLS_ATTRIBUTE, BEST: BEST_ATTRIBUTE, DEMONBANE: DEMONBANE_ATTRIBUTE,
  get api() {
    return api;
  },
  get core() {
    return api.core;
  },
};
