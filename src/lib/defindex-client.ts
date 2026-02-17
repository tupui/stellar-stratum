import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';
import { appConfig } from './appConfig';

const defindexSDK = new DefindexSDK({
  apiKey: appConfig.DEFINDEX_API_KEY,
  baseUrl: appConfig.DEFINDEX_API_URL,
});

export const getDefindexNetwork = (network: 'mainnet' | 'testnet'): SupportedNetworks =>
  network === 'testnet' ? SupportedNetworks.TESTNET : SupportedNetworks.MAINNET;

export { defindexSDK };
