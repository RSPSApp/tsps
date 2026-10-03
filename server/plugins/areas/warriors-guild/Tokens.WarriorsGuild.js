/**
 * Warriors' Guild: claiming tokens from the training staff, through their Wiki transcripts
 * ("May I claim my tokens please?") and their Claim-Tokens option, and filling in the blanks the
 * transcripts leave ("[number] token[s]", "[player name]", "[Madam/Sir]").
 */
const Guild = require("./Common.WarriorsGuild");

/** The staff who keep the ledger, and how they answer the Claim-Tokens option. */
const PLAIN = {
  none: "I'm afraid you have not earned any tokens yet. Try some of the activities around the guild to earn some.",
  noneReply: "Ok, I'll go see what I can find.",
  full: "You don't have space to carry them.",
  paid: (amount) => `Of course! Here you go, you've earned ${amount} token${amount === 1 ? "" : "s"}!`,
};
const SHANOMI = {
  none: "No tokens earned have you. In training activities participate you must.",
  noneReply: "Okay, I'll go see what I can find to do around here to earn some tokens.",
  full: "No space you have carry them for.",
  fullReply: "Right, I need space in my pack for them. I'll be back!",
  paid: (amount) => `Yes yes! Earned you have ${amount} token${amount === 1 ? "" : "s"}!`,
};

function staff() {
  const { NPCS } = Guild;
  return new Map([
    [NPCS.GAMFRED, PLAIN], [NPCS.AJJAT, PLAIN], [NPCS.KAMFREENA, PLAIN], [NPCS.SHANOMI, SHANOMI],
    [NPCS.REF_NORTH, PLAIN], [NPCS.REF_SOUTH, PLAIN], [NPCS.LORELAI, PLAIN], [NPCS.SLOANE, PLAIN],
  ]);
}

let STAFF;

function hasRoom(player) {
  const inventory = player.getInventory();
  return inventory.contains(Guild.ITEMS.TOKEN) || inventory.getFreeSlots() > 0;
}

function claimTokens({ player, npc }) {
  const lines = STAFF.get(npc.getId());
  if (!lines) return false;
  const npcId = npc.getId();
  const amount = Guild.ledger(player);
  const ask = { player: "May I claim my tokens please?" };
  if (amount <= 0) {
    Guild.talk(player, [ask, { npc: npcId, text: lines.none }, { player: lines.noneReply }]);
  } else if (!hasRoom(player)) {
    Guild.talk(player, [ask, { npc: npcId, text: lines.full }, ...(lines.fullReply ? [{ player: lines.fullReply }] : [])]);
  } else {
    Guild.talk(player, [ask, { npc: npcId, text: lines.paid(amount) }, () => Guild.payOut(player), { player: "Thanks!" }]);
  }
}

/** The transcripts' token conditions, for every member of staff who pays out. */
function tokenCondition({ player, npcId, text }) {
  if (!STAFF.has(npcId)) return null;
  const earned = Guild.ledger(player) > 0;
  switch (text) {
    case "If the player has earned Warrior guild tokens, but has no inventory space:":
    case "If the player's inventory is full:":
      return earned && !hasRoom(player);
    case "If the player has earned Warrior guild tokens:":
    case "If the player has tokens to claim:":
      return earned;
    case "If the player is eligible to receive tokens:":
      return earned && hasRoom(player);
    case "If the player has not earned Warrior guild tokens:":
    case "If the player has no tokens to claim:":
    case "If the player is not eligible to receive tokens:":
      return !earned;
    case "If the player has no inventory space:":
      // Sloane's token branch; Gamfred asks the same about his shield (Catapult).
      return npcId === Guild.NPCS.SLOANE ? !hasRoom(player) : null;
    default:
      return null;
  }
}

/** The step where the tokens change hands ("Warrior guild tokens", "[amount] Warrior guild tokens"...). */
function payTokens(event) {
  if (!STAFF.has(event.npcId) || event.kind === "message" || !/warrior guild tokens/i.test(event.text ?? "")) return;
  Guild.payOut(event.player);
  event.handled = true;
}

function pick(player, male, female) {
  return player.getAppearance().isMale() ? male : female;
}

/** Fills the transcripts' blanks for the guild's people. */
function fillBlanks(request) {
  const { player } = request;
  const amount = Guild.ledger(player);
  request.text = String(request.text)
    .replace(/\[(?:number|amount|X)\] token\[s\]/g, `${amount} token${amount === 1 ? "" : "s"}`)
    .replace(/\[(?:number|amount|X)\]/g, String(amount))
    .replace(/\[player name\]/gi, player.getUsername())
    .replace(/\[Madam\/Sir\]/g, pick(player, "Sir", "Madam"))
    .replace(/\[(\w+)\/(\w+)\]/g, (match, first, second) => {
      // "[boy/lady]", "[he/she]", "[lad/lass]": the transcripts list the male form first.
      if (/^(he|him|his|boy|man|sir|lad|brave warrior)$/i.test(first)) return pick(player, first, second);
      return match;
    })
    .replace(/\[brave warrior\/fair lady\]/g, pick(player, "brave warrior", "fair lady"));
}

/** The guild's people whose lines carry blanks: the staff, plus those who never pay out. */
let SPEAKERS;

function fillGuildBlanks(request) {
  if (SPEAKERS.has(request.npcId)) fillBlanks(request);
}

module.exports = function attachTokens(api) {
  STAFF = staff();
  SPEAKERS = new Set([...STAFF.keys(), Guild.NPCS.GHOMMAL, Guild.NPCS.HARRALLAK, Guild.NPCS.JIMMY]);
  api.persistAttribute(Guild.LEDGER_ATTRIBUTE);
  for (const name of ["Gamfred", "Ajjat", "Kamfreena", "Shanomi", "Ref", "Lorelai", "Sloane"]) {
    api.onNpcInteraction(name, { "Claim-Tokens": claimTokens });
  }
  api.onNpcDialogueCondition(tokenCondition);
  api.onCustomEvent("npc-dialogue:action", payTokens);
  api.onCustomEvent("npc-dialogue:line", fillGuildBlanks);
};
