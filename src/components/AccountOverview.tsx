import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Copy, Shield, Users, AlertTriangle, Settings, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useState } from 'react';
import { AssetIcon } from './AssetIcon';
import { AssetBalancePanel } from './AssetBalancePanel';

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

export const AccountOverview = ({ accountData, onInitiateTransaction, onSignTransaction, onDisconnect, onRefreshBalances }: AccountOverviewProps) => {
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

  return (
    <div className="min-h-screen bg-background p-3 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold whitespace-nowrap">Multisig Wallet</h1>
            <p className="text-muted-foreground text-sm">Manage your Stellar multisig operations</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
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
                  <p className="font-mono text-xs sm:text-sm break-all">{accountData.publicKey}</p>
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

        {/* Balances */}
        <AssetBalancePanel balances={accountData.balances} onRefreshBalances={onRefreshBalances} />

        <div className="grid md:grid-cols-2 gap-6">
          {/* Thresholds */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                  Operation Thresholds
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" className="shrink-0">
                        <Info className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      <div className="space-y-2 text-sm">
                        <p><strong>Low threshold:</strong> Trust lines, bump sequence</p>
                        <p><strong>Medium threshold:</strong> Payments, offers, manage data</p>
                        <p><strong>High threshold:</strong> Account changes, merge account</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
                        <p className="text-sm text-muted-foreground">Required: {threshold.value}</p>
                      </div>
                      <Badge variant={status.color === 'success' ? 'default' : 'secondary'}>
                        {currentWeight}/{threshold.value}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Signers */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 whitespace-nowrap text-base sm:text-lg">
                <Users className="w-5 h-5" />
                Authorized Signers
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
                              <p className="font-mono text-sm cursor-help hover:text-primary transition-colors">
                                {truncateKey(signer.key)}
                              </p>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                              <p className="font-mono text-xs break-all">{signer.key}</p>
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
                        Weight: {signer.weight}
                      </Badge>
                    </div>
                  ))}
                </TooltipProvider>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};