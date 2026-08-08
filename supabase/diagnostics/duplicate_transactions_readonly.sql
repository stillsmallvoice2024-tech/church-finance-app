-- ============================================================================
-- READ-ONLY: which transactions are recorded more than once
-- ============================================================================
-- Safe to run on production at any time. Creates nothing, changes nothing, and
-- requires none of the uniqueness migrations to have been applied — every
-- helper is inlined. Run this BEFORE anything that writes.
--
-- Identity is the whole row: (org, bank, reference, date, amount, description).
-- A repeated reference alone is NOT a duplicate — a bank reuses one Session ID
-- across a transfer, the fee on it and the VAT on that fee. Those differ in
-- amount, so they do not appear here and need no action.
--
-- Every group returned is the same transaction recorded more than once.
-- `row_ids` is oldest-first: keep row_ids[1], the rest are the surplus.
-- `overstated_amount` is what those surplus rows are adding to your books.
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
       max(shown_bank)                       AS bank,
       nref                                  AS reference,
       date,
       amt                                   AS amount,
       max(narr)                             AS description,
       count(*)                              AS row_count,
       count(*) - 1                          AS surplus_rows,
       amt * (count(*) - 1)                  AS overstated_amount,
       array_agg(id ORDER BY created_at, id)  AS row_ids
FROM   norm
WHERE  nref IS NOT NULL
GROUP  BY source_table, org_id, bank_key, nref, date, amt,
          coalesce(btrim(regexp_replace(coalesce(narr,''),'\s+',' ','g')), '')
HAVING count(*) > 1
ORDER  BY overstated_amount DESC;
