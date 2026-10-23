import { getDefaultWsUrl } from "../../config/clientEnv";

export const WS_GLOBAL_KEY = "__OSRS_CLIENT_WS_SINGLETON__";
export const WS_SUPPRESS_RECONNECT_KEY = "__OSRS_CLIENT_WS_SUPPRESS_RECONNECT__";
export const INVENTORY_SLOT_COUNT = 28;
export const BANK_SLOT_COUNT_FALLBACK = 1410;
export const CLIENT_TICK_MS = 20;
export const RUN_ENERGY_MAX_UNITS = 10000;
export const DEFAULT_SERVER_TICK_MS = 600;

export const getEnv = (key: string): string | undefined =>
    typeof process !== "undefined" && process.env ? process.env[key] : undefined;

export const DEFAULT_URL = getDefaultWsUrl();
export const LOGIN_CONNECT_RETRY_DELAY_MS = 1000;
/**
 * How often the client says it is still there. The server drops a connection that goes quiet
 * (a phone that sleeps or changes network never closes its socket, least of all through a
 * tunnel), and the player could not log back in while that session lived on.
 */
export const KEEPALIVE_INTERVAL_MS = 5000;
/** LOGIN packet flags: ask for a "Stay logged in" token. */
export const LOGIN_FLAG_REMEMBER = 1;
/** LOGIN packet flags: the password field holds that token. */
export const LOGIN_FLAG_TOKEN = 2;
export const RECONNECT_DELAY_MAX_MS = 1000;
export const RECONNECT_MAX_ATTEMPTS = 1;
