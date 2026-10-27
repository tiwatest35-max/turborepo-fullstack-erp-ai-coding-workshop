-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'RECEIPT', 'SALE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "StockBalance" (
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("productId","storeId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "movementType" "StockMovementType" NOT NULL,
    "sourceDocumentType" TEXT NOT NULL,
    "sourceDocumentNumber" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "prefix" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("prefix")
);

-- CreateIndex
CREATE INDEX "StockMovement_productId_storeId_createdAt_idx" ON "StockMovement"("productId", "storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-03: a stock balance can never go negative, whatever code writes it.
ALTER TABLE "StockBalance"
    ADD CONSTRAINT "StockBalance_quantity_not_negative" CHECK ("quantity" >= 0);

-- INV-02: a movement changes stock, and its balances add up and are never negative.
ALTER TABLE "StockMovement"
    ADD CONSTRAINT "StockMovement_change_not_zero" CHECK ("quantityChange" <> 0),
    ADD CONSTRAINT "StockMovement_balances_add_up" CHECK ("balanceAfter" = "balanceBefore" + "quantityChange"),
    ADD CONSTRAINT "StockMovement_balances_not_negative" CHECK ("balanceBefore" >= 0 AND "balanceAfter" >= 0);

-- INV-02: confirmed movements cannot be edited or deleted, by any endpoint, script or SQL session.
CREATE FUNCTION "stock_movement_is_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'StockMovement is append-only: a confirmed movement cannot be edited or deleted';
END;
$$;

CREATE TRIGGER "StockMovement_append_only"
    BEFORE UPDATE OR DELETE ON "StockMovement"
    FOR EACH ROW EXECUTE FUNCTION "stock_movement_is_append_only"();
