import { rulesConfig } from "./engine";

/**
 * The room's and the client's settings. The board size and the pellet count
 * are rules, so they are defined in the engine and only mirrored here, for
 * reading: setting them here would not change the engine's.
 */
export const gameConfig = {
    side: 800,
    leftSectionSize: 200,
    fps: 8,
    // Bounds for a room's requested speed, in ticks per second.
    minSpeed: 4,
    maxSpeed: 15,
    // Seconds counted down after Start before snakes move (0 = no countdown),
    // and the real time between counts; tests shorten both.
    countdownSeconds: 3,
    countdownTickMs: 1000,
    foodStorage: rulesConfig.foodStorage,
    backgroundColour: 'black',
    scaleFactor: rulesConfig.scaleFactor,
    gridSize: 800 / rulesConfig.scaleFactor,
    waitingRoom: {
        waitingRoomMessage: 'bla bla',
        backgroundColour: 'black'
    }
}
