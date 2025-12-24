-- CreateTable
CREATE TABLE "MempoolTransaction" (
    "txid" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockHeight" INTEGER NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "io" JSONB NOT NULL,

    CONSTRAINT "MempoolTransaction_pkey" PRIMARY KEY ("txid")
);
