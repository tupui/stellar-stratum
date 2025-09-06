import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { QrCode, Check, X, RotateCcw } from 'lucide-react';
import { QRScanner } from '@/components/QRScanner';
import { 
  decodeChunk, 
  reassembleChunks, 
  type QRChunk 
} from '@/lib/xdr/chunking';

interface AnimatedQRScannerProps {
  onDataReceived: (data: string, type: 'xdr' | 'signature') => void;
  expectedType?: 'xdr' | 'signature';
  title: string;
  description?: string;
}

export const AnimatedQRScanner = ({ 
  onDataReceived, 
  expectedType,
  title, 
  description 
}: AnimatedQRScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [chunks, setChunks] = useState<Map<string, QRChunk[]>>(new Map());
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [completedSessions, setCompletedSessions] = useState<string[]>([]);

  const handleQRScan = (data: string) => {
    const chunk = decodeChunk(data);
    
    if (!chunk) {
      console.warn('Invalid QR chunk format');
      return;
    }

    // Filter by expected type if specified
    if (expectedType && chunk.type !== expectedType) {
      console.warn(`Expected ${expectedType} but got ${chunk.type}`);
      return;
    }

    // Update chunks for this session
    setChunks(prev => {
      const sessionChunks = prev.get(chunk.id) || [];
      
      // Check if this part already exists
      const existingIndex = sessionChunks.findIndex(c => c.part === chunk.part);
      if (existingIndex >= 0) {
        // Update existing chunk
        sessionChunks[existingIndex] = chunk;
      } else {
        // Add new chunk
        sessionChunks.push(chunk);
      }

      const newChunks = new Map(prev);
      newChunks.set(chunk.id, sessionChunks);
      
      // Set current session if not set
      if (!currentSession) {
        setCurrentSession(chunk.id);
      }
      
      // Calculate progress for current session
      if (currentSession === chunk.id || !currentSession) {
        const progressPercent = (sessionChunks.length / chunk.total) * 100;
        setProgress(progressPercent);
        
        // Check if session is complete
        const { data: reassembledData, complete } = reassembleChunks(sessionChunks);
        if (complete && !completedSessions.includes(chunk.id)) {
          setCompletedSessions(prev => [...prev, chunk.id]);
          onDataReceived(reassembledData, chunk.type);
          setIsScanning(false);
        }
      }
      
      return newChunks;
    });
  };

  const getCurrentSessionChunks = () => {
    if (!currentSession) return [];
    return chunks.get(currentSession) || [];
  };

  const getCurrentSessionInfo = () => {
    const sessionChunks = getCurrentSessionChunks();
    if (sessionChunks.length === 0) return null;
    
    const firstChunk = sessionChunks[0];
    const uniqueParts = new Set(sessionChunks.map(c => c.part));
    
    return {
      id: firstChunk.id,
      type: firstChunk.type,
      partsReceived: uniqueParts.size,
      totalParts: firstChunk.total,
      complete: uniqueParts.size === firstChunk.total
    };
  };

  const handleReset = () => {
    setChunks(new Map());
    setCurrentSession(null);
    setProgress(0);
    setCompletedSessions([]);
  };

  const sessionInfo = getCurrentSessionInfo();

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {!isScanning ? (
          <div className="space-y-4">
            <Button
              className="w-full"
              onClick={() => setIsScanning(true)}
            >
              <QrCode className="w-4 h-4 mr-2" />
              Start Scanning
            </Button>
            
            {sessionInfo && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Session Progress</span>
                  <Badge variant={sessionInfo.complete ? "default" : "secondary"}>
                    {sessionInfo.complete ? <Check className="w-3 h-3 mr-1" /> : null}
                    {sessionInfo.partsReceived}/{sessionInfo.totalParts}
                  </Badge>
                </div>
                
                <Progress value={progress} className="w-full" />
                
                <div className="text-xs text-muted-foreground text-center">
                  Session ID: {sessionInfo.id} ({sessionInfo.type?.toUpperCase()})
                </div>
                
                {sessionInfo.complete && (
                  <div className="p-2 bg-primary/10 border border-primary/20 rounded text-center">
                    <Check className="w-4 h-4 text-primary mx-auto mb-1" />
                    <p className="text-sm text-primary font-medium">Complete!</p>
                  </div>
                )}
              </div>
            )}

            {chunks.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleReset}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset Scanner
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <QRScanner
              isOpen={isScanning}
              onScan={handleQRScan}
              onClose={() => setIsScanning(false)}
            />
            
            {sessionInfo && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Receiving parts:</span>
                  <span>{sessionInfo.partsReceived}/{sessionInfo.totalParts}</span>
                </div>
                <Progress value={progress} className="w-full" />
              </div>
            )}
            
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setIsScanning(false)}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel Scan
            </Button>
          </div>
        )}

        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>Scan QR codes in any order</p>
          <p>Multi-part codes will be assembled automatically</p>
        </div>
      </CardContent>
    </Card>
  );
};