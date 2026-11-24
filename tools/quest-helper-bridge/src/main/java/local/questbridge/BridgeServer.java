package local.questbridge;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.function.LongSupplier;

/**
 * Credential-bound, bounded JSON service. Loopback-only by default; {@code QUEST_HELPER_BIND} set
 * to a non-loopback address, or {@code QUEST_HELPER_SHARED=1} behind a local proxy, serves one bridge
 * to many worlds (browser-hosted ones included), with CORS for {@code QUEST_HELPER_ALLOWED_ORIGINS}
 * and per-caller request and session limits.
 */
public final class BridgeServer {
  static final int MAX_BODY = 4 * 1024 * 1024;

  /** Settings read from the environment; see the README's "Shared bridge" section. */
  record Options(
      String bind,
      boolean loopbackOnly,
      boolean shared,
      int port,
      String token,
      List<String> origins,
      int threads,
      int ratePerMinute,
      boolean trustProxy,
      int maxSessions,
      int maxSessionsPerCaller,
      long idleMs) {
    static Options from(Map<String, String> env, String[] args) {
      String token = env.get("QUEST_HELPER_TOKEN");
      if (token == null || token.length() < 24)
        throw new IllegalArgumentException("QUEST_HELPER_TOKEN must contain at least 24 characters");
      String bind = env.getOrDefault("QUEST_HELPER_BIND", "127.0.0.1").trim();
      boolean loopbackOnly = loopback(bind);
      // Shared: serving other worlds, directly or (bound to loopback) through a local proxy.
      boolean shared = !loopbackOnly || "1".equals(env.get("QUEST_HELPER_SHARED"));
      List<String> origins = new ArrayList<>();
      for (String origin : env.getOrDefault("QUEST_HELPER_ALLOWED_ORIGINS", "").split(",")) {
        if (origin.isBlank()) continue;
        String trimmed = origin.trim().replaceAll("/+$", "").toLowerCase(Locale.ROOT);
        if (!trimmed.matches("https?://(\\*\\.)?[a-z0-9.-]+(:\\d+)?"))
          throw new IllegalArgumentException("Invalid QUEST_HELPER_ALLOWED_ORIGINS entry " + trimmed);
        origins.add(trimmed);
      }
      return new Options(
          bind,
          loopbackOnly,
          shared,
          args.length > 0
              ? (int) parse("port argument", args[0], 0, 65535)
              : (int) number(env, "QUEST_HELPER_PORT", 16471, 0, 65535),
          token,
          List.copyOf(origins),
          (int) number(env, "QUEST_HELPER_THREADS", shared ? 8 : 2, 1, 256),
          (int) number(env, "QUEST_HELPER_RATE_PER_MIN", shared ? 6000 : 0, 0, Integer.MAX_VALUE),
          "1".equals(env.get("QUEST_HELPER_TRUST_PROXY")),
          (int) number(env, "QUEST_HELPER_MAX_SESSIONS", BridgeEngine.DEFAULT_MAX_SESSIONS, 1, 100_000),
          (int) number(env, "QUEST_HELPER_MAX_SESSIONS_PER_CALLER", shared ? 32 : 0, 0, 100_000),
          number(env, "QUEST_HELPER_SESSION_IDLE_MS", BridgeEngine.DEFAULT_IDLE_MS, 1000, Long.MAX_VALUE));
    }

    /** The origin to echo in Access-Control-Allow-Origin, or null when it isn't allowed. */
    String allowedOrigin(String header) {
      if (header == null) return null;
      String origin = header.toLowerCase(Locale.ROOT);
      for (String allowed : origins) {
        if (allowed.equals(origin)) return header;
        int star = allowed.indexOf("://*.");
        if (star < 0) continue;
        String scheme = allowed.substring(0, star + 3), suffix = allowed.substring(star + 4);
        String host = origin.startsWith(scheme) ? origin.substring(scheme.length()) : "";
        if (host.length() > suffix.length()
            && host.endsWith(suffix)
            && host.substring(0, host.length() - suffix.length()).matches("[a-z0-9.-]+"))
          return header;
      }
      return null;
    }

    static boolean loopback(String bind) {
      try {
        return InetAddress.getByName(bind).isLoopbackAddress();
      } catch (UnknownHostException e) {
        throw new IllegalArgumentException("QUEST_HELPER_BIND is not a known address: " + bind);
      }
    }

    static long number(Map<String, String> env, String key, long fallback, long min, long max) {
      String value = env.get(key);
      return value == null || value.isBlank() ? fallback : parse(key, value, min, max);
    }

    static long parse(String key, String value, long min, long max) {
      long parsed;
      try {
        parsed = Long.parseLong(value.trim());
      } catch (NumberFormatException e) {
        throw new IllegalArgumentException(key + " must be a whole number, not " + value);
      }
      if (parsed < min || parsed > max)
        throw new IllegalArgumentException(key + " must be between " + min + " and " + max);
      return parsed;
    }
  }

  /** At most {@code perMinute} requests per address in each clock minute; 0 turns it off. */
  static final class RateLimit {
    final int perMinute;
    final LongSupplier clock;
    final Map<String, Integer> counts = new HashMap<>();
    long minute = Long.MIN_VALUE;

    RateLimit(int perMinute, LongSupplier clock) {
      this.perMinute = perMinute;
      this.clock = clock;
    }

    synchronized boolean allow(String address) {
      if (perMinute <= 0) return true;
      long now = clock.getAsLong() / 60_000;
      if (now != minute) {
        minute = now;
        counts.clear();
      }
      return counts.merge(address, 1, Integer::sum) <= perMinute;
    }
  }

  public static void main(String[] args) throws Exception {
    Options options = Options.from(System.getenv(), args);
    BridgeEngine engine =
        new BridgeEngine(options.maxSessions(), options.idleMs(), System::currentTimeMillis);
    HttpServer server = start(options, engine, System::currentTimeMillis);
    Runtime.getRuntime()
        .addShutdownHook(
            new Thread(
                () -> {
                  server.stop(0);
                  engine.close();
                }));
    System.out.println(
        "QUEST_HELPER_READY http://"
            + (options.loopbackOnly() ? "127.0.0.1" : options.bind())
            + ":"
            + server.getAddress().getPort()
            + (options.shared() ? " (shared)" : ""));
    if ("1".equals(System.getenv("QUEST_HELPER_EXIT_WITH_PARENT"))) exitWithParent();
  }

  static HttpServer start(Options options, BridgeEngine engine, LongSupplier clock)
      throws IOException {
    engine.maxSessionsPerCaller = options.maxSessionsPerCaller();
    if (options.shared()) {
      // The JDK server reads headers on the worker threads with no time limit by default, so a few
      // slow connections could hold every thread. These are read when the server is created.
      System.setProperty("sun.net.httpserver.maxReqTime", "30");
      System.setProperty("sun.net.httpserver.maxRspTime", "60");
    }
    HttpServer server =
        HttpServer.create(
            new InetSocketAddress(InetAddress.getByName(options.bind()), options.port()), 16);
    server.setExecutor(Executors.newFixedThreadPool(Math.max(1, options.threads())));
    RateLimit limit = new RateLimit(options.ratePerMinute(), clock);
    server.createContext("/", exchange -> handle(exchange, options, engine, limit));
    server.start();
    return server;
  }

  static String clientAddress(HttpExchange exchange, Options options) {
    if (options.trustProxy()) {
      // A proxy that appends its own header line leaves the caller's forged lines first, so key
      // on the last hop of the last line: the address the trusted proxy itself saw.
      List<String> lines = exchange.getRequestHeaders().get("X-Forwarded-For");
      if (lines != null && !lines.isEmpty()) {
        String[] hops = lines.get(lines.size() - 1).split(",");
        String last = hops[hops.length - 1].trim();
        if (!last.isEmpty()) return last;
      }
    }
    return exchange.getRemoteAddress().getAddress().getHostAddress();
  }

  static void handle(HttpExchange exchange, Options options, BridgeEngine engine, RateLimit limit)
      throws IOException {
    try {
      if (options.loopbackOnly() && !exchange.getRemoteAddress().getAddress().isLoopbackAddress()) {
        respond(exchange, 403, "{}");
        return;
      }
      String origin = options.allowedOrigin(exchange.getRequestHeaders().getFirst("Origin"));
      if (!options.origins().isEmpty()) exchange.getResponseHeaders().set("Vary", "Origin");
      if (origin != null) exchange.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
      String method = exchange.getRequestMethod();
      if (method.equals("OPTIONS")) {
        if (origin != null) {
          exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST");
          exchange
              .getResponseHeaders()
              .set("Access-Control-Allow-Headers", "Authorization, Content-Type");
          exchange.getResponseHeaders().set("Access-Control-Max-Age", "600");
        }
        exchange.sendResponseHeaders(origin != null ? 204 : 403, -1);
        exchange.close();
        return;
      }
      String caller = clientAddress(exchange, options);
      if (!limit.allow(caller)) {
        respond(exchange, 429, "{\"protocol\":1,\"error\":\"Too many requests\"}");
        return;
      }
      String path = exchange.getRequestURI().getPath();
      if (path.equals("/health") && method.equals("GET")) {
        respond(
            exchange,
            200,
            "{\"protocol\":1,\"status\":\"ok\",\"sourceCommit\":\"" + BridgeEngine.SOURCE + "\"}");
        return;
      }
      String auth = exchange.getRequestHeaders().getFirst("Authorization");
      if (auth == null
          || !MessageDigest.isEqual(
              auth.getBytes(StandardCharsets.UTF_8),
              ("Bearer " + options.token()).getBytes(StandardCharsets.UTF_8))) {
        respond(exchange, 401, "{}");
        return;
      }
      if (path.equals("/catalog") && method.equals("GET")) {
        respond(exchange, 200, engine.catalog().toString());
        return;
      }
      if (!method.equals("POST")) {
        respond(exchange, 405, "{}");
        return;
      }
      byte[] body = exchange.getRequestBody().readNBytes(MAX_BODY + 1);
      if (body.length > MAX_BODY) {
        respond(exchange, 413, "{}");
        return;
      }
      JsonObject request =
          JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
      if (path.equals("/evaluate")) {
        respond(exchange, 200, engine.evaluate(request, caller).toString());
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
