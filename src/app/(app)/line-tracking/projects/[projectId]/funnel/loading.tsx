// Instant skeleton while the Funnel page queries the database. It shows no data;
// the page's own guard still runs before any data shows.
// Kept at this level (not at [projectId]/) so prefetching links to the project stays cheap.
export default function Loading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only">กำลังโหลด…</span>
      <div className="h-7 w-48 animate-pulse rounded-lg bg-gray-100" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-5">
            <div className="h-3 w-20 animate-pulse rounded bg-gray-100" />
            <div className="mt-3 h-6 w-28 animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
      <div className="h-72 animate-pulse card p-5">
        <div className="h-4 w-40 rounded bg-gray-100" />
      </div>
    </div>
  );
}
