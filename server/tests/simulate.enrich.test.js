import { describe, it, expect, vi, afterEach } from 'vitest';
import simulateRouter from '../routes/simulate.js';

const { enrichClaimConfig, validateAndEnrichPortfolioStructure } = simulateRouter._private;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enrichClaimConfig', () => {
  it('defaults missing jurisdiction to indian_domestic', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const enriched = enrichClaimConfig({
      id: 'claim-1',
      jurisdiction: '   ',
      claim_type: 'prolongation',
      soc_value_cr: 100,
    });

    expect(enriched.jurisdiction).toBe('indian_domestic');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing jurisdiction'));
  });

  it('defaults missing claim_type to prolongation', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const enriched = enrichClaimConfig({
      id: 'claim-2',
      jurisdiction: 'indian_domestic',
      claim_type: ' ',
      soc_value_cr: 150,
    });

    expect(enriched.claim_type).toBe('prolongation');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing claim_type'));
  });

  it('generates name from archetype when name is empty', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const enriched = enrichClaimConfig({
      id: 'claim-3',
      jurisdiction: 'indian_domestic',
      claim_type: 'prolongation',
      archetype: 'variation',
      name: '   ',
      soc_value_cr: 120,
    });

    expect(enriched.name).toBe('variation');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing name'));
  });

  it('logs zero SOC but does not override', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const enriched = enrichClaimConfig({
      id: 'claim-4',
      jurisdiction: 'indian_domestic',
      claim_type: 'prolongation',
      name: 'Claim Four',
      soc_value_cr: 0,
    });

    expect(enriched.soc_value_cr).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('has invalid SOC'));
  });

  it('normalizes interest rates from percentage to fraction', () => {
    const enriched = enrichClaimConfig({
      id: 'claim-5',
      jurisdiction: 'indian_domestic',
      claim_type: 'prolongation',
      name: 'Claim Five',
      soc_value_cr: 100,
      interest: {
        rate: 9,
        rate_bands: [
          { rate: 12, probability: 0.6, type: 'simple' },
          { rate: 0.08, probability: 0.4, type: 'simple' },
        ],
      },
    });

    expect(enriched.interest.rate).toBeCloseTo(0.09, 8);
    expect(enriched.interest.rate_bands[0].rate).toBeCloseTo(0.12, 8);
    expect(enriched.interest.rate_bands[1].rate).toBeCloseTo(0.08, 8);
  });
});

describe('validateAndEnrichPortfolioStructure', () => {
  it('adds upfront and tail default ranges for monetisation_upfront_tail when params are missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { portfolioConfig, structParams } = validateAndEnrichPortfolioStructure({
      name: 'Portfolio A',
      structure: { type: 'monetisation_upfront_tail', params: {} },
    });

    expect(portfolioConfig.structure.type).toBe('monetisation_upfront_tail');
    expect(structParams.upfront_range).toEqual({ min: 0.05, max: 0.30, step: 0.05 });
    expect(structParams.tail_range).toEqual({ min: 0.10, max: 0.40, step: 0.05 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing upfront_range/upfront_pct'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing tail_range/tail_pct'));
  });
});
