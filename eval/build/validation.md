# Task validation

Generated 2026-10-27 by `eval/build/report.mjs`.

A candidate becomes a task only if its tests fail on the parent commit and pass twice with the real change (`eval/build/validate.mjs`). Instructions are written by hand afterwards; a task without one is used only in the debugging seat, which needs no instruction.

**Tiers:** standard tasks are within each repo's size limit (LuthiModel 150 source lines in 3 files, Sanctuary 300 in 4). Large tasks are above that, up to 600 lines in 8 files, and are scored separately (`run.mjs --tier large`).

**Gold replay:** the commit's own fix written through Pi and the guard by a scripted model (`eval/tests/gold-replay.mjs`). It must resolve; anything else means the task or the environment is wrong.

## luthimodel

44 candidates checked: 38 valid, 38 with an instruction (implementation seat).

| Task | Fail-to-pass | Pass-to-pass | Source lines | Instruction | Gold replay | Subject |
|---|---|---|---|---|---|---|
| luthimodel-01c22a49 | 12 | 16 | 141 | yes | PASS | fix: momentum step-8 review — eye source is explicit config, not flag- |
| luthimodel-0cacc238 | 2 | 10 | 23 | yes | PASS | LR warmup: attack Opus's S1, survived; build warmup_steps; register st |
| luthimodel-0e55791b | 2 | 10 | 46 | yes | PASS | Review fixes for light-cadence block scalars: guard + bounded quantile |
| luthimodel-15bb0858 | 1 | 0 | 14 | yes | PASS | add path-hygiene test, genericize machine-specific path examples |
| luthimodel-1634e1a9 | 4 | 20 | 62 | yes | PASS | Refactor |
| luthimodel-22b80903 | 11 | 0 | 132 | yes | PASS | feat: momentum foundations 1/2 — locked inverted-U gain spec + slow-tr |
| luthimodel-26d25d33 | 4 | 0 | 76 | yes | PASS | fix: checkpoint rotation held ONE slot, not rolling_slots (negative-sl |
| luthimodel-27c357cf | 3 | 30 | 82 | yes | PASS | clarify top-down signal axis convention, assert shape contract |
| luthimodel-27f9fa47 | 10 | 0 | 148 | yes | PASS | Build the six depth-8 remedy probes: TC-SIGReg, interior Weak-SIGReg,  |
| luthimodel-282921a4 | 8 | 0 | 137 | yes | PASS | Homeostatic activity band: the sparse gate gets its key |
| luthimodel-292f7c8e | 9 | 0 | 52 | yes | PASS | v4 depth bundle: cosine LR + 2x SIGReg folded into the d4 family; 7a t |
| luthimodel-2af229e6 | 6 | 2 | 51 | yes | PASS | Fix the muPC depth asymmetry: balance PC rates against residual_scale |
| luthimodel-3940aa39 | 1 | 12 | 45 | yes | PASS | Statistical warmup: the store is never inert, in any length of run |
| luthimodel-5f63385a | 7 | 30 | 82 | yes | PASS | Middle-ground kill rules (Brian's ruling) + scale-breathing forensic |
| luthimodel-67f6326a | 3 | 19 | 108 | yes | PASS | LuthiModel_v2 plan, and Ablation test building. |
| luthimodel-68019d71 | 1 | 28 | 21 | yes | PASS | Two-gauge execution rule: healthy generation vetoes marginal NMSE trip |
| luthimodel-71ea9675 | 4 | 0 | 12 | yes | PASS | feat: consolidation fire count surfaced as a substrate metric (Brian's |
| luthimodel-77bdde3b | 12 | 0 | 128 | yes | PASS | Fix SIGReg's RNG-stream pollution; default ON, with an eval-purity gua |
| luthimodel-77c4ae5a | 24 | 0 | 76 | yes | PASS | guard_min_step: delay all kill paths, loudly; register the observed-fa |
| luthimodel-8867a77e | 1 | 6 | 18 | yes | PASS | Adaptation eval: disjoint replication set (--doc-phase) |
| luthimodel-88ddd67d | 11 | 0 | 56 | yes | PASS | Admission v2: detrended surprise + refractory, after the probe failed |
| luthimodel-9bc38826 | 4 | 1 | 61 | yes | PASS | fix: kill-5 requires the degeneracy signature (Brian's ruling; post-ho |
| luthimodel-9e7643ea | 12 | 0 | 98 | yes | PASS | feat: falsification program rebound to the JEPA objective (Brian's rul |
| luthimodel-a862b9c8 | 10 | 0 | 91 | yes | PASS | Build LLM-JEPA integration; the dose is 10-70x the spec's estimate |
| luthimodel-ad86fda0 | 3 | 3 | 110 | yes | PASS | m9 audit: spike and kill bands were hair triggers on quiet signals |
| luthimodel-afa1e33e | 4 | 10 | 51 | yes | PASS | Scheduled muPC (Brian's design): acquire at scale 1.0, anneal muPC in |
| luthimodel-b2a56a4b | 4 | 0 | 105 | yes | PASS | Tier 0 measurement validity + item 1.1 drive normalization |
| luthimodel-b70dec4f | 3 | 1 | 30 | yes | PASS | feat: momentum foundations step 7 — C++ parity for the inverted-U gain |
| luthimodel-bb60a03f | 8 | 0 | 117 | yes | PASS | Wake/rest regime ruled and the wake-freeze mode built |
| luthimodel-cc302265 | 1 | 9 | 19 | yes | PASS | Mid-seed resume in the pilot driver + operational-queue runbook |
| luthimodel-ccc0e2f5 | 10 | 0 | 68 | yes | PASS | Light-cadence per-block activation scalars (stage 1 of activation-moni |
| luthimodel-cf8651d3 | 5 | 0 | 61 | yes | PASS | feat: momentum foundations step 4 — layer plumbing for the inverted-U  |
| luthimodel-d2a63471 | 3 | 8 | 38 | yes | PASS | run_registry: harden against the LOW/NIT items from 4.7's review |
| luthimodel-d6b8b227 | 3 | 7 | 69 | yes | PASS | get_introspection: expose v2 PC signals (error_acc, pred_frob, precisi |
| luthimodel-e2e8fb41 | 7 | 3 | 53 | yes | PASS | Refute power=+1, register the opposite direction |
| luthimodel-f38bb9f2 | 4 | 19 | 47 | yes | PASS | Add per-interval drive instrumentation and the depth-8 arm |
| luthimodel-f9b86fa6 | 1 | 7 | 15 | yes | PASS | Instrument: precision_spread (p95/p5 of the trust ledger) in aliveness |
| luthimodel-fae772dc | 26 | 0 | 104 | yes | PASS | feat: momentum foundations 2/2 — inverted-U gain wired into pc_self_mo |

Rejected:

- luthimodel-6eeceb9f: no test changes from failing to passing
- luthimodel-8a4ad936: no test changes from failing to passing
- luthimodel-93b74c87: no test changes from failing to passing
- luthimodel-a6b7ab6e: no test changes from failing to passing
- luthimodel-ca4165fd: no test changes from failing to passing
- luthimodel-e451b934: no test changes from failing to passing

## sanctuary

32 candidates checked: 26 valid, 26 with an instruction (implementation seat).

| Task | Fail-to-pass | Pass-to-pass | Source lines | Instruction | Gold replay | Subject |
|---|---|---|---|---|---|---|
| sanctuary-243d10b9 | 7 | 54 | 184 | yes | PASS | security: close audit findings (handshake DoS, proxy-loopback trust, S |
| sanctuary-2aafc59f | 40 | 0 | 103 | yes | PASS | PCIntensitySource for v2 substrate; adapter surfaces v2 signals; bridg |
| sanctuary-2eb4b4dc | 6 | 0 | 54 | yes | PASS | Births and deaths without a 40ms stall; recover the spec's caregiving  |
| sanctuary-34862c43 | 4 | 10 | 80 | yes | PASS | fix: Phase 3 W4 — durable dead-letter recovery for the async learner ( |
| sanctuary-355a6421 | 3 | 27 | 104 | yes | PASS | Turbo trace logging + v1/v2 substrate verification + cryptography dep |
| sanctuary-365bdc4c | 2 | 89 | 54 | yes | PASS | security: shell safe-by-default (no shell=True) + harden run_code cont |
| sanctuary-409cb340 | 4 | 4 | 4 | yes | PASS | Replaced "LLM" with "model" throughout the repo |
| sanctuary-4f1ffb00 | 68 | 0 | 254 | yes | PASS | Cycle rate: asymmetric smoothing, turbo, entity-facing motor action |
| sanctuary-61417141 | 12 | 0 | 157 | yes | PASS | security: close the filesystem-sandbox TOCTOU via opened-handle verifi |
| sanctuary-6ab4d27c | 3 | 66 | 3 | yes | PASS | Fix 9 failing tests in affect and attention modules |
| sanctuary-6d1f2a14 | 15 | 0 | 176 | yes | PASS | security: enforce graduated-capability gating on the tool layer |
| sanctuary-7a6823c8 | 11 | 10 | 205 | yes | PASS | refactor(physics): electronics-native weather — cold is good, heat is  |
| sanctuary-7eedf5ea | 39 | 0 | 99 | yes | PASS | security: authorize HTTP /status + /metrics; add WS DoS caps |
| sanctuary-97e8b243 | 3 | 28 | 173 | yes | PASS | remove premature crash boundary, refactor Luthi bridge to use stable a |
| sanctuary-a1dd1e06 | 15 | 0 | 227 | yes | PASS | Seam v2: orientation, shape, size and kind -- the format of Luthi's ey |
| sanctuary-ad397631 | 74 | 0 | 205 | yes | PASS | Cycle-rate controller: foundation for entity-controlled cognitive slid |
| sanctuary-b34f0bb7 | 59 | 0 | 139 | yes | PASS | Close the capability boundary: classify the catalog, pin the caregiver |
| sanctuary-b61c6bac | 1 | 0 | 43 | yes | PASS | add path-hygiene + cross-repo integration tests, audit protocol |
| sanctuary-c0555a23 | 1 | 2 | 7 | yes | PASS | fix: Phase 3 W1 — offload NREM consolidate() off the loop thread (audi |
| sanctuary-c585c18d | 1 | 2 | 27 | yes | PASS | feat: feel metaplasticity + momentum — introspection delta consumes ne |
| sanctuary-cd5cdf63 | 13 | 84 | 247 | yes | PASS | fix: Phase 1 data-integrity firestops (audit items 1-4) |
| sanctuary-d5614f3a | 3 | 3 | 73 | yes | PASS | fix: Phase 3 W2 — offload blocking tool bodies + watchdog ceiling (aud |
| sanctuary-db71caab | 31 | 63 | 73 | yes | PASS | security: confine filesystem tools to configured sandbox roots |
| sanctuary-dd61d241 | 19 | 0 | 300 | yes | PASS | Stimulus-density heuristic: autonomic rate adjustment with entity auth |
| sanctuary-df651ade | 10 | 0 | 165 | yes | PASS | Persistence: wire journal/world-graph/experiential into SanctuaryRunne |
| sanctuary-eb19c4ca | 16 | 0 | 107 | yes | PASS | security: SSRF-guard web_fetch (scheme allowlist + internal-address bl |

Rejected:

- sanctuary-21fd868a: no test changes from failing to passing
- sanctuary-3bcbed07: no tests ran
- sanctuary-658fd60a: no test changes from failing to passing
- sanctuary-90eefade: no test changes from failing to passing
- sanctuary-a4c3e7f6: no test changes from failing to passing
- sanctuary-e13d733d: no test changes from failing to passing

## luthimodel (large tier)

29 candidates checked: 25 valid, 25 with an instruction (implementation seat).

| Task | Fail-to-pass | Pass-to-pass | Source lines | Instruction | Gold replay | Subject |
|---|---|---|---|---|---|---|
| luthimodel-087f5970 | 8 | 20 | 314 | yes | PASS | m9(seam): Phase 4b realized-reward grounding + tests |
| luthimodel-13e5cd25 | 7 | 0 | 58 | yes | PASS | v5 precision awakening: relative trust behind a flag, both kernels, pa |
| luthimodel-14fecd7c | 16 | 0 | 341 | yes | PASS | VISReg (arXiv 2606.02572) built as SIGReg's replacement; stage 54 regi |
| luthimodel-16d686eb | 6 | 0 | 197 | yes | PASS | seams and JEPA updates |
| luthimodel-18efa8c1 | 6 | 3 | 148 | yes | PASS | feat: momentum foundations step 5 — the applied-change signal to the s |
| luthimodel-1db10135 | 23 | 0 | 162 | yes | PASS | Checkpoints: encryption optional; no password in launchers |
| luthimodel-3756ae1d | 21 | 3 | 367 | yes | PASS | Living write: opt-in covariance rule, deviation context, store counter |
| luthimodel-5934189d | 19 | 0 | 430 | yes | PASS | feat: the two-arm JEPA pilot is launch-ready — held-out eval, probe, k |
| luthimodel-5b68ccbf | 18 | 0 | 247 | yes | PASS | Salvatori style attractor memory research added, mechanism implemented |
| luthimodel-5fb90d5f | 16 | 0 | 162 | yes | PASS | Add gradient clipping and two absolute divergence guards |
| luthimodel-77d89f4f | 2 | 12 | 55 | yes | PASS | Prep for Ablation |
| luthimodel-7be80b97 | 17 | 3 | 288 | yes | PASS | Fix the drive: normalized excess surprise, and a correction to 07-28 |
| luthimodel-846c0536 | 45 | 0 | 154 | yes | PASS | Per-block contribution gauge: what the block adds, not what it outputs |
| luthimodel-9340f185 | 8 | 0 | 181 | yes | PASS | LuthiScope handshake and integration |
| luthimodel-99d5e5a3 | 11 | 3 | 248 | yes | PASS | Fix the frozen episode store: relative admission, age decay, stochasti |
| luthimodel-bae295d1 | 9 | 0 | 232 | yes | PASS | feat: rich-parameters completion 1/2 — continuity patches + metaplasti |
| luthimodel-bb44fc8a | 13 | 0 | 247 | yes | PASS | Build the variance-budget governor to spec; two doses measured, not as |
| luthimodel-bc3e768c | 5 | 42 | 185 | yes | PASS | Close audit B1-B6: probe standardization, veto instrumentation, VISReg |
| luthimodel-c0f0a7f7 | 8 | 15 | 198 | yes | PASS | m5 re-run post train updates |
| luthimodel-c6ed77f5 | 66 | 0 | 227 | yes | PASS | fix: mode-matrix sweep finds two real cross-product bugs; declared com |
| luthimodel-df938a79 | 4 | 1 | 182 | yes | PASS | Audit: consolidation counted triggers not effect; chorus rank into the |
| luthimodel-e06b7890 | 13 | 7 | 476 | yes | PASS | further integration of JEPA goals |
| luthimodel-f7de6e0e | 3 | 10 | 197 | yes | PASS | μPC attenuation and plasticity experiments and Glossary update |
| luthimodel-fd935dc0 | 1 | 0 | 218 | yes | PASS | updates |
| luthimodel-ffb5db13 | 12 | 0 | 112 | yes | PASS | feat: run-3 builds — plasticity taper, gain plumb-through, recall tigh |

Rejected:

- luthimodel-110c1a03: no tests ran
- luthimodel-2ef25cc6: no tests ran
- luthimodel-460cd42c: no test changes from failing to passing
- luthimodel-95b5ae7a: no test changes from failing to passing

## sanctuary (large tier)

16 candidates checked: 12 valid, 12 with an instruction (implementation seat).

| Task | Fail-to-pass | Pass-to-pass | Source lines | Instruction | Gold replay | Subject |
|---|---|---|---|---|---|---|
| sanctuary-03939517 | 32 | 0 | 398 | yes | PASS | Close the action loop: ActionSelection -> apply_force |
| sanctuary-0df08c51 | 19 | 0 | 445 | yes | PASS | Claude/general chat y ntgp (#152) |
| sanctuary-170869ce | 17 | 55 | 490 | yes | PASS | Fable Unilateral Build Autority |
| sanctuary-1dcac4c8 | 33 | 0 | 487 | yes | PASS | The bedrock world: wire the embodiment loop, and the seam Godot attach |
| sanctuary-200738cd | 18 | 0 | 492 | yes | PASS | feat(physics): the physics-authority seam for the developmental world |
| sanctuary-2fa33cc3 | 57 | 0 | 520 | yes | PASS | Turbo state machine: substrate-intensity-driven cycle-rate elevation |
| sanctuary-8d8d4c4a | 8 | 0 | 184 | yes | PASS | fix: Phase 2 part 2 — authority persistence, windowed NaN gate, dead-l |
| sanctuary-9473134c | 1 | 14 | 215 | yes | PASS | fix: Phase 3 review — address Fable 5's four findings (all confirmed) |
| sanctuary-994ccf1b | 28 | 0 | 492 | yes | PASS | Claude/general chat e8a xr (#128) |
| sanctuary-ad61e37b | 31 | 137 | 94 | yes | PASS | rename AuthorityLevel.LLM_* to MODEL_* (terminology sweep, isolated) |
| sanctuary-ad737357 | 21 | 0 | 311 | yes | PASS | Connect the physics substrate to perception: PhysicsObservation -> Per |
| sanctuary-efdd4f2f | 19 | 0 | 376 | yes | PASS | feat(physics): weather-field layer — comfort, mobility, shelter, sourc |

Rejected:

- sanctuary-424990e3: no tests ran
- sanctuary-4c24b7d3: no test changes from failing to passing
- sanctuary-b8b0f739: no test changes from failing to passing
- sanctuary-c21d6353: no test changes from failing to passing
