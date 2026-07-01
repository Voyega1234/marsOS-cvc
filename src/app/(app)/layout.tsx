import { AppLayout } from "@/components/layout/AppLayout";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
