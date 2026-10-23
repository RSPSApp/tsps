import { SparseMemoryStore } from "../store/SparseMemoryStore";

export type Js5CoordinatorMessage = {
    type: "request" | "complete" | "failed";
    indexId: number;
    archiveId: number;
    error?: string;
};

export function isJs5CoordinatorMessage(value: unknown): value is Js5CoordinatorMessage {
    const message = value as Partial<Js5CoordinatorMessage> | undefined;
    return !!message &&
        (message.type === "request" || message.type === "complete" || message.type === "failed") &&
        Number.isInteger(message.indexId) && Number.isInteger(message.archiveId);
}

/** Worker-side proxy for the one JS5 queue owned by the main thread. */
export class WorkerJs5Coordinator {
    private static readonly REQUEST_TIMEOUT_MS = 30000;
    private readonly pending = new Map<string, {
        promise: Promise<void>;
        resolve: () => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    private readonly channel: BroadcastChannel;

    constructor(readonly store: SparseMemoryStore, channelName: string) {
        this.channel = new BroadcastChannel(channelName);
        this.channel.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (!isJs5CoordinatorMessage(data) || data.type === "request") return;
            const key = `${data.indexId}:${data.archiveId}`;
            const pending = this.pending.get(key);
            if (!pending) return;
            if (data.type === "failed") {
                this.finishRequest(key, new Error(data.error ?? "central JS5 fetch failed"));
                return;
            }
            if (this.store.isGroupPresent(data.indexId, data.archiveId)) {
                this.finishRequest(key);
            }
        };
        store.onMiss = (span) => { void this.requestGroup(span.indexId, span.archiveId); };
    }

    requestGroup(indexId: number, archiveId: number): Promise<void> {
        if (this.store.isGroupPresent(indexId, archiveId)) return Promise.resolve();
        const key = `${indexId}:${archiveId}`;
        const existing = this.pending.get(key);
        if (existing) return existing.promise;
        let resolvePending!: () => void;
        let rejectPending!: (error: Error) => void;
        const promise = new Promise<void>((resolve, reject) => {
            resolvePending = resolve;
            rejectPending = reject;
        });
        promise.catch(() => {});
        // Drop the pending entry too, so a lost request can be sent again.
        const timeout = setTimeout(() => {
            const error = this.store.isGroupPresent(indexId, archiveId)
                ? undefined
                : new Error(`JS5 coordinator request ${key} timed out`);
            this.finishRequest(key, error);
        }, WorkerJs5Coordinator.REQUEST_TIMEOUT_MS);
        this.pending.set(key, { promise, resolve: resolvePending, reject: rejectPending, timeout });
        this.channel.postMessage({ type: "request", indexId, archiveId } satisfies Js5CoordinatorMessage);
        return promise;
    }

    /** Resolves requests whose data has become readable here (its dat2 chunk arrived late). */
    recheck(): void {
        for (const key of this.pending.keys()) {
            const [indexId, archiveId] = key.split(":").map(Number);
            if (!this.store.isGroupPresent(indexId, archiveId)) continue;
            this.finishRequest(key);
        }
    }

    private finishRequest(key: string, error?: Error): void {
        const pending = this.pending.get(key);
        if (!pending) return;
        this.pending.delete(key);
        clearTimeout(pending.timeout);
        if (error) pending.reject(error);
        else pending.resolve();
    }

    async settled(): Promise<void> {
        await Promise.allSettled(Array.from(this.pending.values(), (pending) => pending.promise));
    }
}
