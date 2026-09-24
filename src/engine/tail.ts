import { Cell } from "../gameConfig";

/**
 * The array a tail lives in: a plain `Cell[]` in a headless game, the schema's
 * `ArraySchema` in the live room. Only the operations the ring needs.
 */
export interface TailArray<C extends Cell> {
    readonly length: number;
    [slot: number]: C;
    push(cell: C): unknown;
    splice(start: number, deleteCount: number): unknown;
}

/**
 * The tail is a ring buffer, so a tick rewrites one segment instead of
 * shifting every one of them along — which would put the whole tail in the
 * patch. `tailCursor` is the slot holding the oldest segment, the next one to
 * be overwritten; walking forward from it runs oldest to newest, wrapping
 * round. Clients read it back with `tailCells`, so this layout is part of the
 * wire format.
 *
 * Existing cells are always rewritten in place and new ones pushed, never
 * replaced, so the schema patches only the segments that changed.
 */
export interface TailRing<C extends Cell> {
    tail: TailArray<C>;
    tailCursor: number;
}

/** Makes a new tail cell: a `Coordinates` on the schema, `{x, y}` on a plain object. */
export type NewCell<C extends Cell> = (x: number, y: number) => C;

export const newPlainCell: NewCell<Cell> = (x, y) => ({ x, y });

/** Replaces the whole tail with `cells`, given newest first. */
export const setTail = <C extends Cell>(ring: TailRing<C>, cells: Cell[], newCell: NewCell<C>) => {
    ring.tail.splice(0, ring.tail.length);
    writeOldestFirst(ring, cells, newCell);
};

/** Moves the tail up behind the head, which has just left `vacated`. */
export const advanceTail = <C extends Cell>(ring: TailRing<C>, vacated: Cell) => {
    if (ring.tail.length === 0) return;

    const oldest = ring.tail[ring.tailCursor];
    oldest.x = vacated.x;
    oldest.y = vacated.y;
    ring.tailCursor = (ring.tailCursor + 1) % ring.tail.length;
};

/**
 * Adds a segment on top of the tail's last one, or on the head for a snake
 * with no tail yet. The array can't take an insert mid-ring, so the tail
 * is first rewritten oldest first from slot 0 — O(length), but only once
 * per pellet — and the new segment appended as the oldest of all.
 */
export const growTail = <C extends Cell>(ring: TailRing<C> & Cell, newCell: NewCell<C>) => {
    const cells = tailCells(ring);
    const end = cells[cells.length - 1] ?? { x: ring.x, y: ring.y };

    if (ring.tailCursor !== 0) writeOldestFirst(ring, cells, newCell);

    ring.tail.push(newCell(end.x, end.y));
    ring.tailCursor = ring.tail.length - 1;
};

/**
 * A snake's tail cells in body order, newest (next to the head) first, as
 * copies rather than the live segments. Takes anything shaped like a snake, so
 * it reads a client's decoded copy as well.
 */
export const tailCells = ({ tail, tailCursor }: { tail: ArrayLike<Cell>; tailCursor: number }): Cell[] => {
    const { length } = tail;
    return Array.from({ length }, (_, i) => {
        const { x, y } = tail[(tailCursor - 1 - i + length) % length];
        return { x, y };
    });
};

/**
 * Lays `cells`, given newest first, into the ring oldest first from slot
 * 0 — reusing the slots already there, adding any that are missing — and
 * points the cursor at slot 0.
 */
const writeOldestFirst = <C extends Cell>(ring: TailRing<C>, cells: Cell[], newCell: NewCell<C>) => {
    [...cells].reverse().forEach(({ x, y }, i) => {
        const slot = ring.tail[i];
        if (!slot) {
            ring.tail.push(newCell(x, y));
            return;
        }
        slot.x = x;
        slot.y = y;
    });
    ring.tailCursor = 0;
};
