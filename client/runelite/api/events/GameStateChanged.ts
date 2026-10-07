import type { GameState } from "../GameState";

export class GameStateChanged {
    constructor(private readonly gameState: GameState) {}

    getGameState(): GameState {
        return this.gameState;
    }
}
