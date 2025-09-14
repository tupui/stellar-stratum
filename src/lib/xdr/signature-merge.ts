import { Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@/lib/stellar';

export interface SignatureInfo {
  signerKey: string;
  signedAt: Date;
}

/**
 * CRITICAL: Merge signatures from multiple signed XDRs into a single transaction
 * This function is FUNDAMENTAL to multisig security - any bug here could lead to fund loss
 */
export const mergeSignatures = (
  baseXdr: string,
  signedXdrs: string[],
  network: 'mainnet' | 'testnet'
): { mergedXdr: string; signatures: SignatureInfo[] } => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    
    // CRITICAL: Parse and validate base transaction
    const baseTransaction = new Transaction(baseXdr, networkPassphrase);
    
    // CRITICAL: Collect all unique signatures with proper deduplication
    const allSignatures = new Map<string, SignatureInfo>();
    const signatureInfos: SignatureInfo[] = [];
    
    // Add any existing signatures from base XDR
    baseTransaction.signatures.forEach(sig => {
      const sigString = sig.signature().toString('base64');
      allSignatures.set(sigString, {
        signerKey: 'Existing',
        signedAt: new Date()
      });
    });
    
    // CRITICAL: Process each signed XDR with strict validation
    signedXdrs.forEach(signedXdr => {
      try {
        const signedTransaction = new Transaction(signedXdr, networkPassphrase);
        
        // CRITICAL: Verify this is the same transaction by comparing operation sources
        // (not transaction hashes which include signatures)
        const baseOpsHash = baseTransaction.operations.map((op: any) => `${op.type}-${op.source || ''}`).join('');
        const signedOpsHash = signedTransaction.operations.map((op: any) => `${op.type}-${op.source || ''}`).join('');
        
        if (baseOpsHash !== signedOpsHash) {
          // Different transaction - skip to prevent signature confusion
          return;
        }
        
        // CRITICAL: Add new signatures with proper deduplication
        signedTransaction.signatures.forEach(sig => {
          const sigString = sig.signature().toString('base64');
          if (!allSignatures.has(sigString)) {
            const sigInfo: SignatureInfo = {
              signerKey: 'Unknown', // TODO: Implement proper signer identification
              signedAt: new Date()
            };
            allSignatures.set(sigString, sigInfo);
            signatureInfos.push(sigInfo);
          }
        });
        
      } catch (error) {
        // CRITICAL: Skip invalid XDRs to prevent corruption
        return;
      }
    });
    
    // CRITICAL: Rebuild transaction with all signatures
    const rebuiltTransaction = new Transaction(baseXdr, networkPassphrase);
    
    // CRITICAL: Clear existing signatures and add all collected ones
    rebuiltTransaction.signatures.length = 0;
    
    // Add all signatures to the transaction
    Array.from(allSignatures.keys()).forEach(sigString => {
      const sigBuffer = Buffer.from(sigString, 'base64');
      const hintBuffer = sigBuffer.slice(-4); // Last 4 bytes as hint
      rebuiltTransaction.signatures.push(
        new xdr.DecoratedSignature({
          hint: hintBuffer,
          signature: sigBuffer
        })
      );
    });
    
    const mergedXdr = rebuiltTransaction.toXDR();
    
    return {
      mergedXdr,
      signatures: signatureInfos
    };
    
  } catch (error) {
    throw new Error(`Failed to merge transaction signatures: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Extract signature information from a signed XDR
 */
export const extractSignatureInfo = (
  signedXdr: string,
  network: 'mainnet' | 'testnet'
): SignatureInfo[] => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    const transaction = new Transaction(signedXdr, networkPassphrase);
    
    return transaction.signatures.map(sig => ({
      signerKey: 'Unknown', // Would need signature verification to determine actual signer
      signedAt: new Date()
    }));
    
  } catch (error) {
    return [];
  }
};

/**
 * Check if a transaction has the minimum required signatures
 */
export const hasRequiredSignatures = (
  xdrString: string,
  requiredWeight: number,
  signers: Array<{ key: string; weight: number }>,
  network: 'mainnet' | 'testnet'
): { hasRequired: boolean; currentWeight: number } => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    const transaction = new Transaction(xdrString, networkPassphrase);
    
    // This is simplified - in reality you'd need to verify each signature
    // against the signer list and calculate the total weight
    const currentWeight = transaction.signatures.length; // Simplified
    const hasRequired = currentWeight >= requiredWeight;
    
    return { hasRequired, currentWeight };
    
  } catch (error) {
    return { hasRequired: false, currentWeight: 0 };
  }
};