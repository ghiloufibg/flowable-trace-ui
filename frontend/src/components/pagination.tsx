type Props = {
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
};

export function Pagination({
  total,
  page,
  pageSize,
  pageSizeOptions = [25, 50, 100],
  onPageChange,
  onPageSizeChange,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel px-3 py-2">
      <span className="mono text-[10px] text-muted-foreground">
        Showing {start}–{end} of {total}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded border border-input bg-panel-2 px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-teal"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="rounded border border-input bg-panel-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
        >
          ‹ Prev
        </button>
        <span className="mono text-[10px] text-muted-foreground">
          Page {safePage} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= pageCount}
          className="rounded border border-input bg-panel-2 px-2 py-1 text-xs text-foreground transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
