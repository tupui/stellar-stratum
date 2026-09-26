import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, Shield, Users, AlertTriangle, DollarSign, TrendingUp, Share2, ExternalLink, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThresholdInfoTooltip } from './ThresholdInfoTooltip';
import { MultisigConfigBuilder } from './MultisigConfigBuilder';
import { XdrDetails } from './XdrDetails';
import { TransactionSigningPanel } from './transaction/TransactionSigningPanel';
import { HorizonSettingsDialog } from './HorizonSettingsDialog';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { AssetIcon } from './AssetIcon';
import { AssetBalancePanel } from './AssetBalancePanel';
import { TransactionHistoryPanel } from './history/TransactionHistoryPanel';
import { useAssetPrices } from '@/hooks/useAssetPrices';
import { useDefindexPositions } from '@/hooks/useDefindexPositions';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';

import type { AccountData } from '@/lib/stellar';
import { buildAccountUrl, readUrlParam, updateUrlParams } from '@/lib/urlState';

const DASHBOARD_TABS = ['balances', 'activity', 'multisig'];
const initialTabFromUrl = () => {
  const tab = readUrlParam('tab');
  return tab && DASHBOARD_TABS.includes(tab) ? tab : 'balances';
};

interface AccountOverviewProps {
  accountData: AccountData;
  onInitiateTransaction: () => void;
  onDisconnect: () => void;
  onRefreshBalances: () => Promise<void>;
}

const AccountOverview = ({ accountData, onInitiateTransaction, onDisconnect, onRefreshBalances }: AccountOverviewProps) => {
  const [activeTab, setActiveTab] = useState(initialTabFromUrl);
  // Reflect the active tab in the URL so the current section can be refreshed or shared
  useEffect(() => {
    updateUrlParams({ tab: activeTab === 'multisig-edit' ? 'multisig' : activeTab });
  }, [activeTab]);
  const { quoteCurrency, setQuoteCurrency, availableCurrencies } = useFiatCurrency();
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [multisigConfigXdr, setMultisigConfigXdr] = useState<string | null>(null);

  const { toast } = useToast();
  const { network: currentNetwork } = useNetwork();
  
  
  const truncateKey = (key: string) => {
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Shareable URL that reopens this account directly (?public_key=G...), skipping manual entry
  const handleShareUrl = () => {
    navigator.clipboard.writeText(buildAccountUrl(accountData.publicKey, currentNetwork));
    toast({
      title: 'Account link copied',
      description: `Opening it loads ${accountData.publicKey.slice(0, 8)}...${accountData.publicKey.slice(-8)} directly`,
      duration: 3000,
    });
  };

  const getThresholdStatus = (current: number, required: number) => {
    if (current >= required) return { status: 'sufficient', color: 'success' };
    return { status: 'insufficient', color: 'warning' };
  };

  // DeFindex vault deposits — shown alongside wallet assets and counted in the portfolio total
  const { positions: defindexPositions, refetch: refetchDefindex } = useDefindexPositions(
    accountData.publicKey,
    currentNetwork
  );

  const mergedBalances = useMemo(() => [
    ...accountData.balances,
    ...defindexPositions.map((p) => ({
      asset_type: 'credit_alphanum4',
      asset_code: p.assetCode,
      asset_issuer: p.assetIssuer,
      balance: p.balance,
      source: 'defindex' as const,
      sourceName: p.vaultName,
      sourceAddress: p.vaultAddress,
    })),
  ], [accountData.balances, defindexPositions]);

  const handleRefreshBalances = useCallback(async () => {
    await Promise.all([onRefreshBalances(), refetchDefindex()]);
  }, [onRefreshBalances, refetchDefindex]);

  // Get portfolio value for TransactionHistoryPanel (includes DeFindex deposits)
  const { totalValueUSD } = useAssetPrices(mergedBalances);

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
              className="!bg-stellar-yellow !text-black hover:!bg-stellar-yellow/90 w-full sm:w-auto text-sm sm:text-base"
            >
              <span className="sm:hidden">Create Transaction</span>
              <span className="hidden sm:inline">Initiate Multisig Transaction</span>
            </Button>
            <HorizonSettingsDialog className="w-full sm:w-auto" />
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
                    title="Copy public key"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleShareUrl}
                    title="Copy shareable link to this account"
                  >
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    title="View on Stellar Expert"
                  >
                    <a
                      href={`https://stellar.expert/explorer/${currentNetwork === 'testnet' ? 'testnet' : 'public'}/account/${accountData.publicKey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
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
            <AssetBalancePanel balances={mergedBalances} onRefreshBalances={handleRefreshBalances} />
          </TabsContent>
          
          <TabsContent value="activity" className="mt-6" forceMount>
            <div style={{ display: activeTab === "activity" ? "block" : "none" }}>
              <TransactionHistoryPanel
                accountPublicKey={accountData.publicKey}
                balances={accountData.balances}
                totalPortfolioValueUSD={totalValueUSD}
                active={activeTab === "activity"}
              />
            </div>
          </TabsContent>

          <TabsContent value="multisig" className="mt-6">
            {!multisigConfigXdr && (
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
                            <Badge variant={status.color === 'success' ? 'default' : 'secondary'} className="font-amount">
                              <span>Need {threshold.value}</span>
                              <span className="mx-1 opacity-60">·</span>
                              <span>Have {currentWeight}</span>
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
                    onXdrGenerated={setMultisigConfigXdr}
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

      {/* Multisig configuration change: review, sign, submit or coordinate */}
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        {multisigConfigXdr && (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-semibold">Configuration change</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMultisigConfigXdr(null);
                  setActiveTab('multisig-edit');
                }}
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </div>
            <XdrDetails
              xdr={multisigConfigXdr}
              defaultExpanded={true}
              networkType={currentNetwork}
              accountData={accountData}
            />
          </>
        )}
        <TransactionSigningPanel
          xdr={multisigConfigXdr ?? ''}
          network={currentNetwork}
          account={accountData}
          onXdrChange={setMultisigConfigXdr}
          onSubmitted={async () => {
            setMultisigConfigXdr(null);
            setActiveTab('multisig');
            // The next edit must start from the signers and thresholds now on chain.
            await onRefreshBalances();
          }}
          onDone={() => setActiveTab('multisig')}
        />
      </div>
    </div>
  );
};

export default AccountOverview;