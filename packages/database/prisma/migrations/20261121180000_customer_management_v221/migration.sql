-- Additive, nullable customer profile fields; existing customer records remain valid.
ALTER TABLE "customers"
  ADD COLUMN "phone" VARCHAR(40),
  ADD COLUMN "billing_email" VARCHAR(320),
  ADD COLUMN "address_line_1" VARCHAR(200),
  ADD COLUMN "address_line_2" VARCHAR(200),
  ADD COLUMN "city" VARCHAR(120),
  ADD COLUMN "state" VARCHAR(120),
  ADD COLUMN "postal_code" VARCHAR(32),
  ADD COLUMN "tax_id" VARCHAR(80),
  ADD COLUMN "admin_notes" TEXT;
