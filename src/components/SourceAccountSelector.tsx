import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { RefreshCw, AlertCircle, User, Copy, Share2, ExternalLink } from 'lucide-react';
import { isValidPublicKey } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface SourceAccountSelectorProps {
  sourceAccount: string;
  connectedWalletKey: string;
  onSourceAccountChange: (account: string) => void;
  network: 'mainnet' | 'testnet';
  disabled?: boolean;
}

export const SourceAccountSelector = ({
  sourceAccount,
  connectedWalletKey,
  onSourceAccountChange,
  network,
  disabled = false,
}: SourceAccountSelectorProps) => {
  const [inputValue, setInputValue] = useState(sourceAccount);
  const [validationError, setValidationError] = useState<string>('');
  const { toast } = useToast();

  // Sync input value when sourceAccount prop changes
  useEffect(() => {
    setInputValue(sourceAccount);
  }, [sourceAccount]);

  // Check if source account differs from connected wallet
  const isDifferent = sourceAccount && connectedWalletKey && sourceAccount !== connectedWalletKey;

  // Validate input
  const validate = useCallback((value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
      setValidationError('');
      return;
    }

    if (isValidPublicKey(trimmed)) {
      setValidationError('');
      onSourceAccountChange(trimmed);
    } else {
      setValidationError('Invalid Stellar address format');
    }
  }, [onSourceAccountChange]);

  // Debounce validation
  useEffect(() => {
    const timer = setTimeout(() => {
      validate(inputValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, validate]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleResetToConnected = () => {
    if (connectedWalletKey) {
      setInputValue(connectedWalletKey);
      onSourceAccountChange(connectedWalletKey);
      setValidationError('');
    }
  };

  const truncateKey = (key: string) => {
    if (key.length <= 16) return key;
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };


  const isValidAccount = isValidPublicKey(sourceAccount);

  const handleCopy = () => {
    navigator.clipboard.writeText(sourceAccount);
    toast({ title: 'Address copied', duration: 2000 });
  };

  const handleShare = () => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('public_key', sourceAccount);
    if (network === 'testnet') url.searchParams.set('network', 'testnet');
    navigator.clipboard.writeText(url.toString());
    toast({
      title: 'Account link copied',
      description: `Opening it loads ${truncateKey(sourceAccount)} directly`,
      duration: 3000,
    });
  };

  const explorerUrl = `https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/account/${sourceAccount}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="source-account" className="text-sm font-medium flex items-center gap-2">
          <User className="w-4 h-4" />
          Source Account
        </Label>
        <div className="flex items-center gap-2">
          {isDifferent && (
            <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
              Different from wallet
            </Badge>
          )}
          {isValidAccount && (
            <div className="flex items-center">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopy} title="Copy address">
                <Copy className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleShare} title="Copy shareable link to this account">
                <Share2 className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild title="View on Stellar Expert">
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="source-account"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Enter source account address"
            className={cn(
              "font-address text-sm",
              validationError && "border-destructive"
            )}
            disabled={disabled}
          />
        </div>
        
        {isDifferent && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetToConnected}
            disabled={disabled}
            className="shrink-0"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Reset
          </Button>
        )}
      </div>


      {/* Validation error */}
      {validationError && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <span className="text-sm text-destructive">{validationError}</span>
        </div>
      )}

      {/* Connected wallet info when different */}
      {isDifferent && connectedWalletKey && (
        <p className="text-xs text-muted-foreground">
          Connected wallet: <span className="font-address">{truncateKey(connectedWalletKey)}</span>
        </p>
      )}
    </div>
  );
};
