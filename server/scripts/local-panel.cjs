const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { fork } = require("node:child_process");
const { resolveAccess, originAllowed } = require("../plugins/tools/worldadmin/Access.WorldAdmin");
const { createRequestHandler, HttpError, send } = require("../plugins/tools/worldadmin/Http.WorldAdmin");
const { playerRoutes } = require("../plugins/tools/worldadmin/Players.WorldAdmin");

if (process.argv[2] === "--runner") {
  const nodemon = require("nodemon")({ script: "./src/main/typescript/elvarg/Server.ts", args: ["0"], ext: "ts,json,js", stdin: false });
  let quitting = false;
  const quit = () => {
    if (quitting) return;
    quitting = true;
    nodemon.emit("quit");
  };
  nodemon.on("start", () => process.send?.("starting"));
  nodemon.on("crash", () => process.send?.("crashed"));
  nodemon.on("exit", signal => {
    if (quitting) process.exit(0);
    if (!signal) process.send?.("idle");
  });
  process.on("message", message => {
    if (message === "quit") quit();
    if (message === "restart" && !quitting) nodemon.emit("restart");
  });
  process.on("disconnect", quit);
} else {
  const tokenFile = path.resolve("data/definitions/world-admin.token");
  const access = resolveAccess(process.env, { tokenFile });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tsps-"));
  const socket = process.platform === "win32"
    ? `\\\\.\\pipe\\tsps-${path.basename(temporary)}`
    : path.join(temporary, "game.sock");
  let runner;
  let phase = "stopped";
  let waitingForStart = false;
  let restartAfterStop = false;
  let lastCatalogue;
  let closing = false;

  function start() {
    phase = "starting";
    const child = fork(__filename, ["--runner"], {
      env: {
        ...process.env,
        TSPS_WORLD_ADMIN_SOCKET: socket,
        WORLD_ADMIN_TOKEN: access.token,
        // `dev:panel` is an explicit local-authoring entrypoint; set this to 0 to disable writes.
        CACHE_EDITOR_ENABLED: process.env.CACHE_EDITOR_ENABLED ?? "1",
      },
    });
    runner = child;
    child.on("message", event => {
      if (phase === "stopping" && event === "idle") {
        if (restartAfterStop) {
          restartAfterStop = false;
          phase = "starting";
          waitingForStart = true;
          child.send("restart");
        } else child.send("quit");
      } else if (event === "crashed" || event === "idle") phase = "failed";
      else if (phase !== "stopping" && event === "starting") {
        waitingForStart = false;
        phase = "starting";
      }
    });
    child.once("exit", () => {
      runner = undefined;
      phase = phase === "stopping" ? "stopped" : "failed";
      if (closing) process.exit(0);
    });
    child.on("error", error => console.error("[local-panel]", error.message));
  }

  function backend(url, request, method = request?.method ?? "GET") {
    return new Promise((resolve, reject) => {
      const headers = {
        ...request?.headers,
        Host: "localhost:0",
        Authorization: "Bearer " + access.token,
      };
      delete headers.host;
      delete headers.authorization;
      delete headers.cookie;
      if (headers.origin) headers.origin = "http://localhost:0";
      const proxy = http.request({ socketPath: socket, path: url, method, headers }, resolve);
      proxy.once("error", reject);
      if (request) {
        request.once("aborted", () => proxy.destroy());
        request.pipe(proxy);
      } else proxy.end();
    });
  }

  async function catalogue() {
    try {
      const response = await backend("/api/catalog");
      if (response.statusCode !== 200) throw new Error("Game panel unavailable");
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (phase !== "stopping" && !waitingForStart) phase = "online";
      if (phase === "stopping" && data.lastFailure?.message.startsWith("Stop cancelled:")) {
        restartAfterStop = false;
        phase = "online";
      }
      lastCatalogue = data;
      return { status: 200, body: { ...data, serverStatus: phase } };
    } catch {
      if (phase === "online") phase = "starting";
      return { status: 200, body: {
        catalog: lastCatalogue?.catalog ?? { plugins: [], options: [], world: [], membersWorld: true },
        layers: lastCatalogue?.layers ?? { localHash: "", localExists: false },
        mode: "dev", onlinePlayers: 0, serverStatus: phase,
      } };
    }
  }

  async function dispatch(request, response, url) {
    if (url.pathname === "/api/catalog") return false;
    if (!url.pathname.startsWith("/api/")) return false;
    if (url.pathname === "/api/server/shutdown") throw new HttpError(404, "Not found");
    if (request.method !== "GET" && !originAllowed(request)) throw new HttpError(403, "Cross-origin request refused");
    if (["/api/server/start", "/api/server/stop", "/api/server/restart"].includes(url.pathname)) {
      if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
      request.resume();
      if (url.pathname.endsWith("/start") && ["stopped", "failed"].includes(phase)) {
        if (runner) { phase = "starting"; waitingForStart = true; runner.send("restart"); }
        else start();
      } else if (phase === "online" && (url.pathname.endsWith("/stop") || url.pathname.endsWith("/restart"))) {
        const game = await catalogue();
        if (game.body.serverStatus !== "online" || game.body.pending || game.body.countdown?.scheduled) {
          throw new HttpError(409, "Wait for the current server operation to finish.");
        }
        // Let the game save players and exit before asking nodemon to start it again.
        restartAfterStop = url.pathname.endsWith("/restart");
        phase = "stopping";
        try {
          const result = await backend("/api/server/shutdown", undefined, "POST");
          result.resume();
          if (result.statusCode !== 202) throw new Error("The server could not stop.");
        } catch (error) {
          restartAfterStop = false;
          phase = "online";
          throw new HttpError(409, error.message);
        }
      } else throw new HttpError(409, "The server is already changing state.");
      send(response, 202, { serverStatus: phase });
      return true;
    }
    try {
      const upstream = await backend(request.url, request);
      response.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(response);
    } catch {
      if (request.method === "GET" && phase === "stopped" && await playerRoutes(request, response, url, undefined, lastCatalogue)) return true;
      send(response, 503, { error: "The game server is unavailable." });
    }
    return true;
  }

  const server = http.createServer(createRequestHandler({
    token: access.token, loopback: access.loopback, port: () => server.address().port,
  }, { catalog: catalogue, dispatch }, []));
  server.listen(access.port, access.host, () => {
    for (const note of access.notes) console.warn("[local-panel]", note);
    const tokenSource = access.tokenSource === "env" ? "WORLD_ADMIN_TOKEN" : path.relative(process.cwd(), tokenFile);
    console.info(`[local-panel] http://localhost:${server.address().port}/?token=<token from ${tokenSource}>`);
    start();
  });
  process.on("exit", () => fs.rmSync(temporary, { recursive: true, force: true }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    if (closing) return;
    closing = true;
    server.close();
    if (runner?.connected) runner.send("quit");
    else process.exit(0);
  });
}
