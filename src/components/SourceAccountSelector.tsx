import { useState, useEffect, useCallback } from 'react';
import { buildAccountUrl } from '@/lib/urlState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Copy, Share2, ExternalLink } from 'lucide-react';
import { accountIdOf, isValidPublicKey } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { shortAddress } from '@/lib/xdr/describe';

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

    // A muxed (M…) address opens the account behind it.
    const account = accountIdOf(trimmed);
    if (account) {
      setValidationError('');
      onSourceAccountChange(account);
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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  };

  const handleResetToConnected = () => {
    if (connectedWalletKey) {
      setInputValue(connectedWalletKey);
      onSourceAccountChange(connectedWalletKey);
      setValidationError('');
    }
  };

  const truncateKey = shortAddress;


  const isValidAccount = isValidPublicKey(sourceAccount);

  const handleCopy = () => {
    navigator.clipboard.writeText(sourceAccount);
    toast({ title: 'Address copied', duration: 2000 });
  };

  const handleShare = () => {
    navigator.clipboard.writeText(buildAccountUrl(sourceAccount, network));
    toast({
      title: 'Account link copied',
      description: `Opening it loads ${truncateKey(sourceAccount)} directly`,
      duration: 3000,
    });
  };

  const explorerUrl = `https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/account/${sourceAccount}`;

  return (
    <div className="flex flex-col gap-2">
      {/* A bare block on the phone (the key wraps); a panel with the actions at right on desktop */}
      <div
        role="group"
        aria-label="Source account"
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 sm:border sm:border-line sm:bg-ink-2 sm:p-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="source-account" className="text-[13px] text-muted-foreground">
              Source account
            </label>
            {isDifferent && <Badge variant="outline">Different from wallet</Badge>}
          </div>
          {/* Still a field: another account can be typed or pasted in */}
          <textarea
            id="source-account"
            rows={2}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            placeholder="Enter source account address"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className={cn(
              'mt-2 block h-9 w-full resize-none overflow-hidden break-all border-0 bg-transparent p-0 font-address text-[13px] leading-[18px] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 sm:mt-1 sm:h-[18px]',
              validationError && 'text-destructive',
            )}
            disabled={disabled}
          />
        </div>

        {(isValidAccount || isDifferent) && (
          <div className="flex flex-wrap items-center gap-2">
            {isValidAccount && (
              <>
                <Button variant="outline" size="icon" onClick={handleCopy} title="Copy address" aria-label="Copy address">
                  <Copy className="!size-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleShare}
                  title="Copy shareable link to this account"
                  aria-label="Copy shareable link to this account"
                >
                  <Share2 className="!size-5" />
                </Button>
                <Button variant="outline" size="icon" asChild title="View on Stellar Expert">
                  <a href={explorerUrl} target="_blank" rel="noopener noreferrer" aria-label="View on Stellar Expert">
                    <ExternalLink className="!size-5" />
                  </a>
                </Button>
              </>
            )}
            {isDifferent && (
              <Button type="button" variant="outline" size="sm" onClick={handleResetToConnected} disabled={disabled}>
                Reset
              </Button>
            )}
          </div>
        )}
      </div>

      {validationError && (
        <div role="alert" className="notice red">
          <AlertCircle className="mt-0.5 h-4 w-4" aria-hidden="true" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Connected wallet info when different */}
      {isDifferent && connectedWalletKey && (
        <p className="text-[13px] text-muted-foreground">
          Connected wallet: <span className="font-address">{truncateKey(connectedWalletKey)}</span>
        </p>
      )}
    </div>
  );
};
