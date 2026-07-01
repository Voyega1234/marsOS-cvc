import { ReactNode } from "react";

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      {icon && <div className="mb-4 text-5xl text-gray-300">{icon}</div>}
      <h3 className="text-lg font-semibold text-gray-800 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">{description}</p>
      {action}
    </div>
  );
}
