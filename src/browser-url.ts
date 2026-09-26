const renderer = String.raw`
function safeUrl(value, sourceUrl) {
  const input = typeof value === 'string' ? value.trim() : '';
  // A bare fragment has no target in the rendered page. Resolving it against
  // the source would send every footnote marker back to the original site.
  if (!input || input.startsWith('#')) return null;
  try {
    const url = new URL(input, sourceUrl);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
`;

export function browserUrl(): string {
  return renderer;
}
