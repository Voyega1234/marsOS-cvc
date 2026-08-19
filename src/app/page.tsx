import { redirect } from "next/navigation";

export default async function Home() {
  // เมนูแรกของ sidebar คือ Morning Brief (หน้า Home ถูกตัดออกจาก nav แล้ว)
  redirect("/morning-brief");
}
