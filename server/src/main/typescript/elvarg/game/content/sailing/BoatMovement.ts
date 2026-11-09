import { type Boat, BoatMoveMode } from "./Boat";
import { type SailableTileCheck, canOccupy } from "./BoatCollision";
import { angleToFineDelta, normalizeAngle, reverseAngle, turnAngleDelta } from "./HeadingUtils";

/*
 * Per-tick boat movement, as live (rsprox, Sailing recordings 856, 907, 908, 1030-1032, 3457,
 * 3461, 3578, 3579; docs/sailing.md):
 * - the target speed: full sail the hull's base speed (wooden 1.5 tiles a tick, teak 2, camphor
 *   2.5), half sail half that, reverse half a tile; a Barracuda Trial's rapids add to it up to
 *   the hull's speed cap; a burst of speed (a trim, a released wind mote) adds half a tile on
 *   top, never past the cap and a half-tile step;
 * - the speed ramps toward the target by the sails' acceleration each tick, up and down (half a
 *   tile, a tile with camphor or better sails), so a boat coasts to a stop when its sails come
 *   down; hitting rocks or land stops it dead;
 * - turning: 128 angle units a tick, at no cost to speed, moving along the new facing.
 * The turn rate is also rsmod's (`BoatMovement.kt`, https://github.com/rsmod/rsmod, ISC license).
 * Reverse keeps the bow on the helm heading and backs up.
 */
export const TURN_RATE = 128;
/** A raft's (wooden hull) full sail speed; each boat sails at its hull's base speed. */
export const FULL_SAIL_SPEED = 192;
export const HALF_SAIL_SPEED = FULL_SAIL_SPEED / 2;
/** Reverse: half a tile a tick whatever the hull (rsprox 3461, 908). */
export const REVERSE_SPEED = 64;
/** A burst of speed's step past the sails, and the most anything takes a boat past its cap. */
export const BURST_STEP = 64;
/** A move is checked in steps of at most half a tile, so a fast boat can't hop over land. */
const MOVE_STEP = 64;

export interface BoatStep {
    moved: boolean;
    turned: boolean;
    /** The hull hit something it can't sail over this tick. */
    blocked: boolean;
}

/** The speed the sails drive the boat at, in fine units a tick along the bow (negative in reverse). */
export function sailVelocity(boat: Boat): number {
    const target = targetSpeed(boat);
    return boat.moveMode === BoatMoveMode.Reverse ? -target : target;
}

export function tickBoat(boat: Boat, isSailable: SailableTileCheck): BoatStep {
    const step: BoatStep = { moved: false, turned: false, blocked: false };
    const target = sailVelocity(boat);
    boat.velocity += Math.max(-boat.acceleration, Math.min(boat.acceleration, target - boat.velocity));

    // Turning doesn't cost speed: the boat swings towards its heading, then sails on at its
    // speed along the new facing. A stopped boat turns on the spot at the same rate (rsprox:
    // crew-combat, sails lowered at the helm, then 640 -> 1280 by 128 a tick without moving).
    const delta = turnAngleDelta(boat.angle, boat.heading);
    if (delta !== 0) {
        const angle = normalizeAngle(boat.angle + Math.max(-TURN_RATE, Math.min(TURN_RATE, delta)));
        if (canOccupy(boat, boat.fineX, boat.fineY, angle, isSailable)) {
            boat.angle = angle;
            step.turned = true;
        }
    }
    if (boat.velocity === 0) return step;

    const distance = Math.abs(boat.velocity) * Math.max(1, boat.speedMultiplier);
    const travel = boat.velocity < 0 ? reverseAngle(boat.angle) : boat.angle;
    const startX = boat.fineX;
    const startY = boat.fineY;
    for (let travelled = 0; travelled < distance; ) {
        travelled = Math.min(distance, travelled + MOVE_STEP);
        const partial = angleToFineDelta(travel, travelled);
        const x = startX + partial.dx;
        const y = startY + partial.dy;
        if (!canOccupy(boat, x, y, boat.angle, isSailable)) {
            // Run aground (rocks, land): the way is lost (rsprox 3578).
            step.blocked = true;
            boat.velocity = 0;
            break;
        }
        applyPosition(boat, x, y, step);
    }
    return step;
}

/** What the sails give: full the base speed, half half of it, reverse half a tile, none when stopped. */
function sailSpeed(boat: Boat): number {
    switch (boat.moveMode) {
        case BoatMoveMode.Full: return boat.baseSpeed;
        case BoatMoveMode.Half: return boat.baseSpeed / 2;
        case BoatMoveMode.Reverse: return REVERSE_SPEED;
        default: return 0;
    }
}

function sum(values: Iterable<number>): number {
    let total = 0;
    for (const value of values) total += value;
    return total;
}

/**
 * The speed the boat is heading for: the sails, plus what pushes them under the hull's cap (a
 * trial's rapids; a lightning strike takes off), plus a burst past it (at most a step past the
 * cap), held under any limit (a fetid pool, an anchor), backing up too.
 */
export function targetSpeed(boat: Boat): number {
    const sails = sailSpeed(boat);
    if (sails <= 0) return 0;
    if (boat.moveMode === BoatMoveMode.Reverse) return Math.max(0, Math.min(sails, ...boat.speedLimits.values()));
    let target = Math.max(0, Math.min(sails + sum(boat.speedBonuses.values()), boat.speedCap));
    const burst = (boat.boostSpeed ?? 0) + sum(boat.burstBonuses.values());
    if (burst > 0) target = Math.min(target + burst, boat.speedCap + BURST_STEP);
    for (const limit of boat.speedLimits.values()) target = Math.min(target, limit);
    return Math.max(0, target);
}

function applyPosition(boat: Boat, x: number, y: number, step: BoatStep): void {
    if (x === boat.fineX && y === boat.fineY) return;
    boat.fineX = x;
    boat.fineY = y;
    step.moved = true;
}
