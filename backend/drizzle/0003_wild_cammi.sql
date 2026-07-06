ALTER TABLE "users" ADD COLUMN "onboarded" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Существующие пользователи уже пользуются приложением — считаем онбординг
-- пройденным, чтобы их не выкинуло на повторный выбор роли. Новые аккаунты
-- получают false (значение по умолчанию колонки).
UPDATE "users" SET "onboarded" = true;
