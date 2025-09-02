import { cn } from "@/lib/utils";

interface LoadingPillProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  glowColor?: "primary" | "purple";
}

export const LoadingPill = ({ className, size = "md", glowColor = "purple" }: LoadingPillProps) => {
  const sizeClasses = {
    sm: "h-3 w-8",
    md: "h-4 w-12", 
    lg: "h-5 w-16"
  };

  const glowClasses = {
    primary: "spinner-glow",
    purple: "spinner-purple-glow"
  };

  return (
    <div 
      className={cn(
        "rounded-full animate-[glow-sweep_1.5s_ease-in-out_infinite] shadow-sm",
        "bg-[length:200%_100%]",
        glowClasses[glowColor],
        sizeClasses[size],
        className
      )}
      style={{
        backgroundImage: glowColor === "primary" 
          ? `linear-gradient(90deg, 
              hsl(var(--primary) / 0.2) 0%, 
              hsl(var(--primary-glow) / 0.8) 50%, 
              hsl(var(--primary) / 0.2) 100%)`
          : `linear-gradient(90deg, 
              hsl(var(--success) / 0.2) 0%, 
              hsl(var(--success-glow) / 0.8) 50%, 
              hsl(var(--success) / 0.2) 100%)`
      }}
    />
  );
};