SELECT device_id, sequence_number, received_at, payload
FROM public.hardware_readings
ORDER BY received_at DESC
LIMIT 10;
