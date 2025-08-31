import { useState, useEffect } from 'react';
import { fetchAssetInfo } from '@/lib/assets';

interface AssetIconProps {
  assetCode?: string;
  assetIssuer?: string;
  size?: number;
  className?: string;
}

export const AssetIcon = ({ assetCode, assetIssuer, size = 32, className = "" }: AssetIconProps) => {
  const [assetInfo, setAssetInfo] = useState<{ image?: string; name?: string } | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    const loadAssetInfo = async () => {
      try {
        const info = await fetchAssetInfo(assetCode || 'XLM', assetIssuer);
        if (mounted) {
          setAssetInfo(info);
          setImageError(false);
        }
      } catch (error) {
        if (mounted) {
          setAssetInfo(null);
          setImageError(true);
        }
      }
    };

    loadAssetInfo();
    
    return () => {
      mounted = false;
    };
  }, [assetCode, assetIssuer]);

  const handleImageError = () => {
    setImageError(true);
  };

  // Show gradient fallback if no image or image failed to load
  if (!assetInfo?.image || imageError) {
    return (
      <div 
        className={`bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 rounded-full flex items-center justify-center ring-2 ring-primary/30 shadow-lg ${className}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${assetCode || 'XLM'} asset icon`}
      >
        <span 
          className="font-bold text-primary select-none"
          style={{ fontSize: size * 0.25 }}
          aria-hidden="true"
        >
          {(assetCode || 'XLM').slice(0, 3)}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-full bg-background ring-2 ring-border/60 overflow-hidden shadow-lg ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${assetInfo.name || assetCode || 'Asset'} logo`}
    >
      <img
        src={assetInfo.image}
        alt=""
        className="w-full h-full object-contain p-2"
        onError={handleImageError}
        aria-hidden="true"
      />
    </div>
  );
};