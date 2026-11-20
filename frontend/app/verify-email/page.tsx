import { VerifyEmailForm } from "@/components/auth/forms";
import { getRequestI18n } from "@/lib/i18n/server";

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string; next?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { dictionary } = await getRequestI18n();
  const params = await searchParams;
  return <VerifyEmailForm dictionary={dictionary} token={params.token} next={params.next} />;
}
