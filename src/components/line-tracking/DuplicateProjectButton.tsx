"use client";

/**
 * Duplicate button for the projects list. A stray click used to create a copy straight
 * away, so it asks first; cancelling stops the form submit and nothing is created.
 */
export function DuplicateProjectButton({ projectName, className }: { projectName: string; className?: string }) {
  return (
    <button
      className={className ?? "btn-secondary text-xs"}
      type="submit"
      onClick={(e) => {
        if (!window.confirm(`Duplicate โปรเจกต์ "${projectName}"?\n\nจะสร้างโปรเจกต์ใหม่ชื่อ "${projectName} (Copy)" พร้อมคัดลอกการเชื่อมต่อและ conversion rules (ไม่รวม leads)`)) {
          e.preventDefault();
        }
      }}
    >
      Duplicate
    </button>
  );
}
