package local.questbridge;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executors;

/** Loopback-only, credential-bound, bounded JSON service. */
public final class BridgeServer {
  public static void main(String[] args) throws Exception {
    int port =
        args.length > 0
            ? Integer.parseInt(args[0])
            : Integer.parseInt(System.getenv().getOrDefault("QUEST_HELPER_PORT", "16471"));
    String token = System.getenv("QUEST_HELPER_TOKEN");
    if (token == null || token.length() < 24)
      throw new IllegalArgumentException("QUEST_HELPER_TOKEN must contain at least24 characters");
    BridgeEngine engine = new BridgeEngine();
    HttpServer server =
        HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 16);
    server.setExecutor(Executors.newFixedThreadPool(2));
    server.createContext(
        "/",
        exchange -> {
          try {
            if (!exchange.getRemoteAddress().getAddress().isLoopbackAddress()) {
              respond(exchange, 403, "{}");
              return;
            }
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/health") && exchange.getRequestMethod().equals("GET")) {
              respond(
                  exchange,
                  200,
                  "{\"protocol\":1,\"status\":\"ok\",\"sourceCommit\":\""
                      + BridgeEngine.SOURCE
                      + "\"}");
              return;
            }
            String auth = exchange.getRequestHeaders().getFirst("Authorization");
            if (auth == null
                || !MessageDigest.isEqual(
                    auth.getBytes(StandardCharsets.UTF_8),
                    ("Bearer " + token).getBytes(StandardCharsets.UTF_8))) {
              respond(exchange, 401, "{}");
              return;
            }
            if (path.equals("/catalog") && exchange.getRequestMethod().equals("GET")) {
              respond(exchange, 200, engine.catalog().toString());
              return;
            }
            if (!exchange.getRequestMethod().equals("POST")) {
              respond(exchange, 405, "{}");
              return;
            }
            byte[] body = exchange.getRequestBody().readNBytes(4 * 1024 * 1024 + 1);
            if (body.length > 4 * 1024 * 1024) {
              respond(exchange, 413, "{}");
              return;
            }
            JsonObject request =
                JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
            if (path.equals("/evaluate")) {
              respond(exchange, 200, engine.evaluate(request).toString());
              return;
            }
            if (path.equals("/close")) {
              boolean closed = engine.closeSession(request.get("session").getAsString());
              respond(exchange, 200, "{\"protocol\":1,\"closed\":" + closed + "}");
              return;
            }
            respond(exchange, 404, "{}");
          } catch (Exception error) {
            respond(exchange, 400, "{\"protocol\":1,\"error\":\"Invalid request\"}");
          }
        });
    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  server.stop(0);
                  engine.close();
                }));
    server.start();
    System.out.println("QUEST_HELPER_READY http://127.0.0.1:" + port);
    if ("1".equals(System.getenv("QUEST_HELPER_EXIT_WITH_PARENT"))) exitWithParent();
  }

  /**
   * The game server starts this bridge with stdin as a pipe it never writes to. The pipe closes
   * when the server process ends, however it ends, so the bridge exits with it.
   */
  static void exitWithParent() {
    Thread watcher =
        new Thread(
            () -> {
              try {
                while (System.in.read() != -1) {}
              } catch (IOException ignored) {
              }
              System.exit(0);
            },
            "quest-helper-parent-watch");
    watcher.setDaemon(true);
    watcher.start();
  }

  static void respond(HttpExchange e, int status, String json) throws IOException {
    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    e.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    e.getResponseHeaders().set("Cache-Control", "no-store");
    e.sendResponseHeaders(status, bytes.length);
    try (var out = e.getResponseBody()) {
      out.write(bytes);
    }
  }
}
