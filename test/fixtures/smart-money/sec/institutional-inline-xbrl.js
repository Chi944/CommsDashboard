const REPORT_DATE = '2026-06-30';

const DEFINITIONS = Object.freeze({
  'institutional-strategy': {
    cik: '1050446', accessionNumber: '0001050446-26-000044', primaryDocument: 'mstr-20260630.htm',
    filingDate: '2026-08-03', quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits',
    quantityMeasure: 'mstr:Bitcoin', quantity: '846,000', quantityScale: '0',
    valueConcept: 'us-gaap:CryptoAssetFairValue', valueMeasure: 'iso4217:USD',
    value: '49,672,080', valueScale: '3',
    anchors: ['Bitcoin Activity and Holdings', 'Digital Asset Carrying Value', 'Approximate Number of Bitcoins Held'],
  },
  'institutional-tesla': {
    cik: '1318605', accessionNumber: '0001628280-26-049270', primaryDocument: 'tsla-20260630.htm',
    filingDate: '2026-07-23', quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits',
    quantityMeasure: 'tsla:Bitcoin', quantity: '11,509', quantityScale: '0',
    valueConcept: null, valueMeasure: null, value: null, valueScale: null,
    anchors: ['Digital assets, net', 'Bitcoin'],
  },
  'institutional-ibit': {
    cik: '1980994', accessionNumber: '0001437749-26-026004', primaryDocument: 'bit20260630c_10q.htm',
    filingDate: '2026-08-06', quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits',
    quantityMeasure: 'xbrli:pure', quantity: '734,261', quantityScale: '0',
    valueConcept: 'us-gaap:CryptoAssetFairValue', valueMeasure: 'iso4217:USD',
    value: '43,395,920,710', valueScale: '0',
    anchors: ['Schedules of Investments', 'Description Quantity Cost Fair Value', 'Bitcoin'],
  },
  'institutional-fbtc': {
    cik: '1852317', accessionNumber: '0001193125-26-337679', primaryDocument: 'ck0001852317-20260630.htm',
    filingDate: '2026-08-06', quantityConcept: 'us-gaap:InvestmentOwnedBalanceShares',
    quantityMeasure: 'xbrli:shares', quantity: '174,383', quantityScale: '0',
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD',
    value: '10,306,297', valueScale: '3', dimension: 'us-gaap:InvestmentIdentifierAxis',
    member: 'Investment in bitcoin, Global Bitcoin',
    anchors: ['Investment in bitcoin', 'Global Bitcoin', 'Fair Value'],
  },
  'institutional-arkb': {
    cik: '1869699', accessionNumber: '0001213900-26-086191', primaryDocument: 'ea0299118-10q_ark21shares.htm',
    filingDate: '2026-08-06', quantityConcept: 'us-gaap:InvestmentOwnedBalanceContracts',
    quantityMeasure: 'xbrli:pure', quantity: '32,178.2280', quantityScale: '0', quantityDecimals: '4',
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD',
    value: '1,889,314', valueScale: '3', anchors: ['Schedule of Investments', 'Bitcoin', 'Fair Value'],
  },
  'institutional-bitb': {
    cik: '1763415', accessionNumber: '0001193125-26-340183', primaryDocument: 'bitb-20260630.htm',
    filingDate: '2026-08-07', quantityConcept: 'bitb:InvestmentOwnedBalanceContractsQuantityOfBitcoin',
    quantityMeasure: 'bitb:Bitcoin', quantity: '36,207.6919', quantityScale: '0', quantityDecimals: '4',
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD',
    value: '2,125,990', valueScale: '3', anchors: ['Schedule of Investments', 'Bitcoin', 'Fair Value'],
  },
});

function unit(id, measure) {
  return `<xbrli:unit id="${id}"><xbrli:measure>${measure}</xbrli:measure></xbrli:unit>`;
}

export function institutionalInlineXbrl(providerId, mutations = {}) {
  const profile = DEFINITIONS[providerId];
  if (!profile) throw new Error('unknown fixture profile');
  const contextId = 'i_2026-06-30';
  const dimension = Object.hasOwn(mutations, 'dimension') ? mutations.dimension : profile.dimension;
  const member = Object.hasOwn(mutations, 'member') ? mutations.member : profile.member;
  const scenario = dimension
    ? `<xbrli:scenario><xbrldi:typedMember dimension="${dimension}"><fbtc:InvestmentIdentifier>${member}</fbtc:InvestmentIdentifier></xbrldi:typedMember></xbrli:scenario>`
    : '';
  const context = `<xbrli:context id="${contextId}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${String(profile.cik).padStart(10, '0')}</xbrli:identifier>${scenario}</xbrli:entity><xbrli:period><xbrli:instant>${mutations.reportDate ?? REPORT_DATE}</xbrli:instant></xbrli:period></xbrli:context>`;
  const quantity = `<ix:nonFraction name="${profile.quantityConcept}" contextRef="${mutations.quantityContext ?? contextId}" unitRef="btc-unit" scale="${profile.quantityScale}"${profile.quantityDecimals ? ` decimals="${profile.quantityDecimals}"` : ''}${mutations.nilQuantity ? ' xsi:nil="true"' : ''}>${mutations.quantity ?? profile.quantity}</ix:nonFraction>`;
  const value = profile.valueConcept && mutations.omitValue !== true
    ? `<ix:nonFraction name="${profile.valueConcept}" contextRef="${mutations.valueContext ?? contextId}" unitRef="usd-unit" scale="${profile.valueScale}"${mutations.nilValue ? ' xsi:nil="true"' : ''}>${mutations.value ?? profile.value}</ix:nonFraction>`
    : '';
  const duplicateQuantity = mutations.duplicateQuantity == null ? ''
    : `<ix:nonFraction name="${profile.quantityConcept}" contextRef="${contextId}" unitRef="btc-unit" scale="${profile.quantityScale}">${mutations.duplicateQuantity}</ix:nonFraction>`;
  return `<!doctype html><html><body>${context}${unit('btc-unit', profile.quantityMeasure)}${profile.valueMeasure ? unit('usd-unit', profile.valueMeasure) : ''}<table><caption>${profile.anchors.join(' / ')}</caption><tr><th>Description Quantity Cost Fair Value</th></tr><tr><td>Bitcoin ${quantity}</td><td>${value}</td><td>${duplicateQuantity}</td></tr></table></body></html>`;
}

export function institutionalFiling(providerId) {
  return { ...DEFINITIONS[providerId], reportDate: REPORT_DATE };
}
