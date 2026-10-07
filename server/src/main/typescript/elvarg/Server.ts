// Provide minimal browser globals for libs that expect window (e.g., phaser).
(global as any).window = (global as any).window ?? {};
(global as any).document = (global as any).document ?? { documentElement: {}, createElement: () => ({ canPlayType: () => "", getContext: () => ({ fillRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: [0,0,0,0] }), putImageData: () => {} }) }) };
if (typeof (global as any).navigator === "undefined") {
(global as any).navigator = {};
}
(global as any).Image = (global as any).Image ?? function () { return {}; };
(global as any).HTMLCanvasElement = (global as any).HTMLCanvasElement ?? function () {};
import * as path from "path";
import * as fs from "fs";
import Module = require("module");
import { GameBuilder } from "./game/GameBuilder";
import { GameConstants } from "./game/GameConstants";
import { CachePipeline } from "./game/cache/CachePipeline";
import { World } from "./game/World";
import { NetworkBuilder } from "./net/NetworkBuilder";
import { NetworkConstants } from "./net/NetworkConstants";
import { PluginManager } from "./plugins/PluginManager";
import { Flooder } from "./util/flood/Flooder";
import { ServerLogger } from "./util/ServerLogger";

export class Server {
  private static flooder: Flooder = new Flooder();
  public static PRODUCTION = false;
  private static DEBUG_LOGGING = false;
  private static logger = {
    debug: (...args: any[]) => console.debug(...args),
    info: (...args: any[]) => console.info(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
  };
  private static updating = false;
  private static consolePatched = false;
  private static shuttingDown = false;
  private static gracefulHandlersInstalled = false;

  private static setupFileLogging() {
    if (Server.consolePatched) return;
    ServerLogger.install(path.join(process.cwd(), "logs", "server.log"));
    Server.consolePatched = true;
  }

  private static installProductionPathResolver() {
    const moduleAny = Module as any;
    if (moduleAny.__elvargProdPathResolverInstalled) {
      return;
    }
    moduleAny.__elvargProdPathResolverInstalled = true;

    const originalResolveFilename = moduleAny._resolveFilename;
    const cwd = process.cwd();
    const sourceRoot = path.join(cwd, "src", "main", "typescript", "elvarg");
    const distRoot = path.join(cwd, "dist");
    const pluginsRoot = path.join(cwd, "plugins");
    const brokenPluginsPrefix = `${path.sep}Users${path.sep}plugins${path.sep}`;

    const resolveCandidate = (request: string, parent?: NodeModule): string => {
      if (typeof request !== "string" || request.length === 0) {
        return request;
      }

      const parentFilename =
        parent && typeof (parent as any).filename === "string"
          ? (parent as any).filename
          : null;
      const absoluteRequest =
        path.isAbsolute(request)
          ? request
          : parentFilename
            ? path.resolve(path.dirname(parentFilename), request)
            : request;

      if (absoluteRequest.startsWith(sourceRoot)) {
        const relativePath = path.relative(sourceRoot, absoluteRequest);
        return path.join(distRoot, relativePath);
      }

      if (absoluteRequest.startsWith(brokenPluginsPrefix)) {
        const relativePath = absoluteRequest.slice(brokenPluginsPrefix.length);
        return path.join(pluginsRoot, relativePath);
      }

      return request;
    };

    moduleAny._resolveFilename = function patchedResolveFilename(
      request: string,
      parent: NodeModule | undefined,
      isMain: boolean,
      options: any
    ) {
      try {
        return originalResolveFilename.call(this, request, parent, isMain, options);
      } catch (originalError) {
        const rewritten = resolveCandidate(request, parent);
        if (rewritten === request) {
          throw originalError;
        }

        const directExists =
          fs.existsSync(rewritten) ||
          fs.existsSync(`${rewritten}.js`) ||
          fs.existsSync(`${rewritten}.json`) ||
          fs.existsSync(`${rewritten}.node`);
        if (!directExists) {
          throw originalError;
        }

        return originalResolveFilename.call(this, rewritten, parent, isMain, options);
      }
    };
  }

  private static installGlobalCrashHandlers() {
    process.on("uncaughtException", (err) => {
      console.error("[fatal] uncaughtException", err);
    });
    process.on("unhandledRejection", (reason) => {
      console.error("[fatal] unhandledRejection", reason);
    });
  }

  private static installGracefulShutdownHandlers() {
    if (Server.gracefulHandlersInstalled) {
      return;
    }
    Server.gracefulHandlersInstalled = true;

    process.on("SIGINT", () => {
      void Server.gracefulShutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void Server.gracefulShutdown("SIGTERM");
    });
    // Closing the terminal the server runs in.
    process.on("SIGHUP", () => {
      void Server.gracefulShutdown("SIGHUP");
    });
    process.once("SIGUSR2", () => {
      void Server.gracefulShutdown("SIGUSR2", "restart");
    });
  }

  private static async gracefulShutdown(
    reason: string,
    mode: "exit" | "restart" = "exit"
  ): Promise<void> {
    if (Server.shuttingDown) {
      console.info(`[shutdown] ${reason} ignored: shutdown already in progress`);
      return;
    }
    Server.shuttingDown = true;

    try {
      const onlinePlayers = World.getPlayers().sizeReturn();
      console.info(
        `[shutdown] ${reason} received. Persisting ${onlinePlayers} online players...`
      );
      PluginManager.emitServerShutdown({ timestamp: Date.now() });
      World.savePlayers("shutdown");
      await GameConstants.PLAYER_PERSISTENCE.flush();
      console.info("[shutdown] Player persistence completed.");
    } catch (err) {
      console.error("[shutdown] Player persistence failed.", err);
    }

    if (mode === "restart") {
      console.info("[shutdown] Continuing nodemon restart (SIGUSR2).");
      process.kill(process.pid, "SIGUSR2");
      return;
    }

    process.exit(0);
  }

  public static async main(args: string[]): Promise<void> {
    try {
      Server.setupFileLogging();
      Server.installGlobalCrashHandlers();
      Server.installGracefulShutdownHandlers();
      Server.installProductionPathResolver();

      const productionArg = args.find((arg) => arg === "0" || arg === "1");
      if (productionArg) {
        Server.PRODUCTION = productionArg === "1";
      }
      const disablePlayerBots = args.includes("--disablePlayerBots");
      if (disablePlayerBots) {
        process.env.DISABLE_PLAYER_BOTS = "1";
        console.info("[Server] --disablePlayerBots enabled");
      }
      const stressTestArg = args.find((arg) => arg.startsWith("--stressTest"));
      if (stressTestArg) {
        const [, rawCount] = stressTestArg.split("=");
        const count = rawCount ? Number(rawCount) : 300;
        process.env.STRESS_TEST_BOT_COUNT = String(
          Number.isFinite(count) && count > 0 ? Math.floor(count) : 300
        );
        // Stress-test bots replace the normal PvP/economy bot population.
        process.env.DISABLE_PLAYER_BOTS = "1";
        // Bots are normally excluded from visibility work; a stress run wants that
        // cost measured, so opt in unless explicitly disabled.
        if (process.env.STRESS_TEST_BOT_UPDATES !== "0") {
          process.env.STRESS_TEST_BOT_UPDATES = "1";
        }
        console.info(
          `[Server] --stressTest enabled (${process.env.STRESS_TEST_BOT_COUNT} bots, PlayerBots disabled,` +
          ` botVisibilityUpdates=${process.env.STRESS_TEST_BOT_UPDATES})`
        );
      }

      const cache = await CachePipeline.initialize();
      console.info(`[cache] active ${cache.name} (revision ${cache.revision})`);

      PluginManager.loadFromDirectory(path.join(process.cwd(), "plugins"));

      console.debug(
        `[server] initializing in ${
          Server.PRODUCTION ? "production" : "development"
        } mode`
      );
      // Start game logic (schedules GameEngine ticks, loads definitions, etc.)
      new GameBuilder().initialize();
      new NetworkBuilder().initialize(NetworkConstants.WEBSOCKET_PORT);
    } catch (e) {
      console.log(e, "error");
      console.error(`An error occurred while binding the Bootstrap: ${e}`);
      process.exit(1);
    }
  }

  public static logDebug(logMessage: string) {
    if (!Server.DEBUG_LOGGING) {
      return;
    }

    Server.logger.info(logMessage);
  }

  public static getLogger() {
    return Server.logger;
  }

  public static isUpdating() {
    return Server.updating;
  }

  public static setUpdating(isUpdating: boolean) {
    Server.updating = isUpdating;
  }

  /** Trigger the graceful shutdown sequence (persist players, then exit the process). */
  public static shutdown(reason: string = "shutdown"): void {
    void Server.gracefulShutdown(reason, "exit");
  }

  public static getFlooder() {
    return Server.flooder;
  }
}

if (require.main === module) {
  void Server.main(process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["1"]);
}
