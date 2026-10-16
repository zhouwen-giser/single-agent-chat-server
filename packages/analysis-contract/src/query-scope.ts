import { z } from "zod";

export const queryPositionSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const ring = z
  .array(queryPositionSchema)
  .min(4)
  .max(256)
  .refine((points) => {
    const first = points[0],
      last = points.at(-1);
    return first?.[0] === last?.[0] && first?.[1] === last?.[1];
  }, "Polygon rings must be explicitly closed");

/** User-authored draft geometry, never an authoritative WSGS Finding. */
export const queryGeometrySchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("Point"),
    coordinates: queryPositionSchema,
  }),
  z.strictObject({
    type: z.literal("LineString"),
    coordinates: z.array(queryPositionSchema).min(2).max(256),
  }),
  z.strictObject({
    type: z.literal("Polygon"),
    coordinates: z.array(ring).min(1).max(16),
  }),
  // Circle remains an exact local draft; wire conversion is an explicit control concern.
  z.strictObject({
    type: z.literal("Circle"),
    center: queryPositionSchema,
    radiusMeters: z.number().finite().positive().max(1_000_000),
  }),
]);
export const queryScopeSchema = z.strictObject({
  geometry: queryGeometrySchema,
});
export type QueryScope = z.infer<typeof queryScopeSchema>;
