/** Der Besitzer lädt höchstens einmal pro Stunde hoch (außer nach einer neuen Freigabe). */
export class SnapshotThrottledError extends Error {
    constructor(readonly retryAfterMs: number) {
        super("Snapshot upload limit reached");
        this.name = "SnapshotThrottledError";
    }
}

/** Es gibt keine lebende Freigabe: ein Snapshot hätte keinen Empfänger und wird nicht gespeichert. */
export class SnapshotNotSharingError extends Error {
    constructor() {
        super("No active grant, nothing to share");
        this.name = "SnapshotNotSharingError";
    }
}

/** Der Snapshot gehört zu einer anderen Spieler ID als der beim Nutzer hinterlegten. */
export class SnapshotPlayerMismatchError extends Error {
    constructor(readonly registeredNuid: string) {
        super("Snapshot belongs to a different player than the registered one");
        this.name = "SnapshotPlayerMismatchError";
    }
}

export class SnapshotInvalidError extends Error {
    constructor(readonly reason: string) {
        super(`Invalid snapshot: ${reason}`);
        this.name = "SnapshotInvalidError";
    }
}

export class SnapshotTooLargeError extends Error {
    constructor() {
        super("Snapshot is too large");
        this.name = "SnapshotTooLargeError";
    }
}

/** Niemand teilt diesen Spieler mit dem anfragenden Nutzer (oder er existiert nicht). */
export class SharedPlayerNotFoundError extends Error {
    constructor() {
        super("No shared snapshot for this player");
        this.name = "SharedPlayerNotFoundError";
    }
}
