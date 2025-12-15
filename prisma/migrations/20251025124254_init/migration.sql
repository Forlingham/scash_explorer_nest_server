-- CreateTable
CREATE TABLE "Block" (
    "height" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "txCount" INTEGER NOT NULL,
    "size" INTEGER,
    "weight" INTEGER,
    "difficulty" DECIMAL(20,8) NOT NULL,
    "minerAddress" TEXT,
    "version" INTEGER NOT NULL,
    "nonce" BIGINT NOT NULL,
    "reward" BIGINT NOT NULL,
    "feeSpanMin" BIGINT NOT NULL,
    "feeSpanMax" BIGINT NOT NULL,
    "medianFee" BIGINT NOT NULL,
    "totalFees" BIGINT NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("height")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "txid" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "blockHeight" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("txid")
);

-- CreateTable
CREATE TABLE "Address" (
    "address" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txCount" INTEGER NOT NULL DEFAULT 0,
    "received" BIGINT NOT NULL DEFAULT 0,
    "sent" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "TransactionIO" (
    "id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "spentTxid" TEXT,
    "spentIndex" INTEGER,
    "voutIndex" INTEGER,

    CONSTRAINT "TransactionIO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressSnapshot" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "balance" BIGINT NOT NULL,
    "rank" INTEGER NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "AddressSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkHashrate" (
    "id" TEXT NOT NULL,
    "hashrate" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkHashrate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStats" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalBlocks" INTEGER NOT NULL,
    "totalTxs" INTEGER NOT NULL,
    "totalVolume" DECIMAL(20,8) NOT NULL,
    "addrCount" INTEGER NOT NULL,
    "totalMarketCap" DECIMAL(20,8) NOT NULL,

    CONSTRAINT "DailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Block_hash_key" ON "Block"("hash");

-- CreateIndex
CREATE INDEX "Block_minerAddress_idx" ON "Block"("minerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_hash_key" ON "Transaction"("hash");

-- CreateIndex
CREATE INDEX "Transaction_blockHeight_idx" ON "Transaction"("blockHeight");

-- CreateIndex
CREATE INDEX "Address_balance_idx" ON "Address"("balance");

-- CreateIndex
CREATE INDEX "Address_lastActive_idx" ON "Address"("lastActive");

-- CreateIndex
CREATE INDEX "TransactionIO_txid_idx" ON "TransactionIO"("txid");

-- CreateIndex
CREATE INDEX "TransactionIO_address_idx" ON "TransactionIO"("address");

-- CreateIndex
CREATE INDEX "TransactionIO_spentTxid_spentIndex_idx" ON "TransactionIO"("spentTxid", "spentIndex");

-- CreateIndex
CREATE INDEX "TransactionIO_txid_voutIndex_idx" ON "TransactionIO"("txid", "voutIndex");

-- CreateIndex
CREATE INDEX "AddressSnapshot_date_rank_idx" ON "AddressSnapshot"("date", "rank");

-- CreateIndex
CREATE INDEX "AddressSnapshot_address_date_idx" ON "AddressSnapshot"("address", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AddressSnapshot_address_date_key" ON "AddressSnapshot"("address", "date");

-- CreateIndex
CREATE INDEX "Price_timestamp_idx" ON "Price"("timestamp");

-- CreateIndex
CREATE INDEX "NetworkHashrate_timestamp_idx" ON "NetworkHashrate"("timestamp");

-- CreateIndex
CREATE INDEX "AddressTag_address_idx" ON "AddressTag"("address");

-- CreateIndex
CREATE INDEX "AddressTag_type_idx" ON "AddressTag"("type");

-- CreateIndex
CREATE INDEX "AddressTag_name_idx" ON "AddressTag"("name");

-- CreateIndex
CREATE INDEX "DailyStats_date_idx" ON "DailyStats"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStats_date_key" ON "DailyStats"("date");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_blockHeight_fkey" FOREIGN KEY ("blockHeight") REFERENCES "Block"("height") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionIO" ADD CONSTRAINT "TransactionIO_txid_fkey" FOREIGN KEY ("txid") REFERENCES "Transaction"("txid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionIO" ADD CONSTRAINT "TransactionIO_address_fkey" FOREIGN KEY ("address") REFERENCES "Address"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressTag" ADD CONSTRAINT "AddressTag_address_fkey" FOREIGN KEY ("address") REFERENCES "Address"("address") ON DELETE CASCADE ON UPDATE CASCADE;
