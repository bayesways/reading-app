const renderer = String.raw`
function safeUrl(value, sourceUrl) {
  // A bare fragment has no target in the rendered page. Resolving it against
  // the source would send every footnote marker back to the original site.
  if (!value || value.startsWith('#')) return null;
  try {
    const url = new URL(value, sourceUrl);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
`;

export function browserUrl(): string {
  return renderer;
}
