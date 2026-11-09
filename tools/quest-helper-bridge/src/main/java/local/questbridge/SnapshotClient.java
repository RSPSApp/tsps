package local.questbridge;

import com.google.gson.*;
import java.awt.Rectangle;
import java.util.*;
import java.util.stream.Stream;
import net.runelite.api.*;
import net.runelite.api.coords.*;
import net.runelite.api.widgets.Widget;
import org.mockito.Mockito;
import org.mockito.stubbing.Answer;

/**
 * Read-only RuneLite view. Sparse varps are zero; all other unknown state is requested explicitly.
 */
public final class SnapshotClient {
  JsonObject state;
  public final Client client;
  private final WorldView world;
  private final Scene scene;
  private final Player player;
  private final Map<Integer, NPC> npcIdentities = new HashMap<>();
  private final Map<Integer, JsonObject> npcData = new HashMap<>();
  private final Map<Integer, NPC> previousNpcs = new HashMap<>();
  private final Map<Integer, JsonObject> previousNpcData = new HashMap<>();
  private final Map<Integer, NPC> previousNpcsByEcs = new HashMap<>();
  private final Map<Integer, Widget> widgets = new HashMap<>();
  private int[] scriptStack = new int[1];
  private Tile[][][] tiles;
  private final Map<String, List<TileObject>> tileObjects = new HashMap<>();
  private Map<String, TileObject> stableObjects = new HashMap<>(),
      previousStableObjects = new HashMap<>();
  private final Map<String, List<TileItem>> groundItems = new HashMap<>();
  final List<Object> deltaEvents = new ArrayList<>();

  private Map<String, TileObject> objectIdentities() {
    Map<String, TileObject> result = new LinkedHashMap<>();
    for (var objects : tileObjects.values())
      for (var o : objects) {
        WorldPoint p = o.getWorldLocation();
        result.put(
            o.getClass().getInterfaces()[0].getSimpleName()
                + ":"
                + o.getId()
                + ":"
                + p.getX()
                + ","
                + p.getY()
                + ","
                + p.getPlane(),
            o);
      }
    return result;
  }

  SnapshotClient(JsonObject snapshot) {
    state = snapshot;
    scene =
        strict(
            Scene.class,
            i ->
                switch (i.getMethod().getName()) {
                  case "getTiles" -> tiles;
                  case "getTileHeights" -> geometry("tileHeights", int[][][].class);
                  case "getTileSettings" -> geometry("tileSettings", byte[][][].class);
                  case "getDrawDistance" -> 104;
                  default -> fail(i);
                });
    world =
        strict(
            WorldView.class,
            i ->
                switch (i.getMethod().getName()) {
                  case "contains" -> {
                    WorldPoint p = (WorldPoint) i.getArgument(0);
                    yield p.getX() >= number("baseX")
                        && p.getX() < number("baseX") + 104
                        && p.getY() >= number("baseY")
                        && p.getY() < number("baseY") + 104;
                  }
                  case "isTopLevel" -> true;
                  case "getId" -> -1;
                  case "getBaseX" -> number("baseX");
                  case "getBaseY" -> number("baseY");
                  case "getPlane" -> number("plane");
                  case "getScene" -> scene;
                  case "getTileHeights" -> geometry("tileHeights", int[][][].class);
                  case "getTileSettings" -> geometry("tileSettings", byte[][][].class);
                  case "getSizeX", "getSizeY" -> 104;
                  case "isInstance" -> state.has("instanceTemplateChunks");
                  case "getInstanceTemplateChunks" ->
                      new Gson().fromJson(required("instanceTemplateChunks"), int[][][].class);
                  case "npcs" -> npcSet(i.getMethod().getReturnType());
                  case "worldViews" -> emptyEntitySet(i.getMethod().getReturnType());
                  default -> fail(i);
                });
    player = strict(Player.class, i -> actorValue(i, required("localPlayer").getAsJsonObject()));
    client =
        strict(
            Client.class,
            i -> {
              Object[] a = i.getArguments();
              String m = i.getMethod().getName();
              return switch (m) {
                case "isClientThread" -> true;
                case "getGameState" -> GameState.LOGGED_IN;
                case "getLocalPlayer" -> player;
                case "macroExpand" -> macroExpand((String) a[0]);
                case "getTopLevelWorldView", "getWorldView" -> world;
                case "getScene" -> scene;
                case "getBaseX" -> number("baseX");
                case "getBaseY" -> number("baseY");
                case "getPlane" -> number("plane");
                case "getTickCount", "getGameCycle" -> number("tick");
                case "getVarpValue" -> sparse("varps", ((Number) a[0]).intValue());
                case "getVarps" -> varps();
                case "getVarbitValue" -> varbit(((Number) a[a.length - 1]).intValue());
                case "getVarbit" -> varbitDefinition(((Number) a[0]).intValue());
                case "getRealSkillLevel" -> skill(a[0], "real");
                case "getBoostedSkillLevel" -> skill(a[0], "boosted");
                case "getSkillExperience" -> skill(a[0], "xp");
                case "getNpcs" -> new ArrayList<>(npcIdentities.values());
                case "getPlayers" -> List.of(player);
                case "getWidget" ->
                    widgets.get(
                        a.length == 1
                            ? ((Number) a[0]).intValue()
                            : (((Number) a[0]).intValue() << 16) | ((Number) a[1]).intValue());
                case "getWidgetRoots" -> widgets.values().toArray(Widget[]::new);
                case "getItemContainer" ->
                    container(
                        a[0] instanceof InventoryID
                            ? ((InventoryID) a[0]).getId()
                            : ((Number) a[0]).intValue());
                case "getItemDefinition" ->
                    definition(
                        ItemComposition.class, "itemDefinitions", ((Number) a[0]).intValue());
                case "getObjectDefinition" ->
                    definition(
                        ObjectComposition.class, "objectDefinitions", ((Number) a[0]).intValue());
                case "getNpcDefinition" ->
                    definition(NPCComposition.class, "npcDefinitions", ((Number) a[0]).intValue());
                case "runScript" -> {
                  runScript(a);
                  yield null;
                }
                case "getIntStack" -> scriptStack;
                case "isInInstancedRegion" -> state.has("instanceTemplateChunks");
                case "getInstanceTemplateChunks" ->
                    new Gson().fromJson(required("instanceTemplateChunks"), int[][][].class);
                case "getWorldType" -> EnumSet.of(WorldType.MEMBERS);
                case "getWorld" -> 3000;
                case "getHintArrowNpc" ->
                    npcIdentities.get(required("hintArrowNpcIndex").getAsInt());
                case "getWeight" -> required("weight").getAsInt();
                case "getCanvasWidth",
                    "getCanvasHeight",
                    "getViewportWidth",
                    "getViewportHeight",
                    "getViewportXOffset",
                    "getViewportYOffset",
                    "getCameraX",
                    "getCameraY",
                    "getCameraZ",
                    "getCameraPitch",
                    "getCameraYaw",
                    "getCameraYawTarget",
                    "getScale",
                    "get3dZoom" -> {
                  String key = Character.toLowerCase(m.charAt(3)) + m.substring(4);
                  if (m.equals("getCanvasWidth")) key = "width";
                  if (m.equals("getCanvasHeight")) key = "height";
                  yield geometry(key, int.class);
                }
                case "getTileHeights" -> geometry("tileHeights", int[][][].class);
                case "getTileSettings" -> geometry("tileSettings", byte[][][].class);
                case "getMouseCanvasPosition" -> {
                  if (!state.has("mouse")) throw BridgeFailure.missing("geometry.mouse", 0);
                  var mouse = state.getAsJsonObject("mouse");
                  yield new Point(mouse.get("x").getAsInt(), mouse.get("y").getAsInt());
                }
                case "isMenuOpen" -> state.has("menuOpen") && state.get("menuOpen").getAsBoolean();
                default -> fail(i);
              };
            });
    update(snapshot);
  }

  void update(JsonObject snapshot) {
    Integer previousInteraction =
        state.has("localPlayer") && state.getAsJsonObject("localPlayer").has("interactingIndex")
            ? state.getAsJsonObject("localPlayer").get("interactingIndex").getAsInt()
            : null;
    previousNpcs.clear();
    previousNpcData.clear();
    previousNpcsByEcs.clear();
    for (var entry : npcIdentities.entrySet()) {
      JsonObject frozen = npcData.get(entry.getKey());
      previousNpcData.put(entry.getKey(), frozen);
      NPC old = entry.getValue();
      previousNpcs.put(entry.getKey(), old);
      if (frozen.has("ecsIndex")) {
        previousNpcsByEcs.put(frozen.get("ecsIndex").getAsInt(), old);
      }
    }
    var previousObjects = objectIdentities();
    Map<TileObject, Tile> previousTiles = new IdentityHashMap<>();
    for (var o : previousObjects.values()) {
      WorldPoint p = o.getWorldLocation();
      int x = p.getX() - number("baseX"), y = p.getY() - number("baseY");
      if (x >= 0 && y >= 0 && x < 104 && y < 104) previousTiles.put(o, tiles[p.getPlane()][x][y]);
    }
    state = snapshot;
    tiles = new Tile[4][104][104];
    widgets.clear();
    tileObjects.clear();
    previousStableObjects = stableObjects;
    stableObjects = new HashMap<>();
    groundItems.clear();
    Set<JsonObject> indexedWidgets = Collections.newSetFromMap(new IdentityHashMap<>());
    for (JsonElement e : array("widgets")) indexWidgetTree(e.getAsJsonObject(), indexedWidgets);
    Set<Integer> present = new HashSet<>();
    for (JsonElement e : array("npcs")) {
      JsonObject n = e.getAsJsonObject();
      int idx = n.get("index").getAsInt();
      present.add(idx);
      npcData.put(idx, n);
      npcIdentities.computeIfAbsent(
          idx, k -> strict(NPC.class, i -> actorValue(i, npcData.get(k))));
    }
    npcIdentities.keySet().retainAll(present);
    for (JsonElement e : array("objects")) addTileObject(e.getAsJsonObject());
    for (JsonElement e : array("groundItems")) {
      JsonObject d = e.getAsJsonObject();
      tile(d);
      groundItems
          .computeIfAbsent(tileKey(d), k -> new ArrayList<>())
          .add(
              strict(
                  TileItem.class,
                  i ->
                      switch (i.getMethod().getName()) {
                        case "getId" -> d.get("id").getAsInt();
                        case "getQuantity" -> d.get("quantity").getAsInt();
                        default -> fail(i);
                      }));
    }
    if (state.has("geometry") && state.getAsJsonObject("geometry").has("loadedTilesPacked")) {
      var packed = state.getAsJsonObject("geometry").getAsJsonObject("loadedTilesPacked");
      if (!packed.get("encoding").getAsString().equals("bitset-lsb-base64"))
        throw new BridgeFailure("INVALID_STATE", "loadedTiles", "Invalid encoding");
      byte[] data = Base64.getDecoder().decode(packed.get("data").getAsString());
      if (data.length != (4 * 104 * 104 + 7) / 8)
        throw new BridgeFailure("INVALID_STATE", "loadedTiles", "Invalid packed size");
      for (int p = 0; p < 4; p++)
        for (int x = 0; x < 104; x++)
          for (int y = 0; y < 104; y++) {
            int bit = (p * 104 + x) * 104 + y;
            if ((data[bit >>> 3] & (1 << (bit & 7))) == 0) continue;
            JsonObject d = new JsonObject();
            d.addProperty("x", number("baseX") + x);
            d.addProperty("y", number("baseY") + y);
            d.addProperty("plane", p);
            tile(d);
          }
    }
    deltaEvents.clear();
    var currentObjects = objectIdentities();
    for (var e : previousObjects.entrySet())
      if (!currentObjects.containsKey(e.getKey()) || currentObjects.get(e.getKey()) != e.getValue())
        deltaEvents.add(objectEvent(e.getValue(), previousTiles.get(e.getValue()), false));
    for (var e : currentObjects.entrySet())
      if (!previousObjects.containsKey(e.getKey())
          || previousObjects.get(e.getKey()) != e.getValue()) {
        var p = e.getValue().getWorldLocation();
        deltaEvents.add(
            objectEvent(
                e.getValue(),
                tiles[p.getPlane()][p.getX() - number("baseX")][p.getY() - number("baseY")],
                true));
      }
    if (previousInteraction != null
        && state.getAsJsonObject("localPlayer").has("interactingIndex")) {
      int next = state.getAsJsonObject("localPlayer").get("interactingIndex").getAsInt();
      if (next != previousInteraction)
        deltaEvents.add(
            new net.runelite.api.events.InteractingChanged(player, interactionTarget(next)));
    }
  }

  Object objectEvent(TileObject object, Tile tile, boolean spawn) {
    String name =
        object instanceof GameObject
            ? "GameObject"
            : object instanceof GroundObject
                ? "GroundObject"
                : object instanceof WallObject ? "WallObject" : "DecorativeObject";
    try {
      Class<?> type =
          Class.forName("net.runelite.api.events." + name + (spawn ? "Spawned" : "Despawned"));
      Object event = type.getConstructor().newInstance();
      type.getMethod("setTile", Tile.class).invoke(event, tile);
      Class<?> api = Class.forName("net.runelite.api." + name);
      type.getMethod("set" + name, api).invoke(event, object);
      return event;
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  static <T> T strict(Class<T> type, Answer<?> answer) {
    Answer<Object> guarded =
        i -> {
          String m = i.getMethod().getName();
          if (m.equals("toString")) return "SnapshotAdapter<" + type.getSimpleName() + ">";
          if (m.equals("hashCode")) return System.identityHashCode(i.getMock());
          if (m.equals("equals")) return i.getMock() == i.getArgument(0);
          return answer.answer(i);
        };
    if (type.isInterface())
      return type.cast(
          java.lang.reflect.Proxy.newProxyInstance(
              type.getClassLoader(),
              new Class<?>[] {type},
              (proxy, method, args) ->
                  guarded.answer(
                      new ProxyInvocation(proxy, method, args == null ? new Object[0] : args))));
    return Mockito.mock(type, Mockito.withSettings().defaultAnswer(guarded));
  }

  record ProxyInvocation(Object proxy, java.lang.reflect.Method method, Object[] args)
      implements org.mockito.invocation.InvocationOnMock {
    public Object getMock() {
      return proxy;
    }

    public java.lang.reflect.Method getMethod() {
      return method;
    }

    public Object[] getArguments() {
      return args;
    }

    public Object[] getRawArguments() {
      return args;
    }

    @SuppressWarnings("unchecked")
    public <T> T getArgument(int i) {
      return (T) args[i];
    }

    public <T> T getArgument(int i, Class<T> type) {
      return type.cast(args[i]);
    }

    public Object callRealMethod() throws Throwable {
      if (!method.isDefault()) throw BridgeFailure.unsupported("abstract " + method);
      return java.lang.reflect.InvocationHandler.invokeDefault(proxy, method, args);
    }
  }

  static Object fail(org.mockito.invocation.InvocationOnMock i) {
    throw BridgeFailure.unsupported(
        i.getMethod().getDeclaringClass().getSimpleName() + "." + i.getMethod().getName());
  }

  JsonElement required(String key) {
    if (!state.has(key)) throw new BridgeFailure("MISSING_STATE", key, "Snapshot requires " + key);
    return state.get(key);
  }

  int number(String key) {
    return required(key).getAsInt();
  }

  /**
   * RuneLite's Client.macroExpand, which WidgetTextRequirement runs over every widget it reads.
   * Only %USERNAME% is meaningful here; anything else is left as written rather than blanked.
   */
  String macroExpand(String text) {
    if (text == null) return null;
    JsonObject local = state.has("localPlayer") ? state.getAsJsonObject("localPlayer") : null;
    String name = local != null && local.has("name") && !local.get("name").isJsonNull()
        ? local.get("name").getAsString()
        : "";
    return text.replace("%USERNAME%", name);
  }

  JsonArray array(String key) {
    return required(key).getAsJsonArray();
  }

  Object geometry(String key, Class<?> type) {
    if (!state.has("geometry")) throw BridgeFailure.missing("geometry", 0);
    JsonObject g = state.getAsJsonObject("geometry");
    if (g.has(key)) return new Gson().fromJson(g.get(key), type);
    if (g.has(key + "Packed") && (key.equals("tileHeights") || key.equals("tileSettings"))) {
      JsonObject p = g.getAsJsonObject(key + "Packed");
      boolean heights = key.equals("tileHeights");
      int size = heights ? 105 : 104;
      String encoding = p.get("encoding").getAsString();
      if (!encoding.equals(heights ? "int16-le-base64" : "uint8-base64"))
        throw new BridgeFailure("INVALID_STATE", "geometry", "Invalid packed encoding");
      JsonArray shape = p.getAsJsonArray("shape");
      if (shape.size() != 3
          || shape.get(0).getAsInt() != 4
          || shape.get(1).getAsInt() != size
          || shape.get(2).getAsInt() != size)
        throw new BridgeFailure("INVALID_STATE", "geometry", "Invalid packed shape");
      byte[] raw = Base64.getDecoder().decode(p.get("data").getAsString());
      if (raw.length != 4 * size * size * (heights ? 2 : 1))
        throw new BridgeFailure("INVALID_STATE", "geometry", "Invalid packed byte count");
      if (heights) {
        int[][][] values = new int[4][size][size];
        int multiplier = p.get("multiplier").getAsInt();
        if (multiplier != -8)
          throw new BridgeFailure("INVALID_STATE", "geometry", "Invalid height multiplier");
        java.nio.ByteBuffer buffer =
            java.nio.ByteBuffer.wrap(raw).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        for (int plane = 0; plane < 4; plane++)
          for (int x = 0; x < size; x++)
            for (int y = 0; y < size; y++) values[plane][x][y] = buffer.getShort() * multiplier;
        return values;
      }
      byte[][][] values = new byte[4][size][size];
      int n = 0;
      for (int plane = 0; plane < 4; plane++)
        for (int x = 0; x < size; x++)
          for (int y = 0; y < size; y++) values[plane][x][y] = raw[n++];
      return values;
    }
    throw BridgeFailure.missing("geometry", 0);
  }

  int sparse(String key, int id) {
    JsonObject map = required(key).getAsJsonObject();
    return map.has("" + id) ? map.get("" + id).getAsInt() : 0;
  }

  int[] varps() {
    int[] v = new int[10000];
    for (var e : required("varps").getAsJsonObject().entrySet()) {
      int n = Integer.parseInt(e.getKey());
      if (n >= 0 && n < v.length) v[n] = e.getValue().getAsInt();
    }
    return v;
  }

  int varbit(int id) {
    JsonObject v = required("varbits").getAsJsonObject();
    if (v.has("" + id)) return v.get("" + id).getAsInt();
    if (state.has("varbitDefinitions") && state.getAsJsonObject("varbitDefinitions").has("" + id)) {
      var d = state.getAsJsonObject("varbitDefinitions").getAsJsonObject("" + id);
      int l = d.get("lsb").getAsInt(), r = d.get("msb").getAsInt();
      return (sparse("varps", d.get("varp").getAsInt()) >>> l) & (-1 >>> (31 - (r - l)));
    }
    throw BridgeFailure.missing("varbit", id);
  }

  VarbitComposition varbitDefinition(int id) {
    if (!state.has("varbitDefinitions") || !state.getAsJsonObject("varbitDefinitions").has("" + id))
      throw BridgeFailure.missing("varbitDefinition", id);
    JsonObject d = state.getAsJsonObject("varbitDefinitions").getAsJsonObject("" + id);
    return strict(
        VarbitComposition.class,
        i ->
            switch (i.getMethod().getName()) {
              case "getIndex" -> d.get("varp").getAsInt();
              case "getLeastSignificantBit" -> d.get("lsb").getAsInt();
              case "getMostSignificantBit" -> d.get("msb").getAsInt();
              default -> fail(i);
            });
  }

  int skill(Object s, String field) {
    JsonObject sk = required("skills").getAsJsonObject();
    String key = s.toString().toUpperCase();
    if (!sk.has(key))
      throw new BridgeFailure("MISSING_STATE", "skill", "Snapshot requires skill " + key);
    return sk.getAsJsonObject(key).get(field).getAsInt();
  }

  Item[] items(String key) {
    JsonArray a = array(key);
    int capacity = key.equals("inventory") ? 28 : key.equals("equipment") ? 14 : 0;
    for (int n = 0; n < a.size(); n++) {
      JsonObject item = a.get(n).getAsJsonObject();
      int slot = item.has("slot") ? item.get("slot").getAsInt() : n;
      if (slot < 0 || slot >= 10000)
        throw new BridgeFailure("INVALID_STATE", "container.slot", "Invalid container slot");
      capacity = Math.max(capacity, slot + 1);
    }
    Item[] items = new Item[capacity];
    Arrays.fill(items, new Item(-1, 0));
    Set<Integer> occupied = new HashSet<>();
    for (int n = 0; n < a.size(); n++) {
      JsonObject j = a.get(n).getAsJsonObject();
      int slot = j.has("slot") ? j.get("slot").getAsInt() : n;
      if (!occupied.add(slot))
        throw new BridgeFailure("INVALID_STATE", "container.slot", "Duplicate container slot");
      items[slot] = new Item(j.get("id").getAsInt(), j.get("quantity").getAsInt());
    }
    return items;
  }

  ItemContainer container(int id) {
    String key =
        switch (id) {
          case 93 -> "inventory";
          case 94 -> "equipment";
          case 95 -> "bank";
          default -> throw BridgeFailure.missing("container", id);
        };
    if (!state.has(key)) throw BridgeFailure.missing("container", id);
    return strict(
        ItemContainer.class,
        i ->
            switch (i.getMethod().getName()) {
              case "getItems" -> items(key);
              case "getId" -> id;
              case "count" ->
                  i.getArguments().length == 0
                      ? (int)
                          Arrays.stream(items(key))
                              .filter(it -> it.getId() >= 0 && it.getQuantity() > 0)
                              .count()
                      : Arrays.stream(items(key))
                          .filter(
                              it ->
                                  it.getId() >= 0
                                      && it.getId() == ((Number) i.getArgument(0)).intValue())
                          .mapToInt(Item::getQuantity)
                          .sum();
              case "size" -> items(key).length;
              case "find" -> {
                Item[] all = items(key);
                int idToFind = ((Number) i.getArgument(0)).intValue(), found = -1;
                for (int slot = 0; slot < all.length; slot++)
                  if (idToFind >= 0 && all[slot].getId() == idToFind) {
                    found = slot;
                    break;
                  }
                yield found;
              }
              case "contains" ->
                  Arrays.stream(items(key))
                      .anyMatch(it -> it.getId() == ((Number) i.getArgument(0)).intValue());
              case "getItem" -> {
                int idx = ((Number) i.getArgument(0)).intValue();
                Item[] it = items(key);
                yield idx >= 0 && idx < it.length && it[idx].getId() >= 0 ? it[idx] : null;
              }
              default -> fail(i);
            });
  }

  Object actorValue(org.mockito.invocation.InvocationOnMock i, JsonObject d) {
    String m = i.getMethod().getName();
    return switch (m) {
      case "getWorldLocation" -> wp(d);
      case "getLocalLocation" ->
          new LocalPoint(
              (d.get("x").getAsInt() - number("baseX")) * 128 + 64,
              (d.get("y").getAsInt() - number("baseY")) * 128 + 64,
              world);
      case "getWorldView" -> world;
      case "getName" -> d.has("name") ? d.get("name").getAsString() : null;
      case "getId" -> d.get("id").getAsInt();
      case "getIndex" -> d.get("index").getAsInt();
      case "getComposition", "getTransformedComposition" ->
          strict(
              NPCComposition.class,
              n ->
                  switch (n.getMethod().getName()) {
                    case "getId" ->
                        d.has("transformedId")
                            ? d.get("transformedId").getAsInt()
                            : d.get("id").getAsInt();
                    case "getName" -> d.get("name").getAsString();
                    default -> fail(n);
                  });
      case "getAnimation",
          "getPoseAnimation",
          "getOrientation",
          "getCombatLevel",
          "getGraphic",
          "getHealthRatio",
          "getHealthScale" -> {
        String k = Character.toLowerCase(m.charAt(3)) + m.substring(4);
        if (!d.has(k)) throw new BridgeFailure("MISSING_STATE", m, "Actor requires " + k);
        yield d.get(k).getAsInt();
      }
      case "getPlayerComposition" ->
          strict(
              PlayerComposition.class,
              n ->
                  switch (n.getMethod().getName()) {
                    case "getGender" -> {
                      if (!d.has("gender"))
                        throw new BridgeFailure(
                            "MISSING_STATE", "gender", "Player requires gender");
                      yield d.get("gender").getAsInt();
                    }
                    default -> fail(n);
                  });
      case "getInteracting" -> {
        if (!d.has("interactingIndex")) yield null;
        yield interactionTarget(d.get("interactingIndex").getAsInt());
      }
      default -> fail(i);
    };
  }

  Actor interactionTarget(int encoded) {
    if (encoded == -1) return null;
    if (encoded < 0)
      throw new BridgeFailure("INVALID_STATE", "interactingIndex", "Invalid encoded actor index");
    if (encoded < 65536) {
      NPC target = npcIdentities.get(encoded);
      if (target == null)
        throw new BridgeFailure(
            "MISSING_STATE",
            "interactingIndex",
            "Snapshot requires NPC interaction target " + encoded);
      return target;
    }
    int index = encoded - 65536;
    JsonObject local = required("localPlayer").getAsJsonObject();
    if (local.has("index") && local.get("index").getAsInt() == index) return player;
    throw new BridgeFailure(
        "MISSING_STATE",
        "interactingIndex",
        "Snapshot requires player interaction target " + index);
  }

  WorldPoint wp(JsonObject d) {
    return new WorldPoint(d.get("x").getAsInt(), d.get("y").getAsInt(), d.get("plane").getAsInt());
  }

  Object npcSet(Class<?> type) {
    return strict(
        type,
        i ->
            switch (i.getMethod().getName()) {
              case "iterator" -> new ArrayList<>(npcIdentities.values()).iterator();
              case "stream" -> npcIdentities.values().stream();
              case "byIndex" -> npcIdentities.get(((Number) i.getArgument(0)).intValue());
              default -> fail(i);
            });
  }

  NPC npcForEvent(JsonObject event) {
    JsonObject data =
        event.has("npc") && !event.get("npc").isJsonNull() ? event.getAsJsonObject("npc") : null;
    if (data == null && !event.has("index") && event.has("ecsIndex")) {
      int ecs = event.get("ecsIndex").getAsInt();
      for (var actor : npcIdentities.entrySet()) {
        JsonObject d = npcData.get(actor.getKey());
        if (d.has("ecsIndex") && d.get("ecsIndex").getAsInt() == ecs) return actor.getValue();
      }
      NPC old = previousNpcsByEcs.get(ecs);
      if (old != null) return old;
      throw new BridgeFailure(
          "MISSING_STATE",
          "eventNpc",
          "NPC callback requires prior/full actor state for ECS index " + ecs);
    }
    int index = data != null ? data.get("index").getAsInt() : event.get("index").getAsInt();
    NPC npc = npcIdentities.get(index);
    if (npc != null) return npc;
    if (data == null) {
      npc = previousNpcs.get(index);
      if (npc != null) return npc;
      JsonObject old = previousNpcData.get(index);
      if (old != null) return strict(NPC.class, i -> actorValue(i, old));
      throw new BridgeFailure(
          "MISSING_STATE",
          "eventNpc",
          "NPC event requires prior/full actor state for index " + index);
    }
    return strict(NPC.class, i -> actorValue(i, data));
  }

  Object emptyEntitySet(Class<?> type) {
    return strict(
        type,
        i ->
            switch (i.getMethod().getName()) {
              case "iterator" -> Collections.emptyIterator();
              case "stream" -> Stream.empty();
              default -> fail(i);
            });
  }

  <T> T definition(Class<T> type, String group, int id) {
    if (!state.has(group) || !state.getAsJsonObject(group).has("" + id)) {
      Set<Integer> missing = new LinkedHashSet<>();
      missing.add(id);
      String source =
          group.equals("objectDefinitions")
              ? "objects"
              : group.equals("npcDefinitions") ? "npcs" : "inventory";
      if (state.has(source))
        for (var e : state.getAsJsonArray(source)) {
          int candidate = e.getAsJsonObject().get("id").getAsInt();
          if (candidate >= 0
              && (!state.has(group) || !state.getAsJsonObject(group).has("" + candidate)))
            missing.add(candidate);
          if (missing.size() >= 512) break;
        }
      throw BridgeFailure.missingMany(group, missing);
    }
    return definitionView(type, group, id, state.getAsJsonObject(group).getAsJsonObject("" + id));
  }

  <T> T definitionView(Class<T> type, String group, int id, JsonObject d) {
    return strict(
        type,
        i -> {
          String m = i.getMethod().getName();
          if (!m.startsWith("get") && !m.startsWith("is"))
            throw BridgeFailure.unsupported(type.getSimpleName() + "." + m);
          String k =
              m.startsWith("get")
                  ? Character.toLowerCase(m.charAt(3)) + m.substring(4)
                  : Character.toLowerCase(m.charAt(2)) + m.substring(3);
          if (m.equals("getId")) return d.has("id") ? d.get("id").getAsInt() : id;
          if (!Set.of(
                  "name",
                  "note",
                  "linkedNoteId",
                  "placeholderId",
                  "placeholderTemplateId",
                  "stackable",
                  "members",
                  "price",
                  "inventoryActions",
                  "groundActions",
                  "tradeable",
                  "weight",
                  "sizeX",
                  "sizeY",
                  "impostorIds",
                  "impostor",
                  "actions",
                  "animationId",
                  "mapSceneId",
                  "mapIconId",
                  "size",
                  "combatLevel",
                  "configs",
                  "transformedId",
                  "transformedComposition",
                  "interactible",
                  "clickable",
                  "follower",
                  "params",
                  "overheadIcon",
                  "widthScale",
                  "heightScale")
              .contains(k)) throw BridgeFailure.unsupported(type.getSimpleName() + "." + m);
          String key =
              d.has(k)
                  ? k
                  : d.has("is" + Character.toUpperCase(k.charAt(0)) + k.substring(1))
                      ? "is" + Character.toUpperCase(k.charAt(0)) + k.substring(1)
                      : k;
          if (!d.has(key)) throw BridgeFailure.missing(group + "." + k, id);
          JsonElement value = d.get(key);
          if (value.isJsonNull()) return null;
          if (k.equals("impostor") || k.equals("transformedComposition")) {
            JsonObject nested = value.getAsJsonObject();
            return definitionView(
                type, group, nested.has("id") ? nested.get("id").getAsInt() : id, nested);
          }
          return new Gson().fromJson(value, i.getMethod().getGenericReturnType());
        });
  }

  void runScript(Object[] args) {
    if (args.length == 1 && args[0] instanceof Object[] flattened) args = flattened;
    int id = ((Number) args[0]).intValue();
    Object[] a =
        args.length == 2 && args[1] instanceof Object[] array
            ? array
            : Arrays.copyOfRange(args, 1, args.length);
    if (id != 4029) throw BridgeFailure.unsupported("Client.runScript(" + id + ")");
    int q = ((Number) a[0]).intValue();
    if (!state.has("questStates") || !state.getAsJsonObject("questStates").has("" + q))
      throw BridgeFailure.missing("questState", q);
    String s = state.getAsJsonObject("questStates").get("" + q).getAsString();
    scriptStack[0] = s.equals("FINISHED") ? 2 : s.equals("NOT_STARTED") ? 1 : 0;
  }

  Widget addWidget(JsonObject d) {
    if (d == null) return null;
    int id = d.get("id").getAsInt();
    Widget w =
        strict(
            Widget.class,
            i -> {
              String m = i.getMethod().getName();
              return switch (m) {
                case "getId" -> id;
                case "getText" -> d.has("text") ? d.get("text").getAsString() : "";
                case "isHidden", "isSelfHidden" ->
                    d.has("hidden") && d.get("hidden").getAsBoolean();
                case "getBounds" -> bounds(d, id);
                case "getCanvasLocation" -> {
                  Rectangle b = bounds(d, id);
                  yield new Point(b.x, b.y);
                }
                case "getWidth" -> bounds(d, id).width;
                case "getHeight" -> bounds(d, id).height;
                case "getChild" -> {
                  int index = ((Number) i.getArgument(0)).intValue();
                  Widget[] children =
                      widgetChildren(d, d.has("dynamicChildren") ? "dynamicChildren" : "children");
                  yield index >= 0 && index < children.length ? children[index] : null;
                }
                case "getChildren", "getDynamicChildren" ->
                    widgetChildren(d, d.has("dynamicChildren") ? "dynamicChildren" : "children");
                case "getStaticChildren" ->
                    widgetChildren(d, d.has("staticChildren") ? "staticChildren" : "children");
                case "getNestedChildren" ->
                    widgetChildren(d, d.has("nestedChildren") ? "nestedChildren" : "children");
                default -> {
                  if (!m.startsWith("get") && !m.startsWith("is"))
                    throw BridgeFailure.unsupported("Widget." + m);
                  String k =
                      m.startsWith("get")
                          ? Character.toLowerCase(m.charAt(3)) + m.substring(4)
                          : Character.toLowerCase(m.charAt(2)) + m.substring(3);
                  if (!Set.of(
                          "name",
                          "itemId",
                          "itemQuantity",
                          "modelId",
                          "spriteId",
                          "type",
                          "index",
                          "parentId",
                          "originalX",
                          "originalY",
                          "originalWidth",
                          "originalHeight",
                          "animationId",
                          "textColor",
                          "opacity",
                          "relativeX",
                          "relativeY",
                          "scrollX",
                          "scrollY",
                          "scrollHeight",
                          "scrollWidth",
                          "fontId",
                          "borderType",
                          "rotationX",
                          "rotationY",
                          "rotationZ",
                          "modelType",
                          "modelZoom",
                          "modelRotationX",
                          "modelRotationY",
                          "modelRotationZ",
                          "spriteTiling",
                          "spriteFlipV",
                          "spriteFlipH")
                      .contains(k)) throw BridgeFailure.unsupported("Widget." + m);
                  if (!d.has(k)) throw BridgeFailure.missing("widget." + k, id);
                  yield new Gson().fromJson(d.get(k), i.getMethod().getGenericReturnType());
                }
              };
            });
    widgets.putIfAbsent(id, w);
    return w;
  }

  void indexWidgetTree(JsonObject widget, Set<JsonObject> indexed) {
    if (!indexed.add(widget)) return;
    addWidget(widget);
    for (String key : List.of("children", "staticChildren", "dynamicChildren", "nestedChildren"))
      if (widget.has(key) && !widget.get(key).isJsonNull())
        for (var child : widget.getAsJsonArray(key))
          if (!child.isJsonNull()) indexWidgetTree(child.getAsJsonObject(), indexed);
  }

  Rectangle bounds(JsonObject d, int id) {
    JsonObject b = d.getAsJsonObject("bounds");
    if (b == null) throw BridgeFailure.missing("widgetBounds", id);
    return new Rectangle(
        b.get("x").getAsInt(),
        b.get("y").getAsInt(),
        b.get("width").getAsInt(),
        b.get("height").getAsInt());
  }

  Widget[] widgetChildren(JsonObject d, String key) {
    if (!d.has(key)) return new Widget[0];
    JsonArray children = d.getAsJsonArray(key);
    int length = children.size();
    for (var e : children)
      if (!e.isJsonNull()
          && e.getAsJsonObject().has("index")
          && (key.equals("children") || key.equals("dynamicChildren")))
        length = Math.max(length, e.getAsJsonObject().get("index").getAsInt() + 1);
    if (length > 12000)
      throw new BridgeFailure("LIMIT", "widgetChildren", "Widget child index exceeds bound");
    Widget[] result = new Widget[length];
    for (int n = 0; n < children.size(); n++) {
      var e = children.get(n);
      if (e.isJsonNull()) continue;
      JsonObject child = e.getAsJsonObject();
      int index =
          child.has("index")
                  && child.get("index").getAsInt() >= 0
                  && (key.equals("children") || key.equals("dynamicChildren"))
              ? child.get("index").getAsInt()
              : n;
      if (index < 0 || index >= length)
        throw new BridgeFailure("INVALID_STATE", "widgetChildren", "Invalid child index");
      result[index] = addWidget(child);
    }
    return result;
  }

  String tileKey(JsonObject d) {
    return d.get("x") + "," + d.get("y") + "," + d.get("plane");
  }

  Tile tile(JsonObject d) {
    int x = d.get("x").getAsInt() - number("baseX"),
        y = d.get("y").getAsInt() - number("baseY"),
        p = d.get("plane").getAsInt();
    if (x < 0 || y < 0 || x >= 104 || y >= 104) return null;
    if (p < 0 || p > 3) throw new BridgeFailure("INVALID_STATE", "plane", "Invalid plane");
    if (tiles[p][x][y] == null)
      tiles[p][x][y] =
          strict(
              Tile.class,
              i ->
                  switch (i.getMethod().getName()) {
                    case "getWorldLocation" -> wp(d);
                    case "getLocalLocation" -> new LocalPoint(x * 128 + 64, y * 128 + 64, world);
                    case "getSceneLocation" -> new Point(x, y);
                    case "getPlane" -> p;
                    case "getGameObjects" ->
                        tileObjects.getOrDefault(tileKey(d), List.of()).stream()
                            .filter(GameObject.class::isInstance)
                            .toArray(GameObject[]::new);
                    case "getDecorativeObject" ->
                        tileObjects.getOrDefault(tileKey(d), List.of()).stream()
                            .filter(DecorativeObject.class::isInstance)
                            .findFirst()
                            .orElse(null);
                    case "getGroundObject" ->
                        tileObjects.getOrDefault(tileKey(d), List.of()).stream()
                            .filter(GroundObject.class::isInstance)
                            .findFirst()
                            .orElse(null);
                    case "getWallObject" ->
                        tileObjects.getOrDefault(tileKey(d), List.of()).stream()
                            .filter(WallObject.class::isInstance)
                            .findFirst()
                            .orElse(null);
                    case "getGroundItems" -> groundItems.getOrDefault(tileKey(d), List.of());
                    default -> fail(i);
                  });
    return tiles[p][x][y];
  }

  void addTileObject(JsonObject d) {
    tile(d);
    String type = d.has("type") ? d.get("type").getAsString() : "game";
    if (type.matches("[0-9]+")) {
      int shape = Integer.parseInt(type);
      type = shape <= 3 ? "wall" : shape <= 8 ? "decorative" : shape == 22 ? "ground" : "game";
    }
    Class<? extends TileObject> cls =
        switch (type) {
          case "wall" -> WallObject.class;
          case "ground", "floor" -> GroundObject.class;
          case "decorative", "wallDecoration" -> DecorativeObject.class;
          case "game" -> GameObject.class;
          default -> throw BridgeFailure.unsupported("object type " + type);
        };
    String stableKey =
        cls.getName()
            + ":"
            + d.get("id")
            + ":"
            + tileKey(d)
            + ":"
            + Objects.toString(d.get("type"), "game")
            + ":"
            + Objects.toString(d.get("orientation"), "unknown")
            + ":"
            + Objects.toString(d.get("shape"), "unknown");
    TileObject o = previousStableObjects.get(stableKey);
    if (o == null)
      o =
          strict(
              cls,
              i ->
                  switch (i.getMethod().getName()) {
                    case "getId" -> d.get("id").getAsInt();
                    case "getWorldLocation" -> wp(d);
                    case "getLocalLocation" ->
                        new LocalPoint(
                            (d.get("x").getAsInt() - number("baseX")) * 128 + 64,
                            (d.get("y").getAsInt() - number("baseY")) * 128 + 64,
                            world);
                    case "getPlane" -> d.get("plane").getAsInt();
                    case "getWorldView" -> world;
                    case "getSceneMinLocation", "getSceneMaxLocation" ->
                        new Point(
                            d.get("x").getAsInt() - number("baseX"),
                            d.get("y").getAsInt() - number("baseY"));
                    case "getShape", "getOrientation" -> {
                      String k = i.getMethod().getName().substring(3).toLowerCase();
                      if (!d.has(k))
                        throw new BridgeFailure("MISSING_STATE", k, "Object requires " + k);
                      yield d.get(k).getAsInt();
                    }
                    default -> fail(i);
                  });
    stableObjects.put(stableKey, o);
    tileObjects.computeIfAbsent(tileKey(d), k -> new ArrayList<>()).add(o);
  }
}
