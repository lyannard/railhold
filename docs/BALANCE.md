# Balance

Output of `node scripts/balance.ts` (impact at 150 m, ISA drag and gravity, one player's grid share of 90 kW supply, 80 kW charger, eta 0.9):

| Design | m/s | Energy J | Eff % | Peak kA | Charge s |
|---|---|---|---|---|---|
| Railgun tier 1 (starter) | 661 | 5465 | 6.2 | 248 | 1.2 |
| Railgun tier 2 | 504 | 17509 | 9.8 | 359 | 2.5 |
| Railgun tier 3 | 740 | 37756 | 12.8 | 430 | 4.1 |
| Railgun tier 4 | 1000 | 69020 | 15.7 | 494 | 6.1 |
| Coilgun tier 1 | 116 | 281 | 4.2 | 13 | 0.1 |
| Coilgun tier 2 (10 stages) | 164 | 559 | 1.7 | 42 | 0.5 |

Railguns trade charge time for energy; coilguns fire fast with low energy. Efficiency scoring uses a 0.2 reference. Wave composition is in `packages/shared/src/waves.json`. These are single-shot numbers; full-match balance has only been exercised by the automated engine runs, not playtested with people.


Charge times were cut roughly threefold in 1.2.0 after playtesting feedback (grid generation 60 kW base plus 30 kW per player, 80 kW charger, 800 kJ buffer). Shot physics is unchanged.
