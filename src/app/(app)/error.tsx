"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center px-4">
      <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gray-900">เกิดข้อผิดพลาด</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-sm">
          {error.message || "มีบางอย่างผิดพลาด กรุณาลองใหม่อีกครั้ง"}
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 mt-1 font-mono">ID: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset} variant="outline" className="gap-2">
        <RefreshCw className="h-3.5 w-3.5" />
        ลองใหม่
      </Button>
    </div>
  );
}
