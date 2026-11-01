import type { RenderDataWorkerPool } from "../../game/worker/RenderDataWorkerPool";
import type { NpcPoseInput } from "../../game/worker/NpcPoseJob";
import { DynamicNpcAnimLoader, type DynamicNpcFrameGeometry, type NpcFrameRequest } from "./DynamicNpcAnimLoader";

type PoseRequest = ReturnType<DynamicNpcAnimLoader["getAsyncPoseRequest"]>;
type Job = { input: NpcPoseInput; priority: number; touched: number; created: number; order: number; owners: Set<number> };
type ActorRequest = { key: string; appearance: string; sequence: number; overlay: number; waitingSince: number; lastPublishedOrder: number };

/**
 * How long after an actor's last real pose a new sequence may keep showing it while its own first
 * pose builds (a couple of frames, usually). Longer than this, it shows its neutral base instead,
 * so a slow build never leaves it frozen in an obsolete action.
 */
const SHOWN_POSE_GRACE_MS = 150;

/** Bounded current-first CPU fallback. No model lighting, animation or geometry packing runs here. */
export class AsyncNpcPoseCache {
    private readonly queued = new Map<string, Job>();
    private readonly previous = new Map<string, string>();
    private readonly shownAt = new Map<string, number>();
    private readonly retryAt = new Map<string, number>();
    private context = "";
    private loaderContext = "";
    private generationSeen = -1;
    private generation = 0;
    private textures: Array<[number, number]> = [];
    private readonly active = new Map<string, { controller: AbortController; job: Job }>();
    private requestOrder = 0;
    private readonly actorRequests = new Map<number, ActorRequest>();
    private timer?: ReturnType<typeof setTimeout>;
    private disposed = false;
    private readonly requestedAt = new WeakMap<DynamicNpcFrameGeometry, number>();
    readonly stats = { completed: 0, fallbacks: 0, absent: 0, maxWorkerLatencyMs: 0,
        firstUsableLatencyMs: 0, requestedFrame: -1, displayedFrame: -1, poseAgeMs: 0, maxPoseAgeMs: 0 };
    private firstRequestAt?: number;

    constructor(private readonly loader: DynamicNpcAnimLoader,
        private readonly pool: Pick<RenderDataWorkerPool, "loadNpcPose" | "npcPoseGeneration" | "npcPoseConcurrency">,
        private readonly gpuResident?: (key: string) => boolean) {}

    private syncContext(): void {
        // Twice per actor per frame: only build the string when either input moved.
        const loaderContext = this.loader.getContextKey();
        const generation = this.pool.npcPoseGeneration;
        if (loaderContext === this.loaderContext && generation === this.generationSeen) return;
        this.loaderContext = loaderContext;
        this.generationSeen = generation;
        const context = `${loaderContext}:${generation}`;
        if (context !== this.context) {
            this.cancel();
            this.context = context;
            this.textures = Array.from(this.loader.getTextureIdIndexMap() ?? []);
        }
    }

    private resolve(request: NpcFrameRequest): PoseRequest {
        try { return this.loader.getAsyncPoseRequest(...request); }
        catch {
            // Missing animation configuration must not hide an otherwise ready base model.
            if (request[1] >= 0) {
                try { return this.loader.getAsyncPoseRequest(request[0], -1, 0); }
                catch {}
            }
            return undefined;
        }
    }

    getKey(request: NpcFrameRequest, actorIdentity?: number): string | undefined {
        if (this.disposed) return undefined;
        this.syncContext();
        const pose = this.resolve(request);
        this.syncContext();
        if (pose) { this.claimActor(actorIdentity, pose); this.retainBase(pose); }
        const key = pose ? this.key(pose.key, pose.appearance) : undefined;
        if (key && actorIdentity !== undefined && this.gpuResident?.(key)) {
            const actor = this.actorRequests.get(actorIdentity);
            if (actor) { actor.waitingSince = performance.now(); actor.lastPublishedOrder = ++this.requestOrder; }
            this.remember(this.fallbackIdentity(pose!, actorIdentity), key);
            this.rememberShown(pose!, actorIdentity, key);
        }
        return key;
    }

    getFallbackKey(request: NpcFrameRequest, actorIdentity?: number): string | undefined {
        if (this.disposed) return undefined;
        this.syncContext();
        const pose = this.resolve(request);
        this.syncContext();
        if (!pose) return undefined;
        const previous = this.previous.get(this.fallbackIdentity(pose, actorIdentity));
        if (previous && (!this.gpuResident || this.gpuResident(previous))) return previous;
        const shown = this.recentlyShown(pose, actorIdentity);
        if (shown && (!this.gpuResident || this.gpuResident(shown))) return shown;
        const ownedBase = this.previous.get(`${actorIdentity ?? "shared"}:${pose.appearance}:base`);
        if (ownedBase && (!this.gpuResident || this.gpuResident(ownedBase))) return ownedBase;
        const base = this.resolve([pose.request[0], -1, 0]);
        return base ? this.key(base.key, base.appearance) : undefined;
    }

    get(request: NpcFrameRequest, actorIdentity?: number): DynamicNpcFrameGeometry | undefined {
        if (this.disposed) return undefined;
        this.syncContext();
        const pose = this.resolve(request);
        this.syncContext();
        if (!pose) return undefined;
        const key = this.key(pose.key, pose.appearance);
        const base = this.retainBase(pose);
        this.firstRequestAt ??= performance.now();
        this.stats.requestedFrame = pose.request[2];
        this.claimActor(actorIdentity, pose);
        const fallbackIdentity = this.fallbackIdentity(pose, actorIdentity);
        const cached = this.loader.getCachedGeometry(key);
        if (cached) {
            const actor = actorIdentity === undefined ? undefined : this.actorRequests.get(actorIdentity);
            if (actor) { actor.waitingSince = performance.now(); actor.lastPublishedOrder = ++this.requestOrder; }
            this.stats.displayedFrame = cached.frameId;
            this.stats.poseAgeMs = 0;
            this.remember(fallbackIdentity, key);
            this.rememberShown(pose, actorIdentity, key);
            this.prefetch(pose);
            return cached;
        }
        // Until the pose is built: this sequence's last pose, else the last pose the actor showed
        // (a new sequence's first frame, while the one before it just ended), else its base model.
        // Falling straight back to the base model flashed it between two sequences sent back to back.
        const candidates = [this.previous.get(fallbackIdentity), this.recentlyShown(pose, actorIdentity),
            this.previous.get(`${actorIdentity ?? "shared"}:${pose.appearance}:base`)].filter((candidate): candidate is string => !!candidate);
        const previous = candidates[0];
        let fallback: DynamicNpcFrameGeometry | undefined;
        // A candidate whose CPU copy was evicted may still be on the GPU: return nothing then, so
        // the caller draws it through getFallbackKey rather than this falling on to the base model.
        let resident = false;
        for (const candidate of candidates) {
            if ((fallback = this.loader.getCachedGeometry(candidate))) break;
            if ((resident = !!this.gpuResident?.(candidate))) break;
        }
        if (!fallback && !resident) fallback = base ? this.loader.getCachedGeometry(this.key(base.key, base.appearance)) : undefined;
        if (fallback) {
            this.stats.fallbacks++;
            this.stats.displayedFrame = fallback.frameId;
            this.stats.poseAgeMs = performance.now() - (this.requestedAt.get(fallback) ?? performance.now());
            this.stats.maxPoseAgeMs = Math.max(this.stats.maxPoseAgeMs, this.stats.poseAgeMs);
        } else if (!resident) this.stats.absent++;
        if (!fallback && !(previous && this.gpuResident?.(previous)) && pose.request[1] >= 0) {
            if (base) this.enqueue(base, -1, actorIdentity);
        }
        this.enqueue(pose, 0, actorIdentity);
        this.prefetch(pose);
        return fallback;
    }

    private claimActor(actorIdentity: number | undefined, pose: NonNullable<PoseRequest>): void {
        const key = this.key(pose.key, pose.appearance);
        const previous = actorIdentity === undefined ? undefined : this.actorRequests.get(actorIdentity);
        if (actorIdentity !== undefined && previous?.key !== key) {
            for (const [queuedKey, job] of this.queued) {
                if (job.owners.delete(actorIdentity) && !job.owners.size && job.priority <= 0) this.queued.delete(queuedKey);
            }
            this.actorRequests.delete(actorIdentity);
            this.actorRequests.set(actorIdentity, { key, appearance: pose.appearance, sequence: pose.request[1],
                overlay: pose.request[3] ?? -1, waitingSince: previous?.waitingSince ?? performance.now(),
                lastPublishedOrder: previous?.lastPublishedOrder ?? 0 });
            if (this.actorRequests.size > 256) this.actorRequests.delete(this.actorRequests.keys().next().value!);
        }
    }

    private key(key: string, appearance: string): string { return `async-npc:${this.context}:${this.generation}:${key}:${appearance}`; }

    private retainBase(pose: NonNullable<PoseRequest>): PoseRequest {
        const base = pose.request[1] < 0 ? pose : this.resolve([pose.request[0], -1, 0]);
        if (base) {
            const key = this.key(base.key, base.appearance);
            // Active actors need this neutral fallback across animation-family changes.
            // Touch existing CPU/GPU entries (including known-empty alpha); never allocate or pin them.
            this.loader.getCachedGeometry(key);
            this.gpuResident?.(key);
        }
        return base;
    }

    private fallbackIdentity(pose: NonNullable<PoseRequest>, actor?: number): string {
        return `${actor ?? "shared"}:${pose.appearance}:${pose.request[1]}:${pose.request[3] ?? -1}`;
    }

    /** The last pose an actor was drawn with, whatever its sequence. */
    private shownIdentity(pose: NonNullable<PoseRequest>, actor?: number): string {
        return `${actor ?? "shared"}:${pose.appearance}:shown`;
    }

    private rememberShown(pose: NonNullable<PoseRequest>, actor: number | undefined, key: string): void {
        const identity = this.shownIdentity(pose, actor);
        this.remember(identity, key);
        this.shownAt.delete(identity);
        this.shownAt.set(identity, performance.now());
        if (this.shownAt.size > 512) this.shownAt.delete(this.shownAt.keys().next().value!);
    }

    /** The actor's last real pose, while it is recent enough to bridge a new sequence (SHOWN_POSE_GRACE_MS). */
    private recentlyShown(pose: NonNullable<PoseRequest>, actor?: number): string | undefined {
        const identity = this.shownIdentity(pose, actor);
        const at = this.shownAt.get(identity);
        if (at === undefined || performance.now() - at > SHOWN_POSE_GRACE_MS) return undefined;
        return this.previous.get(identity);
    }

    private remember(identity: string, key: string): void {
        this.previous.delete(identity);
        this.previous.set(identity, key);
        if (this.previous.size > 512) this.previous.delete(this.previous.keys().next().value!);
    }

    private prefetch(pose: NonNullable<PoseRequest>): void {
        // Without an overlay/interpolated timeline the next in-range frame is known exactly.
        if (pose.request[1] < 0 || (pose.request[3] ?? -1) >= 0 || pose.request[5] || pose.request[2] + 1 >= pose.frameCount) return;
        const next = this.resolve([pose.request[0], pose.request[1], pose.request[2] + 1]);
        if (next) this.enqueue(next, 1);
    }

    private enqueue(pose: NonNullable<PoseRequest>, priority: number, owner?: number): void {
        const key = this.key(pose.key, pose.appearance), now = performance.now();
        const active = this.active.get(key);
        if (active) { active.job.priority = Math.min(active.job.priority, priority);
            if (owner !== undefined) active.job.owners.add(owner); return; }
        if (this.gpuResident?.(key) || this.loader.getCachedGeometry(key) || (this.retryAt.get(key) ?? 0) > now) return;
        const queued = this.queued.get(key);
        if (queued) { queued.priority = Math.min(queued.priority, priority); queued.touched = now;
            if (owner !== undefined) queued.owners.add(owner); return; }
        this.queued.set(key, { input: { context: this.context, key, appearance: pose.appearance,
            request: pose.request, textures: this.textures }, priority, touched: now, created: now, order: ++this.requestOrder,
            owners: new Set(owner === undefined ? [] : [owner]) });
        if (this.queued.size > 24) {
            const newest = [...this.queued].reverse().sort((a, b) => b[1].priority - a[1].priority || b[1].created - a[1].created)[0];
            this.queued.delete(newest[0]);
        }
        this.schedule();
    }

    private schedule(): void {
        if (!this.disposed && this.queued.size && this.active.size < this.pool.npcPoseConcurrency && this.timer === undefined)
            this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, 0);
    }

    private pump(): void {
        if (this.disposed) return;
        for (const [key, job] of this.queued) if (performance.now() - job.touched > 500) this.queued.delete(key);
        const waitingSince = (job: Job) => job.owners.size
            ? Math.min(...[...job.owners].map(owner => this.actorRequests.get(owner)?.waitingSince ?? job.created)) : job.created;
        while (this.active.size < this.pool.npcPoseConcurrency) {
            const next = [...this.queued].sort((a, b) => a[1].priority - b[1].priority || waitingSince(a[1]) - waitingSince(b[1]))[0];
            if (!next) return;
            const [key, job] = next;
            this.queued.delete(key);
            const controller = new AbortController();
            this.active.set(key, { controller, job });
            void this.run(key, job, controller, this.generation);
        }
    }

    private async run(key: string, job: Job, controller: AbortController, generation: number): Promise<void> {
        const started = performance.now();
        try {
            const result = await this.pool.loadNpcPose(job.input, controller.signal);
            if (this.disposed || generation !== this.generation || controller.signal.aborted) return;
            if (result && "busy" in result) {
                this.retryAt.set(key, performance.now() + 8);
            } else if (result) {
                this.stats.completed++;
                this.stats.maxWorkerLatencyMs = Math.max(this.stats.maxWorkerLatencyMs, performance.now() - started);
                if (this.stats.completed === 1) this.stats.firstUsableLatencyMs = performance.now() - this.firstRequestAt!;
                this.requestedAt.set(result, job.touched);
                this.loader.adoptGeometry(result);
                if (job.priority <= 0) {
                    for (const owner of job.owners) {
                        const current = this.actorRequests.get(owner);
                        if (!current || current.appearance !== job.input.appearance ||
                            (job.input.request[1] >= 0 && (current.sequence !== job.input.request[1] || current.overlay !== (job.input.request[3] ?? -1)))) continue;
                        if (current.key !== key && job.order <= current.lastPublishedOrder) continue;
                        const identity = `${owner}:${current.appearance}:${current.sequence}:${current.overlay}`;
                        if (job.input.request[1] < 0) this.remember(`${owner}:${current.appearance}:base`, result.key);
                        if (job.input.request[1] >= 0 || !this.previous.has(identity)) this.remember(identity, result.key);
                        current.lastPublishedOrder = current.key === key ? ++this.requestOrder : job.order;
                        if (job.input.request[1] >= 0) current.waitingSince = performance.now();
                    }
                    if (!job.owners.size) {
                        this.remember(`shared:${job.input.appearance}:${job.input.request[1]}:${job.input.request[3] ?? -1}`, result.key);
                        if (job.input.request[1] < 0) this.remember(`shared:${job.input.appearance}:base`, result.key);
                    }
                }
            } else this.retryAt.set(key, performance.now() + 250);
        } catch {
            // Downloads, lost RPCs and transient worker errors stay retryable on a later frame.
            if (!controller.signal.aborted) this.retryAt.set(key, performance.now() + 250);
        } finally {
            if (this.active.get(key)?.controller === controller) this.active.delete(key);
            while (this.retryAt.size > 128) this.retryAt.delete(this.retryAt.keys().next().value!);
            this.schedule();
        }
    }

    private cancel(): void {
        this.generation++;
        for (const { controller } of this.active.values()) controller.abort();
        this.active.clear();
        clearTimeout(this.timer);
        this.timer = undefined;
        this.queued.clear(); this.previous.clear(); this.shownAt.clear(); this.retryAt.clear(); this.actorRequests.clear();
    }

    forgetActor(actorIdentity: number): void {
        this.actorRequests.delete(actorIdentity);
        for (const { job } of this.active.values()) job.owners.delete(actorIdentity);
        for (const [key, job] of this.queued) {
            if (job.owners.delete(actorIdentity) && !job.owners.size && job.priority <= 0) this.queued.delete(key);
        }
        for (const key of this.previous.keys()) if (key.startsWith(`${actorIdentity}:`)) this.previous.delete(key);
        for (const key of this.shownAt.keys()) if (key.startsWith(`${actorIdentity}:`)) this.shownAt.delete(key);
    }

    invalidate(): void { this.cancel(); }

    dispose(): void { this.disposed = true; this.cancel(); }
}
