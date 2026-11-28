/**
 * Nickolaus's camp-site and the cliff, as the capture plays them (RSProx, rev 243). The camp's locs are the map's
 * own multilocs on eaglepeak_quest: the camping equipment (19788, 2318,3507), books (19787, 2319,3506) and
 * campfire (19785, 2318,3505) only have Inspect while the camp is "messy" (5-20), and the rocky outcrop (19790,
 * 2328,3494) is the cave entrance from 15.
 * - Camping equipment: a game message (t231). Campfire: a game message (t242).
 * - Books: the bird book's box and the book itself at once (t238); a carried book or feather has the
 *   "again" line; from 10, a lost metal feather comes back with its own box (Transcript).
 * - Bird book, Read: at 5 the box first, with the stage at 10 and the feather (t245), and the book on its continue
 *   (human_readbook, t247); after that, the book alone. Its pages are the capture's (t247-255).
 * - Metal feather on the outcrop: two boxes, the stage at 15 on the first's continue (t277-280). The feather is kept.
 * - The cave entrance: "You enter the tunnel." (filterable) and the eyrie (1994,4983,3), on arrival (t284).
 */
module.exports = function attachEaglesPeakCamp(api, ep) {
  const { state, TEXT } = ep;
  const { STAGE, ITEM } = state;
  const { Location, ChatType, ObjectDefinition } = api.core;
  const { openIndexedBook } = require("../QuestRuntime");

  const LOC = Object.freeze({
    EQUIPMENT: 19788, BOOKS: 19787, CAMPFIRE: 19785, ENTRANCE: 19790,
    OUTCROP: 19925, CAVE: 19926,
  });
  const EYRIE_LANDING = Object.freeze([1994, 4983, 3]);
  const READ_BOOK = 1350; // human_readbook

  /** William Oddity's Guide to the Avian, as live sends it (t247-255): a model is an item on its page. */
  const BIRD_BOOK = Object.freeze({
    title: "William Oddity's Guide to the Avian",
    spreads: [
      [["", "<col=000080>Contents", " ", { index: "Crimson Swift" }, { index: "Cerulean Twitch" }, { index: "Golden Warbler" },
        { index: "Tropical Wagtail" }, { index: "Copper Longtail" }, { index: "Giant Eagle" }],
      ["<col=000080>Crimson Swift", "", "", { model: 9965 }, "", "", "This tropical bird is typically", "found in dense jungle areas.",
        "Subtlety is not one of its", "strong points with its striking", "red plumage ensuring it will", "be visible wherever it goes.",
        "This makes it a popular first", "bird for hunters and spotters", "alike."]],
      [["<col=000080>Cerulean Twitch", "", "", { model: 9967 }, "", "", "This polar bird, found in the", "far Northern regions, can",
        "survive at impressively low", "temperatures. Although its", "long tail affords it great", "manoeuvrability, it is also the",
        "cause of a great deal of", "interest from collectors."],
      ["<col=000080>Golden Warbler", "", "", { model: 9968 }, "", "", "The golden warbler can be", "easily identified by its",
        "hideously annoying song.", "Although the warbler is prized", "by hunters for its fine", "feathers, it is probably caught",
        "just as much simply to shut", "it up."]],
      [["<col=000080>Tropical Wagtail", "", "", { model: 9969 }, "", "", "This beautiful bird can be", "found in hot jungle climates",
        "where it expertly catches", "small insects for food. It is", "perhaps therefore ironic that", "it is usually caught for its",
        "bright plumage, which can be", "used in turn to make", "excellent fly fishing lures."],
      ["<col=000080>Copper Longtail", "", "", { model: 9966 }, "", "", "The copper longtail is found", "in temperate wooded regions",
        "and is one of the most", "common birds in the world.", "Although its appearance is", "unremarkable it is a graceful",
        "and successful bird that", "continues to fend well for", "itself."]],
      [["<col=000080>Giant Eagle", " ", "Little is known about the", "giant eagles. There are", "reported sightings in many",
        "parts of the world, but the", "nests of these magnificent", "creatures remain elusive. The", "only record of such a nest",
        "being found is in the folk tale", "of the bandits of the golden", "claw. It is said that the", "bandits leader could talk to",
        "and befriend the eagles, and", "used the eagles' nest at the"],
      ["top of what is now known as", "eagles' peak as a hideout. The", "story goes on to hint at a", "secret entrance to the",
        "hideaway existing near the", "peak of the mountain, but", "until this day it has not been", "found."]],
    ],
    /** Contents entry -> spread. */
    spreadOf: (index) => ({ "Crimson Swift": 0, "Cerulean Twitch": 1, "Golden Warbler": 1, "Tropical Wagtail": 2,
      "Copper Longtail": 2, "Giant Eagle": 3 })[index] ?? 0,
  });

  const stage = (player) => state.stage(player);
  const resolved = (event) => event.definition?.id
    ?? ObjectDefinition.forPlayer(event.objectId, event.player)?.id ?? event.objectId;
  const message = (player, text) => player.sendMessage(text);

  function inspectEquipment(event) {
    if (event.objectId !== LOC.EQUIPMENT) return false;
    message(event.player, TEXT.EQUIPMENT);
    return true;
  }

  function inspectCampfire(event) {
    if (event.objectId !== LOC.CAMPFIRE) return false;
    message(event.player, TEXT.CAMPFIRE);
    return true;
  }

  function inspectBooks(event) {
    if (event.objectId !== LOC.BOOKS) return false;
    const { player } = event;
    const current = stage(player);
    if (current === STAGE.STARTED && !state.held(player, ITEM.BIRD_BOOK)) {
      giveOrDrop(player, ITEM.BIRD_BOOK);
      ep.mesbox(player, TEXT.BOOK_FOUND);
      return true;
    }
    if (current > STAGE.STARTED && current < STAGE.COMPLETE && !state.has(player, ITEM.METAL_FEATHER)) {
      giveOrDrop(player, ITEM.METAL_FEATHER);
      ep.mesbox(player, TEXT.FEATHER_RECLAIMED);
      return true;
    }
    message(player, TEXT.BOOKS_AGAIN);
    return true;
  }

  /** A full inventory still gets the item: on the floor, as the runtime's rewards are. */
  function giveOrDrop(player, itemId) {
    player.getInventory().forceAdd(player, new api.core.Item(itemId, 1));
  }

  function readBirdBook(event) {
    const { player } = event;
    if (stage(player) === STAGE.STARTED) {
      state.setStage(player, STAGE.BOOK_READ);
      if (!state.has(player, ITEM.METAL_FEATHER)) giveOrDrop(player, ITEM.METAL_FEATHER);
      ep.mesbox(player, TEXT.BOOK_OPENED, openBirdBook);
      return true;
    }
    openBirdBook(player);
    return true;
  }

  function openBirdBook(player) {
    ep.animate(player, READ_BOOK);
    openIndexedBook(player, BIRD_BOOK, () => player.performAnimation?.(new api.core.Animation(-1)));
  }

  function inspectOutcrop(event) {
    if (event.objectId !== LOC.ENTRANCE || resolved(event) !== LOC.OUTCROP) return false;
    ep.mesbox(event.player, TEXT.OUTCROP);
    return true;
  }

  function enterCave(event) {
    if (event.objectId !== LOC.ENTRANCE || resolved(event) !== LOC.CAVE) return false;
    const { player } = event;
    if (stage(player) < STAGE.CAVE_OPEN) return true;
    player.getPacketSender().sendTypedMessage(ChatType.SPAM, TEXT.TUNNEL);
    player.moveTo(new Location(...EYRIE_LANDING));
    return true;
  }

  function featherOnCliff(event) {
    const { player } = event;
    if (event.objectId !== LOC.ENTRANCE) return false;
    if (resolved(event) === LOC.CAVE || stage(player) >= STAGE.CAVE_OPEN) {
      message(player, TEXT.CLIFF_ALREADY_OPEN);
      return true;
    }
    if (stage(player) < STAGE.BOOK_READ) return false;
    ep.mesbox(player, TEXT.FEATHER_IN_CLIFF, () => {
      if (stage(player) === STAGE.BOOK_READ) state.setStage(player, STAGE.CAVE_OPEN);
      ep.mesbox(player, TEXT.CLIFF_OPENS);
    });
    return true;
  }

  api.onObjectInteraction("Camping equipment", { Inspect: inspectEquipment });
  api.onObjectInteraction("Campfire", { Inspect: inspectCampfire });
  api.onObjectInteraction("Books", { Inspect: inspectBooks });
  api.onObjectInteraction("Rocky outcrop", { Inspect: inspectOutcrop });
  api.onObjectInteraction("Cave entrance", { Enter: enterCave });
  api.onItemOnObject("Metal feather", "Rocky outcrop", featherOnCliff);
  api.onItemOnObject("Metal feather", "Cave entrance", featherOnCliff);
  api.onItemAction("Bird book", { Read: readBirdBook });

  return { LOC, BIRD_BOOK };
};
