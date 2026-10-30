import { z } from "zod";
import type { OwnerConsoleData, OwnerEvent, OwnerTeamMember } from "../owner-console";
import type { Hotel, Task, User } from "../types";
import { getDb } from "./db";
import { HttpError } from "./http";
import { isProtectedOwner, isSystemOwner } from "./owner-identity";
import { isUserActive } from "./user-policies";
import { PRESENCE_WINDOW_SECONDS } from "./presence";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "Geçerli bir tarih seçin.");
export const ownerConsoleQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
  actorId: z.string().trim().max(100).optional(),
  kind: z.enum(["all","operation","user","session"]).default("all"),
  q: z.string().trim().max(120).default(""),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to,
  {message: "Başlangıç tarihi bitiş tarihinden sonra olamaz.", path: ["from"]});
export type OwnerConsoleQuery = z.input<typeof ownerConsoleQuerySchema>;

function iso(value: string | Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}
export async function ownerConsole(actor: User, rawQuery: OwnerConsoleQuery, now = new Date()): Promise<OwnerConsoleData> {
  const db = await getDb();
  // Recheck the stored account; neither a supplied object nor an old cookie
  // can grant the owner permission after its server-side privilege is revoked.
  const [fresh] = await db.query<{data: User}>("SELECT data FROM app_users WHERE id=$1", [actor.id]);
  if (!fresh || !isSystemOwner(fresh.data)) throw new HttpError(403, "Bu ekran yalnız sistem sahibine açıktır.");
  const query = ownerConsoleQuerySchema.parse(rawQuery);
  const today = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Istanbul",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const from = query.from ? new Date(`${query.from}T00:00:00+03:00`).toISOString() : null;
  const to = query.to ? new Date(new Date(`${query.to}T00:00:00+03:00`).getTime() + 86400000).toISOString() : null;
  const [users, tasks, hotels, presence, logins, failed] = await Promise.all([
    db.query<{data: User}>("SELECT data FROM app_users ORDER BY data->>'name',id"),
    db.query<{data: Task}>("SELECT t.data FROM tasks t JOIN hotels h ON h.id=t.hotel_id WHERE h.data->>'archivedAt' IS NULL"),
    db.query<{data: Hotel}>("SELECT data FROM hotels WHERE data->>'archivedAt' IS NULL ORDER BY data->>'name',id"),
    db.query<{user_id:string; last_seen_at:string|Date; online:boolean; channels:string[]}>(`
      SELECT s.user_id,max(s.last_seen_at) AS last_seen_at,
        bool_or(s.ended_at IS NULL AND s.expires_at > $1::timestamptz AND s.auth_version=u.auth_version
          AND s.last_seen_at >= $1::timestamptz - interval '90 seconds') AS online,
        array_agg(DISTINCT s.channel) FILTER (WHERE s.ended_at IS NULL AND s.expires_at > $1::timestamptz
          AND s.auth_version=u.auth_version AND s.last_seen_at >= $1::timestamptz - interval '90 seconds') AS channels
      FROM account_sessions s JOIN app_users u ON u.id=s.user_id GROUP BY s.user_id`, [now.toISOString()]),
    db.query<{user_id:string; last_login_at:string|Date}>("SELECT user_id,max(created_at) AS last_login_at FROM account_events WHERE action='login' GROUP BY user_id"),
    db.query<{count:string|number}>("SELECT count(*) AS count FROM account_events WHERE action='login_failed' AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz", [`${today}T00:00:00+03:00`, now.toISOString()]),
  ]);
  const work = tasks.map(row => row.data);
  const open = (task:Task) => task.status !== "completed";
  const overdue = (task:Task) => open(task) && !!task.dueDate && task.dueDate < today;
  const team: OwnerTeamMember[] = users.map(row => row.data).filter(user => !isProtectedOwner(user)).map(user => {
    const seen = presence.find(row => row.user_id === user.id);
    const active = isUserActive(user);
    return { id:user.id,name:user.name,email:user.email,role:user.role,active,
      deletedAt:user.deletedAt ?? null,online:active && !!seen?.online,
      lastSeenAt:iso(seen?.last_seen_at ?? null),
      lastLoginAt:iso(logins.find(row => row.user_id === user.id)?.last_login_at ?? null),
      channels:active && seen?.online ? (seen.channels ?? []).filter((channel): channel is "web"|"mobile" => channel === "web" || channel === "mobile") : [],
      openTasks:work.filter(task => task.assigneeId === user.id && open(task)).length,
      overdueTasks:work.filter(task => task.assigneeId === user.id && overdue(task)).length,
    };
  });
  const events = await db.query<OwnerEvent>(`
    WITH events AS (
      SELECT 'operation:'||a.id AS id,'operation' AS kind,a.data->>'userId' AS actor_id,
        a.data->>'userName' AS actor_name,a.data->>'message' AS message,
        a.data->>'createdAt' AS created_at,a.hotel_id,a.task_id,NULL AS hotel_name
        FROM activities a
        WHERE ($1::text IS NULL OR a.data->>'createdAt'>=$1)
          AND ($2::text IS NULL OR a.data->>'createdAt'<$2)
      UNION ALL
      SELECT 'user:'||u.id,'user',u.data->>'actorId',u.data->>'actorName',
        coalesce(u.data->>'targetName','')||': '||coalesce(u.data->>'message',''),
        u.data->>'createdAt',NULL,NULL,NULL FROM user_events u
        WHERE ($1::text IS NULL OR u.data->>'createdAt'>=$1)
          AND ($2::text IS NULL OR u.data->>'createdAt'<$2)
      UNION ALL
      SELECT 'session:'||s.id,'session',s.user_id,s.actor_name,
        CASE s.action WHEN 'login' THEN 'Hesaba giriş yapıldı.' WHEN 'logout' THEN 'Hesaptan çıkış yapıldı.'
          ELSE 'Başarısız giriş denemesi.' END,
        to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),NULL,NULL,NULL FROM account_events s
        WHERE ($1::text IS NULL OR s.created_at >= $1::timestamptz)
          AND ($2::text IS NULL OR s.created_at < $2::timestamptz)
      UNION ALL
      SELECT 'hotel:'||h.id,'operation',h.data->>'actorId',h.data->>'actorName',
        CASE h.data->>'action'
          WHEN 'archive' THEN 'Otel arşivlendi. Düzenli işler duraklatıldı.'
          WHEN 'restore' THEN 'Otel arşivden çıkarıldı. Düzenli işler duraklatılmış durumda.'
          ELSE 'Otel kalıcı olarak silindi. Görev: '||coalesce(h.data->'counts'->>'tasks','0')
            ||', yorum: '||coalesce(h.data->'counts'->>'comments','0')
            ||', ek: '||coalesce(h.data->'counts'->>'attachments','0')
            ||', düzenli iş: '||coalesce(h.data->'counts'->>'recurrences','0')||'.' END,
        h.data->>'createdAt',h.hotel_id,NULL,h.data->>'hotelName' FROM hotel_events h
        WHERE ($1::text IS NULL OR h.data->>'createdAt'>=$1)
          AND ($2::text IS NULL OR h.data->>'createdAt'<$2)
    )
    SELECT e.id,e.kind,e.actor_id AS "actorId",e.actor_name AS "actorName",e.message,
      e.created_at AS "createdAt",e.hotel_id AS "hotelId",coalesce(e.hotel_name,h.data->>'name') AS "hotelName",
      e.task_id AS "taskId",t.data->>'title' AS "taskTitle"
    FROM events e LEFT JOIN hotels h ON h.id=e.hotel_id LEFT JOIN tasks t ON t.id=e.task_id
    WHERE ($3::text IS NULL OR e.actor_id=$3)
      AND ($4='all' OR e.kind=$4)
      AND ($5='' OR strpos(lower(concat_ws(' ',e.actor_name,e.message,coalesce(e.hotel_name,h.data->>'name'),t.data->>'title')),lower($5))>0)
    ORDER BY e.created_at DESC,e.id DESC LIMIT 51 OFFSET $6`,
    [from,to,query.actorId || null,query.kind,query.q,query.offset]);
  return {
    generatedAt:now.toISOString(),presenceWindowSeconds:PRESENCE_WINDOW_SECONDS,
    summary:{online:team.filter(user=>user.online).length,activeUsers:team.filter(user=>user.active).length,
      openTasks:work.filter(open).length,overdueTasks:work.filter(overdue).length,
      awaitingReview:work.filter(task=>task.status==="review").length,
      waitingTasks:work.filter(task=>task.status==="waiting").length,failedLoginsToday:Number(failed[0]?.count ?? 0)},
    team,
    hotels:hotels.map(({data:hotel})=>{const list=work.filter(task=>task.hotelId===hotel.id);return {
      id:hotel.id,name:hotel.name,openTasks:list.filter(open).length,overdueTasks:list.filter(overdue).length,
      awaitingReview:list.filter(task=>task.status==="review").length,waitingTasks:list.filter(task=>task.status==="waiting").length,
    };}).sort((a,b)=>b.overdueTasks-a.overdueTasks || b.awaitingReview-a.awaitingReview || a.name.localeCompare(b.name,"tr")),
    events:events.slice(0,50).map(event=>({...event,createdAt:new Date(event.createdAt).toISOString()})),
    hasMore:events.length>50,offset:query.offset,limit:50,
  };
}
