import { Task } from './Task';
import { TaskType } from './TaskType';
import { ServerPerf } from '../../util/ServerPerf';
import { FreezeDiagnostics } from '../../util/FreezeDiagnostics';
import { FastDeque } from '../../util/FastDeque';
 
export class TaskManager {
    private static pendingTasks: FastDeque<Task> = new FastDeque<Task>();
    private static activeTasks: Task[] = [];
    private static tasksProcessedThisCycle: Task[] = [];
    private static walkToTickedThisCycle = new Set<Task>();
    private static readonly SLOW_TASK_WARN_MS = 50;
    private static readonly SLOW_TASK_LOG_COOLDOWN_MS = 3000;
    private static readonly SLOW_TASK_WARN_ENABLED = (process.env.TASK_SLOW_WARN_ENABLED ?? "1") !== "0";
    private static lastSlowTaskLogAtByName = new Map<string, number>();
    
    private constructor() {
        throw new Error("This class cannot be instantiated!");
    }
    
    public static process(): void {
        try {
            TaskManager.tasksProcessedThisCycle = [];
            let t: Task;
            while ((t = TaskManager.pendingTasks.shift()) != null) {
                if (t.isRunning()) {
                    TaskManager.activeTasks.push(t);
                }
            }

            TaskManager.walkToTickedThisCycle.clear();
            let writeIndex = 0;
            for (let i = 0; i < TaskManager.activeTasks.length; i++) {
                t = TaskManager.activeTasks[i];
                if (t.isRunning()) TaskManager.tasksProcessedThisCycle.push(t);
                // WALK_TO tasks own an interaction's reach check. They are ticked from
                // the player's own turn, after movement, so an interaction resolves on
                // the cycle the player arrives instead of the cycle after.
                if (t.type === TaskType.WALK_TO) {
                    TaskManager.activeTasks[writeIndex++] = t;
                    continue;
                }
                const taskName = t?.constructor?.name ?? "UnknownTask";
                const startedAt = Date.now();
                const keepRunning = t.tick();
                const durationMs = Date.now() - startedAt;
                ServerPerf.addPhaseDuration(`task.${taskName}`, durationMs);
                TaskManager.logSlowTaskTick(taskName, durationMs);
                if (keepRunning) {
                    TaskManager.activeTasks[writeIndex++] = t;
                }
            }
            TaskManager.activeTasks.length = writeIndex;
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Ticks the WALK_TO tasks belonging to one key. Called from the owner's turn once
     * movement has been applied; also swept after all turns so an entity that was
     * skipped this cycle (bot stride) still makes progress.
     */
    public static processWalkTo(key: any): void {
        let writeIndex = 0;
        const tasks = TaskManager.activeTasks;
        for (let i = 0; i < tasks.length; i++) {
            const t = tasks[i];
            let keepRunning = true;
            if (t.type === TaskType.WALK_TO && t.key === key && !TaskManager.walkToTickedThisCycle.has(t)) {
                TaskManager.walkToTickedThisCycle.add(t);
                const startedAt = Date.now();
                try {
                    keepRunning = t.tick();
                } catch (e) {
                    // Dropped rather than retried: a throwing interaction would other-
                    // wise re-throw every cycle for as long as the player stands there.
                    console.error(e);
                    t.stop();
                    keepRunning = false;
                }
                const durationMs = Date.now() - startedAt;
                ServerPerf.addPhaseDuration(`task.${t?.constructor?.name ?? "WalkToTask"}`, durationMs);
            }
            if (keepRunning) tasks[writeIndex++] = t;
        }
        tasks.length = writeIndex;
    }

    /** Catches WALK_TO tasks whose owner did not take a turn this cycle. */
    public static processRemainingWalkTo(): void {
        const keys = new Set<any>();
        for (const t of TaskManager.activeTasks) {
            if (t.type === TaskType.WALK_TO && !TaskManager.walkToTickedThisCycle.has(t)) keys.add(t.key);
        }
        for (const key of keys) TaskManager.processWalkTo(key);
    }

    public static submit(task: Task): void {
        if (task.isRunning()) {
            return;
        }
    
        task.setRunning(true);
    
        if (task.isImmediate()) {
            task.execute();
        }
    
        TaskManager.pendingTasks.push(task);
    }

    public static cancelTask(keys: any[]): void {
        for (const key of keys) {
        TaskManager.cancelTask(key);
        }
    }
        
    
    public static cancelTasks(key: Object): void {
            try {
                for (const task of TaskManager.pendingTasks.toArray()) {
                    if (task.key === key) {
                        task.stop();
                    }
                }
                TaskManager.activeTasks.filter(t => t.key === key).forEach(t => t.stop());
            } catch (e) {
                console.error(e);
            }
    }

    /**
     * Stops every WALK_TO interaction task for a key without touching the movement
     * queue. OSRS item interactions cancel the queued walk-to action this way:
     * the player keeps walking the route it already has, without operating.
     */
    public static cancelWalkToTasks(key: Object): void {
        for (const task of TaskManager.pendingTasks.toArray()) {
            if (task.key === key && task.type === TaskType.WALK_TO) {
                task.stop();
            }
        }
        for (const task of TaskManager.activeTasks) {
            if (task.key === key && task.type === TaskType.WALK_TO) {
                task.stop();
            }
        }
    }
        
    public static getTaskAmount(): number {
            return (TaskManager.pendingTasks.length + TaskManager.activeTasks.length);
    }

    public static hasActiveTask(key: any, taskName?: string): boolean {
        const matches = (task: Task) => task.isRunning() && task.key === key &&
            (taskName == null || task.constructor.name === taskName);
        return TaskManager.pendingTasks.toArray().some(matches) || TaskManager.activeTasks.some(matches);
    }

    public static wasTaskActiveThisCycle(key: any, taskName?: string): boolean {
        return TaskManager.tasksProcessedThisCycle.some(task => task.key === key &&
            (taskName == null || task.constructor.name === taskName));
    }

    private static logSlowTaskTick(taskName: string, durationMs: number): void {
        if (!TaskManager.SLOW_TASK_WARN_ENABLED) {
            return;
        }
        if (durationMs < TaskManager.SLOW_TASK_WARN_MS) {
            return;
        }
        const nowMs = Date.now();
        const lastLoggedAt = TaskManager.lastSlowTaskLogAtByName.get(taskName) ?? 0;
        if (nowMs - lastLoggedAt < TaskManager.SLOW_TASK_LOG_COOLDOWN_MS) {
            return;
        }
        TaskManager.lastSlowTaskLogAtByName.set(taskName, nowMs);
        FreezeDiagnostics.log("slow_task_tick", {
            taskName,
            durationMs,
            slowThresholdMs: TaskManager.SLOW_TASK_WARN_MS,
            activeTasks: TaskManager.activeTasks.length,
            pendingTasks: TaskManager.pendingTasks.length,
        });
        console.warn(
            `[task] slow_task_tick task=${taskName} durationMs=${durationMs} ` +
            `active=${TaskManager.activeTasks.length} pending=${TaskManager.pendingTasks.length}`
        );
    }
}
