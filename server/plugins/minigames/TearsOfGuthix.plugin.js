"use strict";

/**
 * Tears of Guthix, the weekly minigame after the quest: Juna's verdict and the way in, the cave
 * with its timer and bowl, the world's tear streams and the chasm's drifting light creatures. Each
 * unit lives in ./tearsofguthix/.
 * The quest itself is plugins/quests/quests/TearsOfGuthix.Quest.js.
 */
module.exports = {
  name: "TearsOfGuthix",
  description: "Adds the weekly Tears of Guthix minigame: Juna's entry check, the timed cave with its bowl, the tear streams and the chasm's light creatures.",
  members: true,
  register(api) {
    require("./tearsofguthix/Cave.TearsOfGuthix")(api);
    require("./tearsofguthix/Juna.TearsOfGuthix")(api);
    require("./tearsofguthix/Chasm.TearsOfGuthix")(api);
  },
};
