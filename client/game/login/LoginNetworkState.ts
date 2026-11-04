/**
 * Login network protocol state (matches reference loginState 0-22).
 * Controls the handshake flow with the game server.
 */
export enum LoginNetworkState {
    /** Initial state - not connected */
    INIT = 0,

    /** Establishing socket connection */
    CONNECT_SOCKET = 1,

    /** Sending login packet to server */
    SEND_LOGIN_PACKET = 2,

    /** Waiting for server challenge */
    WAIT_CHALLENGE = 3,

    /** Reading server seed */
    READ_SERVER_SEED = 4,

    /** Sending encrypted credentials */
    SEND_CREDENTIALS = 5,

    /** Waiting for login response */
    WAIT_RESPONSE = 6,

    /** Reading player info - decompression stage 1 */
    READ_PLAYER_INFO_1 = 7,

    /** Reading player info - decompression stage 2 */
    READ_PLAYER_INFO_2 = 8,

    /** Reading player info - decompression stage 3 */
    READ_PLAYER_INFO_3 = 9,

    /** Update check - reading update info */
    UPDATE_CHECK_1 = 10,

    /** Update check - processing update */
    UPDATE_CHECK_2 = 11,

    /** World change cooldown - profile transfer message */
    WORLD_CHANGE_COOLDOWN_1 = 12,

    /** World change cooldown - waiting */
    WORLD_CHANGE_COOLDOWN_2 = 13,

    /** Account selection - reading account list */
    ACCOUNT_SELECTION_READ = 14,

    /** Account selection - processing accounts */
    ACCOUNT_SELECTION_PROCESS = 15,

    /** Loading player data - reading initial packets */
    LOAD_PLAYER_DATA = 16,

    /** Server redirect - reading redirect info */
    SERVER_REDIRECT_1 = 17,

    /** Server redirect - processing redirect */
    SERVER_REDIRECT_2 = 18,

    /** Game ready - final transition state */
    GAME_READY = 19,

    /** OTL token request */
    OTL_TOKEN_REQUEST = 20,

    /** OAuth token refresh */
    OAUTH_REFRESH = 21,

    /** Login complete - transitioning to game */
    COMPLETE = 22,
}

/**
 * Login error codes from server (matches reference).
 * Used by handleLoginError() to determine which loginIndex to show.
 */
export enum LoginErrorCode {
    /** Success - no error */
    SUCCESS = 0,

    /** Wait 2 seconds before trying again */
    WAIT_2_SECONDS = 1,

    /** World is full */
    WORLD_FULL = 2,

    /** Incorrect username or password */
    INVALID_CREDENTIALS = 3,

    /** Account is disabled */
    ACCOUNT_DISABLED = 4,

    /** Already logged in */
    ALREADY_LOGGED_IN = 5,

    /** Game was updated - refresh client */
    CLIENT_OUTDATED = 6,

    /** The selected world and browser use incompatible game protocols. */
    PROTOCOL_MISMATCH = 1001,

    /** Server is being updated */
    SERVER_UPDATING = 7,

    /** Login server busy */
    LOGIN_SERVER_BUSY = 8,

    /** Too many login attempts from this IP */
    TOO_MANY_ATTEMPTS = 9,

    /** Bad session ID */
    BAD_SESSION = 10,

    /** Login server rejected session */
    SESSION_REJECTED = 11,

    /** Members-only world */
    MEMBERS_WORLD = 12,

    /** Could not complete login */
    LOGIN_FAILED = 13,

    /** Server update in progress */
    SERVER_UPDATE_PROGRESS = 14,

    /** Too many incorrect logins */
    TOO_MANY_INCORRECT = 16,

    /** Standing in members area */
    MEMBERS_AREA = 17,

    /** Account locked */
    ACCOUNT_LOCKED = 18,

    /** Closed beta */
    CLOSED_BETA = 19,

    /** Invalid login server */
    INVALID_LOGIN_SERVER = 20,

    /** Moving worlds */
    MOVING_WORLDS = 21,

    /** Malformed login packet */
    MALFORMED_PACKET = 22,

    /** No reply from login server */
    NO_REPLY = 23,

    /** Error loading profile */
    PROFILE_ERROR = 24,

    /** Unexpected response */
    UNEXPECTED_RESPONSE = 25,

    /** Computer address blocked */
    ADDRESS_BLOCKED = 26,

    /** Service unavailable */
    SERVICE_UNAVAILABLE = 27,

    /** Display name required */
    DISPLAY_NAME_REQUIRED = 31,

    /** Billing system error */
    BILLING_ERROR = 32,

    /** Account in PvP area */
    PVP_AREA = 37,

    /** Need authenticator code */
    AUTHENTICATOR_REQUIRED = 56,

    /** Wrong authenticator code */
    AUTHENTICATOR_WRONG = 57,

    /** Date of birth required */
    DOB_REQUIRED = 61,

    /** Terms not accepted */
    TERMS_NOT_ACCEPTED = 62,

    /** Email not validated */
    EMAIL_NOT_VALIDATED = 64,

    /** General login error */
    GENERAL_ERROR = 65,

    /** Use Jagex Launcher */
    USE_LAUNCHER = 67,
}
