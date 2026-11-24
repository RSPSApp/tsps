import { isGroupMissingError } from "./GroupMissingError";

/** Resolves once a missing group has been fetched (Js5RangeClient.requestGroup), or rejects. */
export type WaitForGroup = (indexId: number, archiveId: number) => Promise<unknown>;

/**
 * Run a synchronous cache read, waiting for on-demand fetches to land when it
 * hits a not-yet-downloaded group. Each failed attempt re-queues the fetch
 * (deduped by the range client), so this simply polls until the data arrives.
 * Returns undefined if the data never arrives within the attempt budget.
 * Non-miss errors propagate unchanged.
 *
 * With `waitForGroup`, a miss waits for that group's fetch instead of a fixed
 * delay, so a read retries as soon as its data lands (a fetch from the local
 * server takes milliseconds; a 250ms poll made every cold read wait at least
 * that long). The total wait stays bounded by attempts * delayMs.
 */
export async function retryOnMissingGroup<T>(
    read: () => T,
    attempts: number = 40,
    delayMs: number = 250,
    waitForGroup?: WaitForGroup,
): Promise<T | undefined> {
    const deadline = performance.now() + attempts * delayMs;
    let waitedFor = "";
    for (let i = 0; i < attempts; i++) {
        try {
            return read();
        } catch (e) {
            if (!isGroupMissingError(e)) {
                throw e;
            }
            const group = `${e.indexId}:${e.archiveId}`;
            // The same group still missing after its fetch resolved: poll instead of spinning.
            if (waitForGroup && group !== waitedFor) {
                waitedFor = group;
                const remaining = deadline - performance.now();
                if (remaining <= 0) return undefined;
                let timer: ReturnType<typeof setTimeout> | undefined;
                await Promise.race([
                    // A failed fetch falls back to the delay before the next read.
                    waitForGroup(e.indexId, e.archiveId).catch(
                        () => new Promise((resolve) => setTimeout(resolve, delayMs)),
                    ),
                    new Promise((resolve) => {
                        timer = setTimeout(resolve, remaining);
                    }),
                ]);
                clearTimeout(timer);
                continue;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    return undefined;
}
