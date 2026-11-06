package net.tsps.loginutilities;

import java.io.IOException;
import java.io.Reader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;

/** Operator-provisioned configuration in a dedicated RuneLite profile. Contains no secrets. */
final class HostConfiguration {
  final URI endpoint;
  final int world;
  final Set<String> hosts;
  final Path helper;
  final String scope;

  private HostConfiguration(URI endpoint, int world, Set<String> hosts, Path helper)
      throws Exception {
    this.endpoint = endpoint;
    this.world = world;
    this.hosts = Set.copyOf(hosts);
    this.helper = helper;
    byte[] digest =
        MessageDigest.getInstance("SHA-256")
            .digest(
                ("tsps-login-utilities-v1\n"
                        + endpoint.toASCIIString()
                        + "\n"
                        + world
                        + "\n"
                        + String.join(",", hosts))
                    .getBytes(StandardCharsets.UTF_8));
    StringBuilder hex = new StringBuilder();
    for (byte value : digest) hex.append(String.format("%02x", value & 255));
    scope = hex.toString();
  }

  static HostConfiguration load(Path file) throws Exception {
    if (!Files.isRegularFile(file)) return null;
    if (Files.size(file) > 8192) throw new IOException("Host configuration is too large");
    Properties properties = new Properties();
    try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
      properties.load(reader);
    }
    if (!"true".equals(properties.getProperty("enabled"))) return null;
    URI endpoint = URI.create(properties.getProperty("endpoint", "")).normalize();
    if (!"https".equalsIgnoreCase(endpoint.getScheme())
        || endpoint.getHost() == null
        || endpoint.getUserInfo() != null
        || endpoint.getQuery() != null
        || endpoint.getFragment() != null
        || !"/login-utilities/v1/session".equals(endpoint.getPath())
        || (endpoint.getPort() != -1 && (endpoint.getPort() < 1 || endpoint.getPort() > 65535))) {
      throw new IOException(
          "Login endpoint must be an HTTPS /login-utilities/v1/session URL without credentials,"
              + " query or fragment");
    }
    int world = Integer.parseInt(properties.getProperty("world", "0"));
    if (world < 1 || world > 65535) throw new IOException("Invalid world number");
    Set<String> hosts = new TreeSet<>();
    for (String raw : properties.getProperty("worldHosts", "").split(",")) {
      String host = raw.trim().toLowerCase(Locale.ROOT);
      if (!host.matches("[a-z0-9.:-]{1,253}"))
        throw new IOException("Explicit world hosts are required; wildcards are not supported");
      hosts.add(host);
    }
    Path helper = Path.of(properties.getProperty("tokenStore", ""));
    if (!helper.isAbsolute()
        || helper.toString().startsWith("\\\\")
        || !Files.isRegularFile(helper)) {
      throw new IOException("Token store must be an existing local absolute file path");
    }
    return new HostConfiguration(endpoint, world, hosts, helper);
  }

  boolean matches(int world, String host) {
    return this.world == world && host != null && hosts.contains(host.toLowerCase(Locale.ROOT));
  }

  String nativeAuthBase() {
    return endpoint.resolve("./native/").toASCIIString();
  }
}
