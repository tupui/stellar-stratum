import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Copy, Eye, EyeOff, Shield, Users, AlertTriangle } from 'lucide-react';
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
}

export const AccountOverview = ({ accountData, onInitiateTransaction, onSignTransaction, onDisconnect }: AccountOverviewProps) => {
  const [showFullKey, setShowFullKey] = useState(false);

  const truncateKey = (key: string) => {
    if (showFullKey) return key;
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
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Multisig Wallet</h1>
            <p className="text-muted-foreground">Manage your Stellar multisig operations</p>
          </div>
          <div className="flex gap-3">
            <Button variant="destructive" onClick={onDisconnect}>
              Disconnect
            </Button>
            <Button onClick={onInitiateTransaction} className="bg-gradient-primary hover:opacity-90">
              Initiate Transaction
            </Button>
          </div>
        </div>

        {/* Account Info */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Account Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">Public Key</p>
                  <p className="font-mono text-sm">{truncateKey(accountData.publicKey)}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFullKey(!showFullKey)}
                  >
                    {showFullKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
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
        <AssetBalancePanel balances={accountData.balances} />

        <div className="grid md:grid-cols-2 gap-6">
          {/* Thresholds */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Operation Thresholds
              </CardTitle>
              <CardDescription>
                Required signature weights for different operations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { label: 'Low (Trust lines)', value: accountData.thresholds.low_threshold },
                  { label: 'Medium (Payments)', value: accountData.thresholds.med_threshold },
                  { label: 'High (Account changes)', value: accountData.thresholds.high_threshold },
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
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Authorized Signers
              </CardTitle>
              <CardDescription>
                Accounts authorized to sign transactions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {accountData.signers.map((signer, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                    <div>
                      <p className="font-mono text-sm">{truncateKey(signer.key)}</p>
                      <p className="text-xs text-muted-foreground capitalize">{signer.type}</p>
                    </div>
                    <Badge variant="outline">
                      Weight: {signer.weight}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};