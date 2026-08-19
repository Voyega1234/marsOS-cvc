import { redirect } from "next/navigation";

// หน้า Dashboard ถูกถอดตามคำสั่งเจ้าของ 2026-08-19 — ทุกทางเข้าเด้งไป SEO News
export default function DashboardRemoved() {
  redirect("/morning-brief");
}
