// Instant skeleton while the Leads page queries the database. It shows no data;
// the page's own guard still runs before any data shows.
// Kept at this level (not at [projectId]/) so prefetching links to the project stays cheap.
export default function Loading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only">กำลังโหลด…</span>
      <div className="h-7 w-48 animate-pulse rounded-lg bg-gray-100" />
      <div className="h-10 w-full max-w-xl animate-pulse rounded-xl bg-gray-100" />
      <div className="card p-5">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
