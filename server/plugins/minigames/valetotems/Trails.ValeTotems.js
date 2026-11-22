"use strict";

const Shared = require("./Shared.ValeTotems");

const XP_ACTIONS = "ent_totems_trail_xp_buff_actions";
const XP_CHARGES = 4;
const XP_PERCENT = 115;
const EMPTY_SITE_LIMIT = 3;
const ACTIVATION_MESSAGE = "You feel closer to the ent! It will leave you more offerings during its next totem visit.";
const bonuses = new WeakMap();

function varbit(name) {
  return Shared.core().CacheDefinitions.getVarbitId(name);
}

function updateEntIndicators(player) {
  const active = bonuses.get(player);
  if (!active) return;
  const destinations = new Set(Array.from(active.keys(), (ent) => ent.destination));
  const sender = player.getPacketSender();
  for (const { site } of Shared.DATA.sites) {
    const id = varbit(`ent_totems_site_${site}_trail_buff_active`);
    const visible = destinations.has(site) ? 1 : 0;
    if (sender.getVarbit(id) !== visible) sender.sendVarbit(id, visible);
  }
  if (active.size === 0) bonuses.delete(player);
}

/** Record a real step over an existing flower. Each player can complete a pair once. */
function step(player, pair, part) {
  if (!pair.parts[part]) return;
  const progress = pair.progress ??= new WeakMap();
  const previous = progress.get(player) ?? 0;
  const current = previous | (1 << part);
  if (current === previous) return;
  progress.set(player, current);
  if (current !== 3) return;

  let active = bonuses.get(player);
  if (!active) bonuses.set(player, active = new Map());
  active.set(pair.ent, EMPTY_SITE_LIMIT);
  updateEntIndicators(player);
  player.getPacketSender().sendVarbit(varbit(XP_ACTIONS), XP_CHARGES);
  player.sendMessage(`<col=229628>${ACTIVATION_MESSAGE}</col>`);
}

/** The buff follows this individual ent, and a decorated totem consumes it. */
function offeringMultiplier(player, ent, totem) {
  const active = bonuses.get(player);
  const remaining = active?.get(ent);
  if (remaining === undefined) return 1;
  if (totem.carved && totem.decorations > 0) {
    active.delete(ent);
    return 2;
  }
  if (totem.wood === 0) {
    if (remaining === 1) active.delete(ent);
    else active.set(ent, remaining - 1);
  }
  return 1;
}

function grantFletchingXp(player, xp) {
  const sender = player.getPacketSender();
  const id = varbit(XP_ACTIONS);
  const charges = sender.getVarbit(id);
  Shared.addXp(player, "FLETCHING", charges > 0 ? xp * XP_PERCENT / 100 : xp);
  if (charges > 0) sender.sendVarbit(id, charges - 1);
}

module.exports = { step, offeringMultiplier, updateEntIndicators, grantFletchingXp };
