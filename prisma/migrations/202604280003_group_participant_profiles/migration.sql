CREATE TABLE "group_participant_profiles" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "linked_user_id" UUID,
    "invited_phone" TEXT,
    "participant_type" "ParticipantType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "relationship_hint" TEXT NOT NULL DEFAULT 'other',
    "default_weight" DECIMAL(8,3) NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_participant_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "group_participant_profiles_group_id_idx" ON "group_participant_profiles"("group_id");
CREATE INDEX "group_participant_profiles_owner_user_id_idx" ON "group_participant_profiles"("owner_user_id");
CREATE INDEX "group_participant_profiles_linked_user_id_idx" ON "group_participant_profiles"("linked_user_id");

ALTER TABLE "group_participant_profiles" ADD CONSTRAINT "group_participant_profiles_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_participant_profiles" ADD CONSTRAINT "group_participant_profiles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_participant_profiles" ADD CONSTRAINT "group_participant_profiles_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
