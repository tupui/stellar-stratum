import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine 
} from 'recharts';
import { useFiatCurrency } from '@/contexts/FiatCurrencyContext';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar,
  TrendingUp,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { format, subDays, subMonths, startOfDay, endOfDay } from 'date-fns';
import { getXlmUsdRateForDate } from '@/lib/kraken';
import { NormalizedTransaction } from '@/lib/horizon-utils';

interface TransactionChartProps {
  transactions: NormalizedTransaction[];
  onDateRangeChange?: (startDate: Date, endDate: Date) => void;
  onRequestMoreData?: () => void;
  currentBalance?: number;
  assetSymbol?: string;
  fiatMode?: boolean;
  fiatAmountMap?: Map<string, number>;
  fiatSymbol?: string;
}

type TimeRange = '7d' | '30d' | '90d' | '1y' | 'all';

interface ChartDataPoint {
  date: string;
  balance: number;
  amount: number;
  direction: 'in' | 'out';
  timestamp: number;
}

export const TransactionChart = ({ 
  transactions, 
  onDateRangeChange,
  onRequestMoreData,
  currentBalance = 0,
  assetSymbol = 'XLM',
  fiatMode = false,
  fiatAmountMap,
  fiatSymbol = '$'
}: TransactionChartProps) => {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('all');
  const [currentOffset, setCurrentOffset] = useState(0);
  const { quoteCurrency } = useFiatCurrency();

  // Calculate date range based on selection
  const dateRange = useMemo(() => {
    const now = new Date();
    const offsetDays = currentOffset * getOffsetMultiplier(selectedRange);
    
    switch (selectedRange) {
      case '7d':
        return {
          start: startOfDay(subDays(now, 7 + offsetDays)),
          end: endOfDay(subDays(now, offsetDays))
        };
      case '30d':
        return {
          start: startOfDay(subDays(now, 30 + offsetDays)),
          end: endOfDay(subDays(now, offsetDays))
        };
      case '90d':
        return {
          start: startOfDay(subDays(now, 90 + offsetDays)),
          end: endOfDay(subDays(now, offsetDays))
        };
      case '1y':
        return {
          start: startOfDay(subDays(now, 365 + offsetDays)),
          end: endOfDay(subDays(now, offsetDays))
        };
      case 'all':
      default:
        const oldestDate = transactions.reduce((earliest, tx) => {
          const d = new Date(tx.createdAt).getTime();
          return d < earliest ? d : earliest;
        }, Number.POSITIVE_INFINITY);

        return {
          start: Number.isFinite(oldestDate) ? new Date(oldestDate) : subDays(now, 30),
          end: now,
        };
    }
  }, [selectedRange, currentOffset, transactions]);

  // Filter and prepare chart data
  const chartData = useMemo((): ChartDataPoint[] => {
    // Get all transactions in chronological order (oldest first)
    const allTxs = transactions
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Filter for date range
    const filteredTxs = allTxs.filter(tx => {
      const txDate = new Date(tx.createdAt);
      return txDate >= dateRange.start && txDate <= dateRange.end;
    });

    if (filteredTxs.length === 0) {
      // No transactions in range - show current balance as flat line
      const balance = Number(currentBalance) || 0;
      
      return [
        {
          date: format(dateRange.start, getDateFormat(selectedRange)),
          balance: balance,
          amount: 0,
          direction: 'in',
          timestamp: dateRange.start.getTime(),
        },
        {
          date: format(dateRange.end, getDateFormat(selectedRange)),
          balance: balance,
          amount: 0,
          direction: 'in',
          timestamp: dateRange.end.getTime(),
        }
      ];
    }

    const points: ChartDataPoint[] = [];
    
    // Calculate starting balance by working backwards from current balance
    let startingBalance = fiatMode ? (Number(currentBalance) || 0) : (Number(currentBalance) || 0);
    
    // Work backwards through filtered transactions to find starting balance
    for (let i = filteredTxs.length - 1; i >= 0; i--) {
      const tx = filteredTxs[i];
      let deltaAmount = tx.amount ?? 0;
      if (fiatMode && fiatAmountMap) {
        deltaAmount = fiatAmountMap.get(tx.id) ?? 0;
      }
      
      // Reverse the transaction effect to get earlier balance
      if (tx.direction === 'in') {
        startingBalance -= deltaAmount;
      } else if (tx.direction === 'out') {
        startingBalance += deltaAmount;
      }
    }
    
    // Ensure starting balance is not negative
    startingBalance = Math.max(0, startingBalance);
    
    let runningBalance = startingBalance;
    const firstTxDate = new Date(filteredTxs[0].createdAt);

    // Add starting point
    points.push({
      date: format(firstTxDate, getDateFormat(selectedRange)),
      balance: runningBalance,
      amount: 0,
      direction: 'in',
      timestamp: firstTxDate.getTime(),
    });

    // Process each transaction chronologically
    filteredTxs.forEach(tx => {
      const amount = tx.amount ?? 0;
      
      // For portfolio mode, use fiat amounts; for asset-specific, use native amounts
      let deltaAmount = amount;
      if (fiatMode && fiatAmountMap) {
        deltaAmount = fiatAmountMap.get(tx.id) ?? 0;
      }
      
      // Apply transaction to balance
      if (tx.direction === 'in') {
        runningBalance += deltaAmount;
      } else if (tx.direction === 'out') {
        runningBalance -= deltaAmount;
      }
      
      // Ensure balance never goes negative (shouldn't happen with correct data)
      runningBalance = Math.max(0, runningBalance);
      
      const txDate = new Date(tx.createdAt);
      points.push({
        date: format(txDate, getDateFormat(selectedRange)),
        balance: runningBalance,
        amount: deltaAmount,
        direction: tx.direction || 'in',
        timestamp: txDate.getTime(),
      });
    });

    // Add final point at end of range - use current balance to anchor the end
    const finalBalance = fiatMode ? (Number(currentBalance) || 0) : (Number(currentBalance) || 0);
    points.push({
      date: format(dateRange.end, getDateFormat(selectedRange)),
      balance: finalBalance,
      amount: 0,
      direction: 'in',
      timestamp: dateRange.end.getTime(),
    });

    return points;
  }, [transactions, dateRange, selectedRange, currentBalance]);

  // Aggregate data for better visualization on longer time ranges
  const aggregatedData = useMemo((): ChartDataPoint[] => {
    if (selectedRange === '7d' || chartData.length <= 50) {
      return chartData;
    }

    // Group by time intervals for longer ranges
    const interval = getAggregationInterval(selectedRange);
    const grouped = new Map<string, ChartDataPoint[]>();

    chartData.forEach(point => {
      const key = getIntervalKey(point.timestamp, interval);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(point);
    });

    return Array.from(grouped.entries())
      .map(([key, points]) => {
        // Use the last point's balance as it represents the end-of-period balance
        const lastPoint = points[points.length - 1];
        return {
          ...lastPoint,
          date: format(new Date(parseInt(key)), getDateFormat(selectedRange)),
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [chartData, selectedRange]);

  const handleRangeChange = (range: TimeRange) => {
    setSelectedRange(range);
    setCurrentOffset(0);
    
    if (onDateRangeChange) {
      // Trigger callback to potentially load more data
      const newRange = getDateRangeForSelection(range, 0);
      onDateRangeChange(newRange.start, newRange.end);
    }
  };

  const handleNavigation = (direction: 'prev' | 'next') => {
    const newOffset = direction === 'prev' ? currentOffset + 1 : Math.max(0, currentOffset - 1);
    setCurrentOffset(newOffset);

    if (onDateRangeChange) {
      const newRange = getDateRangeForSelection(selectedRange, newOffset);
      onDateRangeChange(newRange.start, newRange.end);
    }

    // Request more data if navigating to older periods
    if (direction === 'prev' && onRequestMoreData) {
      onRequestMoreData();
    }
  };

  const canNavigateNext = currentOffset > 0;
  const canNavigatePrev = selectedRange !== 'all';

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-5 h-5" />
            Balance Trend
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {/* Time Range Selector */}
            <Select value={selectedRange} onValueChange={handleRangeChange}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7D</SelectItem>
                <SelectItem value="30d">30D</SelectItem>
                <SelectItem value="90d">90D</SelectItem>
                <SelectItem value="1y">1Y</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>

            {/* Navigation Controls */}
            {selectedRange !== 'all' && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleNavigation('prev')}
                  disabled={!canNavigatePrev}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleNavigation('next')}
                  disabled={!canNavigateNext}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
        
        {/* Date Range Display */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>
            {format(dateRange.start, 'MMM dd, yyyy')} - {format(dateRange.end, 'MMM dd, yyyy')}
          </span>
          <span>•</span>
          <span>{aggregatedData.length} data points</span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="h-64 w-full font-amount tabular-nums">
          {aggregatedData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={aggregatedData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis 
                  dataKey="date"
                  tick={{ fontSize: 10, fontFamily: 'Source Code Pro, ui-monospace, SFMono-Regular' }}
                  tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis 
                  tick={{ fontSize: 10, fontFamily: 'Source Code Pro, ui-monospace, SFMono-Regular' }}
                  tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(value) => `${Number(value).toFixed(1)}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  wrapperStyle={{ fontFamily: 'Source Code Pro, ui-monospace, SFMono-Regular' }}
                  formatter={(value: any) => [
                    fiatMode ? `${Number(value).toFixed(2)} ${fiatSymbol}` : `${Number(value).toFixed(7)} ${assetSymbol}`,
                    'Balance'
                  ]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                
                {/* Zero line reference */}
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
                
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 2, fill: 'hsl(var(--primary))' }}
                  activeDot={{ 
                    r: 4, 
                    stroke: 'hsl(var(--primary-glow))',
                    fill: 'hsl(var(--primary))'
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No data for selected period</p>
                <p className="text-sm mt-1">Try a different time range</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// Helper functions
function getOffsetMultiplier(range: TimeRange): number {
  switch (range) {
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    case '1y': return 365;
    default: return 30;
  }
}

function getDateFormat(range: TimeRange): string {
  switch (range) {
    case '7d': return 'MMM dd HH:mm';
    case '30d': return 'MMM dd';
    case '90d': return 'MMM dd';
    case '1y': return 'MMM yyyy';
    case 'all': return 'MMM dd, yyyy'; // Include year for full history
    default: return 'MMM dd, yyyy'; // Include year by default
  }
}

function getAggregationInterval(range: TimeRange): number {
  switch (range) {
    case '30d': return 24 * 60 * 60 * 1000; // 1 day
    case '90d': return 3 * 24 * 60 * 60 * 1000; // 3 days
    case '1y': return 7 * 24 * 60 * 60 * 1000; // 1 week
    default: return 24 * 60 * 60 * 1000; // 1 day
  }
}

function getIntervalKey(timestamp: number, interval: number): string {
  return Math.floor(timestamp / interval).toString();
}

function getDateRangeForSelection(range: TimeRange, offset: number) {
  const now = new Date();
  const offsetDays = offset * getOffsetMultiplier(range);
  
  switch (range) {
    case '7d':
      return {
        start: startOfDay(subDays(now, 7 + offsetDays)),
        end: endOfDay(subDays(now, offsetDays))
      };
    case '30d':
      return {
        start: startOfDay(subDays(now, 30 + offsetDays)),
        end: endOfDay(subDays(now, offsetDays))
      };
    case '90d':
      return {
        start: startOfDay(subDays(now, 90 + offsetDays)),
        end: endOfDay(subDays(now, offsetDays))
      };
    case '1y':
      return {
        start: startOfDay(subDays(now, 365 + offsetDays)),
        end: endOfDay(subDays(now, offsetDays))
      };
    case 'all':
    default:
      return {
        start: startOfDay(subDays(now, 365)),
        end: now
      };
  }
}