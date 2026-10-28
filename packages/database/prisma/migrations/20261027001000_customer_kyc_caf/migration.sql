CREATE TABLE "CustomerKyc" (
  "customerId" TEXT NOT NULL,
  "idProofType" TEXT,
  "idProofNumberEncrypted" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerKyc_pkey" PRIMARY KEY ("customerId"),
  CONSTRAINT "CustomerKyc_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CustomerDocument" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "contentEncrypted" TEXT NOT NULL,
  "uploadedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerDocument_customerId_kind_key" ON "CustomerDocument"("customerId", "kind");
