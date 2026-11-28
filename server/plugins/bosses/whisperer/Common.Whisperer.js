const data = require('../data/whisperer.json');
const INSIDE_ATTRIBUTE = 'whisperer:inside';
const KILLS_ATTRIBUTE = 'whisperer:kills';
const BEST_ATTRIBUTE = 'whisperer:best-ticks';
const DEATHS_ATTRIBUTE = 'whisperer:deaths';
const MONSTER = 'Whisperer, The';
let api;
const sessions = new Map();
function init(value) {
  api = value;
}
function later(ticks, action) {
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}
const location = ([x, y, z = 0]) => new api.core.Location(x, y, z);
const random = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
function protectedFrom(player, style) {
  const { PrayerHandler } = api.core;
  return PrayerHandler.isActivated(player, PrayerHandler[style === 'magic' ? 'PROTECT_FROM_MAGIC' : style === 'ranged' ? 'PROTECT_FROM_MISSILES' : 'PROTECT_FROM_MELEE']);
}
function damage(fight, amount, sanity = 0, avoidable = true) {
  if (!fight.alive())
    return;
  const { HitDamage, HitMask } = api.core;
  const hit = new HitDamage(amount, amount > 0 ? HitMask.RED : HitMask.BLUE);
  trackDamage(fight, hit, sanity, avoidable);
  fight.player.getCombat().getHitQueue().addPendingDamage([hit]);
}
function trackDamage(fight, hit, sanity, avoidable) {
  hit.setSource(fight.boss);
  fight.pendingDamage ??= new Set();
  fight.pendingDamage.add(hit);
  hit.onApplied(taken => {
    fight.pendingDamage.delete(hit);
    if (!fight.alive() || taken <= 0)
      return;
    if (avoidable)
      fight.perfectKill = false;
    if (sanity)
      fight.changeSanity(-sanity);
  });
}
function meleeDamage(fight, amount, avoidable) {
  if (!fight.alive())
    return;
  const { CombatMethod, CombatType, PendingHit, CombatFactory } = api.core;
  const method = new (class extends CombatMethod {
    type() { return CombatType.MELEE; }
    hits() { return []; }
  })();
  const hit = new PendingHit(fight.boss, fight.player, method,
    { delay: 0, damage: amount, bypassProtectionPrayer: true, rollAccuracy: false, experience: false, handleAfterHitEffects: false });
  // The paired attack already rolled damage and snapshotted partial prayer
  // mitigation. Ordinary armour reactions still apply once to each impact.
  fight.pendingMeleeHits ??= new Set();
  fight.pendingMeleeHits.add(hit);
  for (const part of hit.getHits()) {
    trackDamage(fight, part, 0, avoidable);
    part.onApplied(() => fight.pendingMeleeHits.delete(hit));
  }
  // Player-area attacks are queued after this tick's player HP pass. Resolve
  // next player turn so HP/perfect grading precedes lethal NPC retaliation.
  CombatFactory.addPendingHit(hit);
}
function cancelDamage(fight) {
  for (const hit of fight.pendingDamage ?? [])
    hit.setDamage(0);
  // PendingHit also caches its total for recoil/Vengeance. Zeroing only the
  // displayed parts would still consume retaliation after finish/departure.
  for (const hit of fight.pendingMeleeHits ?? [])
    hit.updateTotalDamage();
  fight.pendingMeleeHits?.clear();
  fight.pendingDamage?.clear();
}
function remove(npc) {
  if (npc)
    api.removeNpc(npc);
}
function sync(fight) {
  const { player } = fight;
  const sender = player.getPacketSender();
  sender.sendVarbit(data.sanity.varbit, fight.sanity);
  sender.sendVarbit(data.sanity.realmVarbit, fight.shadow ? 1 : 0);
  sender.sendVarbit(data.sanity.switchVarbit, fight.special?.switchAllowed ? 1 : 0);
}
function fragment(fight, glowing) {
  let changed = false;
  for (const item of fight.player.getInventory().getItems())
    if (item.getId() === data.items.fragment || item.getId() === data.items.fragmentActive) {
      const next = glowing ? data.items.fragmentActive : data.items.fragment;
      if (item.getId() !== next) {
        item.setId(next);
        changed = true;
      }
    }
  if (changed)
    fight.player.getInventory().refreshItems();
  sync(fight);
}
function sessionOf(player) {
  return sessions.get(player);
}
function inBounds([minX, maxX, minY, maxY, plane], location) {
  return location?.getZ() === plane && location.getX() >= minX && location.getX() <= maxX && location.getY() >= minY && location.getY() <= maxY;
}
function sound(player, id, delay = 0) {
  player.getPacketSender().sendSoundEffect(id, 1, delay, 255);
}
/** A recorded group of [id, delay] SynthSounds sent on the same tick. */
function sounds(player, entries) {
  for (const [id, delay] of entries)
    sound(player, id, delay);
}
function graphicAt(player, id, x, y, delay = 0) {
  const graphic = new api.core.Graphic(id);
  graphic.delay = delay;
  player.getPacketSender().sendGraphic(graphic, new api.core.Location(x, y, 0));
}
/** Recorded model slots: slot0 swaps for the boss, extra slots for Shadow Realm tentacles. */
function models(npc, ids) {
  npc?.setModelCustomisation?.(ids ? ids.map((modelId, slot) => ({ slot, modelId })) : null);
}
function messageBox(player, text) {
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(new api.core.StatementDialogue(0, text)));
}
function objectBox(player, itemId, text) {
  player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(new api.core.ItemStatementDialogue(0, itemId, text)));
}
module.exports = { data, init, get api() {
    return api;
  }, get core() {
    return api.core;
  }, later, location, random, protectedFrom, damage, meleeDamage, cancelDamage, remove, sync, fragment, sessions, sessionOf, inBounds, sound, sounds, graphicAt, models, messageBox, objectBox, INSIDE_ATTRIBUTE, KILLS_ATTRIBUTE, BEST_ATTRIBUTE, DEATHS_ATTRIBUTE, MONSTER };
