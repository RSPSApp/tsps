"use strict";

/**
 * The butterfly net's "Check totals" (worn: "Check Totals"), which opens the Impling Tracker
 * (Wiki, Insect net: "opens the Impling Tracker, which tracks how many implings they've caught",
 * in Puro-Puro and the rest of the world).
 *
 * The cache draws it: interface 180 (ii_tracker) has a Surface World tab (scroll layer 180:4,
 * scrollbar 180:3) and a Puro-Puro tab (180:8, 180:7), and clientscript 1327 fills both from two
 * "|"-separated count lists. Script 1329 gives the Nth entry of a list the model enum 1316[N], so
 * a list is every impling's count in that enum's order (IMPLINGS below). The component order is the
 * cache's (gamevals surface_grid/_text/_models/_scrollbar and scripts 1328/1329). Ours: which impling
 * each model is, inferred from the model ids (29604-29613 rise baby to dragon; lucky 31742 and crystal
 * 38801 follow those implings' own models), as no capture opens the tracker; and the counts start when
 * this server first sees a catch.
 */

const { H } = require("./Context.Hunter");

const TOTALS_ATTRIBUTE = "hunter:impling-totals";
const TRACKER_INTERFACE = "ii_tracker";
const TRACKER_BUILD_SCRIPT = 1327;
/** The two tabs' (scroll layer, text layer, model layer, scrollbar) children of interface 180. */
const SURFACE_COMPONENTS = [4, 6, 5, 3];
const PURO_COMPONENTS = [8, 10, 9, 7];
/** Impling names in enum 1316's order: the Nth count shows the Nth model. */
const IMPLINGS = [
  "Eclectic impling",
  "Ninja impling",
  "Essence impling",
  "Magpie impling",
  "Dragon impling",
  "Nature impling",
  "Baby impling",
  "Young impling",
  "Earth impling",
  "Crystal impling",
  "Gourmet impling",
  "Lucky impling",
];
const INDEX_BY_NAME = new Map(IMPLINGS.map((name, index) => [name, index]));

function totals(player) {
  const saved = player.getAttribute(TOTALS_ATTRIBUTE) ?? {};
  const list = (counts) => IMPLINGS.map((_, index) => Math.max(0, Number(counts?.[index]) || 0));
  return { surface: list(saved.surface), puro: list(saved.puro) };
}

/** hunter:impling-caught: one more of that impling on the tab where it was caught. */
function caught({ player, npcId, puro }) {
  const index = INDEX_BY_NAME.get(H.core.CacheDefinitions.getNpc(npcId)?.name);
  if (index === undefined || !player) return;
  const counts = totals(player);
  counts[puro ? "puro" : "surface"][index]++;
  player.setAttribute(TOTALS_ATTRIBUTE, counts);
}

function uids(group, children) {
  return children.map((child) => (group << 16) | child);
}

function checkTotals({ player }) {
  const group = H.core.CacheDefinitions.getInterfaceId(TRACKER_INTERFACE);
  const counts = totals(player);
  const sender = player.getPacketSender();
  sender.sendInterface(group);
  sender.sendClientScript(TRACKER_BUILD_SCRIPT,
    ...uids(group, SURFACE_COMPONENTS), ...uids(group, PURO_COMPONENTS),
    counts.surface.join("|"), counts.puro.join("|"));
}

module.exports = { TOTALS_ATTRIBUTE, IMPLINGS, SURFACE_COMPONENTS, PURO_COMPONENTS, totals, caught, checkTotals };
