import { useState, useEffect } from 'react';
import { fetchAssetInfo } from '@/lib/assets';
import { cn } from '@/lib/utils';
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
    // Only native XLM and issued assets have metadata to look up (e.g. not LP shares)
    if (assetCode && assetCode !== 'XLM' && !assetIssuer) {
      setAssetInfo(null);
      return;
    }

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

  // One square well for every asset: the logo when there is one, else the code's first letter.
  const code = assetCode || 'XLM';
  const wellStyle = { width: size, height: size };
  if (!assetInfo?.image || imageError) {
    return (
      <div
        className={cn('coin font-pix leading-none text-foreground', className)}
        style={{ ...wellStyle, fontSize: Math.round(size * 0.56) }}
        role="img"
        aria-label={`${code} asset icon`}
      >
        <span className="select-none" aria-hidden="true">{code.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div
      className={cn('coin p-0.5', className)}
      style={wellStyle}
      role="img"
      aria-label={`${assetInfo.name || assetCode || 'Asset'} logo`}
    >
      <img
        src={assetInfo.image}
        alt=""
        // the Stellar logo is black on transparent: drawn white on the dark well
        className={cn('h-full w-full object-contain', code === 'XLM' && !assetIssuer && 'invert')}
        onError={handleImageError}
        referrerPolicy="no-referrer"
        aria-hidden="true"
      />
    </div>
  );
};
