-- ═══════════════════════════════════════════════════════════════════════════
-- Bootstrap: create the ScaleForce org and the team.  Run AFTER schema.sql.
-- Safe to re-run. Edit the names below, then click Run.
-- To add someone later:  insert into members (org_id, full_name, role)
--                        select id, 'New Person', 'analyst' from orgs
--                        where name = 'ScaleForce Capital';
-- ═══════════════════════════════════════════════════════════════════════════

insert into orgs (name) values ('ScaleForce Capital')
on conflict (name) do nothing;

insert into members (org_id, full_name, role)
select o.id, t.full_name, t.role
from orgs o
cross join (values
  ('Jaques Davidson', 'admin'),
  ('Zach Moses',      'admin'),
  ('Thabani',         'analyst')
  -- ,('Fourth Member', 'analyst')
) as t(full_name, role)
where o.name = 'ScaleForce Capital'
on conflict (org_id, full_name) do nothing;

-- Copy this id into Streamlit secrets as SUPABASE_ORG_ID (optional while
-- there is only one org — the app picks it up automatically).
select id as supabase_org_id, name from orgs;
