"use strict";

module.exports = {
  name: "VoiceChat",
  register(api) {
    require("./voice/VoiceChat")(api);
  },
};
