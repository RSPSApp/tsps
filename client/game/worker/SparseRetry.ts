import { decompressStats } from "../../rs/cache/Container";
import { isGroupMissingError } from "../../rs/cache/js5/GroupMissingError";
import type { Js5RangeClient } from "../../rs/cache/js5/Js5RangeClient";
import type { GroupSpan } from "../../rs/cache/store/SparseMemoryStore";

type SparseCache = Pick<Js5RangeClient, "store" | "requestGroup" | "settled">;

/** Publish only a complete build; new dependency downloads may take more than eight passes. */
export async function runWithSparseRetry<T>(
    workerState: { js5?: SparseCache },
    task: () => Promise<T>,
    profileLabel?: string,
    outcome?: { complete: boolean },
): Promise<T> {
    if (outcome) outcome.complete = false;
    const js5 = workerState.js5;
    if (!js5) {
        const result = await task();
        if (outcome) outcome.complete = true;
        return result;
    }
    const store = js5.store;
    const missing = new Map<string, Pick<GroupSpan, "indexId" | "archiveId">>();
    const downloaded = new Set<string>();
    const onMiss = store.onMiss;
    store.onMiss = (span) => {
        missing.set(`${span.indexId}:${span.archiveId}`, span);
        onMiss?.(span);
    };
    let stalled = 0;
    try {
        for (let attempt = 1; ; attempt++) {
            missing.clear();
            const missesBefore = store.missCount;
            const passStarted = performance.now();
            const decompressBefore = { ...decompressStats };
            let result!: T;
            let blockingGroup: Pick<GroupSpan, "indexId" | "archiveId"> | undefined;
            try {
                result = await task();
            } catch (error) {
                if (!isGroupMissingError(error)) throw error;
                blockingGroup = error;
                missing.set(`${error.indexId}:${error.archiveId}`, error);
            }
            if (profileLabel) {
                const gzip = `${Math.round(decompressStats.gzipMs - decompressBefore.gzipMs)}ms/${decompressStats.gzipCount - decompressBefore.gzipCount}`;
                const bzip2 = `${Math.round(decompressStats.bzip2Ms - decompressBefore.bzip2Ms)}ms/${decompressStats.bzip2Count - decompressBefore.bzip2Count}`;
                console.info(`[map-profile] ${profileLabel} pass=${attempt} build=${Math.round(performance.now() - passStarted)}ms misses=${store.missCount - missesBefore} gzip=${gzip} bzip2=${bzip2}`);
            }
            if (!blockingGroup && store.missCount === missesBefore) {
                if (outcome) outcome.complete = true;
                return result;
            }

            const waitStarted = performance.now();
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
                // Worker coordinator replies can be lost; keep that wait bounded too.
                await Promise.race([
                    blockingGroup
                        ? js5.requestGroup(blockingGroup.indexId, blockingGroup.archiveId, true)
                        : js5.settled(),
                    new Promise<never>((_, reject) => {
                        timeout = setTimeout(() => reject(new Error("Cache group download timed out")), 30000);
                    }),
                ]);
            } catch (fetchError) {
                console.warn("[js5] Group fetch failed, retrying task:", fetchError);
            } finally {
                clearTimeout(timeout);
            }
            if (profileLabel) console.info(`[map-profile] ${profileLabel} pass=${attempt} cacheWait=${Math.round(performance.now() - waitStarted)}ms`);

            let progress = false;
            for (const [key, group] of missing) {
                if (!downloaded.has(key) && store.isGroupPresent(group.indexId, group.archiveId)) {
                    downloaded.add(key);
                    progress = true;
                }
            }
            if (progress) stalled = 0;
            else {
                if (++stalled >= 8) {
                    throw new Error(`[js5] Incomplete build: no download progress after ${stalled} attempts (${[...missing.keys()].join(", ")})`);
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
    } finally {
        store.onMiss = onMiss;
    }
}
