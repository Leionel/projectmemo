import {expect,test} from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
test("旧库副本增量升级保留仓库/信号/撤权历史，并支持无GitHub仓库的多个环境",()=>{
 const sql=new Database(":memory:");sql.pragma("foreign_keys=ON");
 const names=fs.readdirSync("prisma/migrations").sort(),target="20261030233000_ct7_deployment_connections";
 for(const name of names.filter(n=>n<target)){const file=path.join("prisma/migrations",name,"migration.sql");if(fs.existsSync(file))sql.exec(fs.readFileSync(file,"utf8"));}
 sql.prepare('INSERT INTO "User" (id,username,"displayName","passwordHash","updatedAt") VALUES (?,?,?,?,?)').run("u","migration-u","迁移用户","fixture",Date.now());
 sql.prepare('INSERT INTO "Project" (id,title,description,goal,scenario,"updatedAt") VALUES (?,?,?,?,?,?)').run("p","迁移项目","隔离测试","保留历史","RESEARCH",Date.now());
 sql.prepare('INSERT INTO "SourceConnection" (id,"projectId","ownerUserId",repo,ref,status,"updatedAt") VALUES (?,?,?,?,?,?,?)').run("c","p","u","example/repo","main","REVOKED",Date.now());
 sql.prepare('INSERT INTO "ExternalSignal" (id,"connectionId","projectId","ownerUserId",sha,title,"authorName",url) VALUES (?,?,?,?,?,?,?,?)').run("s","c","p","u","a".repeat(40),"旧提交","fixture","https://github.com/example/repo");
 sql.exec(fs.readFileSync(path.join("prisma/migrations",target,"migration.sql"),"utf8"));
 expect(sql.prepare('SELECT provider,repo,ref,status FROM "SourceConnection" WHERE id=?').get("c")).toEqual({provider:"GITHUB",repo:"example/repo",ref:"main",status:"REVOKED"});
 expect(sql.prepare('SELECT count(*) AS n FROM "ExternalSignal"').get()).toEqual({n:1});
 for(const id of ["staging","prod"])sql.prepare('INSERT INTO "SourceConnection" (id,"projectId","ownerUserId",provider,"environmentKey","updatedAt") VALUES (?,?,?,?,?,?)').run(id,"p","u","DEPLOYMENT",id,Date.now());
 expect(sql.pragma("foreign_key_check")).toEqual([]);sql.prepare('DELETE FROM "Project" WHERE id=?').run("p");expect(sql.prepare('SELECT count(*) AS n FROM "ExternalSignal"').get()).toEqual({n:0});sql.close();
});
