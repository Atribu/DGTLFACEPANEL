import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { User } from "../lib/types";
import type { Database, Queryable } from "../lib/server/db";
import { resolveSessionUser, type SessionData } from "../lib/server/auth";
import { HttpError } from "../lib/server/http";
import { migrateUserSchema } from "../lib/server/user-schema";
import { migrateOwnerSchema } from "../lib/server/owner-schema";
import { migrateOwnerConsoleSchema } from "../lib/server/owner-console-schema";
import { ownerConsole, ownerConsoleQuerySchema } from "../lib/server/owner-console";
import { SYSTEM_OWNER_EMAIL } from "../lib/server/owner-identity";
import { presenceSessionId, recordFailedLogin, recordLogin, recordLogout, touchPresence } from "../lib/server/presence";
import { admin, hotel, observer, otherStaff, task } from "./fixtures";

const systemOwner: User = {
  ...admin,
  id: "system-owner",
  name: "Private Owner",
  email: SYSTEM_OWNER_EMAIL,
  active: true,
  isOwner: true,
};
const now = new Date("2026-10-23T10:00:00.000Z");
const globals = globalThis as typeof globalThis & { dgtlDatabase?: Promise<Database> };
const previousDatabase = globals.dgtlDatabase;
let local: PGlite;
let db: Database;

before(async () => {
  local = new PGlite();
  await local.waitReady;
  db = {
    storage: "pglite",
    query: async <T>(sql: string, params: unknown[] = []) => (await local.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) => local.transaction(tx => fn({
      query: async <R>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows,
    })),
    close: () => local.close(),
  };
  await local.exec(`
    CREATE TABLE app_users (id text PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,data jsonb NOT NULL);
    CREATE TABLE hotels (id text PRIMARY KEY,data jsonb NOT NULL);
    CREATE TABLE tasks (id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),assignee_id text REFERENCES app_users(id),data jsonb NOT NULL);
    CREATE TABLE activities (id text PRIMARY KEY,hotel_id text REFERENCES hotels(id),task_id text REFERENCES tasks(id),data jsonb NOT NULL);
  `);
  await migrateUserSchema(db);
  await migrateOwnerSchema(db);
  await migrateOwnerConsoleSchema(db);
  globals.dgtlDatabase = Promise.resolve(db);
});

beforeEach(async () => {
  await local.exec("TRUNCATE account_events,account_sessions,user_events,activities,tasks,hotels,app_users");
  for (const user of [systemOwner, admin, otherStaff, observer]) {
    await db.query("INSERT INTO app_users(id,email,password_hash,data) VALUES ($1,$2,'not-used',$3::jsonb)",
      [user.id,user.email,JSON.stringify(user)]);
  }
  for (const id of ["hotel-a","hotel-b"]) {
    const item = { ...hotel(id), managerId: admin.id };
    await db.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [id,JSON.stringify(item)]);
  }
});

after(async () => {
  if (previousDatabase) globals.dgtlDatabase = previousDatabase;
  else delete globals.dgtlDatabase;
  await db.close();
});

async function saveUser(user: User, version = 1) {
  await db.query("UPDATE app_users SET data=$2::jsonb,auth_version=$3 WHERE id=$1", [user.id,JSON.stringify(user),version]);
}
async function operation(id: string, stamp: string, actor = otherStaff, message = "Görev güncellendi.") {
  const item = {id,hotelId:"hotel-a",taskId:null,userId:actor.id,userName:actor.name,message,createdAt:stamp};
  await db.query("INSERT INTO activities(id,hotel_id,data) VALUES ($1,'hotel-a',$2::jsonb)", [id,JSON.stringify(item)]);
}
async function sessionRow(id: string, user: User, seen: string, overrides: {version?:number;expires?:string;ended?:string;channel?:"web"|"mobile"} = {}) {
  await db.query(`INSERT INTO account_sessions(id,user_id,auth_version,started_at,expires_at,last_seen_at,ended_at,channel)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id,user.id,overrides.version ?? 1,
    "2026-10-23T02:00:00.000Z",overrides.expires ?? "2026-10-23T18:00:00.000Z",seen,
    overrides.ended ?? null,overrides.channel ?? "web"]);
}
const denied = (error: unknown) => error instanceof HttpError && error.status === 403;

test("owner console rejects ordinary roles and forged owner fields using the stored identity", async () => {
  for (const user of [admin, otherStaff, observer]) {
    await assert.rejects(ownerConsole(user, {}, now), denied);
    await assert.rejects(ownerConsole({...systemOwner,id:user.id}, {}, now), denied);
  }
  await assert.rejects(ownerConsole({...systemOwner,id:"missing"}, {}, now), denied);
  assert.equal((await ownerConsole(systemOwner, {}, now)).generatedAt, now.toISOString());
});

test("owner permission is revoked immediately for inactive, deleted, demoted, unmarked, or changed-email database accounts", async () => {
  const changes: Partial<User>[] = [
    {active:false}, {deletedAt:now.toISOString()}, {role:"staff"}, {isOwner:false}, {email:"different@example.test"},
  ];
  for (const change of changes) {
    await saveUser({...systemOwner,...change});
    await assert.rejects(ownerConsole(systemOwner, {}, now), denied);
  }
});

test("presence distinguishes current, timed-out, expired, revoked and ended sessions", async () => {
  await sessionRow("at-boundary", admin, "2026-10-23T09:58:30.000Z");
  await sessionRow("stale", otherStaff, "2026-10-23T09:58:29.999Z");
  await sessionRow("expired", otherStaff, now.toISOString(), {expires:now.toISOString()});
  await sessionRow("revoked", otherStaff, now.toISOString(), {version:0});
  await sessionRow("ended", observer, now.toISOString(), {ended:now.toISOString()});
  await sessionRow("hidden-owner", systemOwner, now.toISOString());
  const result = await ownerConsole(systemOwner, {}, now);
  assert.equal(result.presenceWindowSeconds,90);
  assert.equal(result.summary.online,1);
  assert.equal(result.summary.activeUsers,3);
  assert.equal(result.team.find(user=>user.id===admin.id)?.online,true);
  assert.deepEqual(result.team.find(user=>user.id===admin.id)?.channels,["web"]);
  assert.equal(result.team.find(user=>user.id===otherStaff.id)?.online,false);
  assert.equal(result.team.find(user=>user.id===otherStaff.id)?.lastSeenAt,now.toISOString());
  assert.equal(result.team.find(user=>user.id===observer.id)?.online,false);
  assert.equal(result.team.some(user=>user.id===systemOwner.id),false);
});

test("inactive and deleted people retain history but cannot appear online", async () => {
  await sessionRow("inactive", admin, now.toISOString());
  await sessionRow("deleted", otherStaff, now.toISOString(), {channel:"mobile"});
  await saveUser({...admin,active:false});
  await saveUser({...otherStaff,active:false,deletedAt:now.toISOString()});
  const result = await ownerConsole(systemOwner, {}, now);
  assert.equal(result.summary.online,0);
  assert.equal(result.summary.activeUsers,1);
  const deleted = result.team.find(user=>user.id===otherStaff.id)!;
  assert.equal(deleted.deletedAt,now.toISOString());
  assert.equal(deleted.lastSeenAt,now.toISOString());
  assert.deepEqual(deleted.channels,[]);
});

test("a user remains online on another device after logging out of one session", async () => {
  const realtime = new Date();
  const web: SessionData & {sessionId:string} = {userId:otherStaff.id,authenticatedAt:realtime.getTime()-1000,authVersion:1,sessionId:"web-login"};
  const mobile: SessionData & {sessionId:string} = {...web,sessionId:"mobile-login"};
  await recordLogin(db,otherStaff,web);
  await touchPresence(db,otherStaff,web,"web",realtime);
  await touchPresence(db,otherStaff,mobile,"mobile",realtime);
  let result = await ownerConsole(systemOwner, {}, realtime);
  assert.deepEqual(result.team.find(user=>user.id===otherStaff.id)?.channels.sort(),["mobile","web"]);
  assert.ok(result.team.find(user=>user.id===otherStaff.id)?.lastLoginAt);
  await recordLogout(db,otherStaff,web);
  await touchPresence(db,otherStaff,web,"web",new Date(realtime.getTime()+30_000));
  result = await ownerConsole(systemOwner, {}, new Date(realtime.getTime()+30_000));
  assert.equal(result.team.find(user=>user.id===otherStaff.id)?.online,true);
  assert.deepEqual(result.team.find(user=>user.id===otherStaff.id)?.channels,["mobile"]);
  assert.equal(result.events.filter(event=>event.kind==="session").length,2);
  await saveUser(otherStaff,2);
  assert.equal((await ownerConsole(systemOwner, {}, realtime)).team.find(user=>user.id===otherStaff.id)?.online,false);
});

test("touching a session is throttled and cannot extend its authentication expiry", async () => {
  const session: SessionData & {sessionId:string} = {userId:admin.id,authenticatedAt:now.getTime()-3_600_000,authVersion:1,sessionId:"throttle"};
  await touchPresence(db,admin,session,"web",now);
  await touchPresence(db,admin,session,"web",new Date(now.getTime()+19_999));
  let [row] = await db.query<{last_seen_at:Date;expires_at:Date}>("SELECT last_seen_at,expires_at FROM account_sessions WHERE id='throttle'");
  assert.equal(new Date(row.last_seen_at).toISOString(),now.toISOString());
  await touchPresence(db,admin,session,"web",new Date(now.getTime()+20_000));
  [row] = await db.query("SELECT last_seen_at,expires_at FROM account_sessions WHERE id='throttle'");
  assert.equal(new Date(row.last_seen_at).toISOString(),"2026-10-23T10:00:20.000Z");
  assert.equal(new Date(row.expires_at).toISOString(),"2026-10-23T17:00:00.000Z");
  await touchPresence(db,admin,{...session,sessionId:"expired",authenticatedAt:now.getTime()-8*3_600_000},"web",now);
  await touchPresence(db,otherStaff,{...session,sessionId:"wrong-user"},"web",now);
  assert.equal((await db.query("SELECT id FROM account_sessions")).length,1);
});

test("logout before the first workspace fetch revokes replayed new and legacy cookies and is idempotent", async () => {
  const started = Date.now()-1000;
  const sessions: SessionData[] = [
    {userId:admin.id,authenticatedAt:started,authVersion:1,sessionId:"never-opened"},
    {userId:otherStaff.id,authenticatedAt:started,authVersion:1},
  ];
  for (const [index,session] of sessions.entries()) {
    const user = index === 0 ? admin : otherStaff;
    assert.equal((await resolveSessionUser(session))?.id,user.id);
    await recordLogout(db,user,session);
    await recordLogout(db,user,session);
    assert.equal(await resolveSessionUser(session),null);
    await touchPresence(db,user,session,"mobile",new Date());
    assert.equal(await resolveSessionUser(session),null);
    const [stored] = await db.query<{ended_at:Date;last_seen_at:Date}>(
      "SELECT ended_at,last_seen_at FROM account_sessions WHERE id=$1",[presenceSessionId(session)]);
    assert.ok(stored.ended_at);
    assert.equal(new Date(stored.last_seen_at).getTime(),started);
  }
  assert.equal((await db.query("SELECT id FROM account_events WHERE action='logout'")).length,2);
  assert.equal((await ownerConsole(systemOwner,{},new Date())).summary.online,0);
});

test("failed-login records retain known-account audit identity without persisting arbitrary unknown addresses", async () => {
  await recordFailedLogin(db,"unrecognized-private-input@example.test");
  assert.equal((await db.query("SELECT id FROM account_events")).length,0);
  await recordFailedLogin(db,otherStaff.email);
  const rows = await db.query<{user_id:string;action:string;actor_name:string}>(
    "SELECT user_id,action,actor_name FROM account_events");
  assert.deepEqual(rows,[{user_id:otherStaff.id,action:"login_failed",actor_name:otherStaff.name}]);
});

test("event date filters include the full Istanbul calendar day and preserve exact milliseconds", async () => {
  await operation("before","2026-10-22T20:59:59.999Z");
  await operation("start","2026-10-22T21:00:00.000Z");
  await operation("end","2026-10-23T20:59:59.999Z");
  await operation("after","2026-10-23T21:00:00.000Z");
  const result = await ownerConsole(systemOwner,{from:"2026-10-23",to:"2026-10-23"},now);
  assert.deepEqual(result.events.map(event=>[event.id,event.createdAt]),[
    ["operation:end","2026-10-23T20:59:59.999Z"],["operation:start","2026-10-22T21:00:00.000Z"],
  ]);
});

test("combined event history retains real owner attribution and supports actor, kind and literal search filters", async () => {
  await operation("owner-action",now.toISOString(),systemOwner,"Öncelik 1 yapıldı.");
  const accountEvent = {id:"account-change",actorId:admin.id,actorName:admin.name,targetId:otherStaff.id,targetName:otherStaff.name,message:"Personel bilgileri güncellendi.",createdAt:now.toISOString()};
  await db.query("INSERT INTO user_events(id,actor_id,target_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [accountEvent.id,admin.id,otherStaff.id,JSON.stringify(accountEvent)]);
  await db.query("INSERT INTO account_events(id,user_id,action,actor_name,created_at) VALUES ('login',$1,'login',$2,$3)",
    [otherStaff.id,otherStaff.name,now.toISOString()]);
  const result = await ownerConsole(systemOwner,{},now);
  assert.deepEqual(new Set(result.events.map(event=>event.kind)),new Set(["operation","user","session"]));
  assert.equal(result.events.find(event=>event.kind==="operation")?.actorName,systemOwner.name);
  assert.equal(result.events.find(event=>event.kind==="operation")?.actorId,systemOwner.id);
  assert.equal((await ownerConsole(systemOwner,{actorId:admin.id},now)).events.length,1);
  assert.equal((await ownerConsole(systemOwner,{kind:"user",q:"PERSONEL"},now)).events[0].id,"user:account-change");
  assert.equal((await ownerConsole(systemOwner,{q:"hotel-a"},now)).events[0].id,"operation:owner-action");
  assert.equal((await ownerConsole(systemOwner,{q:"%"},now)).events.length,0);
  assert.equal((await ownerConsole(systemOwner,{actorId:"' OR 1=1 --"},now)).events.length,0);
});

test("event pagination is bounded and deterministic when many events share a timestamp", async () => {
  for (let index=0;index<62;index++) await operation(`event-${String(index).padStart(3,"0")}`,now.toISOString());
  const first = await ownerConsole(systemOwner,{},now);
  const next = await ownerConsole(systemOwner,{offset:50},now);
  assert.equal(first.events.length,50);
  assert.equal(first.limit,50);
  assert.equal(first.offset,0);
  assert.equal(first.hasMore,true);
  assert.equal(next.events.length,12);
  assert.equal(next.hasMore,false);
  assert.equal(next.offset,50);
  assert.equal(new Set([...first.events,...next.events].map(event=>event.id)).size,62);
  assert.equal(first.events[0].id,"operation:event-061");
  assert.equal(next.events.at(-1)?.id,"operation:event-000");
});

test("owner query validation rejects impossible dates, reversed ranges and out-of-range pages", () => {
  for (const query of [{from:"2026-02-30"},{from:"2026-10-24",to:"2026-10-23"},{offset:-1},{offset:100001},{offset:0.5},{kind:"unexpected"},{q:"x".repeat(121)},{unknown:"field"}]) {
    assert.equal(ownerConsoleQuerySchema.safeParse(query).success,false,JSON.stringify(query));
  }
  assert.equal(ownerConsoleQuerySchema.safeParse({from:"2028-02-29",offset:"50"}).success,true);
});

test("workload and failed login summaries use Istanbul dates and count only unfinished work", async () => {
  const earlyMorning = new Date("2026-10-22T22:00:00.000Z"); // October 23 in Istanbul.
  const items = [
    task({id:"overdue",assigneeId:otherStaff.id,dueDate:"2026-10-22",status:"waiting"}),
    task({id:"today",assigneeId:otherStaff.id,dueDate:"2026-10-23",status:"review"}),
    task({id:"finished",assigneeId:otherStaff.id,dueDate:"2026-10-20",status:"completed"}),
    task({id:"unassigned",hotelId:"hotel-b",assigneeId:null,dueDate:null,status:"planned"}),
  ];
  for (const item of items) await db.query("INSERT INTO tasks(id,hotel_id,assignee_id,data) VALUES ($1,$2,$3,$4::jsonb)",
    [item.id,item.hotelId,item.assigneeId,JSON.stringify(item)]);
  for (const [id,stamp] of [["prior","2026-10-22T20:59:59.999Z"],["today","2026-10-22T21:00:00.000Z"],["future","2026-10-22T22:00:00.001Z"]]) {
    await db.query("INSERT INTO account_events(id,user_id,action,actor_name,created_at) VALUES ($1,NULL,'login_failed','Bilinmeyen hesap',$2)",[id,stamp]);
  }
  const result = await ownerConsole(systemOwner,{},earlyMorning);
  assert.equal(result.summary.openTasks,3);
  assert.equal(result.summary.overdueTasks,1);
  assert.equal(result.summary.awaitingReview,1);
  assert.equal(result.summary.waitingTasks,1);
  assert.equal(result.summary.failedLoginsToday,1);
  assert.equal(result.team.find(user=>user.id===otherStaff.id)?.openTasks,2);
  assert.equal(result.team.find(user=>user.id===otherStaff.id)?.overdueTasks,1);
  assert.equal(result.hotels[0].id,"hotel-a");
  assert.equal(result.hotels[0].overdueTasks,1);
});
