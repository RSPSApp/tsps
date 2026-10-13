"use strict";

/**
 * A player's Vale Totems state lives where OSRS keeps it, in the ent_totems varps: one pair per
 * totem site (ent_totems_site_N_a/_b) and the research points (ent_totems_research_points). The
 * cache's multilocs and multi-NPCs read them, so the server only keeps them current:
 *
 * - site_N_base: the totem's wood (0 none, 1 oak .. 6 redwood); site_N_base_carved is set
 *   once all three animals are carved. site_N_base_multiloc spans both, so the base loc shows
 *   the Build (0), Carve (1-6) or Decorate (9-14) totem.
 * - site_N_low/_mid/_top: an uncarved piece is the wood (1-6), a carved one 9 + the animal (10-14).
 * - site_N_decorations (0-4), site_N_decay (the durability left), site_N_points (the offerings
 *   pile, which shows the Offerings loc while above 0).
 * - site_N_animal_1..3: the three spirits at the site (1 buffalo .. 5 scorpion), and
 *   site_N_multianimal_a..e_1 shows the matching spirit NPCs.
 *
 * They are saved as one snapshot (VARPS_ATTRIBUTE) and sent again on login.
 */
const Shared = require("./Shared.ValeTotems");

const VARPS_ATTRIBUTE = "vale-totems:varps";
const SITES = Shared.DATA.sites.map((site) => site.site);
const PIECES = ["low", "mid", "top"];
const CARVED_OFFSET = 9;
const PERSISTED_VARPS = [
  "ent_totems", "ent_totems_transmit_1", "ent_totems_research_points",
  ...SITES.flatMap((site) => [`ent_totems_site_${site}_a`, `ent_totems_site_${site}_b`]),
];

let siteByLoc = null;

function varbitId(name) {
  const id = Shared.core().CacheDefinitions.getVarbitId(name);
  if (id == null) throw new Error(`ValeTotems: no varbit named ${name}`);
  return id;
}

function varpId(name) {
  const id = Shared.core().CacheDefinitions.getVarpId(name);
  if (id == null) throw new Error(`ValeTotems: no varp named ${name}`);
  return id;
}

function siteVarbit(site, field) {
  return varbitId(`ent_totems_site_${site}_${field}`);
}

/** The site whose base or offerings loc this is, or null. */
function siteOfLoc(locId) {
  if (!siteByLoc) {
    siteByLoc = new Map();
    for (const site of SITES) {
      siteByLoc.set(Shared.loc(`ent_totems_site_${site}_base`), site);
      siteByLoc.set(Shared.loc(`ent_totems_site_${site}_offerings`), site);
    }
  }
  return siteByLoc.get(locId) ?? null;
}

function tileOf(site) {
  return Shared.DATA.sites.find((entry) => entry.site === site);
}

function get(player, site, field) {
  return player.getPacketSender().getVarbit(siteVarbit(site, field));
}

/** Several of one site's varbits, saved once. */
function set(player, site, fields) {
  const sender = player.getPacketSender();
  for (const [field, value] of Object.entries(fields)) sender.sendVarbit(siteVarbit(site, field), value);
  save(player);
}

function researchPoints(player) {
  return player.getPacketSender().getVarp(varpId("ent_totems_research_points"));
}

function setResearchPoints(player, points) {
  player.getPacketSender().sendConfig(varpId("ent_totems_research_points"), points);
  save(player);
}

/** The totem at a site: its wood (1-6, 0 for none), carvings (0 uncarved, 1-5 animal) and so on. */
function totem(player, site) {
  const wood = get(player, site, "base");
  return {
    wood,
    carvings: PIECES.map((piece) => {
      const value = get(player, site, piece);
      return value > CARVED_OFFSET ? value - CARVED_OFFSET : 0;
    }),
    carved: get(player, site, "base_carved") === 1,
    decorations: get(player, site, "decorations"),
    decay: get(player, site, "decay"),
    points: get(player, site, "points"),
  };
}

function animals(player, site) {
  return [1, 2, 3].map((slot) => get(player, site, `animal_${slot}`));
}

function erect(player, site, wood) {
  set(player, site, { base: wood, base_multiloc: wood, low: wood, mid: wood, top: wood, decorations: 0 });
}

/** Carves the next uncarved piece; true when that was the last one. */
function carve(player, site, animal, durability) {
  const { wood, carvings } = totem(player, site);
  const index = carvings.indexOf(0);
  if (index < 0) return false;
  const fields = { [PIECES[index]]: CARVED_OFFSET + animal };
  const last = index === PIECES.length - 1;
  if (last) Object.assign(fields, { base_carved: 1, base_multiloc: CARVED_OFFSET - 1 + wood, decay: durability });
  set(player, site, fields);
  return last;
}

function collapse(player, site) {
  set(player, site, { base: 0, base_carved: 0, base_multiloc: 0, low: 0, mid: 0, top: 0, decorations: 0, decay: 0 });
}

/** Three different spirits for a site, and the spirit NPCs that show them. */
function rollAnimals(player, site) {
  const pool = [1, 2, 3, 4, 5];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, 3);
  const fields = { animal_1: chosen[0], animal_2: chosen[1], animal_3: chosen[2] };
  Shared.DATA.animals.forEach((animal, index) => {
    fields[`multianimal_${animal.key}_1`] = chosen.includes(index + 1) ? 1 : 0;
  });
  set(player, site, fields);
}

function save(player) {
  const sender = player.getPacketSender();
  const snapshot = {};
  for (const name of PERSISTED_VARPS) {
    const value = sender.getVarp(varpId(name));
    if (value !== 0) snapshot[name] = value;
  }
  player.setAttribute(VARPS_ATTRIBUTE, snapshot);
}

/** Players the ent visits apply to: online, and in the valley at some point this session. */
const active = new Set();

function inValley(location) {
  const { minX, maxX, minY, maxY } = Shared.DATA.valley;
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/** Sites without spirits get some, and the player joins the ent visits. */
function join(player) {
  if (active.has(player) || player.isPlayerBot?.() === true) return;
  active.add(player);
  for (const site of SITES) {
    if (get(player, site, "animal_1") === 0) rollAnimals(player, site);
  }
}

/** On login: the saved varps go back to the client. */
function restore({ player }) {
  if (!player || player.isPlayerBot?.() === true) return;
  const snapshot = player.getAttribute(VARPS_ATTRIBUTE);
  const sender = player.getPacketSender();
  for (const [name, value] of Object.entries(snapshot && typeof snapshot === "object" ? snapshot : {})) {
    const id = Shared.core().CacheDefinitions.getVarpId(name);
    if (id != null && Number.isInteger(value)) sender.sendConfig(id, value);
  }
  if (snapshot || inValley(player.getLocation())) join(player);
}

function enterSquare({ player, location }) {
  if (location && inValley(location)) join(player);
}

function leave({ player }) {
  active.delete(player);
}

function activePlayers() {
  return active;
}

function attach(api) {
  api.persistAttribute(VARPS_ATTRIBUTE);
  api.onPlayerLogin(restore);
  api.onPlayerMapSquareChange(enterSquare);
  api.onPlayerLogout(leave);
}

module.exports = {
  SITES, attach, siteOfLoc, tileOf, get, set, totem, animals, erect, carve, collapse, rollAnimals,
  researchPoints, setResearchPoints, join, activePlayers,
};
