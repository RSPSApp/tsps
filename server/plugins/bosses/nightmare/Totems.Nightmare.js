/**
 * The four totems, as captured: dormant until her shield fails, then ready to be charged (Charge),
 * charged when full. Charging shows as a hitsplat (22) and on the totem's bar (headbar 36, 100
 * wide), and the HUD's totem overlay (interface 413 in the boss HUD's side slot) follows each one
 * through script 3315. Magic charges them twice as fast (Wiki).
 *
 * Their blast (captured): the last one charged, each fires at her (projectile 1768) and she shows
 * the impact; three ticks later she takes a third of her hitpoints, the totems sleep and the
 * overlay fades. The Nightmare's charge 300 (+30 a player past five); Phosani's 200.
 */
const Common = require("./Common.Nightmare");

function chargeMax(fight) {
  if (fight.phosani) return Common.data.fight.phosani.totem;
  const { base, perPlayer, max, from } = Common.data.fight.totem;
  return Math.min(max, base + perPlayer * Math.max(0, fight.teamSize - from));
}

function transform(totem, id) {
  totem.npc?.setNpcTransformationId(id);
}

/** Her shield is down: the totems wake, empty, and the HUD shows them. */
function wake(fight) {
  fight.totemMax = chargeMax(fight);
  for (const totem of fight.totems) {
    totem.charge = 0;
    totem.charged = false;
    transform(totem, totem.spec.ready);
  }
  for (const player of fight.players()) openOverlay(fight, player);
}

function openOverlay(fight, player) {
  const { hud } = Common.data;
  const [group, child] = hud.totemOverlayParent;
  player.getPacketSender().sendSubInterface((group << 16) | child, hud.totemOverlay, 1);
  for (const totem of fight.totems) sendTotem(fight, player, totem);
}

function closeOverlay(fight) {
  const { hud } = Common.data;
  const [group, child] = hud.totemOverlayParent;
  for (const player of fight.players()) player.getPacketSender().closeSubInterface((group << 16) | child);
}

/** Script 3315: four (back, remaining, max, value) groups; -1 leaves a totem as it is. */
function sendTotem(fight, player, totem) {
  const { hud } = Common.data;
  const args = [];
  for (const corner of ["sw", "se", "nw", "ne"]) {
    const [back, remaining] = hud.totemComponents[corner].map((child) => (hud.totemOverlay << 16) | child);
    const mine = corner === totem.spec.corner;
    args.push(back, remaining, mine ? fight.totemMax : -1, mine ? totem.charge : -1);
  }
  args.push(0);
  player.getPacketSender().sendClientScript(hud.totemUpdateScript, ...args);
}

/** A hit on a totem charges it (twice as much from magic). */
function hit(fight, npc, pending) {
  const totem = fight.totems[npc.__nightmareTotem];
  if (!totem || fight.stage !== "totems" || totem.charged) {
    for (const part of pending.getHits()) part.setDamage(0);
    pending.updateTotalDamage();
    return;
  }
  const magic = pending.getCombatType?.() === Common.core.CombatType.MAGIC;
  let room = fight.totemMax - totem.charge;
  for (const part of pending.getHits()) {
    const amount = Math.min(room, part.getDamage() * (magic ? 2 : 1));
    part.setDamage(amount);
    room -= amount;
    if (amount > 0) part.setSplatTypes(Common.data.hud.totemSplat.mine, Common.data.hud.totemSplat.others);
  }
  pending.updateTotalDamage();
  const attacker = pending.getAttacker?.();
  if (attacker?.isPlayer?.()) require("./Loot.Nightmare").credit(fight, attacker.getAsPlayer(), "totems", fight.totemMax - room - totem.charge);
  totem.charge = fight.totemMax - room;
  npc.setDisplayedHealth({ current: totem.charge, max: fight.totemMax, bar: Common.data.hud.totemBar });
  for (const player of fight.players()) sendTotem(fight, player, totem);
  if (totem.charge >= fight.totemMax) charged(fight, totem);
}

function charged(fight, totem) {
  totem.charged = true;
  transform(totem, totem.spec.charged);
  const { messages } = Common.data.fight;
  if (fight.totems.every((other) => other.charged)) {
    for (const player of fight.players()) player.sendMessage(messages.allCharged);
    fight.totemsCharged();
    return;
  }
  if (fight.phosani) for (const player of fight.players()) player.sendMessage(messages.totemFull.replace("[corner]", totem.spec.name));
}

/** A parasite drains the least charged totem that has any charge. */
function leastCharged(fight) {
  const charging = fight.totems.filter((totem) => !totem.charged && totem.charge > 0);
  if (charging.length === 0) return null;
  return charging.reduce((least, totem) => (totem.charge < least.charge ? totem : least));
}

function drain(fight, totem, amount) {
  if (fight.stage !== "totems" || totem.charged) return;
  totem.charge = Math.max(0, totem.charge - amount);
  for (const player of fight.players()) sendTotem(fight, player, totem);
}

/** All four fire at her. */
function fire(fight) {
  const { totems } = Common.data;
  const players = fight.players();
  for (const totem of fight.totems) {
    if (totem.npc) Common.projectile(fight.dream.area, totem.npc, fight.boss, totems.projectile);
  }
  fight.boss.performGraphic(Common.graphic(totems.impact.id, { delay: totems.impact.delay, height: totems.impact.height }));
  for (const player of players) Common.sounds(player, totems.sounds);
}

/** Back to sleep, and the overlay fades. */
function sleep(fight) {
  const { hud } = Common.data;
  for (const totem of fight.totems) {
    totem.charge = 0;
    totem.charged = false;
    transform(totem, totem.spec.dormant);
  }
  const components = hud.totemFadeComponents.map((child) => (hud.totemOverlay << 16) | child);
  for (const player of fight.players()) player.getPacketSender().sendClientScript(hud.totemFadeScript, 0, -1, ...components);
}

module.exports = { chargeMax, wake, openOverlay, closeOverlay, hit, leastCharged, drain, fire, sleep };
