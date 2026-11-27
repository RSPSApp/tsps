/**
 * Leagues VI's separate Yama's Lair plays Sign Here (Wiki: Yama's Lair). The normal
 * domain's music map covers different tiles; the league lair occupies cache map square 5975.
 * Use the area's music policy so entry, relog and music modes follow the normal session path.
 */

const Common = require("./Common.LeagueAreaUnlocks");

const DEMONIC_PACTS = 6;
const STEEL_RANK = 3;
const INTRODUCED_ATTRIBUTE = "league:yama-introduced";
const TRANSCRIPT = "Yama";
const VARIANTS = {
  initial: "standard-dialogue-demonic-pacts-league-initial-dialogue",
  lower: "standard-dialogue-demonic-pacts-league-subsequent-dialogue-at-iron-or-lower-rank",
  higher: "standard-dialogue-demonic-pacts-league-subsequent-dialogue-at-steel-or-higher-rank",
};
let dialogueApi;

function isLeagueYama({ player, npcId }) {
  // YAMA_4 is the actor at the League spawn in rsprox 237/01098.
  return npcId === dialogueApi.core.NpcIdentifiers.YAMA_4 && Common.leagueOf(player) === DEMONIC_PACTS;
}

function rankOf(player) {
  const query = { player, rank: 0 };
  dialogueApi.emitCustomEvent("league:rank", query);
  return query.rank;
}

function dialogueVariant(event) {
  if (!isLeagueYama(event)) return null;
  const variant = !event.player.getAttribute(INTRODUCED_ATTRIBUTE) ? VARIANTS.initial
    : rankOf(event.player) >= STEEL_RANK ? VARIANTS.higher : VARIANTS.lower;
  return { page: TRANSCRIPT, variant };
}

function isIntroduction(event) {
  return isLeagueYama(event) && event.playing?.page === TRANSCRIPT && event.playing.variant === VARIANTS.initial;
}

function finishIntroduction(event) {
  if (isIntroduction(event) && event.option === "Goodbye.") {
    event.player.setAttribute(INTRODUCED_ATTRIBUTE, true);
  }
}

function dialogueCondition(event) {
  if (!isIntroduction(event)) return null;
  // The transcript records the greeting variants by rank, but does not establish
  // the exact predicates for these introductory asides. Use ranked vs unranked.
  switch (event.text) {
    case "Unknown condition - seen when unranked":
      return rankOf(event.player) === 0;
    case "Unknown condition - seen at Iron, Steel, Mithril, Rune, and Dragon rank":
    case "Unknown condition - seen at Mithril, Rune, and Dragon rank":
      return rankOf(event.player) > 0;
    default:
      return null;
  }
}

const YAMA_LAIR_REGION = 5975;
const SIGN_HERE_TRACK = 280;

function createLair(api) {
  const { Area, Boundary } = api.core;
  const x = (YAMA_LAIR_REGION >> 8) << 6;
  const y = (YAMA_LAIR_REGION & 0xff) << 6;
  const boundary = new Boundary(x, x + 63, y, y + 63, 0);
  return new (class YamasLair extends Area {
    constructor() { super([boundary]); }

    getMusicTrack(player) {
      // Membership can trail a teleport by a tick; never override the destination's music.
      return boundary.inside(player.getLocation()) ? SIGN_HERE_TRACK : null;
    }
  })();
}

module.exports = function attach(api) {
  dialogueApi = api;
  api.registerArea(createLair(api));
  api.persistAttribute(INTRODUCED_ATTRIBUTE, false);
  api.onNpcDialogueVariant(dialogueVariant);
  api.onNpcDialogueCondition(dialogueCondition);
  api.onCustomEvent("npc-dialogue:choice", finishIntroduction);
};
