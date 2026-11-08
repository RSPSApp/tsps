"use strict";

module.exports = {
  name: "VoiceChat",
  description: "Proximity voice chat: signalling between nearby players on the same plane and private area. Voice also needs client support and browser microphone permission.",
  enabled: false,
  register(api) {
    require("./Signalling.VoiceChat")(api);
  },
};
