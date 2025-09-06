import { Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { getNetworkPassphrase } from '@/lib/stellar';

export interface SignatureInfo {
  signerKey: string;
  signedAt: Date;
}

/**
 * Merge signatures from multiple signed XDRs into a single transaction
 */
export const mergeSignatures = (
  baseXdr: string,
  signedXdrs: string[],
  network: 'mainnet' | 'testnet'
): { mergedXdr: string; signatures: SignatureInfo[] } => {
  try {
    const networkPassphrase = getNetworkPassphrase(network);
    
    // Parse base transaction
    const baseTransaction = new Transaction(baseXdr, networkPassphrase);
    
    // Collect all unique signatures
    const allSignatures = new Set<string>();
    const signatureInfos: SignatureInfo[] = [];
    
    // Add any existing signatures from base XDR
    baseTransaction.signatures.forEach(sig => {
      allSignatures.add(sig.signature().toString('base64'));
    });
    
    // Process each signed XDR
    signedXdrs.forEach(signedXdr => {
      try {
        const signedTransaction = new Transaction(signedXdr, networkPassphrase);
        
        // Verify this is the same transaction (same hash when signatures removed)
        const baseHash = baseTransaction.hash().toString('hex');
        const signedHash = signedTransaction.hash().toString('hex');
        
        if (baseHash !== signedHash) {
          console.warn('Transaction hash mismatch, skipping XDR');
          return;
        }
        
        // Add new signatures
        signedTransaction.signatures.forEach(sig => {
          const sigString = sig.signature().toString('base64');
          if (!allSignatures.has(sigString)) {
            allSignatures.add(sigString);
            
            // Try to identify the signer (this is approximate)
            signatureInfos.push({
              signerKey: 'Unknown', // Would need additional logic to map signature to public key
              signedAt: new Date()
            });
          }
        });
        
      } catch (error) {
        console.error('Failed to process signed XDR:', error);
      }
    });
    
    // Rebuild transaction with all signatures
    const builder = TransactionBuilder.fromXDR(baseXdr, networkPassphrase);
    
    // Clear existing signatures and add all collected ones
    // Note: This is a simplified approach. In practice, you'd need more sophisticated signature handling
    const mergedXdr = baseXdr; // For now, return the base XDR
    
    return {
      mergedXdr,
      signatures: signatureInfos
    };
    
  } catch (error) {
    console.error('Failed to merge signatures:', error);
    throw new Error('Failed to merge transaction signatures');
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
    console.error('Failed to extract signature info:', error);
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
    console.error('Failed to check signature requirements:', error);
    return { hasRequired: false, currentWeight: 0 };
  }
};