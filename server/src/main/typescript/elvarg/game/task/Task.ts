import { ActorPresentation } from '../model/ActorPresentation';
import { TaskType } from "./TaskType";
import { PluginContext } from "../../plugins/PluginContext";
export abstract class Task {
    public static DEFAULT_KEY = new Object();
    private immediate: boolean;
    private delay: number;
    private countdown: number;
    public type: TaskType;
    private running = false;
    public key: object;
    /** The plugin whose code created this task; the task runs as that plugin (PluginContext). */
    public readonly pluginName: string | null = PluginContext.current();

    constructor();
    constructor(immediate: boolean);
    constructor(delay: number);
    constructor(delay: number, type: TaskType);
    constructor(delay: number, immediate: boolean);
    constructor(delay: number, key: any);
    constructor(delay: number, key: any, immediate: boolean);
    constructor(
        delay?: number | boolean,
        arg2?: boolean | TaskType | any,
        arg3?: boolean
    ) {
        let resolvedDelay = 1;
        let resolvedImmediate = false;
        let resolvedKey: any = Task.DEFAULT_KEY;
        let resolvedType = TaskType.DEFAULT;

        if (typeof delay === "boolean") {
            resolvedImmediate = delay;
        } else if (typeof delay === "number") {
            resolvedDelay = delay;

            if (typeof arg2 === "boolean") {
                resolvedImmediate = arg2;
            } else if (arg2 !== undefined && arg2 !== null) {
                resolvedKey = arg2;
            }

            if (typeof arg3 === "boolean") {
                resolvedImmediate = arg3;
            }
        }

        this.delay = Math.max(0, resolvedDelay);
        ActorPresentation.capture(this);
        this.countdown = this.delay;
        this.immediate = resolvedImmediate;
        this.type = resolvedType;
        this.bind((resolvedKey ?? Task.DEFAULT_KEY) as object);
    }

    private bind(key: object): void {
        this.key = key;
    }

    isImmediate(): boolean {
        return this.immediate;
    }

    isRunning(): boolean {
        return this.running;
    }

    isStopped(): boolean {
        return !this.running;
    }

    tick(): boolean {
        if(!ActorPresentation.inScope(this))return ActorPresentation.run(this,()=>this.tick());
        if (this.running && (this.countdown == 0 || --this.countdown == 0)) {
            this.execute();
            this.countdown = this.delay;
        }
        this.onTick();
        return this.running;
    }

    onTick() { }

    abstract execute(): void;

    getDelay(): number {
        return this.delay;
    }

    getRemainingTicks(): number {
        return this.countdown;
    }

    setDelay(delay: number) {
        if (delay > 0) this.delay = delay;
    }

    setRunning(running: boolean) {
        this.running = running;
    }

    stop() {
        this.running = false;
    }
}
