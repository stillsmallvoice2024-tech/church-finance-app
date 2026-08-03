-- ── Outflow classification rules ────────────────────────────────────────────
--
-- Inflows auto-classify during import via income_type_rules + classifyIncomeType.
-- Outflows had no rule engine at all: stage codes were only pre-populated by an
-- exact category-name match on a mapped spreadsheet column, so every debit row
-- on a bank statement had to be configured by hand.
--
-- This table mirrors income_type_rules (same rule_type / rule_value shape, same
-- RLS helpers) and adds the fields an outflow needs: stage codes and outflow type.
--
-- Rules match against the RAW description, exactly as classifyIncomeType does.
-- normalizeNarration output is never used for matching.

create table if not exists public.outflow_classification_rules (
  id              uuid        default gen_random_uuid() primary key,
  rule_type       text        not null check (rule_type in ('keyword', 'stage_code')),
  rule_value      text        not null,
  stage_code_1    text,
  stage_code_2    text,
  outflow_type_id uuid        references public.outflow_types(id) on delete set null,
  -- Lower numbers evaluate first; ties fall back to created_at.
  priority        int         not null default 0,
  org_id          uuid        not null default public.get_current_org_id()
                  references public.organizations(id) on delete set null,
  created_at      timestamptz default now()
);

alter table public.outflow_classification_rules enable row level security;

-- Same posture as income_type_rules: any member may read, only admins may write.
drop policy if exists "outflow_classification_rules_select" on public.outflow_classification_rules;
create policy "outflow_classification_rules_select" on public.outflow_classification_rules
  for select using (public.is_org_member(org_id));

drop policy if exists "outflow_classification_rules_insert" on public.outflow_classification_rules;
create policy "outflow_classification_rules_insert" on public.outflow_classification_rules
  for insert with check (public.is_org_admin(org_id));

drop policy if exists "outflow_classification_rules_update" on public.outflow_classification_rules;
create policy "outflow_classification_rules_update" on public.outflow_classification_rules
  for update using (public.is_org_admin(org_id));

drop policy if exists "outflow_classification_rules_delete" on public.outflow_classification_rules;
create policy "outflow_classification_rules_delete" on public.outflow_classification_rules
  for delete using (public.is_org_admin(org_id));

create index if not exists idx_outflow_classification_rules_org
  on public.outflow_classification_rules(org_id);
create index if not exists idx_outflow_classification_rules_lookup
  on public.outflow_classification_rules(org_id, priority, created_at);

notify pgrst, 'reload schema';
