import { Button } from '@/components/ui/button';
import { Copy, Plus, Coins, Activity, Shield, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AppHeader, Wrap } from '@/components/brand/Shell';
import { ThresholdInfoTooltip } from './ThresholdInfoTooltip';
import { MultisigConfigBuilder } from './MultisigConfigBuilder';
import { XdrDetails } from './XdrDetails';
import { TransactionSigningPanel } from './transaction/TransactionSigningPanel';
import { AccountMenu } from './AccountMenu';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { AssetBalancePanel } from './AssetBalancePanel';
import { TransactionHistoryPanel } from './history/TransactionHistoryPanel';
import { useAssetPrices } from '@/hooks/useAssetPrices';
import { useDefindexPositions } from '@/hooks/useDefindexPositions';
import { useNetwork } from '@/contexts/NetworkContext';
import { useRefreshOnNewTransaction } from '@/hooks/useRefreshOnNewTransaction';

import type { AccountData } from '@/lib/stellar';
import { readUrlParam, updateUrlParams } from '@/lib/urlState';
import { signerTypeLabel } from '@/lib/labels';
import { shortAddress } from '@/lib/xdr/describe';

const DASHBOARD_TABS = ['balances', 'activity', 'multisig'];
const initialTabFromUrl = () => {
  const tab = readUrlParam('tab');
  return tab && DASHBOARD_TABS.includes(tab) ? tab : 'balances';
};

const TABS = [
  { value: 'balances', label: 'Balances', icon: Coins },
  { value: 'activity', label: 'Activity', icon: Activity },
  { value: 'multisig', label: 'Multisig', icon: Shield },
] as const;

/** A row action without a frame: a 32 px glyph area inside a 44 px hit area. */
const inlineIcon =
  'box-content inline-grid size-8 shrink-0 place-items-center -m-1.5 p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4';

/**
 * Held signer weight against the weight an operation needs: one line-2 cell per unit held,
 * and a white tick where the need falls. Above 12 units one bar is drawn instead.
 */
const ThresholdStrip = ({ need, have, label }: { need: number; have: number; label: string }) => {
  const total = Math.max(need, have, 1);
  const tick = Math.min(need, total);
  const proportional = total > 12;
  const left = proportional
    ? `calc(${(tick / total) * 100}% - 1px)`
    : tick === 0
      ? '0px'
      : tick === total
        ? 'calc(100% - 2px)'
        : `calc((100% - ${(total - 1) * 4}px) * ${tick} / ${total} + ${(tick - 1) * 4 + 1}px)`;
  return (
    <div className="relative py-[5px]">
      {proportional ? (
        <div role="img" aria-label={label} className="h-2.5 border border-line-2 bg-ink-3">
          <div className="h-full bg-line-2" style={{ width: `${(have / total) * 100}%` }} />
        </div>
      ) : (
        <div role="img" aria-label={label} className="strip">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < have ? 'held' : ''} />
          ))}
        </div>
      )}
      <span aria-hidden="true" className="absolute top-0 h-5 w-0.5 bg-foreground" style={{ left }} />
    </div>
  );
};

/** A top-level block: bare with a full-bleed divider on the phone, a panel from md up. */
const Section = ({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) => (
  <section className={cn('border-t border-line md:border md:bg-ink-2', className)} {...props}>
    {children}
  </section>
);

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
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [multisigConfigXdr, setMultisigConfigXdr] = useState<string | null>(null);

  const { network: currentNetwork } = useNetwork();
  useRefreshOnNewTransaction(multisigConfigXdr ?? '', currentNetwork, onRefreshBalances);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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

  // Editing the configuration is part of the Multisig tab
  const litTab = activeTab === 'multisig-edit' ? 'multisig' : activeTab;
  const showEditButton = activeTab === 'multisig' && !multisigConfigXdr;
  const openEditConfirm = () => setShowEditConfirm(true);

  const totalWeight = accountData.signers.reduce((sum, signer) => sum + signer.weight, 0);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader
        nav={
          <nav aria-label="Account" className="flex">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                aria-current={litTab === tab.value ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  litTab === tab.value
                    ? 'text-foreground shadow-[inset_0_-2px_0_hsl(var(--foreground))]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        }
        right={
          <>
            <Button onClick={onInitiateTransaction} className="hidden md:inline-flex">
              <Plus />
              New Transaction
            </Button>
            <AccountMenu publicKey={accountData.publicKey} network={currentNetwork} onDisconnect={onDisconnect} />
          </>
        }
      />

      <Wrap className="flex flex-col px-0 sm:px-0 md:gap-6 md:px-8 md:py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsContent value="balances" className="mt-0">
            <AssetBalancePanel balances={mergedBalances} onRefreshBalances={handleRefreshBalances} />
          </TabsContent>

          <TabsContent value="activity" className="mt-0" forceMount>
            <div style={{ display: activeTab === "activity" ? "block" : "none" }}>
              <TransactionHistoryPanel
                accountPublicKey={accountData.publicKey}
                balances={accountData.balances}
                totalPortfolioValueUSD={totalValueUSD}
                active={activeTab === "activity"}
              />
            </div>
          </TabsContent>

          <TabsContent value="multisig" className="mt-0">
            {/* The multisig tab's action, at the top */}
            {showEditButton && (
              <div className="border-t border-line p-4 md:mb-6 md:flex md:justify-end md:border-0 md:p-0">
                <Button variant="outline" className="w-full md:w-auto" onClick={openEditConfirm}>
                  Edit Configuration
                </Button>
              </div>
            )}
            {!multisigConfigXdr && (
              <div className="grid items-start md:grid-cols-2 md:gap-6">
                {/* Read-only thresholds */}
                <Section aria-labelledby="operation-thresholds">
                  <div className="p-4">
                    <div className="flex min-h-11 items-center justify-between gap-3">
                      <h2 id="operation-thresholds" className="sec">Operation Thresholds</h2>
                      <ThresholdInfoTooltip />
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Required signature weights for different operations
                    </p>
                  </div>
                  <ul>
                    {[
                      { label: 'Low', value: accountData.thresholds.low_threshold },
                      { label: 'Medium', value: accountData.thresholds.med_threshold },
                      { label: 'High', value: accountData.thresholds.high_threshold },
                    ].map((threshold) => (
                      <li key={threshold.label} className="flex flex-col gap-2 border-t border-line px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-semibold">{threshold.label}</span>
                          <span className="font-amount text-[13px] text-muted-foreground">
                            Need {threshold.value} · Have {totalWeight}
                          </span>
                        </div>
                        <ThresholdStrip
                          need={threshold.value}
                          have={totalWeight}
                          label={`Signers hold ${totalWeight}, ${threshold.label.toLowerCase()} needs ${threshold.value}`}
                        />
                      </li>
                    ))}
                  </ul>
                </Section>

                {/* Read-only signers */}
                <Section aria-labelledby="authorized-signers">
                  <div className="p-4">
                    <div className="flex min-h-11 items-center">
                      <h2 id="authorized-signers" className="sec">Authorized Signers</h2>
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Accounts authorized to sign transactions
                    </p>
                  </div>
                  <TooltipProvider>
                    <ul>
                      {accountData.signers.map((signer) => (
                        <li key={signer.key} className="flex items-center gap-3 border-t border-line px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help font-address text-[13px]">{shortAddress(signer.key)}</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-xs">
                                  <p className="font-address text-xs break-all">{signer.key}</p>
                                </TooltipContent>
                              </Tooltip>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(signer.key)}
                                className={inlineIcon}
                                aria-label="Copy signer key"
                              >
                                <Copy />
                              </button>
                            </div>
                            <p className="text-[13px] text-muted-foreground">{signerTypeLabel(signer.type)}</p>
                          </div>
                          <span className="whitespace-nowrap text-right text-[13px] text-muted-foreground">
                            Weight {signer.weight}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </TooltipProvider>
                </Section>
              </div>
            )}
          </TabsContent>

          {/* Guarded Edit Flow */}
          <TabsContent value="multisig-edit" className="mt-0">
            {activeTab === 'multisig-edit' && (
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
            )}
          </TabsContent>
        </Tabs>

        {/* Confirmation sheet */}
        <Dialog open={showEditConfirm} onOpenChange={setShowEditConfirm}>
          <DialogContent className="[&>button:last-child]:hidden">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <DialogTitle className="pr-0 text-warning">Proceed with Caution</DialogTitle>
                <DialogDescription className="mt-2 text-foreground">
                  Editing multisig settings is sensitive. Misconfiguration can lock you out. Continue only if you fully understand thresholds and signer weights.
                </DialogDescription>
              </div>
            </div>
            <div className="mt-2 flex gap-2 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
              <Button variant="outline" onClick={() => setShowEditConfirm(false)}>Cancel</Button>
              <Button variant="warn" onClick={() => { setShowEditConfirm(false); setActiveTab('multisig-edit'); }}>Continue</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Multisig configuration change: review, sign, submit or coordinate */}
        <div className={cn('flex flex-col gap-6 px-4 md:px-0 max-md:[&_.dock]:bottom-[calc(60px+env(safe-area-inset-bottom))]', multisigConfigXdr && 'border-t border-line pt-4 md:border-0 md:pt-0')}>
          {multisigConfigXdr && (
            <>
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                <h2 className="sec">Configuration Change</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMultisigConfigXdr(null);
                    setActiveTab('multisig-edit');
                  }}
                >
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
      </Wrap>

      {/* Phone: the bottom tab bar, after the page's footer; Create starts a transaction */}
      {createPortal(
        <nav aria-label="Account" className="tabbar md:hidden">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              aria-current={litTab === tab.value ? 'page' : undefined}
              className={cn(
                'flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                litTab === tab.value
                  ? 'text-foreground shadow-[inset_0_2px_0_hsl(var(--foreground))]'
                  : 'text-muted-foreground'
              )}
            >
              <tab.icon className="h-5 w-5" aria-hidden="true" />
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onInitiateTransaction}
            className="flex min-h-[60px] flex-col items-center justify-center gap-0.5 bg-acid text-xs text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            Create
          </button>
        </nav>,
        document.body,
      )}
    </div>
  );
};

export default AccountOverview;
