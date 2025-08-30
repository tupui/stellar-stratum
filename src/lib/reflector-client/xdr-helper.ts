import { xdr, Address, scValToNative } from '@stellar/stellar-sdk';
import { AssetType, type AssetTypeValue } from './asset-type';

export interface Asset {
  type: AssetTypeValue;
  code: string;
}

// Re-export AssetType for convenience
export { AssetType } from './asset-type';

/**
 * @param {Asset} asset - Asset object
 * @returns {xdr.ScVal}
 */
export function buildAssetScVal(asset: Asset): xdr.ScVal {
    switch (asset.type) {
        case AssetType.Stellar:
            return xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Stellar'), 
                new Address(asset.code).toScVal()
            ]);
        case AssetType.Other:
            return xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Other'), 
                xdr.ScVal.scvSymbol(asset.code)
            ]);
        default:
            throw new Error('Invalid asset type');
    }
}

/**
 * @param {xdr.TransactionMeta} result - XDR result meta
 * @returns {any}
 */
export function parseSorobanResult(result: any): any {
    const value = result.value().sorobanMeta().returnValue();
    if (value.value() === false) // if footprint's data is different from the contract execution data, the result is false
        return undefined;
    return scValToNative(value);
}