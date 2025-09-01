import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, TrendingUp, Info } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { convertFromUSD } from '@/lib/fiat-currencies';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { DestinationAccountInfo } from './DestinationAccountInfo';

interface PathPaymentData {
  destination: string;
  sendAmount: string;
  sendAsset: string;
  sendAssetIssuer: string;
  receiveAsset: string;
  receiveAssetIssuer: string;
  memo: string;
  slippageTolerance: number;
}

interface Asset {
  code: string;
  issuer: string;
  name: string;
  balance: string;
  price: number;
}

interface PathPaymentFormProps {
  pathPaymentData: PathPaymentData;
  onPathPaymentDataChange: (data: PathPaymentData) => void;
  availableAssets: Asset[];
  assetPrices: Record<string, number>;
  destinationAssets: Asset[];
  onBuild: () => void;
  isBuilding: boolean;
  conversionRate?: number;
  estimatedReceiveAmount?: string;
}

export const PathPaymentForm = ({ 
  pathPaymentData, 
  onPathPaymentDataChange,
  availableAssets,
  assetPrices,
  destinationAssets,
  onBuild,
  isBuilding,
  conversionRate,
  estimatedReceiveAmount
}: PathPaymentFormProps) => {
  const { quoteCurrency, getCurrentCurrency } = useFiatCurrency();
  const [sendFiatValue, setSendFiatValue] = useState<string>('');
  const [receiveFiatValue, setReceiveFiatValue] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('0.0');
  const [isEditingAmount, setIsEditingAmount] = useState(false);

  // Update fiat values
  useEffect(() => {
    const updateFiatValues = async () => {
      // Send amount fiat value
      if (pathPaymentData.sendAmount && pathPaymentData.sendAsset) {
        const sendPrice = assetPrices[pathPaymentData.sendAsset] || 0;
        if (sendPrice > 0) {
          const sendUsdValue = parseFloat(pathPaymentData.sendAmount) * sendPrice;
          
          if (quoteCurrency === 'USD') {
            setSendFiatValue(`$${sendUsdValue.toFixed(2)}`);
          } else {
            try {
              const converted = await convertFromUSD(sendUsdValue, quoteCurrency);
              const currency = getCurrentCurrency();
              setSendFiatValue(`${currency?.symbol || ''}${converted.toFixed(2)}`);
            } catch {
              setSendFiatValue(`$${sendUsdValue.toFixed(2)}`);
            }
          }
        } else {
          setSendFiatValue('N/A');
        }
      } else {
        setSendFiatValue('');
      }

      // Receive amount fiat value
      if (estimatedReceiveAmount && pathPaymentData.receiveAsset) {
        const receivePrice = assetPrices[pathPaymentData.receiveAsset] || 0;
        if (receivePrice > 0) {
          const receiveUsdValue = parseFloat(estimatedReceiveAmount) * receivePrice;
          
          if (quoteCurrency === 'USD') {
            setReceiveFiatValue(`$${receiveUsdValue.toFixed(2)}`);
          } else {
            try {
              const converted = await convertFromUSD(receiveUsdValue, quoteCurrency);
              const currency = getCurrentCurrency();
              setReceiveFiatValue(`${currency?.symbol || ''}${converted.toFixed(2)}`);
            } catch {
              setReceiveFiatValue(`$${receiveUsdValue.toFixed(2)}`);
            }
          }
        } else {
          setReceiveFiatValue('N/A');
        }
      } else {
        setReceiveFiatValue('');
      }
    };

    updateFiatValues();
  }, [pathPaymentData.sendAmount, pathPaymentData.sendAsset, pathPaymentData.receiveAsset, estimatedReceiveAmount, quoteCurrency, assetPrices, getCurrentCurrency]);

  // Sync input display
  useEffect(() => {
    if (isEditingAmount) return;
    const amt = pathPaymentData.sendAmount;
    if (!amt || amt === '0') {
      setAmountInput('0.0');
    } else {
      const formatted = !amt.includes('.') ? `${amt}.0` : amt;
      setAmountInput(formatted);
    }
  }, [pathPaymentData.sendAmount, pathPaymentData.sendAsset, isEditingAmount]);

  const getSendAssetInfo = () => {
    return availableAssets.find(asset => asset.code === pathPaymentData.sendAsset);
  };

  const handleMaxAmount = () => {
    const selectedAsset = getSendAssetInfo();
    if (selectedAsset) {
      const maxAmount = selectedAsset.code === 'XLM' 
        ? Math.max(0, parseFloat(selectedAsset.balance) - 0.5).toString()
        : selectedAsset.balance;
      onPathPaymentDataChange({ ...pathPaymentData, sendAmount: maxAmount });
    }
  };

  const handleSlippageChange = (value: number[]) => {
    onPathPaymentDataChange({ 
      ...pathPaymentData, 
      slippageTolerance: value[0] 
    });
  };

  const isFormValid = pathPaymentData.destination && 
    pathPaymentData.sendAmount && 
    pathPaymentData.sendAsset &&
    pathPaymentData.receiveAsset &&
    (pathPaymentData.sendAsset === 'XLM' || pathPaymentData.sendAssetIssuer) &&
    (pathPaymentData.receiveAsset === 'XLM' || pathPaymentData.receiveAssetIssuer) &&
    pathPaymentData.sendAsset !== pathPaymentData.receiveAsset; // Different assets required

  const priceImpact = conversionRate && assetPrices[pathPaymentData.sendAsset] && assetPrices[pathPaymentData.receiveAsset] ? 
    Math.abs((conversionRate - (assetPrices[pathPaymentData.receiveAsset] / assetPrices[pathPaymentData.sendAsset])) / 
    (assetPrices[pathPaymentData.receiveAsset] / assetPrices[pathPaymentData.sendAsset]) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-primary">
            <TrendingUp className="w-5 h-5" />
            Cross-Asset Payment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="w-4 h-4" />
            <p>Send one asset and the recipient receives a different asset through automatic conversion.</p>
          </div>
        </CardContent>
      </Card>

      {/* Destination */}
      <div className="space-y-2">
        <Label htmlFor="path-destination">Destination Address</Label>
        <Input
          id="path-destination"
          placeholder="GABC..."
          maxLength={56}
          value={pathPaymentData.destination}
          onChange={(e) => onPathPaymentDataChange({ ...pathPaymentData, destination: e.target.value })}
          className="text-xs sm:text-sm font-address"
        />
      </div>

      {/* Send Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">You Send</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4 items-end">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="send-amount">Amount</Label>
                {sendFiatValue && (
                  <span className="text-xs text-muted-foreground">≈ {sendFiatValue}</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id="send-amount"
                  type="text"
                  placeholder="0.0"
                  inputMode="decimal"
                  className="font-amount flex-1"
                  value={amountInput}
                  onFocus={() => setIsEditingAmount(true)}
                  onBlur={() => {
                    const maxAmount = getSendAssetInfo()?.code === 'XLM'
                      ? Math.max(0, parseFloat(getSendAssetInfo()!.balance) - 0.5)
                      : parseFloat(getSendAssetInfo()?.balance || '0');
                    const numeric = parseFloat(amountInput.replace(/,/g, ''));
                    const clamped = isNaN(numeric) ? 0 : Math.min(Math.max(0, numeric), maxAmount);
                    const rounded = Number(clamped.toFixed(7));
                    onPathPaymentDataChange({ ...pathPaymentData, sendAmount: rounded.toString() });
                    
                    const formatted = rounded === 0 ? '0.0' : 
                      !rounded.toString().includes('.') ? `${rounded}.0` : rounded.toString();
                    setAmountInput(formatted);
                    setIsEditingAmount(false);
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    const sanitized = v.replace(/[^0-9.]/g, '');
                    const parts = sanitized.split('.');
                    const normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : sanitized;
                    setAmountInput(normalized);

                    const num = parseFloat(normalized);
                    if (!isNaN(num)) {
                      const precise = Number(num.toFixed(7)).toString();
                      onPathPaymentDataChange({ ...pathPaymentData, sendAmount: precise });
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleMaxAmount}
                  className="px-3"
                >
                  Max
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Send Asset</Label>
              <Select
                value={pathPaymentData.sendAsset}
                onValueChange={(value) => {
                  const selectedAsset = availableAssets.find(asset => asset.code === value);
                  onPathPaymentDataChange({ 
                    ...pathPaymentData, 
                    sendAsset: value,
                    sendAssetIssuer: selectedAsset?.issuer || '',
                    sendAmount: ''
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableAssets.map((asset) => (
                    <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code}>
                      <div className="flex justify-between w-full">
                        <span>{asset.code}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {parseFloat(asset.balance).toFixed(2)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {getSendAssetInfo() && (
            <div className="text-xs text-muted-foreground">
              Available: {parseFloat(getSendAssetInfo()!.balance).toFixed(7)} {pathPaymentData.sendAsset}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conversion Arrow */}
      <div className="flex justify-center">
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <ArrowRight className="w-5 h-5 text-muted-foreground" />
          {conversionRate && (
            <span className="text-sm text-muted-foreground">
              1 {pathPaymentData.sendAsset} = {conversionRate.toFixed(6)} {pathPaymentData.receiveAsset}
            </span>
          )}
        </div>
      </div>

      {/* Receive Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recipient Receives</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Receive Asset</Label>
            <Select
              value={pathPaymentData.receiveAsset}
              onValueChange={(value) => {
                const selectedAsset = destinationAssets.find(asset => asset.code === value);
                onPathPaymentDataChange({ 
                  ...pathPaymentData, 
                  receiveAsset: value,
                  receiveAssetIssuer: selectedAsset?.issuer || ''
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select receive asset..." />
              </SelectTrigger>
              <SelectContent>
                {destinationAssets.map((asset) => (
                  <SelectItem key={`${asset.code}-${asset.issuer}`} value={asset.code}>
                    {asset.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {estimatedReceiveAmount && (
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Estimated Amount:</span>
                <div className="text-right">
                  <div className="font-mono font-semibold">
                    {parseFloat(estimatedReceiveAmount).toFixed(7)} {pathPaymentData.receiveAsset}
                  </div>
                  {receiveFiatValue && (
                    <div className="text-xs text-muted-foreground">≈ {receiveFiatValue}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Slippage Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Slippage Tolerance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm">Maximum Price Impact</span>
              <Badge variant="outline">{pathPaymentData.slippageTolerance.toFixed(1)}%</Badge>
            </div>
            
            <Slider
              value={[pathPaymentData.slippageTolerance]}
              onValueChange={handleSlippageChange}
              min={0.1}
              max={5.0}
              step={0.1}
              className="w-full"
            />
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0.1% (Low slippage)</span>
              <span>5.0% (High slippage)</span>
            </div>
          </div>

          {priceImpact > 0 && (
            <Alert variant={priceImpact > 2 ? "destructive" : "default"}>
              <TrendingUp className="h-4 w-4" />
              <AlertDescription>
                Price impact: {priceImpact.toFixed(2)}%
                {priceImpact > 2 && " - High price impact detected!"}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Memo */}
      <div className="space-y-2">
        <Label htmlFor="path-memo">Memo (Optional)</Label>
        <Input
          id="path-memo"
          placeholder="Payment description"
          value={pathPaymentData.memo}
          onChange={(e) => onPathPaymentDataChange({ ...pathPaymentData, memo: e.target.value })}
        />
      </div>

      {/* Destination Info */}
      {pathPaymentData.destination && (
        <DestinationAccountInfo destination={pathPaymentData.destination} />
      )}

      {/* Build Button */}
      <Button 
        onClick={onBuild} 
        disabled={isBuilding || !isFormValid}
        className="w-full bg-gradient-primary hover:opacity-90 disabled:opacity-50"
        size="lg"
      >
        {isBuilding ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
            Building Path Payment...
          </div>
        ) : (
          'Build Path Payment Transaction'
        )}
      </Button>
    </div>
  );
};