import type { Config } from "tailwindcss";
import twColors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

/* ── Theme tokens (light / dark) ───────────────────────────────────────────────
 * Colours that must change between light and dark are CSS variables holding an
 * "r g b" triplet. Light values equal the previous hard-coded hex, so the light
 * theme renders exactly as before. `.dark` on <html> swaps the triplets.
 * `.force-light` (and `.article-preview`) re-declare the light values, for
 * surfaces that must stay light in dark mode (article paper, previews).
 * Rule of thumb for per-utility overrides below:
 *   - backgrounds / borders: the pale shades (50–200) become dark tints
 *   - text: the strong shades (600–900) become light tints
 *   - solid fills such as bg-red-600 or bg-brand-blue keep their colour, so
 *     white text on them stays readable in both themes.
 */
type Rgb = [number, number, number];
const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const triplet = (c: Rgb | string): string => (typeof c === "string" ? hexToRgb(c) : c).join(" ");
const mix = (hex: string, base: Rgb, a: number): Rgb => {
  const c = hexToRgb(hex);
  return [0, 1, 2].map((i) => Math.round(c[i] * a + base[i] * (1 - a))) as Rgb;
};
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
// เทาอมน้ำเงิน (ไล่จาก Secure Navy) — แทนเทากลางของ Tailwind ทั้งระบบ
const GRAY_LIGHT: Record<number, string> = {
  50: "#f6f8fb", 100: "#eef2f7", 200: "#e1e7ef", 300: "#cbd3df", 400: "#98a3b6", 500: "#68748a",
  600: "#4a566d", 700: "#364157", 800: "#1f2a44", 900: "#0e1833", 950: "#060d24",
};
// โหมดมืด: ไล่กลับด้าน (50 = พื้นรองเข้ม, 900 = ตัวอักษรสว่าง) บนโทน Secure Navy
const GRAY_DARK: Record<number, string> = {
  50: "#141d3c", 100: "#1b264a", 200: "#27335c", 300: "#364471", 400: "#68769c", 500: "#8e9aba",
  600: "#aeb8d2", 700: "#c8d0e4", 800: "#dee4f2", 900: "#eef2fa", 950: "#f8faff",
};
// พื้นเทาเข้ม (bg-gray-600…950) มักคู่กับตัวอักษรขาว — ไม่กลับด้าน แค่ยกให้เห็นบนพื้นมืด
const GRAY_FILL_DARK: Record<number, string> = { 600: "#4a5a8a", 700: "#3a4876", 800: "#2d3a66", 900: "#26325c", 950: "#1e284e" };
const SURFACE_DARK: Rgb = [15, 23, 49];

const FAMILIES = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"] as const;
const TINT_SHADES = [50, 100, 200] as const;
const TINT_ALPHA: Record<number, number> = { 50: 0.13, 100: 0.2, 200: 0.32 };
const TEXT_SHADES = [600, 700, 800, 900] as const;
const TEXT_DARK_FROM: Record<number, number> = { 600: 400, 700: 300, 800: 200, 900: 100 };
const tw = twColors as unknown as Record<string, Record<number, string>>;

const lightVars: Record<string, string> = {
  "--surface": "255 255 255",
  "--line-white": "255 255 255",
  "--ink": triplet("#000E3F"),
  "--navy-fill": triplet("#000E3F"),
  "--t-blue": triplet("#1d48f3"),
  "--t-deep": triplet("#0618df"),
  "--t-dark": triplet("#0107a9"),
  "--mist": triplet("#eff5f9"),
  "--easy": triplet("#DAE1E7"),
};
const darkVars: Record<string, string> = {
  "--surface": triplet(SURFACE_DARK),
  "--line-white": "52 66 112",
  "--ink": "236 241 252",
  "--navy-fill": "45 66 150",
  "--t-blue": "128 158 255",
  "--t-deep": "150 174 255",
  "--t-dark": "170 190 255",
  "--mist": "22 32 66",
  "--easy": "39 51 92",
};
for (const s of SHADES) {
  lightVars[`--g-${s}`] = triplet(GRAY_LIGHT[s]);
  darkVars[`--g-${s}`] = triplet(GRAY_DARK[s]);
  lightVars[`--sl-${s}`] = triplet(tw.slate[s]);
  darkVars[`--sl-${s}`] = triplet(GRAY_DARK[s]);
  if (s >= 600) {
    lightVars[`--gf-${s}`] = triplet(GRAY_LIGHT[s]);
    darkVars[`--gf-${s}`] = triplet(GRAY_FILL_DARK[s]);
    lightVars[`--slf-${s}`] = triplet(tw.slate[s]);
    darkVars[`--slf-${s}`] = triplet(GRAY_FILL_DARK[s]);
  }
}
for (const f of FAMILIES) {
  for (const s of TINT_SHADES) {
    lightVars[`--bg-${f}-${s}`] = triplet(tw[f][s]);
    darkVars[`--bg-${f}-${s}`] = triplet(mix(tw[f][500], SURFACE_DARK, TINT_ALPHA[s]));
  }
  for (const s of TEXT_SHADES) {
    lightVars[`--tx-${f}-${s}`] = triplet(tw[f][s]);
    darkVars[`--tx-${f}-${s}`] = triplet(tw[f][TEXT_DARK_FROM[s]]);
  }
}

const scale = (prefix: string, shades: readonly number[]) => Object.fromEntries(shades.map((s) => [s, v(`${prefix}-${s}`)]));
const familyTints = Object.fromEntries(FAMILIES.map((f) => [f, scale(`bg-${f}`, TINT_SHADES)]));
const familyText = Object.fromEntries(FAMILIES.map((f) => [f, scale(`tx-${f}`, TEXT_SHADES)]));
const DARK_FILLS = [600, 700, 800, 900, 950];

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
  			sans: ["var(--font-urbanist)", "var(--font-thai)", "var(--font-sarabun)", "system-ui", "sans-serif"],
  		},
  		colors: {
  			gray: scale('g', SHADES),
  			slate: scale('sl', SHADES),
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
  		// ── per-utility overrides (ดูคำอธิบายบนสุดของไฟล์) ──
  		backgroundColor: {
  			white: v('surface'),
  			gray: scale('gf', DARK_FILLS),
  			slate: scale('slf', DARK_FILLS),
  			brand: { navy: v('navy-fill'), mist: v('mist'), gray: v('easy') },
  			...familyTints,
  		},
  		borderColor: {
  			white: v('line-white'),
  			brand: { navy: v('navy-fill'), mist: v('mist'), gray: v('easy') },
  			...familyTints,
  		},
  		ringColor: { white: v('surface'), ...familyTints },
  		ringOffsetColor: { white: v('surface') },
  		gradientColorStops: {
  			white: v('surface'),
  			brand: { mist: v('mist'), gray: v('easy') },
  			...familyTints,
  		},
  		textColor: {
  			brand: { navy: v('ink'), blue: v('t-blue'), deep: v('t-deep'), dark: v('t-dark') },
  			...familyText,
  		},
  		// มุมโค้งทั้งระบบ — โค้งขึ้นหนึ่งขั้นจากค่าเดิม (การ์ดใหญ่ = 2xl/3xl)
  		borderRadius: {
  			sm: '6px',
  			DEFAULT: '6px',
  			md: '10px',
  			lg: '14px',
  			xl: '18px',
  			'2xl': '22px',
  			'3xl': '28px',
  		},
  		// เงานุ่ม ยาว อมสี Secure Navy
  		boxShadow: {
  			sm: '0 1px 2px rgba(0,14,63,0.04), 0 6px 16px -8px rgba(0,14,63,0.08)',
  			DEFAULT: '0 1px 2px rgba(0,14,63,0.05), 0 10px 24px -10px rgba(0,14,63,0.10)',
  			md: '0 2px 4px rgba(0,14,63,0.05), 0 14px 32px -12px rgba(0,14,63,0.12)',
  			lg: '0 4px 8px rgba(0,14,63,0.05), 0 22px 44px -16px rgba(0,14,63,0.16)',
  			xl: '0 6px 12px rgba(0,14,63,0.06), 0 30px 60px -20px rgba(0,14,63,0.20)',
  			'2xl': '0 10px 20px rgba(0,14,63,0.08), 0 44px 88px -24px rgba(0,14,63,0.26)',
  			glass: '0 1px 0 rgba(255,255,255,0.7) inset, 0 18px 44px -18px rgba(0,14,63,0.18)',
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
  plugins: [
    require("tailwindcss-animate"),
    plugin(({ addBase }) => {
      addBase({ ":root, .force-light, .article-preview": lightVars });
      // ต้องมาหลังชุดสว่าง — <html class="dark"> ชนะ :root ด้วยลำดับ ส่วน .force-light ประกาศค่าที่ตัวเองจึงไม่โดนทับ
      addBase({ ".dark": darkVars });
    }),
  ],
};

export default config;
