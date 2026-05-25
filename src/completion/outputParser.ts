export function cleanCompletion(raw: string): string {
  let out = raw;

  out = out.replace(/^\s*```[a-zA-Z0-9_+\-]*\r?\n?/, '');

  const fenceEnd = out.indexOf('\n```');
  if (fenceEnd >= 0) {
    out = out.slice(0, fenceEnd);
  } else {
    out = out.replace(/\r?\n?```\s*$/, '');
  }

  return out;
}
