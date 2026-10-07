import { GameState as RuneLiteGameState } from "@runelite/api/GameState";
import { GameState as EngineGameState } from "../../game/login/GameState";

/** Maps our engine GameState onto RuneLite's enum values. */
export function toRuneLiteGameState(state: EngineGameState): RuneLiteGameState {
    switch (state) {
        case EngineGameState.DOWNLOADING:
            return RuneLiteGameState.UNKNOWN;
        case EngineGameState.LOADING:
            return RuneLiteGameState.STARTING;
        case EngineGameState.LOGIN_SCREEN:
        case EngineGameState.SPECIAL_LOGIN:
            return RuneLiteGameState.LOGIN_SCREEN;
        case EngineGameState.CONNECTING:
            return RuneLiteGameState.LOGGING_IN;
        case EngineGameState.LOADING_GAME:
            return RuneLiteGameState.LOADING;
        case EngineGameState.LOGGED_IN:
            return RuneLiteGameState.LOGGED_IN;
        case EngineGameState.RECONNECTING:
        case EngineGameState.CONNECTION_LOST:
            return RuneLiteGameState.CONNECTION_LOST;
        case EngineGameState.PLEASE_WAIT:
            return RuneLiteGameState.HOPPING;
        default:
            return RuneLiteGameState.UNKNOWN;
    }
}
