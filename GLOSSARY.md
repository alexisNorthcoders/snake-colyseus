# snake-colyseus

The multiplayer game server: rooms, the engine's rules, the bots, and reporting results to go-server.

## Language

**Casual match**: a match in a `snake` room: any mode, any speed, up to 4 players, nothing at stake.
**Ranked match**: a 1v1 timed match at the default speed in a `ranked` room. Its result changes both players' Rating.
**Ranked queue**: the `ranked` room itself, which is joined with `joinOrCreate`. It never starts on a player's request.
**Account**: a registered user. Only Accounts may join a Ranked match.
**Guest**: someone playing with an anonymous token. Refused by the `ranked` room.
**Rating**: an Account's Glicko-2 skill estimate, 1500 by default. Held by go-server, never here.
**Provisional**: a Rating based on fewer than 5 Ranked matches.
**Stand-in**: a roster bot that plays in place of a human: in Ranked, after a wait alone of 20 seconds; in a Casual match, when the player who starts it is alone (the rookie). Its Rating is fixed and never stored or changed.
**Forfeit**: leaving a Ranked match once it is dealt. It is a loss for the leaver.
**Exhibition**: a match in an `exhibition` room between two roster bots chosen by its creator, watched by Spectators. Nothing about it is reported or at stake.
**Spectator**: a client in an Exhibition who watches it and has no snake.
**Vs-bot match**: a Casual match between one human and one roster bot, in a `snake` room locked at creation.
**Thought**: what a roster bot decided on one tick of play, sent to clients who asked for it, with its confidences if it has a brain. It shows the bot's decision and never changes it.
**Confidence**: a brain's share for one of left, straight or right on one tick, relative to its heading. A reading of the brain's outputs, not a probability of being right, and not comparable between training methods.
**Queued turn**: a turn a snake has accepted but not yet made. A snake holds at most two and makes one per tick; a turn that repeats or reverses the last queued one, or arrives when two are waiting, is dropped.
