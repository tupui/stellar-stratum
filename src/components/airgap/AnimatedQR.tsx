import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AnimatedQRProps {
  data: string;
  type: 'xdr' | 'signature';
  title: string;
  description?: string;
}

export const AnimatedQR = ({ data, type, title, description }: AnimatedQRProps) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopyData = async () => {
    await navigator.clipboard.writeText(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: 'Copied to clipboard',
      description: 'Data has been copied to clipboard',
    });
  };
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: 'Copied to clipboard',
      description: `${type.toUpperCase()} data has been copied`,
    });
  };

  if (!data || chunks.length === 0) {
    return null;
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        
        <div className="flex items-center justify-center gap-2">
          <Badge variant="outline">
            {chunks.length === 1 ? 'Static QR' : `Part ${currentIndex + 1} of ${chunks.length}`}
          </Badge>
          {chunks.length > 1 && (
            <Badge variant="secondary">
              Animated
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* QR Code Display */}
        <div className="flex justify-center p-4 bg-white rounded-lg">
          <QRCodeSVG
            value={qrData}
            size={200}
            level="M"
            includeMargin={true}
          />
        </div>

        {/* Controls */}
        {chunks.length > 1 && (
          <div className="flex justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentIndex(0);
                setIsPlaying(false);
              }}
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Manual Navigation */}
        {chunks.length > 1 && (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Manual Navigation
            </p>
            <div className="flex justify-center gap-1 flex-wrap">
              {chunks.map((_, index) => (
                <Button
                  key={index}
                  variant={index === currentIndex ? "default" : "outline"}
                  size="sm"
                  className="w-8 h-8 p-0"
                  onClick={() => {
                    setCurrentIndex(index);
                    setIsPlaying(false);
                  }}
                >
                  {index + 1}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Copy Original Data */}
        <div className="pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleCopyData}
          >
            {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            Copy Original Data
          </Button>
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>Scan this QR code with your signing device</p>
          {chunks.length > 1 && (
            <p>Multiple parts will cycle automatically</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};