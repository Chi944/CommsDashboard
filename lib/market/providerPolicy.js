export function isAlphaVantageEnabled(dependencies = {}) {
  // Deliberately dependency-injection-only for isolated legacy adapter tests.
  // No runtime environment variable, request field, or public route can enable it.
  return dependencies.alphaVantageEnabled === true;
}
