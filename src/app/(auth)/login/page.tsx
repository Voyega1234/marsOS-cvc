"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await signIn("credentials", { email: username, password, redirect: false });
      if (res?.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        toast.error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm px-4">
      <div className="mb-10 text-center">
<p className="text-sm font-semibold text-foreground mt-1.5">Convert Cake SEO Platform</p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">MarsOS</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="text"
          autoComplete="username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="pt-2">
          <Button type="submit" disabled={loading} className="w-full font-medium">
            {loading ? "กำลังเข้าสู่ระบบ..." : "Welcome Back"}
          </Button>
        </div>
      </form>
    </div>
  );
}
