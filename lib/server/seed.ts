import { randomUUID } from "node:crypto";
import type {
  Activity,
  Hotel,
  Task,
  TaskComment,
  TaskStatus,
  User,
} from "../types";
import type { Database, Queryable } from "./db";
import { hashPassword } from "./password";
import { buildTemplateTasks } from "./template";

export async function insertTask(tx: Queryable, task: Task) {
  await tx.query(
    "INSERT INTO tasks (id, hotel_id, assignee_id, data) VALUES ($1,$2,$3,$4::jsonb)",
    [task.id, task.hotelId, task.assigneeId, JSON.stringify(task)],
  );
}

export async function seedDemo(db: Database) {
  await db.transaction(async (tx) => {
    // The metadata row is also the initialization lock across PostgreSQL instances.
    await tx.query(
      "INSERT INTO app_meta(key,value) VALUES ('seed-lock','1') ON CONFLICT DO NOTHING",
    );
    await tx.query("SELECT key FROM app_meta WHERE key='seed-lock' FOR UPDATE");
    if (
      (await tx.query("SELECT key FROM app_meta WHERE key='demo-seeded-v1'"))
        .length
    )
      return;
    if ((await tx.query("SELECT id FROM app_users LIMIT 1")).length) return;
    const now = new Date();
    const stamp = now.toISOString();
    const users: User[] = [
      {
        id: "user-admin",
        name: "Mert Yılmaz",
        email: "admin@dgtlface.demo",
        role: "admin",
        department: "Yönetim",
        hotelIds: [],
      },
      {
        id: "user-ayse",
        name: "Ayşe Demir",
        email: "ayse@dgtlface.demo",
        role: "staff",
        department: "Proje Yöneticisi",
        hotelIds: [],
      },
      {
        id: "user-emre",
        name: "Emre Kaya",
        email: "emre@dgtlface.demo",
        role: "staff",
        department: "Web & IT",
        hotelIds: [],
      },
      {
        id: "user-deniz",
        name: "Deniz Arslan",
        email: "deniz@dgtlface.demo",
        role: "staff",
        department: "Performans Pazarlama",
        hotelIds: [],
      },
      {
        id: "user-selin",
        name: "Selin Aydın",
        email: "selin@dgtlface.demo",
        role: "staff",
        department: "Kreatif Ekip",
        hotelIds: [],
      },
      {
        id: "user-otel",
        name: "Ece Aksoy",
        email: "otel@dgtlface.demo",
        role: "observer",
        department: "Otel Yönetimi",
        hotelIds: ["hotel-luna"],
      },
    ];
    for (const user of users)
      await tx.query(
        "INSERT INTO app_users (id,email,password_hash,data) VALUES ($1,$2,$3,$4::jsonb)",
        [
          user.id,
          user.email,
          await hashPassword("Demo2026!"),
          JSON.stringify(user),
        ],
      );
    const hotels: Hotel[] = [
      {
        id: "hotel-luna",
        name: "Luna Resort & Spa",
        location: "Antalya · Belek",
        stage: "onboarding",
        services: [
          "Web & IT",
          "OTA",
          "SEO",
          "Sosyal Medya",
          "Çağrı Merkezi",
          "Reklam",
        ],
        managerId: "user-ayse",
        contactName: "Ece Aksoy",
        contactEmail: "ece@luna.example",
        color: "#8b72ed",
        createdAt: stamp,
      },
      {
        id: "hotel-mira",
        name: "Mira Beach Hotel",
        location: "Muğla · Bodrum",
        stage: "onboarding",
        services: ["Web & IT", "SEO", "Reklam"],
        managerId: "user-emre",
        contactName: "Can Tekin",
        contactEmail: "can@mira.example",
        color: "#3a9aa2",
        createdAt: stamp,
      },
      {
        id: "hotel-nova",
        name: "Nova City Hotel",
        location: "İstanbul · Karaköy",
        stage: "operation",
        services: ["Sosyal Medya", "Reklam", "OTA"],
        managerId: "user-deniz",
        contactName: "Derya Sezer",
        contactEmail: "derya@nova.example",
        color: "#db9650",
        createdAt: stamp,
      },
      {
        id: "hotel-oliva",
        name: "Oliva Garden",
        location: "İzmir · Alaçatı",
        stage: "onboarding",
        services: ["Web & IT", "Sosyal Medya", "Kreatif"],
        managerId: "user-selin",
        contactName: "Bora Eren",
        contactEmail: "bora@oliva.example",
        color: "#62a27d",
        createdAt: stamp,
      },
    ];
    for (const hotel of hotels)
      await tx.query("INSERT INTO hotels(id,data) VALUES ($1,$2::jsonb)", [
        hotel.id,
        JSON.stringify(hotel),
      ]);
    const istanbulToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const baseDate = new Date(`${istanbulToday}T12:00:00Z`);
    function dueDate(offset: number) {
      const date = new Date(baseDate);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    }
    const statusCycle: TaskStatus[] = [
      "completed",
      "completed",
      "in_progress",
      "waiting",
      "planned",
      "review",
      "planned",
      "in_progress",
      "planned",
      "completed",
    ];
    const sampleTasks: Task[] = [];
    for (let hotelIndex = 0; hotelIndex < hotels.length; hotelIndex++) {
      const hotel = hotels[hotelIndex];
      let selected = buildTemplateTasks(hotel.id, null, stamp);
      if (hotelIndex === 1)
        selected = selected
          .filter((task) =>
            ["Web & IT", "SEO", "Analytics"].includes(task.department),
          )
          .slice(0, 16);
      if (hotelIndex === 2)
        selected = selected
          .filter((task) =>
            [
              "Sosyal Medya",
              "Performans Pazarlama",
              "Dijital Strateji",
            ].includes(task.department),
          )
          .slice(0, 14);
      if (hotelIndex === 3)
        selected = selected
          .filter((task) =>
            ["Proje Yöneticisi", "Kreatif Ekip", "Sosyal Medya"].includes(
              task.department,
            ),
          )
          .slice(0, 12);
      selected.forEach((task, index) => {
        task.assigneeId =
          task.department === "Web & IT" ||
          task.department === "SEO" ||
          task.department === "Analytics"
            ? "user-emre"
            : task.department === "Performans Pazarlama" ||
                task.department === "Dijital Strateji"
              ? "user-deniz"
              : task.department === "Sosyal Medya" ||
                  task.department === "Kreatif Ekip"
                ? "user-selin"
                : "user-ayse";
        task.status = statusCycle[(index + hotelIndex) % statusCycle.length];
        task.priority = (index % 10) + 1;
        task.dueDate = dueDate((index % 16) - 3 + hotelIndex);
        task.checklist = task.checklist.map((item) => ({
          ...item,
          done: task.status === "completed" || task.status === "review",
        }));
        task.waitingReason =
          task.status === "waiting"
            ? `Otelden bekleniyor: ${task.hotelInput || "Yetkili onayı"}`
            : "";
        sampleTasks.push(task);
      });
    }
    for (const task of sampleTasks) await insertTask(tx, task);
    for (const task of sampleTasks
      .filter((task) => task.status !== "planned")
      .slice(0, 16)) {
      const actor = users.find((user) => user.id === task.assigneeId)!;
      const activity: Activity = {
        id: randomUUID(),
        taskId: task.id,
        hotelId: task.hotelId,
        userId: actor.id,
        userName: actor.name,
        message:
          task.status === "waiting"
            ? "Örnek kayıt: Otelden bilgi bekleniyor."
            : task.status === "completed"
              ? "Örnek kayıt: Görev yönetici onayıyla tamamlandı."
              : task.status === "review"
                ? "Örnek kayıt: Görev kontrol için gönderildi."
                : "Örnek kayıt: Görev üzerinde çalışılmaya başlandı.",
        createdAt: new Date(
          now.getTime() - (sampleTasks.indexOf(task) + 1) * 600000,
        ).toISOString(),
      };
      await tx.query(
        "INSERT INTO activities(id,hotel_id,task_id,data) VALUES ($1,$2,$3,$4::jsonb)",
        [
          activity.id,
          activity.hotelId,
          activity.taskId,
          JSON.stringify(activity),
        ],
      );
      if (task.status === "waiting" || task.status === "review") {
        const comment: TaskComment = {
          id: randomUUID(),
          taskId: task.id,
          userId: actor.id,
          userName: actor.name,
          body:
            task.status === "waiting"
              ? "Örnek not: Gerekli bilgileri bekliyoruz. Bilgi geldiğinde kontrolleri tamamlayacağım."
              : "Örnek not: Tamamlanma kriterini kontrol ettim. Yönetici onayına hazır.",
          createdAt: activity.createdAt,
        };
        await tx.query(
          "INSERT INTO task_comments(id,task_id,data) VALUES ($1,$2,$3::jsonb)",
          [comment.id, comment.taskId, JSON.stringify(comment)],
        );
      }
    }
    await tx.query(
      "INSERT INTO app_meta(key,value) VALUES ('demo-seeded-v1','true')",
    );
  });
}
