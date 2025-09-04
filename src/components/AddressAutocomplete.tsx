import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Clock, Users, QrCode } from 'lucide-react';
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
}

export const AddressAutocomplete = ({
  value,
  onChange,
  placeholder = "Enter address or domain",
  className,
  accountPublicKey,
  network = 'mainnet',
  onQRScan,
}: AddressAutocompleteProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { entries, searchAddresses } = useAddressBook(accountPublicKey, network);
  const suggestions = searchAddresses(value);

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
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={cn("font-mono", className)}
        />
        {onQRScan && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onQRScan}
          >
            <QrCode className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Domain resolution status */}
      {isLikelySorobanDomain(value) && (
        <div className="mt-2">
          {isResolving ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Resolving domain...
            </div>
          ) : resolvedAddress ? (
            <div className="flex items-center justify-between p-2 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-sm text-green-800">
                  Resolves to: {formatAddress(resolvedAddress)}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUseDomain}
                className="text-green-700 border-green-300 hover:bg-green-100"
              >
                Use Address
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-sm text-red-800">
                Domain not found or invalid
              </span>
            </div>
          )}
        </div>
      )}

      {/* Validation status for addresses */}
      {!isLikelySorobanDomain(value) && value && !isValidPublicKey(value) && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-sm text-red-800">
            Invalid Stellar address format
          </span>
        </div>
      )}

      {/* Dropdown with suggestions */}
      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              Recent transactions
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
        </div>
      )}
    </div>
  );
};