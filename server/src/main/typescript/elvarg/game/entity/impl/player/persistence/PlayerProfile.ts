/**
 * Which of an account's characters a save belongs to. Live OSRS keeps a separate character per
 * account on a Leagues world and on a Hardcore world; here a world that runs one (its plugin
 * config) logs every account into that character, which lives in its own save, never as a flag on
 * the main one. They all share the account's name, so only one of them can be online at a time,
 * as on live.
 */
export type PlayerProfile = "main" | "league" | "hardcore";

export const MAIN_PROFILE: PlayerProfile = "main";
export const LEAGUE_PROFILE: PlayerProfile = "league";
export const HARDCORE_PROFILE: PlayerProfile = "hardcore";

/** Every profile an account can have a character in, the main one first. */
export const PLAYER_PROFILES: readonly PlayerProfile[] = [MAIN_PROFILE, LEAGUE_PROFILE, HARDCORE_PROFILE];

/** The account's other characters, in PLAYER_PROFILES order: the saves that vouch for a login of a character not made yet. */
export function otherProfiles(profile: PlayerProfile): PlayerProfile[] {
    return PLAYER_PROFILES.filter((other) => other !== profile);
}


/**
 * A backend's key for a profile's save. The main profile keeps the plain (normalised) name; any
 * other is prefixed after normalisation, with a character normalisation never emits, so no real
 * account name can collide with it.
 */
export function profileStorageKey(normalizedUsername: string, profile: PlayerProfile = MAIN_PROFILE): string {
    return profile === MAIN_PROFILE ? normalizedUsername : `${profile}:${normalizedUsername}`;
}
