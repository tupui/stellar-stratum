import { useEffect, useState } from 'react';

interface LoadingScreenProps {
  onComplete: () => void;
  isLoading: boolean;
}

export const LoadingScreen = ({ onComplete, isLoading }: LoadingScreenProps) => {
  const [grayHoldDone, setGrayHoldDone] = useState(false);
  const [yellow, setYellow] = useState(false);

  // Ensure the title is gray for a minimum time so users can see it before it turns yellow
  useEffect(() => {
    const t = setTimeout(() => {
      setGrayHoldDone(true);
    }, 400);
    return () => clearTimeout(t);
  }, []);

  // When network loading finishes AND we've shown gray long enough, flash yellow then continue
  useEffect(() => {
    if (!isLoading && grayHoldDone && !yellow) {
      setYellow(true);
      setTimeout(() => {
        onComplete();
      }, 100);
    }
  }, [isLoading, grayHoldDone, yellow, onComplete]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background/95 to-background/90">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.15)_0%,transparent_50%)]" />
      </div>
      
      {/* Animated background elements */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-stellar-yellow/30 rounded-full animate-pulse" />
        <div className="absolute bottom-1/3 right-1/4 w-3 h-3 bg-stellar-yellow/20 rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 right-1/3 w-1 h-1 bg-stellar-yellow/40 rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* Main Content */}
      <div className="relative z-10 text-center space-y-8">
        {/* Stratum Title */}
        <h1 className={`text-6xl font-bold transition-all duration-500 ${
          yellow 
            ? 'text-stellar-yellow text-glow-yellow animate-pulse' 
            : 'text-muted-foreground'
        }`}>
          Stratum
        </h1>
        
        {/* Loading Text */}
        <div className="space-y-4">
          <p className="text-xl text-muted-foreground">
            Loading Stellar Multisig Wallet...
          </p>
          
          {/* Loading dots animation */}
          <div className="flex justify-center items-center space-x-2">
            <div className="w-2 h-2 bg-stellar-yellow rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-stellar-yellow rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-2 h-2 bg-stellar-yellow rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
      </div>
    </div>
  );
};