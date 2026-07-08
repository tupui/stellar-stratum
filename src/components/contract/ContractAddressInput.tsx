import { useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw, X } from 'lucide-react';

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

const shorten = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id);

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
    <div className="space-y-2">
      <Label>Contract address</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="C…"
          className="font-mono text-xs"
          disabled={isLoading}
        />
        <Button onClick={() => onLoad(false)} disabled={isLoading || !StrKey.isValidContract(trimmed)}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
        </Button>
        {isLoaded && (
          <Button variant="outline" size="icon" onClick={() => onLoad(true)} disabled={isLoading} title="Reload spec">
            <RefreshCw className="w-4 h-4" />
          </Button>
        )}
      </div>
      {invalid && <p className="text-xs text-destructive">Not a valid contract address.</p>}

      {recents.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {recents.map((id) => (
            <div
              key={id}
              className="group flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-muted/50 hover:bg-muted transition-colors"
            >
              <button
                type="button"
                onClick={() => onSelectRecent(id)}
                className="font-mono"
                title={id}
              >
                {shorten(id)}
              </button>
              <button
                type="button"
                onClick={() => onRemoveRecent(id)}
                className="opacity-40 hover:opacity-100 hover:text-destructive"
                aria-label="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
