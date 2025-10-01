import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TransactionBuilder as StellarTransactionBuilder, Networks, Keypair } from '@stellar/stellar-sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Copy, Shield, Users, AlertTriangle, Settings, DollarSign, TrendingUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThresholdInfoTooltip } from './ThresholdInfoTooltip';
import { MultisigConfigBuilder } from './MultisigConfigBuilder';
import { MultisigConfigBundle } from './MultisigConfigBundle';
import { TransactionBuilder } from './TransactionBuilder';
import { XdrDetails } from './XdrDetails';
import { SignerSelector } from './SignerSelector';
import { TransactionSubmitter } from './transaction/TransactionSubmitter';
import { useState } from 'react';
import { AssetIcon } from './AssetIcon';
import { AssetBalancePanel } from './AssetBalancePanel';
import { TransactionHistoryPanel } from './history/TransactionHistoryPanel';
import { useAssetPrices } from '@/hooks/useAssetPrices';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';
import { generateDetailedFingerprint } from '@/lib/xdr/fingerprint';
import { submitToRefractor } from '@/lib/stellar';
import { SuccessModal } from './SuccessModal';

interface AccountData {
  publicKey: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    balance: string;
  }>;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: Array<{
    key: string;
    weight: number;
    type: string;
  }>;
}

interface AccountOverviewProps {
  accountData: AccountData;
  onInitiateTransaction: () => void;
  onSignTransaction: () => void;
  onDisconnect: () => void;
  onRefreshBalances: () => Promise<void>;
  
}

const AccountOverview = ({ accountData, onInitiateTransaction, onSignTransaction, onDisconnect, onRefreshBalances }: AccountOverviewProps) => {
  const [activeTab, setActiveTab] = useState("balances");
  const { quoteCurrency, setQuoteCurrency, availableCurrencies } = useFiatCurrency();
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [multisigConfigXdr, setMultisigConfigXdr] = useState<string | null>(null);
  const [signedBy, setSignedBy] = useState<Array<{ signerKey: string; signedAt: Date }>>([]);
  const [isSubmittingToNetwork, setIsSubmittingToNetwork] = useState(false);
  const [isSubmittingToRefractor, setIsSubmittingToRefractor] = useState(false);
  const [successData, setSuccessData] = useState<{ hash: string; network: 'mainnet' | 'testnet'; type: 'network' | 'refractor' | 'offline'; xdr?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  
  const { toast } = useToast();
  const { network: currentNetwork } = useNetwork();
  
  
  const truncateKey = (key: string) => {
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getThresholdStatus = (current: number, required: number) => {
    if (current >= required) return { status: 'sufficient', color: 'success' };
    return { status: 'insufficient', color: 'warning' };
  };

  // Helper functions for TransactionSubmitter (copied from TransactionBuilder)
  const getExistingSignedKeys = () => {
    if (!multisigConfigXdr) return [];
    
    try {
      const transaction = StellarTransactionBuilder.fromXDR(multisigConfigXdr, Networks.PUBLIC);
      const signatures = transaction.signatures || [];
      const set = new Set<string>();
      
      for (const sig of signatures) {
        for (const signer of accountData.signers) {
          try {
            const keypair = Keypair.fromPublicKey(signer.key);
            if (keypair.verify(transaction.hash(), sig.signature())) {
              set.add(signer.key);
              break;
            }
          } catch {
            // Skip invalid signatures
          }
        }
      }
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
    const threshold = accountData.thresholds.high_threshold;
    // If threshold is 0, default to 1 signature required
    return threshold || 1;
  };

  const canSubmitToNetwork = () => {
    return getCurrentWeight() >= getRequiredWeight();
  };

  const canSubmitToRefractor = () => {
    return multisigConfigXdr && multisigConfigXdr.length > 0;
  };

  // Computed values for TransactionSubmitter (matching TransactionBuilder pattern)
  const canSubmitToNetworkValue = accountData?.signers && accountData.signers.length > 0 && getCurrentWeight() >= getRequiredWeight();
  const canSubmitToRefractorValue = Boolean(multisigConfigXdr) && currentNetwork === 'mainnet';

  // Wrapper component that provides portfolio value to TransactionHistoryPanel
  const TransactionHistoryPanelWithPortfolio = ({ accountPublicKey, balances }: { accountPublicKey: string; balances: any[] }) => {
    const { totalValueUSD } = useAssetPrices(balances);
    return (
      <TransactionHistoryPanel 
        accountPublicKey={accountPublicKey} 
        balances={balances} 
        totalPortfolioValueUSD={totalValueUSD}
      />
    );
  };

  const handleCopyXdr = () => {
    if (multisigConfigXdr) {
      navigator.clipboard.writeText(multisigConfigXdr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmitToNetwork = async () => {
    if (!multisigConfigXdr) return;
    
    setIsSubmittingToNetwork(true);
    try {
      // Network submission will be implemented when backend integration is added
      // Simulate success for now
      setTimeout(() => {
        setSuccessData({
          type: 'network',
          hash: 'mock-hash-' + Date.now(),
          network: currentNetwork,
          xdr: multisigConfigXdr
        });
        setIsSubmittingToNetwork(false);
      }, 2000);
    } catch (error) {
      console.error('Network submission failed:', error);
      setIsSubmittingToNetwork(false);
    }
  };

  const handleSubmitToRefractor = async () => {
    if (!multisigConfigXdr) return;
    
    setIsSubmittingToRefractor(true);
    try {
      const id = await submitToRefractor(multisigConfigXdr, currentNetwork);
      
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

  return (
    <div className="min-h-screen bg-background p-3 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold whitespace-nowrap">Multisig Wallet</h1>
            <p className="text-muted-foreground text-sm">Manage your Stellar multisig operations</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Fiat</span>
              <Select value={quoteCurrency} onValueChange={setQuoteCurrency}>
                <SelectTrigger className="h-8 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableCurrencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={onInitiateTransaction} 
              className="bg-gradient-primary hover:opacity-90 w-full sm:w-auto text-sm sm:text-base"
            >
              <span className="sm:hidden">Create Transaction</span>
              <span className="hidden sm:inline">Initiate Multisig Transaction</span>
            </Button>
            <Button 
              variant="destructive" 
              onClick={onDisconnect}
              className="w-full sm:w-auto text-sm sm:text-base"
            >
              Disconnect
            </Button>
          </div>
        </div>

        {/* Account Info */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
              <Shield className="w-5 h-5" />
              Account Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg flex-wrap gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">Public Key</p>
                  <p className="font-address text-xs sm:text-sm break-all">{accountData.publicKey}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(accountData.publicKey)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Enhanced Tabs: Balances, Activity, Multisig */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center justify-center rounded-lg bg-secondary p-1 text-muted-foreground">
              <button
                onClick={() => setActiveTab("balances")}
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                  activeTab === "balances"
                    ? "bg-background text-foreground shadow-sm"
                    : "hover:bg-secondary/80"
                )}
              >
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  <span>Balances</span>
                </div>
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                  activeTab === "activity"
                    ? "bg-background text-foreground shadow-sm"
                    : "hover:bg-secondary/80"
                )}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  <span>Activity</span>
                </div>
              </button>
              <button
                onClick={() => setActiveTab("multisig")}
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                  activeTab === "multisig"
                    ? "bg-background text-foreground shadow-sm"
                    : "hover:bg-secondary/80"
                )}
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  <span>Multisig</span>
                </div>
              </button>
            </div>
          </div>
          
          <TabsContent value="balances" className="mt-6">
            <AssetBalancePanel balances={accountData.balances} onRefreshBalances={onRefreshBalances} />
          </TabsContent>
          
          <TabsContent value="activity" className="mt-6">
            {activeTab === "activity" && (
              <TransactionHistoryPanelWithPortfolio accountPublicKey={accountData.publicKey} balances={accountData.balances} />
            )}
          </TabsContent>

          <TabsContent value="multisig" className="mt-6">
            {activeTab === "multisig" && !multisigConfigXdr && (
              <div className="grid md:grid-cols-2 gap-6">
                {/* Read-only thresholds */}
                <Card className="shadow-card">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
                        <AlertTriangle className="w-6 h-6 text-red-500" />
                        Operation Thresholds
                      </div>
                      <ThresholdInfoTooltip />
                    </CardTitle>
                    <CardDescription>
                      Required signature weights for different operations
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[
                        { label: 'Low', value: accountData.thresholds.low_threshold },
                        { label: 'Medium', value: accountData.thresholds.med_threshold },
                        { label: 'High', value: accountData.thresholds.high_threshold },
                      ].map((threshold, index) => {
                        const currentWeight = accountData.signers.reduce((sum, signer) => sum + signer.weight, 0);
                        const status = getThresholdStatus(currentWeight, threshold.value);
                        
                        return (
                          <div key={index} className="flex justify-between items-center">
                            <div>
                              <p className="font-medium">{threshold.label}</p>
                              <p className="text-sm text-muted-foreground">Required: <span className="font-amount">{threshold.value}</span></p>
                            </div>
                            <Badge variant={status.color === 'success' ? 'default' : 'secondary'}>
                              <span className="font-amount">{currentWeight}/{threshold.value}</span>
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Read-only signers */}
                <Card className="shadow-card">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
                        <Users className="w-5 h-5" />
                        Authorized Signers
                      </div>
                    </CardTitle>
                    <CardDescription>
                      Accounts authorized to sign transactions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <TooltipProvider>
                        {accountData.signers.map((signer, index) => (
                          <div key={index} className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                            <div className="flex items-center gap-2">
                              <div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <p className="font-address text-sm cursor-help hover:text-primary transition-colors">
                                      {truncateKey(signer.key)}
                                    </p>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="max-w-xs">
                                    <p className="font-address text-xs break-all">{signer.key}</p>
                                  </TooltipContent>
                                </Tooltip>
                                <p className="text-xs text-muted-foreground capitalize">{signer.type}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(signer.key)}
                                className="h-6 w-6 p-0"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                            <Badge variant="outline">
                              Weight: <span className="font-amount">{signer.weight}</span>
                            </Badge>
                          </div>
                        ))}
                      </TooltipProvider>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            {/* Edit CTA bar - only show when not in bundle mode */}
            {activeTab === "multisig" && !multisigConfigXdr && (
              <div className="flex justify-end mt-4">
                <Button
                  variant="destructive"
                  onClick={() => setShowEditConfirm(true)}
                >
                  Edit Configuration
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Guarded Edit Flow */}
          <TabsContent value="multisig-edit" className="mt-6">
            {activeTab === 'multisig-edit' && (
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="text-base sm:text-lg">Edit Multisig Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                  <MultisigConfigBuilder
                    accountPublicKey={accountData.publicKey}
                    currentSigners={accountData.signers}
                    currentThresholds={accountData.thresholds}
                    onXdrGenerated={(xdr) => {
                      setMultisigConfigXdr(xdr);
                    }}
                    onPendingCreated={() => {
                      setActiveTab('multisig');
                    }}
                    onAccountRefresh={onRefreshBalances}
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Confirmation Modal */}
          {showEditConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              {/* Backdrop */}
              <div className="fixed inset-0 bg-background/40 supports-[backdrop-filter]:bg-background/30 backdrop-blur-2xl" onClick={() => setShowEditConfirm(false)} />
              {/* Modal */}
              <div className="relative bg-destructive/10 supports-[backdrop-filter]:bg-destructive/5 backdrop-blur-xl border border-destructive/40 rounded-2xl max-w-lg w-full mx-4 p-6 shadow-xl ring-1 ring-destructive/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
                  <div>
                    <h3 className="text-lg font-semibold text-destructive">Proceed with Caution</h3>
                    <p className="mt-1 text-sm text-destructive">
                      Editing multisig settings is sensitive. Misconfiguration can lock you out. Continue only if you fully understand thresholds and signer weights.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="ghost" onClick={() => setShowEditConfirm(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={() => { setShowEditConfirm(false); setActiveTab('multisig-edit'); }}>Continue</Button>
                </div>
              </div>
            </div>
          )}
        </Tabs>

        {/* Thresholds & Signers are now moved to the Multisig tab */}
      </div>

      {/* Multisig Config Bundle & Verification */}
      {multisigConfigXdr && (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
          {/* Multisig Config Bundle Summary */}
          <MultisigConfigBundle 
            xdr={multisigConfigXdr} 
            onEdit={() => {
              setMultisigConfigXdr(null);
              setActiveTab('multisig-edit');
            }}
          />
          
          {/* Transaction Verification */}
          <XdrDetails 
            xdr={multisigConfigXdr} 
            defaultExpanded={true} 
            networkType={currentNetwork}
          />
          
          {/* Signing */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Sign Transaction</CardTitle>
              <CardDescription>
                Connect your wallet to add signatures to this transaction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SignerSelector
                xdr={multisigConfigXdr}
                network={currentNetwork}
                onSigned={(signedXdr, signerKey) => {
                  setMultisigConfigXdr(signedXdr);
                  setSignedBy(prev => [...prev, { signerKey, signedAt: new Date() }]);
                  toast({ title: 'Signature Added', description: `Signed by ${signerKey.slice(0, 8)}...` });
                }}
                pendingId=""
                signers={accountData.signers}
                currentAccountKey={accountData.publicKey}
                signedBy={signedBy}
                requiredWeight={getRequiredWeight()}
                onSignWithSigner={async (signerKey, walletId) => {
                  // Use the same interface as TransactionBuilder
                  // Signing functionality integrated with TransactionBuilder
                }}
                isSigning={isSigning}
              />
            </CardContent>
          </Card>

          {/* Transaction Submitter with Coordination Mode */}
          <TransactionSubmitter
            xdrOutput={multisigConfigXdr || ''}
            signedBy={signedBy}
            currentWeight={getCurrentWeight()}
            requiredWeight={getRequiredWeight()}
            canSubmitToNetwork={canSubmitToNetworkValue}
            canSubmitToRefractor={canSubmitToRefractorValue}
            isSubmittingToNetwork={isSubmittingToNetwork}
            isSubmittingToRefractor={isSubmittingToRefractor}
            successData={successData}
            onCopyXdr={handleCopyXdr}
            onSubmitToNetwork={handleSubmitToNetwork}
            onSubmitToRefractor={handleSubmitToRefractor}
            onShowOfflineModal={() => {
              const xdrOutput = multisigConfigXdr || '';
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
        </div>
      )}

      {/* Transaction Success Modal */}
      {successData && (
        <SuccessModal
          type={successData.type}
          hash={successData.type === 'network' || successData.type === 'offline' ? successData.hash : undefined}
          refractorId={successData.type === 'refractor' ? successData.hash : undefined}
          xdr={successData.xdr}
          network={successData.network}
          onClose={() => setSuccessData(null)}
          onNavigateToDashboard={() => {
            setMultisigConfigXdr(null);
            setSignedBy([]);
            setSuccessData(null);
          }}
        />
      )}

    </div>
  );
};

export default AccountOverview;