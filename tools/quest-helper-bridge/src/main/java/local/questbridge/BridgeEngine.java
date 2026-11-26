package local.questbridge;

import com.google.gson.*;
import com.questhelper.managers.QuestContainerManager;
import com.questhelper.questhelpers.*;
import com.questhelper.questinfo.QuestHelperQuest;
import com.questhelper.requirements.*;
import com.questhelper.requirements.item.ItemRequirement;
import com.questhelper.steps.*;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import net.runelite.api.events.*;

/**
 * Atomic evaluations serialize access to upstream static container caches. Helper instances are
 * session-owned.
 */
public final class BridgeEngine implements AutoCloseable {
  public static final String SOURCE = "06da90f982518a093f2fe1c9cfac5547fa7053d3";
  static final Gson GSON = new Gson();
  static final int DEFAULT_MAX_SESSIONS = 128;
  static final long DEFAULT_IDLE_MS = 30 * 60 * 1000L;
  final Map<String, Session> sessions = new HashMap<>();
  final JsonArray routes;
  final int maxSessions;
  /** Open sessions one caller may hold (0: no quota), so one caller can't take every slot. */
  int maxSessionsPerCaller;
  final long idleMs;
  final java.util.function.LongSupplier clock;

  public BridgeEngine() {
    this(DEFAULT_MAX_SESSIONS, DEFAULT_IDLE_MS, System::currentTimeMillis);
  }

  /**
   * A world that goes away without {@code /close} (a closed browser tab, a killed server) leaves
   * its sessions behind; they are stopped once idle for {@code idleMs}, so a bridge shared by many
   * worlds doesn't fill up.
   */
  public BridgeEngine(int maxSessions, long idleMs, java.util.function.LongSupplier clock) {
    if (maxSessions < 1 || idleMs < 1) throw new IllegalArgumentException("Invalid session limits");
    this.maxSessions = maxSessions;
    this.idleMs = idleMs;
    this.clock = clock;
    try (var in = BridgeEngine.class.getResourceAsStream("/catalog.json")) {
      routes =
          JsonParser.parseReader(
                  new InputStreamReader(
                      Objects.requireNonNull(in), java.nio.charset.StandardCharsets.UTF_8))
              .getAsJsonArray();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  public JsonObject catalog() {
    JsonObject o = new JsonObject();
    o.addProperty("protocol", 1);
    o.addProperty("sourceCommit", SOURCE);
    JsonArray quests = routes.deepCopy();
    for (var e : quests) {
      var q = e.getAsJsonObject();
      q.addProperty(
          "name",
          q.get("native").getAsBoolean() ? "Tutorial Island" : q.get("sourceKey").getAsString());
      q.addProperty("supported", true);
      if (q.getAsJsonArray("variants").size() > 0) {
        var v = q.getAsJsonArray("variants").get(0).getAsJsonObject();
        var info = QuestHelperQuest.valueOf(v.get("helperVariant").getAsString());
        metadata(q, info);
        PresentationExport.catalogMetadata(q, info);
        q.add("helperClass", v.get("helperClass"));
        q.add("helperVariant", v.get("helperVariant"));
        for (var variant : q.getAsJsonArray("variants")) {
          var vv = variant.getAsJsonObject();
          var variantInfo = QuestHelperQuest.valueOf(vv.get("helperVariant").getAsString());
          metadata(vv, variantInfo);
          PresentationExport.catalogMetadata(vv, variantInfo);
        }
      }
    }
    o.add("quests", quests);
    o.add("diagnostics", new JsonArray());
    return o;
  }

  static void metadata(JsonObject row, QuestHelperQuest info) {
    row.addProperty("name", info.getName());
    row.addProperty("questId", info.getId());
    Object varbit = field(info, "varbit"), varp = field(info, "varPlayer");
    if (varbit != null)
      row.addProperty("varbitId", ((com.questhelper.questinfo.QuestVarbits) varbit).getId());
    if (varp != null)
      row.addProperty("varpId", ((com.questhelper.questinfo.QuestVarPlayer) varp).getId());
  }

  JsonObject route(String key) {
    for (JsonElement e : routes)
      if (e.getAsJsonObject().get("questKey").getAsString().equals(key)
          || e.getAsJsonObject().get("sourceKey").getAsString().equals(key))
        return e.getAsJsonObject();
    throw new BridgeFailure("UNKNOWN_QUEST", "questKey", "Unknown quest " + key);
  }

  public JsonObject evaluate(JsonObject req) {
    return evaluate(req, "");
  }

  /** {@code caller} is the address the request came from, for the per-caller session quota. */
  public synchronized JsonObject evaluate(JsonObject req, String caller) {
    JsonObject result = new JsonObject();
    Session current = null;
    result.addProperty("protocol", 1);
    result.addProperty("sourceCommit", SOURCE);
    for (String k : List.of("session", "sequence", "questKey"))
      if (req.has(k)) result.add(k, req.get(k));
    result.add("activeStep", JsonNull.INSTANCE);
    result.add("panels", new JsonArray());
    result.add("diagnostics", new JsonArray());
    result.add("requests", new JsonArray());
    try {
      if (!req.has("protocol") || req.get("protocol").getAsInt() != 1)
        throw new BridgeFailure("PROTOCOL", "protocol", "Expected protocol 1");
      String id = req.get("session").getAsString(), key = req.get("questKey").getAsString();
      long seq = req.get("sequence").getAsLong();
      long now = clock.getAsLong();
      expireIdle(now);
      if (id.length() > 160 || sessions.size() >= maxSessions && !sessions.containsKey(id))
        throw new BridgeFailure("LIMIT", "session", "Session limit exceeded");
      if (maxSessionsPerCaller > 0 && !sessions.containsKey(id)) {
        int held = 0;
        for (Session other : sessions.values()) if (other.caller.equals(caller)) held++;
        if (held >= maxSessionsPerCaller)
          throw new BridgeFailure("LIMIT", "session", "Session limit exceeded for this caller");
      }
      Session s = sessions.get(id);
      if (s != null && seq <= s.sequence)
        throw new BridgeFailure("STALE_SEQUENCE", "sequence", "Sequence must increase");
      JsonObject route = route(key);
      String variant =
          req.has("helperVariant")
              ? req.get("helperVariant").getAsString()
              : route.getAsJsonArray("variants").isEmpty()
                  ? ""
                  : route
                      .getAsJsonArray("variants")
                      .get(0)
                      .getAsJsonObject()
                      .get("helperVariant")
                      .getAsString();
      if (!variant.isEmpty()) {
        boolean allowed = false;
        for (var v : route.getAsJsonArray("variants"))
          if (v.getAsJsonObject().get("helperVariant").getAsString().equals(variant))
            allowed = true;
        if (!allowed)
          throw new BridgeFailure(
              "INVALID_VARIANT", "helperVariant", "Variant does not belong to selected quest");
      }
      JsonObject snapshot = req.getAsJsonObject("snapshot");
      if (s == null || !s.key.equals(key) || !s.variant.equals(variant)) {
        if (s != null) s.stop();
        s = new Session(key, variant, snapshot);
        s.caller = caller;
        sessions.put(id, s);
      } else s.snapshot.update(snapshot);
      s.sequence = seq;
      s.lastUsed = now;
      current = s;
      s.services.applyClientConfig(
          req.has("config") && req.get("config").isJsonObject()
              ? req.getAsJsonObject("config")
              : null);
      s.containers();
      try (var projection = new SnapshotProjection(s.snapshot)) {
        if (!s.started) {
          s.snapshot.deltaEvents.clear();
          s.start();
          s.started = true;
        }
        s.updateQuest();
        s.syncShortestPath();
        if (req.has("lockSection") && req.get("lockSection").isJsonObject()) s.lock(req.getAsJsonObject("lockSection"));
        for (Object event : s.snapshot.deltaEvents) s.services.bus.post(event);
        s.snapshot.deltaEvents.clear();
        s.services.flush();
        s.replayHistory();
        boolean actualTick = false;
        if (req.has("events"))
          for (JsonElement event : req.getAsJsonArray("events")) {
            JsonObject dto = event.getAsJsonObject();
            if (dto.get("type").getAsString().equals("gameTick")) actualTick = true;
            s.event(dto);
          }
        if (!actualTick) s.services.bus.post(new GameTick());
        s.services.flush();
        QuestStep step = s.helper.getCurrentStep();
        if (step != null) {
          step = step.getActiveStep();
          if (step instanceof ConditionalStep && !(Boolean) field(step, "started"))
            throw new BridgeFailure(
                "INCOMPLETE_LIFECYCLE",
                "ConditionalStep.startUp",
                "Conditional step has not completed startup");
          result.add("activeStep", s.export(step));
        }
        JsonArray panels = new JsonArray();
        for (var panel : s.helper.getPanels()) {
          JsonObject p = new JsonObject();
          p.addProperty("title", panel.getHeader());
          JsonArray text = new JsonArray();
          for (var ps : panel.getSteps())
            if (ps.getText() != null) for (String t : ps.getText()) text.add(t);
          p.add("text", text);
          panels.add(p);
        }
        result.add("panels", panels);
        JsonArray presentation = new JsonArray();
        final Session cur = s;
        QuestStep shown = step;
        var client = cur.snapshot.client;
        var config = cur.services.config;
        PresentationExport.part(
            result,
            "overview",
            presentation,
            () -> PresentationExport.overview(cur.helper, client, config, presentation));
        PresentationExport.part(
            result,
            "sections",
            presentation,
            () -> {
              cur.sectionIndex.clear();
              return PresentationExport.sections(
                  cur.helper.getPanels(), shown, cur.helper.getVar(), client, config, cur.sectionIndex);
            });
        if (cur.helper.getCurrentStep() != null)
          PresentationExport.part(
              result,
              "overlayPanel",
              presentation,
              () ->
                  PresentationExport.overlayPanel(
                      cur.helper.getCurrentStep(), cur.helper.getQuestHelperPlugin()));
        if (req.has("bankTab") && req.get("bankTab").getAsBoolean())
          PresentationExport.part(result, "bankTab", presentation, cur::bankTab);
        result.getAsJsonArray("diagnostics").addAll(presentation);
        result.addProperty(
            "status",
            s.helper.isCompleted() ? "complete" : step != null ? "active" : "unavailable");
      }
    } catch (Throwable error) {
      Throwable t = error;
      while ((t instanceof InvocationTargetException
              || t instanceof java.lang.reflect.UndeclaredThrowableException)
          && t.getCause() != null) t = t.getCause();
      BridgeFailure f =
          t instanceof BridgeFailure b
              ? b
              : new BridgeFailure(
                  "ENGINE_ERROR", t.getClass().getName(), String.valueOf(t.getMessage()));
      result.add("activeStep", JsonNull.INSTANCE);
      result.addProperty(
          "status", f.code.equals("UNSUPPORTED_API") ? "unsupported" : "unavailable");
      result.getAsJsonArray("diagnostics").add(f.diagnostic());
      if (f.request != null) result.getAsJsonArray("requests").add(f.request);
      result.getAsJsonArray("requests").addAll(f.requests);
      if (!(t instanceof BridgeFailure)) t.printStackTrace();
    }
    result.add("pluginMessages", current == null ? new JsonArray() : current.drainPluginMessages());
    return result;
  }

  /** Stops and drops every session nobody has evaluated for {@code idleMs}. */
  synchronized int expireIdle(long now) {
    int expired = 0;
    for (var it = sessions.values().iterator(); it.hasNext(); ) {
      Session s = it.next();
      if (now - s.lastUsed < idleMs) continue;
      it.remove();
      s.stop();
      expired++;
    }
    return expired;
  }

  public synchronized boolean closeSession(String session) {
    Session s = sessions.remove(session);
    if (s == null) return false;
    s.stop();
    return true;
  }

  @Override
  public synchronized void close() {
    for (Session s : sessions.values()) s.stop();
    sessions.clear();
  }

  final class Session {
    final String key, variant;
    final SnapshotClient snapshot;
    final HeadlessServices services;
    final QuestHelper helper;
    long sequence = -1;
    long lastUsed;
    String caller = "";
    boolean started;
    /** useShortestPath as the steps last saw it (QuestHelperPlugin.onConfigChanged's toggle). */
    boolean shortestPath;
    final Set<String> history = new HashSet<>();
    final List<com.questhelper.panel.PanelDetails> sectionIndex = new ArrayList<>();

    /** QuestStepPanel.lockSection: the sidebar's "mark section as complete" toggle. */
    void lock(JsonObject request) {
      int index = request.get("section").getAsInt();
      if (index < 0 || index >= sectionIndex.size())
        throw new BridgeFailure("INVALID_SECTION", "lockSection", "Unknown section " + index);
      QuestStep locking = sectionIndex.get(index).getLockingQuestSteps();
      if (locking == null)
        throw new BridgeFailure("INVALID_SECTION", "lockSection", "Section is not lockable");
      locking.setLockedManually(request.get("locked").getAsBoolean());
    }

    Session(String key, String variant, JsonObject state) throws ReflectiveOperationException {
      this.key = key;
      this.variant = variant;
      snapshot = new SnapshotClient(state);
      services = new HeadlessServices(snapshot);
      if (variant.isEmpty())
        throw new BridgeFailure(
            "NATIVE_ROUTE", "questKey", "Tutorial Island is provided by the native client route");
      QuestHelperQuest info = QuestHelperQuest.valueOf(variant);
      helper = info.getQuestHelper().getClass().getDeclaredConstructor().newInstance();
      helper.setQuest(info);
      helper.setConfig(services.config);
      services.selectedQuest = helper;
      helper.setInjector(
          (com.google.inject.Injector) services.service(com.google.inject.Injector.class));
      helper.setQuestHelperPlugin(
          (com.questhelper.QuestHelperPlugin)
              services.service(com.questhelper.QuestHelperPlugin.class));
      services.inject(helper);
    }

    void containers() {
      int tick = snapshot.number("tick");
      for (var c : QuestContainerManager.getOrderedListOfContainers()) {
        c.setSpecialMethodToObtainItems(null);
        c.update(-1, new net.runelite.api.Item[0]);
      }
      QuestContainerManager.getInventoryData().update(tick, snapshot.items("inventory"));
      QuestContainerManager.getEquippedData().update(tick, snapshot.items("equipment"));
      if (snapshot.state.has("bank"))
        QuestContainerManager.getBankData().update(tick, snapshot.items("bank"));
    }

    void start() {
      // Rebuilt requirements need the authoritative dialogue history again.
      history.clear();
      try {
        shortestPath = services.config.useShortestPath();
        helper.init();
        helper.startUp(services.config);
        services.bus.register(helper);
        services.flush();
      } catch (RuntimeException error) {
        abortCurrentStep(error);
        services.bus.unregister(helper);
        throw error;
      }
    }

    /**
     * QuestHelperPlugin.onConfigChanged("useShortestPath"): QuestManager.activateShortestPath or
     * disableShortestPath on the current step's active step.
     */
    void syncShortestPath() {
      boolean use = services.config.useShortestPath();
      if (use == shortestPath) return;
      shortestPath = use;
      QuestStep step = helper.getCurrentStep();
      if (step == null) return;
      step = step.getActiveStep();
      if (use) step.setShortestPath();
      // DetailedQuestStep.disableShortestPath reads definedPoint without a null check.
      else if (!(step instanceof DetailedQuestStep d) || d.getDefinedPoint() != null)
        step.disableShortestPath();
      services.flush();
    }

    /** The "shortestpath" messages upstream posted since the last evaluation, as JSON. */
    JsonArray drainPluginMessages() {
      JsonArray out = new JsonArray();
      for (var message : services.pluginMessages) {
        JsonObject m = new JsonObject();
        m.addProperty("namespace", message.getNamespace());
        m.addProperty("name", message.getName());
        JsonObject data = new JsonObject();
        if (message.getData() != null)
          for (var e : message.getData().entrySet()) {
            if (e.getValue() instanceof net.runelite.api.coords.WorldPoint p) {
              JsonObject point = new JsonObject();
              point.addProperty("x", p.getX());
              point.addProperty("y", p.getY());
              point.addProperty("plane", p.getPlane());
              data.add(e.getKey(), point);
            } else data.add(e.getKey(), GSON.toJsonTree(e.getValue()));
          }
        m.add("data", data);
        out.add(m);
      }
      services.pluginMessages.clear();
      return out;
    }

    /**
     * QuestHelperPlugin.getPluginBankTagItemsForSections: upstream's QuestHelperBankTagService
     * sections (all items), and itemsToTag (the missing items) for the Grand Exchange search.
     */
    JsonObject bankTab() {
      var service = new com.questhelper.bank.banktab.QuestHelperBankTagService();
      services.inject(service);
      JsonArray sections = new JsonArray();
      for (var tab : service.getPluginBankTagItemsForSections(false)) {
        JsonObject t = new JsonObject();
        t.addProperty("name", tab.getName());
        t.add("items", bankTabItems(tab.getItems()));
        t.add("recommendedItems", bankTabItems(tab.getRecommendedItems()));
        sections.add(t);
      }
      JsonObject o = new JsonObject();
      o.add("sections", sections);
      List<Integer> missing = new ArrayList<>();
      for (var tab : service.getPluginBankTagItemsForSections(true))
        for (var item : tab.getItems())
          for (Integer id : item.getItemIDs()) if (id != null && !missing.contains(id)) missing.add(id);
      o.add("missingItems", GSON.toJsonTree(missing));
      return o;
    }

    JsonArray bankTabItems(List<com.questhelper.bank.banktab.BankTabItem> items) {
      JsonArray out = new JsonArray();
      for (var item : items) {
        JsonObject i = new JsonObject();
        i.addProperty("quantity", item.getQuantity());
        if (item.getText() != null) i.addProperty("text", item.getText());
        i.add("itemIds", GSON.toJsonTree(item.getItemIDs()));
        i.addProperty("displayId", item.getDisplayID());
        if (item.getDetails() != null) i.addProperty("details", item.getDetails());
        // QuestBankTab.makeBankText's tick or cross.
        i.addProperty("met", item.getItemRequirement().check(snapshot.client));
        out.add(i);
      }
      return out;
    }

    void updateQuest() {
      Object previousVar = helper instanceof BasicQuestHelper ? field(helper, "var") : null;
      try {
        helper.updateQuest();
      } catch (RuntimeException error) {
        if (helper instanceof BasicQuestHelper
            && !Objects.equals(previousVar, field(helper, "var"))) {
          // BasicQuestHelper stores its new var and current root BEFORE startup.
          // Roll back only this failed transition, retaining the helper instance
          // and its earlier custom solver/history state. Next snapshot retries.
          setField(helper, "var", previousVar);
          abortCurrentStep(error);
        }
        throw error;
      }
    }

    void abortCurrentStep(RuntimeException original) {
      QuestStep root = helper.getCurrentStep();
      Set<QuestStep> visited = Collections.newSetFromMap(new IdentityHashMap<>());
      Deque<QuestStep> pending = new ArrayDeque<>();
      if (root != null) pending.add(root);
      while (!pending.isEmpty()) {
        QuestStep step = pending.removeFirst();
        if (!visited.add(step)) continue;
        if (step instanceof OwnerStep owner && owner.getSteps() != null)
          for (QuestStep child : owner.getSteps()) if (child != null) pending.add(child);
        if (step.getSubsteps() != null)
          for (QuestStep child : step.getSubsteps()) if (child != null) pending.add(child);
      }
      try {
        if (root != null) root.shutDown();
      } catch (RuntimeException cleanup) {
        throw new BridgeFailure(
            "LIFECYCLE_RECOVERY_FAILED",
            root.getClass().getName(),
            "Failed step cleanup: " + cleanup + "; original failure: " + original);
      } finally {
        // ConditionalStep registers a child BEFORE calling child.startUp, and
        // records currentStep only afterwards. Unregister the entire reachable
        // subtree so an interrupted child cannot remain an orphan subscriber.
        for (QuestStep step : visited) services.bus.unregister(step);
        setField(helper, "currentStep", null);
        services.callbacks.clear();
        services.eventErrors.clear();
        history.clear();
      }
    }

    void replayHistory() {
      if (snapshot.state.has("dialogueHistory"))
        for (var line : snapshot.state.getAsJsonArray("dialogueHistory")) {
          String text = line.getAsString();
          if (history.add(text))
            services.bus.post(
                new ChatMessage(null, net.runelite.api.ChatMessageType.DIALOG, "", text, "", 0));
        }
    }

    void stop() {
      if (started) {
        helper.shutDown();
        services.bus.unregister(helper);
      }
      services.callbacks.clear();
    }

    void event(JsonObject e) {
      services.bus.post(ClientEvents.convert(snapshot, e));
      services.flush();
    }

    JsonObject export(QuestStep step) {
      JsonObject o = new JsonObject();
      o.addProperty(
          "id",
          step.getClass().getName()
              + ":"
              + Objects.toString(
                  step.getId(), Integer.toHexString(Objects.toString(step.getText()).hashCode())));
      o.add("text", GSON.toJsonTree(step.getText() == null ? List.of() : step.getText()));
      JsonArray targets = new JsonArray(), reqs = new JsonArray(), choices = new JsonArray();
      if (step instanceof DetailedQuestStep d) {
        JsonObject target = new JsonObject();
        String kind =
            step instanceof NpcStep
                ? "npc"
                : step instanceof ObjectStep
                    ? "object"
                    : step instanceof ItemStep ? "item" : "tile";
        target.addProperty("kind", kind);
        boolean hasTarget = false;
        if (d.getDefinedPoint() != null && d.getDefinedPoint().getWorldPoint() != null) {
          var point = d.getDefinedPoint().getWorldPoint();
          target.addProperty("x", point.getX());
          target.addProperty("y", point.getY());
          target.addProperty("plane", point.getPlane());
          hasTarget = true;
        }
        List<Integer> ids = new ArrayList<>();
        if (step instanceof NpcStep || step instanceof ObjectStep) {
          String main = step instanceof NpcStep ? "npcID" : "objectID",
              alternate = step instanceof NpcStep ? "alternateNpcIDs" : "alternateObjectIDs";
          int id = (Integer) field(step, main);
          if (id >= 0) {
            target.addProperty("id", id);
            ids.add(id);
          }
          for (Object value : (Collection<?>) field(step, alternate))
            if ((Integer) value >= 0 && !ids.contains((Integer) value)) ids.add((Integer) value);
          if (!ids.isEmpty()) hasTarget = true;
        }
        if (step instanceof ItemStep)
          for (Requirement r : d.getRequirements())
            if (r instanceof ItemRequirement item
                && item.isActualItem()
                && item.shouldDisplayText(snapshot.client))
              for (int id : item.getAllIds()) if (id >= 0 && !ids.contains(id)) ids.add(id);
        if (!ids.isEmpty()) {
          target.add("ids", GSON.toJsonTree(ids));
          hasTarget = true;
        }
        if (hasTarget) targets.add(target);
        for (Object marked : (Collection<?>) field(d, "markedTiles")) {
          var point = ((com.questhelper.tools.QuestTile) marked).getWorldPoint();
          JsonObject t = new JsonObject();
          t.addProperty("kind", "tile");
          t.addProperty("x", point.getX());
          t.addProperty("y", point.getY());
          t.addProperty("plane", point.getPlane());
          targets.add(t);
        }
        reqs = PresentationExport.requirements(d.getRequirements(), snapshot.client, services.config);
        o.add(
            "recommended",
            PresentationExport.requirements(
                PresentationExport.castList(field(d, "recommended")), snapshot.client, services.config));
        o.add(
            "teleports",
            PresentationExport.requirements(
                PresentationExport.castList(field(d, "teleport")), snapshot.client, services.config));
        o.add("inventoryHighlights", PresentationExport.inventoryHighlights(d, snapshot.client));
      }
      for (var c : step.getChoices().getChoices()) {
        JsonObject x = new JsonObject();
        if (c.getChoice() != null) x.addProperty("text", c.getChoice());
        else x.addProperty("text", Objects.toString(field(c, "choiceById")));
        choices.add(x);
      }
      o.add("targets", targets);
      o.add("requirements", reqs);
      o.add("dialogueChoices", choices);
      o.add("choiceRules", PresentationExport.choiceRules(step, snapshot.client));
      // QuestStep.getGeInterfaceIcon: the items a Grand Exchange search shows for this step.
      if (field(step, "geInterfaceIcon") instanceof List<?> ge && !ge.isEmpty())
        o.add("geItems", GSON.toJsonTree(ge));
      o.add("widgets", new JsonArray());
      // A custom overlay may project through Perspective. A snapshot without camera geometry
      // (headless evaluation) must lose the drawing, not the step.
      JsonArray overlayDiagnostics = new JsonArray();
      PresentationExport.part(o, "overlays", overlayDiagnostics, () -> overlays(step));
      if (!o.has("overlays")) o.add("overlays", new JsonArray());
      o.add("overlayDiagnostics", overlayDiagnostics);
      return o;
    }

    JsonArray overlays(QuestStep step) {
      PortableGraphics graphics = new PortableGraphics(800, 600);
      try {
        for (String method :
            List.of(
                "makeWorldOverlayHint",
                "makeWidgetOverlayHint",
                "makeWorldArrowOverlayHint",
                "makeWorldLineOverlayHint")) {
          var m =
              step.getClass()
                  .getMethod(
                      method, java.awt.Graphics2D.class, com.questhelper.QuestHelperPlugin.class);
          boolean custom =
              m.getDeclaringClass().getName().startsWith("com.questhelper.helpers.quests.");
          boolean widgetMethod = method.equals("makeWidgetOverlayHint");
          // QuestHelperWidgetOverlay and QuestHelperWorldLineOverlay check these first.
          if (widgetMethod && !services.config.showWidgetHints()) continue;
          if (method.equals("makeWorldLineOverlayHint") && !services.config.showWorldLines())
            continue;
          boolean widget = widgetMethod && step instanceof WidgetStep;
          boolean lines =
              method.equals("makeWorldLineOverlayHint")
                  && step instanceof DetailedQuestStep
                  && field(step, "linePoints") != null;
          if (custom || widget || lines) {
            m.setAccessible(true);
            m.invoke(step, graphics, helper.getQuestHelperPlugin());
          }
        }
        if (services.config.showWidgetHints())
          for (var widget : step.getWidgetsToHighlight())
            widget.highlightChoices(graphics, snapshot.client, helper.getQuestHelperPlugin());
      } catch (InvocationTargetException e) {
        if (e.getCause() instanceof RuntimeException r) throw r;
        throw new RuntimeException(e.getCause());
      } catch (ReflectiveOperationException e) {
        throw new IllegalStateException(e);
      } finally {
        graphics.dispose();
      }
      return graphics.commands;
    }
  }

  static Object field(Object o, String name) {
    for (Class<?> c = o.getClass(); c != null; c = c.getSuperclass())
      try {
        Field f = c.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(o);
      } catch (NoSuchFieldException ignored) {
      } catch (IllegalAccessException e) {
        throw new IllegalStateException(e);
      }
    throw BridgeFailure.unsupported("field " + name);
  }

  static void setField(Object o, String name, Object value) {
    for (Class<?> c = o.getClass(); c != null; c = c.getSuperclass())
      try {
        Field f = c.getDeclaredField(name);
        f.setAccessible(true);
        f.set(o, value);
        return;
      } catch (NoSuchFieldException ignored) {
      } catch (IllegalAccessException e) {
        throw new IllegalStateException(e);
      }
    throw BridgeFailure.unsupported("field " + name);
  }
}
