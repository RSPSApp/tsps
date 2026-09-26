import { Appearance } from "../../../game/model/Appearance";

export class ChangeAppearancePacketListener {
  public static apply(player: any, gender: number, kits: number[], colors: number[]): void {
    if (!player?.getAppearance?.().getCanChangeAppearance() || player.getInterfaceId() <= 0) return;
    if ((gender !== 0 && gender !== 1) || kits.length !== 7 || colors.length !== 5) return;
    // Identity kit ids and colour palette lengths are defined by the cache's configs and move
    // between cache revisions, so the server has no fixed range to validate either against. A
    // negative kit is "no kit" for this slot (e.g. no female beard); everything else is passed
    // through for the client's identikit loader, which ignores colour indices it can't resolve.
    // The old fixed clamps existed only to snap modern kits and colours back to defaults.
    const appliedKits = kits.map((value) => (value < 0 ? -1 : value));
    const appliedColors = colors.map((value) => value & 0xff);
    const look = [...player.getAppearance().getLook()];
    look[Appearance.GENDER] = gender;
    [Appearance.HEAD, Appearance.BEARD, Appearance.CHEST, Appearance.ARMS,
      Appearance.HANDS, Appearance.LEGS, Appearance.FEET]
      .forEach((index, i) => look[index] = appliedKits[i]);
    [Appearance.HAIR_COLOUR, Appearance.TORSO_COLOUR, Appearance.LEG_COLOUR,
      Appearance.FEET_COLOUR, Appearance.SKIN_COLOUR]
      .forEach((index, i) => look[index] = appliedColors[i]);
    player.getAppearance().setLookArray(look);
    player.getPacketSender().sendInterfaceRemoval();
    player.getAppearance().setCanChangeAppearance(false);
  }
}
