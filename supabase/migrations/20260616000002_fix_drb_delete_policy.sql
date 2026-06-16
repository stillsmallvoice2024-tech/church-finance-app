-- drb_delete was missing 'accountant' role while drb_insert allowed it.
-- The save flow is delete-then-insert; accountants could insert blocks but
-- not delete them, so each save appended new blocks without removing old ones.
drop policy if exists "drb_delete" on public.dynamic_report_blocks;
create policy "drb_delete" on public.dynamic_report_blocks
  for delete using (
    exists (
      select 1 from public.dynamic_reports dr
      join   public.org_members m
        on   m.org_id = dr.org_id and m.user_id = auth.uid()
        and  m.role   in ('owner', 'admin', 'accountant') and m.status = 'active'
      where  dr.id = report_id
    )
  );
