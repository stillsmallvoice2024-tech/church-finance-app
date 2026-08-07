-- ============================================================================
-- READ-ONLY: which transaction references are not unique, and why
-- ============================================================================
-- Safe to run on production at any time. It creates nothing, changes nothing,
-- and requires none of the uniqueness migrations to have been applied — every
-- helper is inlined. Run this BEFORE deciding anything.
--
-- `likely_cause` is the column that matters:
--
--   'repeated import'  every row identical (same date, amount, description).
--                      The statement was imported twice. The surplus rows are
--                      not real transactions.
--
--   'shared reference' every row different. The bank reused one reference
--                      across several genuine postings — a NIP Session ID
--                      spanning a transfer and its COMMISSION and VAT lines,
--                      for example. Every one of these is a real transaction.
--                      NONE of them may be deleted.
--
--   'mixed'            both at once. Needs a human.
--
-- Empty result = nothing to resolve; the uniqueness migration will apply as-is.
-- ============================================================================

WITH norm AS (
  SELECT 'inflow_transactions' AS source_table, id, org_id, date, created_at,
         amount AS amt, description AS narr,
         coalesce(nullif(lower(btrim(regexp_replace(coalesce(bank_name,''),'\s+',' ','g'))),''),
                  bank_id::text, '') AS bank_key,
         max(bank_name) OVER (PARTITION BY bank_id) AS shown_bank,
         nullif(btrim(regexp_replace(translate(normalize(coalesce(transaction_ref,''), NFC),
                chr(173)||chr(160)||chr(8203)||chr(8204)||chr(8205)||chr(8232)||chr(8233)||chr(65279),''),
                '\s+',' ','g')),'') AS nref
  FROM inflow_transactions
  UNION ALL
  SELECT 'outflow_transactions', id, org_id, date, created_at,
         amount_disbursed, description,
         coalesce(nullif(lower(btrim(regexp_replace(coalesce(bank_name,''),'\s+',' ','g'))),''),
                  bank_id::text, ''),
         max(bank_name) OVER (PARTITION BY bank_id),
         nullif(btrim(regexp_replace(translate(normalize(coalesce(transaction_id,''), NFC),
                chr(173)||chr(160)||chr(8203)||chr(8204)||chr(8205)||chr(8232)||chr(8233)||chr(65279),''),
                '\s+',' ','g')),'')
  FROM outflow_transactions
  UNION ALL
  SELECT 'fx_transactions', id, org_id, date, created_at,
         coalesce(deposit,0)+coalesce(withdrawal,0), narration,
         coalesce(nullif(lower(btrim(regexp_replace(coalesce(bank_name,''),'\s+',' ','g'))),''),
                  bank_id::text, ''),
         max(bank_name) OVER (PARTITION BY bank_id),
         nullif(btrim(regexp_replace(translate(normalize(coalesce(transaction_ref,''), NFC),
                chr(173)||chr(160)||chr(8203)||chr(8204)||chr(8205)||chr(8232)||chr(8233)||chr(65279),''),
                '\s+',' ','g')),'')
  FROM fx_transactions
)
SELECT source_table,
       max(shown_bank)                                   AS bank,
       nref                                              AS reference,
       count(*)                                          AS row_count,
       count(DISTINCT (date, amt, coalesce(narr,'')))    AS distinct_rows,
       CASE
         WHEN count(DISTINCT (date, amt, coalesce(narr,''))) = 1        THEN 'repeated import'
         WHEN count(DISTINCT (date, amt, coalesce(narr,''))) = count(*) THEN 'shared reference'
         ELSE 'mixed'
       END                                               AS likely_cause,
       sum(amt)                                          AS total_amount,
       min(date)                                         AS first_date,
       max(date)                                         AS last_date,
       array_agg(id ORDER BY created_at, id)             AS row_ids
FROM   norm
WHERE  nref IS NOT NULL
GROUP  BY source_table, org_id, bank_key, nref
HAVING count(*) > 1
ORDER  BY likely_cause, row_count DESC;
