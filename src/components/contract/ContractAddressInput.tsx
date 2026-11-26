import { useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { Button } from '@/components/ui/button';
import { RefreshCw, X } from 'lucide-react';
import { shortAddress } from '@/lib/xdr/describe';
import { Spinner } from '@/components/brand/Mark';
import { cn } from '@/lib/utils';

interface ContractAddressInputProps {
  value: string;
  onChange: (v: string) => void;
  onLoad: (force?: boolean) => void;
  isLoading: boolean;
  isLoaded: boolean;
  recents: string[];
  onSelectRecent: (id: string) => void;
  onRemoveRecent: (id: string) => void;
}

const shorten = shortAddress;

export const ContractAddressInput = ({
  value,
  onChange,
  onLoad,
  isLoading,
  isLoaded,
  recents,
  onSelectRecent,
  onRemoveRecent,
}: ContractAddressInputProps) => {
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const invalid = touched && trimmed.length > 0 && !StrKey.isValidContract(trimmed);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="contract-address" className="text-[13px] text-muted-foreground">Contract address</label>
      {/* The whole address on two lines on the phone, Load and Reload under it; one row from sm up */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          id="contract-address"
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
          onBlur={() => setTouched(true)}
          placeholder="C…"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          disabled={isLoading}
          className={cn(
            'block h-[62px] min-w-0 flex-1 resize-none overflow-hidden break-all rounded-none border border-input bg-ink-3 px-3 py-3 font-address text-[13px] leading-[18px] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:py-[14px]',
            invalid && 'border-destructive',
          )}
        />
        <div className="flex gap-2">
          <Button
            variant={isLoaded ? 'outline' : 'default'}
            className="min-w-24"
            onClick={() => onLoad(false)}
            disabled={isLoading || !StrKey.isValidContract(trimmed)}
          >
            {isLoading ? <Spinner /> : 'Load'}
          </Button>
          {isLoaded && (
            <Button
              variant="outline"
              size="icon"
              className="size-12 shrink-0"
              onClick={() => onLoad(true)}
              disabled={isLoading}
              title="Reload spec"
              aria-label="Reload spec"
            >
              <RefreshCw className="!size-5" />
            </Button>
          )}
        </div>
      </div>
      {invalid && <p className="text-[13px] text-destructive">Not a valid contract address.</p>}

      {recents.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {recents.map((id) => (
            <span key={id} className="inline-flex h-11 items-center border border-line-2">
              <button
                type="button"
                onClick={() => onSelectRecent(id)}
                className="h-full pl-3 pr-1 font-address text-[13px] hover:text-foreground"
                title={id}
              >
                {shorten(id)}
              </button>
              <button
                type="button"
                onClick={() => onRemoveRecent(id)}
                className="grid h-full w-11 place-items-center text-muted-foreground hover:text-destructive"
                aria-label="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
