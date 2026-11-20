import { LoginForm } from "@/components/auth/forms";
import { getRequestI18n } from "@/lib/i18n/server";

interface LoginPageProps {
  searchParams: Promise<{ verified?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { dictionary } = await getRequestI18n();
  const params = await searchParams;

  return (
    <LoginForm
      dictionary={dictionary}
      successMessage={params.verified === "1" ? dictionary.auth.verifiedSuccess : null}
    />
  );
}
