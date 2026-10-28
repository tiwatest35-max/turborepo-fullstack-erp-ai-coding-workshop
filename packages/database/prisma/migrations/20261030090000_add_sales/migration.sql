-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "soldById" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sale_number_key" ON "Sale"("number");

-- CreateIndex
CREATE INDEX "Sale_storeId_soldAt_idx" ON "Sale"("storeId", "soldAt");

-- CreateIndex
CREATE INDEX "SaleLine_productId_idx" ON "SaleLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleLine_saleId_productId_key" ON "SaleLine"("saleId", "productId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SAL-01: a sale line is at least one whole unit at a price that is never negative, whatever code writes it.
ALTER TABLE "SaleLine"
    ADD CONSTRAINT "SaleLine_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "SaleLine"
    ADD CONSTRAINT "SaleLine_unitPrice_not_negative" CHECK ("unitPrice" >= 0);

-- SAL-04: a confirmed sale cannot be edited or deleted, by any endpoint, script or SQL session.
CREATE FUNCTION "sale_is_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is immutable: a confirmed sale cannot be edited or deleted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "Sale_immutable"
    BEFORE UPDATE OR DELETE ON "Sale"
    FOR EACH ROW EXECUTE FUNCTION "sale_is_immutable"();

CREATE TRIGGER "SaleLine_immutable"
    BEFORE UPDATE OR DELETE ON "SaleLine"
    FOR EACH ROW EXECUTE FUNCTION "sale_is_immutable"();
