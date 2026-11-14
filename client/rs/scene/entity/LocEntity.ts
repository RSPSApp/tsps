import { LocModelType } from "../../config/loctype/LocModelType";
import { Entity } from "./Entity";

export class LocEntity extends Entity {
    constructor(
        readonly id: number,
        readonly type: LocModelType,
        readonly rotation: number,
        readonly level: number,
        readonly tileX: number,
        readonly tileY: number,
        readonly seqId: number,
        readonly seqRandomStart: boolean,
        // Keep packet provenance: an explicit sequence equal to the parent default,
        // or -1 (stop), must survive a later multiloc transform.
        readonly seqOverride?: number,
        readonly seqRandomStartOverride?: boolean,
    ) {
        super();
    }
}
