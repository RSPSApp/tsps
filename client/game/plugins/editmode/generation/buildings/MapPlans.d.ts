import type { EditModeHost } from "../../types";

export function catalog(): Awaited<ReturnType<NonNullable<EditModeHost["loadMapPlans"]>>>;

/** Generate editable area data using the editor's live object footprints. */
export function preview(
    query: URLSearchParams,
    objectInfo?: (id: number) => { sizeX: number; sizeY: number } | undefined,
): unknown;
