import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Download, Upload, Copy, Check } from 'lucide-react';
import refractorLogo from '@/assets/refractor-favicon.ico';
import { useToast } from '@/hooks/use-toast';

interface RefractorIntegrationProps {
  onPullTransaction: (refractorId: string) => Promise<void>;
  lastRefractorId?: string;
}

export const RefractorIntegration = ({ onPullTransaction, lastRefractorId }: RefractorIntegrationProps) => {
  const [refractorId, setRefractorId] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handlePullTransaction = async () => {
    if (!refractorId.trim()) {
      toast({
        title: "Missing Refractor ID",
        description: "Please enter a valid Refractor transaction ID",
        variant: "destructive",
        duration: 5000,
      });
      return;
    }

    setIsPulling(true);
    try {
      await onPullTransaction(refractorId.trim());
      setRefractorId('');
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsPulling(false);
    }
  };

  const copyRefractorId = async () => {
    if (lastRefractorId) {
      await navigator.clipboard.writeText(lastRefractorId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied to clipboard",
        description: "Refractor ID has been copied",
        duration: 3000,
      });
    }
  };

  const openRefractor = () => {
    window.open('https://refractor.space', '_blank');
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <img src={refractorLogo} alt="Refractor" className="w-5 h-5 shrink-0" />
          Refractor Integration
        </CardTitle>
        <CardDescription>
          Use Refractor.space to collect signatures from multiple parties
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Last Submitted Transaction */}
        {lastRefractorId && (
          <>
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  <span className="text-sm font-medium">Last Submitted</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyRefractorId}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="font-mono text-sm text-muted-foreground">
                ID: {lastRefractorId}
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2 inline-flex items-center gap-2"
                onClick={openRefractor}
              >
                <img src={refractorLogo} alt="Refractor" className="w-4 h-4" />
                <span>View on Refractor</span>
              </Button>
            </div>
            <Separator />
          </>
        )}

        {/* Pull Transaction from Refractor */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="refractor-id">Pull Transaction from Refractor</Label>
            <div className="flex gap-2">
              <Input
                id="refractor-id"
                placeholder="Enter Refractor transaction ID"
                value={refractorId}
                onChange={(e) => setRefractorId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handlePullTransaction();
                  }
                }}
              />
              <Button 
                onClick={handlePullTransaction}
                disabled={isPulling || !refractorId.trim()}
                size="sm"
                className="inline-flex items-center gap-2"
              >
                {isPulling ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Pulling...
                  </div>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Pull
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <strong>How it works:</strong> Submit your transaction to Refractor to collect signatures from multiple parties. 
            Share the Refractor ID with other signers who can sign and resubmit the transaction.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};