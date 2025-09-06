import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Clock, Users, QrCode, BookOpen } from 'lucide-react';
import { useAddressBook, type AddressBookEntry } from '@/hooks/useAddressBook';
import { resolveSorobanDomain, isLikelySorobanDomain } from '@/lib/soroban-domains';
import { isValidPublicKey } from '@/lib/validation';
import { cn } from '@/lib/utils';

interface AddressAutocompleteProps {
  value: string;
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
  value,
  onChange,
  placeholder = "Enter address or domain",
  className,
  accountPublicKey,
  network = 'mainnet',
  onQRScan,
  onFocus,
  onBlur,
}: AddressAutocompleteProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { entries, searchAddresses, syncAddressBook, isLoading: isAddressBookLoading, needsSync } = useAddressBook(accountPublicKey, network);
  const suggestions = value.trim() ? searchAddresses(value) : entries.slice(0, 10);

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

  // Resolve Soroban domains
  useEffect(() => {
    const resolveDomain = async () => {
      if (isLikelySorobanDomain(value)) {
        setIsResolving(true);
        try {
          const result = await resolveSorobanDomain(value, network);
          if (result.success && result.address) {
            setResolvedAddress(result.address);
          } else {
            setResolvedAddress('');
          }
        } catch {
          setResolvedAddress('');
        } finally {
          setIsResolving(false);
        }
      } else {
        setResolvedAddress('');
      }
    };

    const debounceTimer = setTimeout(resolveDomain, 300);
    return () => clearTimeout(debounceTimer);
  }, [value, network]);

  const handleSelect = (entry: AddressBookEntry) => {
    onChange(entry.address);
    setIsOpen(false);
  };

  const handleUseDomain = () => {
    if (resolvedAddress) {
      onChange(resolvedAddress);
    }
  };

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
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={placeholder}
            className={cn("font-mono", isResolving ? "pr-8" : "", className)}
          />
          {isResolving && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={toggleAddressBook}
          aria-label="Toggle address book"
        >
          <BookOpen className="w-4 h-4" />
        </Button>
        {onQRScan && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onQRScan}
            aria-label="Scan QR"
          >
            <QrCode className="w-4 h-4" />
          </Button>
        )}
      </div>


      {/* Validation status for addresses */}
      {!isLikelySorobanDomain(value) && value && !isValidPublicKey(value) && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded-lg">
          <span className="text-sm text-destructive">
            Invalid Stellar address format
          </span>
        </div>
      )}

      {/* Dropdown with suggestions */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {suggestions.length > 0 ? (
            <>
              <div className="p-2 border-b border-border">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {value.trim() ? 'Search results' : 'Recent transactions'}
                </div>
              </div>
              {suggestions.map((entry) => (
                <div
                  key={entry.address}
                  className="p-3 hover:bg-accent cursor-pointer border-b border-border last:border-b-0"
                  onClick={() => handleSelect(entry)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm truncate">
                          {entry.sorobanDomain || formatAddress(entry.address)}
                        </span>
                        {entry.sorobanDomain && (
                          <Badge variant="secondary" className="text-xs">
                            Domain
                          </Badge>
                        )}
                      </div>
                      {entry.sorobanDomain && (
                        <div className="font-mono text-xs text-muted-foreground truncate">
                          {formatAddress(entry.address)}
                        </div>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                        <div className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {entry.transactionCount} tx
                        </div>
                        <span>{formatAmount(entry.totalAmount)}</span>
                        <span>{entry.lastUsed.toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="p-4 text-center text-muted-foreground">
              <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {value.trim() ? 'No matching addresses found' : 'No addresses in your address book yet'}
              </p>
              <p className="text-xs mt-1 opacity-75">
                Addresses are automatically added from your transaction history
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};