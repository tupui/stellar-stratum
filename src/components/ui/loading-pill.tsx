import { cn } from "@/lib/utils";

interface LoadingPillProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const LoadingPill = ({ className, size = "md" }: LoadingPillProps) => {
  const sizeClasses = {
    sm: "h-3 w-8",
    md: "h-4 w-12", 
    lg: "h-5 w-16"
  };

  return (
    <div 
      className={cn(
        "rounded-full bg-gradient-to-r from-success/20 via-success-glow/60 to-success/20 animate-[glow-sweep_1.5s_ease-in-out_infinite] shadow-sm",
        "bg-[length:200%_100%]",
        sizeClasses[size],
        className
      )}
      style={{
        backgroundImage: `linear-gradient(90deg, 
          hsl(var(--success) / 0.2) 0%, 
          hsl(var(--success-glow) / 0.8) 50%, 
          hsl(var(--success) / 0.2) 100%)`
      }}
    />
  );
};