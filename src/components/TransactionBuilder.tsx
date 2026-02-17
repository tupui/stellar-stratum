import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Send, FileCode, Shield, Share2, ExternalLink, AlertTriangle, ArrowLeftRight, Landmark } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  Transaction, 
  TransactionBuilder as StellarTransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo,
  Horizon,
  StrKey
} from '@stellar/stellar-sdk';
import { generateDetailedFingerprint } from '@/lib/xdr/fingerprint';
import { submitTransaction, submitToRefractor, pullFromRefractor, createHorizonServer, getNetworkPassphrase } from '@/lib/stellar';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { XdrDetails } from './XdrDetails';
import { SignerSelector } from './SignerSelector';
import { NetworkSelector } from './NetworkSelector';
import { RefractorIntegration } from './RefractorIntegration';
import { SuccessModal } from './SuccessModal';
import { ErrorHandlers } from '@/lib/error-handling';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { getAssetPrice } from '@/lib/reflector';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { PaymentForm } from './payment/PaymentForm';
import { ImportTab } from './ImportTab';
import { TransactionSubmitter } from './transaction/TransactionSubmitter';
import { SourceAccountSelector } from './SourceAccountSelector';
import { SoroswapTab } from './soroswap/SoroswapTab';
import { DeFindexTab } from './defindex/DeFindexTab';


interface PaymentData { destination: string; amount: string; asset: string; assetIssuer?: string; memo?: string }
interface BatchPayment { destination: string; amount?: string; asset?: string; assetIssuer?: string; memo?: string; isAccountClosure?: boolean; receiveAsset?: string; receiveAssetIssuer?: string; slippageTolerance?: number }
interface PathPaymentData { destination: string; amount: string; asset: string; assetIssuer?: string; receiveAsset: string; receiveAssetIssuer?: string; slippageTolerance?: number; memo?: string }

interface TransactionBuilderProps {
  onBack: () => void;
  accountPublicKey: string; // Source account for transactions (editable)
  signerPublicKey?: string; // Connected wallet's public key (signer)
  accountData: {
    balances: Array<{
      asset_type: string;
      asset_code?: string;
      asset_issuer?: string;
      balance: string;
    }>;
    signers: Array<{
      key: string;
      weight: number;
      type: string;
    }>;
    thresholds: {
      low_threshold: number;
      med_threshold: number;
      high_threshold: number;
    };
  } | null;
  initialTab?: string;
  pendingId?: string;
  initialXdr?: string;
  onAccountRefresh?: () => Promise<void>;
  onSourceAccountChange?: (newSourceAccount: string) => void;
}

export const TransactionBuilder = ({ onBack, accountPublicKey, signerPublicKey, accountData, initialTab = 'payment', pendingId, initialXdr, onAccountRefresh, onSourceAccountChange }: TransactionBuilderProps) => {
  const { toast } = useToast();
  const { network: currentNetwork, setNetwork: setCurrentNetwork } = useNetwork();
  const { signWithWallet } = useWalletKit();
  const { quoteCurrency, availableCurrencies, getCurrentCurrency } = useFiatCurrency();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [paymentData, setPaymentData] = useState({
    destination: '',
    amount: '',
    asset: 'XLM',
    assetIssuer: '',
    memo: '',
  });
  const [trustlineError, setTrustlineError] = useState<string>('');
  const [xdrData, setXdrData] = useState({
    input: '',
    output: '',
  });
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isSubmittingToNetwork, setIsSubmittingToNetwork] = useState(false);
  const [isTransactionBuilt, setIsTransactionBuilt] = useState(false);
  const [isSubmittingToRefractor, setIsSubmittingToRefractor] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signedBy, setSignedBy] = useState<Array<{ signerKey: string; signedAt: Date }>>([]);
  const [refractorId, setRefractorId] = useState<string>('');
  const [successData, setSuccessData] = useState<{ hash: string; network: 'mainnet' | 'testnet'; type: 'network' | 'refractor' | 'offline'; xdr?: string } | null>(null);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    // Reset tab-specific state when switching tabs to avoid stale data
    setTrustlineError('');
    setSignedBy([]);
    setRefractorId('');
    setSuccessData(null);

    setIsTransactionBuilt(false);

    if (activeTab === 'import') {
      // Switching to Import view: clear payment-only state, keep XDR intact
      setPaymentData({ destination: '', amount: '', asset: 'XLM', assetIssuer: '', memo: '' });
    } else {
      // For payment, soroswap, defindex tabs — clear XDR state
      setXdrData({ input: '', output: '' });
    }
  }, [activeTab]);

  // Check for deep link data on mount
  const handleXdrInputChange = useCallback((xdr: string) => {
    setXdrData(prev => ({ ...prev, input: xdr }));
    
    // Auto-validate XDR on input change
    if (xdr.trim()) {
      try {
        const networkPassphrase = getNetworkPassphrase(currentNetwork);
        new Transaction(xdr.trim(), networkPassphrase);
        // Clear any previous errors silently
      } catch (parseError) {
        // Invalid XDR - user is still typing, don't show error yet
      }
    }
  }, [currentNetwork]);

  useEffect(() => {
    const deepLinkXdr = sessionStorage.getItem('deeplink-xdr');
    const deepLinkRefractorId = sessionStorage.getItem('deeplink-refractor-id');
    
    if (deepLinkXdr) {
      // Use the same processing as Import tab
      handleXdrInputChange(deepLinkXdr);
      setActiveTab('import');
      if (deepLinkRefractorId) setRefractorId(deepLinkRefractorId);
      // Clear the deep link data to prevent reprocessing
      sessionStorage.removeItem('deeplink-xdr');
      sessionStorage.removeItem('deeplink-refractor-id');
      sessionStorage.removeItem('deeplink-source-account');
      toast({ title: 'Transaction Loaded', description: 'XDR loaded for review and signing.', duration: 3000 });
    } else if (initialXdr) {
      // Pre-load XDR from multisig flow
      handleXdrInputChange(initialXdr);
      setActiveTab('import');
      toast({ title: 'Multisig Transaction Loaded', description: 'Ready for signing.', duration: 3000 });
    }
  }, [initialXdr, handleXdrInputChange, toast]);

  // Also handle deep link events when already on the builder
  useEffect(() => {
    const handleDeepLinkEvent = () => {
      const deepLinkXdr = sessionStorage.getItem('deeplink-xdr');
      const deepLinkRefractorId = sessionStorage.getItem('deeplink-refractor-id');
      if (deepLinkXdr) {
        handleXdrInputChange(deepLinkXdr);
        setActiveTab('import');
        if (deepLinkRefractorId) setRefractorId(deepLinkRefractorId);
        sessionStorage.removeItem('deeplink-xdr');
        sessionStorage.removeItem('deeplink-refractor-id');
        sessionStorage.removeItem('deeplink-source-account');
        toast({ title: 'Transaction Loaded', description: 'XDR loaded for review and signing.', duration: 3000 });
      }
    };
    // Custom event for deep link handling
    window.addEventListener('deeplink:xdr-loaded', handleDeepLinkEvent as EventListener);
    return () => window.removeEventListener('deeplink:xdr-loaded', handleDeepLinkEvent as EventListener);
  }, [handleXdrInputChange, toast]);


  // Function to fetch additional asset prices with timeout
  const fetchAdditionalAssetPrice = useCallback(async (assetCode: string, assetIssuer?: string) => {
    const key = assetCode;
    try {
      const pricePromise = getAssetPrice(assetCode === 'XLM' ? undefined : assetCode, assetIssuer);
      const price = await Promise.race([
        pricePromise,
        new Promise<number>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 2000)
        )
      ]);
      
      setAssetPrices(prev => ({
        ...prev,
        [key]: price
      }));
      return price;
    } catch (error) {
      setAssetPrices(prev => ({
        ...prev,
        [key]: 0
      }));
      return 0;
    }
  }, []);

  // Memoize account balances to prevent unnecessary re-renders
  const memoizedBalances = useMemo(() => accountData?.balances || [], [accountData?.balances]);

  useEffect(() => {
    // Load asset prices for fiat conversion in parallel for better performance
    if (!memoizedBalances.length) return;
    
    const loadPrices = async () => {
      const pricePromises = memoizedBalances.map(async (balance) => {
        const key = balance.asset_code || 'XLM';
        try {
          const price = await getAssetPrice(balance.asset_code, balance.asset_issuer);
          return { key, price };
        } catch (error) {
          return { key, price: 0 };
        }
      });
      
      const results = await Promise.allSettled(pricePromises);
      const prices: Record<string, number> = {};
      
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          prices[result.value.key] = result.value.price;
        }
      });
      
      setAssetPrices(prices);
    };
    loadPrices();
  }, [memoizedBalances]);
  const checkAccountExists = useCallback(async (destination: string) => {
    try {
      const server = createHorizonServer(currentNetwork);
      await server.loadAccount(destination);
      return true;
    } catch (error) {
      ErrorHandlers.accountNotFound(destination);
      return false;
    }
  }, [currentNetwork]);

  const checkTrustline = useCallback(async (destination: string, assetCode: string, assetIssuer: string) => {
    if (assetCode === 'XLM') return true;
    
    try {
      const server = createHorizonServer(currentNetwork);
      
      const account = await server.loadAccount(destination);
      const hasTrustline = account.balances.some(balance => 
        'asset_code' in balance && 
        balance.asset_code === assetCode && 
        balance.asset_issuer === assetIssuer
      );
      
      return hasTrustline;
    } catch (error) {
      // If we can't load the account, it doesn't exist
      ErrorHandlers.accountNotFound(destination);
      throw new Error('Account does not exist');
    }
  }, [currentNetwork]);

  const createTrustlineRemovalOperations = () => {
    // Create operations to remove all existing trustlines before account merge
    // Note: XLM (native asset) cannot be closed and is automatically skipped
    const trustlineRemovalOps: any[] = [];
    
    if (!accountData?.balances) return trustlineRemovalOps;
    
    accountData.balances.forEach(balance => {
      // Skip native XLM balance - it cannot be closed as it's the native asset
      if (balance.asset_type === 'native') return;
      
      // Only remove issued asset trustlines (those with asset_code and asset_issuer)
      if (balance.asset_code && balance.asset_issuer) {
        const asset = new Asset(balance.asset_code, balance.asset_issuer);
        trustlineRemovalOps.push(Operation.changeTrust({
          asset,
          limit: '0', // Setting limit to 0 removes the trustline
        }));
      }
    });
    
    return trustlineRemovalOps;
  };

  // Calculate direct exchange rate between any two assets and apply slippage
  const estimatePathReceive = (amount: string, fromAssetCode: string, toAssetCode: string, slippageTolerance = 0.5) => {
    const send = parseFloat(amount) || 0;
    if (send <= 0) return 0;
    
    // Get prices for both assets
    const fromPrice = assetPrices[fromAssetCode] || 0;
    const toPrice = assetPrices[toAssetCode] || 0;
    
    let converted = send;
    if (fromPrice > 0 && toPrice > 0) {
      // Calculate direct exchange rate: how much of toAsset per unit of fromAsset
      const exchangeRate = fromPrice / toPrice;
      converted = send * exchangeRate;
    }
    // If we don't have prices, assume 1:1 (fallback for unknown assets)
    
    // Apply slippage tolerance to get minimum receive amount
    const slippageAdjustment = 1 - (slippageTolerance / 100);
    return parseFloat((converted * slippageAdjustment).toFixed(7));
  };
  
  const handlePaymentBuild = async (paymentData?: PaymentData, isAccountMerge = false, batchPayments?: BatchPayment[], pathPayment?: PathPaymentData) => {
    setIsBuilding(true);
    setTrustlineError('');

    try {
      const networkPassphrase = getNetworkPassphrase(currentNetwork);
      const server = createHorizonServer(currentNetwork);
      const sourceAccount = await server.loadAccount(accountPublicKey);
      
      let fee = '100000'; // Default fee
      
      if (batchPayments) {
        // Calculate fee based on total operations including trustline removals for account merges
        let totalOps = batchPayments.length;
        
        // Count additional trustline removal operations for account merges
        const accountMergeCount = batchPayments.filter(p => p.isAccountClosure).length;
        if (accountMergeCount > 0 && accountData?.balances) {
          const trustlineCount = accountData.balances.filter(b => b.asset_type !== 'native').length;
          totalOps += (trustlineCount * accountMergeCount);
        }
        
        fee = (100000 * totalOps).toString();
      } else if (pathPayment) {
        fee = '200000'; // Higher fee for path payments
      } else if (isAccountMerge && accountData?.balances) {
        // Account merge requires additional operations for trustline removal
        const trustlineCount = accountData.balances.filter(b => b.asset_type !== 'native').length;
        fee = (100000 * (1 + trustlineCount)).toString();
      }
      
      const transaction = new StellarTransactionBuilder(sourceAccount, { fee, networkPassphrase }) as any;

      if (isAccountMerge) {
        // Account merge operation
        const dest = paymentData?.destination?.trim();
        if (!dest) {
          toast({
            title: 'Destination required',
            description: 'Enter a destination address to merge into.',
            variant: 'destructive',
          });
          setIsBuilding(false);
          return;
        }
        if (dest === accountPublicKey) {
          toast({
            title: 'Invalid destination',
            description: 'You cannot merge an account into itself.',
            variant: 'destructive',
          });
          setIsBuilding(false);
          return;
        }
        
        // First remove all trustlines to prevent op_has_sub_entries error
        const trustlineRemovalOps = createTrustlineRemovalOperations();
        trustlineRemovalOps.forEach(op => transaction.addOperation(op));
        
        // Then add the account merge operation
        transaction.addOperation(Operation.accountMerge({
          destination: dest,
        }));
        
      } else if (batchPayments) {
        // Batch operations: support payments, path payments, and account merges
        for (const payment of batchPayments) {
          if (!payment.destination) {
            throw new Error('Each operation must have a destination');
          }

          // Account merge
          if (payment.isAccountClosure) {
            const dest = String(payment.destination).trim();
            if (!dest || dest === accountPublicKey) {
              throw new Error('Invalid destination for account merge');
            }
            
            // First remove all trustlines to prevent op_has_sub_entries error
            const trustlineRemovalOps = createTrustlineRemovalOperations();
            trustlineRemovalOps.forEach(op => transaction.addOperation(op));
            
            // Then add the account merge operation
            transaction.addOperation(Operation.accountMerge({ destination: dest }));
            continue;
          }

          // Path payment (cross-asset)
          if (payment.receiveAsset && payment.receiveAsset !== payment.asset) {
            const sendAsset = payment.asset === 'XLM'
              ? Asset.native()
              : new Asset(payment.asset, payment.assetIssuer);
            const destAsset = payment.receiveAsset === 'XLM'
              ? Asset.native()
              : new Asset(payment.receiveAsset, payment.receiveAssetIssuer);

            // Calculate destMin using proper exchange rates from prices when available
            const destMin = estimatePathReceive(payment.amount, payment.asset, payment.receiveAsset, payment.slippageTolerance);

            transaction.addOperation(Operation.pathPaymentStrictSend({
              sendAsset,
               sendAmount: payment.amount,
               destination: payment.destination,
               destAsset,
               destMin: destMin.toString(),
              path: [],
            }));
            continue;
          }

          // Regular payment
          if (!payment.amount || !payment.asset) {
            throw new Error('Payment operation missing amount or asset');
          }
          const asset = payment.asset === 'XLM'
            ? Asset.native()
            : new Asset(payment.asset, payment.assetIssuer);
          transaction.addOperation(Operation.payment({
            destination: payment.destination,
            asset,
            amount: payment.amount,
          }));
        }
        
      } else if (pathPayment) {
        // Path payment operation
        if (!pathPayment.destination || !pathPayment.amount || !pathPayment.asset || !pathPayment.receiveAsset) {
          throw new Error('Missing required fields for path payment');
        }
        
        const sendAsset = pathPayment.asset === 'XLM' 
          ? Asset.native() 
          : new Asset(pathPayment.asset, pathPayment.assetIssuer);
          
        const destAsset = pathPayment.receiveAsset === 'XLM' 
          ? Asset.native() 
          : new Asset(pathPayment.receiveAsset, pathPayment.receiveAssetIssuer);

         // Calculate destination amount with slippage using proper exchange rates
         const destMin = estimatePathReceive(pathPayment.amount, pathPayment.asset, pathPayment.receiveAsset, pathPayment.slippageTolerance);

        transaction.addOperation(Operation.pathPaymentStrictSend({
          sendAsset,
          sendAmount: pathPayment.amount,
           destination: pathPayment.destination,
           destAsset,
           destMin: destMin.toString(),
          path: [], // In real implementation, find optimal path
        }));
        
      } else {
        // Regular payment operation
        if (!paymentData || !paymentData.destination || !paymentData.amount || !paymentData.asset) {
          toast({
            title: "Missing fields",
            description: "Please fill in all required fields",
            variant: "destructive",
          });
          return;
        }

        let accountExists = false;
        let needsCreateAccount = false;

        // First check if the destination account exists
        try {
          accountExists = await checkAccountExists(paymentData.destination);
          
          if (!accountExists) {
            // Account doesn't exist - we'll need to create it with XLM
            if (paymentData.asset !== 'XLM') {
              setTrustlineError('Cannot send non-XLM assets to accounts that don\'t exist. Please send XLM first to create the account.');
              setIsBuilding(false);
              return;
            }
            
            // Check minimum balance for account creation (1 XLM minimum)
            const amount = parseFloat(paymentData.amount);
            if (amount < 1) {
              setTrustlineError('Account creation requires a minimum of 1 XLM to fund the new account.');
              setIsBuilding(false);
              return;
            }
            
            needsCreateAccount = true;
            setTrustlineError('');
          } else {
            // Account exists - check trustline for non-XLM assets
            if (paymentData.asset !== 'XLM') {
              if (!paymentData.assetIssuer) {
                toast({
                  title: "Missing asset issuer",
                  description: "Asset issuer is required for non-XLM assets",
                  variant: "destructive",
                });
                setIsBuilding(false);
                return;
              }

              try {
                const hasTrustline = await checkTrustline(paymentData.destination, paymentData.asset, paymentData.assetIssuer);
                if (!hasTrustline) {
                  setTrustlineError('The destination account does not have a trustline for this asset');
                  setIsBuilding(false);
                  return;
                }
              } catch (error) {
                setTrustlineError(error instanceof Error ? error.message : 'Failed to verify trustline');
                setIsBuilding(false);
                return;
              }
            }
          }
        } catch (error) {
          setTrustlineError('Failed to verify destination account');
          setIsBuilding(false);
          return;
        }

        // Add appropriate operation based on account existence
        if (needsCreateAccount) {
          transaction.addOperation(Operation.createAccount({
            destination: paymentData.destination,
            startingBalance: paymentData.amount,
          }));
        } else {
          const asset = paymentData.asset === 'XLM' 
            ? Asset.native() 
            : new Asset(paymentData.asset, paymentData.assetIssuer);
          
          transaction.addOperation(Operation.payment({
            destination: paymentData.destination,
            asset,
            amount: paymentData.amount,
          }));
        }
      }

      // Add memo if provided
      const memoText = pathPayment?.memo || paymentData?.memo || (batchPayments && batchPayments[0]?.memo);
      if (memoText) {
        transaction.addMemo(Memo.text(memoText));
      }

      // Set timeout
      transaction.setTimeout(86400);

      // Build the transaction
      const builtTransaction = transaction.build();
      const xdr = builtTransaction.toXDR();
      
      
      setXdrData(prev => ({ ...prev, output: xdr }));
      setIsTransactionBuilt(true);
      
      let description = "XDR is ready for signing";
      if (isAccountMerge) {
        description = "Account merge transaction ready for signing";
      } else if (batchPayments) {
        description = `${batchPayments.length} operations ready for signing`;
      } else if (pathPayment) {
        description = "Cross-asset payment ready for signing";
      }
      
      toast({
        title: "Transaction built successfully",
        description,
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Build failed",
        description: error instanceof Error ? error.message : "Failed to build transaction",
        variant: "destructive",
      });
    } finally {
      setIsBuilding(false);
    }
  };


  const handleSdkBuild = (xdr: string) => {
    setXdrData(prev => ({ ...prev, output: xdr }));
    setIsTransactionBuilt(true);
    setSignedBy([]);
    toast({
      title: 'Transaction built',
      description: 'Review the transaction details below and sign when ready.',
      duration: 3000,
    });
  };

  // Note: Signing is handled through handleSignWithSigner which correctly passes walletId

  const handleSignWithSigner = async (signerKey: string, walletId: string) => {
    const xdrToSign = xdrData.output || xdrData.input;
    if (!xdrToSign) return;

    setIsSigning(true);
    try {
      const { signedXdr, address, walletName } = await signWithWallet(xdrToSign, walletId);

      if (address !== signerKey) {
        throw new Error(
          `Selected wallet (${walletName}) returned a different address. ` +
          `Expected ${signerKey.slice(0, 8)}... but got ${address.slice(0, 8)}... ` +
          `Please switch account in the wallet to match the signer and try again.`
        );
      }

      setXdrData(prev => ({ ...prev, output: signedXdr }));

      // Add to signed by list
      setSignedBy(prev => [...prev, { signerKey, signedAt: new Date() }]);

      toast({
        title: 'Transaction signed',
        description: `Signed with ${walletName}`,
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: 'Signing failed',
        description: error instanceof Error ? error.message : 'Failed to sign transaction',
        variant: 'destructive',
      });
    } finally {
      setIsSigning(false);
    }
  };

  const handleSubmitToNetwork = async () => {
    const xdrToSubmit = xdrData.output;
    if (!xdrToSubmit) return;
    
    setIsSubmittingToNetwork(true);
    try {
      const result = await submitTransaction(xdrToSubmit, currentNetwork);
      
      // Store success data for display
      setSuccessData({ hash: result.hash, network: currentNetwork, type: 'network' });
      
      // Reset form
      setXdrData({ input: '', output: '' });
      setSignedBy([]);
      
      // If this was a multisig configuration change, refresh account data
      if (activeTab === 'multisig' && onAccountRefresh) {
        await onAccountRefresh();
      }
    } catch (error) {
      toast({
        title: "Submission failed",
        description: error instanceof Error ? error.message : "Failed to submit transaction",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingToNetwork(false);
    }
  };

  const handleSubmitToRefractor = async () => {
    const xdrToSubmit = xdrData.output || xdrData.input;
    if (!xdrToSubmit) return;
    
    setIsSubmittingToRefractor(true);
    try {
      const id = await submitToRefractor(xdrToSubmit, currentNetwork);
      setRefractorId(id);
      
      // Show success modal instead of just toast
      setSuccessData({ hash: id, network: currentNetwork, type: 'refractor' });
    } catch (error) {
      toast({
        title: "Refractor submission failed",
        description: error instanceof Error ? error.message : "Failed to submit to Refractor",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingToRefractor(false);
    }
  };

  const handlePullFromRefractor = async (id: string) => {
    try {
      const xdr = await pullFromRefractor(id);
      setXdrData(prev => ({ ...prev, input: xdr, output: '' }));
      setSignedBy([]);

      toast({
        title: "Transaction pulled from Refractor",
        description: "XDR loaded successfully",
        duration: 2000,
      });
    } catch (error) {
      toast({
        title: "Failed to pull from Refractor",
        description: error instanceof Error ? error.message : "Invalid Refractor ID or network error",
        variant: "destructive",
      });
    }
  };

  const handleCopyXdr = async () => {
    const xdrToCopy = xdrData.output || xdrData.input;
    if (!xdrToCopy) return;
    
    try {
      await navigator.clipboard.writeText(xdrToCopy);
      setCopied(true);
      toast({
        title: 'XDR copied',
        description: 'Transaction XDR copied to clipboard',
        duration: 2000,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: 'Could not copy XDR to clipboard',
        variant: 'destructive',
      });
    }
  };

  const handleSubmitForSignature = async (): Promise<string> => {
    if (!xdrData.output) {
      throw new Error("No transaction to submit");
    }

    const id = await submitToRefractor(xdrData.output, currentNetwork);
    setRefractorId(id);
    toast({
      title: "Transaction submitted for signature",
      description: "Share the link with other signers",
      duration: 5000,
    });
    return id;
  };

  const getExistingSignedKeys = (): string[] => {
    const xdrToCheck = xdrData.output || xdrData.input;
    if (!xdrToCheck || !accountData?.signers) return [];
    try {
      const parsed = StellarTransactionBuilder.fromXDR(xdrToCheck, getNetworkPassphrase(currentNetwork)) as any;
      const collectHints = (tx: any) => (tx?.signatures || []).map((s: any) => s.hint());
      const hints: Buffer[] = parsed?.innerTransaction
        ? [...collectHints(parsed.innerTransaction), ...collectHints(parsed)]
        : collectHints(parsed);
      const set = new Set<string>();
      hints.forEach((hint) => {
        accountData.signers.forEach((signer) => {
          try {
            const raw = Buffer.from(StrKey.decodeEd25519PublicKey(signer.key));
            const signerHint = raw.subarray(raw.length - 4);
            if (Buffer.compare(hint, signerHint) === 0) {
              set.add(signer.key);
            }
          } catch {
            // Invalid signer key format, skip
          }
        });
      });
      return Array.from(set);
    } catch {
      // XDR parsing failed
      return [];
    }
  };

  const getCurrentWeight = () => {
    if (!accountData?.signers) return 0;
    
    const existing = getExistingSignedKeys();
    const allSignedKeys = [...new Set([
      ...signedBy.map(s => s.signerKey),
      ...existing
    ])];
    return allSignedKeys.reduce((total, signerKey) => {
      const signer = accountData.signers.find(s => s.key === signerKey);
      return total + (signer?.weight || 0);
    }, 0);
  };

  const getRequiredWeight = () => {
    if (!accountData?.thresholds) return 1;
    
    // For multisig config changes, we need high threshold
    const isMultisigTab = activeTab === 'multisig';
    const threshold = isMultisigTab 
      ? accountData.thresholds.high_threshold 
      : accountData.thresholds.med_threshold;
    // If threshold is 0, default to 1 signature required
    return threshold || 1;
  };

  const canSubmitToNetwork = accountData?.signers && accountData.signers.length > 0 && getCurrentWeight() >= getRequiredWeight();
  const canSubmitToRefractor = Boolean(xdrData.output || xdrData.input) && currentNetwork === 'mainnet';

  const copyXDR = async () => {
    const textToCopy = xdrData.output || xdrData.input;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied to clipboard",
        description: "XDR has been copied",
        duration: 3000,
      });
    }
  };

  // Get available assets from account balances with prices and balances
  const getAvailableAssets = () => {
    if (!accountData?.balances) return [];
    
    // Deduplicate by asset code (choose the trustline with the largest balance for that code)
    const byCode = new Map<string, { code: string; issuer: string; name: string; balance: string; price: number }>();

    // Add XLM first
    const xlmBalance = accountData.balances.find((b) => b.asset_type === 'native')?.balance || '0';
    byCode.set('XLM', {
      code: 'XLM',
      issuer: '',
      name: 'Stellar Lumens',
      balance: xlmBalance,
      price: assetPrices['XLM'] || 0,
    });

    // Consider other assets; if multiple issuers share the same code, keep the one with the highest balance
    accountData.balances.forEach((balance) => {
      if (balance.asset_type !== 'native' && balance.asset_code && balance.asset_issuer) {
        const existing = byCode.get(balance.asset_code);
        if (!existing || parseFloat(balance.balance) > parseFloat(existing.balance)) {
          byCode.set(balance.asset_code, {
            code: balance.asset_code,
            issuer: balance.asset_issuer,
            name: balance.asset_code,
            balance: balance.balance,
            price: assetPrices[balance.asset_code] || 0,
          });
        }
      }
    });

    return Array.from(byCode.values());
  };


  return (
    <div className="min-h-screen bg-background p-3 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Button 
            onClick={onBack}
            className="self-start bg-success hover:bg-success/90 text-success-foreground"
          >
            {accountPublicKey ? 'Back to Wallet' : 'Connect Wallet'}
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold whitespace-nowrap">Transaction Builder</h1>
            <p className="text-muted-foreground text-sm">Create and prepare transactions for multisig</p>
          </div>
        </div>

        {/* Source Account Selector - Editable */}
        {accountData && (
          <Card className="shadow-card">
            <CardContent className="pt-4 sm:pt-6">
              <SourceAccountSelector
                sourceAccount={accountPublicKey}
                connectedWalletKey={signerPublicKey || ''}
                onSourceAccountChange={(newAccount) => onSourceAccountChange?.(newAccount)}
                network={currentNetwork}
              />
            </CardContent>
          </Card>
        )}

        {/* Transaction Builder */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg whitespace-nowrap flex items-center gap-2">
              <FileCode className="w-4 h-4" />
              Build Transaction
            </CardTitle>
            <CardDescription>
              Create payments, swap tokens, manage vaults, or import transactions for signing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="p-2 bg-muted/50 rounded-lg">
                <TabsList className="grid grid-cols-4 w-full p-0 bg-transparent gap-2">
                  <TabsTrigger
                    value="payment"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Send className="w-4 h-4" />
                    <span>Payment</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="import"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <FileCode className="w-4 h-4" />
                    <span>Import</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="soroswap"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    <span>Soroswap</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="defindex"
                    className="w-full h-10 flex items-center gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md border-0 px-3"
                  >
                    <Landmark className="w-4 h-4" />
                    <span>DeFindex</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="payment" className="space-y-4 mt-6">
                <PaymentForm
                  paymentData={paymentData}
                  onPaymentDataChange={(data) => {
                    setPaymentData(data);
                    if (data.asset !== paymentData.asset) {
                      setTrustlineError(''); // Clear error when changing asset
                    }
                  }}
                  availableAssets={getAvailableAssets()}
                  assetPrices={assetPrices}
                  onFetchAssetPrice={fetchAdditionalAssetPrice}
                  trustlineError={trustlineError}
                  onBuild={(paymentData, isAccountMerge, batchPayments, pathPayment) => {
                    if (isAccountMerge) {
                      handlePaymentBuild(paymentData, true);
                    } else if (batchPayments) {
                      // Always build the whole batch; mixed operations are handled inside
                      handlePaymentBuild(undefined, false, batchPayments);
                    } else if (pathPayment) {
                      // Single path payment
                      handlePaymentBuild(undefined, false, undefined, pathPayment as PathPaymentData);
                    } else {
                      handlePaymentBuild(paymentData);
                    }
                  }}
                  isBuilding={isBuilding}
                  accountData={accountData}
                  accountPublicKey={accountPublicKey}
                  isTransactionBuilt={isTransactionBuilt}
                onClearTransaction={() => {
                  setXdrData({ input: '', output: '' });
                  setSignedBy([]);
                  setRefractorId('');
                  setSuccessData(null);
                  setIsTransactionBuilt(false);
                }}
                onTransactionBuilt={() => {}}
                onResetTransactionBuilt={() => setIsTransactionBuilt(false)}
                />
              </TabsContent>

              <TabsContent value="import" className="space-y-4 mt-6">
                <ImportTab
                  xdrInput={xdrData.input}
                  onXdrInputChange={handleXdrInputChange}
                  onPullTransaction={handlePullFromRefractor}
                  lastRefractorId={refractorId}
                  network={currentNetwork}
                />
              </TabsContent>

              <TabsContent value="soroswap" className="space-y-4 mt-6">
                <SoroswapTab
                  accountPublicKey={accountPublicKey}
                  network={currentNetwork}
                  onBuild={handleSdkBuild}
                  isBuilding={isBuilding}
                  isTransactionBuilt={isTransactionBuilt}
                />
              </TabsContent>

              <TabsContent value="defindex" className="space-y-4 mt-6">
                <DeFindexTab
                  accountPublicKey={accountPublicKey}
                  accountData={accountData}
                  network={currentNetwork}
                  onBuild={handleSdkBuild}
                  isBuilding={isBuilding}
                  isTransactionBuilt={isTransactionBuilt}
                />
              </TabsContent>

            </Tabs>
          </CardContent>
        </Card>

        {/* Transaction Verification */}
        {(xdrData.output || xdrData.input) && (
          <XdrDetails 
            xdr={xdrData.output || xdrData.input}
            networkType={currentNetwork}
          />
        )}

        {/* Signing */}
        {(xdrData.output || xdrData.input) && accountData && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Sign Transaction</CardTitle>
              <CardDescription>
                Connect your wallet to add signatures to this transaction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SignerSelector
                xdr={xdrData.output || xdrData.input}
                network={currentNetwork}
                onSigned={(signedXdr, signerKey) => {
                  setXdrData(prev => ({ ...prev, output: signedXdr }));
                  setSignedBy(prev => [...prev, { signerKey, signedAt: new Date() }]);
                  toast({ title: 'Signature Added', description: `Signed by ${signerKey.slice(0, 8)}...` });
                }}
                pendingId={pendingId}
                signers={accountData.signers}
                currentAccountKey={accountPublicKey}
                signedBy={signedBy}
                requiredWeight={getRequiredWeight()}
                onSignWithSigner={handleSignWithSigner}
                isSigning={isSigning}
              />
            </CardContent>
          </Card>
        )}

        {/* Transaction Submitter with Coordination Mode */}
        <TransactionSubmitter
          xdrOutput={xdrData.output || xdrData.input || ''}
          signedBy={signedBy}
          currentWeight={getCurrentWeight()}
          requiredWeight={getRequiredWeight()}
          canSubmitToNetwork={canSubmitToNetwork}
          canSubmitToRefractor={canSubmitToRefractor}
          isSubmittingToNetwork={isSubmittingToNetwork}
          isSubmittingToRefractor={isSubmittingToRefractor}
          successData={successData}
          onCopyXdr={handleCopyXdr}
          onSubmitToNetwork={handleSubmitToNetwork}
          onSubmitToRefractor={handleSubmitToRefractor}
          onShowOfflineModal={() => {
            const xdrOutput = xdrData.output || xdrData.input || '';
            const fingerprint = generateDetailedFingerprint(xdrOutput, currentNetwork);
            setSuccessData({ 
              type: 'offline', 
              hash: fingerprint.hash, 
              network: currentNetwork,
              xdr: xdrOutput
            });
          }}
          copied={copied}
        />


        {/* Transaction Success Modal */}
        {successData && (
          <SuccessModal
            type={successData.type}
            hash={successData.type === 'network' || successData.type === 'offline' ? successData.hash : undefined}
            refractorId={successData.type === 'refractor' ? successData.hash : undefined}
            xdr={successData.xdr}
            network={successData.network}
            onClose={() => setSuccessData(null)}
            onNavigateToDashboard={onBack}
          />
        )}

      </div>
    </div>
  );
};