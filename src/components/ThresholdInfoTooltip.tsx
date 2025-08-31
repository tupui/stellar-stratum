import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

export const ThresholdInfoTooltip = () => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="shrink-0">
            <Info className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <div className="space-y-2 text-sm">
            <p><strong>Low threshold:</strong> Trust lines, bump sequence</p>
            <p><strong>Medium threshold:</strong> Payments, offers, manage data</p>
            <p><strong>High threshold:</strong> Account changes, merge account</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};