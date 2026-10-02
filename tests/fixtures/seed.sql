-- Test data: two clients, staff in every role, clients in every role, two projects on the Vimeo token from
-- the environment (env-vimeo). Every password is "portal-test-pass".
insert into clients (id,name) values
 ('aaaaaaaa-0000-4000-8000-000000000001','Harbor Labs'),('bbbbbbbb-0000-4000-8000-000000000002','Desert Moto');
insert into users (id,email,name,title,role,access,client_id,password_hash) values
 ('11111111-0000-4000-8000-000000000001','alexis@gotit2work.com','Alexis',null,'admin','owner',null,'$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('11111111-0000-4000-8000-000000000002','pat@studio.test','Pat Producer','Producer','admin','manager',null,'$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('11111111-0000-4000-8000-000000000003','eddie@studio.test','Eddie Editor','Editor','admin','editor',null,'$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('22222222-0000-4000-8000-000000000002','dana@harbor.test','Dana Whitfield','Marketing Lead','client','approver','aaaaaaaa-0000-4000-8000-000000000001','$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('22222222-0000-4000-8000-000000000003','rae@harbor.test','Rae Reviewer','Brand Manager','client','reviewer','aaaaaaaa-0000-4000-8000-000000000001','$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('22222222-0000-4000-8000-000000000004','vic@harbor.test','Vic Viewer','CEO','client','viewer','aaaaaaaa-0000-4000-8000-000000000001','$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('33333333-0000-4000-8000-000000000003','rob@moto.test','Rob Vance','Owner','client','approver','bbbbbbbb-0000-4000-8000-000000000002','$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS');
insert into projects (id,client_id,title,type,summary,stage_idx,source_conn,source_ref,next_label,next_date,next_what,capabilities) values
 ('cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Harbor Summit','Conference film','Keynotes, interviews, and the recap film for Harbor Summit 2026.',3,'env-vimeo','222','Next','October 9','Final polish once Version 3 is approved','{"download_source":true,"share":true,"stats":true,"upload":true}'),
 ('dddddddd-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','Desert Shoot','Brand film',null,2,'env-vimeo','333',null,null,null,'{"download":false,"messages":false}');
