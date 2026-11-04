import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import com.google.gson.*;
import net.rsprox.proxy.binary.BinaryBlob;
import net.rsprox.proxy.filters.DefaultPropertyFilterSetStore;
import net.rsprox.proxy.settings.DefaultSettingSetStore;
import net.rsprox.proxy.cache.*;
import net.rsprox.proxy.plugin.*;
import net.rsprox.proxy.huffman.HuffmanProvider;
import net.rsprox.cache.Js5MasterIndex;
import net.rsprox.cache.resolver.HistoricCacheResolver;

/** Extracts only map palettes from https://rsprox.net/download/1636; never account/player data.
 * Run with RSProx 1.0.5 launcher jars on the classpath and the decompressed recording as input.
 */
class ExtractBelowIceMountainScenes {
  static final String SHA256 = "5aadb9354628ac122d6e9a845ff24daaf6b7031f10cb6f6fe253bc47139fae33";
  static final Set<Integer> TICKS = Set.of(345,401,462,475,504,521,548,903,1943,2031,2054);
  static final String TIMELINE_SHA256 = "9bc842a9f3c95a78bd3feffc130969eab7fe8d5a307c1abc4e2b9d637b3d4394";
  record Snapshot(int tick, int x, int y, int[][][] palette) {}
  static int phase(int tick) {
    if (tick >= 401 && tick <= 475) return 401;
    if (tick == 504 || tick == 521) return 504;
    return tick;
  }
  public static void main(String[] args) throws Exception {
    if (args.length != 4) throw new IllegalArgumentException("Expected decompressed-1636.bin templates.json authored-source.json scenes.json");
    byte[] input = Files.readAllBytes(Path.of(args[0]));
    String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input));
    if (!SHA256.equals(sha)) throw new IllegalArgumentException("Input does not match recording 1636: " + sha);
    byte[] source = Files.readAllBytes(Path.of(args[2]));
    String sourceSha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(source));
    if (!TIMELINE_SHA256.equals(sourceSha)) throw new IllegalArgumentException("Wrong authored transcript input: " + sourceSha);
    var home = Path.of(System.getProperty("user.home"), ".rsprox");
    var filters = DefaultPropertyFilterSetStore.Companion.load(home.resolve("filters"));
    var settings = DefaultSettingSetStore.Companion.load(home.resolve("settings"));
    var binary = BinaryBlob.Companion.decode(input, filters, settings);
    HuffmanProvider.INSTANCE.load();
    var provider = new StatefulCacheProvider(new CachedCaches(new HistoricCacheResolver()));
    provider.update(Js5MasterIndex.Companion.trimmed(binary.getHeader().getRevision(), binary.getHeader().getJs5MasterIndex()));
    var loader = new DecoderLoader();
    loader.load(provider, null);
    var packets = new DecodingSession(binary, loader.getDecoder(binary.getHeader().getRevision(), provider)).sequence(null).iterator();
    var snapshots = new ArrayList<Snapshot>();
    int tick = 0;
    while (packets.hasNext()) {
      var packet = packets.next();
      if (packet.getProt().toString().equals("SERVER_TICK_END")) tick++;
      if (!packet.getProt().toString().equals("REBUILD_REGION") || !TICKS.contains(tick)) continue;
      var message = packet.getMessage();
      var area = message.getClass().getMethod("getBuildArea").invoke(message);
      for (var field : area.getClass().getDeclaredFields()) {
        if (field.getType() != int[][][].class) continue;
        // BuildArea's public Kotlin inline-value getter has a JVM-only mangled name.
        field.setAccessible(true);
        int[][][] palette = (int[][][])field.get(area);
        var sources = new HashSet<Integer>();
        if (palette.length != 4) throw new IllegalStateException("Expected four planes");
        for (int[][] plane : palette) {
          if (plane.length != 13) throw new IllegalStateException("Expected thirteen columns");
          for (int[] column : plane) {
            if (column.length != 13) throw new IllegalStateException("Expected thirteen rows");
            for (int packed : column) if (packed != -1 && !sources.add(packed & ~6)) {
              throw new IllegalStateException("Ambiguous source chunk in capture at " + tick);
            }
          }
        }
        snapshots.add(new Snapshot(tick,
          (int)message.getClass().getMethod("getZoneX").invoke(message),
          (int)message.getClass().getMethod("getZoneZ").invoke(message), palette));
      }
    }
    if (snapshots.size() != TICKS.size()) throw new IllegalStateException("Missing/duplicate rebuild");
    var out = new StringBuilder("{\n  \"capture\": 1636,\n  \"source\": \"https://rsprox.net/download/1636\",\n  \"sha256\": \"" + sha + "\",\n  \"timelineSourceSha256\": \"" + sourceSha + "\",\n  \"rebuilds\": [\n");
    for (int i = 0; i < snapshots.size(); i++) {
      var s = snapshots.get(i);
      int baseX = snapshots.stream().filter(v -> phase(v.tick) == phase(s.tick)).mapToInt(v -> v.x - 6).min().orElseThrow();
      int baseY = snapshots.stream().filter(v -> phase(v.tick) == phase(s.tick)).mapToInt(v -> v.y - 6).min().orElseThrow();
      if (s.x - baseX + 7 > 18 || s.y - baseY + 7 > 13) throw new IllegalStateException("Scene exceeds allocation");
      out.append("    {\n      \"tick\": ").append(s.tick)
        .append(", \"base\": [").append(baseX).append(", ").append(baseY)
        .append("], \"center\": [").append(s.x).append(", ").append(s.y).append("],\n      \"palette\": ")
        .append(Arrays.deepToString(s.palette)).append("\n    }").append(i + 1 == snapshots.size() ? "\n" : ",\n");
    }
    var timeline = JsonParser.parseString(new String(source, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
    var events = timeline.getAsJsonArray("workout");
    for (var node : events) {
      var event = node.getAsJsonObject();
      int captureTick = event.get("tick").getAsInt() + 345;
      var snapshot = snapshots.stream().filter(v -> v.tick <= Math.min(captureTick, 548)).reduce((a, b) -> b).orElseThrow();
      for (String key : List.of("position", "walk", "camera", "look")) normalizePoint(event, key, snapshot);
      if (event.has("actor")) for (String key : List.of("position", "walk")) normalizePoint(event.getAsJsonObject("actor"), key, snapshot);
      if (event.has("tileGraphic")) normalizePoint(event.getAsJsonObject("tileGraphic"), "position", snapshot);
      if (event.has("projectile")) for (String key : List.of("source", "target")) normalizePoint(event.getAsJsonObject("projectile"), key, snapshot);
    }
    var first = events.get(0).getAsJsonObject().getAsJsonArray("position");
    if (first.get(0).getAsInt() != 3250 || first.get(1).getAsInt() != 3398) throw new IllegalStateException("Raw 345 player normalization regression");
    var gson = new GsonBuilder().disableHtmlEscaping().create();
    var scenes = new StringBuilder("{\n  \"capture\": 1636,\n  \"source\": \"https://rsprox.net/download/1636\",\n  \"sha256\": \"" + sha + "\",\n  \"timelineSourceSha256\": \"" + sourceSha + "\",\n  \"workout\": [\n");
    for (int i = 0; i < events.size(); i++) scenes.append("    ").append(gson.toJson(events.get(i))).append(i + 1 == events.size() ? "\n" : ",\n");
    Files.writeString(Path.of(args[1]), out.append("  ]\n}\n"));
    Files.writeString(Path.of(args[3]), scenes.append("  ]\n}\n"));
  }
  static void normalizePoint(JsonObject event, String key, Snapshot snapshot) {
    if (!event.has(key)) return;
    var point = event.getAsJsonArray(key);
    int x = point.get(0).getAsInt(), y = point.get(1).getAsInt();
    for (var plane : snapshot.palette) for (var column : plane) for (int packed : column) {
      if (packed == -1 || (packed >>> 24 & 3) != 0 || (packed >>> 14 & 1023) != (x >> 3) || (packed >>> 3 & 2047) != (y >> 3)) continue;
      // RSProx 1.0.5 rotates instance -> source the wrong way; odd rotations need a half-turn.
      if ((packed >>> 1 & 1) != 0) {
        point.set(0, new JsonPrimitive((x & ~7) + 7 - (x & 7)));
        point.set(1, new JsonPrimitive((y & ~7) + 7 - (y & 7)));
      }
      return;
    }
    throw new IllegalStateException("Unmapped transcript point at " + snapshot.tick + ": " + point);
  }

}
