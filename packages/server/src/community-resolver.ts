import PKC from "@pkcprotocol/pkc-js";

type PkcInstance = Awaited<ReturnType<typeof PKC>>;
type PkcLoader = () => Promise<PkcInstance>;

let pkcPromise: Promise<PkcInstance> | undefined;
const communityCache = new Map<string, { publicKey: string; expiresAt: number }>();

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type PkcOptions = Parameters<typeof PKC>[0];
let pkcOptions: PkcOptions | undefined;
let isTestLoaderActive = false;

const createDefaultLoader = (): PkcLoader => () => PKC(pkcOptions);

let pkcLoader: PkcLoader = createDefaultLoader();

export const getPkcInstance = (): Promise<PkcInstance> => {
    if (!pkcPromise) {
        pkcPromise = pkcLoader();
    }
    return pkcPromise;
};

export const initPkcInstance = (): void => {
    if (!pkcPromise) {
        pkcPromise = pkcLoader();
    }
};

export const resolveCommunityPublicKey = async (communityAddress: string, pkcInstance: PkcInstance): Promise<string> => {
    const now = Date.now();
    const cached = communityCache.get(communityAddress);
    if (cached && cached.expiresAt > now) {
        return cached.publicKey;
    }

    const community = await pkcInstance.getCommunity({ address: communityAddress });
    const publicKey = community.signature?.publicKey;
    if (!publicKey) {
        throw new Error("Community signature public key is unavailable");
    }
    communityCache.set(communityAddress, {
        publicKey,
        expiresAt: now + CACHE_TTL_MS
    });
    return publicKey;
};

export const destroyPkcInstance = async (): Promise<void> => {
    if (!pkcPromise) return;
    const pkc = await pkcPromise;
    pkcPromise = undefined;
    communityCache.clear();
    await pkc.destroy();
};

export const setPkcLoaderForTest = (loader: PkcLoader): void => {
    pkcLoader = loader;
    pkcPromise = undefined;
    communityCache.clear();
    isTestLoaderActive = true;
};

export const resetPkcLoaderForTest = (): void => {
    isTestLoaderActive = false;
    pkcLoader = createDefaultLoader();
    pkcPromise = undefined;
    communityCache.clear();
};

export const setPkcOptions = (options: PkcOptions | undefined): void => {
    pkcOptions = options;
    if (!isTestLoaderActive) {
        pkcLoader = createDefaultLoader();
    }
};
