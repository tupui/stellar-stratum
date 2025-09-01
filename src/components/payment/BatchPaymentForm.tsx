import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, AlertCircle, Info } from 'lucide-react';
import { PaymentItem } from './PaymentItem';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';

interface BatchPayment {
  id: string;
  destination: string;
  amount: string;
  asset: string;
  assetIssuer: string;
  memo: string;
  percentage: number;
}

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface BatchPaymentFormProps {
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
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
  };
  onBuild: (payments: BatchPayment[]) => void;
  isBuilding: boolean;
}

export const BatchPaymentForm = ({ 
  availableAssets, 
  assetPrices, 
  accountData,
  onBuild, 
  isBuilding 
}: BatchPaymentFormProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const [payments, setPayments] = useState<BatchPayment[]>([
    {
      id: '1',
      destination: '',
      amount: '',
      asset: 'XLM',
      assetIssuer: '',
      memo: '',
      percentage: 0
    }
  ]);
  const [selectedAsset, setSelectedAsset] = useState('XLM');
  const [totalFiatValue, setTotalFiatValue] = useState<string>('');

  // Calculate Stellar reserves for XLM
  const calculateXLMReserve = () => {
    // Base reserve is 0.5 XLM per entry
    // Account entries: 1 (base account) + signers + trustlines + data entries
    const baseReserve = 0.5;
    const accountEntries = 1; // Base account
    const signersCount = accountData.signers.length - 1; // Subtract 1 for master key
    const trustlinesCount = accountData.balances.filter(b => b.asset_type !== 'native').length;
    
    return (accountEntries + signersCount + trustlinesCount + 1) * baseReserve; // +1 for safety
  };

  const getAvailableBalance = (assetCode: string) => {
    const asset = availableAssets.find(a => a.code === assetCode);
    if (!asset) return 0;
    
    const balance = parseFloat(asset.balance);
    if (assetCode === 'XLM') {
      const reserve = calculateXLMReserve();
      return Math.max(0, balance - reserve - 0.1); // Extra 0.1 for transaction fees
    }
    return balance;
  };

  const addPayment = () => {
    const newPayment: BatchPayment = {
      id: Date.now().toString(),
      destination: '',
      amount: '',
      asset: selectedAsset,
      assetIssuer: selectedAsset === 'XLM' ? '' : availableAssets.find(a => a.code === selectedAsset)?.issuer || '',
      memo: '',
      percentage: 0
    };
    setPayments([...payments, newPayment]);
  };

  const removePayment = (id: string) => {
    if (payments.length > 1) {
      const newPayments = payments.filter(p => p.id !== id);
      redistributeAmounts(newPayments, selectedAsset);
    }
  };

  const updatePayment = (id: string, updates: Partial<BatchPayment>) => {
    const newPayments = payments.map(p => 
      p.id === id ? { ...p, ...updates } : p
    );
    setPayments(newPayments);

    // If amount was updated, recalculate percentages and redistribute
    if ('amount' in updates && updates.amount !== undefined) {
      redistributeAmounts(newPayments, selectedAsset);
    }
  };

  const redistributeAmounts = (paymentList: BatchPayment[], assetCode: string) => {
    const availableBalance = getAvailableBalance(assetCode);
    const paymentsForAsset = paymentList.filter(p => p.asset === assetCode);
    
    if (paymentsForAsset.length === 0) return;

    // Calculate total requested amount for this asset
    const totalRequested = paymentsForAsset.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    
    if (totalRequested > availableBalance) {
      // Scale down proportionally
      const scaleFactor = availableBalance / totalRequested;
      
      const updatedPayments = paymentList.map(payment => {
        if (payment.asset === assetCode) {
          const originalAmount = parseFloat(payment.amount) || 0;
          const scaledAmount = originalAmount * scaleFactor;
          return {
            ...payment,
            amount: scaledAmount.toFixed(7),
            percentage: (scaledAmount / availableBalance) * 100
          };
        }
        return payment;
      });
      
      setPayments(updatedPayments);
    } else {
      // Update percentages without changing amounts
      const updatedPayments = paymentList.map(payment => {
        if (payment.asset === assetCode) {
          const amount = parseFloat(payment.amount) || 0;
          return {
            ...payment,
            percentage: availableBalance > 0 ? (amount / availableBalance) * 100 : 0
          };
        }
        return payment;
      });
      
      setPayments(updatedPayments);
    }
  };

  const updatePercentage = (id: string, percentage: number) => {
    const availableBalance = getAvailableBalance(selectedAsset);
    const newAmount = (availableBalance * percentage / 100).toString();
    
    updatePayment(id, { 
      percentage, 
      amount: newAmount 
    });
  };

  // Calculate total fiat value
  useEffect(() => {
    const calculateTotalFiat = async () => {
      let totalUSD = 0;
      
      for (const payment of payments) {
        const amount = parseFloat(payment.amount) || 0;
        const price = assetPrices[payment.asset] || 0;
        totalUSD += amount * price;
      }
      
      if (totalUSD === 0) {
        setTotalFiatValue('');
        return;
      }

      if (quoteCurrency === 'USD') {
        setTotalFiatValue(`$${totalUSD.toFixed(2)}`);
      } else {
        try {
          const converted = await convertFromUSD(totalUSD, quoteCurrency);
          const currency = getCurrentCurrency();
          setTotalFiatValue(`${currency?.symbol || ''}${converted.toFixed(2)}`);
        } catch {
          setTotalFiatValue(`$${totalUSD.toFixed(2)}`);
        }
      }
    };

    calculateTotalFiat();
  }, [payments, assetPrices, quoteCurrency, getCurrentCurrency]);

  // Validation
  const isFormValid = () => {
    return payments.every(p => 
      p.destination.trim() && 
      p.amount && 
      parseFloat(p.amount) > 0 &&
      p.asset &&
      (p.asset === 'XLM' || p.assetIssuer)
    );
  };

  const getTotalByAsset = (assetCode: string) => {
    return payments
      .filter(p => p.asset === assetCode)
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  };

  const getAssetWarnings = () => {
    const warnings: string[] = [];
    
    for (const asset of availableAssets) {
      const total = getTotalByAsset(asset.code);
      const available = getAvailableBalance(asset.code);
      
      if (total > available) {
        warnings.push(`Insufficient ${asset.code} balance. Required: ${total.toFixed(7)}, Available: ${available.toFixed(7)}`);
      }
    }
    
    return warnings;
  };

  return (
    <div className="space-y-6">
      {/* Asset Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Batch Payment Setup
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label>Primary Asset for New Payments</Label>
              <div className="flex gap-2 mt-2">
                {availableAssets.map(asset => (
                  <Button
                    key={asset.code}
                    variant={selectedAsset === asset.code ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedAsset(asset.code)}
                  >
                    {asset.code}
                    <Badge variant="secondary" className="ml-2">
                      {getAvailableBalance(asset.code).toFixed(2)}
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>

            {/* Reserve Info for XLM */}
            {selectedAsset === 'XLM' && (
              <div className="p-3 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">XLM Reserve Information</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>• Account reserve: {calculateXLMReserve().toFixed(2)} XLM</p>
                  <p>• Transaction fees: ~0.1 XLM</p>
                  <p>• Available for payments: {getAvailableBalance('XLM').toFixed(2)} XLM</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment Items */}
      <div className="space-y-4">
        {payments.map((payment, index) => (
          <PaymentItem
            key={payment.id}
            payment={payment}
            index={index}
            availableAssets={availableAssets}
            assetPrices={assetPrices}
            maxAmount={getAvailableBalance(payment.asset)}
            onUpdate={(updates) => updatePayment(payment.id, updates)}
            onUpdatePercentage={(percentage) => updatePercentage(payment.id, percentage)}
            onRemove={payments.length > 1 ? () => removePayment(payment.id) : undefined}
          />
        ))}
      </div>

      {/* Add Payment Button */}
      <Button 
        onClick={addPayment} 
        variant="outline" 
        className="w-full border-dashed"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Another Payment
      </Button>

      {/* Summary */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Total Value</span>
              {totalFiatValue && (
                <span className="text-lg font-semibold">{totalFiatValue}</span>
              )}
            </div>
            
            {/* Asset Totals */}
            {availableAssets.map(asset => {
              const total = getTotalByAsset(asset.code);
              if (total === 0) return null;
              
              return (
                <div key={asset.code} className="flex justify-between text-sm">
                  <span>{asset.code} Total</span>
                  <span className="font-mono">{total.toFixed(7)}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Warnings */}
      {getAssetWarnings().length > 0 && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="space-y-1">
              {getAssetWarnings().map((warning, idx) => (
                <p key={idx} className="text-sm text-destructive">{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Build Button */}
      <Button 
        onClick={() => onBuild(payments)} 
        disabled={isBuilding || !isFormValid() || getAssetWarnings().length > 0}
        className="w-full bg-gradient-primary hover:opacity-90 disabled:opacity-50"
        size="lg"
      >
        {isBuilding ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
            Building Batch Transaction...
          </div>
        ) : (
          `Build Batch Transaction (${payments.length} payments)`
        )}
      </Button>
    </div>
  );
};