-- Patient direction: admin-configured zones and direction rules (versioned), and the
-- live busy switch per zone.

-- CreateTable
CREATE TABLE "routing_config_publishes" (
    "id" TEXT NOT NULL,
    "facility_code" TEXT NOT NULL DEFAULT 'default',
    "version" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "changelog" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_config_publishes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_status" (
    "facility_code" TEXT NOT NULL DEFAULT 'default',
    "department_code" TEXT NOT NULL,
    "zone_code" TEXT NOT NULL,
    "busy" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zone_status_pkey" PRIMARY KEY ("facility_code","department_code","zone_code")
);

-- CreateIndex
CREATE INDEX "routing_config_publishes_facility_code_is_active_idx" ON "routing_config_publishes"("facility_code", "is_active");

-- CreateIndex
CREATE INDEX "routing_config_publishes_published_by_id_idx" ON "routing_config_publishes"("published_by_id");

-- AddForeignKey
ALTER TABLE "routing_config_publishes" ADD CONSTRAINT "routing_config_publishes_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same as every application table (see 20261014000000_enable_row_level_security).
ALTER TABLE "routing_config_publishes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zone_status" ENABLE ROW LEVEL SECURITY;
