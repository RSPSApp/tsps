/**
 * Eagles' Peak's game messages and message boxes. Wording is Transcript:Eagles' Peak's (its {{mes}} is a game
 * message, its {{tbox}} a message box), checked against the RSProx capture (rev 243), which has every line
 * the quest played; lines the transcript lacks are the capture's. Where the two differ the Wiki's wording is
 * kept and the recorded line is noted (docs/quests/eagles-peak/README.md).
 */
module.exports = Object.freeze({
  // Camp-site
  CAMPFIRE: "A few logs are still burning so it can't have been unattended long.",
  /** Not on the Wiki: the capture's (t231, t235). */
  EQUIPMENT: "Some of the equipment seems to have been trampled into the ground.",
  BOOK_FOUND: "Amongst the scattered books one in particular grabs your attention; there seems to be something poking out from between the pages.",
  BOOK_OPENED: "As you open the book something falls out from between the pages. It appears to be a small metal feather.",
  FEATHER_RECLAIMED: "Amongst the scattered books you find a small metal feather.",
  BOOKS_AGAIN: "These books look like they've been kicked over by someone or something.",
  OUTCROP: "This area of rock doesn't quite seem to match the rest of the cliff face. There appears to be a thin vertical slot in the middle of the rock, with what appears to be a carving of a feather above it.",
  FEATHER_IN_CLIFF: "You place the metal feather into the groove in the cliff face. It seems to catch in some sort of mechanism.",
  CLIFF_OPENS: "Part of the cliff face swings outwards to reveal a tunnel heading into the mountain.",
  CLIFF_ALREADY_OPEN: "The cliff face has already opened to reveal a tunnel heading into the mountain.",
  TUNNEL: "You enter the tunnel.",

  // Bronze feather
  NET_TRAP_SPRUNG: "As you reach for the bronze feather, the netting on the ground shoots upwards, snatching the pedestal out of your reach.",
  WINCH_WOUND: "You wind the winch until it won't go any further.",
  WINCH_AGAIN: "The winch doesn't seem to turn any further.",
  SECOND_BRONZE: "I already have a bronze feather like that.",

  // Silver feather
  PEDESTAL_LOW_HUNTER: "There is a clear patch in the layer of dust covering the top of the pedestal. It looks like something lay here recently, but you don't have a high enough Hunter level to determine where it may have gone.",
  PEDESTAL_TRACKS: "There is a clear patch in the layer of dust covering the top of the pedestal. It looks like something lay here recently. Around the base of the pedestal you spy what appear to be faint footprints leading away from the area.",
  PEDESTAL_AGAIN: "There is a clear patch in the layer of dust covering the top of the pedestal. It looks like something lay here recently, but you can't find any further clues as to where it may have gone.",
  WRONG_ROCK: "Closer inspection reveals the rocks to be hard, grey and generally just rock-like.",
  FIRST_ROCK: "These rocks appear to have shifted recently. Further inspection reveals faint tracks among the debris, although they aren't tracks you recognise.",
  ROCK_AGAIN: "Apart from the unusual tracks you found earlier, there is little else to find amongst these rocks.",
  SECOND_ROCK: "After carefully examining the rocks, you manage to pick up the mysterious trail again. The tracks aren't entirely unfamiliar, but they do seem somewhat larger than any you have seen before.",
  PEER_DOWN: "You peer down the tunnel for signs of the mysterious creature.",
  /** The kebbit's appearance (t1257): said overhead. */
  STARTLED: "Er...",
  KEBBIT_STARES: "The kebbit stares at you.",
  TAUNT_MENU: ["Taunt the kebbit.", "Try something else."],
  /** The threat and the taunt, overhead and in the chatbox together (t1273-1290); not on the Wiki. */
  THREAT: "Hey, give me that!",
  TAUNT_1: "Give me that or... Er...",
  TAUNT_2: "Your mother was a hamster, and your father smelt of elderberries!",
  /** Not on the Wiki: the capture's (t1293, t1299). */
  KEBBIT_SCURRIES: "The kebbit scurries away...",
  FEATHER_DROPS: "A feather drops from the kebbit's mouth as it escapes.",
  TUNNEL_TOO_THIN: "This tunnel seems to get thinner quite quickly. I doubt a human could fit down it.",
  SILVER_RECLAIMED: "Upon closer inspection you find a small silver feather at the entrance to the tunnel.",

  // Gold feather
  SEED_TAKEN: "You take a handful of the birdseed-like substance from the holder.",
  FEEDER_NO_EFFECT: "Putting feed into this feeder seems to have no effect.",
  LEVER_MOVED: "As you move the lever you hear a low grinding elsewhere in the caves.",
  RESET_LEVER: "As you reach for the lever, you notice the word 'reset' engraved into the handle in large angular letters.",
  RESET_MENU_TITLE: "Are you sure you wish to pull this lever?",
  RESET_MENU: ["Yes, pull the reset lever.", "On second thoughts, not just yet."],
  RESET_NOTHING: "You pull the lever, but nothing much seems to happen.",
  SECOND_GOLDEN: "I already have a golden feather like that.",

  // The eagle door
  DOOR_LOCKED: "The door seems to be locked in place. There is an engraving of an eagle on the door. Three of the feathers illustrated in the engraving seem to be cut deeper than the others. It looks like they may once have contained some sort of decoration.",
  DOOR_METAL_FEATHER: "Unfortunately this metal feather doesn't seem to match any of the indentations in the engraving.",
  DOOR_EAGLE_FEATHER: "There doesn't seem to be any way of attaching this feather to the engraving. The indentations look like they probably contained some sort of decoration rather than real feathers, although there is no sign of their whereabouts now.",
  /** Live: "...indentations in the engraving." (t1194, t1936); the Wiki's "engravings" is kept. */
  DOOR_FEATHER: "You insert the metallic feather into one of the feather-shaped indentations in the engravings.",
  DOOR_LAST_FEATHER: "As you insert the metallic feather into the final indentation you hear a low grinding as if stone blocks were moving against one another.",
  DOOR_COMPLETE: "The engraving is already complete. There is nowhere left to put this feather.",

  // The eagle
  EAGLE_SWIPE: "As you approach the eagle it takes a swipe at you with its beak. It seems to object to you trying to get past.",
  EAGLE_PASSED: "You edge cautiously past the eagle; it doesn't seem to object.",
  DISGUISE_GIVEN: "You give Nickolaus a fake beak and an eagle feather cape.",

  // The ferret lesson
  TRAP_DISMANTLED: "You dismantle the trap.",
});
