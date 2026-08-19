import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
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
  			sans: ["var(--font-sarabun)", "Sarabun", "system-ui", "sans-serif"],
  		},
  		colors: {
  			// CVC Brand (CVC_Brand Guideline [Color]) — Convert Cake CI
  			brand: {
  				blue: '#1d48f3',   // Convert Blue — สีหลัก
  				deep: '#0618df',   // shade เข้มขึ้น (hover)
  				dark: '#0107a9',   // shade เข้มสุดของ blue
  				sky:  '#177cfe',   // shade อ่อน
  				soft: '#6b8cef',   // shade อ่อนสุด
  				navy: '#000E3F',   // Secure Navy — ตัวอักษร/พื้นเข้ม
  				cyan: '#4ff5e9',   // Tech Cyan — highlight บนพื้นเข้มเท่านั้น (≤2%)
  				gray: '#DAE1E7',   // Easy Gray
  				mist: '#eff5f9',   // Easy Gray อ่อน — พื้นหลังรอง
  			},
  			// ชุดสีเสริม (Additional Colors) — ใช้กับกราฟ/illustration เท่านั้น
  			// กติกา: ไม่เกิน 1-2 สีต่อชิ้นงาน, สัดส่วน Brand:Additional = 95:5
  			addon: {
  				salmon:  '#e35336',
  				crimson: '#bd3239',
  				wine:    '#4e120e',
  				oatmeal: '#fcdfc8',
  				amber:   '#8c684a',
  				mustard: '#ffb95c',
  				sage:    '#769a6d',
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
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
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
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
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
