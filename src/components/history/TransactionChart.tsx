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
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  TrendingUp
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, startOfMonth } from 'date-fns';
import { NormalizedTransaction } from '@/lib/horizon-utils';

interface TransactionChartProps {
  transactions: NormalizedTransaction[];
  /** Signed change a transaction made to the charted balance; 0 when it did not touch it. */
  getDelta: (tx: NormalizedTransaction) => number;
  onRequestMoreData?: () => void;
  currentBalance?: number;
  assetSymbol?: string;
  fiatMode?: boolean;
  fiatSymbol?: string;
}

type TimeRange = '7d' | '30d' | '90d' | '1y' | 'all';

interface ChartDataPoint {
  date: string;
  balance: number;
  timestamp: number;
}

export const TransactionChart = ({
  transactions,
  getDelta,
  onRequestMoreData,
  currentBalance = 0,
  assetSymbol = 'XLM',
  fiatMode = false,
  fiatSymbol = '$'
}: TransactionChartProps) => {
  const [selectedRange, setSelectedRange] = useState<TimeRange>('all');
  const [currentOffset, setCurrentOffset] = useState(0);

  // Balance changes in time order, leaving out transactions that don't touch the balance
  const moves = useMemo(() => transactions
    .map(tx => ({ timestamp: new Date(tx.createdAt).getTime(), delta: getDelta(tx) }))
    .filter(move => move.timestamp > 0 && move.delta !== 0) // also drops invalid dates (NaN)
    .sort((a, b) => a.timestamp - b.timestamp),
  [transactions, getDelta]);

  const dateRange = useMemo(
    () => getDateRange(selectedRange, currentOffset, moves[0]?.timestamp),
    [selectedRange, currentOffset, moves],
  );

  const chartData = useMemo(
    () => buildBalancePoints(moves, dateRange, selectedRange, Number(currentBalance) || 0),
    [moves, dateRange, selectedRange, currentBalance],
  );

  // Aggregate data for better visualization on longer time ranges
  const aggregatedData = useMemo((): ChartDataPoint[] => {
    // Define max data points per range for optimal readability
    const maxDataPoints = {
      '7d': 14,    // 12-hour intervals
      '30d': 15,   // 2-day intervals  
      '90d': 13,   // 1-week intervals
      '1y': 12,    // 1-month intervals
      'all': 12    // 1-month intervals
    };
    
    if (chartData.length <= maxDataPoints[selectedRange]) {
      return chartData;
    }

    // Group by time buckets for longer ranges. Points are in time order, so the
    // last one written to a bucket is its end-of-period balance.
    const buckets = new Map<number, ChartDataPoint>();
    for (const point of chartData) {
      buckets.set(getBucketStart(point.timestamp, selectedRange), point);
    }

    return Array.from(buckets.entries()).map(([bucketStart, point]) => ({
      ...point,
      date: format(bucketStart, getDateFormat(selectedRange)),
    }));
  }, [chartData, selectedRange]);

  const handleRangeChange = (range: TimeRange) => {
    setSelectedRange(range);
    setCurrentOffset(0);
  };

  const handleNavigation = (direction: 'prev' | 'next') => {
    const newOffset = direction === 'prev' ? currentOffset + 1 : Math.max(0, currentOffset - 1);
    setCurrentOffset(newOffset);

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
            <ResponsiveContainer width="100%" height={256} debounce={100}>
              <LineChart data={aggregatedData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis 
                  dataKey="date"
                  tick={{ fontSize: 10, fontFamily: 'Source Code Pro, ui-monospace, SFMono-Regular' }}
                  tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(value, index) => {
                    // Smart tick formatting to avoid overlap and show meaningful dates
                    const totalTicks = aggregatedData.length;
                    const maxTicks = {
                      '7d': 7,    // Show up to 7 ticks for weekly view
                      '30d': 6,   // Show up to 6 ticks for monthly view
                      '90d': 5,   // Show up to 5 ticks for quarterly view
                      '1y': 4,    // Show up to 4 ticks for yearly view
                      'all': 4    // Show up to 4 ticks for full history
                    };
                    
                    const maxTicksForRange = maxTicks[selectedRange] || 5;
                    const tickInterval = Math.max(1, Math.ceil(totalTicks / maxTicksForRange));
                    
                    // Always show first and last tick
                    if (index === 0 || index === totalTicks - 1) {
                      return value;
                    }
                    
                    // Show every nth tick based on data density
                    if (index % tickInterval === 0) {
                      return value;
                    }
                    
                    return '';
                  }}
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
                  formatter={(value: number | string) => [
                    fiatMode ? `${Number(value).toFixed(2)} ${fiatSymbol}` : `${Number(value).toFixed(7)} ${assetSymbol}`,
                    'Balance'
                  ]}
                  labelFormatter={(label, payload) => {
                    const timestamp = payload?.[0]?.payload?.timestamp;
                    return `Date: ${timestamp ? format(timestamp, 'MMM dd, yyyy') : label}`;
                  }}
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
const RANGE_DAYS: Record<Exclude<TimeRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

// Window shown for a range, `offset` windows back from today. 'All' spans from
// the oldest loaded balance change to now.
function getDateRange(range: TimeRange, offset: number, oldest?: number) {
  const now = new Date();
  if (range === 'all') {
    return { start: oldest !== undefined ? new Date(oldest) : subDays(now, 30), end: now };
  }
  const days = RANGE_DAYS[range];
  return {
    start: startOfDay(subDays(now, days * (offset + 1))),
    end: endOfDay(subDays(now, days * offset)),
  };
}

// Rebuild the balance over a window from today's balance and the time-ordered moves.
function buildBalancePoints(
  moves: Array<{ timestamp: number; delta: number }>,
  window: { start: Date; end: Date },
  range: TimeRange,
  currentBalance: number,
): ChartDataPoint[] {
  const start = window.start.getTime();
  const end = window.end.getTime();
  const point = (timestamp: number, balance: number): ChartDataPoint => ({
    date: format(timestamp, getDateFormat(range)),
    // Movements we can't see (fees, DEX offers, claims) can push a rebuilt balance below zero
    balance: Math.max(0, balance),
    timestamp,
  });

  // Balance at the end of the window: undo everything that happened after it
  let balance = currentBalance;
  for (const move of moves) {
    if (move.timestamp > end) balance -= move.delta;
  }
  const endBalance = balance;

  // Then walk back through the window to its opening balance
  const inWindow = moves.filter(move => move.timestamp >= start && move.timestamp <= end);
  for (const move of inWindow) balance -= move.delta;

  const points = [point(start, balance)];
  for (const move of inWindow) {
    balance += move.delta;
    points.push(point(move.timestamp, balance));
  }
  points.push(point(end, endBalance));
  return points;
}

function getDateFormat(range: TimeRange): string {
  switch (range) {
    case '7d': return 'MMM dd'; // Show day and month for weekly view
    case '30d': return 'MMM dd'; // Show day and month for monthly view
    case '90d': return 'MMM dd'; // Weekly buckets for quarterly view
    case '1y': return 'MMM yyyy'; // Show month and year for yearly view
    case 'all': return 'MMM yyyy'; // Show month and year for full history
    default: return 'MMM yyyy'; // Default to month and year
  }
}

// Start of the bucket a point is aggregated into: calendar months for the long
// ranges, fixed windows (12 hours, 2 days, 1 week) for the others.
function getBucketStart(timestamp: number, range: TimeRange): number {
  if (range === '1y' || range === 'all') return startOfMonth(timestamp).getTime();
  const hours = range === '7d' ? 12 : range === '30d' ? 48 : 7 * 24;
  const interval = hours * 60 * 60 * 1000;
  return Math.floor(timestamp / interval) * interval;
}