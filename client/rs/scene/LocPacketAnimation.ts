import { ROPESWING_LONG } from "../../runelite/api/gameval/AnimationID";
import { OBSTICAL_ROPESWING1, OBSTICAL_ROPESWING2 } from "../../runelite/api/gameval/ObjectID";
import { LocModelType } from "../config/loctype/LocModelType";

/** These short course swings start in the same server tick as the player's sequence. */
export function preparedLocSequence(locId: number, shape: number): number | undefined {
    if (shape === LocModelType.NORMAL &&
        (locId === OBSTICAL_ROPESWING1 || locId === OBSTICAL_ROPESWING2)) return ROPESWING_LONG;
    return undefined;
}
