/**
 * โหมดแสดงผล (สว่าง / มืด / ตามระบบ)
 *
 * ค่าที่ผู้ใช้เลือกเก็บใน localStorage ของเบราว์เซอร์นั้น ๆ (ไม่ผูกกับบัญชี ไม่แตะฐานข้อมูล)
 * โหมดมืด = class "dark" บน <html> — สีทั้งหมดเปลี่ยนผ่านตัวแปรใน tailwind.config.ts + globals.css
 *
 * ไฟล์นี้ต้องไม่มี "use client": root layout (server component) ต้องอ่าน THEME_SCRIPT เป็น string ได้
 */
export const THEME_STORAGE_KEY = "mars_theme";
export const THEME_EVENT = "mars-theme-change";

export type ThemeMode = "light" | "dark" | "system";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** หน้าที่ต้องสว่างเสมอ: ลิงก์แชร์สาธารณะ และหน้า export/พิมพ์บทความ */
export function isAlwaysLightPath(pathname: string): boolean {
  return pathname.startsWith("/share") || /\/export\/?$/.test(pathname);
}

/**
 * รันใน <head> ก่อนวาดหน้า กันจอกะพริบขาวตอนโหลดในโหมดมืด
 * ตรรกะต้องตรงกับ applyTheme() ใน src/components/layout/theme.tsx
 */
export const THEME_SCRIPT = `(function(){try{var p=location.pathname;if(p.indexOf('/share')===0||/\\/export\\/?$/.test(p))return;var m=localStorage.getItem('${THEME_STORAGE_KEY}');var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})();`;
