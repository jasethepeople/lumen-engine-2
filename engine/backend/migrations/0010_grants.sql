-- 0010: privileges — tables created via CLI migrations don't inherit the
-- dashboard default privileges, so grant explicitly.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to service_role, authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role, authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant usage, select on sequences to service_role, authenticated;

grant execute on all functions in schema public to service_role, authenticated, anon;
