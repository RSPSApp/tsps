package net.tsps.loginutilities;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class HostConfigurationTest {
  @TempDir Path root;

  private Path configuration(String endpoint, String hosts) throws Exception {
    Path helper = root.resolve("LoginUtilities.TokenStore.exe");
    Files.writeString(helper, "test placeholder; never executed");
    Path config = root.resolve("host.properties");
    Files.writeString(
        config,
        "enabled=true\nendpoint="
            + endpoint
            + "\nworld=1\nworldHosts="
            + hosts
            + "\ntokenStore="
            + helper.toString().replace('\\', '/')
            + "\n");
    return config;
  }

  @Test
  void missingOrDisabledConfigurationLeavesOrdinaryLoginUntouched() throws Exception {
    assertNull(HostConfiguration.load(root.resolve("absent")));
    Path disabled = root.resolve("disabled");
    Files.writeString(disabled, "enabled=false\nendpoint=http://invalid.invalid\n");
    assertNull(HostConfiguration.load(disabled));
  }

  @Test
  void validatesHttpsAndRejectsCredentialBearingOrAmbiguousEndpoints() throws Exception {
    for (String endpoint :
        new String[] {
          "http://example.invalid/login-utilities/v1/session",
          "https://user:password@example.invalid/login-utilities/v1/session",
          "https://example.invalid/login-utilities/v1/session?token=x",
          "https://example.invalid/login-utilities/v1/session#fragment",
          "https://example.invalid/other",
          "https://example.invalid:0/login-utilities/v1/session"
        }) {
      Path file = configuration(endpoint, "127.0.0.1");
      assertThrows(Exception.class, () -> HostConfiguration.load(file));
    }
  }

  @Test
  void tokenNamespaceIsStableButSeparateForDifferentServers() throws Exception {
    HostConfiguration first =
        HostConfiguration.load(
            configuration("https://one.invalid/login-utilities/v1/session", "localhost,127.0.0.1"));
    HostConfiguration reordered =
        HostConfiguration.load(
            configuration("https://one.invalid/login-utilities/v1/session", "127.0.0.1,localhost"));
    HostConfiguration second =
        HostConfiguration.load(
            configuration("https://two.invalid/login-utilities/v1/session", "localhost,127.0.0.1"));
    assertEquals(first.scope, reordered.scope);
    assertNotEquals(first.scope, second.scope);
    assertTrue(first.scope.matches("[a-f0-9]{64}"));
    assertTrue(first.matches(1, "LOCALHOST"));
    assertFalse(first.matches(2, "localhost"));
    assertFalse(first.matches(1, "unrelated.invalid"));
    assertEquals("https://one.invalid/login-utilities/v1/native/", first.nativeAuthBase());
  }

  @Test
  void requiresExplicitWorldHostsAndExistingHelper() throws Exception {
    Path wildcard = configuration("https://one.invalid/login-utilities/v1/session", "*");
    assertThrows(Exception.class, () -> HostConfiguration.load(wildcard));
    Path config = configuration("https://one.invalid/login-utilities/v1/session", "127.0.0.1");
    Files.delete(root.resolve("LoginUtilities.TokenStore.exe"));
    final Path missingHelperConfig = config;
    assertThrows(Exception.class, () -> HostConfiguration.load(missingHelperConfig));
  }
}
