-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "isDapCreated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MempoolTransaction" ALTER COLUMN "blockHeight" SET DEFAULT -1;

-- CreateTable
CREATE TABLE "DapStatsDate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "totalAddrs" INTEGER NOT NULL,
    "totalTxs" INTEGER NOT NULL,

    CONSTRAINT "DapStatsDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DapData" (
    "id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "blockHeight" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "magicHeader" TEXT NOT NULL,
    "dataContent" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "totalFee" BIGINT NOT NULL,
    "totalOutputValue" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isViolation" BOOLEAN NOT NULL DEFAULT false,
    "isMessageDap" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DapData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DapStatsDate_date_idx" ON "DapStatsDate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DapStatsDate_date_key" ON "DapStatsDate"("date");

-- CreateIndex
CREATE INDEX "DapData_txid_idx" ON "DapData"("txid");

-- CreateIndex
CREATE INDEX "DapData_address_idx" ON "DapData"("address");

-- CreateIndex
CREATE INDEX "DapData_blockHeight_idx" ON "DapData"("blockHeight");

-- CreateIndex
CREATE INDEX "DapData_sortOrder_idx" ON "DapData"("sortOrder");

-- CreateIndex
CREATE INDEX "DapData_isViolation_idx" ON "DapData"("isViolation");

-- CreateIndex
CREATE INDEX "DapData_isMessageDap_idx" ON "DapData"("isMessageDap");
