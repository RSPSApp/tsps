"use strict";

/**
 * The butterfly net's "Check totals" (worn: "Check Totals"), which opens the Impling Tracker
 * (Wiki, Insect net: "opens the Impling Tracker, which tracks how many implings they've caught",
 * in Puro-Puro and the rest of the world).
 *
 * rsprox capture 20261111T231757-5ab63b4 (rev 242), inventory and worn Check totals: live runs
 * toplevel_mainmodal_open, opens ii_tracker (180) as the main modal, then runs ii_tracker_build (1327)
 * with the Surface World list, the Puro-Puro list and the two tabs' components (scroll layer, text
 * layer, model layer, scrollbar: 180:4/6/5/3 and 180:8/10/9/7). Each list is the twelve implings below
 * in that order, "<Name>:<br><col=ffffff><count>"; Puro-Puro shows the crystal impling greyed out with
 * no count. Two catches in Puro-Puro raised that list's Young and Essence counts. Counts start when this
 * server first sees a catch: Ours.
 */

const { H } = require("./Context.Hunter");

const TOTALS_ATTRIBUTE = "hunter:impling-totals";
const TRACKER_INTERFACE = "ii_tracker";
const MAINMODAL_OPEN_SCRIPT = 2524;
const TRACKER_BUILD_SCRIPT = 1327;
const SURFACE_COMPONENTS = [4, 6, 5, 3];
const PURO_COMPONENTS = [8, 10, 9, 7];
/** The tracker's labels in live's order; each is the impling NPC "<label> impling". */
const IMPLINGS = ["Baby", "Young", "Gourmet", "Earth", "Essence", "Eclectic", "Nature", "Magpie", "Ninja", "Crystal", "Dragon", "Lucky"];
/** Live's Puro-Puro list: crystal implings are never there. */
const PURO_ABSENT = new Set(["Crystal"]);
const ABSENT_ENTRY = (label) => `<col=a46c19>${label}:<br><col=a49f99>-`;
const INDEX_BY_NPC_NAME = new Map(IMPLINGS.map((label, index) => [`${label} impling`, index]));

function totals(player) {
  const saved = player.getAttribute(TOTALS_ATTRIBUTE) ?? {};
  const list = (counts) => IMPLINGS.map((_, index) => Math.max(0, Number(counts?.[index]) || 0));
  return { surface: list(saved.surface), puro: list(saved.puro) };
}

/** hunter:impling-caught: one more of that impling on the tab where it was caught. */
function caught({ player, npcId, puro }) {
  const index = INDEX_BY_NPC_NAME.get(H.core.CacheDefinitions.getNpc(npcId)?.name);
  if (index === undefined || !player) return;
  const counts = totals(player);
  counts[puro ? "puro" : "surface"][index]++;
  player.setAttribute(TOTALS_ATTRIBUTE, counts);
}

function list(counts, absent = new Set()) {
  return IMPLINGS.map((label, index) => absent.has(label) ? ABSENT_ENTRY(label) : `${label}:<br><col=ffffff>${counts[index]}`).join("|");
}

function uids(group, children) {
  return children.map((child) => (group << 16) | child);
}

function checkTotals({ player }) {
  const group = H.core.CacheDefinitions.getInterfaceId(TRACKER_INTERFACE);
  const counts = totals(player);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(MAINMODAL_OPEN_SCRIPT, [-1, -1]);
  sender.sendInterface(group);
  sender.sendClientScript(TRACKER_BUILD_SCRIPT, list(counts.surface), list(counts.puro, PURO_ABSENT),
    ...uids(group, SURFACE_COMPONENTS), ...uids(group, PURO_COMPONENTS));
}

module.exports = { TOTALS_ATTRIBUTE, IMPLINGS, SURFACE_COMPONENTS, PURO_COMPONENTS, totals, caught, list, checkTotals };
