function parseSafeHttps(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function dashedAccession(value) {
  const stableId = String(value || '');
  if (/^\d{10}-\d{2}-\d{6}$/.test(stableId)) return stableId;
  const compact = stableId.replace(/-/g, '');
  return /^\d{18}$/.test(compact)
    ? `${compact.slice(0, 10)}-${compact.slice(10, 12)}-${compact.slice(12)}`
    : null;
}

export function publicEvidenceUrl(value, { sourceStableId = null } = {}) {
  const url = parseSafeHttps(value);
  if (!url) return null;

  const hostname = url.hostname.toLowerCase();
  const submissions = hostname === 'data.sec.gov'
    ? url.pathname.match(/^\/submissions\/CIK(\d+)\.json$/i)
    : null;
  if (submissions) {
    const cik = submissions[1].replace(/^0+(?=\d)/, '');
    return {
      href: `https://www.sec.gov/edgar/browse/?CIK=${cik}`,
      kind: 'sec-company',
    };
  }

  const filingIndex = (hostname === 'sec.gov' || hostname.endsWith('.sec.gov'))
    ? url.pathname.match(/^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/index\.json$/i)
    : null;
  if (filingIndex) {
    const accession = dashedAccession(sourceStableId) || dashedAccession(filingIndex[2]);
    return {
      href: `https://www.sec.gov/Archives/edgar/data/${filingIndex[1]}/${filingIndex[2]}/${accession}-index.html`,
      kind: 'sec-filing',
    };
  }

  return {
    href: url.toString(),
    kind: hostname === 'sec.gov' || hostname.endsWith('.sec.gov') ? 'sec' : 'web',
  };
}

export function evidenceLinkLabel(destination, fallback = 'Open source') {
  if (destination?.kind === 'sec-company') return 'Browse SEC filings';
  if (destination?.kind === 'sec-filing') return 'View SEC filing';
  return fallback;
}
