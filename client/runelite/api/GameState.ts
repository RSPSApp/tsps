/** Mirrors RuneLite's `net.runelite.api.GameState` values. */
export enum GameState {
    UNKNOWN = -1,
    STARTING = 0,
    LOGIN_SCREEN = 10,
    LOGGING_IN = 20,
    LOADING = 25,
    LOGGED_IN = 30,
    CONNECTION_LOST = 40,
    HOPPING = 45,
}
