let Task;
let TaskManager;
let World;
let PlayerRights;
let Server;

const TASK_KEY = {};
const MAX_SCHEDULED_SECONDS = 24 * 60 * 60;

// >0 while a shutdown is scheduled; the task pushes the live countdown to every
// player each tick (centiseconds, so the client can extrapolate between pushes)
// and calls Server.shutdown once it hits zero.
let scheduledUntilMs = 0;
let countdownTask = null;
// Assigned in register(): Task only exists on api.core by then, and a module-scope
// `class ... extends Task` would throw at require() time.
let GameUpdateCountdownTask = null;

function parseDurationToken(token) {
    const match = /^(\d+)([smh])?$/.exec(String(token ?? "").trim().toLowerCase());
    if (!match) return null;
    const value = Number.parseInt(match[1], 10);
    if (!Number.isFinite(value) || value <= 0) return null;
    const multiplier = match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1;
    const seconds = value * multiplier;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SCHEDULED_SECONDS) {
        return null;
    }
    return seconds;
}

function formatCountdown(totalSeconds) {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDurationHuman(totalSeconds) {
    if (totalSeconds >= 3600) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.round((totalSeconds % 3600) / 60);
        if (minutes > 0) {
            return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
        }
        return `${hours} hour${hours === 1 ? "" : "s"}`;
    }
    if (totalSeconds >= 60) {
        const minutes = Math.round(totalSeconds / 60);
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
}

// Wire value in centiseconds (opcode 220 is a 4-byte BE int); the client anchors a
// free-running local countdown to it and re-anchors on each push.
function remainingCentis() {
    if (scheduledUntilMs <= 0) return 0;
    return Math.max(0, Math.round((scheduledUntilMs - Date.now()) / 10));
}

function remainingSeconds() {
    return Math.ceil(remainingCentis() / 100);
}

function pushCountdown(remainingCentis) {
    for (const player of World.getPlayers()) {
        if (player) {
            player.getPacketSender().sendSystemUpdate(remainingCentis);
        }
    }
}

function startGameUpdate(seconds) {
    scheduledUntilMs = Date.now() + seconds * 1000;
    countdownTask = new GameUpdateCountdownTask();
    TaskManager.submit(countdownTask);
    const notice = `A server update is in progress. The server will shut down in ${formatDurationHuman(seconds)}.`;
    for (const player of World.getPlayers()) {
        if (!player) continue;
        player.sendMessage(notice);
        player.getPacketSender().sendSystemUpdate(seconds * 100);
    }
    Server.getLogger().info(`[GameUpdate] server shutdown scheduled in ${formatDurationHuman(seconds)}`);
}

function cancelGameUpdate() {
    if (scheduledUntilMs <= 0) return false;
    scheduledUntilMs = 0;
    if (countdownTask) {
        countdownTask.stop();
        countdownTask = null;
    }
    TaskManager.cancelTasks(TASK_KEY);
    pushCountdown(0);
    Server.getLogger().info("[GameUpdate] scheduled shutdown cancelled");
    return true;
}

function gameUpdateCommand({ player, parts }) {
    const arg = String(parts[1] ?? "").trim().toLowerCase();
    if (arg === "") {
        player.sendMessage("Usage: ::gameUpdate <seconds|30s|20m|1h> | cancel | status");
        return true;
    }
    if (arg === "cancel") {
        player.sendMessage(
            cancelGameUpdate() ? "Game update cancelled." : "No game update scheduled."
        );
        return true;
    }
    if (arg === "status") {
        const remaining = remainingSeconds();
        player.sendMessage(
            remaining > 0
                ? `Game update scheduled: the server shuts down in ${formatCountdown(remaining)}.`
                : "No game update scheduled."
        );
        return true;
    }
    const seconds = parseDurationToken(arg);
    if (seconds === null) {
        player.sendMessage("Usage: ::gameUpdate <seconds|30s|20m|1h> | cancel | status");
        return true;
    }
    const activeRemaining = remainingSeconds();
    if (activeRemaining > 0) {
        player.sendMessage(
            `A game update is already scheduled (${formatCountdown(activeRemaining)} remaining). Use ::gameUpdate cancel to stop it.`
        );
        return true;
    }
    startGameUpdate(seconds);
    return true;
}

function pushCountdownToLogin({ player }) {
    const remaining = remainingCentis();
    if (remaining <= 0 || !player) return;
    player.getPacketSender().sendSystemUpdate(remaining);
}

function onShutdownCleanup() {
    scheduledUntilMs = 0;
    if (countdownTask) {
        countdownTask.stop();
        countdownTask = null;
    }
    TaskManager.cancelTasks(TASK_KEY);
}

module.exports = {
    name: "GameUpdate",
    register(api) {
        ({ Task, TaskManager, World, PlayerRights, Server } = api.core);
        GameUpdateCountdownTask = class extends Task {
            constructor() {
                super(1, TASK_KEY);
            }

            execute() {
                if (scheduledUntilMs <= 0) {
                    this.stop();
                    return;
                }
                const remaining = remainingCentis();
                pushCountdown(remaining);
                if (remaining <= 0) {
                    this.stop();
                    scheduledUntilMs = 0;
                    countdownTask = null;
                    Server.getLogger().info("[GameUpdate] countdown finished; shutting down server");
                    Server.shutdown("gameUpdate");
                }
            }
        };
        api.registerCommand("gameUpdate", gameUpdateCommand, PlayerRights.OWNER, "Schedule a server update");
        api.onPlayerLogin(pushCountdownToLogin);
        api.onServerShutdown(onShutdownCleanup);
    },
};
