import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface XdrProcessorProps {
  xdrInput: string;
  onXdrInputChange: (xdr: string) => void;
}

export const XdrProcessor = ({ 
  xdrInput, 
  onXdrInputChange
}: XdrProcessorProps) => {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="xdr-input">Transaction XDR</Label>
        <Textarea
          id="xdr-input"
          placeholder="Paste transaction XDR here..."
          className="min-h-32 font-mono text-sm"
          value={xdrInput}
          onChange={(e) => onXdrInputChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          XDR will be validated automatically when pasted
        </p>
      </div>
    </div>
  );
};