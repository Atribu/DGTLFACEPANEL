import { z } from "zod";
export const idSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const shortText = z.string().trim().min(1).max(200);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Geçerli tarih girin.");
export const taskFields = {
  title: shortText,
  description: z.string().trim().max(5000).optional(),
  department: shortText,
  assigneeId: idSchema.nullable().optional(),
  priority: z.number().int().min(1).max(10),
  dueDate: date.nullable().optional(),
  hotelInput: z.string().trim().max(3000).optional(),
  stage: shortText.optional(),
};
export const createTaskSchema = z
  .object({
    ...taskFields,
    hotelId: idSchema,
    checklist: z.array(z.string().trim().min(1).max(2000)).max(30).optional(),
  })
  .strict();
export const patchTaskSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("update"),
      ...Object.fromEntries(
        Object.entries(taskFields).map(([key, schema]) => [
          key,
          schema.optional(),
        ]),
      ),
    })
    .strict(),
  z
    .object({
      action: z.literal("status"),
      status: z.enum(["planned", "in_progress", "waiting"]),
      waitingReason: z.string().trim().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("checklist"),
      itemId: idSchema,
      done: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("submit") }).strict(),
  z.object({ action: z.literal("approve") }).strict(),
  z
    .object({
      action: z.literal("return"),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("reopen"),
      reason: z.string().trim().max(2000).optional(),
    })
    .strict(),
]);
export const createHotelSchema = z
  .object({
    name: shortText,
    location: shortText,
    services: z.array(shortText).min(1).max(20),
    managerId: idSchema,
    contactName: shortText,
    contactEmail: z.email().max(254),
    template: z.boolean(),
  })
  .strict();
export const commentSchema = z
  .object({ body: z.string().trim().min(1).max(4000) })
  .strict();
export const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase().trim()),
    password: z.string().min(1).max(256),
  })
  .strict();
