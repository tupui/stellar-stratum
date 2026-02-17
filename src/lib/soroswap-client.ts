import { SoroswapSDK, SupportedNetworks } from '@soroswap/sdk';
import { appConfig } from './appConfig';

const soroswapSDK = new SoroswapSDK({
  apiKey: appConfig.SOROSWAP_API_KEY,
  baseUrl: appConfig.SOROSWAP_API_URL,
  defaultNetwork: SupportedNetworks.MAINNET,
});

export const getSoroswapNetwork = (network: 'mainnet' | 'testnet'): SupportedNetworks =>
  network === 'testnet' ? SupportedNetworks.TESTNET : SupportedNetworks.MAINNET;

export { soroswapSDK };
