import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Send, FileCode, ArrowLeft, Copy, Check, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  Transaction, 
  TransactionBuilder as StellarTransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo,
  Horizon
} from '@stellar/stellar-sdk';
import { signTransaction, horizonServer, submitTransaction, submitToRefractor, pullFromRefractor } from '@/lib/stellar';
import { XdrDetails } from './XdrDetails';
import { SignerSelector } from './SignerSelector';
import { NetworkSelector } from './NetworkSelector';
import { RefractorIntegration } from './RefractorIntegration';

interface TransactionBuilderProps {
  onBack: () => void;
  accountPublicKey: string;
  accountData: {
    signers: Array<{
      key: string;
      weight: number;
      type: string;
    }>;
    thresholds: {
      med_threshold: number;
    };
  };
}

export const TransactionBuilder = ({ onBack, accountPublicKey, accountData }: TransactionBuilderProps) => {
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentNetwork, setCurrentNetwork] = useState<'mainnet' | 'testnet'>('mainnet');
  const [signedBy, setSignedBy] = useState<Array<{ signerKey: string; signedAt: Date }>>([]);
  const [refractorId, setRefractorId] = useState<string>('');
  const [successData, setSuccessData] = useState<{ hash: string; network: 'mainnet' | 'testnet' } | null>(null);

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
      // Determine network and Horizon server
      const networkPassphrase = currentNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
      const server = currentNetwork === 'testnet'
        ? new Horizon.Server('https://horizon-testnet.stellar.org')
        : new Horizon.Server('https://horizon.stellar.org');

      // Load source account
      const sourceAccount = await server.loadAccount(accountPublicKey);
      
      // Create transaction builder
      const transaction = new StellarTransactionBuilder(sourceAccount, {
        fee: '100000', // 0.01 XLM
        networkPassphrase,
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
      transaction.setTimeout(86400);

      // Build the transaction
      const builtTransaction = transaction.build();
      const xdr = builtTransaction.toXDR();
      
      setXdrData(prev => ({ ...prev, output: xdr }));
      
      toast({
        title: "Transaction built successfully",
        description: "XDR is ready for signing",
        duration: 5000,
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
        const networkPassphrase = currentNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
        new Transaction(xdrData.input, networkPassphrase);
      } catch (parseError) {
        throw new Error('Invalid XDR format');
      }
      
      toast({
        title: "XDR processed",
        description: "Transaction is ready for signing",
        duration: 5000,
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
        duration: 5000,
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

  const handleSignWithSigner = async (signerKey: string) => {
    const xdrToSign = xdrData.output || xdrData.input;
    if (!xdrToSign) return;
    
    setIsSigning(true);
    try {
      const signedXdr = await signTransaction(xdrToSign);
      setXdrData(prev => ({ ...prev, output: signedXdr }));
      
      // Add to signed by list
      setSignedBy(prev => [...prev, { signerKey, signedAt: new Date() }]);
      
      toast({
        title: "Transaction signed",
        description: `Signed with ${signerKey.slice(0, 8)}...${signerKey.slice(-8)}`,
        duration: 5000,
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

  const handleSubmitToNetwork = async () => {
    const xdrToSubmit = xdrData.output;
    if (!xdrToSubmit) return;
    
    setIsSubmitting(true);
    try {
      const result = await submitTransaction(xdrToSubmit, currentNetwork);
      
      // Store success data for display
      setSuccessData({ hash: result.hash, network: currentNetwork });
      
      toast({
        title: "Transaction submitted successfully",
        description: `Transaction hash: ${result.hash}`,
        duration: 5000,
      });
      
      // Reset form
      setXdrData({ input: '', output: '' });
      setSignedBy([]);
    } catch (error) {
      console.error('Submission error:', error);
      toast({
        title: "Submission failed",
        description: error instanceof Error ? error.message : "Failed to submit transaction",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitToRefractor = async () => {
    const xdrToSubmit = xdrData.output || xdrData.input;
    if (!xdrToSubmit) return;
    
    setIsSubmitting(true);
    try {
      const id = await submitToRefractor(xdrToSubmit, currentNetwork);
      setRefractorId(id);
      
      toast({
        title: "Submitted to Refractor",
        description: `Transaction ID: ${id}`,
        duration: 5000,
      });
    } catch (error) {
      console.error('Refractor submission error:', error);
      toast({
        title: "Refractor submission failed",
        description: error instanceof Error ? error.message : "Failed to submit to Refractor",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePullFromRefractor = async (id: string) => {
    try {
      const xdr = await pullFromRefractor(id);
      setXdrData(prev => ({ ...prev, input: xdr, output: '' }));
      setSignedBy([]);
      
      toast({
        title: "Transaction pulled from Refractor",
        description: "XDR loaded successfully",
        duration: 5000,
      });
    } catch (error) {
      console.error('Refractor pull error:', error);
      toast({
        title: "Failed to pull from Refractor",
        description: error instanceof Error ? error.message : "Invalid Refractor ID or network error",
        variant: "destructive",
      });
    }
  };

  const getCurrentWeight = () => {
    return signedBy.reduce((total, signed) => {
      const signer = accountData.signers.find(s => s.key === signed.signerKey);
      return total + (signer?.weight || 0);
    }, 0);
  };

  const canSubmitToNetwork = getCurrentWeight() >= accountData.thresholds.med_threshold;
  const canSubmitToRefractor = Boolean(xdrData.output || xdrData.input);

  const copyXDR = async () => {
    const textToCopy = xdrData.output || xdrData.input;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied to clipboard",
        description: "XDR has been copied",
        duration: 3000,
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

        {/* XDR Details */}
        {(xdrData.output || xdrData.input) && (
          <XdrDetails 
            xdr={xdrData.output || xdrData.input} 
            network={currentNetwork}
          />
        )}

        {/* Signer Selector */}
        {(xdrData.output || xdrData.input) && (
          <SignerSelector
            signers={accountData.signers}
            currentAccountKey={accountPublicKey}
            signedBy={signedBy}
            requiredWeight={accountData.thresholds.med_threshold}
            onSignWithSigner={handleSignWithSigner}
            isSigning={isSigning}
          />
        )}

        {/* Network Selector & Submission */}
        {(xdrData.output || xdrData.input) && (
          <NetworkSelector
            currentNetwork={currentNetwork}
            onNetworkChange={setCurrentNetwork}
            onSubmitToNetwork={handleSubmitToNetwork}
            onSubmitToRefractor={handleSubmitToRefractor}
            canSubmitToNetwork={canSubmitToNetwork}
            canSubmitToRefractor={canSubmitToRefractor}
            isSubmitting={isSubmitting}
          />
        )}

        {/* Refractor Integration */}
        <RefractorIntegration
          onPullTransaction={handlePullFromRefractor}
          lastRefractorId={refractorId}
        />

        {/* Transaction Success */}
        {successData && (
          <Card className="shadow-card border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
            <CardHeader>
              <CardTitle className="text-green-700 dark:text-green-300 flex items-center gap-2">
                <Check className="w-5 h-5" />
                Transaction Submitted Successfully
              </CardTitle>
              <CardDescription>
                Your transaction has been successfully submitted to the Stellar network
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Transaction Hash</Label>
                <div className="bg-background p-3 rounded-lg">
                  <p className="font-mono text-sm break-all">{successData.hash}</p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    const baseUrl = successData.network === 'testnet' 
                      ? 'https://stellar.expert/explorer/testnet' 
                      : 'https://stellar.expert/explorer/public';
                    window.open(`${baseUrl}/tx/${successData.hash}`, '_blank');
                  }}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on Stellar Expert
                </Button>
                
                <Button 
                  variant="secondary"
                  onClick={() => setSuccessData(null)}
                >
                  Create Another Transaction
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
};