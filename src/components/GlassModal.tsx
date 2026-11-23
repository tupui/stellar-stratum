import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface GlassModalProps {
  title: string;
  description: string;
  /** Title color: yellow for a step still to take, green for a finished one. */
  tone?: 'pending' | 'done';
  onClose: () => void;
  children: ReactNode;
}

/** The frosted dialog of the share, air-gap and submission results, over the whole page. */
export const GlassModal = ({ title, description, tone = 'pending', onClose, children }: GlassModalProps) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[10000] bg-background/40 supports-[backdrop-filter]:bg-background/30 backdrop-blur-2xl" />
      <div className="fixed inset-0 z-[10001] pointer-events-none bg-[radial-gradient(1200px_600px_at_50%_-10%,hsl(var(--primary)/0.25),transparent_60%)]" />
      <div className="fixed inset-0 z-[10001] pointer-events-none bg-[radial-gradient(800px_400px_at_80%_100%,hsl(var(--success)/0.20),transparent_60%)]" />
      <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4" onClick={onClose}>
        <Card
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/20 bg-card/30 supports-[backdrop-filter]:bg-card/20 backdrop-blur-2xl shadow-xl shadow-primary/10 ring-1 ring-primary/15"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/15 via-transparent to-transparent" />
          <CardHeader className="pb-6 relative">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <CardTitle className={`${tone === 'done' ? 'text-success' : 'text-stellar-yellow'} text-xl font-semibold`}>{title}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close"
                onClick={onClose}
                className="h-8 w-8 p-0 shrink-0 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 max-h-[80vh] overflow-y-auto">{children}</CardContent>
        </Card>
      </div>
    </>,
    document.body,
  );
};
