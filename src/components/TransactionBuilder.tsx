import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Send, FileCode, ArrowLeft, Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  Transaction, 
  TransactionBuilder as StellarTransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo
} from '@stellar/stellar-sdk';
import { signTransaction, horizonServer } from '@/lib/stellar';

interface TransactionBuilderProps {
  onBack: () => void;
  accountPublicKey: string;
}

export const TransactionBuilder = ({ onBack, accountPublicKey }: TransactionBuilderProps) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('payment');
  const [paymentData, setPaymentData] = useState({
    destination: '',
    amount: '',
    asset: 'XLM',
    memo: '',
  });
  const [xdrData, setXdrData] = useState({
    input: '',
    output: '',
  });
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [copied, setCopied] = useState(false);

  const handlePaymentBuild = async () => {
    if (!paymentData.destination || !paymentData.amount) {
      toast({
        title: "Missing fields",
        description: "Please fill in destination and amount",
        variant: "destructive",
      });
      return;
    }

    setIsBuilding(true);
    
    try {
      // Load source account
      const sourceAccount = await horizonServer.loadAccount(accountPublicKey);
      
      // Create transaction builder
      const transaction = new StellarTransactionBuilder(sourceAccount, {
        fee: '100000', // 0.01 XLM
        networkPassphrase: Networks.PUBLIC, // Change to Networks.TESTNET for testing
      });

      // Add payment operation
      transaction.addOperation(Operation.payment({
        destination: paymentData.destination,
        asset: Asset.native(), // XLM
        amount: paymentData.amount,
      }));

      // Add memo if provided
      if (paymentData.memo) {
        transaction.addMemo(Memo.text(paymentData.memo));
      }

      // Set timeout
      transaction.setTimeout(300);

      // Build the transaction
      const builtTransaction = transaction.build();
      const xdr = builtTransaction.toXDR();
      
      setXdrData(prev => ({ ...prev, output: xdr }));
      
      toast({
        title: "Transaction built successfully",
        description: "XDR is ready for signing",
      });
    } catch (error) {
      console.error('Build error:', error);
      toast({
        title: "Build failed",
        description: error instanceof Error ? error.message : "Failed to build transaction",
        variant: "destructive",
      });
    } finally {
      setIsBuilding(false);
    }
  };

  const handleXdrProcess = async () => {
    if (!xdrData.input.trim()) {
      toast({
        title: "Missing XDR",
        description: "Please paste the XDR to process",
        variant: "destructive",
      });
      return;
    }

    setIsBuilding(true);
    
    try {
      // Validate XDR format by parsing it
      try {
        new Transaction(xdrData.input, Networks.PUBLIC);
      } catch (parseError) {
        throw new Error('Invalid XDR format');
      }
      
      toast({
        title: "XDR processed",
        description: "Transaction is ready for signing",
      });
    } catch (error) {
      console.error('XDR processing error:', error);
      toast({
        title: "Processing failed",
        description: "Invalid XDR format",
        variant: "destructive",
      });
    } finally {
      setIsBuilding(false);
    }
  };

  const handleSignTransaction = async () => {
    const xdrToSign = xdrData.output || xdrData.input;
    if (!xdrToSign) {
      toast({
        title: "No transaction to sign",
        description: "Please build or input a transaction first",
        variant: "destructive",
      });
      return;
    }

    setIsSigning(true);
    
    try {
      const signedXdr = await signTransaction(xdrToSign);
      
      setXdrData(prev => ({ ...prev, output: signedXdr }));
      
      toast({
        title: "Transaction signed",
        description: "Transaction has been signed successfully",
      });
    } catch (error) {
      console.error('Signing error:', error);
      toast({
        title: "Signing failed",
        description: error instanceof Error ? error.message : "Failed to sign transaction",
        variant: "destructive",
      });
    } finally {
      setIsSigning(false);
    }
  };

  const copyXDR = async () => {
    const textToCopy = xdrData.output || xdrData.input;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied to clipboard",
        description: "XDR has been copied",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Transaction Builder</h1>
            <p className="text-muted-foreground">Create and prepare transactions for multisig</p>
          </div>
        </div>

        {/* Source Account Info */}
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm text-muted-foreground">Source Account</Label>
                <p className="font-mono text-sm mt-1">{accountPublicKey}</p>
              </div>
              <Badge variant="outline">Connected</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Transaction Builder */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Build Transaction</CardTitle>
            <CardDescription>
              Create a payment or import existing XDR for signing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="payment" className="flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  Payment
                </TabsTrigger>
                <TabsTrigger value="xdr" className="flex items-center gap-2">
                  <FileCode className="w-4 h-4" />
                  Generic XDR
                </TabsTrigger>
              </TabsList>

              <TabsContent value="payment" className="space-y-4 mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="destination">Destination Address</Label>
                    <Input
                      id="destination"
                      placeholder="GABC..."
                      value={paymentData.destination}
                      onChange={(e) => setPaymentData(prev => ({ ...prev, destination: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount</Label>
                    <div className="flex gap-2">
                      <Input
                        id="amount"
                        type="number"
                        placeholder="0.00"
                        value={paymentData.amount}
                        onChange={(e) => setPaymentData(prev => ({ ...prev, amount: e.target.value }))}
                      />
                      <div className="w-20 bg-secondary rounded-lg flex items-center justify-center">
                        <span className="text-sm font-medium">XLM</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="memo">Memo (Optional)</Label>
                  <Input
                    id="memo"
                    placeholder="Payment description"
                    value={paymentData.memo}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, memo: e.target.value }))}
                  />
                </div>
                <Button 
                  onClick={handlePaymentBuild} 
                  disabled={isBuilding}
                  className="w-full bg-gradient-primary hover:opacity-90"
                >
                  {isBuilding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      Building Transaction...
                    </div>
                  ) : (
                    'Build Payment Transaction'
                  )}
                </Button>
              </TabsContent>

              <TabsContent value="xdr" className="space-y-4 mt-6">
                <div className="space-y-2">
                  <Label htmlFor="xdr-input">Transaction XDR</Label>
                  <Textarea
                    id="xdr-input"
                    placeholder="Paste transaction XDR here..."
                    className="min-h-32 font-mono text-sm"
                    value={xdrData.input}
                    onChange={(e) => setXdrData(prev => ({ ...prev, input: e.target.value }))}
                  />
                </div>
                <Button 
                  onClick={handleXdrProcess} 
                  disabled={isBuilding}
                  className="w-full"
                  variant="outline"
                >
                  {isBuilding ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Processing XDR...
                    </div>
                  ) : (
                    'Process XDR'
                  )}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* XDR Output */}
        {xdrData.output && (
          <Card className="shadow-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Transaction XDR</CardTitle>
                  <CardDescription>
                    Ready for multisig signing process
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={copyXDR}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="p-4 bg-secondary/50 rounded-lg">
                <pre className="font-mono text-sm whitespace-pre-wrap break-all">
                  {xdrData.output}
                </pre>
              </div>
              <Separator className="my-4" />
              <div className="flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                  Next: Share this XDR with other signers or proceed to sign
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={handleSignTransaction}
                    disabled={isSigning}
                  >
                    {isSigning ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Signing...
                      </div>
                    ) : (
                      'Sign Transaction'
                    )}
                  </Button>
                  <Button className="bg-gradient-success hover:opacity-90">
                    Submit to Network
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};