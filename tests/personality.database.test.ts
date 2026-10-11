import { expect, it } from "vitest";
import postgres from "postgres";

it.skipIf(process.env.PERSONALITY_DB !== "1")(
  "raw packet retries preserve evidence and do not change game state",
  async () => {
    // Fixed local target; rollback isolates this check from the configured demo/Tiger history.
    const sql = postgres(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      { max: 1 },
    );
    const tx = await sql.reserve();
    try {
      await tx`begin`;
      const [device] =
        await tx`select id,tree_id from devices where revoked_at is null limit 1`;
      const [before] =
        await tx`select status,moisture,owner_id,reading_at from trees where id=${device.tree_id}`;
      const seq = Date.now();
      const payload = {
        device_id: "test-packet",
        seq,
        adc_raw: 280,
        moisture_raw: 17937,
        air_temperature_c: null,
        soil_temperature_c: null,
        light_raw: null,
      };
      const [first] =
        await tx`select accept_hardware_reading(${device.id},${seq},${tx.json(payload)}) as result`;
      const [retry] =
        await tx`select accept_hardware_reading(${device.id},${seq},${tx.json(payload)}) as result`;
      expect(retry.result).toEqual(first.result);
      await tx`savepoint conflict_test`;
      await expect(
        tx`select accept_hardware_reading(${device.id},${seq},${tx.json({ ...payload, adc_raw: 281 })})`,
      ).rejects.toThrow("idempotency_conflict");
      await tx`rollback to savepoint conflict_test`;
      const [after] =
        await tx`select status,moisture,owner_id,reading_at from trees where id=${device.tree_id}`;
      expect(after).toEqual(before);
      const [access] =
        await tx`select has_function_privilege('anon','accept_hardware_reading(uuid,bigint,jsonb)','execute') anon, has_function_privilege('authenticated','accept_hardware_reading(uuid,bigint,jsonb)','execute') player`;
      expect(access).toEqual({ anon: false, player: false });
    } finally {
      await tx`rollback`;
      tx.release();
      await sql.end();
    }
  },
);
