import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { RefreshCw, AlertCircle, CheckCircle, User } from 'lucide-react';
import { isValidPublicKey } from '@/lib/validation';
import { resolveSorobanDomain, isLikelySorobanDomain } from '@/lib/soroban-domains';
import { cn } from '@/lib/utils';

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
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>('');
  const [validationError, setValidationError] = useState<string>('');

  // Sync input value when sourceAccount prop changes
  useEffect(() => {
    setInputValue(sourceAccount);
  }, [sourceAccount]);

  // Check if source account differs from connected wallet
  const isDifferent = sourceAccount && connectedWalletKey && sourceAccount !== connectedWalletKey;

  // Validate and resolve input
  const validateAndResolve = useCallback(async (value: string) => {
    const trimmed = value.trim();
    
    if (!trimmed) {
      setValidationError('');
      setResolvedAddress('');
      return;
    }

    // Check if it's a Soroban domain
    if (isLikelySorobanDomain(trimmed)) {
      setIsResolving(true);
      setValidationError('');
      try {
        const result = await resolveSorobanDomain(trimmed, network);
        if (result.success && result.address) {
          setResolvedAddress(result.address);
          setValidationError('');
        } else {
          setResolvedAddress('');
          setValidationError('Could not resolve domain');
        }
      } catch {
        setResolvedAddress('');
        setValidationError('Failed to resolve domain');
      } finally {
        setIsResolving(false);
      }
      return;
    }

    // Validate as public key
    setResolvedAddress('');
    if (isValidPublicKey(trimmed)) {
      setValidationError('');
      onSourceAccountChange(trimmed);
    } else {
      setValidationError('Invalid Stellar address format');
    }
  }, [network, onSourceAccountChange]);

  // Debounce validation
  useEffect(() => {
    const timer = setTimeout(() => {
      validateAndResolve(inputValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, validateAndResolve]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleUseDomain = () => {
    if (resolvedAddress) {
      setInputValue(resolvedAddress);
      onSourceAccountChange(resolvedAddress);
      setResolvedAddress('');
    }
  };

  const handleResetToConnected = () => {
    if (connectedWalletKey) {
      setInputValue(connectedWalletKey);
      onSourceAccountChange(connectedWalletKey);
      setResolvedAddress('');
      setValidationError('');
    }
  };

  const truncateKey = (key: string) => {
    if (key.length <= 16) return key;
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="source-account" className="text-sm font-medium flex items-center gap-2">
          <User className="w-4 h-4" />
          Source Account
        </Label>
        {isDifferent && (
          <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
            Different from wallet
          </Badge>
        )}
      </div>
      
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="source-account"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Enter source account address or domain"
            className={cn(
              "font-address text-sm",
              validationError && "border-destructive",
              isResolving && "pr-8"
            )}
            disabled={disabled}
          />
          {isResolving && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
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

      {/* Domain resolution result */}
      {resolvedAddress && (
        <div className="flex items-center justify-between p-2 bg-primary/10 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary" />
            <span className="text-sm">
              Resolves to: <span className="font-address">{truncateKey(resolvedAddress)}</span>
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={handleUseDomain}>
            Use Address
          </Button>
        </div>
      )}

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
