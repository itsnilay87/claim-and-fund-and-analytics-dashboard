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

  // Check name field first
  if (claim.name && !isUUID(claim.name)) {
    return claim.name;
  }

  // Check claim_id (sometimes used for display)
  if (claim.claim_id && !isUUID(claim.claim_id)) {
    return claim.claim_id;
  }

  // Fallback to archetype formatted as title case
  if (claim.archetype) {
    return claim.archetype
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Last resort
  return 'N/A';
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
