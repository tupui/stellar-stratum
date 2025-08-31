import { Contract, rpc, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildAssetScVal, type Asset } from './xdr-helper';

export interface OracleConfig {
  contract: string;
  base: string;
  decimals: number;
}

export class OracleClient {
  private contract: Contract;
  private rpcServer: rpc.Server;

  constructor(contractId: string, rpcUrl: string = 'https://soroban-mainnet.stellar.org') {
    this.contract = new Contract(contractId);
    this.rpcServer = new rpc.Server(rpcUrl);
  }

  /**
   * Get available assets from the oracle
   */
  async getAssets(): Promise<string[]> {
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await this.rpcServer.getAccount(simulationAccount);
    
    const transaction = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: Networks.PUBLIC,
    })
    .addOperation(this.contract.call('assets'))
    .setTimeout(30)
    .build();
    
    const simResult = await this.rpcServer.simulateTransaction(transaction);
    
    if ('error' in simResult) {
      throw new Error(`Assets fetch failed: ${simResult.error}`);
    }
    
    if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
      const { scValToNative } = await import('@stellar/stellar-sdk');
      const resultValue = scValToNative(simResult.result.retval);
      
      const assetSymbols: string[] = [];
      if (Array.isArray(resultValue)) {
        for (const asset of resultValue) {
          if (Array.isArray(asset) && asset.length === 2) {
            const [type, value] = asset;
            if (type === "Other" && value) {
              assetSymbols.push(String(value));
            } else if (type === "Stellar" && value) {
              assetSymbols.push(`stellar_${value}`);
            }
          }
        }
      }
      
      return assetSymbols;
    }
    
    return [];
  }

  /**
   * Get last price for an asset
   */
  async getLastPrice(asset: Asset): Promise<number> {
    const simulationAccount = 'GDMTVHLWJTHSUDMZVVMXXH6VJHA2ZV3HNG5LYNAZ6RTWB7GISM6PGTUV';
    const account = await this.rpcServer.getAccount(simulationAccount);
    
    const assetParam = buildAssetScVal(asset);
    
    const transaction = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: Networks.PUBLIC,
    })
    .addOperation(this.contract.call('lastprice', assetParam))
    .setTimeout(30)
    .build();
    
    const simResult = await this.rpcServer.simulateTransaction(transaction);
    
    if ('error' in simResult) {
      throw new Error(`Price fetch failed: ${simResult.error}`);
    }
    
    if ('result' in simResult && simResult.result && 'retval' in simResult.result) {
      const { scValToNative } = await import('@stellar/stellar-sdk');
      const resultValue = scValToNative(simResult.result.retval);
      
      if (resultValue && typeof resultValue === 'object') {
        let price = 0;
        
        // Handle Some(PriceData) case
        if ('Some' in resultValue && resultValue.Some) {
          const priceData = resultValue.Some;
          if (priceData && typeof priceData === 'object' && 'price' in priceData) {
            price = parseFloat(String(priceData.price));
          }
        }
        // Handle direct PriceData case  
        else if ('price' in resultValue) {
          price = parseFloat(String(resultValue.price));
        }
        // Handle if the result is a direct number
        else if (typeof resultValue === 'number' || typeof resultValue === 'string') {
          price = parseFloat(String(resultValue));
        }
        
        return price;
      }
    }
    
    return 0;
  }
}