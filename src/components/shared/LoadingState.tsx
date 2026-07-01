import { cn } from "@/lib/utils";

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = "กำลังโหลด...", className }: LoadingStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 gap-3", className)}>
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 rounded-full border-4 border-gray-100" />
        <div className="absolute inset-0 rounded-full border-4 border-green-600 border-t-transparent animate-spin" />
      </div>
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn("h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin", className)} />
  );
}
