begin;

-- Reset tabulek a policy pro oblast "Časopisy"
drop policy if exists casopisy_authenticated_select on public.casopisy;
drop policy if exists casopisy_authenticated_insert on public.casopisy;
drop policy if exists casopisy_authenticated_update on public.casopisy;

drop table if exists public.casopisy cascade;
drop table if exists public.vydavatele cascade;
drop table if exists public.casopisy_vydavatele cascade;
drop table if exists public.jcr_importy cascade;

commit;
