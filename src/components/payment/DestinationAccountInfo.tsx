import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { User, Wallet, AlertCircle, CheckCircle } from 'lucide-react';
import { useNetwork } from '@/contexts/NetworkContext';
import * as StellarSDK from '@stellar/stellar-sdk';

interface DestinationAccountInfoProps {
  destination: string;
}

interface AccountData {
  exists: boolean;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
  accountId: string;
}

export const DestinationAccountInfo = ({ destination }: DestinationAccountInfoProps) => {
  const { network } = useNetwork();
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetchAccountData = async () => {
      if (!destination || destination.length !== 56 || !destination.startsWith('G')) {
        setAccountData(null);
        setError('');
        return;
      }

      setLoading(true);
      setError('');

      try {
        const server = new StellarSDK.Horizon.Server(
          network === 'testnet' 
            ? 'https://horizon-testnet.stellar.org'
            : 'https://horizon.stellar.org'
        );

        const account = await server.loadAccount(destination);
        
        setAccountData({
          exists: true,
          balances: account.balances,
          accountId: destination
        });
      } catch (err: any) {
        if (err.response?.status === 404) {
          setAccountData({
            exists: false,
            balances: [],
            accountId: destination
          });
        } else {
          setError('Failed to load account information');
        }
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchAccountData, 500);
    return () => clearTimeout(debounceTimer);
  }, [destination, network]);

  if (!destination || destination.length !== 56) {
    return null;
  }

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!accountData) {
    return null;
  }

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 7,
      useGrouping: true
    });
  };

  const getAssetDisplay = (bal: any) => {
    if (bal.asset_type === 'native') return 'XLM';
    return bal.asset_code;
  };

  return (
    <Card className="border transition-all duration-200 border-blue/30 bg-blue/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-blue/10">
            {accountData.exists ? (
              <CheckCircle className="w-5 h-5 text-blue" />
            ) : (
              <User className="w-5 h-5 text-blue" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-medium text-blue">
                {accountData.exists ? 'Existing Account' : 'New Account'}
              </p>
              <Badge variant={accountData.exists ? 'default' : 'secondary'} className="text-xs">
                {network}
              </Badge>
            </div>

            {accountData.exists ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground truncate">
                  {destination}
                </p>
                {accountData.balances.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 mb-1">
                      <Wallet className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground font-medium">Balances</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {accountData.balances.slice(0, 4).map((bal, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs">
                          <span className="font-medium text-foreground">
                            {getAssetDisplay(bal)}
                          </span>
                          <span className="font-mono text-muted-foreground tabular-nums">
                            {formatBalance(bal.balance)}
                          </span>
                        </div>
                      ))}
                      {accountData.balances.length > 4 && (
                        <div className="text-xs text-muted-foreground col-span-full">
                          +{accountData.balances.length - 4} more assets
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground truncate">
                  {destination}
                </p>
                <p className="text-xs text-blue/70">
                  This account will be created with your payment
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};