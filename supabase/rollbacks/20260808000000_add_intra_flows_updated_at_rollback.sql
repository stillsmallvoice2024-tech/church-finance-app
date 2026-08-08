-- ROLLBACK for 20260808000000_add_intra_flows_updated_at.sql
-- Run ONLY if that migration must be undone. Drops the updated_at column
-- added to intra_flows, along with the data it holds.

alter table public.intra_flows drop column if exists updated_at;

notify pgrst, 'reload schema';
