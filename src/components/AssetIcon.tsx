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
        className={`bg-gradient-primary rounded-full flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <span 
          className="font-bold text-primary-foreground"
          style={{ fontSize: size * 0.3 }}
        >
          {(assetCode || 'XLM').slice(0, 3)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={assetInfo.image}
      alt={assetInfo.name || assetCode || 'Asset'}
      className={`rounded-full ${className}`}
      style={{ width: size, height: size }}
      onError={handleImageError}
    />
  );
};