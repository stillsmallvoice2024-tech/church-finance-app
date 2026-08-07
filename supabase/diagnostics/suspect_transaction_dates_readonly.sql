-- ============================================================================
-- READ-ONLY: transactions whose date looks mis-parsed
-- ============================================================================
-- Safe to run on production. Creates nothing, changes nothing, needs none of
-- the migrations applied.
--
-- Statement dates are parsed from spreadsheet cells, and some land wrong. The
-- symptoms, most reliable first:
--
--   excel serial epoch     A date in 1900-1910. Excel counts days from
--                          1899-12-30, so a raw serial read as a date lands
--                          here. 1905-07-18 is serial ~2027.
--   legs disagree          Rows sharing one reference dated more than 31 days
--                          apart. A transfer, its fee and the VAT on it post
--                          together — if they disagree, the parse did it.
--   implausible year       Before 2000, or more than a year in the future.
--   suspicious 1 January   Dated 1 January. Legitimate for opening balances, so
--                          check `same_day_count`: a handful is normal, dozens
--                          of unrelated transactions on 1 Jan is a parse
--                          fallback.
--
-- `created_at` is when the row was imported — the gap between it and `date` is
-- often the giveaway.
--
-- Nothing here is conclusive on its own. Read it against the original
-- statement file before changing any date.
-- ============================================================================

WITH t AS (
  SELECT 'inflow_transactions'::text AS source_table, id, org_id, date, created_at,
         bank_name, amount AS amt, description AS narr, transaction_ref AS ref
  FROM inflow_transactions
  UNION ALL
  SELECT 'outflow_transactions', id, org_id, date, created_at,
         bank_name, amount_disbursed, description, transaction_id
  FROM outflow_transactions
  UNION ALL
  SELECT 'fx_transactions', id, org_id, date, created_at,
         bank_name, coalesce(deposit,0) + coalesce(withdrawal,0), narration, transaction_ref
  FROM fx_transactions
),
-- Rows sharing a reference should share a date; a wide spread means one of
-- them was parsed wrongly.
ref_spread AS (
  SELECT org_id, bank_name, ref,
         max(date) - min(date) AS day_spread
  FROM   t
  WHERE  ref IS NOT NULL AND btrim(ref) <> ''
  GROUP  BY 1, 2, 3
  HAVING count(*) > 1
),
-- How many transactions share each date, to tell an opening balance on 1 Jan
-- from a parse fallback that dumped everything there.
day_load AS (
  SELECT org_id, date, count(*) AS same_day_count
  FROM   t
  GROUP  BY 1, 2
)
SELECT t.source_table,
       t.bank_name                             AS bank,
       t.date,
       t.amt                                   AS amount,
       t.narr                                  AS description,
       t.ref                                   AS reference,
       CASE
         WHEN t.date BETWEEN DATE '1900-01-01' AND DATE '1910-12-31' THEN 'excel serial epoch'
         WHEN rs.day_spread > 31                                     THEN 'legs disagree'
         WHEN t.date < DATE '2000-01-01'
           OR t.date > current_date + INTERVAL '1 year'               THEN 'implausible year'
         ELSE 'suspicious 1 January'
       END                                     AS symptom,
       rs.day_spread                           AS ref_day_spread,
       dl.same_day_count,
       t.created_at::date                      AS imported_on,
       t.id                                    AS row_id
FROM   t
LEFT   JOIN ref_spread rs
       ON rs.org_id = t.org_id
      AND rs.bank_name IS NOT DISTINCT FROM t.bank_name
      AND rs.ref = t.ref
LEFT   JOIN day_load dl
       ON dl.org_id = t.org_id AND dl.date = t.date
WHERE  t.date BETWEEN DATE '1900-01-01' AND DATE '1910-12-31'
   OR  t.date < DATE '2000-01-01'
   OR  t.date > current_date + INTERVAL '1 year'
   OR  rs.day_spread > 31
   OR  (EXTRACT(MONTH FROM t.date) = 1 AND EXTRACT(DAY FROM t.date) = 1)
ORDER  BY symptom, t.bank_name, t.date, t.amt DESC;
