const REPORT_DATE = '2026-06-30';
const COMPARISON_DATE = '2025-12-31';

const DEFINITIONS = Object.freeze({
  'institutional-strategy': {
    cik: '1050446', accessionNumber: '0001050446-26-000044', primaryDocument: 'mstr-20260630.htm', filingDate: '2026-08-03',
    quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits', quantityMeasure: 'mstr:Bitcoin', quantity: '846,000', comparisonQuantity: '672,500', quantityScale: '0',
    valueConcept: 'us-gaap:CryptoAssetFairValue', valueMeasure: 'iso4217:USD', value: '49,672,080', comparisonValue: '58,854,028', valueScale: '3',
    anchors: ['Bitcoin Activity and Holdings', 'Digital assets', 'Approximate Number of Bitcoins Held'],
  },
  'institutional-tesla': {
    cik: '1318605', accessionNumber: '0001628280-26-049270', primaryDocument: 'tsla-20260630.htm', filingDate: '2026-07-23',
    quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits', quantityMeasure: 'tsla:unit', quantity: '11,509', comparisonQuantity: '11,509', quantityScale: '0',
    valueConcept: null, valueMeasure: null, value: null, comparisonValue: null, valueScale: null,
    dimension: { kind: 'explicit', axis: 'srt:CryptoAssetAxis', value: 'tsla:BitcoinMember' }, anchors: ['majority of our digital assets were comprised of', 'Bitcoin'],
  },
  'institutional-ibit': {
    cik: '1980994', accessionNumber: '0001437749-26-026004', primaryDocument: 'bit20260630c_10q.htm', filingDate: '2026-08-06',
    quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits', quantityMeasure: 'xbrli:pure', quantity: '734,261', comparisonQuantity: '575,433', quantityScale: '0',
    valueConcept: 'us-gaap:CryptoAssetFairValue', valueMeasure: 'iso4217:USD', value: '43,395,920,710', comparisonValue: '53,721,444,350', valueScale: '0',
    anchors: ['Schedules of Investments', 'Description Quantity Cost Fair Value', 'Bitcoin'],
  },
  'institutional-fbtc': {
    cik: '1852317', accessionNumber: '0001193125-26-337679', primaryDocument: 'ck0001852317-20260630.htm', filingDate: '2026-08-06',
    quantityConcept: 'us-gaap:InvestmentOwnedBalanceShares', quantityMeasure: 'xbrli:shares', quantity: '174,383', comparisonQuantity: '201,684', quantityScale: '0', omitQuantityScale: true,
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD', value: '10,306,297', comparisonValue: '17,639,927', valueScale: '3',
    dimension: { kind: 'typed', axis: 'us-gaap:InvestmentIdentifierAxis', value: 'Investment in bitcoin, Global Bitcoin' }, anchors: ['Investment in bitcoin', 'Global Bitcoin', 'Fair Value'],
  },
  'institutional-arkb': {
    cik: '1869699', accessionNumber: '0001213900-26-086191', primaryDocument: 'ea0299118-10q_ark21shares.htm', filingDate: '2026-08-06',
    quantityConcept: 'us-gaap:InvestmentOwnedBalanceContracts', quantityMeasure: 'xbrli:pure', quantity: '32,178.2280', comparisonQuantity: '46,722.8267', quantityScale: '0', quantityDecimals: '4',
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD', value: '1,889,314', comparisonValue: '5,034,610', valueScale: '3', anchors: ['Schedules of Investment', 'Bitcoin', 'Fair Value'],
  },
  'institutional-bitb': {
    cik: '1763415', accessionNumber: '0001193125-26-340183', primaryDocument: 'bitb-20260630.htm', filingDate: '2026-08-07',
    quantityConcept: 'bitb:InvestmentOwnedBalanceContractsQuantityOfBitcoin', quantityMeasure: 'bitb:Bitcoin', quantity: '36,207.6919', comparisonQuantity: '38,468.0468', quantityScale: '0', quantityDecimals: '4',
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD', value: '2,125,990', comparisonValue: '4,171,463', valueScale: '3', anchors: ['Schedules of Investment', 'Bitcoin', 'Fair Value'],
  },
});

function memberMarkup(dimension) {
  if (!dimension) return '';
  if (dimension.kind === 'explicit') return `<xbrli:scenario><xbrldi:explicitMember dimension="${dimension.axis}">${dimension.value}</xbrldi:explicitMember></xbrli:scenario>`;
  return `<xbrli:scenario><xbrldi:typedMember dimension="${dimension.axis}"><us-gaap:limitedToken.domain>${dimension.value}</us-gaap:limitedToken.domain></xbrldi:typedMember></xbrli:scenario>`;
}

function context(id, cik, instant, dimension = null) {
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${String(cik).padStart(10, '0')}</xbrli:identifier>${memberMarkup(dimension)}</xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period></xbrli:context>`;
}

function unit(id, measure) {
  return `<xbrli:unit id="${id}"><xbrli:measure>${measure}</xbrli:measure></xbrli:unit>`;
}

function fact({ concept, contextRef, unitRef, scale, decimals, value, nil = false, omitScale = false }) {
  return `<ix:nonFraction name="${concept}" contextRef="${contextRef}" unitRef="${unitRef}"${omitScale ? '' : ` scale="${scale}"`}${decimals ? ` decimals="${decimals}"` : ''}${nil ? ' xsi:nil="true"' : ''}>${value}</ix:nonFraction>`;
}

// Minimized attribution-preserving excerpts shaped after the cited SEC inline-XBRL filings.
export function institutionalInlineXbrl(providerId, mutations = {}) {
  const profile = DEFINITIONS[providerId];
  if (!profile) throw new Error('unknown fixture profile');
  const targetDate = mutations.reportDate ?? REPORT_DATE;
  const targetDimension = Object.hasOwn(mutations, 'dimension') ? mutations.dimension : profile.dimension ?? null;
  const targetId = 'target-instant';
  const comparisonId = 'comparison-instant';
  const wrongDimension = { kind: 'explicit', axis: 'srt:CryptoAssetAxis', value: 'fixture:OtherInvestmentMember' };
  const resources = [
    context(targetId, profile.cik, targetDate, targetDimension), context(comparisonId, profile.cik, COMPARISON_DATE, targetDimension),
    context('wrong-dimension-target', profile.cik, targetDate, wrongDimension), unit('btc-unit', profile.quantityMeasure),
    ...(profile.valueMeasure ? [unit('usd-unit', profile.valueMeasure)] : []),
  ].join('');
  const quantity = fact({ concept: profile.quantityConcept, contextRef: mutations.quantityContext ?? targetId, unitRef: 'btc-unit', scale: profile.quantityScale, decimals: profile.quantityDecimals, value: mutations.quantity ?? profile.quantity, nil: mutations.nilQuantity, omitScale: profile.omitQuantityScale });
  const comparisonQuantity = fact({ concept: profile.quantityConcept, contextRef: comparisonId, unitRef: 'btc-unit', scale: profile.quantityScale, decimals: profile.quantityDecimals, value: mutations.comparisonQuantity ?? profile.comparisonQuantity, omitScale: profile.omitQuantityScale });
  const duplicateQuantity = mutations.duplicateQuantity == null ? '' : fact({ concept: profile.quantityConcept, contextRef: targetId, unitRef: 'btc-unit', scale: profile.quantityScale, decimals: profile.quantityDecimals, value: mutations.duplicateQuantity, omitScale: profile.omitQuantityScale });
  const ambiguousTargetQuantity = mutations.ambiguousTargetQuantity == null ? '' : fact({ concept: profile.quantityConcept, contextRef: targetId, unitRef: 'btc-unit', scale: profile.quantityScale, decimals: profile.quantityDecimals, value: mutations.ambiguousTargetQuantity, omitScale: profile.omitQuantityScale });
  const value = profile.valueConcept && mutations.omitValue !== true ? fact({ concept: profile.valueConcept, contextRef: mutations.valueContext ?? targetId, unitRef: 'usd-unit', scale: profile.valueScale, value: mutations.value ?? profile.value, nil: mutations.nilValue }) : '';
  const comparisonValue = profile.valueConcept ? fact({ concept: profile.valueConcept, contextRef: comparisonId, unitRef: 'usd-unit', scale: profile.valueScale, value: profile.comparisonValue }) : '';
  const irrelevantTargetValue = ['institutional-fbtc', 'institutional-bitb'].includes(providerId)
    ? fact({ concept: profile.valueConcept, contextRef: 'wrong-dimension-target', unitRef: 'usd-unit', scale: profile.valueScale, value: '999,999' }) : '';
  const nestedTeslaQuantity = `<ix:nonFraction name="${profile.quantityConcept}" contextRef="${targetId}" unitRef="btc-unit" scale="0"><ix:nonFraction name="${profile.quantityConcept}" contextRef="${comparisonId}" unitRef="btc-unit" scale="0">${mutations.quantity ?? profile.quantity}</ix:nonFraction></ix:nonFraction>`;
  const body = providerId === 'institutional-tesla'
    ? `<p>The majority of our digital assets were comprised of Bitcoin ${nestedTeslaQuantity}${duplicateQuantity}${ambiguousTargetQuantity}</p>`
    : `<h2>${profile.anchors[0].toLowerCase()}</h2><table><tr><th>${profile.anchors.slice(1).join(' / ')}</th></tr><tr><td>Bitcoin ${quantity} ${comparisonQuantity} ${duplicateQuantity} ${ambiguousTargetQuantity}</td><td>${value} ${comparisonValue} ${irrelevantTargetValue}</td></tr></table>`;
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${profile.cik}/${profile.accessionNumber.replace(/-/g, '')}/${profile.primaryDocument}`;
  return `<!doctype html><html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"><head><link rel="canonical" href="${sourceUrl}"></head><body><ix:header><ix:resources>${resources}</ix:resources></ix:header><a href="${sourceUrl}">SEC filing source</a>${body}</body></html>`;
}

export function institutionalFiling(providerId) {
  return { ...DEFINITIONS[providerId], reportDate: REPORT_DATE };
}
