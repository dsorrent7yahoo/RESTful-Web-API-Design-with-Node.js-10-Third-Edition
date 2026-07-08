/**
 * drugConditions.ts — fetches the drug→conditions map from the Config API (:4009).
 * The table lives in drug_conditions.db (SQLite) seeded with the top-20 drugs.
 */

/** Returns { drugName: conditionsString } for every row in the DB. */
export async function fetchDrugConditions(): Promise<Record<string, string>> {
  const resp = await fetch('/api/config/drug-conditions');
  if (!resp.ok) return {};
  return resp.json();
}
