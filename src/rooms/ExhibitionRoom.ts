import { Client } from "@colyseus/core";
import { pickBot } from "../bots";
import { PlayerColors } from "./schema/SnakeState";
import { SnakeRoom } from "./SnakeRoom";

// Each seat's fixed colours, so the two snakes can always be told apart.
const seatColours = [
  () => new PlayerColors("#e63946", "#a4161a", "#ffffff"),
  () => new PlayerColors("#1d7bd8", "#0b4a8f", "#ffffff")
];

/**
 * An Exhibition: two roster snakes play each other while the creator watches
 * as a Spectator, a client with no Player. Nothing a Spectator sends changes
 * the match, and nothing is reported to go-server.
 */
export class ExhibitionRoom extends SnakeRoom {
  protected startsOnRequest = false;
  protected reportsBotRounds = false;

  onCreate(options: any) {
    // Never `vsBot`: the parent seats no bot of its own.
    super.onCreate({
      mode: options?.mode,
      speed: options?.speed,
      seed: options?.seed,
      botReactionTicks: options?.botReactionTicks
    });
    // An unknown or missing id falls back to the rookie; a mirror match is allowed.
    this.seatBot(pickBot(options?.botA), seatColours[0]());
    this.seatBot(pickBot(options?.botB), seatColours[1]());
  }

  /** A Spectator adds no snake; its arrival starts the countdown, which does nothing once the lobby is over. */
  onJoin(client: Client) {
    this.startCountdown();
  }
}
