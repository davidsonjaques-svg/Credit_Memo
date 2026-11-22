-- ═══════════════════════════════════════════════════════════════════════════
-- Link Supabase Auth logins to team members (Deal Suite web app, Phase 2 auth)
-- Safe to re-run.
--
-- 1. Authentication → Users → Add user → Create new user, for each person
--    (email + password, tick "Auto Confirm User").
-- 2. Put the same email on each person's row in `members` (edit below).
-- 3. Run this script. Each login is matched to its member by email, and the
--    org-isolation RLS policies in schema.sql start returning that org's deals.
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 2: set the emails (uncomment, put in the real addresses, then run)
-- update members set email = '...' where full_name = 'Jaques Davidson' and email is null;
-- update members set email = '...' where full_name = 'Zach Moses' and email is null;
-- update members set email = '...' where full_name = 'Thabani'    and email is null;
-- update members set email = '...' where full_name = 'Shaun'      and email is null;

-- Step 3: link logins to members by email
update members m
set user_id = u.id
from auth.users u
where lower(u.email) = lower(m.email)
  and m.user_id is distinct from u.id;

-- Check: everyone should show a user_id
select full_name, email, role, user_id is not null as linked
from members
order by full_name;
