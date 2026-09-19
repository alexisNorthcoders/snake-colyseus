import { gameConfig } from "../src/gameConfig";

// Most tests want Start to begin play at once; the countdown tests opt back in.
gameConfig.countdownSeconds = 0;
