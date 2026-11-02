import { useCallback, useSyncExternalStore } from "react";

import type { GameStateMachine } from "./state/GameStateMachine";
import { GameState } from "./login/GameState";

export function useSubscribedGameState(stateMachine: GameStateMachine): GameState {
    const subscribe = useCallback(
        (listener: () => void) => stateMachine.subscribe(listener),
        [stateMachine],
    );
    const getSnapshot = useCallback(() => stateMachine.getState(), [stateMachine]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isSidebarVisible(gameState: GameState, hideUi: boolean): boolean {
    return !hideUi && gameState >= GameState.LOGIN_SCREEN;
}

export function useSidebarVisible(stateMachine: GameStateMachine, hideUi: boolean): boolean {
    return isSidebarVisible(useSubscribedGameState(stateMachine), hideUi);
}
