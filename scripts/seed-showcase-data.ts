/**
 * Seeds the showcase buckets with synthetic sample files.
 *
 *   npx tsx scripts/seed-showcase-data.ts [--dry-run]
 *
 * Run out of band by whoever administers the AWS account, using their own
 * credentials — not by the portal. The portal's own roles cannot write outside
 * a user's granted buckets, and this script is deliberately not part of the
 * deployed application.
 *
 * ## Everything here is fabricated
 *
 * The records below are invented: names, addresses, amounts, diagnoses and
 * identifiers. Nothing resembles any real person or any client's environment.
 * That is the point of the showcase — to demonstrate the shape of the product
 * without putting anyone's data, or any client's naming, on a demo screen.
 *
 * The script refuses to run against a config whose `bucketProvisioning` is
 * `"existing"`, so it can never write into a real client's buckets.
 */
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { activeClient } from "../config/index";

const DRY_RUN = process.argv.includes("--dry-run");

interface SampleFile {
  readonly key: string;
  readonly contentType: string;
  readonly body: string;
}

/* -------------------------------------------------------------------------- */
/* Synthetic content                                                           */
/* -------------------------------------------------------------------------- */

const SAMPLES: Record<string, SampleFile[]> = {
  documents: [
    {
      key: "policies/2026/infection-control-policy.md",
      contentType: "text/markdown",
      body: `# Infection Control Policy (SAMPLE)

**Document ID:** POL-IC-2026-03
**Review cycle:** Annual
**Owner:** Quality & Compliance

> This is synthetic sample content for demonstration purposes. It is not a real
> policy and must not be used operationally.

## 1. Purpose
Describes standard precautions applied across all care settings.

## 2. Scope
All staff, contractors and visiting practitioners.

## 3. Standard precautions
1. Hand hygiene before and after every resident contact.
2. Personal protective equipment per the task risk assessment.
3. Segregation and labelling of clinical waste.

## 4. Review
Reviewed annually by the Quality & Compliance lead.
`,
    },
    {
      key: "policies/2026/data-protection-summary.md",
      contentType: "text/markdown",
      body: `# Data Protection — Staff Summary (SAMPLE)

Synthetic sample content. Not a real policy.

- Access to resident records is granted by role, never by individual request.
- Records are never deleted by staff; retention is handled centrally.
- Report any suspected data incident within 24 hours.
`,
    },
    {
      key: "handbooks/staff-handbook-2026.md",
      contentType: "text/markdown",
      body: `# Staff Handbook 2026 (SAMPLE)

Synthetic sample content for demonstration.

## Working patterns
Shift patterns are published four weeks in advance.

## Raising a concern
Speak to your line manager, or use the confidential reporting line.
`,
    },
    {
      key: "meeting-notes/2026-02-governance-board.md",
      contentType: "text/markdown",
      body: `# Governance Board — February 2026 (SAMPLE)

Synthetic minutes for demonstration.

**Present:** Operations Director, Quality Lead, Finance Lead

1. Q4 incident trends reviewed; no sentinel events.
2. Audit schedule for 2026 approved.
3. Next meeting: March 2026.
`,
    },
  ],

  pii: [
    {
      key: "residents/resident-directory-sample.csv",
      contentType: "text/csv",
      body: [
        "resident_id,family_name,given_name,date_of_birth,room,admission_date,primary_contact,contact_phone",
        "R-1001,Aldridge,Marion,1938-04-12,A-14,2024-01-15,Priya Aldridge,+44 7700 900111",
        "R-1002,Bhattacharya,Samir,1941-11-03,A-16,2024-03-02,Rina Bhattacharya,+44 7700 900112",
        "R-1003,Castellanos,Beatriz,1935-07-21,B-02,2023-09-11,Diego Castellanos,+44 7700 900113",
        "R-1004,Doyle,Fionnuala,1943-02-28,B-07,2025-01-08,Sean Doyle,+44 7700 900114",
        "R-1005,Eriksson,Lars,1939-12-16,C-03,2024-06-19,Anna Eriksson,+44 7700 900115",
        "",
        "# SYNTHETIC SAMPLE DATA — every value above is fabricated.",
      ].join("\n"),
    },
    {
      key: "residents/next-of-kin-sample.csv",
      contentType: "text/csv",
      body: [
        "resident_id,relationship,name,email,consent_to_contact",
        "R-1001,Daughter,Priya Aldridge,p.aldridge@example.invalid,yes",
        "R-1002,Spouse,Rina Bhattacharya,r.bhatt@example.invalid,yes",
        "R-1003,Son,Diego Castellanos,d.castellanos@example.invalid,no",
        "R-1004,Brother,Sean Doyle,s.doyle@example.invalid,yes",
        "",
        "# SYNTHETIC SAMPLE DATA — example.invalid is a reserved, non-routable domain.",
      ].join("\n"),
    },
    {
      key: "staff/staff-roster-sample.csv",
      contentType: "text/csv",
      body: [
        "staff_id,family_name,given_name,role,start_date,dbs_check_expiry",
        "S-2001,Okafor,Chidinma,Registered Nurse,2022-05-03,2027-05-03",
        "S-2002,Petrov,Milena,Care Assistant,2023-08-14,2026-08-14",
        "S-2003,Nakamura,Ken,Senior Carer,2021-02-01,2027-02-01",
        "",
        "# SYNTHETIC SAMPLE DATA.",
      ].join("\n"),
    },
  ],

  financial: [
    {
      key: "invoices/2026/Q1/invoice-2026-0417.csv",
      contentType: "text/csv",
      body: [
        "invoice_number,issue_date,due_date,payer,line_item,quantity,unit_price_gbp,total_gbp",
        "INV-2026-0417,2026-01-31,2026-02-28,Northwind Care Group,Residential care — January,31,142.50,4417.50",
        "INV-2026-0417,2026-01-31,2026-02-28,Northwind Care Group,Additional therapy sessions,4,68.00,272.00",
        ",,,,,,Invoice total,4689.50",
        "",
        "# SYNTHETIC SAMPLE DATA.",
      ].join("\n"),
    },
    {
      key: "statements/2026/january-reconciliation.csv",
      contentType: "text/csv",
      body: [
        "date,reference,description,debit_gbp,credit_gbp,balance_gbp",
        "2026-01-02,OB-2026,Opening balance,,,128450.00",
        "2026-01-08,BAC-88213,Local authority remittance,,52310.00,180760.00",
        "2026-01-15,PAY-01-26,Payroll — January,96420.00,,84340.00",
        "2026-01-22,SUP-4471,Catering supplier,11280.00,,73060.00",
        "2026-01-31,CB-2026-01,Closing balance,,,73060.00",
        "",
        "# SYNTHETIC SAMPLE DATA.",
      ].join("\n"),
    },
    {
      key: "payroll/2026/january-summary.csv",
      contentType: "text/csv",
      body: [
        "cost_centre,headcount,gross_pay_gbp,employer_ni_gbp,pension_gbp,total_cost_gbp",
        "Nursing,24,61200.00,7038.00,1836.00,70074.00",
        "Care assistants,38,52440.00,6030.60,1573.20,60043.80",
        "Catering,9,14580.00,1676.70,437.40,16694.10",
        "Administration,6,13800.00,1587.00,414.00,15801.00",
        "",
        "# SYNTHETIC SAMPLE DATA.",
      ].join("\n"),
    },
  ],

  clinical: [
    {
      key: "care-plans/R-1001/care-plan-2026-01.md",
      contentType: "text/markdown",
      body: `# Care Plan — R-1001 (SAMPLE)

**Synthetic record. Not a real person and not real clinical information.**

**Resident ID:** R-1001
**Plan date:** 2026-01-20
**Review due:** 2026-04-20

## Mobility
Independent with a wheeled frame indoors. Assistance of one for stairs.

## Nutrition and hydration
Normal diet, level 0 fluids. Prefers smaller portions, four times daily.

## Falls risk
Low. Bed rails not indicated. Night light in situ.

## Goals
1. Maintain independent indoor mobility through the review period.
2. Attend group activity twice weekly.
`,
    },
    {
      key: "care-plans/R-1003/care-plan-2026-02.md",
      contentType: "text/markdown",
      body: `# Care Plan — R-1003 (SAMPLE)

**Synthetic record.**

**Resident ID:** R-1003
**Plan date:** 2026-02-04
**Review due:** 2026-05-04

## Cognition
Short-term memory impairment. Responds well to routine and familiar staff.

## Skin integrity
Waterlow score 12. Repositioning chart in place, four-hourly.

## Goals
1. No avoidable pressure damage during the review period.
2. Maintain participation in morning routine with prompting only.
`,
    },
    {
      key: "mar-charts/2026-02/mar-summary.csv",
      contentType: "text/csv",
      body: [
        "resident_id,medication,dose,route,frequency,start_date,administered_count,missed_count",
        "R-1001,Amlodipine,5mg,Oral,Once daily,2025-11-01,28,0",
        "R-1002,Metformin,500mg,Oral,Twice daily,2025-06-14,56,1",
        "R-1003,Paracetamol,500mg,Oral,PRN max QDS,2026-01-05,19,0",
        "R-1005,Atorvastatin,20mg,Oral,Once nightly,2025-09-22,28,0",
        "",
        "# SYNTHETIC SAMPLE DATA — fictional residents and medication records.",
      ].join("\n"),
    },
    {
      key: "assessments/2026-01-falls-risk-summary.csv",
      contentType: "text/csv",
      body: [
        "resident_id,assessment_date,tool,score,risk_band,reviewer",
        "R-1001,2026-01-20,FRAT,8,Low,S-2001",
        "R-1002,2026-01-21,FRAT,14,Medium,S-2003",
        "R-1003,2026-02-04,FRAT,19,High,S-2001",
        "",
        "# SYNTHETIC SAMPLE DATA.",
      ].join("\n"),
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  if (activeClient.bucketProvisioning === "existing") {
    throw new Error(
      `Refusing to seed: client "${activeClient.clientId}" uses ` +
        `bucketProvisioning "existing", meaning its buckets belong to a real ` +
        `client. This script only ever writes to buckets the stack created.`,
    );
  }

  const s3 = new S3Client({});
  let written = 0;
  let skipped = 0;

  for (const bucket of activeClient.buckets) {
    const samples = SAMPLES[bucket.id];

    if (!samples) {
      console.warn(
        `No sample content defined for bucket "${bucket.id}" — skipping.`,
      );
      continue;
    }

    console.log(`\n${bucket.label}  (${bucket.bucketName})`);

    for (const sample of samples) {
      // Never replace an existing object, matching the portal's own rule.
      // Re-running the script is therefore safe and idempotent.
      if (await objectExists(s3, bucket.bucketName, sample.key)) {
        console.log(`  skip   ${sample.key}  (already present)`);
        skipped += 1;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  would  ${sample.key}`);
        continue;
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket.bucketName,
          Key: sample.key,
          Body: sample.body,
          ContentType: sample.contentType,
          Metadata: { "uploaded-by": "seed-showcase-data" },
        }),
      );

      console.log(`  put    ${sample.key}`);
      written += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? "Dry run complete." : `Done. ${written} written, ${skipped} already present.`}`,
  );
}

async function objectExists(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return false;
    throw error;
  }
}

main().catch((error) => {
  console.error(`\nSeeding failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
