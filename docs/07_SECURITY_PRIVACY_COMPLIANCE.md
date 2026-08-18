# 07 — Security, Privacy & Compliance

This is the document that decides whether PRAVAAH gets deployed or gets stopped by legal. A traffic analytics platform that touches number plates, camera feeds and citizen violation records is a data-protection problem wearing an engineering costume. Treat this doc as a hard constraint, not a checklist.

---

## 1. The regulatory position

India's **Digital Personal Data Protection Act, 2023** was fully operationalised when MeitY notified the **DPDP Rules, 2025** on 14 November 2025, with a phased compliance window of up to 18 months. Penalties run to ₹250 crore for failure to implement reasonable security safeguards and ₹200 crore for failing to report a breach.

Government instrumentalities can be exempted by notification for sovereignty, security, public order and similar grounds — but **do not build on that exemption.** Three reasons:

1. You do not know whether the deploying department holds such a notification, and neither does the official you are pitching.
2. Exemptions are contested and can narrow.
3. Building to full compliance when you might be exempt costs you a few weeks. Building on an exemption that evaporates costs you the project.

**Design stance: build as though DPDP applies in full.** Then, in the pitch, say exactly that. "We built to full DPDP compliance without relying on the government exemption" is a sentence that ends the legal objection before it starts, and no system integrator's off-the-shelf ITS product can say it.

---

## 2. Data classification

| Class | Examples | Handling |
|---|---|---|
| **P0 — Non-personal** | Aggregate counts, PCU, congestion index, forecasts, road inventory | Freely usable, publishable, exportable |
| **P1 — Pseudonymous** | Track IDs, re-ID signatures, plate hashes | Short TTL, salted, rotating salt, never exported raw |
| **P2 — Personal** | Number plates, RC-holder details, violation records | Encrypted at rest, masked by default, access audited, reason-coded |
| **P3 — Sensitive** | Raw video containing identifiable people | Never centralised. Edge-only. 7-day rotation. |

**The architectural consequence:** GANANA's counting output is entirely P0. Counting vehicles is not processing personal data. This means the flagship module — the one that answers the official's actual question — has almost no privacy surface. Only KAVACH-E touches P2.

Say this in the pitch. "The counting system processes no personal data at all" is both true and reassuring.

---

## 3. Privacy by design — the concrete controls

### Video never leaves the pole
Inference runs on the edge node. Raw frames are never transmitted, never centralised, and rotate out after 7 days on local encrypted storage. Only structured events travel upstream. Bandwidth benefit is incidental; the real point is that a compromise of the central platform exposes no video.

### Plate handling
```
Plate read at edge
  → salted hash (HMAC-SHA256, salt in edge HSM/keystore) → this is the join key
  → envelope-encrypted ciphertext (AES-256-GCM, DEK wrapped by KEK in a separate KMS)
  → ciphertext written direct to DB over mTLS; hash goes on the message bus
  → decryption requires: authorised role + reason code + audit write BEFORE response
```
The raw plate never appears on Redpanda, in logs, in error messages, in metrics, or in any cache. Add a CI check that greps for plate-shaped regexes in log statements.

### Re-identification (OD matrix)
Appearance-embedding based, never plate-based. Salt rotates every 24 hours, so cross-day tracking of an individual vehicle is cryptographically prevented rather than merely forbidden by policy. Signature TTL 4 hours. Outputs are aggregate matrices only; an individual trajectory is never queryable, and there is no API that would return one.

### Absolute exclusions — write these into `CLAUDE.md`
- No facial recognition
- No person detection, tracking or re-identification
- No gait, clothing or biometric analysis
- No linkage of vehicle movement to individual identity outside a specific, logged, case-referenced enforcement action
- No behavioural profiling of drivers beyond violation history

If any task drifts toward these, the correct response is to stop and flag it. A traffic counting platform that quietly becomes a surveillance system is the failure mode that gets these projects cancelled and makes national news.

### Data minimisation
Collect what the decision needs. The counting pipeline needs class, direction, speed and timestamp — it does not need colour, make, model, or occupant count, so do not detect them. Every field must justify its existence against a stated decision.

### Retention
| Data | Retention | Then |
|---|---|---|
| Raw video (edge) | 7 days | Overwritten |
| Violation evidence clips | 90 days or case closure | Deleted |
| Plate ciphertext | Duration of challan lifecycle + 1 year | Deleted |
| Re-ID signatures | 4 hours | Deleted |
| Structured events (P0) | 3 years | Aggregated |
| Aggregates | Indefinite | — |
| Audit log | 7 years | Cold storage |

Automate every one of these with a Prefect job. A retention policy that requires someone to remember is a retention policy that fails.

---

## 4. DPDP obligations, mapped

| Obligation | Implementation |
|---|---|
| Notice | Public privacy notice, Hindi + English, on the citizen PWA; physical signage template for instrumented junctions |
| Lawful basis | Legitimate use — statutory function of traffic regulation under the MV Act. Document the basis per processing activity in a register. |
| Purpose limitation | Purpose recorded per data category; enforced technically via role-based table access, not just policy |
| Data minimisation | See above; field-level justification register |
| Accuracy | ANPR confidence gating at 0.85; human review queue; grievance-driven correction path |
| Security safeguards | §5 below |
| Breach notification | Automated detection → Data Protection Board + affected principals; runbook with named owners and a 72-hour clock |
| Data principal rights | Portal for access, correction, grievance; SLA-tracked |
| Grievance redressal | Named officer, in-app channel, response SLA, escalation path |
| DPIA | Required — KAVACH-E almost certainly triggers Significant Data Fiduciary consideration given scale and sensitivity. **Prepare a DPIA before deployment, and mention it in the pitch.** |
| Consent manager | Not applicable under legitimate-use basis, but document why |

**Deliverable for the pitch:** a 2-page DPIA summary as an appendix. No student pitch will have one. It signals you understand what deployment actually requires, and it pre-empts the single most likely blocking objection.

---

## 5. Security controls

### Identity and access
Keycloak, OIDC, federated to existing state SSO. MFA mandatory for any role touching P2 data.

| Role | Access |
|---|---|
| `viewer` | P0 aggregates, public dashboards |
| `analyst` | P0 + P1, scenario runner, reports |
| `traffic_officer` | + violation review, incident verification |
| `enforcement_officer` | + defaulter scores (masked), interception plans |
| `enforcement_supervisor` | + unmask with reason code |
| `data_admin` | + camera config, retention overrides (dual-control) |
| `auditor` | Audit log read-only. Cannot read P2. |

ABAC on top: an officer sees only their assigned corridors. Enforced in the query layer via PostgreSQL row-level security, not in application code — application-layer filtering is one missing `WHERE` clause away from a breach.

### Cryptography
- TLS 1.3 everywhere including internal service-to-service (mTLS)
- AES-256-GCM at rest; envelope encryption for P2 with a separate KEK
- Argon2id for any local credential
- Keys in HashiCorp Vault or the state KMS; never in env vars, never in the repo
- Automated key rotation: DEK 90 days, salts 24 hours

### Application security
- Input validation via Pydantic at every boundary
- Parameterised queries only; NEETI's text-to-SQL runs as a read-only role, allowlisted schema, statement timeout, row cap, no DDL/DML — and the generated SQL is logged and surfaceable to the user
- Rate limiting per role; strict limits on `/defaulters` and `/unmask`
- CSP, HSTS, X-Frame-Options DENY, strict CORS
- Signed, short-TTL presigned URLs for evidence; never public object URLs
- Dependency scanning in CI (`pip-audit`, `npm audit`, Trivy on images)
- SAST in CI; secrets scanning with gitleaks pre-commit

### Edge security
- Signed firmware, secure boot
- Encrypted local storage
- mTLS with certificate pinning to the core
- Tamper detection → alert + local data wipe
- No inbound ports; edge dials out only

### Monitoring
- Immutable append-only audit log; app roles have INSERT only, no UPDATE or DELETE grant
- Anomaly alerting on access patterns — bulk unmask, off-hours P2 access, unusual export volume
- Prometheus + Grafana; Loki for logs with plate-pattern redaction at ingest
- Quarterly access review

### Supply chain
Government deployments increasingly exclude certain foreign surveillance hardware from sensitive installations. Since PRAVAAH consumes existing state cameras rather than supplying them, this is not your exposure — but **know the position and be ready to say that the platform is hardware-agnostic and imposes no vendor dependency.** It is a genuine advantage over integrators who bundle hardware.

---

## 6. AI-specific governance

| Risk | Control |
|---|---|
| Wrong challan from bad OCR | 0.85 confidence gate, human review, grievance path with evidence disclosure |
| Biased enforcement targeting | Fairness metrics computed and displayed; protected proxies excluded from features and documented in the model card |
| Unexplained decisions | SHAP mandatory on every score; no score renders without its explanation |
| Model drift | Weekly Evidently monitoring; auto-alert; retraining triggers defined in doc 04 |
| Automation bias | UI language is advisory throughout — "recommended", "estimated", "suggested". Never "the system has determined". Confidence and quality shown on every output. |
| Hallucinated statistics | NEETI numeric verification gate — every numeral traced to a tool result or rendering blocks |
| Scope creep into surveillance | Explicit exclusion list in `CLAUDE.md`; flag-and-stop protocol |

**Human-in-the-loop is mandatory for:** issuing any challan, any enforcement action, any signal-plan change, any unmasking, and any published report. The system recommends. A person decides. Every time.

---

## 7. Threat model — top risks

| Threat | Impact | Mitigation |
|---|---|---|
| Plate database exfiltration | Severe — mass privacy breach | Envelope encryption, separate KEK, no bulk export API, anomaly detection on volume |
| Insider misuse (looking up a specific person) | Severe — trust and legal | Reason-coded access, immutable audit, supervisor approval, anomaly alerting, quarterly review |
| Adversarial evasion (obscured plates) | Moderate | Confidence gating; flag unreadable-plate events as a separate metric, which is itself enforcement-useful |
| Model poisoning via feedback | Moderate | Human verification before any label enters training; provenance on every label |
| Edge node theft | Moderate | Encrypted storage, secure boot, tamper wipe, cert revocation |
| Public dashboard scraping into a tracking tool | Moderate | Public tier is aggregate-only, never vehicle-level; rate limited |
| Denial of service on citizen PWA | Low | WAF, CDN, rate limiting; core platform unaffected |

---

## 8. Compliance checklist before deployment

- [ ] DPIA completed and signed off
- [ ] Privacy notice published, Hindi + English
- [ ] Junction signage deployed at instrumented sites
- [ ] Grievance officer named, channel live, SLA defined
- [ ] Retention automation tested end to end
- [ ] Access review process scheduled
- [ ] Breach runbook written, owners named, tested once
- [ ] Penetration test completed
- [ ] Model cards published for every deployed model
- [ ] Fairness metrics reviewed and signed off
- [ ] Audit log verified immutable (attempt an UPDATE as the app role; it must fail)
- [ ] Legal review by the department's counsel
