import { cn } from "@/lib/utils";

interface LoadingPillProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const LoadingPill = ({ className, size = "md" }: LoadingPillProps) => {
  const sizeClasses = {
    sm: "h-5 px-2 text-xs",
    md: "h-6 px-3 text-sm", 
    lg: "h-8 px-4 text-base"
  };

  return (
    <div 
      className={cn(
        "inline-flex items-center rounded-full bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20 animate-[shimmer_2s_ease-in-out_infinite] backdrop-blur-sm border border-primary/20",
        sizeClasses[size],
        className
      )}
    >
      <div className="w-2 h-2 rounded-full bg-primary/60 animate-pulse mr-2" />
      <span className="text-muted-foreground font-medium">Loading...</span>
    </div>
  );
};