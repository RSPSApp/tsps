import { isGroupMissingError } from "../../../rs/cache/js5/GroupMissingError";
import { preview } from "./generation/buildings/MapPlans";

type ObjectFootprint = { sizeX: number; sizeY: number };

/** Resolve sparse cache definitions locally before accepting the generated footprint. */
export async function previewEditorBuilding(
    query: URLSearchParams,
    readObject: (id: number) => ObjectFootprint,
    settled?: () => Promise<void>,
): Promise<unknown> {
    for (;;) {
        const missing = new Set<number>();
        const plan = preview(query, (id) => {
            try { return readObject(id); }
            catch (error) {
                if (!settled || !isGroupMissingError(error)) throw error;
                missing.add(id);
                return undefined;
            }
        });
        if (!missing.size) return plan;
        await settled!();
        // Failed downloads must surface rather than retrying forever with guessed sizes.
        for (const id of missing) readObject(id);
    }
}
