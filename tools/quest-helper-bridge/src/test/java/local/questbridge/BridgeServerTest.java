package local.questbridge;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** The shared-bridge settings: bind, CORS, request limit and session expiry. */
class BridgeServerTest {
  static final String TOKEN = "t".repeat(32);
  static final HttpClient HTTP = HttpClient.newHttpClient();

  static BridgeServer.Options options(Map<String, String> extra) {
    Map<String, String> env = new HashMap<>(Map.of("QUEST_HELPER_TOKEN", TOKEN, "QUEST_HELPER_PORT", "0"));
    env.putAll(extra);
    return BridgeServer.Options.from(env, new String[0]);
  }

  static HttpResponse<String> send(int port, String method, String path, Map<String, String> headers)
      throws Exception {
    var builder =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .method(method, HttpRequest.BodyPublishers.noBody());
    headers.forEach(builder::header);
    return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
  }

  static int sendForwardedLines(int port, String... lines) throws Exception {
    var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/health")).GET();
    for (String line : lines) builder.header("X-Forwarded-For", line);
    return HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString()).statusCode();
  }

  @Test
  void loopbackStaysTheDefaultWithNoLimitOrCors() {
    var o = options(Map.of());
    assertFalse(o.shared());
    assertEquals(0, o.ratePerMinute());
    assertNull(o.allowedOrigin("https://example.com"));
    assertTrue(o.loopbackOnly());
    assertEquals(0, o.maxSessionsPerCaller());
    for (String bind : List.of("localhost", "::1", "0:0:0:0:0:0:0:1", "127.0.0.2"))
      assertTrue(options(Map.of("QUEST_HELPER_BIND", bind)).loopbackOnly(), bind);
    var direct = options(Map.of("QUEST_HELPER_BIND", "0.0.0.0"));
    assertTrue(direct.shared());
    assertFalse(direct.loopbackOnly());
    assertEquals(6000, direct.ratePerMinute());
    // Behind a proxy on the same host the bridge stays on loopback but still applies the limits.
    var proxied = options(Map.of("QUEST_HELPER_SHARED", "1"));
    assertTrue(proxied.shared());
    assertTrue(proxied.loopbackOnly());
    assertEquals(6000, proxied.ratePerMinute());
    assertEquals(32, proxied.maxSessionsPerCaller());
  }

  @Test
  void badSettingsNameTheVariable() {
    var nan = assertThrows(IllegalArgumentException.class, () -> options(Map.of("QUEST_HELPER_THREADS", "abc")));
    assertTrue(nan.getMessage().contains("QUEST_HELPER_THREADS"), nan.getMessage());
    var zero = assertThrows(IllegalArgumentException.class, () -> options(Map.of("QUEST_HELPER_MAX_SESSIONS", "0")));
    assertTrue(zero.getMessage().contains("QUEST_HELPER_MAX_SESSIONS"), zero.getMessage());
  }

  @Test
  void originsMatchExactlyOrBySubdomainWildcard() {
    var o =
        options(
            Map.of(
                "QUEST_HELPER_ALLOWED_ORIGINS",
                "https://rsps.app, https://*.webcontainer-api.io/"));
    assertEquals("https://rsps.app", o.allowedOrigin("https://rsps.app"));
    assertEquals(
        "https://abc--3000.local.webcontainer-api.io",
        o.allowedOrigin("https://abc--3000.local.webcontainer-api.io"));
    assertNull(o.allowedOrigin("https://webcontainer-api.io"));
    assertNull(o.allowedOrigin("http://abc.webcontainer-api.io"));
    assertNull(o.allowedOrigin("https://evil.com/.webcontainer-api.io"));
    assertNull(o.allowedOrigin("https://rsps.app.evil.com"));
    assertEquals("https://ABC.webcontainer-api.io", o.allowedOrigin("https://ABC.webcontainer-api.io"));
    assertEquals(
        "https://x.webcontainer-api.io",
        options(Map.of("QUEST_HELPER_ALLOWED_ORIGINS", "https://*.WebContainer-API.io"))
            .allowedOrigin("https://x.webcontainer-api.io"));
    assertThrows(
        IllegalArgumentException.class,
        () -> options(Map.of("QUEST_HELPER_ALLOWED_ORIGINS", "*")));
  }

  @Test
  void preflightAndResponsesCarryCorsOnlyForAllowedOrigins() throws Exception {
    var o = options(Map.of("QUEST_HELPER_ALLOWED_ORIGINS", "https://*.webcontainer-api.io"));
    try (var engine = new BridgeEngine()) {
      var server = BridgeServer.start(o, engine, System::currentTimeMillis);
      try {
        int port = server.getAddress().getPort();
        String allowed = "https://abc.webcontainer-api.io";
        var preflight =
            send(port, "OPTIONS", "/evaluate", Map.of("Origin", allowed, "Access-Control-Request-Method", "POST"));
        assertEquals(204, preflight.statusCode());
        assertEquals(allowed, preflight.headers().firstValue("Access-Control-Allow-Origin").orElse(null));
        assertTrue(preflight.headers().firstValue("Access-Control-Allow-Headers").orElse("").contains("Authorization"));

        var refused = send(port, "OPTIONS", "/evaluate", Map.of("Origin", "https://evil.com"));
        assertEquals(403, refused.statusCode());
        assertTrue(refused.headers().firstValue("Access-Control-Allow-Origin").isEmpty());

        var unauthorised = send(port, "GET", "/catalog", Map.of("Origin", allowed));
        assertEquals(401, unauthorised.statusCode());
        assertEquals(allowed, unauthorised.headers().firstValue("Access-Control-Allow-Origin").orElse(null));

        var health = send(port, "GET", "/health", Map.of());
        assertEquals(200, health.statusCode());
        assertTrue(health.headers().firstValue("Access-Control-Allow-Origin").isEmpty());
      } finally {
        server.stop(0);
      }
    }
  }

  @Test
  void requestLimitCountsPerAddressPerMinute() throws Exception {
    AtomicLong now = new AtomicLong(0);
    var o = options(Map.of("QUEST_HELPER_RATE_PER_MIN", "2"));
    try (var engine = new BridgeEngine()) {
      var server = BridgeServer.start(o, engine, now::get);
      try {
        int port = server.getAddress().getPort();
        assertEquals(200, send(port, "GET", "/health", Map.of()).statusCode());
        assertEquals(200, send(port, "GET", "/health", Map.of()).statusCode());
        assertEquals(429, send(port, "GET", "/health", Map.of()).statusCode());
        now.set(60_000);
        assertEquals(200, send(port, "GET", "/health", Map.of()).statusCode());
      } finally {
        server.stop(0);
      }
    }
  }

  @Test
  void forwardedAddressIsUsedOnlyBehindATrustedProxy() throws Exception {
    for (boolean trusted : new boolean[] {true, false}) {
      var o =
          options(
              Map.of(
                  "QUEST_HELPER_RATE_PER_MIN", "1",
                  "QUEST_HELPER_TRUST_PROXY", trusted ? "1" : "0"));
      try (var engine = new BridgeEngine()) {
        var server = BridgeServer.start(o, engine, () -> 0);
        try {
          int port = server.getAddress().getPort();
          // The caller's own X-Forwarded-For entry comes first; the proxy's hop is last.
          var first = Map.of("X-Forwarded-For", "6.6.6.6, 10.0.0.1");
          var second = Map.of("X-Forwarded-For", "6.6.6.6, 10.0.0.2");
          assertEquals(200, send(port, "GET", "/health", first).statusCode());
          assertEquals(trusted ? 200 : 429, send(port, "GET", "/health", second).statusCode());
          assertEquals(429, send(port, "GET", "/health", first).statusCode());
        } finally {
          server.stop(0);
        }
      }
      // A proxy that appends its own header line leaves the caller's forged lines first.
      try (var engine = new BridgeEngine()) {
        var server = BridgeServer.start(o, engine, () -> 0);
        try {
          int port = server.getAddress().getPort();
          for (int i = 1; i <= 3; i++) {
            int status = sendForwardedLines(port, "6.6.6." + i, "10.0.0.1");
            assertEquals(i == 1 ? 200 : 429, status, "request " + i + " trusted=" + trusted);
          }
        } finally {
          server.stop(0);
        }
      }
    }
  }

  @Test
  void idleSessionsExpireAndTheCapIsConfigurable() {
    AtomicLong now = new AtomicLong(1_000);
    try (var engine = new BridgeEngine(1, 10_000, now::get)) {
      assertEquals("active", engine.evaluate(BridgeTest.request("a", 1, "CooksAssistant")).get("status").getAsString());
      var refused = engine.evaluate(BridgeTest.request("b", 1, "CooksAssistant"));
      assertEquals(
          "LIMIT",
          refused.getAsJsonArray("diagnostics").get(0).getAsJsonObject().get("code").getAsString());
      now.addAndGet(10_000);
      var after = engine.evaluate(BridgeTest.request("b", 1, "CooksAssistant"));
      assertEquals("active", after.get("status").getAsString(), after.toString());
      assertFalse(engine.sessions.containsKey("a"));
      assertTrue(engine.sessions.containsKey("b"));
    }
  }

  @Test
  void oneCallerCannotTakeEverySession() {
    try (var engine = new BridgeEngine(10, 60_000, () -> 0)) {
      engine.maxSessionsPerCaller = 1;
      assertEquals("active", engine.evaluate(BridgeTest.request("a", 1, "CooksAssistant"), "10.0.0.1").get("status").getAsString());
      var refused = engine.evaluate(BridgeTest.request("b", 1, "CooksAssistant"), "10.0.0.1");
      assertEquals("LIMIT", refused.getAsJsonArray("diagnostics").get(0).getAsJsonObject().get("code").getAsString());
      assertEquals("active", engine.evaluate(BridgeTest.request("c", 1, "CooksAssistant"), "10.0.0.2").get("status").getAsString());
      // The caller's own session keeps working.
      assertEquals("active", engine.evaluate(BridgeTest.request("a", 2, "CooksAssistant"), "10.0.0.1").get("status").getAsString());
    }
  }
}
