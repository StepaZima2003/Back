-- CreateTable
CREATE TABLE "collection_templates" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "collection_type" "CollectionType" NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_template_categories" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "emoji" TEXT,
    "requires_manual_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "autopay_allowed_by_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "collection_template_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_templates_group_id_idx" ON "collection_templates"("group_id");

-- CreateIndex
CREATE INDEX "collection_templates_owner_user_id_idx" ON "collection_templates"("owner_user_id");

-- CreateIndex
CREATE INDEX "collection_template_categories_template_id_idx" ON "collection_template_categories"("template_id");

-- AddForeignKey
ALTER TABLE "collection_templates" ADD CONSTRAINT "collection_templates_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_templates" ADD CONSTRAINT "collection_templates_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_template_categories" ADD CONSTRAINT "collection_template_categories_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "collection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

