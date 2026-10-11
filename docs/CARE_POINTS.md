# Care points

A completed, verified watering recovery earns:

```text
P = clamp(round(B × (1 + 0.6N + 0.4√G) × (1 − O)²), 0, 2B)
N = clamp((T − M₀) / T, 0, 1)
G = clamp((min(M₁, R) − M₀) / 100, 0, 1)
O = clamp((M₁ − R) / (100 − R), 0, 1)
```

- `B`: configured base award, currently 10.
- `M₀`: calibrated moisture at the start of the care session.
- `M₁`: fresh calibrated moisture when recovery is confirmed.
- `T`: species thirst threshold.
- `R`: species recovery threshold.
- `N`: initial need; greater dryness increases the award.
- `G`: useful moisture gain, capped at the recovery target. The square root gives diminishing returns.
- `O`: overshoot beyond recovery. Squaring the remaining fraction reduces points for excess watering. When `R = 100`, `O = 0` to avoid division by zero.

These are game-design weights, not a validated measure of biological health. The target must be calibrated for the installed sensor, substrate, and species. A higher score is not a reason to let a tree dry out or to add water beyond its target.

For `B = 10`, `T = 30`, and `R = 45`:

| Start moisture | Final moisture | Points |
| --- | --- | --- |
| 28% | 45% | 12 |
| 16% | 45% | 15 |
| 5% | 45% | 18 |
| 16% | 48% | 13 |
| 16% | 100% | 0 |
| 16% | 44% | 0 (recovery incomplete) |

The existing eligibility rules still require an active request/session, a nearby authenticated player, verified device evidence, fresh readings, and recovery. The formula does not grant eligibility. Rain, chatting, raw Arduino packets, unverified photos, and manual presentation readings alone do not award care points. A request can award only once; exact retries return the stored receipt.

`calculate_care_score` and `evaluate_tree` run inside PostgreSQL. Each new care ledger row stores the inputs, factors, resulting amount, and `care-v2` version in `point_events.calculation`. Existing ledger rows retain their original amounts and have no retroactive calculation. Confirmed death penalties remain configured separately (currently −20). Leaderboard points sum ledger events plus any separately recorded administrator presentation totals; the supplied presentation totals were not derived from this formula.

Verification without retaining fixture data:

```sh
npx supabase db query --linked --project-ref onicsujkioycxtfztfyq --file tests/care-scoring.sql
```

The script runs in a rolled-back transaction and checks numeric boundaries, client privileges, an actual completed recovery/ownership transaction, duplicate evaluation, and recovery without verified evidence. It requires an existing player and territory.
