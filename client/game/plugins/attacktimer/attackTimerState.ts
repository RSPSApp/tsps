/**
 * The local player's attack timer, as the server sends it (ATTACK_TIMER): the ticks until their
 * next attack, whenever that changes (an attack, eating, a special). Kept as the server tick it
 * ends on, so it counts down with the ticks.
 */
let endsAtTick = 0;
let setAtTick = 0;

/** `currentTick` is the tick the value counts from: the one about to begin when it arrives. */
export function setAttackTimer(ticks: number, currentTick: number): void {
    setAtTick = currentTick | 0;
    endsAtTick = setAtTick + Math.max(0, ticks | 0);
}

/** A new session (a login, another world, a restarted server) starts without a timer. */
export function clearAttackTimer(): void {
    endsAtTick = 0;
    setAtTick = 0;
}

/** Ticks left until the next attack (0 when it is ready). */
export function getAttackTimerTicks(currentTick: number): number {
    const tick = currentTick | 0;
    // The value is read from the tick before the one it counts from (it arrives just before that
    // tick's TICK packet); a tick any earlier means the server's tick counter started again, as
    // after a restart, so the old timer would show hundreds of ticks.
    if (tick < setAtTick - 1) {
        clearAttackTimer();
        return 0;
    }
    return Math.max(0, endsAtTick - tick);
}
