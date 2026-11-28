/**
 * Icthlarin's Little Helper: the quest's state, as live keeps it (the user's rsprox capture of a whole run,
 * local 1002310, revision 243; docs/quests/ictlharins-little-helper).
 *
 * - The stage is varbit 418 `ics_little_var` (varp 445 bits 0-4), with live's values (`STAGE`), each set
 *   by the action the capture shows. 26 is complete (cache DB row 75 column 19).
 * - Everything else is one of live's `ics_*` varbits (varps 443, 445, 446). The cache's multilocs and
 *   multinpcs read them, so Klenter's shade, the canopic jars on their table and the town priests are per
 *   player, as on live. Their values are saved in one attribute and sent again at login.
 * - Saves from the plugin before this rework kept its own stage numbers, a bit field and a jar key;
 *   `migrate` maps them once (SAVE_VERSION).
 */

/** Varbit 418 values, with what sets each (capture ticks in the docs). */
const STAGE = Object.freeze({
  NOT_STARTED: 0,
  STARTED: 1, // "Yes." to the Wanderer's start menu (t480)
  HYPNOTISED: 2, // set and passed in one tick as the player lands in Sophanem (t489)
  IN_SOPHANEM: 3, // woke outside Klenter's Pyramid with the jar (t489)
  FLASHBACK_1: 4, // touching the pyramid door: the first flashback (t1042)
  SEE_SPHINX: 5, // the western door's puzzle solved (t1229)
  SEE_HIGH_PRIEST: 6, // the Sphinx's "Here, I have a token..." (t1489)
  RETURN_JAR: 7, // the High Priest's "Cats act as guardians..." (t1700)
  IN_PYRAMID: 8, // the cat opens the pyramid door (t1856)
  FLASHBACK_2: 9, // the deja-vu at the pit: the second flashback (t1972)
  GUARDIAN: 10, // the correct jar touched: the apparition appears (t2048)
  GUARDIAN_DEAD: 11, // the apparition dies (t2132)
  RETURNING_JAR: 12, // back over the pit with the jar: the flashback ends (t2180)
  JAR_ROOM_OPEN: 13, // the western door's puzzle solved again (t2293)
  JAR_RETURNED: 14, // the jar dropped on its spot (t2300)
  PREPARATIONS: 15, // the High Priest's "That's right. We need the carpenter..." (t2530)
  CEREMONY_BEGUN: 16, // the carpenter's holy symbol (t2833)
  FLASHBACK_3: 17, // the deja-vu at the pit: the third flashback (t3032)
  SYMBOL_HIDDEN: 18, // the unholy symbol in a sarcophagus (t3057)
  WARN_CEREMONY: 19, // out of the eastern room: the flashback ends (t3076)
  CEREMONY: 20, // the eastern door opened: the ceremony scene (t3111)
  DEVOURER: 21, // set with 20 in the same tick (t3111)
  POSSESSED: 22, // the priest turns (t3148)
  PRIEST_DEAD: 23, // the possessed priest dies (t3219)
  ICTHLARIN_NEXT: 24, // the ceremony High Priest's "We have a few things to finish here..." (t3281)
  FINISH: 25, // Icthlarin frees the player (t3325)
  COMPLETE: 26, // the High Priest's trinket (t3378)
});

/** The quest's own varbits (cache gamevals), saved per player unless TRANSIENT. */
const VARBIT = Object.freeze({
  QUEST: 418, // ics_little_var
  JAR: 397, // ics_little_jar_multi: 1 Het (liver), 2 Apmeken (intestines), 3 Scabaras (stomach), 4 Crondis (lungs)
  CARPENTER_LOGS: 398, // ics_little_carpenter_multi
  MET_EMBALMER: 399, // ics_metembalmer
  EMBALMER_ITEMS: 400, // ics_little_embalmer_multi (bits of 401-403)
  GOT_SALT: 401, // ics_gotsalt
  GOT_SAP: 402, // ics_gotsap
  GOT_LINEN: 403, // ics_gotlinen
  LIVER_POT: 404, // ics_liverpot_vis: 1 hides the jar on its table
  LUNG_POT: 405, // ics_lungpot_vis
  STOMACH_POT: 406, // ics_stomachpot_vis
  INTESTINES_POT: 407, // ics_intestinespot_vis
  PRIESTS: 408, // ics_little_priestvis: 1 once the ceremony has begun (the carpenter's symbol, t2833)
  TILE_COUNT: 409, // ics_little_tilecount
  SCARABS: 410, // ics_scarabs: the pyramid's swarm has come up
  MET_CARPENTER: 412, // ics_metcarpenter
  CAT_ROBBED: 414, // ics_sphinx_robbedcat (Wiki: a wrong answer costs the cat)
  SALT_FROM_SUNTRAP: 419, // ics_suntrapgotsalt
  TILE_CHECKER: 445, // ics_tilechecker: the 25 tiles (varbits 420-444) as one value
  FLASHBACK: 446, // ics_stateofmind: 1 while a flashback plays
  KLENTER: 449, // ics_specvis: Klenter's shade
  TOKEN_GIVEN: 450, // ics_givensphinxstatue: the token handed to the High Priest
  MET_SPHINX: 13882, // ics_met_sphinx
  CAT_SAFE: 13883, // ics_cat_safe: the riddle answered
  TOKEN_RECEIVED: 13884, // ics_given_token
  SPHINX_AMASCUT: 13885, // ics_sphinx_amascut: heard the Sphinx on the Devourer
});

/** The first of the 25 tile varbits (ics_tile1 .. ics_tile25 are 420-444). */
const FIRST_TILE_VARBIT = 420;

/** The four jars, by varbit 397's value (cache: obj 4677 + value, loc multis 6634-6640, pot varbits). */
const JARS = Object.freeze([
  null,
  { key: "liver", god: "Het", item: 4678, loc: 6634, pot: VARBIT.LIVER_POT, apparition: 4195, potion: 2432 },
  { key: "intestines", god: "Apmeken", item: 4679, loc: 6640, pot: VARBIT.INTESTINES_POT, apparition: 4196, potion: 2428 },
  { key: "stomach", god: "Scabaras", item: 4680, loc: 6638, pot: VARBIT.STOMACH_POT, apparition: 4197, potion: 3032 },
  { key: "lungs", god: "Crondis", item: 4681, loc: 6636, pot: VARBIT.LUNG_POT, apparition: 4198, potion: 3040 },
]);

/** Varbits that are not progress: live resets them as the pyramid's copy is built or the puzzle opens. */
const TRANSIENT = new Set([VARBIT.TILE_COUNT, VARBIT.SCARABS, VARBIT.FLASHBACK, VARBIT.TILE_CHECKER]);

const VARS_ATTRIBUTE = "icthlarins-little-helper:varbits";
const SAVE_VERSION_ATTRIBUTE = "icthlarins-little-helper:save-version";
const SAVE_VERSION = 1;

// The plugin before this rework (read once by `migrate`, then cleared).
const LEGACY_BITS_ATTRIBUTE = "quest.ictlharins_little_helper.bits";
const LEGACY_JAR_ATTRIBUTE = "quest.ictlharins_little_helper.jar";
const LEGACY_BIT = Object.freeze({
  SPHINX_MET: 1 << 1, RIDDLE_ANSWERED: 1 << 3, CAT_LOST: 1 << 5, EMBALMER_MET: 1 << 7, NEEDS_SAP: 1 << 8,
  NEEDS_SALT: 1 << 9, NEEDS_LINEN: 1 << 10, CARPENTER_MET: 1 << 12, CARPENTER_LOGS: 1 << 13,
});

/**
 * The old plugin's stages onto live's. Its numbers mostly match live's; where it stood inside a flashback
 * or a fight that live replays from its start, the player goes back to that start.
 */
function migratedStage(old) {
  const table = {
    0: STAGE.NOT_STARTED, 1: STAGE.STARTED, 2: STAGE.IN_SOPHANEM, 3: STAGE.IN_SOPHANEM, 4: STAGE.IN_SOPHANEM,
    5: STAGE.SEE_SPHINX, 6: STAGE.SEE_HIGH_PRIEST, 7: STAGE.RETURN_JAR, 8: STAGE.IN_PYRAMID, 9: STAGE.IN_PYRAMID,
    10: STAGE.GUARDIAN_DEAD, 11: STAGE.GUARDIAN_DEAD, 12: STAGE.RETURNING_JAR, 13: STAGE.RETURNING_JAR,
    14: STAGE.JAR_RETURNED, 15: STAGE.PREPARATIONS, 16: STAGE.CEREMONY_BEGUN, 17: STAGE.CEREMONY_BEGUN,
    18: STAGE.SYMBOL_HIDDEN, 19: STAGE.WARN_CEREMONY, 20: STAGE.WARN_CEREMONY, 23: STAGE.PRIEST_DEAD,
    24: STAGE.ICTHLARIN_NEXT, 25: STAGE.FINISH, 26: STAGE.COMPLETE,
  };
  return table[old] ?? STAGE.NOT_STARTED;
}

/** The varbits a stage implies (a migrated save or a `::quest` jump); play sets each on its action. */
function impliedVarbits(stage, jar) {
  const vars = {};
  const at = (value, varbit, set) => { if (stage >= value) vars[varbit] = set; };
  if (stage >= STAGE.STARTED) vars[VARBIT.JAR] = jar || 2;
  at(STAGE.IN_SOPHANEM, VARBIT.KLENTER, 1);
  at(STAGE.SEE_HIGH_PRIEST, VARBIT.MET_SPHINX, 1);
  at(STAGE.SEE_HIGH_PRIEST, VARBIT.CAT_SAFE, 1);
  at(STAGE.SEE_HIGH_PRIEST, VARBIT.TOKEN_RECEIVED, 1);
  at(STAGE.RETURN_JAR, VARBIT.TOKEN_GIVEN, 1);
  at(STAGE.CEREMONY_BEGUN, VARBIT.MET_EMBALMER, 1);
  at(STAGE.CEREMONY_BEGUN, VARBIT.EMBALMER_ITEMS, 7);
  at(STAGE.CEREMONY_BEGUN, VARBIT.MET_CARPENTER, 1);
  at(STAGE.CEREMONY_BEGUN, VARBIT.CARPENTER_LOGS, 1);
  at(STAGE.CEREMONY_BEGUN, VARBIT.PRIESTS, 1);
  for (const key of Object.keys(vars)) if (!vars[key]) delete vars[key];
  return vars;
}

function legacyVarbits(bits, stage) {
  const vars = {};
  if (bits & LEGACY_BIT.SPHINX_MET) vars[VARBIT.MET_SPHINX] = 1;
  if (bits & LEGACY_BIT.CAT_LOST) vars[VARBIT.CAT_ROBBED] = 1;
  if (bits & LEGACY_BIT.RIDDLE_ANSWERED) vars[VARBIT.CAT_SAFE] = 1;
  if (stage === STAGE.PREPARATIONS) {
    if (bits & LEGACY_BIT.EMBALMER_MET) vars[VARBIT.MET_EMBALMER] = 1;
    let items = 0;
    if (bits & LEGACY_BIT.EMBALMER_MET) {
      if (!(bits & LEGACY_BIT.NEEDS_SALT)) items |= 1;
      if (!(bits & LEGACY_BIT.NEEDS_SAP)) items |= 2;
      if (!(bits & LEGACY_BIT.NEEDS_LINEN)) items |= 4;
    }
    if (items) vars[VARBIT.EMBALMER_ITEMS] = items;
    if (bits & LEGACY_BIT.CARPENTER_MET) vars[VARBIT.MET_CARPENTER] = 1;
    if (bits & LEGACY_BIT.CARPENTER_LOGS) vars[VARBIT.CARPENTER_LOGS] = 1;
  }
  return vars;
}

/** Child varbits packed into a parent (401-403 are 400's bits). */
const PACKED = Object.freeze({
  [VARBIT.GOT_SALT]: [VARBIT.EMBALMER_ITEMS, 0],
  [VARBIT.GOT_SAP]: [VARBIT.EMBALMER_ITEMS, 1],
  [VARBIT.GOT_LINEN]: [VARBIT.EMBALMER_ITEMS, 2],
});

function createState(api, getQuest) {
  const transient = new WeakMap();

  function vars(player) {
    const saved = player.getAttribute(VARS_ATTRIBUTE);
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }

  function stage(player) {
    return getQuest()?.getStage(player) ?? 0;
  }

  /** A quest varbit's value for this player (418 is the stage). */
  function get(player, varbit) {
    if (varbit === VARBIT.QUEST) return stage(player);
    const packed = PACKED[varbit];
    if (packed) return (get(player, packed[0]) >> packed[1]) & 1;
    if (TRANSIENT.has(varbit)) return transient.get(player)?.[varbit] ?? 0;
    return Number(vars(player)[varbit]) || 0;
  }

  /** Sets and sends a quest varbit (and saves it, unless live resets it). */
  function set(player, varbit, value) {
    const packed = PACKED[varbit];
    if (packed) {
      const [parent, bit] = packed;
      const old = get(player, parent);
      set(player, parent, value ? old | (1 << bit) : old & ~(1 << bit));
      return;
    }
    if (TRANSIENT.has(varbit)) {
      const map = transient.get(player) ?? {};
      map[varbit] = value;
      transient.set(player, map);
    } else {
      const next = { ...vars(player) };
      if (value) next[varbit] = value;
      else delete next[varbit];
      player.setAttribute(VARS_ATTRIBUTE, next);
    }
    player.getPacketSender().sendVarbit(varbit, value);
  }

  /** Sets the stage as live does: the saved stage and varbit 418. */
  function setStage(player, value) {
    getQuest().setStage(player, value);
  }

  function jar(player) {
    return JARS[get(player, VARBIT.JAR)] ?? null;
  }

  /** Every saved varbit back to the client (login, after a jump). */
  function resend(player) {
    const sender = player.getPacketSender();
    const saved = vars(player);
    for (const key of Object.keys(saved)) sender.sendVarbit(Number(key), Number(saved[key]) || 0);
  }

  /** All of the quest's varbits cleared (a reset). */
  function clear(player) {
    const saved = vars(player);
    player.setAttribute(VARS_ATTRIBUTE, {});
    transient.delete(player);
    const sender = player.getPacketSender();
    for (const key of Object.keys(saved)) sender.sendVarbit(Number(key), 0);
  }

  /** Brings the varbits in line with a stage set from outside play (`::quest`), keeping the jar. */
  function align(player, value) {
    const keepJar = get(player, VARBIT.JAR);
    const next = impliedVarbits(value, keepJar);
    player.setAttribute(VARS_ATTRIBUTE, next);
    resend(player);
  }

  /** Maps a save from the old plugin once. */
  function migrate(player) {
    if (Number(player.getAttribute(SAVE_VERSION_ATTRIBUTE)) >= SAVE_VERSION) return;
    player.setAttribute(SAVE_VERSION_ATTRIBUTE, SAVE_VERSION);
    const old = stage(player);
    const bits = Number(player.getAttribute(LEGACY_BITS_ATTRIBUTE)) || 0;
    const legacyJar = player.getAttribute(LEGACY_JAR_ATTRIBUTE);
    if (old <= 0 && !bits) return;
    const mapped = migratedStage(old);
    const jarValue = Math.max(1, JARS.findIndex((entry) => entry?.key === legacyJar));
    if (mapped !== old) getQuest().setStage(player, mapped);
    player.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(mapped, jarValue), ...legacyVarbits(bits, mapped) });
    player.setAttribute(LEGACY_BITS_ATTRIBUTE, 0);
    player.setAttribute(LEGACY_JAR_ATTRIBUTE, "");
  }

  api.persistAttribute(VARS_ATTRIBUTE, {});
  api.persistAttribute(SAVE_VERSION_ATTRIBUTE, 0);
  api.persistAttribute(LEGACY_BITS_ATTRIBUTE, 0);
  api.persistAttribute(LEGACY_JAR_ATTRIBUTE, "");

  return { get, set, stage, setStage, jar, resend, clear, align, migrate };
}

module.exports = {
  STAGE, VARBIT, JARS, FIRST_TILE_VARBIT, createState,
  _test: { migratedStage, impliedVarbits, legacyVarbits, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE, LEGACY_BITS_ATTRIBUTE, LEGACY_JAR_ATTRIBUTE },
};
