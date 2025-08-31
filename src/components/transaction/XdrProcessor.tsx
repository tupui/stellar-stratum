import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface XdrProcessorProps {
  xdrInput: string;
  onXdrInputChange: (xdr: string) => void;
  onProcess: () => void;
  isProcessing: boolean;
}

export const XdrProcessor = ({ 
  xdrInput, 
  onXdrInputChange, 
  onProcess, 
  isProcessing 
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
      </div>
      <Button 
        onClick={onProcess} 
        disabled={isProcessing || !xdrInput.trim()}
        className="w-full"
        variant="outline"
      >
        {isProcessing ? (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Processing XDR...
          </div>
        ) : (
          'Process XDR'
        )}
      </Button>
    </div>
  );
};