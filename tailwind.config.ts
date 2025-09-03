import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
    extend: {
      fontFamily: {
        'sans': ['Inter', 'ui-sans-serif', 'system-ui'],
        'mono': ['Source Code Pro', 'ui-monospace', 'SFMono-Regular'],
        'address': ['Source Code Pro', 'ui-monospace', 'SFMono-Regular'],
        'amount': ['Source Code Pro', 'ui-monospace', 'SFMono-Regular'],
      },
      colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))',
					glow: 'hsl(var(--primary-glow))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				success: {
					DEFAULT: 'hsl(var(--success))',
					foreground: 'hsl(var(--success-foreground))',
					glow: 'hsl(var(--success-glow))'
				},
				warning: {
					DEFAULT: 'hsl(var(--warning))'
				},
				info: {
					DEFAULT: 'hsl(var(--info))',
					light: 'hsl(var(--info-light))'
				},
				blue: {
					DEFAULT: 'hsl(var(--blue))',
					foreground: 'hsl(var(--blue-foreground))'
				},
				'stellar-yellow': 'hsl(var(--stellar-yellow))',
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				}
			},
			backgroundImage: {
				'gradient-primary': 'var(--gradient-primary)',
				'gradient-secondary': 'var(--gradient-secondary)',
				'gradient-success': 'var(--gradient-success)',
			},
			boxShadow: {
				'glow': 'var(--shadow-glow)',
				'card': 'var(--shadow-card)',
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			transitionProperty: {
				'smooth': 'var(--transition-smooth)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				'glow-pulse': {
					'0%, 100%': {
						boxShadow: '0 0 20px hsl(var(--primary) / 0.3)'
					},
					'50%': {
						boxShadow: '0 0 40px hsl(var(--primary) / 0.6), 0 0 60px hsl(var(--primary) / 0.4)'
					}
				},
				'glow-pulse-purple': {
					'0%, 100%': {
						boxShadow: '0 0 20px hsl(var(--success) / 0.3)'
					},
					'50%': {
						boxShadow: '0 0 40px hsl(var(--success) / 0.6), 0 0 60px hsl(var(--success) / 0.4)'
					}
				},
				'glow-expand': {
					'0%': {
						boxShadow: '0 0 0px hsl(var(--primary) / 0)'
					},
					'100%': {
						boxShadow: '0 0 30px hsl(var(--primary) / 0.5), 0 0 60px hsl(var(--primary) / 0.3)'
					}
				},
				'glow-expand-purple': {
					'0%': {
						boxShadow: '0 0 0px hsl(var(--success) / 0)'
					},
					'100%': {
						boxShadow: '0 0 30px hsl(var(--success) / 0.5), 0 0 60px hsl(var(--success) / 0.3)'
					}
				},
				'glow-ripple': {
					'0%': {
						boxShadow: '0 0 0 0 hsl(var(--primary) / 0.7)'
					},
					'70%': {
						boxShadow: '0 0 0 10px hsl(var(--primary) / 0)'
					},
					'100%': {
						boxShadow: '0 0 0 0 hsl(var(--primary) / 0)'
					}
				},
				'glow-ripple-purple': {
					'0%': {
						boxShadow: '0 0 0 0 hsl(var(--success) / 0.7)'
					},
					'70%': {
						boxShadow: '0 0 0 10px hsl(var(--success) / 0)'
					},
					'100%': {
						boxShadow: '0 0 0 0 hsl(var(--success) / 0)'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
				'glow-pulse-purple': 'glow-pulse-purple 2s ease-in-out infinite',
				'glow-expand': 'glow-expand 0.3s ease-out forwards',
				'glow-expand-purple': 'glow-expand-purple 0.3s ease-out forwards',
				'glow-ripple': 'glow-ripple 0.6s ease-out',
				'glow-ripple-purple': 'glow-ripple-purple 0.6s ease-out'
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
