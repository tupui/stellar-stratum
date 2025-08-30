/**
 * Enum asset type
 * @readonly
 * @enum {number}
 */
export const AssetType = {
    Stellar: 1,
    Other: 2
} as const;

export type AssetTypeValue = typeof AssetType[keyof typeof AssetType];