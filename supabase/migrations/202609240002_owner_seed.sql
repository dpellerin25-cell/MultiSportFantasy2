begin;
-- Stable IDs; alphabetic seed order is NOT the commissioner's draft order.
insert into draft.owners(id,slug,display_name) values
('00000000-0000-4000-8000-000000000001','brendan','Brendan'),
('00000000-0000-4000-8000-000000000002','chris','Chris'),
('00000000-0000-4000-8000-000000000003','doug','Doug'),
('00000000-0000-4000-8000-000000000004','hatch','Hatch'),
('00000000-0000-4000-8000-000000000005','jack','Jack'),
('00000000-0000-4000-8000-000000000006','jacob','Jacob'),
('00000000-0000-4000-8000-000000000007','nik','Nik'),
('00000000-0000-4000-8000-000000000008','ryan','Ryan'),
('00000000-0000-4000-8000-000000000009','tucker','Tucker');
-- Doug is the intended initial commissioner. No auth user exists yet, so no
-- role is granted. Bind a verified auth.users UUID later; never match by name.
commit;
