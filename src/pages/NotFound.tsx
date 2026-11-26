import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Footer } from "@/components/Footer";
import { AppHeader } from "@/components/brand/Shell";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.error(
        "404 Error: User attempted to access non-existent route:",
        location.pathname
      );
    }
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="font-pix text-[140px] font-normal leading-[0.85]">404</h1>
        <p className="lede">Oops! Page not found</p>
        <Button asChild className="mt-4 min-w-[220px]">
          <Link to="/">Return to Home</Link>
        </Button>
      </main>
      <Footer />
    </div>
  );
};

export default NotFound;
