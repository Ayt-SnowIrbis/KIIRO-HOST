import { ResetPasswordForm } from "@/components/auth/forms";
import { getRequestI18n } from "@/lib/i18n/server";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { dictionary } = await getRequestI18n();
  const params = await searchParams;
  return <ResetPasswordForm dictionary={dictionary} initialToken={params.token} />;
}
