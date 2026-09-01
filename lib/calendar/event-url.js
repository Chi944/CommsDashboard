const MACHINE_CALENDAR_PATH = /\.(?:ics|pdf)$/i;

export function officialHumanEventUrl(value, sourceUrl) {
  try {
    const source = new URL(sourceUrl);
    const candidate = new URL(value, source);
    if (source.protocol !== 'https:'
        || candidate.protocol !== 'https:'
        || candidate.origin !== source.origin
        || candidate.username
        || candidate.password
        || MACHINE_CALENDAR_PATH.test(candidate.pathname)) return null;
    return candidate.href;
  } catch {
    return null;
  }
}
