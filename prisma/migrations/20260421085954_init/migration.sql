-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterSubmission" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawPayloadLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "route" TEXT NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "body" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "status" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawPayloadLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsletterSubmission_shop_idx" ON "NewsletterSubmission"("shop");

-- CreateIndex
CREATE INDEX "NewsletterSubmission_createdAt_idx" ON "NewsletterSubmission"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubmission_shop_email_key" ON "NewsletterSubmission"("shop", "email");

-- CreateIndex
CREATE INDEX "RawPayloadLog_createdAt_idx" ON "RawPayloadLog"("createdAt");

-- CreateIndex
CREATE INDEX "RawPayloadLog_shop_idx" ON "RawPayloadLog"("shop");
