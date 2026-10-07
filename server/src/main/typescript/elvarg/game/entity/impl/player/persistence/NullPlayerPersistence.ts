import type { Player } from "../Player";
import { PlayerPersistence } from "./PlayerPersistence";
import { PlayerSave } from "./PlayerSave";

export class NullPlayerPersistence extends PlayerPersistence {
  load(username: string): PlayerSave {
    return null as any;
  }

  save(player: Player, _reason?: string): void {
    // no persistence during debugging
  }

  exists(username: string): boolean {
    return false;
  }

  async encryptPassword(plainPassword: string): Promise<string> {
    return plainPassword;
  }

  async checkPassword(password: string, playerSave: PlayerSave): Promise<boolean> {
    return password === playerSave.getPasswordHashWithSalt();
  }
}
