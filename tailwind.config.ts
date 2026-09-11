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
  			border: 'var(--border)',
  			input: 'var(--input)',
  			ring: 'var(--ring)',
  			background: 'var(--background)',
  			foreground: 'var(--foreground)',
  			primary: {
  				DEFAULT: 'var(--primary)',
  				foreground: 'var(--primary-foreground)'
  			},
  			secondary: {
  				DEFAULT: 'var(--secondary)',
  				foreground: 'var(--secondary-foreground)'
  			},
  			destructive: {
  				DEFAULT: 'var(--destructive)',
  				foreground: 'var(--destructive-foreground)'
  			},
  			muted: {
  				DEFAULT: 'var(--muted)',
  				foreground: 'var(--muted-foreground)'
  			},
  			accent: {
  				DEFAULT: 'var(--accent)',
  				foreground: 'var(--accent-foreground)'
  			},
  			popover: {
  				DEFAULT: 'var(--popover)',
  				foreground: 'var(--popover-foreground)'
  			},
  			card: {
  				DEFAULT: 'var(--card)',
  				foreground: 'var(--card-foreground)'
  			},
  			sidebar: {
  				DEFAULT: 'var(--sidebar)',
  				foreground: 'var(--sidebar-foreground)',
  				primary: 'var(--sidebar-primary)',
  				'primary-foreground': 'var(--sidebar-primary-foreground)',
  				accent: 'var(--sidebar-accent)',
  				'accent-foreground': 'var(--sidebar-accent-foreground)',
  				border: 'var(--sidebar-border)',
  				ring: 'var(--sidebar-ring)'
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
