## What is this chapter about?

A **distribution rule** (also called an allocation config) is a recipe that splits incoming money automatically. Example: "Every offering is split 60% to General Fund, 30% to Missions, 10% to Building." This chapter covers creating rules in **Setup**, viewing them on **Distribution Rules**, watching the results on **Regular Funds**, and one-off **Special Configs**.

## How the splitting works (the simple version)

1. Money comes in (an inflow).
2. The app looks for the rule that was active on that date.
3. It splits the money into each category's pockets exactly as the rule says.
4. You can watch the growing balances on the Regular Funds page.

## Part 1: Creating a distribution rule (Setup → Allocation)

Admins only.

1. Go to **Setup**, click the **Allocation** tab, then **+ New Configuration**.
2. Type a **Configuration Name** (example: 2026 Allocation).
3. Pick **Effective From** — the date the rule starts working.
4. Add rows: for each row pick a **Category**, a **Budget Portion** (Percentage, Specific Seed, or Savings), and a **Percentage**. Click **Add row** for more.
5. Watch the **Running total** strip at the bottom — it turns green when your percentages add up to 100%.
6. Click **Save as Draft**.
7. Back in the list, click the **lock** icon (**Approve & Lock**) on your draft. Important: a rule does nothing until it is locked! Drafts say "Not in use — approve & lock to activate".

To change a locked rule later, create a new configuration with a newer date — old transactions keep the old rule.

## Part 2: The Distribution Rules page

Find it at **Budget & Allocation → Distribution Rules**. This is a viewing page.

1. Pick a rule from the dropdown (newest first; "✓" means locked, "(draft)" means draft).
2. A green **Currently active** badge means this rule is being applied today.
3. The table shows every category, its percentage, and what it gets from every 100 received.
4. The bottom **Total** row is green with a ✓ when it adds to 100%, amber with a ⚠ when it doesn't.

## Part 3: The Regular Funds page

Find it at **Budget & Allocation → Regular Funds**. It shows what the rules have collected over time: for each category, the **Total Allocated**, **Withdrawn**, and **Net Balance**. Three cards at the top show the overall totals. Red balances mean a bucket spent more than it received.

## Part 4: Special Configs (one-off rules)

A special config is a rule for a special occasion — like an Easter offering with its own split. Admins create them in **Setup → Special Configs**.

1. Click **+ Create New Group**.
2. Type a **Name** (example: Easter Special Allocation) and the **Effective From** date.
3. Choose the **Allocation Type**: **Percentage %** or **Amount** (fixed sums; type the **Total Amount** too).
4. Add category rows just like a normal rule. The running balance must match (100% or the total amount).
5. Smart trick: pick a **Linked Income Type**. Whenever a transaction gets that income type (example: "Easter Offering"), this special rule is applied automatically.
6. Click **Save & Lock** (or **Save as Draft** to finish later).

A group can have many **versions** over time — click **+ New Version** on the group. If you backdate a version, the app asks whether to **Recalculate** the old transactions with the new split, or keep them and use the new version for future only.

## If something goes wrong

- **Inflows are not being split** — the rule is probably still a draft. Lock it in Setup → Allocation.
- **Total shows ⚠** — percentages don't add to 100%. Edit the rule (drafts) or create a corrected version (locked).
- **A special offering used the wrong split** — edit the inflow and pick the right **Allocation Config** in the edit window.
