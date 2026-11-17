import assert from "node:assert/strict";
import test from "node:test";
import {
  compareTaskStages,
  INITIAL_SETUP_TASK_BY_ID,
  INITIAL_SETUP_TASK_STAGES,
  INITIAL_SETUP_TASKS,
} from "../lib/task-presets";

test("Excel initial setup presets retain every stage and task", () => {
  assert.equal(INITIAL_SETUP_TASK_STAGES.length, 9);
  assert.equal(INITIAL_SETUP_TASKS.length, 98);
  assert.equal(INITIAL_SETUP_TASK_BY_ID.size, INITIAL_SETUP_TASKS.length);
  assert.equal(
    new Set(INITIAL_SETUP_TASKS.map((preset) => preset.id)).size,
    INITIAL_SETUP_TASKS.length,
  );
  assert.deepEqual(
    INITIAL_SETUP_TASK_STAGES.map((stage) => stage.name),
    [
      "Kuruluş Evrakları",
      "Finans",
      "Operasyonel Kurulum",
      "Call Center İşlemleri",
      "Ota Entegrasyonu",
      "Creative",
      "Yazılım",
      "Seo+Sem",
      "Günlük, Haftalık, Aylık",
    ],
  );
});

test("Excel stages keep workbook order without changing legacy stage names", () => {
  const stages = [
    "07. Web & Rezervasyon",
    "Seo+Sem",
    "Kuruluş Evrakları",
    "01. Proje Açılışı",
    "Finans",
  ].sort(compareTaskStages);
  assert.deepEqual(stages, [
    "Kuruluş Evrakları",
    "Finans",
    "Seo+Sem",
    "01. Proje Açılışı",
    "07. Web & Rezervasyon",
  ]);
});

test("recurring Excel presets preserve their cadence labels", () => {
  assert.deepEqual(INITIAL_SETUP_TASK_BY_ID.get("recurring-feed-plan"), {
    id: "recurring-feed-plan",
    title: "Feed Plan Oluşturulması",
    cadence: "Aylık, Ay sonunda",
    stage: "Günlük, Haftalık, Aylık",
  });
});
