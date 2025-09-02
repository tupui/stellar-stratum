export const Footer = () => {
  return (
    <footer className="border-t border-border bg-background/80 backdrop-blur-sm">
      <div className="max-w-4xl mx-auto px-6 py-4">
        <p className="text-sm text-muted-foreground text-center">
          © 2025{' '}
          <a 
            href="https://consulting-manao.com/" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-stellar-yellow font-medium hover:underline transition-all duration-300"
          >
            Consulting Manao GmbH
          </a>
        </p>
      </div>
    </footer>
  );
};