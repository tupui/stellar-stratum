import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { QrCode, BookOpen } from 'lucide-react';
import { useAddressBook, type AddressBookEntry } from '@/hooks/useAddressBook';
import { isValidPaymentDestination } from '@/lib/validation';
import { cn } from '@/lib/utils';

interface AddressAutocompleteProps {
  id?: string;
  value: string;
  /** Draw the field in red: the address is not valid. */
  invalid?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  accountPublicKey?: string;
  network?: 'mainnet' | 'testnet';
  onQRScan?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const AddressAutocomplete = ({
  id,
  value,
  invalid = false,
  onChange,
  placeholder = "Enter address",
  className,
  accountPublicKey,
  network = 'mainnet',
  onQRScan,
  onFocus,
  onBlur,
}: AddressAutocompleteProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { entries, searchAddresses, syncAddressBook, isLoading: isAddressBookLoading, needsSync } = useAddressBook(accountPublicKey, network);
  
  // Memoize suggestions to prevent unnecessary recalculations
  const suggestions = useMemo(() => {
    return value.trim() ? searchAddresses(value) : entries.slice(0, 10);
  }, [value, searchAddresses, entries]);

  // Auto-sync address book on mount or when account/network changes
  useEffect(() => {
    if (!accountPublicKey) return;
    // Sync if cache is stale or empty
    if (entries.length === 0 || needsSync) {
      syncAddressBook();
    }
    // We intentionally avoid exhaustive deps to prevent repeated sync loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountPublicKey, network]);

  // Handle clicks outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback((entry: AddressBookEntry) => {
    onChange(entry.address);
    setIsOpen(false);
  }, [onChange]);

  const toggleAddressBook = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      // Trigger sync when opening address book
      if (accountPublicKey) {
        syncAddressBook();
      }
      inputRef.current?.focus();
    }
  };

  const formatAmount = (amount: number): string => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M XLM`;
    } else if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K XLM`;
    } else {
      return `${amount.toFixed(1)} XLM`;
    }
  };

  const formatAddress = (address: string): string => {
    // Look-alike addresses share their first and last few characters: show more of it.
    return `${address.slice(0, 10)}…${address.slice(-10)}`;
  };

  return (
    <div className="relative">
      {/* On the phone the field holds the whole key on two lines; from sm up, one line */}
      <div className="flex items-start gap-2">
        <textarea
          ref={inputRef}
          id={id}
          rows={2}
          value={value}
          // a one-line value, as the input it replaces: a pasted line break is dropped
          onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className={cn(
            'block h-[62px] min-w-0 flex-1 resize-none overflow-hidden break-all rounded-none border border-input bg-ink-3 px-3 py-3 font-address text-[13px] leading-[18px] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-12 sm:py-[14px]',
            invalid && 'border-destructive',
            className,
          )}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={toggleAddressBook}
          aria-label="Toggle address book"
          className="size-12 shrink-0"
        >
          <BookOpen className="!size-5" />
        </Button>
        {onQRScan && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onQRScan}
            aria-label="Scan QR"
            className="size-12 shrink-0"
          >
            <QrCode className="!size-5" />
          </Button>
        )}
      </div>

      {/* Validation status for addresses */}
      {value && !isValidPaymentDestination(value.trim()) && (
        <p className="mt-2 text-[13px] text-destructive">Invalid Stellar address format</p>
      )}

      {/* Dropdown with suggestions */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto border border-line-2 bg-ink-2"
        >
          {suggestions.length > 0 ? (
            <>
              <div className="border-b border-line px-4 py-2 text-[13px] text-muted-foreground">
                {value.trim() ? 'Search results' : 'Recent recipients'}
              </div>
              {suggestions.map((entry) => (
                <div
                  key={entry.address}
                  className="cursor-pointer border-b border-line px-4 py-3 last:border-b-0 hover:bg-ink-3"
                  onClick={() => handleSelect(entry)}
                >
                  <div className="truncate font-address text-[13px]">{formatAddress(entry.address)}</div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{entry.transactionCount} tx</span>
                    <span className="font-amount">{formatAmount(entry.totalAmount)}</span>
                    <span>{entry.lastUsed.toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="p-4 text-center text-muted-foreground">
              <p className="text-sm">
                {value.trim() ? 'No matching addresses found' : 'No addresses in your address book yet'}
              </p>
              <p className="mt-1 text-xs">Addresses are automatically added from your transaction history</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
