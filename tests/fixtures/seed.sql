insert into clients (id,name) values
 ('aaaaaaaa-0000-4000-8000-000000000001','Harbor Labs'),('bbbbbbbb-0000-4000-8000-000000000002','Desert Moto');
insert into users (id,email,name,title,role,client_id,password_hash) values
 ('11111111-0000-4000-8000-000000000001','alexis@gotit2work.com','Alexis',null,'admin',null,'$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('22222222-0000-4000-8000-000000000002','dana@harbor.test','Dana Whitfield','Marketing Lead','client','aaaaaaaa-0000-4000-8000-000000000001','$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS'),
 ('33333333-0000-4000-8000-000000000003','rob@moto.test','Rob Vance','Owner','client','bbbbbbbb-0000-4000-8000-000000000002','$2a$10$yBZZjb9tBj3ora2./79LGO57SKZWZiZp0dKSGWoe9vAKrfNR7aXgS');
insert into projects (id,client_id,title,type,summary,stage_idx,vimeo_folder_id,next_label,next_date,next_what,capabilities) values
 ('cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Harbor Summit','Conference film','Keynotes, interviews, and the recap film for Harbor Summit 2026.',3,'222','Next','October 9','Final polish once Version 3 is approved','{"download_source":true,"share":true,"stats":true,"upload":true}'),
 ('dddddddd-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002','Desert Shoot','Brand film',null,2,'333',null,null,null,'{"download":false,"messages":false}');
