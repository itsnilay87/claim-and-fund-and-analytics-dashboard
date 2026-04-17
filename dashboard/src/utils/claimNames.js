/**
 * Utility functions for displaying human-readable claim names.
 *
 * Handles legacy runs (no name field) and new runs where the name
 * might have fallen back to a UUID.
 */

/**
 * Check if a string looks like a UUID (8-4-4-4-12 hex pattern).
 */
export const isUUID = (s) =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);

const titleize = (value) =>
  String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Get a human-readable display name for a claim.
 *
 * Priority:
 *   1. claim.name if set and not a UUID
 *   2. claim.claim_id if set and not a UUID
 *   3. claim.archetype formatted as title case
 *   4. 'N/A' as fallback
 *
 * @param {Object} claim - The claim object
 * @returns {string} - A human-readable name
 */
export const getClaimDisplayName = (claim) => {
  if (!claim) return 'N/A';

  const candidates = [
    claim.name,
    claim.claim_name,
    claim.display_name,
    claim.label,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed && !isUUID(trimmed)) return trimmed;
    }
  }

  const idCandidates = [claim.claim_id, claim.id, claim.cid];
  for (const candidate of idCandidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed && !isUUID(trimmed)) return trimmed;
    }
  }

  if (typeof claim.archetype === 'string' && claim.archetype.trim()) {
    return titleize(claim.archetype.trim());
  }

  if (typeof claim.claim_type === 'string' && claim.claim_type.trim()) {
    return titleize(claim.claim_type.trim());
  }

  return 'N/A';
};

/**
 * Build a lookup map from claim_id -> display name.
 */
export const buildClaimNameMap = (claims) => {
  const map = {};
  (claims || []).forEach((claim) => {
    const id = claim?.claim_id || claim?.id;
    if (id) {
      map[id] = getClaimDisplayName(claim);
    }
  });
  return map;
};

/**
 * Truncate a claim name for use in charts/labels.
 *
 * @param {Object|string} claimOrName - Claim object or direct name string
 * @param {number} maxLen - Maximum length before truncation (default 20)
 * @returns {string} - Truncated name with ellipsis if needed
 */
export const truncateClaimName = (claimOrName, maxLen = 20) => {
  const name =
    typeof claimOrName === 'string'
      ? claimOrName
      : getClaimDisplayName(claimOrName);

  return name.length > maxLen ? name.slice(0, maxLen) + '…' : name;
};
