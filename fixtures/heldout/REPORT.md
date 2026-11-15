# Held-out corpus: one-shot report

Written before the Wasm milestone and analysed once through the committed artifact. These documents are not used for tuning and have no goldens.

- Date: 2026-11-15
- Wasm artifact: 113158 bytes, sha256 `e5162b546eefc3778766ac802a5e1686f90cb433baac332acd7a9e6c123f9b80`
- Documents: 14
- Findings: 15

> Re-run after a serialization-only fix: an empty report now prints
> `poison_index:0.0` instead of `-0.0` (the float `sum()` seed). The diff
> against the first run is exactly the artifact digest and those five values;
> every finding and `P_I` is unchanged. This is not a tuning pass.

## Summary

| Document | Input sha256 | Findings | P_I | Rules |
| :--- | :--- | ---: | ---: | :--- |
| `01-online-course-terms.txt` | `117681fc0add` | 2 | 10 | `forced_arbitration.mandatory_arbitration`, `forced_arbitration.class_action_waiver` |
| `02-saas-dpa.txt` | `0afda3dec5a9` | 0 | 0 | — |
| `03-employment-offer.txt` | `5b064f2d44df` | 1 | 5 | `forced_arbitration.jury_trial_waiver` |
| `04-loan-agreement.txt` | `5193d4fc685e` | 2 | 10 | `forced_arbitration.class_action_waiver`, `forced_arbitration.mandatory_arbitration` |
| `05-eula.txt` | `6267c27444fc` | 2 | 10 | `forced_arbitration.mandatory_arbitration`, `forced_arbitration.jury_trial_waiver` |
| `06-marketplace-terms.txt` | `7b878236813e` | 0 | 0 | — |
| `07-gym-membership.txt` | `d8160bfa858d` | 1 | 5 | `forced_arbitration.mandatory_arbitration` |
| `08-insurance-policy.txt` | `e7827145a986` | 0 | 0 | — |
| `09-exchange-agreement.txt` | `a36883c26cfd` | 2 | 10 | `forced_arbitration.mandatory_arbitration`, `forced_arbitration.class_action_waiver` |
| `10-housing-agreement.txt` | `0fb6f918309d` | 0 | 0 | — |
| `11-subscription-bullets.txt` | `a7d9b838c461` | 2 | 10 | `forced_arbitration.jury_trial_waiver`, `forced_arbitration.class_action_waiver` |
| `12-quoted-clause.txt` | `234f08f37e64` | 0 | 0 | — |
| `13-unicode-translation.txt` | `2d53e3704168` | 1 | 5 | `forced_arbitration.mandatory_arbitration` |
| `14-help-center.txt` | `472b901c3e81` | 2 | 10 | `forced_arbitration.mandatory_arbitration`, `forced_arbitration.class_action_waiver` |

## Rule coverage

| Rule | Findings |
| :--- | ---: |
| `forced_arbitration.class_action_waiver` | 5 |
| `forced_arbitration.jury_trial_waiver` | 3 |
| `forced_arbitration.mandatory_arbitration` | 7 |

## Canonical reports

### 01-online-course-terms.txt

Full input sha256: `117681fc0add0adfc9a81bfcd8435e268f895f52f4c5b3de1af824d1df9e51da`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.mandatory_arbitration","raw_text":"Any claim, dispute or controversy arising from your use of the service shall be resolved by final and binding arbitration administered by the American Arbitration Association.","modality":"waiver","severity":5.0,"start_offset":67,"end_offset":242,"opt_out_available":false,"inversion":"none","reason":"matched \"binding arbitration\", \"claim\" in the clause"},{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.class_action_waiver","raw_text":"You and the company each waive the right to a jury trial and the right to participate in a class action.","modality":"waiver","severity":5.0,"start_offset":243,"end_offset":347,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"class action\" in the clause"}],"poison_index":10.0,"truncated":false}}
```

### 02-saas-dpa.txt

Full input sha256: `0afda3dec5a9111bb6a95cf571fc454424823fb262f08fcea8b61bedab968be3`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[],"poison_index":0.0,"truncated":false}}
```

### 03-employment-offer.txt

Full input sha256: `5b064f2d44dff8997a2e9bb028c3a93d79332aabab44a4a479e44d008d43b002`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.jury_trial_waiver","raw_text":"As a condition of employment, you agree that any dispute arising out of your employment must be resolved through arbitration, and you waive your right to a jury trial.","modality":"waiver","severity":5.0,"start_offset":49,"end_offset":216,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"right to a jury\" in the clause"}],"poison_index":5.0,"truncated":false}}
```

### 04-loan-agreement.txt

Full input sha256: `5193d4fc685e73cd5e9af58bd61e8377cf53682ada4117d9b2e93cf83b731c42`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.class_action_waiver","raw_text":"You waive any right to participate in a class action or class arbitration relating to this loan.","modality":"waiver","severity":5.0,"start_offset":16,"end_offset":112,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"class action\" in the clause"},{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.mandatory_arbitration","raw_text":"Any dispute shall be resolved by binding arbitration, except that either party may bring an individual action in small claims court.","modality":"waiver","severity":5.0,"start_offset":113,"end_offset":245,"opt_out_available":false,"inversion":"none","reason":"matched \"shall be resolved by binding arbitration\", \"dispute\" in the clause"}],"poison_index":10.0,"truncated":false}}
```

### 05-eula.txt

Full input sha256: `6267c27444fcf842f60373af28a3527154650d62ba293a9a0f6d602622407a79`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.mandatory_arbitration","raw_text":"BY INSTALLING THE SOFTWARE YOU AGREE THAT ALL DISPUTES SHALL BE RESOLVED EXCLUSIVELY BY BINDING ARBITRATION.","modality":"waiver","severity":5.0,"start_offset":28,"end_offset":136,"opt_out_available":false,"inversion":"none","reason":"matched \"you agree that all disputes\", \"dispute\" in the clause"},{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.jury_trial_waiver","raw_text":"YOU WAIVE ANY RIGHT TO A JURY TRIAL.","modality":"waiver","severity":5.0,"start_offset":137,"end_offset":173,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"right to a jury\" in the clause"}],"poison_index":10.0,"truncated":false}}
```

### 06-marketplace-terms.txt

Full input sha256: `7b878236813e16fd7f2cfe0c8fcf00f37207662e997b085cdbc628aaad8cdd4f`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[],"poison_index":0.0,"truncated":false}}
```

### 07-gym-membership.txt

Full input sha256: `d8160bfa858dbf211bf3e30473c5080817ccdbbc2c1dd82b2e3bc3c0f6ae8c1d`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.mandatory_arbitration","raw_text":"Any dispute regarding fees shall be resolved by arbitration in the county where the club is located.","modality":"waiver","severity":5.0,"start_offset":66,"end_offset":166,"opt_out_available":false,"inversion":"none","reason":"matched \"shall be resolved by arbitration\", \"dispute\" in the clause"}],"poison_index":5.0,"truncated":false}}
```

### 08-insurance-policy.txt

Full input sha256: `e7827145a986612c255086d2d5c39f7d988b1ce9b844da6a46d7888258111fc4`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[],"poison_index":0.0,"truncated":false}}
```

### 09-exchange-agreement.txt

Full input sha256: `a36883c26cfd09c978541cad51f9e71c640a3e6fcefc92fe5125747b3fac4e09`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.mandatory_arbitration","raw_text":"You agree that any dispute, claim or controversy arising out of or relating to this Agreement shall be resolved by binding arbitration.","modality":"waiver","severity":5.0,"start_offset":25,"end_offset":160,"opt_out_available":false,"inversion":"none","reason":"matched \"you agree that any dispute\", \"dispute\" in the clause"},{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.class_action_waiver","raw_text":"You waive the right to participate in a class action.","modality":"waiver","severity":5.0,"start_offset":161,"end_offset":214,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"class action\" in the clause"}],"poison_index":10.0,"truncated":false}}
```

### 10-housing-agreement.txt

Full input sha256: `0fb6f918309db3aa7873db13c9e7a02f9e8cea9dde3423f7cdfddaddac471d36`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[],"poison_index":0.0,"truncated":false}}
```

### 11-subscription-bullets.txt

Full input sha256: `a7d9b838c46188500f633df9f5135e358e2dc495349312fb95c22e29dda4c744`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.jury_trial_waiver","raw_text":"You waive your right to a jury trial.","modality":"waiver","severity":5.0,"start_offset":22,"end_offset":59,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"right to a jury\" in the clause"},{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.class_action_waiver","raw_text":"You waive your right to participate in a class action.","modality":"waiver","severity":5.0,"start_offset":62,"end_offset":116,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"class action\" in the clause"}],"poison_index":10.0,"truncated":false}}
```

### 12-quoted-clause.txt

Full input sha256: `234f08f37e64af76bc695f2c0906786f189fd77e9479646ae836398102d0da7e`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[],"poison_index":0.0,"truncated":false}}
```

### 13-unicode-translation.txt

Full input sha256: `2d53e3704168b3aef92be384d32e5d1162fe6f2f5d6e5c758dfdcf94a6f36b86`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.mandatory_arbitration","raw_text":"Any dispute shall be resolved by binding arbitration.","modality":"waiver","severity":5.0,"start_offset":91,"end_offset":144,"opt_out_available":false,"inversion":"none","reason":"matched \"shall be resolved by binding arbitration\", \"dispute\" in the clause"}],"poison_index":5.0,"truncated":false}}
```

### 14-help-center.txt

Full input sha256: `472b901c3e81a5eed06dca7c30e5c916d6716e0448dd14abd00fd3edd5a86510`

```json
{"status":"ok","report":{"schema_version":"1.0","findings":[{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.mandatory_arbitration","raw_text":"You agree that any dispute will be resolved by binding arbitration, so you cannot bring a lawsuit in court.","modality":"waiver","severity":5.0,"start_offset":36,"end_offset":143,"opt_out_available":false,"inversion":"none","reason":"matched \"you agree that any dispute\", \"dispute\" in the clause"},{"category":"forced_arbitration","label":"Forced Arbitration & Class Waiver","rule_id":"forced_arbitration.class_action_waiver","raw_text":"You waive your right to a class action.","modality":"waiver","severity":5.0,"start_offset":144,"end_offset":183,"opt_out_available":false,"inversion":"none","reason":"matched \"waive\", \"class action\" in the clause"}],"poison_index":10.0,"truncated":false}}
```

