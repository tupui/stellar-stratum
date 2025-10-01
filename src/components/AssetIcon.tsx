import { useState, useEffect } from 'react';
import { fetchAssetInfo, getAssetColor } from '@/lib/assets';
import { useNetwork } from '@/contexts/NetworkContext';

interface AssetIconProps {
  assetCode?: string;
  assetIssuer?: string;
  size?: number;
  className?: string;
}

export const AssetIcon = ({ assetCode, assetIssuer, size = 32, className = "" }: AssetIconProps) => {
  const { network } = useNetwork();
  const [assetInfo, setAssetInfo] = useState<{ image?: string; name?: string } | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    const loadAssetInfo = async () => {
      try {
        const info = await fetchAssetInfo(assetCode || 'XLM', assetIssuer, network);
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
  }, [assetCode, assetIssuer, network]);

  const handleImageError = () => {
    setImageError(true);
  };

  // Generate unique color for this asset
  const { hue, saturation, lightness } = getAssetColor(assetCode || 'XLM', assetIssuer);
  
  // Show gradient fallback if no image or image failed to load
  if (!assetInfo?.image || imageError) {
    return (
      <div 
        className={`rounded-full flex items-center justify-center shadow-lg ${className}`}
        style={{ 
          width: size, 
          height: size,
          background: `linear-gradient(135deg, hsl(${hue}, ${saturation}%, ${lightness}%), hsl(${(hue + 30) % 360}, ${saturation}%, ${lightness + 10}%))`,
          border: `2px solid hsl(${hue}, ${saturation}%, ${lightness - 10}%, 0.3)`
        }}
        role="img"
        aria-label={`${assetCode || 'XLM'} asset icon`}
      >
        <span 
          className="font-bold select-none"
          style={{ 
            fontSize: size * 0.3,
            color: `hsl(${hue}, ${saturation}%, ${lightness > 60 ? 20 : 95}%)`
          }}
          aria-hidden="true"
        >
          {(assetCode || 'XLM').slice(0, 3).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-full bg-white overflow-hidden shadow-sm border border-border/20 p-0.5 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${assetInfo.name || assetCode || 'Asset'} logo`}
    >
      <img
        src={assetInfo.image}
        alt=""
        className="w-full h-full object-cover"
        onError={handleImageError}
        referrerPolicy="no-referrer"
        aria-hidden="true"
      />
    </div>
  );
};