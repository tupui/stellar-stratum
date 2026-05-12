import { DefindexSDK } from '@defindex/sdk';
import { appConfig } from './appConfig';

const defindexSDK = new DefindexSDK({
  apiKey: appConfig.DEFINDEX_API_KEY,
  baseUrl: appConfig.DEFINDEX_API_URL,
});

export { defindexSDK };
