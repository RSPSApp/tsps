"use strict";

/**
 * Tears of Guthix, the weekly minigame after the quest: Juna's verdict and the way in, the cave
 * with its timer and bowl, and the world's tear streams. Each unit lives in ./tearsofguthix/.
 * The quest itself is plugins/quests/quests/TearsOfGuthix.Quest.js.
 */
module.exports = {
  name: "TearsOfGuthix",
  members: true,
  register(api) {
    require("./tearsofguthix/Cave.TearsOfGuthix")(api);
    require("./tearsofguthix/Juna.TearsOfGuthix")(api);
  },
};
