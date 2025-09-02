export function fillBuckets(
  raw: { bucket: Date; value: number }[],
  opts: { start: Date; points: number; bucket: "hour" | "day" | "month" }
) {
  const map = new Map<string, number>();
  raw.forEach((r) => map.set(new Date(r.bucket).toISOString(), r.value));

  const out: { label: string; value: number; bucket: Date }[] = [];
  const cur = new Date(opts.start);
  const step =
    opts.bucket === "hour"
      ? (d: Date) => d.setUTCHours(d.getUTCHours() + 1)
      : opts.bucket === "day"
      ? (d: Date) => d.setUTCDate(d.getUTCDate() + 1)
      : (d: Date) => d.setUTCMonth(d.getUTCMonth() + 1);

  for (let i = 0; i < opts.points; i++) {
    const key = cur.toISOString();
    const value = map.get(key) ?? 0;
    let label: string;
    if (opts.bucket === "hour") label = cur.toISOString().slice(11, 13) + "h";
    else if (opts.bucket === "day") label = cur.toISOString().slice(5, 10); // MM-DD
    else label = cur.toISOString().slice(0, 7); // YYYY-MM
    out.push({ label, value, bucket: new Date(cur) });
    step(cur);
  }
  return out;
}