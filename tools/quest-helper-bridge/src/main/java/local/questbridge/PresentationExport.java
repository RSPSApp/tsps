package local.questbridge;

import com.google.gson.*;
import com.questhelper.QuestHelperConfig;
import com.questhelper.panel.PanelDetails;
import com.questhelper.panel.TopLevelPanelDetails;
import com.questhelper.panel.questorders.IronmanOptimalQuestGuide;
import com.questhelper.panel.questorders.OptimalQuestGuide;
import com.questhelper.panel.questorders.ReleaseDate;
import com.questhelper.questhelpers.QuestHelper;
import com.questhelper.questinfo.ExternalQuestResources;
import com.questhelper.questinfo.QuestHelperQuest;
import com.questhelper.requirements.Requirement;
import com.questhelper.requirements.item.ItemRequirement;
import com.questhelper.requirements.quest.QuestRequirement;
import com.questhelper.rewards.Reward;
import com.questhelper.steps.DetailedQuestStep;
import com.questhelper.steps.QuestStep;
import java.awt.Color;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import net.runelite.api.Client;
import net.runelite.client.ui.overlay.components.LayoutableRenderableEntity;
import net.runelite.client.ui.overlay.components.LineComponent;
import net.runelite.client.ui.overlay.components.PanelComponent;
import net.runelite.client.ui.overlay.components.TitleComponent;

/**
 * Sidebar and overlay-panel data the upstream Swing panels show: QuestOverviewPanel,
 * QuestStepPanel and QuestHelperOverlay. Each part is exported independently; a part whose
 * upstream code needs unavailable state becomes a diagnostic instead of failing the step.
 */
final class PresentationExport {
  private PresentationExport() {}

  /** Requirement colour as pass/fail/partial/boost/neutral, as upstream colours its text. */
  static String state(Requirement r, Client client, QuestHelperConfig config) {
    Color c = r.getColor(client, config);
    if (c == null) return r.check(client) ? "pass" : "fail";
    if (c.equals(config.passColour())) return "pass";
    if (c.equals(config.failColour())) return "fail";
    if (c.equals(config.partialSuccessColour())) return "partial";
    if (c.equals(config.boostColour())) return "boost";
    return "neutral";
  }

  static JsonObject requirement(Requirement r, Client client, QuestHelperConfig config) {
    JsonObject x = new JsonObject();
    x.addProperty("name", r.getDisplayText());
    x.addProperty("met", r.check(client));
    x.addProperty("state", state(r, client, config));
    if (r.getTooltip() != null) x.addProperty("tooltip", r.getTooltip());
    // QuestRequirementsPanel's "Go to wiki..": an item's link lands on its #Item_sources.
    if (r.getWikiUrl() != null) x.addProperty("wikiUrl", r.getWikiUrl());
    if (r instanceof ItemRequirement ir) {
      x.add("ids", BridgeEngine.GSON.toJsonTree(ir.getAllIds()));
      x.addProperty("quantity", ir.getQuantity());
    }
    return x;
  }

  static JsonArray requirements(
      Collection<? extends Requirement> list, Client client, QuestHelperConfig config) {
    JsonArray out = new JsonArray();
    if (list == null) return out;
    Set<Requirement> seen = Collections.newSetFromMap(new IdentityHashMap<>());
    for (Requirement r : list)
      if (r != null && seen.add(r) && r.shouldDisplayText(client))
        out.add(requirement(r, client, config));
    return out;
  }

  static JsonArray strings(Collection<String> list) {
    JsonArray out = new JsonArray();
    if (list != null) for (String s : list) if (s != null) out.add(s);
    return out;
  }

  /** QuestOverviewPanel.collectRequirements: general requirements with sub-quests expanded. */
  static List<Requirement> aggregated(QuestHelper quest) {
    List<Requirement> all = new ArrayList<>();
    collect(quest.getGeneralRequirements(), all, new HashSet<>());
    return all;
  }

  private static void collect(List<Requirement> general, List<Requirement> all, Set<String> done) {
    if (general == null) return;
    for (Requirement requirement : general) {
      if (requirement instanceof QuestRequirement sub) {
        String id = sub.getQuest().getName();
        if (!done.add(id)) continue;
        all.add(requirement);
        try {
          collect(sub.getQuest().getQuestHelper().getGeneralRequirements(), all, done);
        } catch (RuntimeException ignored) {
          // An uninitialised upstream singleton; its own row is still shown.
        }
      } else if (!all.contains(requirement)) all.add(requirement);
    }
  }

  static String wikiUrl(QuestHelperQuest quest) {
    try {
      return ExternalQuestResources.valueOf(quest.name().toUpperCase()).getWikiURL();
    } catch (Exception e) {
      return "https://oldschool.runescape.wiki/w/"
          + URLEncoder.encode(quest.name(), StandardCharsets.UTF_8).toLowerCase();
    }
  }

  static JsonObject overview(
      QuestHelper helper, Client client, QuestHelperConfig config, JsonArray diagnostics) {
    JsonObject o = new JsonObject();
    QuestHelperQuest quest = helper.getQuest();
    o.addProperty("name", helper.getDisplayedQuestName());
    if (quest != null) {
      o.addProperty("difficulty", quest.getDifficulty().name());
      o.addProperty("questType", quest.getQuestType().name());
      o.addProperty("wikiUrl", wikiUrl(quest));
    }
    part(
        o,
        "generalRequirements",
        diagnostics,
        () ->
            requirements(
                config.showFullRequirements() ? aggregated(helper) : helper.getGeneralRequirements(),
                client,
                config));
    part(
        o,
        "generalRecommended",
        diagnostics,
        () -> requirements(helper.getGeneralRecommended(), client, config));
    part(
        o,
        "itemRequirements",
        diagnostics,
        () -> requirements(helper.getItemRequirements(), client, config));
    part(
        o,
        "itemRecommended",
        diagnostics,
        () -> requirements(helper.getItemRecommended(), client, config));
    part(o, "combatRequirements", diagnostics, () -> strings(helper.getCombatRequirements()));
    part(o, "notes", diagnostics, () -> strings(helper.getNotes()));
    part(
        o,
        "rewards",
        diagnostics,
        () -> {
          JsonArray rewards = new JsonArray();
          List<Reward> list = helper.getQuestRewards();
          if (list != null)
            for (Reward r : list) {
              JsonObject x = new JsonObject();
              x.addProperty("type", r.rewardType().name());
              x.addProperty("text", r.getDisplayText());
              rewards.add(x);
            }
          return rewards;
        });
    return o;
  }

  /** PanelDetails, flattened as QuestStepPanel shows them; TopLevelPanelDetails nest. */
  static JsonArray sections(
      List<PanelDetails> panels,
      QuestStep active,
      int var,
      Client client,
      QuestHelperConfig config,
      List<PanelDetails> index) {
    JsonArray out = new JsonArray();
    if (panels == null) return out;
    for (PanelDetails panel : panels) {
      if (panel == null) continue;
      JsonObject p = new JsonObject();
      p.addProperty("index", index.size());
      index.add(panel);
      p.addProperty("title", panel.getHeader());
      boolean hidden = panel.getHideCondition() != null && panel.getHideCondition().check(client);
      p.addProperty("hidden", hidden);
      p.add("requirements", requirements(panel.getRequirements(), client, config));
      p.add("recommended", requirements(panel.getRecommended(), client, config));
      QuestStep locking = panel.getLockingQuestSteps();
      boolean lockable =
          locking != null && (panel.getVars() == null || panel.getVars().contains(var));
      p.addProperty("lockable", lockable);
      if (locking != null) {
        p.addProperty("locked", locking.isLocked());
        p.addProperty("unlockable", locking.isUnlockable());
      }
      JsonArray steps = new JsonArray();
      boolean highlighted = false;
      if (panel.getSteps() != null)
        for (QuestStep step : panel.getSteps()) {
          if (step == null) continue;
          if (step.getConditionToHide() != null && step.getConditionToHide().check(client))
            continue;
          JsonObject s = new JsonObject();
          s.add("text", strings(step.getText()));
          boolean faded = step.getFadeCondition() != null && step.getFadeCondition().check(client);
          s.addProperty("faded", faded);
          if (faded) s.addProperty("tooltip", step.getFadeCondition().getDisplayText());
          boolean current =
              !hidden && !highlighted && step.containsSteps(active, new HashSet<>());
          if (current) highlighted = true;
          s.addProperty("active", current);
          steps.add(s);
        }
      p.add("steps", steps);
      p.addProperty("active", highlighted);
      if (panel instanceof TopLevelPanelDetails top)
        p.add("children", sections(top.getPanelDetails(), active, var, client, config, index));
      out.add(p);
    }
    return out;
  }

  /** QuestHelperOverlay: the current step's makeOverlayHint, as lines of a PanelComponent. */
  static JsonArray overlayPanel(QuestStep current, com.questhelper.QuestHelperPlugin plugin) {
    PanelComponent panel = new PanelComponent();
    current.makeOverlayHint(panel, plugin, new ArrayList<>(), new ArrayList<>());
    JsonArray lines = new JsonArray();
    for (LayoutableRenderableEntity child : panel.getChildren()) {
      JsonObject line = new JsonObject();
      if (child instanceof TitleComponent title) {
        line.addProperty("kind", "title");
        line.addProperty("text", (String) BridgeEngine.field(title, "text"));
        color(line, "color", (Color) BridgeEngine.field(title, "color"));
      } else if (child instanceof LineComponent l) {
        line.addProperty("kind", "line");
        Object left = BridgeEngine.field(l, "left"), right = BridgeEngine.field(l, "right");
        if (left != null) line.addProperty("left", left.toString());
        if (right != null) line.addProperty("right", right.toString());
        color(line, "leftColor", (Color) BridgeEngine.field(l, "leftColor"));
        color(line, "rightColor", (Color) BridgeEngine.field(l, "rightColor"));
      } else continue;
      lines.add(line);
    }
    return lines;
  }

  static void color(JsonObject o, String key, Color c) {
    if (c != null) o.addProperty(key, String.format("#%06x", c.getRGB() & 0xffffff));
  }

  /**
   * Requirement item ids DetailedQuestStep.isValidRenderRequirementInInventory highlights;
   * teleports are highlighted too, but only far from the step (the client has their ids).
   */
  static JsonArray inventoryHighlights(DetailedQuestStep step, Client client) {
    Set<Integer> ids = new LinkedHashSet<>();
    for (Requirement r : step.getRequirements())
      if (r instanceof ItemRequirement item && item.shouldHighlightInInventory(client))
        ids.addAll(item.getAllIds());
    ids.removeIf(id -> id == null || id < 0);
    return BridgeEngine.GSON.toJsonTree(ids).getAsJsonArray();
  }

  @SuppressWarnings("unchecked")
  static List<Requirement> castList(Object value) {
    return value instanceof List<?> l ? (List<Requirement>) l : List.of();
  }

  /** Catalog fields the upstream quest list sorts and filters by. */
  static void catalogMetadata(JsonObject row, QuestHelperQuest info) {
    row.addProperty("difficulty", info.getDifficulty().name());
    row.addProperty("questType", info.getQuestType().name());
    order(row, "releaseOrder", ReleaseDate.getQuestList(), info);
    order(row, "optimalOrder", OptimalQuestGuide.getQuestList(), info);
    order(row, "ironmanOrder", IronmanOptimalQuestGuide.getQuestList(), info);
    try {
      var reward = info.getQuestHelper().getQuestPointReward();
      row.addProperty("questPoints", reward == null ? 0 : reward.getPoints());
    } catch (RuntimeException ignored) {
      // Quest-point sorting treats a helper without a reward as 0, as upstream does.
    }
    skillFilterData(row, info.getQuestHelper());
  }

  /**
   * SkillFiltering.questPassesSkillFilter's inputs: skills the quest requires or gives
   * experience in, and the quests it requires (the client follows them recursively).
   */
  static void skillFilterData(JsonObject row, QuestHelper helper) {
    Set<String> skills = new TreeSet<>();
    JsonArray quests = new JsonArray();
    try {
      List<Requirement> general = helper.getGeneralRequirements();
      if (general != null)
        for (Requirement r : general) {
          if (r instanceof com.questhelper.requirements.player.SkillRequirement skill)
            skills.add(skill.getSkill().getName());
          else if (r instanceof QuestRequirement quest) quests.add(quest.getQuest().getName());
        }
      var rewards = helper.getExperienceRewards();
      if (rewards != null) for (var reward : rewards) skills.add(reward.getSkill().getName());
    } catch (RuntimeException ignored) {
      // An uninitialised upstream singleton: the quest then passes every skill filter.
      return;
    }
    row.add("filterSkills", strings(skills));
    row.add("requiredQuests", quests);
  }

  private static void order(JsonObject row, String key, List<QuestHelperQuest> list, Object q) {
    int i = list.indexOf(q);
    if (i >= 0) row.addProperty(key, i);
  }

  /**
   * WidgetChoiceStep.highlightChoice's matching rules, for the client to apply to its own
   * widgets: the option to recolour (and number), or the text a *Change step substitutes.
   * DialogChoiceSteps.checkChoices' previous-line filter and varbit answers are resolved here.
   */
  static JsonArray choiceRules(QuestStep step, Client client) {
    JsonArray out = new JsonArray();
    String lastDialog = Objects.toString(BridgeEngine.field(step, "lastDialogSeen"), "");
    for (var c : step.getChoices().getChoices()) {
      String previous = c.getExpectedPreviousLine();
      if (previous != null && !lastDialog.contains(previous)) continue;
      JsonObject rule = choiceRule(c, client);
      if (rule != null) out.add(rule);
    }
    for (var c : ((com.questhelper.steps.choice.WidgetChoiceSteps) BridgeEngine.field(step, "widgetChoices")).getChoices()) {
      JsonObject rule = choiceRule(c, client);
      if (rule != null) out.add(rule);
    }
    return out;
  }

  static JsonObject choiceRule(com.questhelper.steps.choice.WidgetChoiceStep c, Client client) {
    JsonObject r = new JsonObject();
    r.addProperty("groupId", c.getGroupId());
    r.addProperty("childId", (Integer) BridgeEngine.field(c, "childId"));
    r.addProperty("number", (Boolean) BridgeEngine.field(c, "shouldNumber"));
    int byId = (Integer) BridgeEngine.field(c, "choiceById");
    if (byId != -1) r.addProperty("id", byId);
    var pattern = (java.util.regex.Pattern) BridgeEngine.field(c, "pattern");
    if (pattern != null) r.addProperty("pattern", pattern.pattern());
    String text = c.getChoice();
    int varbit = (Integer) BridgeEngine.field(c, "varbitId");
    if (varbit != -1) {
      @SuppressWarnings("unchecked")
      var answers = (Map<Integer, String>) BridgeEngine.field(c, "varbitValueToAnswer");
      text = answers == null ? null : answers.get(client.getVarbitValue(varbit));
      if (text == null) return null;
    }
    if (text != null) r.addProperty("text", text);
    if (c instanceof com.questhelper.steps.choice.WidgetTextChange
        || c instanceof com.questhelper.steps.choice.DialogChoiceChange)
      r.addProperty("replace", (String) BridgeEngine.field(c, "textChange"));
    r.addProperty("whole", c instanceof com.questhelper.steps.choice.WidgetTextChange);
    @SuppressWarnings("unchecked")
    var excluded = (List<String>) BridgeEngine.field(c, "excludedStrings");
    if (excluded != null && !excluded.isEmpty()) {
      r.addProperty("excludeGroupId", (Integer) BridgeEngine.field(c, "excludedGroupId"));
      r.addProperty("excludeChildId", (Integer) BridgeEngine.field(c, "excludedChildId"));
      r.add("excludes", strings(excluded));
    }
    return r;
  }

  interface Part {
    JsonElement get();
  }

  static void part(JsonObject o, String key, JsonArray diagnostics, Part part) {
    try {
      o.add(key, part.get());
    } catch (RuntimeException error) {
      diagnostics.add(diagnostic(key, error));
    }
  }

  static JsonObject diagnostic(String key, Throwable error) {
    BridgeFailure f =
        error instanceof BridgeFailure b
            ? b
            : new BridgeFailure(
                "PRESENTATION_UNAVAILABLE",
                error.getClass().getName(),
                key + ": " + error.getMessage());
    return f.diagnostic();
  }
}
