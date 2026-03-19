// Token/cost aggregation is now handled directly in state.ts recomputeTotals().
// This module is kept for the startup log.

export function startTokenAggregator(): void {
  console.log("[token-aggregator] using session-based cost aggregation");
}
