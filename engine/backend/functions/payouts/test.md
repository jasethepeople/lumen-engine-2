# payouts — request/response contract

## Request

```
POST /functions/v1/payouts
x-cron-secret: <CRON_SECRET>
```

(Service-role bearer token also accepted.) Invoked by pg_cron
`settle_payouts` daily 03:00.

## Response

`200` —
```json
{
  "authors": 2,
  "total_cents": 7300,
  "payouts": [
    { "author_id": "<uuid>", "amount_cents": 4200, "payout_id": "<uuid>" }
  ],
  "skipped": [
    { "author_id": "<uuid>", "amount_cents": 900, "reason": "below_threshold" }
  ]
}
```

- `401` — bad/missing cron secret
- `500` — DB failure

## Behavior

1. Reads `revenue_ledger` where `settled = false`.
2. Groups by `author_id`, summing `creator_cents` (70% share written by the
   `purchases_after_insert` trigger).
3. Authors with sum ≥ `PAYOUT_THRESHOLD_CENTS` (default 2500 = $25) get a
   `payouts` row `{ author_id, amount_cents, status: 'scheduled',
   period_start, period_end }`; their ledger rows are marked `settled = true`.
4. Below-threshold authors are returned in `skipped` and left unsettled.

## Local mock harness

`deno serve` with `CRON_SECRET=test` against `supabase start`. Seed:

```sql
insert into revenue_ledger (purchase_id, author_id, amount_cents, creator_cents, platform_cents)
values (...);  -- one author over 2500, one under
```

Assert: over-threshold author gets a scheduled payout and settled rows;
under-threshold author appears in `skipped` with rows still unsettled;
second run is a no-op (`authors: 0`).
