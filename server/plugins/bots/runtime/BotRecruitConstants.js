"use strict";

const ATTR_RECRUIT_OWNER_USERNAME = "bot-recruit-owner-username";
const ATTR_RECRUIT_RETURN_AFTER_DEATH_AT = "bot-recruit-return-after-death-at";
const ATTR_BOT_PVP_PROFILE_ID = "bot-pvp-profile-id";
const ATTR_RECRUIT_OWNER_MISSING_SINCE = "bot-recruit-owner-missing-since";
const ATTR_CUSTOM_DEATH_LOOT_DROPPED = "bot-custom-death-loot-dropped";

const BOT_PROFILE_RETURN_DELAY_MS = Object.freeze({
  novice: 30000,
  standard: 15000,
  veteran: 10000,
  elite: 5000,
});

function getRecruitReturnDelayMs(profileId) {
  return BOT_PROFILE_RETURN_DELAY_MS[String(profileId ?? "").toLowerCase()] ?? 15000;
}

module.exports = {
  ATTR_RECRUIT_OWNER_USERNAME,
  ATTR_RECRUIT_RETURN_AFTER_DEATH_AT,
  ATTR_BOT_PVP_PROFILE_ID,
  ATTR_RECRUIT_OWNER_MISSING_SINCE,
  ATTR_CUSTOM_DEATH_LOOT_DROPPED,
  getRecruitReturnDelayMs,
};
