import PKC from "@pkcprotocol/pkc-js";

export type PkcInstance = Awaited<ReturnType<typeof PKC>>;

let pkcInstance: PkcInstance | null = null;
let isInitializing = false;
let initPromise: Promise<PkcInstance> | null = null;

export type PkcManagerOptions = Parameters<typeof PKC>[0];

export async function getPkc(options?: PkcManagerOptions): Promise<PkcInstance> {
    if (pkcInstance) {
        return pkcInstance;
    }

    if (isInitializing && initPromise) {
        return initPromise;
    }

    isInitializing = true;
    initPromise = createPkcInstance(options);

    try {
        pkcInstance = await initPromise;
        return pkcInstance;
    } finally {
        isInitializing = false;
        initPromise = null;
    }
}

async function createPkcInstance(options?: PkcManagerOptions): Promise<PkcInstance> {
    const pkc = await PKC(options);
    console.log("[PkcManager] PKC instance created");
    return pkc;
}

export function hasPkcInstance(): boolean {
    return pkcInstance !== null;
}

export async function stopPkc(): Promise<void> {
    if (pkcInstance) {
        console.log("[PkcManager] Destroying PKC instance...");
        await pkcInstance.destroy();
        pkcInstance = null;
        console.log("[PkcManager] PKC instance destroyed");
    }
}

export function getPkcInstanceRaw(): PkcInstance | null {
    return pkcInstance;
}
