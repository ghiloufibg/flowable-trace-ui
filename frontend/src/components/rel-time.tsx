import { relativeTime } from "@/lib/store";

// Relative timestamps are computed from Date.now(), which differs between
// SSR render and client hydration. Render inside a <time> with
// suppressHydrationWarning so React uses the client value silently.
export function RelTime({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {relativeTime(iso)}
    </time>
  );
}
