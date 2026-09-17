export const gameConfig = {
    side: 800,
    leftSectionSize: 200,
    fps: 8,
    foodStorage: 20,
    backgroundColour: 'black',
    scaleFactor: 20,
    gridSize: 800 / 20,
    waitingRoom: {
        waitingRoomMessage: 'bla bla',
        backgroundColour: 'black'
    }
}

export const startingPositions = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }]

const snakeConfig = {
    colours: {
        head: 'yellow',
        body: 'yellow',
        eyes: 'yellow'
    },
    name: 'Server'
}

export const foodScore: { [key: string]: number } = {
    redApple: 10,
    greenApple: 20,
    yellowApple: 15,
    banana: 25,
    cherry: 30,
    chili: 50,
    strawberry: 40
};

export const serverSnakeCollision = false;

export const generateFoodCoordinates = (): any[][] => {
    const coordinates: any[][] = [];
    const foodTypes = ['redApple', 'greenApple', 'yellowApple', 'banana', 'cherry', 'chili', 'strawberry'];
    const usedCoordinates = new Set<string>();

    for (let i = 0; i < gameConfig.foodStorage; i++) {
        let x: number, y: number, coordinateKey: string;
        
        do {
            x = Math.floor(Math.random() * gameConfig.scaleFactor);
            y = Math.floor(Math.random() * gameConfig.scaleFactor);
            coordinateKey = `${x},${y}`;
        } while (usedCoordinates.has(coordinateKey));

        const type = foodTypes[Math.floor(Math.random() * foodTypes.length)];
        coordinates.push([x, y, i, type]);

        usedCoordinates.add(coordinateKey);
    }

    return coordinates;
};