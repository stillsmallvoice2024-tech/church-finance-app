-- ============================================================================
-- READ-ONLY: review rows that look identical, before deciding anything
-- ============================================================================
-- Safe to run on production. Creates nothing, changes nothing, needs none of
-- the migrations applied.
--
-- Rows identical in reference, date, amount and description are NOT necessarily
-- duplicates. A bank can post the same transaction twice for real: a transfer
-- that fails is reversed and retried, and the statement shows both attempts
-- under one Session ID. On the statement they are told apart by the running
-- balance — which this app does not store, so it cannot be used here.
--
-- What IS stored is when each row was written. That separates the two cases:
--
--   arrived_together = true   Both rows were written by the SAME import run.
--                             One statement legitimately contained both lines.
--                             These are real transactions — DO NOT DELETE.
--
--   arrived_together = false  The rows were written by DIFFERENT import runs,
--                             hours or days apart. The statement was imported
--                             more than once. The later row is the surplus.
--
-- `import_gap` is the time between the first and last row of the group; a run
-- writes its rows within seconds, so anything beyond a few minutes is a
-- separate import. Check `created_ats` yourself on anything borderline.
-- ============================================================================

WITH norm AS (
  SELECT 'inflow_transactions' AS source_table, id, org_id, date, created_at, import_seq,
         amount AS amt, description AS narr,
         coalesce(nullif(lower(btrim(regexp_replace(coalesce(bank_name,''),'\s+',' ','g'))),''),
                  bank_id::text, '') AS bank_key,
         max(bank_name) OVER (PARTITION BY bank_id) AS shown_bank,
         nullif(btrim(regexp_replace(translate(normalize(coalesce(transaction_ref,''), NFC),
                chr(173)||chr(160)||chr(8203)||chr(8204)||chr(8205)||chr(8232)||chr(8233)||chr(65279),''),
                '\s+',' ','g')),'') AS nref
  FROM inflow_transactions
  UNION ALL
  SELECT 'outflow_transactions', id, org_id, date, created_at, import_seq,
         amount_disbursed, description,
         coalesce(nullif(lower(btrim(regexp_replace(coalesce(bank_name,''),'\s+',' ','g'))),''),
                  bank_id::text, ''),
         max(bank_name) OVER (PARTITION BY bank_id),
         nullif(btrim(regexp_replace(translate(normalize(coalesce(transaction_id,''), NFC),
                chr(173)||chr(160)||chr(8203)||chr(8204)||chr(8205)||chr(8232)||chr(8233)||chr(65279),''),
                '\s+',' ','g')),'')
  FROM outflow_transactions
  UNION ALL
  SELECT 'fx_transactions', id, org_id, date, created_at, import_seq,
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
       date,
       amt                                               AS amount,
       max(narr)                                         AS description,
       count(*)                                          AS row_count,
       (max(created_at) - min(created_at)) < interval '5 minutes' AS arrived_together,
       justify_interval(max(created_at) - min(created_at))        AS import_gap,
       array_agg(created_at ORDER BY created_at, id)     AS created_ats,
       array_agg(import_seq ORDER BY created_at, id)     AS import_seqs,
       amt * (count(*) - 1)                              AS at_stake,
       array_agg(id ORDER BY created_at, id)             AS row_ids
FROM   norm
WHERE  nref IS NOT NULL
GROUP  BY source_table, org_id, bank_key, nref, date, amt,
          coalesce(btrim(regexp_replace(coalesce(narr,''),'\s+',' ','g')), '')
HAVING count(*) > 1
ORDER  BY arrived_together, at_stake DESC;
