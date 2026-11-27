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

function returnVariant(player) {
  return rankOf(player) >= STEEL_RANK ? VARIANTS.higher : VARIANTS.lower;
}

function talkAgain({ player, npc, npcId }) {
  if (!isLeagueYama({ player, npcId }) || !player.getAttribute(INTRODUCED_ATTRIBUTE)) return false;

  const request = { player, npc, npcId, exact: true, handled: false };
  let greetings;
  dialogueApi.emitCustomEvent("npc-dialogue:start", {
    ...request,
    variant: { page: TRANSCRIPT, variant: returnVariant(player) },
    select(steps) {
      greetings = steps.find(step => step.type === "random");
      return [];
    },
  });
  if (!greetings?.options?.length) return false;

  // The transcript's "above" refers to the shared introduction menu. Keep each
  // greeting's line, removing the jump that the random runner would resolve as
  // another alternative's speech. Then play the existing menu and its branches.
  const greeting = {
    ...greetings,
    options: greetings.options.map(option => ({
      ...option, steps: option.steps.filter(step => step.type !== "jump"),
    })),
  };
  request.variant = { page: TRANSCRIPT, variant: VARIANTS.initial };
  request.select = steps => {
    const menu = steps.find(step => step.type === "choice");
    return menu ? [greeting, menu] : [];
  };
  dialogueApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function dialogueVariant(event) {
  if (!isLeagueYama(event)) return null;
  const variant = !event.player.getAttribute(INTRODUCED_ATTRIBUTE) ? VARIANTS.initial
    : returnVariant(event.player);
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
  api.onNpcInteraction("Yama", { "Talk-to": talkAgain });
  api.onNpcDialogueVariant(dialogueVariant);
  api.onNpcDialogueCondition(dialogueCondition);
  api.onCustomEvent("npc-dialogue:choice", finishIntroduction);
};
