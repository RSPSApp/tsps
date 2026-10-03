import { type Boat, BoatMoveMode } from "./Boat";
import { type SailableTileCheck, canOccupy } from "./BoatCollision";
import { angleToFineDelta, normalizeAngle, reverseAngle, turnAngleDelta } from "./HeadingUtils";

/*
 * Per-tick boat movement. Full sail moves the boat's base speed, set by its hull (the wiki's
 * base speeds: wooden 1.5 tiles a tick, teak 2, camphor 2.5); half sail moves half that,
 * turning or not. The turn rate comes from rsmod's
 * `BoatMovement.kt` and its live traces (https://github.com/rsmod/rsmod, ISC license): 128
 * angle units a tick.
 *
 * Unlike rsmod, reverse keeps the bow on the helm heading and backs up at half speed instead
 * of turning the boat around.
 */
export const TURN_RATE = 128;
/** A raft's (wooden hull) full sail speed; each boat sails at its hull's base speed. */
export const FULL_SAIL_SPEED = 192;
export const HALF_SAIL_SPEED = FULL_SAIL_SPEED / 2;
/** A move is checked in steps of at most half a tile, so a fast boat can't hop over land. */
const MOVE_STEP = 64;

export interface BoatStep {
    moved: boolean;
    turned: boolean;
    /** The hull hit something it can't sail over this tick. */
    blocked: boolean;
}

export function tickBoat(boat: Boat, isSailable: SailableTileCheck): BoatStep {
    const step: BoatStep = { moved: false, turned: false, blocked: false };
    if (boat.moveMode === BoatMoveMode.Stopped) return step;

    // Turning doesn't cost speed: the boat swings towards its heading, then sails on at its
    // sail speed along the new facing.
    const delta = turnAngleDelta(boat.angle, boat.heading);
    if (delta !== 0) {
        const angle = normalizeAngle(boat.angle + Math.max(-TURN_RATE, Math.min(TURN_RATE, delta)));
        if (canOccupy(boat, boat.fineX, boat.fineY, angle, isSailable)) {
            boat.angle = angle;
            step.turned = true;
        }
    }

    const speed = boat.moveMode === BoatMoveMode.Full ? boat.baseSpeed : boat.baseSpeed / 2;
    const distance = speed * Math.max(1, boat.speedMultiplier);
    const startX = boat.fineX;
    const startY = boat.fineY;
    for (let travelled = 0; travelled < distance; ) {
        travelled = Math.min(distance, travelled + MOVE_STEP);
        const partial = angleToFineDelta(travelAngle(boat, boat.angle), travelled);
        const x = startX + partial.dx;
        const y = startY + partial.dy;
        if (!canOccupy(boat, x, y, boat.angle, isSailable)) {
            step.blocked = true;
            break;
        }
        applyPosition(boat, x, y, step);
    }
    return step;
}

function travelAngle(boat: Boat, facing: number): number {
    return boat.moveMode === BoatMoveMode.Reverse ? reverseAngle(facing) : facing;
}

function applyPosition(boat: Boat, x: number, y: number, step: BoatStep): void {
    if (x === boat.fineX && y === boat.fineY) return;
    boat.fineX = x;
    boat.fineY = y;
    step.moved = true;
}
